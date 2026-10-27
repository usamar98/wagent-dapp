import 'dotenv/config';
import { db, transaction } from '../server/db.js';
import { cloudWorkerToken } from '../shared/cloud-worker-auth.js';

const name = 'wagent-whatsapp-worker';
const secretName = 'wagent_cloud_worker_token';
const args = process.argv.slice(2);
if (args.length !== 1 || !['--enable', '--disable', '--status'].includes(args[0])) throw new Error('Use --enable, --disable, or --status. Load the intended production env file first.');
const mode = args[0];
try {
  if (!(await db.sql`SELECT to_regclass('cron.job') AS installed`)[0].installed) throw new Error('Apply supabase/worker-scheduler.sql on the hosted project first.');
  if (mode === '--enable') {
    const origin = new URL(process.env.APP_URL || '');
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('APP_URL must be the HTTPS production website origin.');
    const credential = cloudWorkerToken(process.env.CREDENTIAL_ENCRYPTION_KEY || '');
    const endpoint = `${origin.origin}/api/internal/worker`;
    const check = await fetch(endpoint, { headers: { Authorization: `Bearer ${credential}` }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    const readiness = check.ok ? await check.json() : null;
    if (!readiness?.ok || readiness.mode !== 'cloud' || readiness.intervalSeconds !== 10) throw new Error('The production worker endpoint is not ready. Deploy it with the matching server encryption key before enabling the schedule.');
    await transaction(async tx => {
      await tx.sql`SELECT pg_advisory_xact_lock(870264)`;
      const secrets = await tx.sql<{ id: string }>`SELECT id FROM vault.secrets WHERE name = ${secretName}`;
      if (secrets.length > 1) throw new Error('Duplicate scheduler secret names need administrator review.');
      if (secrets[0]) await tx.sql`SELECT vault.update_secret(${secrets[0].id}::uuid, ${credential}, ${secretName}, 'One-purpose Wagent cloud scheduler credential')`;
      else await tx.sql`SELECT vault.create_secret(${credential}, ${secretName}, 'One-purpose Wagent cloud scheduler credential')`;
      // The cron definition contains a Vault lookup, never the credential itself.
      const command = `SELECT net.http_post(url := '${endpoint.replaceAll("'", "''")}', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '${secretName}')), body := '{}'::jsonb, timeout_milliseconds := 290000);`;
      const [job] = await tx.sql<{ id: number }>`SELECT cron.schedule(${name}, '10 seconds', ${command}) AS id`;
      await tx.sql`UPDATE cron.job SET active = true WHERE jobid = ${job.id}`;
    });
    console.log('Cloud worker enabled: Supabase wakes the production Vercel worker every 10 seconds. Credential stored in Vault; no secret printed.');
  } else if (mode === '--disable') {
    await db.sql`UPDATE cron.job SET active = false WHERE jobname = ${name}`;
    console.log('Cloud schedule disabled. Already-running work may finish; trading permissions were not changed.');
  }
  const jobs = await db.sql`SELECT jobname, schedule, active FROM cron.job WHERE jobname = ${name}`;
  const [state] = await db.sql`SELECT value FROM "Setting" WHERE key = 'cloudWorkerLease'`;
  const [heartbeat] = await db.sql`SELECT value FROM "Setting" WHERE key = 'cloudWorkerHeartbeat'`;
  const lease = state ? JSON.parse(state.value as string) : {};
  console.log(JSON.stringify({ jobs, heartbeatAgeSeconds: heartbeat ? Math.round((Date.now() - Number(heartbeat.value)) / 1000) : null, lastCompletedAt: lease.completedAt ? new Date(lease.completedAt).toISOString() : null, lastCycleOk: lease.ok ?? null }));
} catch (error) {
  console.error('Cloud worker configuration failed:', error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database URL]') : 'Unknown failure');
  process.exitCode = 1;
} finally { await db.close(); }
