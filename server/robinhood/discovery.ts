import { ETH_TOKEN, evmAddress, isEvmAddress, type RhToken } from '../../shared/robinhood.js';

export const RH_DISCOVERY_LIMIT = 600;
const ZERO_ADDRESS = '0x' + '0'.repeat(40);
const profileFeeds = [
  '/token-profiles/latest/v1',
  '/token-profiles/recent-updates/v1',
  '/token-boosts/latest/v1',
  '/token-boosts/top/v1',
  '/community-takeovers/latest/v1',
  '/ads/latest/v1',
];
const marketQueries = [
  'robinhood ETH', 'robinhood WETH', 'robinhood USDC', 'robinhood USDG',
  'robinhood USDT', 'robinhood USD', 'robinhood BTC', 'robinhood WBTC',
  'robinhood HOOD', 'robinhood SOL', 'robinhood PEPE', 'robinhood DOGE',
  'robinhood token', 'robinhood new', 'robinhood',
];
type GetJson = (path: string, signal: AbortSignal) => Promise<unknown>;
type Pair = Record<string, any>;

function tokenAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !isEvmAddress(value)) return null;
  const address = evmAddress(value);
  return address === ZERO_ADDRESS || address === ETH_TOKEN ? null : address;
}
const positive = (value: unknown) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const clean = (value: unknown, length: number) => (typeof value === 'string' ? value : '').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, length);

export function normalizeRhPairs(raw: unknown, addresses?: string[]): RhToken[] {
  if (!Array.isArray(raw) || raw.length > 10000) throw Error('Unsupported DEX Screener response.');
  const allowed = addresses && new Set(addresses.map(evmAddress));
  const selected = new Map<string, { token: RhToken; base: boolean }>();
  for (const pair of raw as Pair[]) {
    if (pair?.chainId !== 'robinhood' || typeof pair.pairAddress !== 'string' || !/^0x(?:[\da-fA-F]{40}|[\da-fA-F]{64})$/.test(pair.pairAddress)) continue;
    for (const side of ['baseToken', 'quoteToken'] as const) {
      const address = tokenAddress(pair[side]?.address);
      if (!address || allowed && !allowed.has(address)) continue;
      const base = side === 'baseToken';
      const usd = base ? positive(pair.priceUsd) : null;
      const token: RhToken = {
        address, name: clean(pair[side].name, 160), symbol: clean(pair[side].symbol, 40),
        // Base-token prices and changes must never be assigned to a quote token.
        priceUsd: usd === 0 ? null : usd,
        liquidityUsd: positive(pair.liquidity?.usd), volume24h: positive(pair.volume?.h24),
        change24h: base && typeof pair.priceChange?.h24 === 'number' && Number.isFinite(pair.priceChange.h24) ? pair.priceChange.h24 : null,
        pairCreatedAt: Number.isSafeInteger(pair.pairCreatedAt) && pair.pairCreatedAt > 0 && pair.pairCreatedAt <= Date.now() ? pair.pairCreatedAt : null,
        pairAddress: pair.pairAddress, screenerUrl: `https://dexscreener.com/robinhood/${pair.pairAddress}`,
      };
      const previous = selected.get(address);
      if (!previous || base && !previous.base || base === previous.base && (token.liquidityUsd ?? -1) > (previous.token.liquidityUsd ?? -1)) selected.set(address, { token, base });
    }
  }
  return [...selected.values()].map(value => value.token);
}

async function bounded<T>(items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

/** Public, documented endpoints only. No signing, paid indexer, or API key. */
export async function discoverRhTokens(get: GetJson, knownAddresses: string[] = [], query = '') {
  const signal = AbortSignal.timeout(18000);
  const pairs: Pair[] = [], candidates = new Set<string>();
  let checked = 0, available = 0, failed = 0, truncated = false;
  const add = (value: unknown) => {
    const address = tokenAddress(value);
    if (!address || candidates.has(address)) return;
    if (candidates.size < RH_DISCOVERY_LIMIT) candidates.add(address); else truncated = true;
  };
  const acceptPairs = (raw: unknown) => {
    if (!Array.isArray(raw) || raw.length > 3000) throw Error('Unsupported pool response.');
    for (const pair of raw) {
      if (pair?.chainId !== 'robinhood') continue;
      if (pairs.length >= 10000) { truncated = true; break; }
      pairs.push(pair); add(pair.baseToken?.address); add(pair.quoteToken?.address);
    }
  };
  const read = async (path: string, kind: 'profiles' | 'search' | 'pairs') => {
    checked++;
    try {
      if (signal.aborted) throw Error('Discovery deadline reached.');
      const raw = await get(path, signal);
      if (kind === 'profiles') {
        if (!Array.isArray(raw) || raw.length > 2000) throw Error('Unsupported discovery response.');
        for (const item of raw) if (item?.chainId === 'robinhood') add(item.tokenAddress);
      } else acceptPairs(kind === 'search' ? (raw as { pairs?: unknown })?.pairs : raw);
      available++;
    } catch { failed++; }
  };
  const searches = query ? [...new Set([query, `robinhood ${query}`])] : marketQueries;
  await bounded([
    ...(!query ? profileFeeds.map(path => ({ path, kind: 'profiles' as const })) : []),
    ...searches.map(text => ({ path: '/latest/dex/search?q=' + encodeURIComponent(text), kind: 'search' as const })),
  ], item => read(item.path, item.kind));

  if (!query && !signal.aborted) {
    // Discover counterpart tokens around the most common quote assets, including
    // tokens that appear on the quote side of an indexed pool.
    const quoteFrequency = new Map<string, number>();
    for (const pair of pairs) {
      const address = tokenAddress(pair.quoteToken?.address);
      if (address) quoteFrequency.set(address, (quoteFrequency.get(address) || 0) + 1);
    }
    const anchors = [...quoteFrequency].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([address]) => address);
    await bounded(anchors, address => read('/token-pairs/v1/robinhood/' + address, 'pairs'));
    // Re-query previously observed tokens, rather than discarding them whenever
    // they leave a global latest-profile list. Old prices are never reused here.
    knownAddresses.forEach(add);
  }
  const addresses = [...candidates];
  const batches: string[][] = [];
  for (let i = 0; i < addresses.length; i += 30) batches.push(addresses.slice(i, i + 30));
  await bounded(batches, batch => read('/tokens/v1/robinhood/' + batch.join(','), 'pairs'));
  if (!available) throw Error('Robinhood token discovery is temporarily unavailable. Please try again.');
  const tokens = normalizeRhPairs(pairs, [...candidates]).sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1)).slice(0, RH_DISCOVERY_LIMIT);
  // Let the caller retain a labelled cached feed when market reads all failed.
  if (!tokens.length && failed) throw Error('Robinhood token discovery is temporarily unavailable. Please try again.');
  return { tokens, discovery: { candidates: candidates.size, checked, available, partial: failed > 0 || truncated, limit: RH_DISCOVERY_LIMIT } };
}
