import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const action = process.argv[2];
if (!['check', 'secure'].includes(action)) throw new Error('Use the Supabase check or secure command.');
const connectionString = action === 'secure' ? process.env.DIRECT_URL : process.env.DATABASE_URL;
let databaseUrl: URL;
try { databaseUrl = new URL(connectionString || ''); } catch { throw new Error('Set the appropriate Supabase PostgreSQL connection string first.'); }
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !/(?:\.supabase\.co|\.pooler\.supabase\.com)$/.test(databaseUrl.hostname) || !databaseUrl.password || /PROJECT_REF|ENCODED_PASSWORD|POOLER_HOST/i.test(databaseUrl.href)) throw new Error('Use a completed connection string from the intended Supabase project.');
if (!['verify-ca', 'verify-full'].includes(databaseUrl.searchParams.get('sslmode') || '')) throw new Error('Supabase setup requires a verified TLS connection; configure sslmode=verify-full and the database CA if needed.');
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000, query_timeout: 30000 });
try {
  if (action === 'secure') {
    await pool.query(await readFile(new URL('../supabase/harden.sql', import.meta.url), 'utf8'));
    console.log('Wagent Ai tables have RLS enabled and direct anon/authenticated access revoked.');
  }
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const expectedTables = [...schema.matchAll(/^model (\w+) \{/gm)].map(match => match[1]).concat('_prisma_migrations');
  const result = await pool.query<{ table_name: string; rls_enabled: boolean; browser_access: boolean }>(`SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')) AS browser_access FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [expectedTables]);
  if (result.rowCount !== expectedTables.length) throw new Error('Required Wagent Ai tables are missing. Apply the committed Prisma migrations first.');
  if (result.rows.some(row => !row.rls_enabled || row.browser_access)) throw new Error('Private table access requires security setup.');
  console.log(JSON.stringify({ connected: true, databaseHost: databaseUrl.hostname, tables: result.rows }));
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : '';
  console.error(`Supabase setup/check failed${code}. Check the selected project, connection credentials, TLS trust, and migration/security status.`);
  process.exitCode = 1;
} finally { await pool.end(); }
