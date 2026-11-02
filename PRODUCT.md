# Wagent Ai

## Register
product

## Users and purpose
People create private Robinhood Chain token agents, pair their own WhatsApp agent, and use an original EVM owner account from MetaMask, Binance Wallet or Phantom. A distinct server-managed trading wallet holds only explicitly deposited native ETH and ERC-20 tokens on chain 4663. An exchange balance and an old Solana account are separate assets and authority.

## Available features
Private agents; WhatsApp ownership pairing; DEX Screener discovery, watchlists, price/liquidity alerts; Alchemy on-chain balances and portfolio; 0x exact-input buying and selling; fresh owner-signed website trades; opt-in WhatsApp trading with per-operation and UTC daily budgets, gas cap, token scope, expiry and revoke; independent native ETH withdrawal permission with a fixed original owner recipient and a two-minute confirmation code; owner-signed ETH/ERC-20 recovery; read-only history and confirmation checks.

Provider credentials are server-only and missing credentials show setup required. Use free API plans only; network, pool and applicable 0x fees and positive trade surplus remain user-paid. Quotas apply, and this app never provisions or upgrades a subscription. Discovery combines six public DEX Screener feeds, chain-focused market searches and pool expansion, with up to 600 candidate token addresses per bounded scan. Results include sorting, pool-age and liquidity filters, counts and pagination. Earlier observations are re-queried while cached, and partial or cached results are labelled. This is indexed coverage, not every new launch. A listing is not a safety endorsement. Marketplace and exit automation remain Coming soon. No DEXTools, Coinbase or Birdeye integration is required for this release.

## Authority and preservation
EVM wallet keys, integer wei budgets and signed permissions are independent from legacy Solana wallets, lamports and signatures. Migration revokes old Solana advance grants without changing keys, addresses, transactions or balances. The Legacy Solana recovery page, navigation and product links have been removed at the owner’s request. Stored wallets and signed records remain intact; compatibility APIs preserve access to old records. No balances are bridged or converted automatically. Users must fund Robinhood Chain ETH and sign fresh network-specific permissions.

Wagent holds the encrypted dedicated-wallet key. Limits are enforced by the application, not an on-chain spending contract. Pairing, discovery and a deposit never grant trading access. Trading grants never grant withdrawals. Unknown submissions are checked read-only and never automatically resent. Status belongs to the exact attempted request, not an unrelated historical receipt. WhatsApp receipts distinguish quotes from receipt-derived net token transfers, show token name/ticker, quoted output and 0x fee, slippage, actual execution gas when available, block and portfolio/explorer links. Missing receipt fields are not fabricated. Revocation, emergency stop, expiry and changed chat/agent identity block new sends.

Production polling uses the existing Supabase Cron and protected Vercel worker, fenced leases and bounded batches, independently of the user's computer. Provider and hosting availability and quotas apply. Isolated legacy demos retain paper execution.

## Brand and design principles
Calm, precise and independent. Preserve the original W logo, dark violet surfaces, violet primary actions and restrained green state accents. Lead with creation, pairing, owner verification, ETH funding and explicit permission. Keep the chain, token address, ticker, liquidity, data age and execution state visible. No fabricated prices, balances, returns, AI capabilities or profitability promises. Keyboard navigation, semantic controls, visible focus, readable contrast and responsive mobile layouts are required.
