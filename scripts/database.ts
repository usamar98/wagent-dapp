import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from './migrations.js';
export async function migrateEmbedded(db:PGlite) {
  await db.transaction(tx=>applyMigrations({query:(sql,values)=>tx.query(sql,values),exec:sql=>tx.exec(sql)}));
}
