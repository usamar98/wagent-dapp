import { readFile,readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
export async function migrateEmbedded(db:PGlite) {
  await db.exec('CREATE TABLE IF NOT EXISTS "_LocalMigration" (id TEXT PRIMARY KEY)');
  const root=new URL('../prisma/migrations/',import.meta.url);
  const migrations=(await readdir(root,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();
  for(const id of migrations){const applied=await db.query('SELECT id FROM "_LocalMigration" WHERE id = $1',[id]);
  if(!applied.rows.length) {const sql=await readFile(new URL(`${id}/migration.sql`,root),'utf8');await db.transaction(async tx=>{await tx.exec(sql);await tx.query('INSERT INTO "_LocalMigration" (id) VALUES ($1)',[id]);});}}
}
