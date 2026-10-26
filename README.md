# Wagent Ai

A Solana-only agent workspace. Create a private token configuration, pair your personal WhatsApp agent, research Solana pools with DEX Screener, and save a private mint-address watchlist. React, Vite, TypeScript, Express, and Supabase PostgreSQL through pg. Prisma is not used.

## Available now

- MetaMask message sign-in for workspace identity. This does not connect a Solana trading wallet.
- Private agent creation with 1–10 Solana token mints.
- Agent selection, encrypted personal WhatsApp keys, one-time ownership pairing, manual sync, and background polling.
- Real Solana token discovery and mint search from DEX Screener, refreshed every 60 seconds.
- Liquidity filtering, pool age, volume, mint copying, and direct DEX Screener / DEXTools research links.
- Private account-scoped watchlists stored in Supabase, with up to 30 mints.
- Activity history, ownership isolation, and emergency stop.

## Coming soon

Live token buying with SOL and selling back to SOL; Solana transaction signing; new-pool, price, volume and liquidity alerts; take-profit and stop-loss; and agent marketplace licensing. These screens do not submit orders or schedule notifications. Production rejects order creation, confirmation and runtime start commands. The background worker only handles personal-agent polling/replies and its heartbeat. Earlier paper records are preserved. Paper execution remains in isolated demo/test fixtures only.

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

Core environment: DATABASE_URL, CREDENTIAL_ENCRYPTION_KEY, APP_URL, DEMO_MODE=false, PAYMENT_PROVIDER=stripe_test. Only DATABASE_URL is used, with verified TLS and the included public Supabase CA. No DIRECT_URL, Prisma account, Coinbase key, shared WhatsApp key, DEX Screener key, DEXTools API key, or AI key is required for the currently available features. Each user supplies their personal agent key in Connections.

See docs/SUPABASE.md for SQL migrations, encrypted-credential continuity, deployment configuration and RLS. All 29 application tables retain backend-only access. Watchlists use a per-user Setting key; no schema migration or destructive database change is needed for this release.

## Data-source behavior

- DEX Screener token profiles are discovery candidates, not a complete feed of all Solana launches.
- Each token is identified by its case-sensitive mint. Only pairs whose chain is solana are returned. The most liquid indexed pair per base mint is selected.
- Pool creation time is not token mint age. Symbols and names are not verified identities. Liquidity and listings do not certify safety.
- Provider failures show an error. A cached result may be returned for up to five minutes, explicitly marked stale with its original fetch time. No fabricated prices replace failed responses.
- Public upstream calls are cached, coalesced, rate-limited, time-bounded, response-size bounded and restricted to a fixed DEX Screener origin. There is no user-supplied upstream URL.
- DEXTools research links open its external app. Its paid API is not connected. Data APIs do not authorize Wagent Ai to operate an external trading account or wallet.

References: https://docs.dexscreener.com/api/reference and https://developer.dextools.io/.

## Verification

```sh
npm test
npm run build
```

Tests use isolated embedded PostgreSQL fixtures, never hosted application data. npm run dev:demo starts an optional isolated demo. The browser suite in e2e/ describes the Solana discovery, account, builder, and Coming soon flows. Run browser interaction checks through the supported browser tool in agent sessions.

Personal WhatsApp availability depends on the account rollout. Pairing only accepts the agent creator and never stores wallet recovery phrases. Agent chats are not end-to-end encrypted. MetaMask account/network changes end the workspace session. Account sign-in is independent of future Solana swap authorization.
