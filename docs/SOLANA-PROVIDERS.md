# Solana providers and Vercel environment

Add these variables in the **wagent-ai Vercel project → Settings → Environment Variables**, select Production (and Preview if needed), then redeploy. All values below are server-only; do not prefix keys with `VITE_`.

| Variable | Value | Purpose |
| --- | --- | --- |
| `JUPITER_API_KEY` | Your Jupiter Portal API key | Token metadata, assembled swap orders, and managed transaction landing through Swap API v2. |
| `DEXTOOLS_API_KEY` | Your DEXTools public API **v3** key with Solana pools and token metrics access | DEXTools price thresholds and newly indexed pool alerts. Your API plan must permit these endpoints. |
| `SOLANA_SWAPS_ENABLED` | `true` | Opt in to wallet-approved mainnet swaps after configuring Jupiter. Default is disabled. |
| `SOLANA_ALERTS_ENABLED` | `true` | Enable alert checks. Enabled unless explicitly set to `false`. |
| `SOLANA_RPC_URL` | Optional HTTPS Solana mainnet RPC endpoint | Read-only confirmation after an uncertain submission. Defaults to `https://api.mainnet-beta.solana.com`. A private RPC can include a provider key in its URL. |

DEX Screener needs **no API key**. Birdeye, Coinbase, and an AI provider are not used for this flow. A Solana wallet's private key or recovery phrase must never be put in Vercel or Wagent Ai.

Keep the existing `DATABASE_URL`, `CREDENTIAL_ENCRYPTION_KEY`, `APP_URL=https://wagent-ai.vercel.app`, and `DEMO_MODE=false`. The SQL migration `20261026120303_solana_swaps_alerts.sql` adds private wallet proofs, swap history, alert rules, and events. Apply it using `npm run db:migrate:supabase`. Preserve the existing encryption key.

## Background alerts and WhatsApp

Vercel serves the website and API. Automatic checks and personal WhatsApp delivery use the existing persistent worker, not an always-running Vercel function. Configure the **same database, encryption key, APP_URL, DEXTOOLS_API_KEY, and SOLANA_ALERTS_ENABLED** on that worker host, then run `npm run worker`. Jupiter keys are needed on the website API for swaps, not by the alert worker. Local `npm run dev` launches the worker too. If you close the local process, automatic polling stops unless another worker host is running.

Each user saves their own personal WhatsApp Agent Platform key in Connections and completes one-time creator pairing. There is no shared WhatsApp key in Vercel for this connection. A rule sends WhatsApp alerts only when its creator selects **In app + paired WhatsApp**. In-app events are saved even if WhatsApp is unavailable. Delivery receipts appear in alert activity; an unknown delivery is never automatically resent.

## Trading behavior

1. MetaMask signs in to the workspace. Link a separate Wallet Standard compatible Solana wallet in **Buy & sell** by signing a one-use ownership message.
2. Enter an exact Solana mint and SOL spend or token sell quantity. Jupiter supplies a short-lived exact-input quote, estimated fees, and minimum output at the selected slippage limit.
3. Review the route and approve its transaction in the linked wallet. The server verifies the wallet signature and byte-for-byte message equality before submitting the saved Jupiter request once.
4. An ambiguous timeout stays **UNKNOWN**. The app blocks another order until read-only chain confirmation resolves it. Neither the worker nor chat silently retries a swap. After ten minutes, if a saved last-valid block height is available, reconciliation can also resolve an absent transaction after finalized block height exceeds expiry by 32 blocks and a second history lookup still finds no transaction. RPC errors preserve the unknown state.

This version uses a user-paid SOL fee payer and excludes JupiterZ routes. A sponsored route is rejected; keep SOL for fees. Other supported Jupiter routes compete normally. The app never holds wallet private keys. Automated stop-loss and take-profit execution are not enabled.

Personal WhatsApp commands `Buy 0.1 SOL of <mint>` and `Sell 100 of <mint>` return a website review link. Amounts on buy are SOL; amounts on sell are token units. Links are only form prefills. They cannot authorize or submit a transaction. Dollar-based legacy paper commands are rejected outside isolated demos.

## Alert semantics and coverage

- DEX Screener: price above/below and liquidity below, using the most liquid indexed pool for an exact base-token mint. A different selected pool can change the observed metric. Missing or stale values do not trigger.
- DEXTools v3: token price thresholds use `/tokens/solana/{mint}/metrics`. New-pool rules use `/pools/solana?sort=creationTime`. Only pools created after a rule is saved qualify, subject to its minimum liquidity and maximum pool age. Each pool is deduplicated per rule. A new pool does not establish token mint age or safety.
- Threshold rules fire on the first matching observation and later crossings after cooldown. Disabling a rule cancels unsent WhatsApp alerts when the delivery worker checks them.
- Each account can save 20 rules. A worker cycle handles at most 20 due rules; busy installations can take longer than one minute. New-pool scans cover the newest 200 pools in a 24-hour window, emit at most five pools per rule/check, and report truncation in the rule status. Indexing delays, outages, filtering, or busy feeds can miss pools. This is not an exhaustive launch detector.
- Emergency stop prevents new swap quotes/submissions and alert checks, and cancels unsigned quotes and pending alert replies. Already-submitted blockchain transactions cannot be recalled.

Official references: [Jupiter Swap API](https://developers.jup.ag/docs/swap/order-and-execute), [DEXTools](https://developer.dextools.io/), [DEX Screener API](https://docs.dexscreener.com/api/reference).
