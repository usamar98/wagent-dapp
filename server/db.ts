import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
export const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000 }) });
export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for(let i=0;;i++) {
    try { return await db.$transaction(fn, { isolationLevel: 'Serializable', timeout: 20000, maxWait: 15000 }); }
    catch(e: any) { if(i<4 && (e.code==='P2034'||e.meta?.code==='40001'||e.meta?.driverAdapterError?.cause?.originalCode==='40001')) continue; throw e; }
  }
}
export async function lockUser(tx: Tx, id: string) { await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`; }
