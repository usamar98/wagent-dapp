import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createDatabase, type Database } from '../server/database/client.js';
import { databaseSchema } from '../server/database/schema.js';
import { migrateEmbedded } from '../scripts/database.js';
import { defaultConfig } from '../shared/config.js';

describe('direct PostgreSQL access', () => {
  let pg: PGlite, socket: PGLiteSocketServer, db: Database;
  beforeAll(async () => {
    pg = await PGlite.create(); await migrateEmbedded(pg);
    socket = new PGLiteSocketServer({ db: pg, host:'127.0.0.1', port:15435 }); await socket.start();
    db = createDatabase('postgresql://postgres:postgres@127.0.0.1:15435/postgres');
  });
  afterAll(async () => { await db?.close(); await socket?.stop(); await pg?.close(); });

  it('matches all application columns to the SQL migration', async () => {
    const columns = await db.sql<{table_name:string;column_name:string}>`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'`;
    for (const [model,table] of Object.entries(databaseSchema)) expect(columns.filter(row=>row.table_name===model).map(row=>row.column_name).sort()).toEqual([...table.columns].sort());
  });
  it('binds input values and rejects undefined ownership filters and unknown identifiers', async () => {
    await db.user.create({data:{id:'owner',name:'Owner'}});
    expect(await db.user.findMany({where:{name:"'; DROP TABLE public.\"User\"; --"}})).toEqual([]);
    await expect(db.user.findMany({where:{walletAddress:undefined}})).rejects.toThrow(/unscoped/);
    await expect(db.user.findMany({where:{'id" OR TRUE--':'owner'}})).rejects.toThrow(/Unknown/);
    await expect(db.user.updateMany({where:{id:undefined},data:{disabled:true}})).rejects.toThrow(/unscoped/);
    await expect(db.user.findUnique({where:{}})).rejects.toThrow(/unique/);
    await expect(db.user.update({where:{name:'Owner'},data:{disabled:true}})).rejects.toThrow(/unique/);
    await expect(db.user.delete({where:{name:'Owner'}})).rejects.toThrow(/unique/);
    expect((await db.user.findUniqueOrThrow({where:{id:'owner'}})).disabled).toBe(false);
  });
  it('creates a profile once and retains it across account upserts', async () => {
    const create={walletAddress:'0x'+'a'.repeat(40),name:'Wallet owner',profile:{create:{bio:'Original profile'}}};
    const first=await db.user.upsert({where:{walletAddress:create.walletAddress},create,update:{role:'USER'},include:{profile:true}});
    const again=await db.user.upsert({where:{walletAddress:create.walletAddress},create,update:{name:'Updated owner'},include:{profile:true}});
    expect(again.id).toBe(first.id); expect(again.profile?.id).toBe(first.profile?.id); expect(again.profile?.bio).toBe('Original profile');
    expect(await db.creatorProfile.count({where:{userId:first.id}})).toBe(1);
    expect(first).not.toHaveProperty('_wagent_inserted'); expect(again).not.toHaveProperty('_wagent_inserted');
  });
  it('rolls back the parent when nested creation fails', async () => {
    await db.creatorProfile.create({data:{id:'existing-profile',userId:'owner'}});
    await expect(db.user.create({data:{id:'rolled-back',name:'Must roll back',profile:{create:{id:'existing-profile'}}}})).rejects.toMatchObject({code:'23505'});
    expect(await db.user.findUnique({where:{id:'rolled-back'}})).toBeNull();
  });
  it('limits included child records per parent and preserves narrow projections', async () => {
    for (const id of ['strategy-a','strategy-b']) await db.agent.create({data:{id,creatorId:'owner',name:id,description:'Fixture',category:'Signals',market:'crypto',tags:[],versions:{create:[1,2,3].map(number=>({number,config:defaultConfig,priceCents:100,setupInstructions:'Fixture'}))}}});
    const rows=await db.agent.findMany({where:{creatorId:'owner'},orderBy:{name:'asc'},select:{id:true,versions:{orderBy:{number:'desc'},take:1,select:{number:true}}}});
    expect(rows).toEqual([{id:'strategy-a',versions:[{number:3}]},{id:'strategy-b',versions:[{number:3}]}]);
  });
  it('filters parent records through related ownership and returns dates as UTC', async () => {
    const date=new Date('2026-10-24T00:15:30.123Z');
    await db.walletChallenge.create({data:{id:'timestamp-fixture',walletAddress:'0x'+'b'.repeat(40),chainId:1,domain:'localhost',message:'Fixture',expiresAt:date}});
    const originalTimezone=process.env.TZ; process.env.TZ='Pacific/Honolulu';
    try { expect((await db.walletChallenge.findUniqueOrThrow({where:{id:'timestamp-fixture'}})).expiresAt.toISOString()).toBe(date.toISOString()); }
    finally { if(originalTimezone===undefined)delete process.env.TZ;else process.env.TZ=originalTimezone; }
    expect(await db.agentVersion.count({where:{agent:{creatorId:'owner'}}})).toBe(6);
    expect(await db.agentVersion.count({where:{agent:{creatorId:'another-owner'}}})).toBe(0);
  });
  it('serializes concurrent queries inside a transaction and rolls back all writes on failure', async () => {
    await expect(db.transaction(async tx=>{await Promise.all([tx.setting.create({data:{key:'rollback-a',value:'1'}}),tx.setting.create({data:{key:'rollback-b',value:'2'}})]);throw new Error('Rollback fixture');})).rejects.toThrow('Rollback fixture');
    expect(await db.setting.count({where:{key:{in:['rollback-a','rollback-b']}}})).toBe(0);
  });
});

describe('existing database adoption', () => {
  it('retains account records and archives legacy migration metadata without recreating them', async () => {
    const pg=await PGlite.create();
    try {
      await pg.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY,"walletAddress" TEXT UNIQUE,name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'USER',"emergencyStop" BOOLEAN NOT NULL DEFAULT false,"inboxEnabled" BOOLEAN NOT NULL DEFAULT true,disabled BOOLEAN NOT NULL DEFAULT false,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO "User" (id,name) VALUES ('existing-owner','Existing owner');
        CREATE TABLE "_prisma_migrations" (id TEXT PRIMARY KEY,migration_name TEXT); INSERT INTO "_prisma_migrations" VALUES ('history','historical_migration');`);
      await migrateEmbedded(pg); await migrateEmbedded(pg);
      expect((await pg.query('SELECT id,name FROM "User"')).rows).toEqual([{id:'existing-owner',name:'Existing owner'}]);
      expect((await pg.query('SELECT id,migration_name FROM wagent_internal.previous_migrations')).rows).toEqual([{id:'history',migration_name:'historical_migration'}]);
      expect((await pg.query("SELECT to_regclass('public.\"_prisma_migrations\"') AS old_table")).rows).toEqual([{old_table:null}]);
      expect((await pg.query('SELECT count(*)::int AS count FROM supabase_migrations.schema_migrations')).rows).toEqual([{count:1}]);
    } finally {await pg.close();}
  });
});
