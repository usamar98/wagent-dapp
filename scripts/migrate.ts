import 'dotenv/config';
import { Pool } from 'pg';
import { applyMigrations } from './migrations.js';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the intended PostgreSQL database.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max:1, connectionTimeoutMillis:10000, query_timeout:60000 });
try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='15s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query('SELECT pg_advisory_xact_lock(634271809)');
    const result = await applyMigrations({ query: (sql,values)=>client.query(sql,values), exec: sql=>client.query(sql) });
    await client.query('COMMIT');
    console.log(`SQL migrations up to date (${result.total} committed, ${result.applied.length} applied).`);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} catch {
  console.error('SQL migration failed. Check database access, TLS trust, and migration checksums. No migration data was committed.');
  process.exitCode=1;
} finally { await pool.end(); }
