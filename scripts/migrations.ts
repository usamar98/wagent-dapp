import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

interface MigrationConnection { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; exec(sql: string): Promise<unknown> }
export async function applyMigrations(connection: MigrationConnection) {
  await connection.exec(`CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);
    CREATE SCHEMA IF NOT EXISTS wagent_internal;
    CREATE TABLE IF NOT EXISTS wagent_internal.migration_checksums (version text PRIMARY KEY, checksum text NOT NULL);
    REVOKE ALL ON SCHEMA wagent_internal FROM PUBLIC;
    REVOKE ALL ON supabase_migrations.schema_migrations, wagent_internal.migration_checksums FROM PUBLIC;
    ALTER TABLE supabase_migrations.schema_migrations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE wagent_internal.migration_checksums ENABLE ROW LEVEL SECURITY;`);
  const root = new URL('../supabase/migrations/', import.meta.url);
  const files = (await readdir(root)).filter(file => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)).sort();
  if (!files.length) throw new Error('No committed Supabase SQL migrations found.');
  const applied: string[] = [];
  for (const file of files) {
    const version = file.slice(0,14), name = file.slice(15,-4);
    const sql = (await readFile(new URL(file,root),'utf8')).replaceAll('\r\n','\n');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = (await connection.query('SELECT checksum FROM wagent_internal.migration_checksums WHERE version=$1',[version])).rows[0];
    if (previous && previous.checksum !== checksum) throw new Error(`Applied SQL migration ${version} has changed. Add a new migration instead.`);
    const exists = (await connection.query('SELECT version FROM supabase_migrations.schema_migrations WHERE version=$1',[version])).rows.length;
    if (!exists) {
      await connection.exec(sql);
      await connection.query('INSERT INTO supabase_migrations.schema_migrations (version,name,statements) VALUES ($1,$2,$3::text[])',[version,name,[sql]]);
      applied.push(file);
    }
    await connection.query('INSERT INTO wagent_internal.migration_checksums (version,checksum) VALUES ($1,$2) ON CONFLICT (version) DO NOTHING',[version,checksum]);
  }
  return { applied, total: files.length };
}
