# Wagent Ai

A working marketplace for versioned, declarative trading agents. React + Vite + TypeScript, CSS Modules, Express, Prisma 7, PostgreSQL, and a separate execution worker. Agent purchases are **one-time payments** with a default 10% platform commission. The MVP generates signals and paper trades only.

## Start locally, no Docker required

Node.js 22.12+ (Node 24 recommended). From this project directory:

```sh
npm ci
npm run db:generate
npm run dev
```

Open **http://localhost:5173**. The launcher starts a persistent embedded PostgreSQL database using PGlite on loopback port 5433, applies the SQL migrations, seeds six sample listings, and launches the API (4000), Vite (5173), and a **separate worker process**. The database and a locally generated encryption key are stored in ignored `.data/`. Ctrl+C stops the services. PGlite is the local demo/testing path; Docker uses standard PostgreSQL.

For a smaller process footprint after a successful build, use `npm run preview:demo`. It serves the built frontend and API together on port 5173 with the embedded database and a separate compiled worker. Stop the development launcher before starting this preview.

## MetaMask sign-in

Select **Connect MetaMask** in a browser with the MetaMask extension installed. The server issues a five-minute, single-use Sign-In with Ethereum message bound to the configured domain, wallet address, chain and browser. MetaMask signs the message; the server verifies the signature and issues an HttpOnly session. Wallet sign-in requires no API key or blockchain transaction. There are no email/password registration, login or password-reset routes, and no reset-email provider.

