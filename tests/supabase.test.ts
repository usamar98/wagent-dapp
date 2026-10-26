import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {migrateEmbedded} from '../scripts/database.js';
import {hostedConfig} from '../shared/hosted-config.js';
import {databaseSchema} from '../server/database/schema.js';

const valid = {NODE_ENV:'development',DATABASE_URL:'postgresql://postgres.test:fixture@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=verify-full',CREDENTIAL_ENCRYPTION_KEY:'a'.repeat(64),DEMO_MODE:'false',PAYMENT_PROVIDER:'stripe_test',APP_URL:'http://localhost:5173'};
describe('hosted database configuration',()=>{
  it('uses the hosted database without replacing it with the embedded demo',()=>{expect(hostedConfig(valid)).toEqual({appUrl:'http://localhost:5173',apiPort:4000,databaseHost:'aws-0-us-east-1.pooler.supabase.com'});});
  it('rejects API URLs, placeholders, unsafe startup modes, and incorrect wallet origins',()=>{for(const change of [{DATABASE_URL:'https://example.supabase.co'},{DATABASE_URL:'postgresql://postgres.PROJECT_REF:ENCODED_PASSWORD@POOLER_HOST:6543/postgres?sslmode=verify-full'},{CREDENTIAL_ENCRYPTION_KEY:'replace_me'},{DEMO_MODE:'true'},{PAYMENT_PROVIDER:'simulator'},{NODE_ENV:'production'},{APP_URL:'http://localhost:3000'},{APP_URL:'https://wagent-ai.vercel.app'},{PORT:'5173'},{DATABASE_URL:valid.DATABASE_URL.replace('?sslmode=verify-full','')}])expect(()=>hostedConfig({...valid,...change})).toThrow();});
  it('keeps connection passwords out of validation errors',()=>{try{hostedConfig({...valid,DATABASE_URL:'postgresql://postgres:private-password@example.invalid/db'});}catch(error){expect(String(error)).not.toContain('private-password');}});
});

describe('Supabase table isolation',()=>{
  let db:PGlite;
  beforeAll(async()=>{db=await PGlite.create();await migrateEmbedded(db);await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE unrelated_app (id TEXT PRIMARY KEY); GRANT USAGE ON SCHEMA public TO anon,authenticated; GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated;`);});
  afterAll(async()=>{await db?.close();});
  it('enables RLS for every Wagent table without changing unrelated tables',async()=>{await db.exec(await readFile(new URL('../supabase/harden.sql',import.meta.url),'utf8'));const rows=await db.query<{name:string;enabled:boolean}>(`SELECT relname AS name,relrowsecurity AS enabled FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'`);for(const model of Object.keys(databaseSchema))expect(rows.rows.find(row=>row.name===model)?.enabled).toBe(true);expect(rows.rows.find(row=>row.name==='unrelated_app')?.enabled).toBe(false);});
  it('denies direct browser-role reads of sessions, credentials, and financial records',async()=>{for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);try{for(const table of ['Session','PersonalAgentChannel','BrokerAuthorization','Order','TradeIntent','SolanaTradingWallet','SolanaTradePermission','SolanaPermissionChallenge','SolanaChatTrade','SolanaWalletWithdrawal'])await expect(db.query(`SELECT * FROM "${table}"`)).rejects.toThrow(/permission denied/);}finally{await db.exec('RESET ROLE');}}});
  it('allows the backend database owner and can be applied again',async()=>{await expect(db.query('SELECT * FROM "User" LIMIT 0')).resolves.toBeDefined();await expect(db.exec(await readFile(new URL('../supabase/harden.sql',import.meta.url),'utf8'))).resolves.toBeDefined();});
});
