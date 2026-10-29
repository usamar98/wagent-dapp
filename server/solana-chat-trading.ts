import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { db, transaction, lockUser, type Tx } from './db.js';
import { AppError, check, decrypt, verifyHmac } from './security.js';
import { env } from './env.js';
import { SOL_MINT, addressSchema, atomicAmount, humanAmount, tokenMetadata, jupiterOrder, jupiterExecute, signatureStatus, finalizedBlockHeight, fetchJson, rpc } from './solana-providers.js';
import { chatTradingEnabled, validateTradePermission, dailyTradingUsage, unresolvedChatTrades, permissionAllowsMint } from './solana-permissions.js';
import { validateChatTransaction } from './chat-transaction-policy.js';
import { signTradingTransaction } from './trading-wallet-keys.js';
import { channelWebsiteRuntime, websiteOrigin } from './website-runtime.js';
import type { ModelRows } from './database/schema.js';

type ChatTrade=ModelRows['SolanaChatTrade'];
export type ChannelContext={id:string;ownerId:string;leaseToken:string};
export function parseChatSwap(text:string){
  const match=/^(buy|sell)\s+(\d{1,12}(?:\.\d{1,18})?)\s+(SOL\s+of|of)\s+([1-9A-HJ-NP-Za-km-z]{32,44})$/i.exec(text.trim());
  if(!match)return null;
  const side=match[1].toUpperCase() as 'BUY'|'SELL';
  check(addressSchema.safeParse(match[4]).success&&match[4]!==SOL_MINT,400,'Use an exact Solana token WGT address other than wrapped SOL.');
  check(side==='BUY'?match[3].toLowerCase()==='sol of':match[3].toLowerCase()==='of',400,'Use Buy <SOL amount> SOL of <WGT>, or Sell <token amount> of <WGT>.');
  return {side,amount:match[2],mint:match[4]};
}
export async function noPendingChatTrade(tx:Tx,userId:string,excludeId=''){
  check(!await tx.solanaChatTrade.findFirst({where:{userId,id:{not:excludeId},status:{in:unresolvedChatTrades}}}),409,'A chat trade still needs confirmation. Send Check trade before placing another order.');
  check(!await tx.solanaWalletWithdrawal.findFirst({where:{userId,status:{in:['PREPARED','EXECUTING','UNKNOWN']}}}),409,'A withdrawal still needs confirmation. Check it before trading again.');
}
async function activeChannel(tx:Tx,command:ModelRows['AgentCommand'],context:ChannelContext){
  const channel=await tx.personalAgentChannel.findFirst({where:{id:context.id,userId:command.userId,ownerId:context.ownerId,enabled:true,leaseToken:context.leaseToken}});
  check(command.source==='WHATSAPP'&&command.channelId===context.id&&command.recipientId===context.ownerId&&channel?.leaseUntil&&channel.leaseUntil>new Date(),403,'The paired WhatsApp connection changed or its lease expired.');
  check(command.createdAt.getTime()>Date.now()-120000,409,'This trade command is too old. Send a fresh command.');return channel;
}
export async function queueChatTrade(tx:Tx,userId:string,text:string,externalId:string,context:ChannelContext,createdAt:Date,executionOrigin:string){
  const permission=await tx.solanaTradePermission.findFirst({where:{userId,revokedAt:null,expiresAt:{gt:new Date()}}});
  if(!permission)return null;
  const swap=parseChatSwap(text);check(swap,400,'Use an exact buy or sell command.');
  const current=await validateTradePermission(tx,userId,permission.id,executionOrigin);check(permissionAllowsMint(permission,swap.mint),403,'This token is outside your signed permission. Choose Any Solana token and sign updated limits on the website, or add this WGT to your approved agent tokens.');
  await noPendingChatTrade(tx,userId);
  if(swap.side==='BUY')check(BigInt(atomicAmount(swap.amount,9))+BigInt(permission.maxFeeLamports)<=BigInt(permission.perTradeLamports),409,'This buy plus the reserved fee exceeds your per-trade budget.');
  check(current.channel.id===context.id&&current.channel.ownerId===context.ownerId,403,'The approved chat owner changed.');
  const command=await tx.agentCommand.create({data:{userId,source:'WHATSAPP',externalId,text,reply:'CHAT TRADE · Processing your request. Send Check trade if confirmation is delayed.',status:'TRADE_QUEUED',channelId:context.id,recipientId:context.ownerId,deliveryStatus:'PENDING',createdAt}});
  await tx.solanaChatTrade.create({data:{userId,commandId:command.id,permissionId:permission.id,walletAddress:current.wallet!.address,...swap}});
  return command;
}
function tradeReply(trade:ChatTrade){
  const prefix=trade.status==='CONFIRMED'?'TRADE CONFIRMED':trade.status==='FAILED'?'TRADE FAILED':trade.status==='CANCELLED'||trade.status==='REJECTED'?'NOT EXECUTED':'CONFIRMATION PENDING';
  return `${prefix} · ${trade.side==='BUY'?`Buy with ${trade.amount} SOL`:`Sell ${trade.amount} tokens`}\nWGT: ${trade.mint}\nTrading wallet: ${trade.walletAddress}\n${trade.quote.minimumOutput?`Minimum receive: ${trade.quote.minimumOutput} ${trade.side==='BUY'?'tokens':'SOL'}\n`:''}${trade.error?`${trade.error}\n`:''}${trade.signature?`https://solscan.io/tx/${trade.signature}\n`:''}Reference: ${trade.id}${['PREPARED','EXECUTING','UNKNOWN'].includes(trade.status)?'\nDo not resend this order. Send Check trade to check confirmation.':''}`;
}
async function finishCommand(commandId:string,trade:ChatTrade){
  await db.agentCommand.update({where:{id:commandId},data:{status:['REJECTED','CANCELLED'].includes(trade.status)?'REJECTED':'COMPLETED',reply:tradeReply(trade)}});
}
export async function reconcileChatTrade(userId:string,id:string){
  const trade=await db.solanaChatTrade.findFirst({where:{id,userId}});check(trade,404,'Chat trade not found.');
  if(['PREPARED','EXECUTING','UNKNOWN'].includes(trade.status)&&trade.signature){
    const status=await signatureStatus(trade.signature);
    if(status&&(status.err||['confirmed','finalized'].includes(status.confirmationStatus)))await db.solanaChatTrade.updateMany({where:{id:trade.id,status:{in:['PREPARED','EXECUTING','UNKNOWN']}},data:{status:status.err?'FAILED':'CONFIRMED',error:status.err?'Transaction failed on-chain. Network fees may still apply.':null}});
    else if(!status&&/^\d{1,16}$/.test(trade.quote.lastValidBlockHeight||'')&&Date.now()-trade.createdAt.getTime()>600000){
      const height=await finalizedBlockHeight();if(BigInt(height)>BigInt(trade.quote.lastValidBlockHeight)+32n&&!await signatureStatus(trade.signature))await db.solanaChatTrade.updateMany({where:{id:trade.id,status:{in:['PREPARED','EXECUTING','UNKNOWN']}},data:{status:'FAILED',error:'Transaction expired without an observed confirmation. No transaction was rebroadcast.'}});
    }
  }else if(trade.status==='PREPARING'&&Date.now()-trade.createdAt.getTime()>300000){
    await transaction(async tx=>{await lockUser(tx,userId);await tx.solanaChatTrade.updateMany({where:{id:trade.id,status:'PREPARING'},data:{status:'CANCELLED',error:'Preparation expired before a transaction was signed.'}});});
  }
  const fresh=await db.solanaChatTrade.findUniqueOrThrow({where:{id:trade.id}});await finishCommand(trade.commandId,fresh);return fresh;
}
async function executeQueuedTrade(commandId:string,context:ChannelContext){
  const claimed=await transaction(async tx=>{
    const command=await tx.agentCommand.findUniqueOrThrow({where:{id:commandId}});await lockUser(tx,command.userId);await activeChannel(tx,command,context);
    if(command.status!=='TRADE_QUEUED')return null;
    const trade=await tx.solanaChatTrade.findUniqueOrThrow({where:{commandId}});
    if(trade.status!=='PREPARING')return null;
    await tx.agentCommand.update({where:{id:commandId},data:{status:'TRADE_PROCESSING'}});return {command,trade};
  });if(!claimed)return;
  const {trade,command}=claimed;let prepared=false,broadcastAttempted=false;
  try{
    check(chatTradingEnabled(),503,'Chat trading is disabled or the website needs Jupiter setup.');
    const {permission,wallet}=await transaction(async tx=>{await lockUser(tx,trade.userId);await activeChannel(tx,command,context);await noPendingChatTrade(tx,trade.userId,trade.id);return validateTradePermission(tx,trade.userId,trade.permissionId);});
    check(permissionAllowsMint(permission,trade.mint),403,'Token is outside your approved token access.');
    const info=await tokenMetadata(trade.mint),inputMint=trade.side==='BUY'?SOL_MINT:trade.mint,outputMint=trade.side==='BUY'?trade.mint:SOL_MINT;
    const rawAmount=atomicAmount(trade.amount,trade.side==='BUY'?9:info.decimals);
    const order=await jupiterOrder(inputMint,outputMint,rawAmount,wallet!.address,permission.slippageBps,true);
    check(order.slippageBps!==undefined&&order.slippageBps<=permission.slippageBps&&/^\d{1,16}$/.test(order.lastValidBlockHeight||''),502,'Jupiter did not provide bounded slippage and transaction expiry.');
    const expiresAt=Math.min(Date.now()+60000,order.expireAt?Date.parse(order.expireAt):Infinity);check(Number.isFinite(expiresAt)&&expiresAt>Date.now()+5000,400,'Quote expired. Send a new command.');
    const notional=BigInt(trade.side==='BUY'?rawAmount:order.outAmount),budget=notional+BigInt(permission.maxFeeLamports);
    check(budget<=BigInt(permission.perTradeLamports),409,'This trade’s quoted SOL value plus reserved fees exceeds your per-trade budget.');
    await validateChatTransaction(order,wallet!.address,BigInt(permission.maxFeeLamports),permission.slippageBps);
    const signed=await transaction(async tx=>{
      await lockUser(tx,trade.userId);await activeChannel(tx,command,context);await noPendingChatTrade(tx,trade.userId,trade.id);
      const fresh=await validateTradePermission(tx,trade.userId,trade.permissionId);check(permissionAllowsMint(fresh.permission,trade.mint),403,'Token permission was removed.');
      check((await tx.solanaChatTrade.findUniqueOrThrow({where:{id:trade.id}})).status==='PREPARING',409,'Trade was cancelled during preparation.');
      check(budget<=BigInt(fresh.permission.perTradeLamports)&&await dailyTradingUsage(tx,trade.userId)+budget<=BigInt(fresh.permission.dailyLamports),409,'Your daily or per-trade budget would be exceeded.');
      check(expiresAt>Date.now()+3000,409,'Quote expired during validation. Send a fresh command.');
      const result=signTradingTransaction(fresh.wallet!,order.transaction);
      await tx.solanaChatTrade.update({where:{id:trade.id},data:{status:'PREPARED',createdAt:new Date(),budgetLamports:budget.toString(),signature:result.signature,providerRequestId:order.requestId,quote:{inputAmount:rawAmount,outputAmount:order.outAmount,minimumOutput:humanAmount(order.otherAmountThreshold,trade.side==='BUY'?info.decimals:9),lastValidBlockHeight:order.lastValidBlockHeight,expiresAt,router:order.router,slippageBps:permission.slippageBps}}});return result;
    });prepared=true;
    // Never retry this transaction callback: an external submission cannot be rolled back.
    // The user lock serializes revoke/disconnect against the final check AND network send.
    await db.transaction(async tx=>{
      await lockUser(tx,trade.userId);await activeChannel(tx,command,context);await validateTradePermission(tx,trade.userId,trade.permissionId);
      check(chatTradingEnabled()&&expiresAt>Date.now()+1000,409,'Trading was disabled or the quote expired.');
      const fresh=await tx.solanaChatTrade.findUniqueOrThrow({where:{id:trade.id}});check(fresh.status==='PREPARED',409,'Trade is already claimed.');
      await tx.solanaChatTrade.update({where:{id:trade.id},data:{status:'EXECUTING'}});broadcastAttempted=true;
      let confirmed=false;try{const result=await jupiterExecute(signed.signedTransaction,order.requestId,order.lastValidBlockHeight,12000);confirmed=result.status==='Success'&&result.code===0&&result.signature===signed.signature;}catch{/* Uncertain results are reconciled read-only. */}
      await tx.solanaChatTrade.update({where:{id:trade.id},data:{status:confirmed?'CONFIRMED':'UNKNOWN',error:confirmed?null:'Submission could not be confirmed. Do not resend; send Check trade.'}});
    },{timeout:45000,maxWait:15000});
  }catch(error){
    const message=error instanceof AppError?error.message:'Trading could not be completed. Check the order status before trying again.';
    await db.solanaChatTrade.updateMany({where:{id:trade.id,status:{in:['PREPARING','PREPARED','EXECUTING']}},data:{status:broadcastAttempted?'UNKNOWN':prepared?'CANCELLED':'REJECTED',error:message}});
  }
  await finishCommand(commandId,await db.solanaChatTrade.findUniqueOrThrow({where:{id:trade.id}}));
}
const dispatchInput=z.object({commandId:z.uuid(),channelId:z.uuid(),leaseToken:z.string().min(1).max(100),at:z.number().int()}).strict();
export const chatExecutionRouter=Router();
chatExecutionRouter.post('/chat-trading/execute-command',async(req,res)=>{
  const input=dispatchInput.parse(req.body);check(Math.abs(Date.now()-input.at)<90000,403,'Worker request expired.');
  const command=await db.agentCommand.findUnique({where:{id:input.commandId}});check(command?.source==='WHATSAPP'&&command.channelId===input.channelId,403,'Unrecognized WhatsApp command.');
  const channel=await db.personalAgentChannel.findUnique({where:{id:input.channelId}});check(channel?.enabled&&channel.ownerId&&channel.userId===command.userId,403,'WhatsApp connection is unavailable.');
  check(verifyHmac(Buffer.from(JSON.stringify(input)),req.get('x-wagent-worker-signature')||'',decrypt(channel.encryptedToken)),403,'Worker signature rejected.');
  const website=await channelWebsiteRuntime(channel.appUrl);check(website.appUrl===websiteOrigin(env.appUrl),403,'This command belongs to a different website.');
  const context={id:channel.id,ownerId:channel.ownerId,leaseToken:input.leaseToken};
  if(command.status==='CHECK_QUEUED'){
    await transaction(async tx=>{await lockUser(tx,command.userId);await activeChannel(tx,command,context);await tx.agentCommand.updateMany({where:{id:command.id,status:'CHECK_QUEUED'},data:{status:'CHECK_PROCESSING'}});});
    const latest=await db.solanaChatTrade.findFirst({where:{userId:command.userId},orderBy:{createdAt:'desc'}});
    const trade=latest?await reconcileChatTrade(command.userId,latest.id):null;
    await db.agentCommand.update({where:{id:command.id},data:{status:'COMPLETED',reply:trade?tradeReply(trade):'No WhatsApp trades have been submitted.'}});
  }else await executeQueuedTrade(command.id,context);
  res.json({ok:true});
});
export async function dispatchChatCommand(command:ModelRows['AgentCommand'],context:ChannelContext,origin:string){
  if(!['TRADE_QUEUED','CHECK_QUEUED'].includes(command.status))return command;
  try{
    if(origin===websiteOrigin(env.appUrl)){
      if(command.status==='TRADE_QUEUED')await executeQueuedTrade(command.id,context);
      else{
        await transaction(async tx=>{await lockUser(tx,command.userId);await activeChannel(tx,command,context);});
        const latest=await db.solanaChatTrade.findFirst({where:{userId:command.userId},orderBy:{createdAt:'desc'}}),trade=latest?await reconcileChatTrade(command.userId,latest.id):null;
        await db.agentCommand.update({where:{id:command.id},data:{status:'COMPLETED',reply:trade?tradeReply(trade):'No WhatsApp trades have been submitted.'}});
      }
    }else{
      const channel=await db.personalAgentChannel.findUniqueOrThrow({where:{id:context.id}});
      const body={commandId:command.id,channelId:context.id,leaseToken:context.leaseToken,at:Date.now()},signature='sha256='+createHmac('sha256',decrypt(channel.encryptedToken)).update(JSON.stringify(body)).digest('hex');
      await fetchJson(new URL('/api/solana/chat-trading/execute-command',origin).toString(),{method:'POST',headers:{'Content-Type':'application/json','X-AgentBazaar':'1','X-Wagent-Worker-Signature':signature},body:JSON.stringify(body)},'Trading website',80000);
    }
  }catch{
    await transaction(async tx=>{
      await lockUser(tx,command.userId);const saved=await tx.agentCommand.findUniqueOrThrow({where:{id:command.id}});
      if(['TRADE_QUEUED','CHECK_QUEUED'].includes(saved.status)){
        await tx.agentCommand.update({where:{id:saved.id},data:{status:'REJECTED',reply:'NOT EXECUTED · The trading website could not accept this request. Send Check trade before placing another order.'}});
        await tx.solanaChatTrade.updateMany({where:{commandId:saved.id,status:'PREPARING'},data:{status:'CANCELLED',error:'Website dispatch was not accepted.'}});
      }
    });
  }
  return db.agentCommand.findUniqueOrThrow({where:{id:command.id}});
}
export async function tradingWalletBalance(address:string){
  const sol=await rpc('getBalance',[address,{commitment:'confirmed'}]);check(Number.isSafeInteger(sol?.value)&&sol.value>=0,502,'Balance unavailable.');
  return {sol:humanAmount(String(sol.value),9)};
}
