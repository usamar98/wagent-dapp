import { db } from './db.js';
import { check } from './security.js';
import type { TokenFeed } from '../shared/solana.js';
import type { ModelRows } from './database/schema.js';

let observations=new WeakMap<TokenFeed,Promise<ModelRows['SolanaTokenDiscovery'][]>>();
export function clearDiscoveryCache(){observations=new WeakMap();}
export function observeDiscoveries(feed:TokenFeed){
  check(!feed.stale&&Date.now()-Date.parse(feed.fetchedAt)<90000,502,'Fresh DEX Screener discovery data is unavailable. No discovery alerts were evaluated.');
  const saved=observations.get(feed);if(saved)return saved;
  const at=new Date(feed.fetchedAt),mints=JSON.stringify([...new Set(feed.tokens.map(t=>t.mint))]);
  const result=db.sql<ModelRows['SolanaTokenDiscovery']>`INSERT INTO "SolanaTokenDiscovery" (mint,"firstSeenAt","lastSeenAt") SELECT value,${at},${at} FROM jsonb_array_elements_text(${mints}::jsonb) ON CONFLICT (mint) DO UPDATE SET "firstSeenAt"=LEAST("SolanaTokenDiscovery"."firstSeenAt",EXCLUDED."firstSeenAt"),"lastSeenAt"=GREATEST("SolanaTokenDiscovery"."lastSeenAt",EXCLUDED."lastSeenAt") RETURNING mint,"firstSeenAt","lastSeenAt"`;
  observations.set(feed,result);result.catch(()=>observations.delete(feed));return result;
}
