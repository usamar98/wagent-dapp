import { db, lockUser, transaction, type Tx } from './db.js';
import { configSchema } from '../shared/config.js';
import { decide, simulatedFeed, timeframeMs, riskBudget, type MarketData } from '../shared/strategies.js';
import { check } from './security.js';
import { env } from './env.js';
import { deliverNotifications } from './notifications.js';

export async function canUseVersion(tx: Tx, userId: string, versionId: string) {
  const version=await tx.agentVersion.findUnique({where:{id:versionId},include:{agent:true}});
  check(version,404,'Agent version not found');
  if(version.agent.creatorId!==userId) {
    const entitlement=await tx.entitlement.findFirst({where:{buyerId:userId,versionId,status:'ACTIVE'}});
    check(entitlement && (entitlement.environment!=='DEMO'||env.demo),403,'An active entitlement for this version is required');
  }
  return version;
}
async function notify(tx: Tx,userId:string,signalId:string,title:string,body:string,channels:string[]) {
  await deliverNotifications(tx,{userId,signalId,title,body},channels);
}
export async function runInstance(instanceId: string,now=new Date(),feed=simulatedFeed) {
  const found=await db.instance.findUnique({where:{id:instanceId},include:{version:true}}); check(found,404,'Runtime not found');
  const config=configSchema.parse(found.version.config), bucket=String(Math.floor(now.getTime()/timeframeMs[config.timeframe]));
  try {
    return await transaction(async tx=>{
      await lockUser(tx,found.userId);
      await tx.sql`SELECT id FROM "Instance" WHERE id = ${instanceId} FOR UPDATE`;
      const instance=await tx.instance.findUniqueOrThrow({where:{id:instanceId},include:{positions:true}});
      const user=await tx.user.findUniqueOrThrow({where:{id:instance.userId}});
      check(instance.status==='RUNNING'&&!user.emergencyStop&&!user.disabled,409,'Agent is paused, stopped, or emergency stop is active');
      await canUseVersion(tx,instance.userId,instance.versionId);
      const existing=await tx.execution.findUnique({where:{instanceId_bucket:{instanceId,bucket}}}); if(existing) return {duplicate:true,execution:existing};
      const data=config.symbols.map(symbol=>feed(symbol,now,config.timeframe));
      const decisions=data.map(d=>decide(config,d,now));
      const execution=await tx.execution.create({data:{instanceId,bucket,status:'COMPLETED',source:data[0].source,marketTimestamp:new Date(data[0].candles.at(-1)!.timestamp)}});
      let cash=instance.cashCents, lastSignal=instance.lastSignalAt, positions=[...instance.positions];
      const cooling=!!lastSignal&&now.getTime()-lastSignal.getTime()<config.cooldownMinutes*60000;
      for(let i=0;i<data.length;i++) {
        const d=data[i], decision=decisions[i], pos=positions.find(p=>p.symbol===d.symbol);
        let action=decision.action, reason=decision.reason;
        const riskExit=pos && (decision.price<=pos.entryPrice*(1-config.stopLoss/100)||decision.price>=pos.entryPrice*(1+config.takeProfit/100));
        if(riskExit) {action='SELL';reason=`Risk exit: stop loss ${config.stopLoss}% / take profit ${config.takeProfit}%. ${reason}`;}
        if(action==='HOLD'||(cooling&&!riskExit)) continue;
        const signal=await tx.signal.create({data:{instanceId,executionId:execution.id,symbol:d.symbol,action,price:decision.price,reason,source:d.source,marketTimestamp:new Date(d.candles.at(-1)!.timestamp)}});
        if(action==='BUY'&&!pos) {
          const cents=riskBudget(config,cash,positions);
          if(cents>0) {const quantity=cents/100/decision.price; await tx.paperTrade.create({data:{instanceId,signalId:signal.id,symbol:d.symbol,side:'BUY',quantity,price:decision.price,amountCents:cents}});const p=await tx.position.create({data:{instanceId,symbol:d.symbol,quantity,entryPrice:decision.price,costCents:cents}});positions.push(p);cash-=cents;}
        } else if(action==='SELL'&&pos) {
          const cents=Math.round(pos.quantity*decision.price*100); await tx.paperTrade.create({data:{instanceId,signalId:signal.id,symbol:d.symbol,side:'SELL',quantity:pos.quantity,price:decision.price,amountCents:cents}});await tx.position.delete({where:{id:pos.id}});positions=positions.filter(p=>p.id!==pos.id);cash+=cents;
        }
        await notify(tx,instance.userId,signal.id,`${d.symbol}: ${action}`,`SIMULATED DATA · PAPER ONLY. ${reason} Source: ${d.source}. Market timestamp: ${d.candles.at(-1)!.timestamp}.`,config.notifications);
        lastSignal=now;
      }
      await tx.instance.update({where:{id:instanceId},data:{cashCents:cash,lastSignalAt:lastSignal}});
      return {duplicate:false,execution};
    });
  } catch(error) {
    // Strategy/data errors are persisted. Control-state rejections are returned without a fake run.
    if(error instanceof Error && !('status' in error)) await db.execution.upsert({where:{instanceId_bucket:{instanceId,bucket}},create:{instanceId,bucket,status:'ERROR',source:'Wagent Ai deterministic simulated feed v1',marketTimestamp:now,error:'Execution rejected: invalid, missing, or stale data, or strategy calculation failure.'},update:{}});
    throw error;
  }
}
export async function tick() {
  const instances=await db.instance.findMany({where:{status:'RUNNING',user:{emergencyStop:false,disabled:false}},select:{id:true}});
  for(const instance of instances) {try{await runInstance(instance.id);}catch{/* Persisted execution error or changed control state. Never log credentials. */}}
}
export interface BrokerAdapter { readonly enabled: false; execute(order: unknown): Promise<never> }
export const disabledBroker: BrokerAdapter = {enabled:false,async execute(){throw new Error('Real-money execution is disabled. Only paper trading is implemented.');}};
