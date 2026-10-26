# Supabase PostgreSQL

Wagent Ai uses Supabase as its hosted database and connects directly with the Node.js pg driver. The application has no external ORM or generated database client. MetaMask wallet sessions and the Express API continue to enforce user ownership.

The selected project is [wagent-ai](https://supabase.com/dashboard/project/ogahyykwsezulhblaqvx), reference ogahyykwsezulhblaqvx. Existing user, strategy, order, and connection records are preserved in place. Historical migration metadata is archived in the private wagent_internal schema; current SQL migration history lives in supabase_migrations.schema_migrations.

## Environment

Copy supabase.env.example to the ignored .env.supabase.local file, or run npm run setup:env. The setup command never overwrites an existing file. For an existing database, preserve the original encryption key.

| Variable | Value |
| --- | --- |
| DATABASE_URL | Supabase transaction-pooler PostgreSQL connection, port 6543 |
| CREDENTIAL_ENCRYPTION_KEY | Existing persistent 64-character hexadecimal key |
| APP_URL | http://localhost:5173 locally; https://wagent-ai.vercel.app in production |
| DEMO_MODE | false |
| PAYMENT_PROVIDER | stripe_test |

There is one database URL for runtime, migrations, and security checks. No separate direct-connection variable is used. Browser requests go through Express; this architecture does not require frontend Supabase keys or Supabase Auth.

The confirmed pooler host is aws-0-ap-northeast-2.pooler.supabase.com and the username is postgres.ogahyykwsezulhblaqvx. Copy the completed connection string from the intended project's Connect dialog and percent-encode reserved password characters. Include sslmode=verify-full&sslrootcert=./supabase/prod-ca-2021.crt. The bundled public certificate comes from the project's [Database Settings certificate link](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt), SHA-256 700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7. Run commands from the repository root. Vercel includes the CA in the API bundle.

Reference: [Connecting to PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres).

## SQL migrations

Run npm run db:migrate:supabase against the configured database. In a trusted environment that already supplies DATABASE_URL, npm run db:migrate is equivalent. The runner:

- Acquires a transaction-scoped migration lock.
- Applies pending files from supabase/migrations atomically.
- Records versions in Supabase's standard migration-history table.
- Stores normalized SQL checksums privately and rejects changes to previously recorded SQL.

The baseline creates a fresh schema or adopts the existing Wagent tables without dropping or truncating them. It archives previous migration metadata and enables row-level security. It does not seed demo accounts. Future schema changes should be new SQL migration files created with the official Supabase CLI's migration new command. Update server/database/schema.ts when adding application columns or relationships; tests compare it to the SQL schema.

## Access protection

Run npm run db:secure:supabase to reapply supabase/harden.sql, then npm run db:check:supabase to verify connectivity, all 29 application tables, RLS, and browser-role isolation. The setup fails if expected tables are missing. Unrelated application tables are untouched.

The trusted backend database owner accesses the tables. Direct PUBLIC, anon, and authenticated table privileges are revoked. Browser-role policies are deliberately absent because the app uses wallet-session authorization in Express. Supabase's informational [RLS enabled without policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is expected for this access model. Do not add broad browser policies to silence it. Review [Data API security](https://supabase.com/docs/guides/api/securing-your-api) before changing this architecture.

## Run locally

After migration, npm run dev starts the API, Vite, and the background worker against Supabase. npm run dev:supabase starts only the API and website; append -- --worker to include the worker. Both read .env.supabase.local and never seed hosted data.

The optional npm run dev:demo command uses an isolated embedded PostgreSQL fixture. Tests also use isolated fixtures, never the hosted production database. Stop one launcher before using another on the same ports.

## Vercel and worker hosting

Set Production DATABASE_URL and CREDENTIAL_ENCRYPTION_KEY as Secret variables. Set APP_URL, DEMO_MODE, and PAYMENT_PROVIDER as configuration values. Retain applicable legacy Stripe and administrator settings. Coinbase credentials are no longer used. Keep credentials out of VITE_ variables and use separate Preview configuration. Redeploy after environment changes.

Vercel serves the website and request-based API. The worker remains a separate persistent process, using the same Supabase connection and encryption key. Use compose.worker.yaml on its host or npm run worker with an explicitly supplied production environment. Vercel deployment does not start the persistent loop.

Verify wallet sign-in, ownership isolation, private Solana agent creation, watchlist persistence, WhatsApp pairing, Coming soon order rejection, emergency stop, and a recent worker heartbeat. Keep private backups and recovery connection files outside Git. This migration does not enable real-money trading.
