// A mint identifies a token; a ticker alone does not prove which chain it belongs to.
export function isSolanaAddress(value: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(alphabet.indexOf(character));
  let bytes = 0;
  while (number > 0n) { bytes++; number >>= 8n; }
  return bytes + (value.match(/^1*/)?.[0].length || 0) === 32;
}

export const solanaSymbols = ['SOL/USD', 'BONK/USD', 'JUP/USD', 'WIF/USD'] as const;
export const isSolanaAsset = (value: string) => solanaSymbols.includes(value as typeof solanaSymbols[number]) || isSolanaAddress(value);
export type SolanaToken = {
  mint: string; pairAddress: string; name: string; symbol: string; dex: string;
  priceUsd: number | null; change24h: number | null; volume24h: number | null;
  liquidityUsd: number | null; marketCap: number | null; pairCreatedAt: number | null;
  screenerUrl: string;
};
export type TokenFeed = { tokens: SolanaToken[]; fetchedAt: string; stale: boolean; source: 'DEX Screener'; coverage: string };