The message format follows [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) and uses [MetaMask personal_sign](https://docs.metamask.io/metamask-connect/evm/guides/sign-data/).

Every connected wallet can buy and create. Wallet account/network changes sign the browser out. A newly connected wallet creates its own account and creator profile.

To enable administrator access, add your **public wallet address** to the server environment and restart:

```env
ADMIN_WALLET_ADDRESSES=0xYOUR_PUBLIC_WALLET_ADDRESS
```

Multiple administrator addresses can be separated by commas. Never put a seed phrase or private key in this setting. Administrator permissions are checked against the server allowlist on every request; connecting a wallet does not grant administrative access by itself. Administrators cannot approve their own listings.

### Existing demo profiles and migration

Migration `202610190004_wallet_login` removes password/email fields and old sessions, while preserving users, agents, orders and entitlements. Existing profiles start with an unlinked wallet. The demo seed creates sample creator profiles and six listings, but no reusable login credentials.

To preserve an existing account’s resources, link its wallet **before its first wallet sign-in**, using the trusted server CLI while the database is running:

```sh
npm run wallet:assign -- --user-id=buyer_demo --address=0xYOUR_PUBLIC_WALLET_ADDRESS
```

Use `creator_demo` or another known user ID as needed. The CLI will not overwrite an existing wallet link or transfer a wallet from a different account. Sign-in still requires the linked wallet’s valid signature. Without linking, MetaMask creates a new account. For a hosted database, run `npm run db:migrate` to apply the new migration; the local launcher applies it automatically.

The supplied `IMG_8207.PNG` is used as the website logo and embedded in a vector viewport for the favicon. The palette is sampled from its purple `#8848fd` and near-black `#07060b`, with readable light text.

## Docker Compose

```sh
npm run setup:env
docker compose up --build
```

The setup script creates `.env` with a random 256-bit encryption key and never overwrites an existing file. Compose starts PostgreSQL 17, a migration/seed job, Express, Vite, and the worker. Open **http://localhost:5173**. PostgreSQL data persists in a named volume. Local database credentials in Compose are for this local demo. Docker was not available in the implementation environment; the Compose build/start was not executed there.

For an installed PostgreSQL database, configure `.env` from `.env.example`, then run:

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
```

Run `npm run dev:api`, `npm run dev:web`, and `npm run worker` in separate terminals. `db:seed` requires `DEMO_MODE=true` and a non-production `NODE_ENV`.

## Complete demo walkthrough

1. Connect your **creator wallet** with MetaMask. Open **Agent builder**, enter a name and description, and configure a strategy. To guarantee a visible initial signal on simulated BTC/USD, use **Price alert**, entry **1000000**, exit **2000000**. These artificial levels demonstrate the workflow; they are not recommendations.
2. Choose **Marketplace listing**, set a one-time price, then **Save & test version** and **Submit for review**. Private drafts can be run without publishing.
3. Disconnect and connect a separate wallet listed in **ADMIN_WALLET_ADDRESSES**. Open **Administration**, inspect the tested configuration, enter a review note, and **Approve & publish**.
4. Disconnect and connect your **buyer wallet**. Optionally open **Connections**, add **Local notification simulator**, supply a test recipient number, consent, and verify the clearly displayed local demo code. No phone message is sent.
5. Find the approved listing in **Marketplace**, read the strategy, version, setup, license and external costs, then **Get this agent**. Accept both disclosures and **Continue to simulator**.
6. The order remains pending with no entitlement. **Simulate successful payment** to activate a **DEMO** personal-use license. Failure, refund, and dispute controls are also provided for testing.
7. Open **My agents**, **Set up paper runtime**, **Start**, then **Run cycle**. The worker also checks running instances every five seconds, with execution limited to the configured timeframe bucket. Inspect execution logs, signals, positions and paper orders. A HOLD decision creates no signal or notification.
8. Open **Notifications** to see the timestamped in-app signal and, if configured and consented, a separately labeled **SIMULATED MESSAGE**. Download the exact licensed configuration and follow [runner/README.md](runner/README.md) to self-host it.

**Pause** and **Stop** prevent subsequent execution. **Emergency stop** stops every runtime for the account and blocks new starts until explicitly cleared. Clearing it leaves runtimes stopped. Stopping retains the paper ledger and positions for inspection; it does not invent a closing trade.

## Verification

```sh
npm test
npm run build
```

Tests use an isolated in-memory PostgreSQL engine exposed over the PostgreSQL wire protocol, with the same Prisma client and SQL migrations as the application. They cover strategy calculations, risk limits, invalid/stale data, purchase authorization, server pricing, signed webhook validation, retries, data isolation, immutable purchase versions, paper-order deduplication, emergency stop, reversals, wallet signature verification, nonce replay prevention, challenge expiry, domain/browser binding and disabled-wallet rejection.

With the local demo running and Microsoft Edge installed on Windows (Google Chrome on other platforms):

```sh
npm run test:e2e
```

Browser tests cover marketplace search/filtering, mobile navigation/overflow, wallet sign-in, private-agent testing, purchase, execution, and notifications using an injected wallet test double. The signature verification itself is real; the browser tests do not operate an actual MetaMask extension. Full moderation is covered by HTTP integration tests. They write screenshots and failure traces to ignored `test-results/`. Set `PLAYWRIGHT_CHANNEL` to override the installed browser.

Verified on 19 October 2026: the complete frontend/backend/runner build and all **30 service/strategy/runner tests** passed. All **3 browser checks** passed, covering desktop/mobile marketplace behavior, signed-wallet sign-in → private-agent creation/testing → purchase → paper execution → notification, and the missing-wallet state. Wallet browser tests use an injected provider test double with real cryptographic signatures; an actual MetaMask extension, external Stripe/Meta services, and Docker were not exercised.

## Integrations and eligibility

| Capability | Local behavior | External requirements |
| --- | --- | --- |
| Market data | Deterministic seeded-formula feed, timestamped and visibly simulated | Buyer-operated JSON market-data endpoint supported by the self-hosted runner; own provider fees/credentials |
| Signal engine | Price thresholds, Wilder RSI, SMA crossover, portfolio observations | No AI dependency; backend computes decisions and risk limits deterministically |
| Paper trading | Persisted cash, positions, signals, paper orders, errors | Real-money broker/exchange adapter is explicitly disabled |
| Payments | Development-only simulator grants DEMO entitlements after server settlement | Stripe Checkout + Connect **test mode**, eligible marketplace/product/countries and creator onboarding |
| Payouts | Simulator earnings are marked `SIMULATED_NOT_PAID` | Signed Connect payout events tracked separately from internal creator earnings; test payouts do not move money |
| Notifications | In-app inbox and consented/verified local message simulator | Official WhatsApp verification/opt-out webhooks only; outbound delivery disabled |
| AI explanations | Optional instructions saved as inert explanatory context | No external AI provider is called; credentials can be stored securely for future adapters |
| Wallet identity | MetaMask message signing; server verifies the EOA signature | Browser extension, no wallet API key or RPC provider required |

No external Stripe account, Meta delivery or external market-data provider was contacted or tested. Signed Stripe webhook behavior is tested locally with fixture secrets.

### Stripe test mode

Use an eligible platform and connected account. Set `STRIPE_ELIGIBILITY_CONFIRMED=true`, an `sk_test_` key, `STRIPE_WEBHOOK_SECRET`, and your verified eligible `STRIPE_CONNECT_COUNTRY`. Creator Studio exposes Connect test onboarding. Country is intentionally not guessed from the developer’s location. Never enable the eligibility flag without confirming the exact product category, marketplace model and supported countries with Stripe.

Configure a webhook at `/api/webhooks/stripe` for:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
- `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`
- `account.updated`
- Connect `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`

Checkout uses `mode=payment`, server-selected USD price, and a destination charge with a server-calculated application fee. Raw-body signatures and freshness are verified; event IDs are persisted transactionally. Unpaid completion events cannot grant access. A success URL never grants access. Refunds revoke entitlements; disputes suspend them and stop corresponding runtimes. A won dispute may restore its suspended entitlement; refunds cannot be undone by a late paid webhook. Browser-supplied amounts and commission are ignored. No live-mode charges or webhooks are accepted.

Provider documentation: [Stripe destination charges](https://docs.stripe.com/connect/marketplace/tasks/accept-payment/destination-charges), [Stripe webhooks](https://docs.stripe.com/webhooks), [Stripe restricted businesses](https://stripe.com/legal/restricted-businesses), [Connect country availability](https://docs.stripe.com/connect/cross-border-payouts).

### WhatsApp policy decision

Reviewed on **19 October 2026** against the official [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy). Its restrictions include currency-related goods/services, opt-in requirements, opt-out handling, and approved templates for business-initiated messages. **The exact eligibility of crypto/forex/trading-signal and AI-agent notifications has not been established. Outbound delivery remains disabled for every account.** A saved credential, verified recipient, or supplied template name does not establish eligibility.

The adapter rejects real delivery and explains why. The local simulator neither calls Meta nor claims real recipient verification. The official webhook verifies the challenge and HMAC-SHA256 signature and processes opt-outs idempotently. Other inbound text is ignored; WhatsApp cannot perform purchases or execute trades. Template names are stored as `NOT_SUBMITTED`, not falsely marked approved. No environment toggle silently enables outbound delivery.

### License and operating costs

A purchase provides perpetual, non-transferable personal use of the purchased version. The creator keeps intellectual property; redistribution and resale are prohibited. Future strategy versions require review and existing purchasers stay pinned to their version. This MVP prevents a duplicate purchase of the same agent; a later paid-upgrade offer would require a separate explicit product flow. Setup support covers the purchased version for 30 days. Hosting, market data, AI calls, and message fees are external costs borne by each buyer. No unlimited service or free future versions are promised. The platform never holds trading funds.

An agent’s name, description, category, tags and cover are fixed after its first save, so draft edits cannot change the identity of an already-reviewed listing. Strategy, risk, market, pricing and setup updates create a new immutable version and require approval before replacing the public version. Create a new agent for a different identity.

Authorized exports include only public agent identity, versioned configuration, license terms and setup/runtime instructions. Provider credentials, creator private data and buyer records are excluded. An already downloaded offline configuration cannot be remotely erased following a refund; website entitlements and managed runtimes are revoked/suspended.

## Vercel deployment

The root `vercel.json` publishes `dist/web`, routes `/api/*` to the existing Express app exported by `api/index.ts`, and serves `index.html` for React Router pages such as `/marketplace` and `/auth`. Keep the Vercel project root at the repository root and the framework preset at **Vite**. The build command is `npm run build`; no local database is started during the build.

Configure these server environment variables in the Vercel project's **Production** environment before deploying:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Hosted PostgreSQL connection string, with pooling and TLS configured for the database provider |
| `DIRECT_URL` | Optional direct PostgreSQL connection for migrations; Prisma CLI falls back to `DATABASE_URL` when unset |
| `CREDENTIAL_ENCRYPTION_KEY` | Persistent, randomly generated 64-character hexadecimal key; keep it secret and retain it across deployments |
| `APP_URL` | `https://wagent-ai.vercel.app` or the final HTTPS custom domain |
| `DEMO_MODE` | `false` |
| `PAYMENT_PROVIDER` | `stripe_test` |
| `ADMIN_WALLET_ADDRESSES` | Optional public administrator wallet addresses |

Vercel sets `NODE_ENV=production`. Keep all database URLs, encryption keys, and provider secrets server-only; never give them a `VITE_` prefix. Set separate values and the correct `APP_URL` for any Preview environment you use. MetaMask sign-in verifies the configured origin.

Apply committed migrations once against the intended hosted database with `npm run db:migrate` from a trusted environment containing its `DIRECT_URL` or `DATABASE_URL`. For Prisma Postgres, retain the provider-generated `postgres://` connection with `sslmode=require`; use its pooled TCP URL for runtime traffic when provided, and its direct TCP URL for migrations. The `PrismaPg` adapter does not accept an Accelerate `prisma+postgres://` URL. Existing local `.data/` records are not uploaded by deploying the repository. Do not run the demo seed against a production database. Stripe test checkout additionally requires the test credentials and eligibility configuration described above.

The API function handles requests only. The existing `npm run worker` process must run separately on a persistent worker host with the same database and encryption configuration for automatic paper execution. Do not launch `npm run dev` or the five-second worker loop inside a Vercel Function. `/api/health` checks database connectivity; `/api/bootstrap` checks the marketplace's initial data response.

## Architecture and operational boundaries

- `src/`: responsive React product UI, CSS Modules, marketplace, builder, checkout, library, creator/admin dashboards, connections and inbox.
- `server/`: Express API, authorization, encrypted connections, provider adapters, payment transitions, deterministic execution, and separate worker.
- `shared/`: strict Zod declarative schemas and pure deterministic strategy/risk calculations shared by server and runner.
- `prisma/`: normalized marketplace/operations schema, committed PostgreSQL migrations and idempotent demo seed.
- `runner/`: Docker-based self-hosted paper runtime and persisted local control/ledger files.
- `tests/`, `e2e/`: service/strategy security tests and browser workflow tests.

Sessions use random opaque tokens stored hashed in PostgreSQL, HttpOnly/SameSite cookies, expiry, verified wallet ownership, origin verification and a required custom request header. Production cookies are Secure and production startup requires an HTTPS `APP_URL`. Credentials use AES-256-GCM with a separate server-only encryption key and are never returned to the browser. Server errors log only error type/code. HTTP limits, strict schemas and body limits reject abusive payloads and executable configuration fields. Cover images use HTTPS image URLs or bundled diagrams; there is no arbitrary upload execution or server-side URL fetching.

Financial and execution mutations use serializable database transactions, account/instance/order row locks, unique order/entitlement/event/signal/paper-trade keys, and bounded serialization retries. The worker checks entitlement, account state, emergency stop and runtime status within the execution transaction. Data must be chronological, positive, timestamped, and no older than two configured candles. Risk exits bypass cooldown; entries respect cash, configured size, aggregate exposure, and one position per symbol.

The deployed MVP remains paper-only and Stripe-test-only. To serve the built frontend from Express behind your own HTTPS proxy, set `NODE_ENV=production`, `DEMO_MODE=false`, `PAYMENT_PROVIDER=stripe_test`, a real PostgreSQL URL, server-only encryption key and HTTPS `APP_URL`, then `npm run build` and `npm start`. The production launcher does not seed demo users or grant DEMO entitlements. Infrastructure TLS, backups and deployment-specific operations belong to your hosting setup.
