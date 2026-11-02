# Wagent Ai

A Robinhood Chain agent workspace connected to the user's personal WhatsApp agent. React, Vite, TypeScript, Express and Supabase PostgreSQL through pg. Prisma is not used. Mainnet chain ID **4663**, currency **ETH**.

## Available now

- Private versioned agents and wallet-message workspace sign-in.
- Creator-only WhatsApp pairing, encrypted personal keys, manual sync and cloud polling independent of the owner's computer.
- DEX Screener Robinhood discovery, exact-address research, private watchlists, price and liquidity alerts.
- Separate encrypted EVM trading wallets, original-owner verification, reviewed ETH deposits and **Add ETH** top ups in Portfolio.
- Reviewed 0x buying/selling, executable minimum-output checks, gas caps and fee disclosure.
- Advance WhatsApp trading for any supported Robinhood token or a selected list, with per-operation and UTC daily budgets, expiry, slippage, revoke and emergency stop.
- On-chain portfolios, original tickers, value estimates, sell actions and transaction history for the trading wallet or original owner.
- Balance, Portfolio, Token details, Trade history, My limits and read-only status commands in WhatsApp.
- Separate native-ETH WhatsApp withdrawal permission, fixed original recipient, limits, expiry and a single-use two-minute confirmation code.
- Fresh owner-signed website ETH/ERC-20 recovery.
- Detailed WhatsApp receipts with token identity, quoted output, slippage, quoted 0x fees, receipt-derived token changes, gas paid, block, portfolio link and transaction references.

## Provider configuration

Keep DATABASE_URL, the **original CREDENTIAL_ENCRYPTION_KEY**, APP_URL and DEMO_MODE=false. Add server-only **ROBINHOOD_RPC_URL** (free-plan Alchemy Robinhood mainnet HTTPS endpoint) and **ZEROX_API_KEY** (0x key under your chosen no-subscription plan), then redeploy. See [complete setup](docs/ROBINHOOD.md) and robinhood.env.example.

Missing credentials show Provider setup required and block live swaps. DEX Screener requires no key. No AI, Coinbase, DEXTools, Birdeye, Robinhood brokerage or Binance Exchange API key is needed. Each user supplies their own personal WhatsApp agent key in Connections.

No paid subscription, gas sponsor or automatic provider upgrade is configured. Free access has quotas. ETH gas, pool costs and applicable 0x fees are paid by users; 0x may collect positive trade surplus.

## Run and verify

Use Node.js 22.12+ and npm ci. Preserve the existing ignored .env.supabase.local and encryption key. Add the Robinhood variables, run npm run db:migrate:supabase, then npm run dev:supabase. The existing cloud schedule handles WhatsApp and alerts. Use npm run dev only when deliberately starting an additional local worker.

Run **npm test** and **npm run build**. Tests use isolated embedded PostgreSQL and mocked providers, never funded production wallets. Apply committed SQL migrations before deploying. The new migration retires advance Solana permission while preserving owner-signed recovery.

## Controls and limitations

Sign-in, pairing and deposits grant no spending authority. Wagent stores dedicated-wallet keys encrypted and enforces limits in software, not an on-chain spending contract. A service or encryption-key compromise could put deposited funds at risk. Main-wallet private keys are never requested. Personal agent chats are not end-to-end encrypted.

Unknown submissions are never automatically repeated. A token approval is identified separately from a swap. Unsupported route layouts are rejected. Discovery is limited to indexed profiles and pools; it is not every new launch. Missing prices remain unavailable; a partial token index is labelled.

Automatic stop-loss/take-profit, volume alerts, advanced AI and marketplace licensing remain coming soon.

See [commands](docs/WHATSAPP-COMMANDS.md), [cloud operations](docs/CLOUD-WORKER.md) and [Supabase](docs/SUPABASE.md).
