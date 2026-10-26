import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db, transaction, lockUser, type Tx } from './db.js';
import { auth, check, AppError, token } from './security.js';
import { rateLimitKey } from './rate-limit.js';
import { addressSchema, providerStatus, newToolsPools, toolsTokenPrice, type ToolsPool } from './solana-providers.js';
import { discoverTokens } from './solana.js';
import type { ModelRows } from './database/schema.js';

type Rule=ModelRows['SolanaAlertRule'];
const ruleInput=z.object({name:z.string().trim().min(2).max(80),kind:z.enum(['PRICE_ABOVE','PRICE_BELOW','LIQUIDITY_BELOW','NEW_POOL']),source:z.enum(['DEX_SCREENER','DEXTOOLS']),mint:addressSchema.nullable(),threshold:z.number().finite().positive().max(1e15).nullable(),delivery:z.enum(['IN_APP','BOTH']),minLiquidityUsd:z.number().finite().min(0).max(1e15).default(0),maxPoolAgeMinutes:z.number().int().min(1).max(1440).default(60),cooldownMinutes:z.number().int().min(5).max(10080).default(30)}).strict().superRefine((v,c)=>{
  if(v.kind==='NEW_POOL'?(v.source!=='DEXTOOLS'||v.mint!==null||v.threshold!==null):(v.mint===null||v.threshold===null))c.addIssue({code:'custom',message:'New-pool rules use DEXTools without a mint/price; other rules need an exact mint and threshold.'});
  if(v.kind==='LIQUIDITY_BELOW'&&v.source!=='DEX_SCREENER')c.addIssue({code:'custom',message:'Liquidity thresholds use DEX Screener’s most liquid indexed pool.'});
});
let poolsPending:Promise<{pools:ToolsPool[];complete:boolean;at:Date}>|undefined;
let poolCache:{pools:ToolsPool[];complete:boolean;at:Date}|undefined;
const priceCache=new Map<string,{price:number;at:Date}>();
const pricePending=new Map<string,Promise<{price:number;at:Date}>>();
export function clearAlertProviderCache(){poolCache=undefined;poolsPending=undefined;priceCache.clear();pricePending.clear();}
async function pools(){
  if(poolCache&&Date.now()-poolCache.at.getTime()<60000)return poolCache;
  if(!poolsPending)poolsPending=newToolsPools(new Date(Date.now()-86400000),new Date()).then(data=>poolCache={...data,at:new Date()}).finally(()=>{poolsPending=undefined;});
  return poolsPending;
}
async function toolsPrice(mint:string){
  const cached=priceCache.get(mint);if(cached&&Date.now()-cached.at.getTime()<60000)return cached;
  if(!pricePending.has(mint))pricePending.set(mint,toolsTokenPrice(mint).then(price=>{if(priceCache.size>=200)priceCache.delete(priceCache.keys().next().value!);const observation={price,at:new Date()};priceCache.set(mint,observation);return observation;}).finally(()=>pricePending.delete(mint)));
  return pricePending.get(mint)!;
}
async function emit(tx:Tx,rule:Rule,dedupeKey:string,title:string,body:string,snapshot:unknown){
  if(await tx.solanaAlertEvent.findFirst({where:{ruleId:rule.id,dedupeKey}}))return false;
  const event=await tx.solanaAlertEvent.create({data:{userId:rule.userId,ruleId:rule.id,dedupeKey,title,body,snapshot}});
  const user=await tx.user.findUniqueOrThrow({where:{id:rule.userId}});
  if(user.inboxEnabled)await tx.notification.create({data:{userId:rule.userId,channel:'in_app',title,body}});
  if(rule.delivery==='BOTH'){
    const channel=await tx.personalAgentChannel.findUnique({where:{userId:rule.userId}});
    if(channel?.enabled&&channel.ownerId)await tx.agentCommand.create({data:{userId:rule.userId,source:'ALERT',externalId:event.id,text:`Alert: ${rule.name}`,reply:body,status:'COMPLETED',channelId:channel.id,recipientId:channel.ownerId,deliveryStatus:'PENDING'}});
  }
  return true;
}
async function cancelRuleDelivery(tx:Tx,userId:string,ruleId:string){
  await tx.sql`UPDATE "AgentCommand" AS c SET "deliveryStatus"='CANCELLED' FROM "SolanaAlertEvent" AS e WHERE c."userId"=${userId} AND c.source='ALERT' AND c."externalId"=e.id AND e."ruleId"=${ruleId} AND c."deliveryStatus" IN ('PENDING','RETRY')`;
}
export async function checkAlert(rule:Rule){
  try{
    check(providerStatus().alertsEnabled,503,'Alerts are disabled by the server.');
    let observation:{at:Date;value:number;pair?:string}|undefined,launches:Awaited<ReturnType<typeof pools>>|undefined;
    if(rule.kind==='NEW_POOL')launches=await pools();
    else if(rule.source==='DEXTOOLS'){const data=await toolsPrice(rule.mint!);observation={at:data.at,value:data.price};}
    else{
      const feed=await discoverTokens('',[rule.mint!]);check(!feed.stale&&Date.now()-Date.parse(feed.fetchedAt)<90000,502,'Fresh DEX Screener data is unavailable. The rule was not evaluated.');
      const found=feed.tokens.find(t=>t.mint===rule.mint),value=rule.kind==='LIQUIDITY_BELOW'?found?.liquidityUsd:found?.priceUsd;
      check(typeof value==='number'&&Number.isFinite(value),502,'This mint has no indexed price/liquidity yet. The rule was not evaluated.');observation={at:new Date(feed.fetchedAt),value,pair:found!.pairAddress};
    }
    await transaction(async tx=>{
      await lockUser(tx,rule.userId);
      const current=await tx.solanaAlertRule.findFirst({where:{id:rule.id,userId:rule.userId,enabled:true}}),user=await tx.user.findUnique({where:{id:rule.userId}});
      if(!current||!user||user.disabled||user.emergencyStop)return;
      const now=new Date();
      if(launches){
        let count=0;
        const previous=await tx.solanaAlertEvent.findMany({where:{ruleId:current.id,dedupeKey:{in:launches.pools.map(p=>p.address)}},select:{dedupeKey:true}});
        const reported=new Set(previous.map(e=>e.dedupeKey));
        for(const pool of launches.pools){
          const created=Date.parse(pool.creationTime);
          if(reported.has(pool.address)||created<current.createdAt.getTime()||created>now.getTime()||now.getTime()-created>current.maxPoolAgeMinutes*60000||pool.liquidityUsd<current.minLiquidityUsd)continue;
          // Each indexed pool is reported once. This does not claim a newly minted token.
          const title=`New Solana pool · ${pool.mainToken.symbol}`;
          const body=`${title}\n${pool.mainToken.name}\nMint: ${pool.mainToken.address}\nPool liquidity: $${pool.liquidityUsd.toLocaleString('en-US')}\nIndexed by DEXTools. Pool creation is not token mint creation.\nhttps://www.dextools.io/app/en/solana/pair-explorer/${pool.address}`;
          if(await emit(tx,current,pool.address,title,body,pool))count++;
          if(count>=5)break;
        }
        await tx.solanaAlertRule.update({where:{id:current.id},data:{lastCheckedAt:now,lastObservedAt:launches.at,lastError:!launches.complete?'Busy feed: only the newest 200 indexed pools were scanned. Some pools may be missed.':null,...(count?{lastTriggeredAt:now}:{})}});
      }else if(observation){
        if(current.lastObservedAt&&current.lastObservedAt>=observation.at){await tx.solanaAlertRule.update({where:{id:current.id},data:{lastCheckedAt:now}});return;}
        const matches=current.kind==='PRICE_ABOVE'?observation.value>current.threshold!:observation.value<current.threshold!;
        const cooled=!current.lastTriggeredAt||now.getTime()-current.lastTriggeredAt.getTime()>=current.cooldownMinutes*60000;
        const trigger=matches&&!current.lastMatched&&cooled;
        if(trigger){const title=`${current.name} · threshold reached`,body=`${title}\nMint: ${current.mint}\n${current.kind==='LIQUIDITY_BELOW'?'Pool liquidity':'Price'}: $${observation.value}\nThreshold: $${current.threshold}\nSource: ${current.source==='DEXTOOLS'?'DEXTools':'DEX Screener'}\nObserved: ${observation.at.toISOString()}\nThis alert does not place a trade.`;await emit(tx,current,observation.at.toISOString(),title,body,observation);}
        await tx.solanaAlertRule.update({where:{id:current.id},data:{lastCheckedAt:now,lastObservedAt:observation.at,lastMatched:matches,lastError:null,...(trigger?{lastTriggeredAt:now}:{})}});
      }
    });
  }catch(error){await db.solanaAlertRule.updateMany({where:{id:rule.id,userId:rule.userId},data:{lastCheckedAt:new Date(),lastError:error instanceof AppError?error.message:'Alert data could not be checked. No trade was placed.'}});}
}
export async function tickSolanaAlerts(userId?:string){
  if(!providerStatus().alertsEnabled)return;
  // A persisted lease coordinates web checks and background workers without holding a DB transaction across HTTP.
  const lease=token(),key='solana:alert-worker';
  const claimed=await transaction(async tx=>{
    await tx.sql`SELECT pg_advisory_xact_lock(870261)`;
    const saved=await tx.setting.findUnique({where:{key}}),state=saved?JSON.parse(saved.value):{};
    if(state.until>Date.now()||(!userId&&state.next>Date.now()))return false;
    const value=JSON.stringify({token:lease,until:Date.now()+300000,next:Date.now()+60000});await tx.setting.upsert({where:{key},create:{key,value},update:{value}});return true;
  });
  if(!claimed)return;
  try{
    const due=userId?await db.solanaAlertRule.findMany({where:{userId,enabled:true},take:20}):await db.sql<{id:string}>`SELECT id FROM "SolanaAlertRule" WHERE enabled=true AND ("lastCheckedAt" IS NULL OR "lastCheckedAt" < ${new Date(Date.now()-60000)}) ORDER BY "lastCheckedAt" ASC NULLS FIRST LIMIT 20`;
    const rules=userId?due as Rule[]:await db.solanaAlertRule.findMany({where:{id:{in:due.map(r=>r.id)}}});
    for(let i=0;i<rules.length;i+=4)await Promise.allSettled(rules.slice(i,i+4).map(checkAlert));
  }finally{
    await transaction(async tx=>{await tx.sql`SELECT pg_advisory_xact_lock(870261)`;const saved=await tx.setting.findUnique({where:{key}});if(saved){const state=JSON.parse(saved.value);if(state.token===lease)await tx.setting.update({where:{key},data:{value:JSON.stringify({...state,until:0})}});}});
  }
}
export const solanaAlertsRouter=Router();solanaAlertsRouter.use(auth);
solanaAlertsRouter.get('/alerts',async(req,res)=>{
  const userId=req.user!.id;
  const [rules,events,worker,channel,deliveries]=await Promise.all([db.solanaAlertRule.findMany({where:{userId},orderBy:{createdAt:'desc'}}),db.solanaAlertEvent.findMany({where:{userId},orderBy:{createdAt:'desc'},take:40}),db.setting.findUnique({where:{key:'workerHeartbeat'}}),db.personalAgentChannel.findUnique({where:{userId}}),db.agentCommand.findMany({where:{userId,source:'ALERT'},select:{externalId:true,deliveryStatus:true},orderBy:{createdAt:'desc'},take:100})]);
  res.json({rules,events:events.map(e=>({...e,deliveryStatus:deliveries.find(d=>d.externalId===e.id)?.deliveryStatus||'IN_APP'})),providers:providerStatus(),workerOnline:!!worker&&Date.now()-Number(worker.value)<30000,whatsappPaired:!!channel?.enabled&&!!channel.ownerId});
});
solanaAlertsRouter.post('/alerts',async(req,res)=>{
  check(providerStatus().alertsEnabled,503,'Alerts are disabled by the server.');const input=ruleInput.parse(req.body);
  check(input.source!=='DEXTOOLS'||providerStatus().dextools,503,'Add DEXTOOLS_API_KEY to enable this source. DEX Screener price and liquidity alerts work without a key.');
  const rule=await transaction(async tx=>{
    const userId=req.user!.id;await lockUser(tx,userId);check(!(await tx.user.findUniqueOrThrow({where:{id:userId}})).emergencyStop,409,'Clear emergency stop before adding alerts.');
    check(await tx.solanaAlertRule.count({where:{userId}})<20,400,'You can save up to 20 alert rules.');
    if(input.delivery==='BOTH'){const channel=await tx.personalAgentChannel.findUnique({where:{userId}});check(channel?.enabled&&channel.ownerId,409,'Pair your personal WhatsApp agent before enabling WhatsApp alerts.');}
    return tx.solanaAlertRule.create({data:{userId,...input}});
  });res.status(201).json(rule);
});
solanaAlertsRouter.post('/alerts/:id/toggle',async(req,res)=>{
  const {enabled}=z.object({enabled:z.boolean()}).strict().parse(req.body);
  await transaction(async tx=>{await lockUser(tx,req.user!.id);const rule=await tx.solanaAlertRule.findFirst({where:{id:String(req.params.id),userId:req.user!.id}});check(rule,404,'Alert rule not found.');if(enabled){check(providerStatus().alertsEnabled,503,'Alerts are disabled.');check(rule.source!=='DEXTOOLS'||providerStatus().dextools,503,'DEXTOOLS_API_KEY is required for this rule.');check(!(await tx.user.findUniqueOrThrow({where:{id:req.user!.id}})).emergencyStop,409,'Clear emergency stop first.');if(rule.delivery==='BOTH'){const channel=await tx.personalAgentChannel.findUnique({where:{userId:req.user!.id}});check(channel?.enabled&&channel.ownerId,409,'Pair WhatsApp before enabling this rule.');}}else await cancelRuleDelivery(tx,req.user!.id,rule.id);await tx.solanaAlertRule.update({where:{id:rule.id},data:{enabled}});});res.json({ok:true});
});
solanaAlertsRouter.post('/alerts/:id/delete',async(req,res)=>{await transaction(async tx=>{await lockUser(tx,req.user!.id);await cancelRuleDelivery(tx,req.user!.id,String(req.params.id));await tx.solanaAlertRule.deleteMany({where:{id:String(req.params.id),userId:req.user!.id}});});res.json({ok:true});});
solanaAlertsRouter.post('/alerts/check',rateLimit({windowMs:60000,limit:2,keyGenerator:rateLimitKey,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{await tickSolanaAlerts(req.user!.id);res.json({ok:true});});
