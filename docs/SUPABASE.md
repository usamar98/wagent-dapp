# Supabase database setup

## Current state

The selected project is [wagent-ai](https://supabase.com/dashboard/project/ogahyykwsezulhblaqvx), reference `ogahyykwsezulhblaqvx`, in the owner's connected organization. On October 23, 2026, the existing production schema and records were copied into its previously empty `public` schema. The copy includes two accounts, one saved agent and version, existing workspace/session records, and the five Prisma migration-history records. All 30 tables matched the source backup, with RLS enabled and direct `anon`/`authenticated` access revoked. The original Prisma database is retained for recovery.

Prisma remains the application's ORM. Supabase supplies managed PostgreSQL. The frontend continues to call the Express API, which verifies MetaMask wallet sessions and applies ownership checks. Supabase Auth, browser database access, and new frontend API keys are not needed for this change.

## 1. Select the intended project

Connect the intended Supabase account and select a dedicated Wagent Ai project. Confirm its organization and any quoted cost before provisioning. Inspect existing tables before applying the Wagent schema to a pre-existing project. This setup assumes the app owns its tables in the `public` schema; do not install it over another application's conflicting tables.

In the selected project's **Connect** dialog, copy its actual database connection strings. Use the Supavisor transaction pooler (port 6543) for Vercel runtime traffic. Use a direct connection for Prisma migrations; on an IPv4-only network, the Supavisor session pooler (port 5432) is the alternative. Copy hosts from the dashboard rather than deriving the `aws-N` prefix.

Reference: [Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

## 2. Store server configuration privately

Create `.env.supabase.local` from `supabase.env.example` and replace all placeholders. This local file is ignored by Git and Docker. Database passwords with reserved URL characters must be percent-encoded. Use `sslmode=verify-full&sslrootcert=./supabase/prod-ca-2021.crt`. The bundled public certificate was downloaded from the project's Database Settings [certificate link](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt), SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. Run commands from the project root. `vercel.json` includes this public CA in the API bundle so runtime verification also works on Vercel. Certificate verification remains enabled.

The confirmed shared pooler host is `aws-0-ap-northeast-2.pooler.supabase.com`, with username `postgres.ogahyykwsezulhblaqvx`. Runtime uses port `6543`; migrations use session-pooler port `5432`.

Required values:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase transaction-pooler PostgreSQL URL for the API |
| `DIRECT_URL` | Direct or session-pooler PostgreSQL URL for migrations and security setup |
| `CREDENTIAL_ENCRYPTION_KEY` | The existing Wagent Ai encryption key when migrating encrypted records |
| `APP_URL` | `http://localhost:5173` for the local hosted launcher; production uses the HTTPS deployment origin |
| `DEMO_MODE` | `false` for the hosted database |
| `PAYMENT_PROVIDER` | `stripe_test` |

Retain existing Coinbase, WhatsApp, and Stripe settings as applicable. Supabase does not enable live trading or change the paper-only broker scope.

## 3. Apply and protect the schema

With the target verified and its database URLs configured:

```sh
npm run db:generate
npm run db:migrate:supabase
npm run db:secure:supabase
npm run db:check:supabase
```

For a fresh database, the five existing Prisma migrations create the complete application schema and maintain Prisma's migration history. The selected project was installed from the final Prisma schema, with its original applied migration history copied and checksums verified against the committed files. `prisma migrate status` confirms all five migrations are applied. Future schema changes continue through Prisma migrations. Do not run the demo seed against the destination.

`supabase/harden.sql` enables RLS on the 29 Wagent Ai tables and `_prisma_migrations`, and revokes direct `PUBLIC`, `anon`, and `authenticated` table access. It applies atomically and fails if an expected table is missing. Unrelated tables are left alone. The backend uses the trusted database owner connection and retains its existing wallet-session authorization. There are deliberately no browser-role policies: the browser accesses data through Express. If a restricted backend database role is introduced later, configure its grants/policies explicitly before using it.

Run the security setup after future Prisma schema changes, update its table list when adding models, and check Supabase's security advisors before enabling a deployment. Reference: [Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api).

## 4. Preserve existing data at cutover

Before switching a live deployment, back up the existing application records and encryption key, copy the app-owned tables in dependency order, and verify row counts, identifiers, entitlements, and encrypted connection readability. Preserve the same `CREDENTIAL_ENCRYPTION_KEY`; changing the database host does not re-encrypt existing values. Coordinate writes during the copy so the new database does not miss changes. The October 23 copy was verified against all source rows; a second source snapshot confirmed it had not changed. Private backups and import scripts remain under ignored `.data/supabase-migration/`, and the encryption key is preserved in ignored environment files.

## 5. Run locally with Supabase

Stop the embedded demo before starting the hosted launcher on the same ports:

```sh
npm run dev:supabase
```

This checks connectivity and required tables, starts Express and Vite, and never seeds the target. The existing command `npm run dev` continues to use the embedded local demo.

To enable this machine's paper execution and personal WhatsApp polling explicitly:

```sh
npm run dev:supabase -- --worker
```

Use the same database and encryption key for any separate persistent worker. Do not enable a local worker against the wrong environment.

## 6. Configure Vercel and verify

After the destination schema and records are verified, update **Production** `DATABASE_URL` and `DIRECT_URL` as Secret variables on the existing `wagent-ai` project. Preserve its encryption key and other provider settings. Keep private URLs out of all `VITE_` variables. Development/Preview deployments should have their own environment configuration.

Redeploy, then verify the homepage, `/api/health`, wallet sign-in, private workspace, a confirmed paper order, replay prevention, and emergency stop. Run a disposable verification account and remove only its own records afterward. Confirm that ordinary users cannot read sensitive tables through the Supabase Data API.

Production `DATABASE_URL` and `DIRECT_URL` are configured as Vercel Secret variables for this Supabase project. Changes take effect in the next deployment; verify the running deployment with the checks above before retiring any old infrastructure.
