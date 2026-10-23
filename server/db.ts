import { createDatabase, type Database } from './database/client.js';
export const db = createDatabase(process.env.DATABASE_URL);
export type Tx = Database;
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for(let i=0;;i++) {
    try { return await db.transaction(fn, { isolationLevel: 'Serializable', timeout: 20000, maxWait: 15000 }); }
    catch(e: any) { if(i<4 && ['40001','40P01'].includes(e.code)) continue; throw e; }
  }
}
export async function lockUser(tx: Tx, id: string) { await tx.sql`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`; }
