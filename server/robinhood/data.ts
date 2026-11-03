import { randomUUID } from 'node:crypto';
import { db, transaction, lockUser, type Tx } from '../db.js';
import { check } from '../security.js';
import { type RhFeed, type RhToken, isEvmAddress, ETH_TOKEN } from '../../shared/robinhood.js';
import { assetBalance, evmAddress, fetchBounded, fromWei, readiness, rpc, tokenInfo } from './providers.js';
import { walletFor, type RhWallet } from './access.js';
import { operationList } from './operations.js';
import { discoverRhTokens, normalizeRhPairs } from './discovery.js';
export { normalizeRhPairs } from './discovery.js';
const feeds=new Map<string,{at:number;feed:RhFeed}>(),inflight=new Map<string,Promise<RhFeed>>();
export async function rhFeed(query='',tokens?:string[]):Promise<RhFeed>{
  const exact=tokens?.map(evmAddress),key=exact?'tokens:'+exact.sort().join(','):'query:'+query;const cached=feeds.get(key);if(cached&&Date.now()-cached.at<60000)return cached.feed;if(inflight.has(key))return inflight.get(key)!;
  const task=(async()=>{try{let raw:any,requested=exact,discovered:Awaited<ReturnType<typeof discoverRhTokens>>|undefined;const get=(path:string,signal?:AbortSignal)=>fetchBounded('https://api.dexscreener.com'+path,{signal},'DEX Screener');
    if(exact)raw=exact.length?await get('/tokens/v1/robinhood/'+exact.join(',')):[];
    else if(isEvmAddress(query)){requested=[evmAddress(query)];raw=await get('/tokens/v1/robinhood/'+requested[0]);}
    else discovered=await discoverRhTokens(get,cached?.feed.tokens.map(t=>t.address)||[],query);
    const feed:RhFeed={tokens:discovered?.tokens||normalizeRhPairs(raw,requested).sort((a,b)=>(b.liquidityUsd||0)-(a.liquidityUsd||0)),...(discovered?{discovery:discovered.discovery}:{}),source:'DEX Screener',fetchedAt:new Date().toISOString(),stale:false,coverage:discovered?'Combined profile, community, promotion and market searches, with indexed pool expansion. Coverage is not exhaustive; pool age is not token launch time.':'Indexed Robinhood pools for the requested token addresses. Pool age is not token launch time.'};if(feeds.size>=80)feeds.delete(feeds.keys().next().value!);feeds.set(key,{at:Date.now(),feed});return feed;
  }catch(e){if(cached&&Date.now()-cached.at<300000)return {...cached.feed,stale:true};throw e;}})().finally(()=>inflight.delete(key));inflight.set(key,task);return task;
}
const watchKey=(id:string)=>'robinhood:watchlist:'+id;
export async function watchlist(userId:string,tx:Tx=db){const row=await tx.setting.findUnique({where:{key:watchKey(userId)}});let tokens:string[]=[];try{tokens=JSON.parse(row?.value||'[]').filter((v:unknown)=>typeof v==='string'&&isEvmAddress(v)).map(evmAddress);}catch{/* Old malformed settings are not trading authority. */}return [...new Set(tokens)].slice(0,30);}
export async function setWatched(userId:string,address:string,watched:boolean){return transaction(async tx=>{await lockUser(tx,userId);const values=new Set(await watchlist(userId,tx));if(watched)values.add(evmAddress(address));else values.delete(evmAddress(address));check(values.size<=30,400,'Your watchlist can hold 30 tokens.');const value=JSON.stringify([...values]),key=watchKey(userId);await tx.setting.upsert({where:{key},create:{key,value},update:{value}});return [...values];});}
export async function portfolio(userId:string,source:'TRADING'|'OWNER'='TRADING'){
  const deadline=Date.now()+20000;
  const wallet=await walletFor(userId);if(!wallet)return {source,wallet:null,native:null,tokens:[],history:[],totalUsd:null,partial:false,error:null,at:new Date().toISOString()};
  const address=source==='TRADING'?wallet.address:wallet.ownerAddress,history=await operationList(userId);const native=fromWei(await assetBalance(address));
  let partial=false;const discovered=new Set<string>([...(await watchlist(userId)),...history.map(h=>h.tokenAddress).filter(t=>t!==ETH_TOKEN)]);
  try{const raw=await rpc('alchemy_getTokenBalances',[address,'erc20']);check(Array.isArray(raw?.tokenBalances)&&raw.tokenBalances.length<=1000,502,'Token index is unavailable.');for(const item of raw.tokenBalances)if(isEvmAddress(item.contractAddress||'')&&item.tokenBalance&&BigInt(item.tokenBalance)>0n)discovered.add(evmAddress(item.contractAddress));}catch{partial=true;}
  const addresses=[...discovered].slice(0,60);if(discovered.size>60)partial=true;const tokens:any[]=[];
  // Bounded sequential reads respect free RPC limits and isolate malformed tokens.
  for(const token of addresses){if(Date.now()>deadline){partial=true;break;}try{const amount=await assetBalance(address,token);if(amount===0n)continue;const info=await tokenInfo(token);tokens.push({...info,amount:fromWei(amount,info.decimals),rawAmount:amount.toString(),priceUsd:null,valueUsd:null});}catch{partial=true;}}
  const prices=new Map<string,RhToken>();let pricesAt:string|null=null,pricesStale=false,priceError:string|null=null;
  for(let i=0;i<tokens.length;i+=30){try{const feed=await rhFeed('',tokens.slice(i,i+30).map(t=>t.address));feed.tokens.forEach(t=>prices.set(t.address,t));pricesAt=feed.fetchedAt;pricesStale=pricesStale||feed.stale;}catch{priceError='Token prices are temporarily unavailable.';}}
  for(const token of tokens){const p=prices.get(token.address);token.priceUsd=p?.priceUsd??null;const value=token.priceUsd===null?null:Number(token.amount)*token.priceUsd;token.valueUsd=value!==null&&Number.isFinite(value)?value:null;token.liquidityUsd=p?.liquidityUsd??null;token.change24h=p?.change24h??null;}
  return {source,wallet:{address,ownerAddress:wallet.ownerAddress,tradingAddress:wallet.address},native,tokens,history,totalUsd:tokens.every(t=>t.valueUsd!==null)?tokens.reduce((sum,t)=>sum+t.valueUsd,0):null,partial,error:priceError,at:new Date().toISOString(),pricesAt,pricesStale,nativeValueUsd:null};
}
export type RhAlert={id:string;userId:string;name:string;kind:'DISCOVERY'|'PRICE_ABOVE'|'PRICE_BELOW'|'LIQUIDITY_BELOW';tokenAddress:string|null;threshold:number|null;minLiquidityUsd:number;delivery:'IN_APP'|'WHATSAPP';enabled:boolean;cooldownMinutes:number;lastMatched:boolean;lastCheckedAt:Date|null;lastTriggeredAt:Date|null;baselineAt:Date|null;lastError:string|null;createdAt:Date};
export async function alertState(userId:string){return {rules:await db.sql<RhAlert>`SELECT * FROM "RHAlert" WHERE "userId"=${userId} ORDER BY "createdAt" DESC`,events:await db.sql`SELECT * FROM "RHAlertEvent" WHERE "userId"=${userId} ORDER BY "createdAt" DESC LIMIT 40`};}
export async function tickRhAlerts(options:{limit?:number;deadline?:number}={}){
  if(process.env.ROBINHOOD_ALERTS_ENABLED==='false')return;const before=new Date(Date.now()-60000),rows=await db.sql<RhAlert>`SELECT * FROM "RHAlert" WHERE enabled=true AND ("lastCheckedAt" IS NULL OR "lastCheckedAt"<${before}) ORDER BY "lastCheckedAt" ASC NULLS FIRST LIMIT ${Math.min(options.limit??20,20)}`;
  for(const rule of rows){if(options.deadline&&Date.now()>=options.deadline)break;
    const claimed=await db.sql`UPDATE "RHAlert" SET "lastCheckedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${rule.id} AND enabled=true AND ("lastCheckedAt" IS NULL OR "lastCheckedAt"<${before}) RETURNING id`;if(!claimed.length)continue;
    try{const user=await db.user.findUnique({where:{id:rule.userId}});if(!user||user.disabled||user.emergencyStop)continue;const feed=await rhFeed('',rule.kind==='DISCOVERY'?undefined:[rule.tokenAddress!]);if(feed.stale)continue;
      await transaction(async tx=>{await lockUser(tx,rule.userId);const fresh=(await tx.sql<RhAlert>`SELECT * FROM "RHAlert" WHERE id=${rule.id} AND enabled=true`)[0],activeUser=await tx.user.findUnique({where:{id:rule.userId}});if(!fresh||activeUser?.emergencyStop||activeUser?.disabled)return;
        let hits:RhToken[]=[];if(rule.kind==='DISCOVERY'){
          for(const token of feed.tokens)await tx.sql`INSERT INTO "RHDiscovery" (address) VALUES (${token.address}) ON CONFLICT (address) DO UPDATE SET "lastSeenAt"=timezone('UTC',CURRENT_TIMESTAMP)`;
          if(fresh.baselineAt){const since=new Date(Date.now()-3600000),newRows=await tx.sql<{address:string}>`SELECT address FROM "RHDiscovery" WHERE "firstSeenAt">${fresh.baselineAt} AND "firstSeenAt">${since}`;const found=new Set(newRows.map(r=>r.address));hits=feed.tokens.filter(t=>found.has(t.address)&&(t.liquidityUsd??0)>=fresh.minLiquidityUsd).slice(0,5);}
          else await tx.sql`UPDATE "RHAlert" SET "baselineAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${rule.id}`;
        }else{const item=feed.tokens[0],metric=rule.kind==='LIQUIDITY_BELOW'?item?.liquidityUsd:item?.priceUsd,match=metric!=null&&(rule.kind==='PRICE_ABOVE'?metric>=rule.threshold!:metric<=rule.threshold!);if(match&&!fresh.lastMatched&&(!fresh.lastTriggeredAt||Date.now()-fresh.lastTriggeredAt.getTime()>=fresh.cooldownMinutes*60000))hits=item?[item]:[];await tx.sql`UPDATE "RHAlert" SET "lastMatched"=${match} WHERE id=${rule.id}`;}
        for(const token of hits){const dedupe=rule.kind==='DISCOVERY'?rule.id+':'+token.address:rule.id+':'+feed.fetchedAt,id=randomUUID(),title=`${rule.name} · ${token.symbol}`,body=`ROBINHOOD TOKEN ALERT\n${title}\nToken address: ${token.address}\nPrice USD: ${token.priceUsd??'unavailable'}\nLiquidity USD: ${token.liquidityUsd??'unavailable'}\nData at: ${feed.fetchedAt}\n${token.screenerUrl}\nIndexed discovery is not a safety endorsement or a complete launch feed.`;
          const inserted=await tx.sql`INSERT INTO "RHAlertEvent" (id,"userId","ruleId","dedupeKey",title,body) VALUES (${id},${rule.userId},${rule.id},${dedupe},${title},${body}) ON CONFLICT ("dedupeKey") DO NOTHING RETURNING id`;if(!inserted.length)continue;
          if(fresh.delivery==='WHATSAPP'){const channel=await tx.personalAgentChannel.findUnique({where:{slot:1,userId:rule.userId}});if(channel?.enabled&&channel.ownerId)await tx.agentCommand.create({data:{userId:rule.userId,source:'RH_ALERT',externalId:id,text:title,reply:body,status:'COMPLETED',channelId:channel.id,recipientId:channel.ownerId,deliveryStatus:'PENDING'}});}
          await tx.sql`UPDATE "RHAlert" SET "lastTriggeredAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${rule.id}`;
        }await tx.sql`UPDATE "RHAlert" SET "lastError"=NULL WHERE id=${rule.id}`;
      });
    }catch{await db.sql`UPDATE "RHAlert" SET "lastError"='Provider check failed. Missing or stale observations do not trigger alerts.' WHERE id=${rule.id}`;}
  }
}
