# Cloud WhatsApp worker

Supabase Cron calls the production Vercel endpoint `/api/internal/worker` every 10 seconds. This replaces the computer-dependent polling loop for personal WhatsApp commands and DEX Screener alerts. It does not require a new hosting account or API key. The website, database, and their existing quotas must remain available. The interval is a polling target, not a trade execution guarantee; provider delays and backlog can add latency.

## Deploy and enable

1. Deploy the committed code to production. `api/index.ts` has a 300-second maximum duration. Preview/local deployments refuse scheduler work.
2. On the intended hosted Supabase project apply `supabase/worker-scheduler.sql` to enable `pg_cron` and `pg_net`. Supabase Vault must be installed (standard on hosted projects).
3. Load the same production `DATABASE_URL`, `APP_URL`, and `CREDENTIAL_ENCRYPTION_KEY` as Vercel, then run:

   ```powershell
   node --env-file=.env.production.local --import tsx scripts/cloud-worker.ts --enable
   node --env-file=.env.production.local --import tsx scripts/cloud-worker.ts --status
   ```

The enable command first makes an authenticated, read-only readiness check. It derives a one-purpose scheduler token from the existing server key, stores only that token in Supabase Vault, and creates or updates the named job `wagent-whatsapp-worker`. A daily maintenance job expires only these two jobs' scheduler logs after seven days; application trade history is retained. Activation/deactivation uses `cron.alter_job`, rather than writing the protected job table. The cron definition reads Vault at runtime and contains no credential. No secret is printed, included in a URL, or sent to a browser. Re-run enable after changing the production origin or server key. Preserve the original encryption key unless following a planned credential migration.

## Runtime and trade safety

The endpoint is protected by a timing-safe service credential check before browser session/CSRF middleware. Browser sessions cannot invoke it. A database-backed, fenced 310-second lease prevents overlapping cloud cycles, outliving the function's 300-second limit. A heartbeat is refreshed while the lease is held. The endpoint returns only aggregate success/busy status.

Each cycle processes at most 20 oldest due WhatsApp channels and 20 due alert rules, four at a time within each task. New batches stop starting after one minute; already-started work finishes. Leased channels are skipped, so they do not starve other chats. Existing per-channel leases, exact message IDs, original-owner pairing, token allowlists, signed budgets, expiry, emergency stop, and trade submission/reconciliation safeguards remain in force. Unknown trade submissions are never blindly replayed. Automated alerts retain their existing minute/cooldown limits.

After a crash/timeout, the lease expires and a later scheduled request resumes. Individual provider errors remain visible on the affected connection/rule. A successful `cron.job_run_details` row only proves the HTTP request was queued; check `net._http_response` for HTTP 200/202 and `cloudWorkerLease` for actual completion. `workerHeartbeat` powers existing app status; `cloudWorkerHeartbeat` independently proves cloud activity with the local worker off.

## Operations

Disable future scheduled requests (already-running work may finish):

```powershell
node --env-file=.env.production.local --import tsx scripts/cloud-worker.ts --disable
```

This does not revoke signed trading permissions. Use the app's revoke or emergency stop controls to prevent future trades. The daily scheduler-log retention job stays enabled when polling is paused. Stop the old local polling worker after verifying cloud activity, to make cloud operation independently observable.

At a 10-second interval there are approximately 259,200 scheduled HTTP invocations per 30 days, plus the database checks and actual provider work. These consume existing Vercel/Supabase quotas and may incur usage charges under the account's plan. No plan upgrade or additional paid subscription is configured by this change. A paused database, disabled job, provider outage, or exhausted hosting quota can interrupt processing; this is not an uptime SLA.

References: [Supabase Cron](https://supabase.com/docs/guides/cron), [scheduled HTTP requests and Vault](https://supabase.com/docs/guides/functions/schedule-functions), [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration).
