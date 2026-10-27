import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('migrates old grants as restricted and requires explicit consent for broad database records',async()=>{
  const pg=await PGlite.create();
  try{
    await pg.exec(`CREATE TABLE "SolanaTradePermission" (id text PRIMARY KEY,"allowedMints" text[] NOT NULL CHECK(cardinality("allowedMints") BETWEEN 1 AND 10),"consentMessage" text NOT NULL);
      INSERT INTO "SolanaTradePermission" VALUES ('old',ARRAY['original-mint'],E'\nAllowed mints: original-mint\n');`);
    await pg.exec(await readFile('supabase/migrations/20261027185906_any_solana_token_permission_scope.sql','utf8'));
    expect((await pg.query('SELECT "tokenScope","allowedMints" FROM "SolanaTradePermission" WHERE id=$1',['old'])).rows).toEqual([{tokenScope:'AGENT_MINTS',allowedMints:['original-mint']}]);
    await expect(pg.exec(`UPDATE "SolanaTradePermission" SET "tokenScope"='ANY_SOLANA',"allowedMints"=ARRAY[]::text[] WHERE id='old'`)).rejects.toThrow();
    for(const [scope,mints] of [['AGENT_MINTS',[]],['ANY_SOLANA',['unneeded-mint']],['UNKNOWN',[]]] as const)await expect(pg.query('INSERT INTO "SolanaTradePermission" (id,"tokenScope","allowedMints","consentMessage") VALUES ($1,$2,$3,$4)',[scope,scope,[...mints],'\nToken scope: Any supported Solana token\nAllowed mints: Any supported Solana token\n'])).rejects.toThrow();
    await pg.query('INSERT INTO "SolanaTradePermission" (id,"tokenScope","allowedMints","consentMessage") VALUES ($1,$2,$3,$4)',['new','ANY_SOLANA',[],'\nToken scope: Any supported Solana token\nAllowed mints: Any supported Solana token\n']);
    expect((await pg.query('SELECT "tokenScope" FROM "SolanaTradePermission" WHERE id=$1',['new'])).rows).toEqual([{tokenScope:'ANY_SOLANA'}]);
  }finally{await pg.close();}
});
