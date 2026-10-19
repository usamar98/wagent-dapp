import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db, transaction, lockUser } from './db.js';
import { auth, check, AppError, encrypt, decrypt, hash, token } from './security.js';
import { env } from './env.js';

const callbackPath = '/api/brokers/coinbase/callback';
const scope = 'wallet:accounts:read';
const cookieOptions = { httpOnly: true, secure: env.production, sameSite: 'lax' as const, path: '/api/brokers/coinbase', maxAge: 600000 };
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().int().positive().max(31536000), scope: z.string().optional(), token_type: z.string().optional() });

function credentials() {
  const clientId = process.env.COINBASE_CLIENT_ID, clientSecret = process.env.COINBASE_CLIENT_SECRET;
  check(clientId && clientSecret, 503, 'Coinbase account linking is waiting for approved partner credentials. Paper trading works without a Coinbase account.');
  return { clientId, clientSecret };
}

async function exchange(values: Record<string, string>) {
  const { clientId, clientSecret } = credentials();
  let response: Response;
  try {
    response = await fetch('https://login.coinbase.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...values, client_id: clientId, client_secret: clientSecret }), redirect: 'error', signal: AbortSignal.timeout(15000) });
  } catch { throw new AppError(502, 'Coinbase could not be reached. Please reconnect your account.'); }
  check(response.ok, 502, 'Coinbase did not authorize this connection. Please start account linking again.');
  const parsed = tokenSchema.safeParse(await response.json());
  check(parsed.success, 502, 'Coinbase returned an unsupported authorization response.');
  check(!parsed.data.token_type || parsed.data.token_type.toLowerCase() === 'bearer', 502, 'Unsupported Coinbase token type.');
  return parsed.data;
}

async function accessToken(userId: string) {
  const authorization = await db.brokerAuthorization.findUnique({ where: { userId } });
  check(authorization, 409, 'Connect your Coinbase account first.');
  check(!authorization.refreshLeaseUntil || authorization.refreshLeaseUntil.getUTCFullYear() < 9999, 409, 'Coinbase authorization needs renewal. Disconnect and reconnect your account.');
  const saved = tokenSchema.parse(JSON.parse(decrypt(authorization.encryptedTokens)));
  if (authorization.expiresAt.getTime() > Date.now() + 60000) return saved.access_token;
  const claimed = await db.brokerAuthorization.updateMany({ where: { userId, encryptedTokens: authorization.encryptedTokens, OR: [{ refreshLeaseUntil: null }, { refreshLeaseUntil: { lte: new Date() } }] }, data: { refreshLeaseUntil: new Date(Date.now() + 30000) } });
  check(claimed.count, 409, 'Coinbase authorization is refreshing. Try again shortly.');
  try {
    const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: saved.refresh_token });
    const updated = await db.brokerAuthorization.updateMany({ where: { userId, encryptedTokens: authorization.encryptedTokens }, data: { encryptedTokens: encrypt(JSON.stringify(refreshed)), expiresAt: new Date(Date.now() + refreshed.expires_in * 1000), refreshLeaseUntil: null } });
    check(updated.count, 409, 'This Coinbase connection was disconnected.');
    return refreshed.access_token;
  } catch (error) {
    // A refresh token is single-use. An uncertain exchange must be reauthorized,
    // rather than repeatedly exchanging a potentially consumed token.
    await db.brokerAuthorization.updateMany({ where: { userId, encryptedTokens: authorization.encryptedTokens }, data: { refreshLeaseUntil: new Date('9999-01-01T00:00:00Z') } });
    throw error;
  }
}

export const coinbaseRouter = Router();
coinbaseRouter.post('/start', auth, async (req, res) => {
  const { clientId } = credentials();
  const state = token(), verifier = randomBytes(48).toString('base64url');
  check(req.cookies?.ab_session, 401, 'Connect your wallet first.');
  await db.brokerOAuthState.deleteMany({ where: { OR: [{ userId: req.user!.id }, { expiresAt: { lte: new Date() } }] } });
  await db.brokerOAuthState.create({ data: { id: hash(state), userId: req.user!.id, sessionId: hash(req.cookies.ab_session), encryptedVerifier: encrypt(verifier), expiresAt: new Date(Date.now() + 600000) } });
  const url = new URL('https://login.coinbase.com/oauth2/auth');
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: new URL(callbackPath, env.appUrl).href, scope, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  res.cookie('wa_coinbase_state', state, cookieOptions).json({ url: url.href });
});

