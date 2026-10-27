import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db, transaction, lockUser, type Tx } from './db.js';
import { auth, check, hash, token } from './security.js';
import { env } from './env.js';
import { rateLimitKey } from './rate-limit.js';
import { configSchema } from '../shared/config.js';
import { SOL_MINT, addressSchema, atomicAmount, humanAmount, providerStatus } from './solana-providers.js';
import { verifySolanaSignature } from './solana-swaps.js';
import { createTradingKey } from './trading-wallet-keys.js';
import type { ModelRows } from './database/schema.js';
import { websiteOrigin } from './website-runtime.js';

export type TradePermission = ModelRows['SolanaTradePermission'];
export const chatTradingEnabled = () => !env.demo && providerStatus().swapsEnabled && process.env.SOLANA_CHAT_TRADING_ENABLED !== 'false';
export const unresolvedChatTrades = ['PREPARING','PREPARED','EXECUTING','UNKNOWN'];
export function consentWebsite(message:string,origin:string){return message.includes(`\nWebsite: ${websiteOrigin(origin)}\n`);}
async function channelOrigin(tx:Tx,channel:{appUrl:string|null}){return websiteOrigin(channel.appUrl||(await tx.setting.findUnique({where:{key:'wagent:production-origin'}}))?.value||env.appUrl);}
async function permissionWebsite(tx:Tx,channel:{appUrl:string|null}){const origin=await channelOrigin(tx,channel);check(origin===websiteOrigin(env.appUrl),409,`Manage this connection's trading permission at ${origin}/chat-trading.`);return origin;}
export async function revokeTrading(tx: Tx, userId: string, reason: string) {
  await tx.solanaTradePermission.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
  await tx.solanaPermissionChallenge.deleteMany({ where: { userId, purpose: 'GRANT' } });
  await tx.solanaChatTrade.updateMany({ where: { userId, status: 'PREPARING' }, data: { status: 'CANCELLED', error: reason } });
  await tx.agentCommand.updateMany({ where: { userId, status: 'TRADE_QUEUED' }, data: { status: 'REJECTED', reply: `NOT EXECUTED · ${reason}` } });
}
export async function permissionSession(tx: Tx, req: Request, allowStopped = false) {
  const userId = req.user!.id; await lockUser(tx, userId);
  const [user, session] = await Promise.all([tx.user.findUnique({ where: { id: userId } }), tx.session.findUnique({ where: { id: hash(req.cookies?.ab_session || '') } })]);
  check(user && !user.disabled && session?.userId === userId && session.expiresAt > new Date(), 401, 'Sign in again before changing trading permissions.');
  check(allowStopped || !user.emergencyStop, 409, 'Clear emergency stop before enabling chat trading.');
  return userId;
}
export async function tradingContext(tx: Tx, userId: string) {
  const [user, owner, channel, workspace, wallet] = await Promise.all([
    tx.user.findUnique({ where: { id: userId } }), tx.solanaWallet.findUnique({ where: { userId } }),
    tx.personalAgentChannel.findUnique({ where: { userId } }), tx.tradingWorkspace.findUnique({ where: { userId } }), tx.solanaTradingWallet.findUnique({ where: { userId } }),
  ]);
  check(user && !user.disabled && !user.emergencyStop, 409, 'Trading is stopped or the account is unavailable.');
  check(owner, 409, 'Link your own Solana wallet in Buy & sell first.');
  check(channel?.enabled && channel.ownerId, 409, 'Pair your personal WhatsApp agent first.');
  check(workspace?.activeInstanceId, 409, 'Choose your saved agent in Connections first.');
  const instance = await tx.instance.findFirst({ where: { id: workspace.activeInstanceId, userId }, include: { version: { include: { agent: true } } } });
  check(instance?.version.agent.creatorId === userId, 409, 'Choose a private agent you created.');
  const config = configSchema.parse(instance.version.config);
  if (wallet) check(wallet.ownerAddress === owner.address, 409, 'The linked wallet must match the original trading-wallet owner. Withdrawals require that original owner.');
  return { user, owner, channel, instance, wallet, mints: config.symbols.filter(m => addressSchema.safeParse(m).success && m !== SOL_MINT) };
}
export async function validateTradePermission(tx: Tx, userId: string, permissionId: string, executionOrigin=env.appUrl) {
  const context = await tradingContext(tx, userId), permission = await tx.solanaTradePermission.findFirst({ where: { id: permissionId, userId, revokedAt: null } });
  check(permission && permission.expiresAt > new Date(), 409, 'Chat trading permission expired or was revoked. Approve a new permission on the website.');
  check(consentWebsite(permission.consentMessage,executionOrigin)&&await channelOrigin(tx,context.channel)===websiteOrigin(executionOrigin),409,'This trading permission belongs to a different website. Sign a new permission on the connected website.');
  check(context.wallet && permission.tradingAddress === context.wallet.address && permission.ownerAddress === context.owner.address, 409, 'Trading wallet ownership changed.');
  check(permission.channelId === context.channel.id && permission.channelFingerprint === context.channel.tokenFingerprint && permission.channelOwnerId === context.channel.ownerId && context.channel.createdAt <= permission.createdAt, 409, 'The approved WhatsApp connection changed. Authorize it again.');
  check(permission.instanceId === context.instance.id && permission.allowedMints.every(m => context.mints.includes(m)), 409, 'The approved agent changed. Authorize it again.');
  return { ...context, wallet: context.wallet, permission };
}
export async function dailyTradingUsage(tx: Tx, userId: string, excludeId = '') {
  const day = new Date(); day.setUTCHours(0,0,0,0);
  const rows = await tx.sql<{ amount: string }>`SELECT COALESCE(SUM("budgetLamports"::numeric),0)::text AS amount FROM "SolanaChatTrade" WHERE "userId"=${userId} AND id<>${excludeId} AND "createdAt">=${day} AND status IN ('PREPARED','EXECUTING','UNKNOWN','CONFIRMED','FAILED')`;
  return BigInt(rows[0].amount);
}
const permissionInput = z.object({
  allowedMints: z.array(addressSchema).min(1).max(10), perTradeSol: z.string().max(20), dailySol: z.string().max(20), maxFeeSol: z.string().max(20),
  slippageBps: z.number().int().min(1).max(200), durationHours: z.number().int().min(1).max(168), consent: z.literal(true),
}).strict();
export const permissionProofInput = z.object({ id: z.uuid(), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict();
export const solanaPermissionsRouter = Router();
solanaPermissionsRouter.use((req,res,next) => req.path === '/chat-trading' || req.path.startsWith('/chat-trading/') ? auth(req,res,next) : next('router'));
solanaPermissionsRouter.use(rateLimit({ windowMs: 60000, limit: 45, keyGenerator: rateLimitKey, standardHeaders: 'draft-8', legacyHeaders: false }));
solanaPermissionsRouter.use((_req,res,next) => { res.set('Cache-Control','no-store'); next(); });
solanaPermissionsRouter.get('/chat-trading', async (req,res) => {
  const userId = req.user!.id;
  const [wallet, permission, trades, withdrawals, channel, workspace, linked, worker] = await Promise.all([
    db.solanaTradingWallet.findUnique({ where: { userId }, select: { address: true, ownerAddress: true, createdAt: true } }),
    db.solanaTradePermission.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    db.solanaChatTrade.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    db.solanaWalletWithdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    db.personalAgentChannel.findUnique({ where: { userId }, select: { id: true, appUrl: true, ownerId: true, enabled: true, tokenFingerprint: true, createdAt: true } }),
    db.tradingWorkspace.findUnique({ where: { userId } }), db.solanaWallet.findUnique({ where: { userId } }), db.setting.findUnique({ where: { key: 'workerHeartbeat' } }),
  ]);
  const instance = workspace?.activeInstanceId ? await db.instance.findFirst({ where: { id: workspace.activeInstanceId, userId }, include: { version: true } }) : null;
  const config = instance ? configSchema.safeParse(instance.version.config) : null;
  const availableMints = config?.success ? config.data.symbols.filter(m => addressSchema.safeParse(m).success && m !== SOL_MINT) : [];
  const sameWebsite=channel?await channelOrigin(db,channel)===websiteOrigin(env.appUrl):false;
  const active = !!permission && sameWebsite && consentWebsite(permission.consentMessage,env.appUrl) && !permission.revokedAt && permission.expiresAt > new Date() && !req.user!.emergencyStop && linked?.address === wallet?.ownerAddress && !!channel?.enabled && permission.channelId === channel.id && permission.channelFingerprint === channel.tokenFingerprint && permission.channelOwnerId === channel.ownerId && channel.createdAt <= permission.createdAt && permission.instanceId === instance?.id && permission.allowedMints.every(m => availableMints.includes(m));
  const used = await dailyTradingUsage(db,userId);
  res.json({ wallet, permission: permission ? { id: permission.id, active, allowedMints: permission.allowedMints, perTradeSol: humanAmount(permission.perTradeLamports,9), dailySol: humanAmount(permission.dailyLamports,9), maxFeeSol: humanAmount(permission.maxFeeLamports,9), slippageBps: permission.slippageBps, expiresAt: permission.expiresAt, revokedAt: permission.revokedAt, revokeReason: permission.revokeReason } : null, availableMints, paired: !!channel?.ownerId && channel.enabled, usedTodaySol: humanAmount(used.toString(),9), trades, withdrawals, workerOnline: !!worker && Date.now() - Number(worker.value) < 30000, enabled: chatTradingEnabled() });
});
solanaPermissionsRouter.post('/chat-trading/wallet', async (req,res) => {
  z.object({ consent: z.literal(true) }).strict().parse(req.body);
  const wallet = await transaction(async tx => {
    const userId = await permissionSession(tx,req); const context = await tradingContext(tx,userId);
    if (context.wallet) return context.wallet;
    return tx.solanaTradingWallet.create({ data: { userId, ownerAddress: context.owner.address, ...createTradingKey(userId) } });
  }); res.status(201).json({ address: wallet.address, ownerAddress: wallet.ownerAddress });
});
solanaPermissionsRouter.post('/chat-trading/challenge', async (req,res) => {
  check(chatTradingEnabled(),503,'Chat trading requires Jupiter swaps enabled on this website.');
  const input = permissionInput.parse(req.body), perTradeLamports = atomicAmount(input.perTradeSol,9), dailyLamports = atomicAmount(input.dailySol,9), maxFeeLamports = atomicAmount(input.maxFeeSol,9);
  check(BigInt(perTradeLamports) <= 10000000000n && BigInt(dailyLamports) <= 100000000000n && BigInt(dailyLamports) >= BigInt(perTradeLamports),400,'Per-trade budget must be at most 10 SOL; daily budget must cover it and be at most 100 SOL.');
  check(BigInt(maxFeeLamports) >= 5000n && BigInt(maxFeeLamports) <= 10000000n && BigInt(maxFeeLamports) < BigInt(perTradeLamports),400,'Fee/rent cap must be between 0.000005 and 0.01 SOL and below the per-trade budget.');
  const proof = await transaction(async tx => {
    const userId = await permissionSession(tx,req), context = await tradingContext(tx,userId);
    const origin=await permissionWebsite(tx,context.channel);
    check(context.wallet,409,'Create your dedicated trading wallet first.');
    const allowedMints = [...new Set(input.allowedMints)].sort();
    check(allowedMints.length === input.allowedMints.length && allowedMints.every(m => context.mints.includes(m)),400,'Choose unique exact mints from your selected agent.');
    const expiresAt = new Date(Date.now()+input.durationHours*3600000);
    const payload = { userId, channelId: context.channel.id, channelFingerprint: context.channel.tokenFingerprint, channelOwnerId: context.channel.ownerId, instanceId: context.instance.id, ownerAddress: context.owner.address, tradingAddress: context.wallet.address, allowedMints, perTradeLamports, dailyLamports, maxFeeLamports, slippageBps: input.slippageBps, expiresAt: expiresAt.toISOString() };
    const message = `${new URL(origin).host} · Wagent Ai WhatsApp trading permission\nWebsite: ${origin}\nAccount: ${userId}\nOwner wallet: ${context.owner.address}\nDedicated trading wallet: ${context.wallet.address}\nNetwork: solana:mainnet\nWhatsApp connection: ${context.channel.id}\nPaired owner: ${context.channel.ownerId}\nAgent instance: ${context.instance.id}\nAllowed mints: ${allowedMints.join(', ')}\nPer-trade total budget: ${humanAmount(perTradeLamports,9)} SOL\nDaily total budget (UTC): ${humanAmount(dailyLamports,9)} SOL\nFee/rent cap per trade: ${humanAmount(maxFeeLamports,9)} SOL\nSlippage cap: ${input.slippageBps/100}%\nProvider fee cap: 1%\nPermission expires: ${expiresAt.toISOString()}\n\nI authorize Wagent Ai to hold the encrypted signing key for this dedicated wallet and execute my explicit WhatsApp buy/sell commands without another wallet prompt. Limits are enforced by Wagent Ai software, not an on-chain spending contract. Buy SOL input or sell quoted SOL output plus the full reserved fee/rent cap counts toward both budgets. Failed and uncertain submissions retain their reservation. Updating permission does not reset daily usage. Only funds I deposit in the dedicated wallet are available. My main wallet is not authorized for spending. Revoke trading or Stop all blocks new submissions; transactions already submitted cannot be recalled.\nNonce: ${token()}`;
    return tx.solanaPermissionChallenge.upsert({ where: { userId_purpose: { userId, purpose: 'GRANT' } }, create: { userId, purpose: 'GRANT', sessionId: hash(req.cookies.ab_session), address: context.owner.address, message, payload, expiresAt: new Date(Date.now()+300000) }, update: { sessionId: hash(req.cookies.ab_session), address: context.owner.address, message, payload, expiresAt: new Date(Date.now()+300000) } });
  }); res.json({ id: proof.id, message: proof.message, address: proof.address });
});
solanaPermissionsRouter.post('/chat-trading/authorize', async (req,res) => {
  check(chatTradingEnabled(),503,'Chat trading is disabled.'); const input = permissionProofInput.parse(req.body);
  await transaction(async tx => {
    const userId = await permissionSession(tx,req), proof = await tx.solanaPermissionChallenge.findFirst({ where: { id: input.id, userId, purpose: 'GRANT', sessionId: hash(req.cookies.ab_session) } });
    check(proof && proof.expiresAt > new Date(),400,'Permission proof expired or was already used. Review your limits again.');
    check(verifySolanaSignature(proof.address,Buffer.from(proof.message),Buffer.from(input.signature,'base64')),400,'The permission signature is invalid.');
    const context = await tradingContext(tx,userId), p = proof.payload;
    check(consentWebsite(proof.message,await permissionWebsite(tx,context.channel)),409,'This permission was reviewed on a different website. Review it again.');
    check(context.wallet?.address === p.tradingAddress && context.owner.address === proof.address && context.channel.id === p.channelId && context.channel.tokenFingerprint === p.channelFingerprint && context.channel.ownerId === p.channelOwnerId && context.instance.id === p.instanceId && p.allowedMints.every((m:string) => context.mints.includes(m)) && new Date(p.expiresAt) > new Date(),409,'Your setup changed. Review and sign a new permission.');
    await revokeTrading(tx,userId,'Replaced by a newly signed permission.');
    await tx.solanaTradePermission.create({ data: { ...p, expiresAt: new Date(p.expiresAt), consentMessage: proof.message, signature: input.signature } });
  }); res.json({ ok: true });
});
solanaPermissionsRouter.post('/chat-trading/revoke', async (req,res) => {
  await transaction(async tx => { const userId = await permissionSession(tx,req,true); await revokeTrading(tx,userId,'Trading permission revoked by the account owner.'); }); res.json({ ok: true });
});
