export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_HEX = '0x1237';
export const ROBINHOOD_NAME = 'Robinhood Chain';
export const ETH_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
export const RH_EXPLORER = 'https://robinhoodchain.blockscout.com';
export const isEvmAddress = (value: string) => /^0x[\da-fA-F]{40}$/.test(value);
export function evmAddress(value: string) { if (!isEvmAddress(value)) throw new Error('Enter a complete 0x token or wallet address.'); return value.toLowerCase(); }
export function weiAmount(value: string, decimals = 18) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !/^\d{1,40}(?:\.\d{1,36})?$/.test(value)) throw new Error('Enter a positive decimal amount.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error(`This asset supports ${decimals} decimal places.`);
  const amount = BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (amount <= 0n || amount >= 2n ** 256n) throw new Error('Amount is outside the supported range.');
  return amount;
}
export function fromWei(value: string | bigint, decimals = 18) {
  const amount = BigInt(value), negative = amount < 0n, digits = (negative ? -amount : amount).toString().padStart(decimals + 1, '0');
  const result = decimals ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/\.?0+$/, '') : digits;
  return `${negative ? '-' : ''}${result}`;
}
export type RhToken = { address: string; name: string; symbol: string; decimals?: number; priceUsd: number | null; liquidityUsd: number | null; volume24h: number | null; change24h: number | null; pairCreatedAt: number | null; pairAddress: string; screenerUrl: string };
export type RhFeed = { tokens: RhToken[]; fetchedAt: string; stale: boolean; source: string; coverage: string; discovery?: { candidates: number; checked: number; available: number; partial: boolean; limit: number } };
