import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db, transaction, lockUser, type Tx } from './db.js';
import { auth, check, AppError, token } from './security.js';
import { rateLimitKey } from './rate-limit.js';
import { addressSchema, providerStatus } from './solana-providers.js';
import { discoverTokens } from './solana.js';
import { clearDiscoveryCache, observeDiscoveries } from './solana-discovery.js';
import type { TokenFeed } from '../shared/solana.js';
import type { ModelRows } from './database/schema.js';

type Rule=ModelRows['SolanaAlertRule'];
const ruleInput=z.object({name:z.string().trim().min(2).max(80),kind:z.enum(['PRICE_ABOVE','PRICE_BELOW','LIQUIDITY_BELOW','NEW_DISCOVERY']),source:z.literal('DEX_SCREENER'),mint:addressSchema.nullable(),threshold:z.number().finite().positive().max(1e15).nullable(),delivery:z.enum(['IN_APP','BOTH']),minLiquidityUsd:z.number().finite().min(0).max(1e15).default(0),maxDiscoveryAgeMinutes:z.number().int().min(1).max(1440).default(60),cooldownMinutes:z.number().int().min(5).max(10080).default(30)}).strict().superRefine((v,c)=>{
  if(v.kind==='NEW_DISCOVERY'?(v.mint!==null||v.threshold!==null):(v.mint===null||v.threshold===null))c.addIssue({code:'custom',message:'Discovery rules do not use a mint/threshold. Price and liquidity rules need an exact mint and threshold.'});
});
export const clearAlertProviderCache=clearDiscoveryCache;
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
    let observation:{at:Date;value:number;pair?:string}|undefined,discovery:TokenFeed|undefined;
    let discovered:ModelRows['SolanaTokenDiscovery'][]=[];
    if(rule.kind==='NEW_DISCOVERY'){discovery=await discoverTokens();discovered=await observeDiscoveries(discovery);}
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
      if(discovery){
        const at=new Date(discovery.fetchedAt);
        if(!current.discoveryBaselineAt){await tx.solanaAlertRule.update({where:{id:current.id},data:{discoveryBaselineAt:new Date(Math.max(at.getTime(),current.createdAt.getTime())),lastCheckedAt:now,lastObservedAt:at,lastError:null}});return;}
        let count=0;
        const previous=await tx.solanaAlertEvent.findMany({where:{ruleId:current.id,dedupeKey:{in:discovery.tokens.map(t=>t.mint)}},select:{dedupeKey:true}});
        const reported=new Set(previous.map(e=>e.dedupeKey));
        for(const item of discovery.tokens){
          const seen=discovered.find(row=>row.mint===item.mint)?.firstSeenAt;
          if(!seen||reported.has(item.mint)||seen<=current.discoveryBaselineAt||seen>now||now.getTime()-seen.getTime()>current.maxDiscoveryAgeMinutes*60000||item.liquidityUsd===null||item.liquidityUsd<current.minLiquidityUsd)continue;
          const title=`Newly discovered Solana token · ${item.symbol}`;
          const body=`${title}\n${item.name}\nMint: ${item.mint}\nPool liquidity: $${item.liquidityUsd.toLocaleString('en-US')}\nFirst observed by Wagent Ai: ${seen.toISOString()}\nSource: DEX Screener latest profiles. This is not a token launch time or a safety endorsement. Coverage is limited.\n${item.screenerUrl}`;
          if(await emit(tx,current,item.mint,title,body,{...item,firstSeenAt:seen}))count++;
          if(count>=5)break;
        }
        await tx.solanaAlertRule.update({where:{id:current.id},data:{lastCheckedAt:now,lastObservedAt:at,lastError:null,...(count?{lastTriggeredAt:now}:{})}});
      }else if(observation){
        if(current.lastObservedAt&&current.lastObservedAt>=observation.at){await tx.solanaAlertRule.update({where:{id:current.id},data:{lastCheckedAt:now}});return;}
        const matches=current.kind==='PRICE_ABOVE'?observation.value>current.threshold!:observation.value<current.threshold!;
        const cooled=!current.lastTriggeredAt||now.getTime()-current.lastTriggeredAt.getTime()>=current.cooldownMinutes*60000;
        const trigger=matches&&!current.lastMatched&&cooled;
        if(trigger){const title=`${current.name} · threshold reached`,body=`${title}\nMint: ${current.mint}\n${current.kind==='LIQUIDITY_BELOW'?'Pool liquidity':'Price'}: $${observation.value}\nThreshold: $${current.threshold}\nSource: DEX Screener\nObserved: ${observation.at.toISOString()}\nThis alert does not place a trade.`;await emit(tx,current,observation.at.toISOString(),title,body,observation);}
        await tx.solanaAlertRule.update({where:{id:current.id},data:{lastCheckedAt:now,lastObservedAt:observation.at,lastMatched:matches,lastError:null,...(trigger?{lastTriggeredAt:now}:{})}});
      }
    });
  }catch(error){await db.solanaAlertRule.updateMany({where:{id:rule.id,userId:rule.userId},data:{lastCheckedAt:new Date(),lastError:error instanceof AppError?error.message:'Alert data could not be checked. No trade was placed.'}});}
}
export async function tickSolanaAlerts(userId?:string,options:{limit?:number;deadline?:number}={}){
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
    const due=userId?await db.solanaAlertRule.findMany({where:{userId,enabled:true},take:options.limit??20}):await db.sql<{id:string}>`SELECT id FROM "SolanaAlertRule" WHERE enabled=true AND ("lastCheckedAt" IS NULL OR "lastCheckedAt" < ${new Date(Date.now()-60000)}) ORDER BY "lastCheckedAt" ASC NULLS FIRST LIMIT ${options.limit??20}`;
    const rules=userId?due as Rule[]:await db.solanaAlertRule.findMany({where:{id:{in:due.map(r=>r.id)}}});
    for(let i=0;i<rules.length;i+=4){if(Date.now()>=(options.deadline??Infinity))break;await Promise.allSettled(rules.slice(i,i+4).map(checkAlert));}
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
  const rule=await transaction(async tx=>{
    const userId=req.user!.id;await lockUser(tx,userId);check(!(await tx.user.findUniqueOrThrow({where:{id:userId}})).emergencyStop,409,'Clear emergency stop before adding alerts.');
    check(await tx.solanaAlertRule.count({where:{userId}})<20,400,'You can save up to 20 alert rules.');
    if(input.delivery==='BOTH'){const channel=await tx.personalAgentChannel.findUnique({where:{userId}});check(channel?.enabled&&channel.ownerId,409,'Pair your personal WhatsApp agent before enabling WhatsApp alerts.');}
    return tx.solanaAlertRule.create({data:{userId,...input}});
  });res.status(201).json(rule);
});
solanaAlertsRouter.post('/alerts/:id/toggle',async(req,res)=>{
  const {enabled}=z.object({enabled:z.boolean()}).strict().parse(req.body);
  await transaction(async tx=>{await lockUser(tx,req.user!.id);const rule=await tx.solanaAlertRule.findFirst({where:{id:String(req.params.id),userId:req.user!.id}});check(rule,404,'Alert rule not found.');if(enabled){check(providerStatus().alertsEnabled,503,'Alerts are disabled.');check(!(await tx.user.findUniqueOrThrow({where:{id:req.user!.id}})).emergencyStop,409,'Clear emergency stop first.');if(rule.delivery==='BOTH'){const channel=await tx.personalAgentChannel.findUnique({where:{userId:req.user!.id}});check(channel?.enabled&&channel.ownerId,409,'Pair WhatsApp before enabling this rule.');}}else await cancelRuleDelivery(tx,req.user!.id,rule.id);await tx.solanaAlertRule.update({where:{id:rule.id},data:{enabled}});});res.json({ok:true});
});
solanaAlertsRouter.post('/alerts/:id/delete',async(req,res)=>{await transaction(async tx=>{await lockUser(tx,req.user!.id);await cancelRuleDelivery(tx,req.user!.id,String(req.params.id));await tx.solanaAlertRule.deleteMany({where:{id:String(req.params.id),userId:req.user!.id}});});res.json({ok:true});});
solanaAlertsRouter.post('/alerts/check',rateLimit({windowMs:60000,limit:2,keyGenerator:rateLimitKey,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{await tickSolanaAlerts(req.user!.id);res.json({ok:true});});
