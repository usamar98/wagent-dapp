import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db, transaction, lockUser } from './db.js';
import { AppError, auth } from './security.js';
import { rateLimitKey } from './rate-limit.js';
import { isSolanaAddress, type SolanaToken, type TokenFeed } from '../shared/solana.js';

const address = z.string().refine(isSolanaAddress, 'Enter a 32-byte Solana mint address.');
const tokenIdentity = z.object({ address: z.string(), name: z.string().max(200), symbol: z.string().max(80) });
const metric = z.number().finite().nonnegative().nullable().optional();
const pairSchema = z.object({
  chainId: z.string(), pairAddress: z.string(), dexId: z.string().max(80), baseToken: tokenIdentity,
  priceUsd: z.string().max(80).nullable().optional(),
  priceChange: z.object({ h24: z.number().finite().nullable().optional() }).nullable().optional(),
  volume: z.object({ h24: metric }).nullable().optional(),
  liquidity: z.object({ usd: metric }).nullable().optional(), marketCap: metric,
  pairCreatedAt: z.number().int().positive().nullable().optional(),
});
export function normalizePairs(input: unknown, mints?: string[]): SolanaToken[] {
  const pairs = z.array(z.unknown()).max(2000).parse(input);
  const selected = new Map<string, SolanaToken>();
  for (const raw of pairs) {
    const parsed = pairSchema.safeParse(raw);
    if (!parsed.success) continue;
    const p = parsed.data, mint = p.baseToken.address;
    if (p.chainId !== 'solana' || !isSolanaAddress(mint) || !isSolanaAddress(p.pairAddress) || (mints && !mints.includes(mint))) continue;
    const price = p.priceUsd == null ? null : Number(p.priceUsd);
    const item: SolanaToken = {
      mint, pairAddress: p.pairAddress, name: p.baseToken.name, symbol: p.baseToken.symbol, dex: p.dexId,
      priceUsd: price !== null && Number.isFinite(price) && price > 0 ? price : null,
      change24h: p.priceChange?.h24 ?? null, volume24h: p.volume?.h24 ?? null,
      liquidityUsd: p.liquidity?.usd ?? null, marketCap: p.marketCap ?? null,
      pairCreatedAt: p.pairCreatedAt && p.pairCreatedAt <= Date.now() ? p.pairCreatedAt : null,
      screenerUrl: `https://dexscreener.com/solana/${p.pairAddress}`,
    };
    const previous = selected.get(mint);
    if (!previous || (item.liquidityUsd ?? -1) > (previous.liquidityUsd ?? -1)) selected.set(mint, item);
  }
  return [...selected.values()];
}

async function upstream(path: string): Promise<unknown> {
  try {
    const response = await fetch(`https://api.dexscreener.com${path}`, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Provider unavailable');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing provider response');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 3_000_000) throw new Error('Provider response too large');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new AppError(502, 'Token data is temporarily unavailable. Retry shortly; no sample prices are substituted.'); }
}

const cache = new Map<string, { saved: number; feed: TokenFeed }>();
const pending = new Map<string, Promise<TokenFeed>>();
export function clearTokenCache() { cache.clear(); pending.clear(); }
export async function discoverTokens(query = '', mints?: string[]): Promise<TokenFeed> {
  const key = mints ? `mints:${[...mints].sort().join(',')}` : `search:${query}`;
  const saved = cache.get(key);
  if (saved && Date.now() - saved.saved < 60000) return saved.feed;
  if (pending.has(key)) return pending.get(key)!;
  const request = (async () => {
    try {
      let raw: unknown, exact = mints;
      if (mints) raw = mints.length ? await upstream(`/tokens/v1/solana/${mints.join(',')}`) : [];
      else if (isSolanaAddress(query)) { exact = [query]; raw = await upstream(`/tokens/v1/solana/${query}`); }
      else if (query) raw = z.object({ pairs: z.array(z.unknown()).nullable() }).parse(await upstream(`/latest/dex/search?q=${encodeURIComponent(query)}`)).pairs || [];
      else {
        const profiles = z.array(z.object({ chainId: z.string(), tokenAddress: z.string() })).max(1000).parse(await upstream('/token-profiles/latest/v1'));
        exact = [...new Set(profiles.filter(p => p.chainId === 'solana' && isSolanaAddress(p.tokenAddress)).map(p => p.tokenAddress))].slice(0, 30);
        raw = exact.length ? await upstream(`/tokens/v1/solana/${exact.join(',')}`) : [];
      }
      const tokens = normalizePairs(raw, exact).sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0)).slice(0, 60);
      const feed: TokenFeed = { tokens, source: 'DEX Screener', fetchedAt: new Date().toISOString(), stale: false, coverage: 'Latest Solana token profiles and their most liquid indexed pools. Not a complete launch feed; pool age is not token mint age.' };
      if (cache.size >= 80) cache.delete(cache.keys().next().value!);
      cache.set(key, { saved: Date.now(), feed });
      return feed;
    } catch (error) {
      if (saved && Date.now() - saved.saved < 300000) return { ...saved.feed, stale: true };
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'The token-data provider returned an unsupported response. Please retry shortly.');
    }
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export const solanaRouter = Router();
solanaRouter.get('/tokens', rateLimit({ windowMs: 60000, limit: 40, keyGenerator: rateLimitKey, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
  // Vercel's catch-all rewrite injects `path`; it is routing metadata, never an upstream parameter.
  const { path: _rewrittenPath, ...query } = req.query;
  const input = z.object({ q: z.string().trim().max(80).optional(), mints: z.string().max(1400).optional() }).strict().parse(query);
  const mints = input.mints === undefined ? undefined : z.array(address).max(30).parse(input.mints ? input.mints.split(',') : []);
  const feed = await discoverTokens(input.q, mints ? [...new Set(mints)] : undefined);
  res.json(feed);
});
const watchKey = (userId: string) => `solana:watchlist:${userId}`;
solanaRouter.get('/watchlist', auth, async (req, res) => {
  const saved = await db.setting.findUnique({ where: { key: watchKey(req.user!.id) } });
  res.json({ mints: saved ? z.array(address).max(30).parse(JSON.parse(saved.value)) : [] });
});
solanaRouter.post('/watchlist', auth, async (req, res) => {
  const input = z.object({ mint: address, watched: z.boolean() }).strict().parse(req.body);
  const mints = await transaction(async tx => {
    const userId = req.user!.id; await lockUser(tx, userId);
    const key = watchKey(userId), saved = await tx.setting.findUnique({ where: { key } });
    const current = new Set<string>(saved ? z.array(address).max(30).parse(JSON.parse(saved.value)) : []);
    if (input.watched) current.add(input.mint); else current.delete(input.mint);
    if (current.size > 30) throw new AppError(400, 'Your watchlist can hold up to 30 Solana tokens.');
    const value = JSON.stringify([...current]);
    await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return [...current];
  });
  res.json({ mints });
});
