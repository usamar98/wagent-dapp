-- Hosted infrastructure only. Run once on the production Supabase project.
-- Kept outside app migrations because embedded test databases lack these extensions.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
-- Vault is already installed by Supabase. Secrets/jobs are configured with
-- scripts/cloud-worker.ts after the protected endpoint is deployed.
