# Wagent Ai

A Solana-only agent workspace. Create a private token configuration, pair your personal WhatsApp agent, research Solana pools with DEX Screener, and save a private mint-address watchlist. React, Vite, TypeScript, Express, and Supabase PostgreSQL through pg. Prisma is not used.

## Available now

- MetaMask message sign-in for workspace identity. This does not connect a Solana trading wallet.
- Private agent creation with 1–10 Solana token mints.
- Agent selection, encrypted personal WhatsApp keys, one-time ownership pairing, manual sync, and background polling.
- Real Solana token discovery and mint search from DEX Screener, refreshed every 60 seconds.
- Liquidity filtering, pool age, volume, mint copying, and direct DEX Screener research links.
- Private account-scoped watchlists stored in Supabase, with up to 30 mints.
- Activity history, ownership isolation, and emergency stop.
- Jupiter exact-input SOL/token swaps with one-use Solana wallet ownership proofs, a review screen, and wallet approval for every transaction.
- Optional WhatsApp-only trading from a separately funded, server-managed wallet: signed advance permission, approved mints, per-trade/daily SOL budgets, fee and slippage caps, expiry, and revoke access. Owner-signed SOL/token withdrawals return funds to the original owner wallet. See [WhatsApp trading](docs/WHATSAPP-TRADING.md).
- DEX Screener token discovery, price, and liquidity alerts, delivered in app or to the explicitly selected paired WhatsApp chat.

## Coming soon

Automatic take-profit/stop-loss, volume alerts, and agent marketplace licensing remain upcoming. Without active advance permission, personal WhatsApp buy/sell commands return wallet-review links. With permission, the paired owner’s explicit commands can submit trades within the signed limits. Earlier paper records are preserved; paper execution remains in isolated demo/test fixtures only.

Coinbase OAuth has been removed. Historical broker database tables and encrypted records are retained for recovery and are not accessed by the active integration. Other markets are not offered or accepted in new configurations. Existing incompatible strategies remain stored and are not runnable.

## Run locally

Use Node.js 22.12+ (Node 24 recommended):

```sh
npm ci
npm run setup:env
# Fill the ignored .env.supabase.local using supabase.env.example.
# Retain the existing encryption key when using existing data.
npm run db:migrate:supabase
npm run dev
```

Open http://localhost:5173. The API uses port 4000. The launcher starts the API, Vite, and the worker against Supabase without seeding hosted data. Keep the worker on a persistent host for automatic message polling. A Vercel website deployment alone does not keep that process alive.

Core environment: DATABASE_URL, CREDENTIAL_ENCRYPTION_KEY, APP_URL, DEMO_MODE=false, PAYMENT_PROVIDER=stripe_test. Only DATABASE_URL is used, with verified TLS and the included public Supabase CA. Add JUPITER_API_KEY and SOLANA_SWAPS_ENABLED=true for swaps. DEX Screener needs no key. Birdeye, Coinbase, and AI keys are not used. Each user supplies their personal WhatsApp agent key in Connections. See [provider setup and exact Vercel variables](docs/SOLANA-PROVIDERS.md).

See docs/SUPABASE.md for SQL migrations, encrypted-credential continuity, deployment configuration and RLS. All 40 application tables retain backend-only access. The latest additive migration stores dedicated encrypted wallet keys, signed permissions, one-use challenges, chat-trade reservations, and withdrawals. Existing pairings and data remain intact. Watchlists use a per-user Setting key.

## Data-source behavior

- DEX Screener token profiles are discovery candidates, not a complete feed of all Solana launches.
- Each token is identified by its case-sensitive mint. Only pairs whose chain is solana are returned. The most liquid indexed pair per base mint is selected.
- Pool creation time is not token mint age. Symbols and names are not verified identities. Liquidity and listings do not certify safety.
- Provider failures show an error. A cached result may be returned for up to five minutes, explicitly marked stale with its original fetch time. No fabricated prices replace failed responses.
- Public upstream calls are cached, coalesced, rate-limited, time-bounded, response-size bounded and restricted to a fixed DEX Screener origin. There is no user-supplied upstream URL.
- Discovery alerts establish a baseline on the first successful scan and then report newly observed mints from the latest Solana profiles. Persistent first-seen records prevent rediscovery after restarts. This is limited discovery coverage, not every token launch. Data APIs do not authorize wallet transactions.

References: https://docs.dexscreener.com/api/reference.

## Verification

```sh
npm test
npm run build
```

Tests use isolated embedded PostgreSQL fixtures, never hosted application data. npm run dev:demo starts an optional isolated demo. The browser suite in e2e/ describes the Solana discovery, account, builder, and Coming soon flows. Run browser interaction checks through the supported browser tool in agent sessions.

Personal WhatsApp availability depends on the account rollout. Pairing only accepts the agent creator and never stores wallet recovery phrases. Agent chats are not end-to-end encrypted. MetaMask account/network changes end the workspace session. Account sign-in is independent of future Solana swap authorization.
