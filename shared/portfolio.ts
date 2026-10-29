export type PortfolioSource = 'TRADING' | 'OWNER';
export type PortfolioHolding = {
  mint: string; name: string | null; symbol: string | null; amount: string; rawAmount: string; decimals: number;
  priceUsd: number | null; valueUsd: number | null; change24h: number | null; liquidityUsd: number | null; screenerUrl: string | null;
};
export type Portfolio = {
  source: PortfolioSource; wallet: {address:string;ownerAddress:string}|null; balancesAt: string; pricesAt: string|null; pricesStale: boolean; pricingError: string|null;
  sol: PortfolioHolding; tokens: PortfolioHolding[]; totalUsd: number|null; unpricedCount: number;
  tradingEnabled: boolean; stopped: boolean; history: {id:string;side:string;mint:string;symbol:string|null;amount:string;status:string;signature:string|null;createdAt:string;kind:'CHAT'|'SWAP'}[];
};