coinbaseRouter.get('/callback', async (req, res) => {
  try {
    const state = z.string().regex(/^[a-f0-9]{64}$/).parse(req.query.state);
    check(typeof req.cookies?.wa_coinbase_state === 'string' && hash(req.cookies.wa_coinbase_state) === hash(state), 403, 'Coinbase authorization state did not match this browser.');
    const saved = await db.brokerOAuthState.findUnique({ where: { id: hash(state) } });
    check(saved && saved.expiresAt > new Date(), 403, 'Coinbase authorization expired.');
    const session = await db.session.findUnique({ where: { id: saved.sessionId }, include: { user: true } });
    check(session && session.userId === saved.userId && session.expiresAt > new Date() && !session.user.disabled, 403, 'The original wallet session is no longer active.');
    if (req.user) check(req.user.id === saved.userId, 403, 'The connected wallet changed during authorization.');
    const consumed = await db.brokerOAuthState.deleteMany({ where: { id: saved.id, expiresAt: { gt: new Date() } } });
    check(consumed.count === 1, 403, 'Coinbase authorization was already used.');
    check(!req.query.error, 400, 'Coinbase authorization was declined.');
    const code = z.string().min(1).max(4096).parse(req.query.code);
    const tokens = await exchange({ grant_type: 'authorization_code', code, redirect_uri: new URL(callbackPath, env.appUrl).href, code_verifier: decrypt(saved.encryptedVerifier) });
    check(tokens.scope?.split(/[ ,]+/).includes(scope), 403, 'Coinbase account-read permission was not granted.');
    await transaction(async tx => {
      await lockUser(tx, saved.userId);
      const activeSession = await tx.session.findUnique({ where: { id: saved.sessionId } });
      check(activeSession && activeSession.expiresAt > new Date(), 403, 'Your wallet session ended during authorization.');
      const data = { encryptedTokens: encrypt(JSON.stringify(tokens)), scope: tokens.scope!, expiresAt: new Date(Date.now() + tokens.expires_in * 1000), refreshLeaseUntil: null, connectedAt: new Date() };
      await tx.brokerAuthorization.upsert({ where: { userId: saved.userId }, create: { userId: saved.userId, ...data }, update: data });
    });
    res.clearCookie('wa_coinbase_state', cookieOptions).redirect(303, '/connections?coinbase=connected');
  } catch {
    // Never send OAuth codes, token responses, or provider error details to the UI.
    res.clearCookie('wa_coinbase_state', cookieOptions).redirect(303, '/connections?coinbase=failed');
  }
});

coinbaseRouter.get('/accounts', auth, async (req, res) => {
  const access = await accessToken(req.user!.id);
  let response: Response;
  try { response = await fetch('https://api.coinbase.com/v2/accounts?limit=100', { headers: { Authorization: `Bearer ${access}` }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new AppError(502, 'Coinbase balances are temporarily unavailable.'); }
  check(response.ok, 502, 'Coinbase could not return balances. You may need to reconnect.');
  const accounts = z.object({ data: z.array(z.object({ name: z.string(), balance: z.object({ amount: z.string(), currency: z.string() }) })).max(100) }).safeParse(await response.json());
  check(accounts.success, 502, 'Coinbase returned an unsupported balance response.');
  res.json({ accounts: accounts.data.data, mode: 'READ_ONLY', liveTrading: false });
});
coinbaseRouter.post('/disconnect', auth, async (req, res) => {
  await transaction(async tx => {
    await lockUser(tx, req.user!.id);
    await tx.brokerAuthorization.deleteMany({ where: { userId: req.user!.id } });
    await tx.brokerOAuthState.deleteMany({ where: { userId: req.user!.id } });
  });
  res.clearCookie('wa_coinbase_state', cookieOptions).json({ ok: true, message: 'Coinbase disconnected from Wagent Ai. You can also revoke the application in your Coinbase account settings.' });
});
