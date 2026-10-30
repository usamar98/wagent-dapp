import {randomBytes} from 'node:crypto';
import {db,transaction,lockUser,type Tx} from './db.js';
import {AppError,check,hash} from './security.js';
import {SOL_MINT,atomicAmount,humanAmount,rpc,signatureStatus,finalizedBlockHeight} from './solana-providers.js';
import {chatWithdrawalsEnabled,dailyWithdrawalUsage,validateWithdrawalPermission,revokeWithdrawals} from './withdrawal-access.js';
import {activeChannel,noPendingChatTrade,type ChannelContext} from './solana-chat-trading.js';
import {buildWithdrawal} from './solana-withdrawals.js';
import {signTradingTransaction} from './trading-wallet-keys.js';
import type {ModelRows} from './database/schema.js';
type Withdrawal=ModelRows['SolanaChatWithdrawal'];
export const withdrawalQueueStates=['WITHDRAWAL_QUEUED','WITHDRAWAL_CHECK_QUEUED'];
export function isWithdrawalCommand(text:string){return /^(withdraw\b|confirm withdraw\b|cancel withdraw(?:al)?\b|check (?:my )?withdrawal$|revoke withdrawals?$)/i.test(text.trim());}
export async function queueWithdrawalCommand(tx:Tx,userId:string,text:string,externalId:string,context:ChannelContext,now:Date,origin:string){
  const create=(reply:string,status='COMPLETED')=>tx.agentCommand.create({data:{userId,source:'WHATSAPP',externalId,text,reply,status,channelId:context.id,recipientId:context.ownerId,deliveryStatus:'PENDING',createdAt:now}});
  const value=text.trim().replace(/\s+/g,' ');
  if(/^revoke withdrawals?$/i.test(value)){await revokeWithdrawals(tx,userId,'Withdrawal access revoked from the paired WhatsApp chat.');return create('WITHDRAWALS REVOKED · New chat withdrawals and pending confirmation requests are blocked. Funds stay in the trading wallet. Already-submitted transfers cannot be recalled.');}
  if(/^check (my )?withdrawal$/i.test(value))return create('Checking your latest SOL withdrawal. No transfer is submitted.','WITHDRAWAL_CHECK_QUEUED');
  if(/^cancel withdraw(?:al)?(?: [A-F0-9]{12})?$/i.test(value)){
    const code=value.split(' ')[2],row=await tx.solanaChatWithdrawal.findFirst({where:{userId,status:'AWAITING_CONFIRMATION',...(code?{confirmationHash:hash(code.toUpperCase())}:{})},orderBy:{createdAt:'desc'}});
    check(row,404,'No matching withdrawal is awaiting confirmation.');await tx.solanaChatWithdrawal.update({where:{id:row.id},data:{status:'CANCELLED',error:'Cancelled from the paired WhatsApp chat.'}});return create('WITHDRAWAL CANCELLED · No transfer was submitted.');
  }
  const confirm=/^confirm withdraw ([A-F0-9]{12})$/i.exec(value);
  if(confirm){
    const row=await tx.solanaChatWithdrawal.findFirst({where:{userId,confirmationHash:hash(confirm[1].toUpperCase())},orderBy:{createdAt:'desc'}});
    check(row?.status==='AWAITING_CONFIRMATION',409,'This withdrawal code is invalid or already used. Send Check withdrawal before requesting another transfer.');
    if(row.confirmationExpiresAt<=now){await tx.solanaChatWithdrawal.update({where:{id:row.id},data:{status:'EXPIRED',error:'Confirmation code expired.'}});throw new AppError(409,'Withdrawal confirmation expired. Request a fresh withdrawal.');}
    const current=await validateWithdrawalPermission(tx,userId,row.permissionId,origin);
    check(current.channel.id===context.id&&current.channel.ownerId===context.ownerId&&current.wallet.address===row.walletAddress&&current.wallet.ownerAddress===row.ownerAddress,403,'The approved withdrawal connection or recipient changed.');
    await noPendingChatTrade(tx,userId,'',row.id);
    check(BigInt(row.budgetLamports)<=BigInt(current.permission.perWithdrawalLamports)&&await dailyWithdrawalUsage(tx,userId,row.id)+BigInt(row.budgetLamports)<=BigInt(current.permission.dailyLamports),409,'Withdrawal total including reserved fees exceeds your budget.');
    const command=await create('WITHDRAWAL · Processing your confirmed request. Do not repeat it. Send Check withdrawal for its result.','WITHDRAWAL_QUEUED');
    await tx.solanaChatWithdrawal.update({where:{id:row.id},data:{status:'PREPARING',executeCommandId:command.id,createdAt:now}});return command;
  }
  const request=/^withdraw (\d{1,12}(?:\.\d{1,9})?) SOL$/i.exec(value);
  check(request,400,'Use Withdraw <amount> SOL. The recipient is fixed to your original Solana owner wallet. Confirm with the exact code provided, or send Cancel withdrawal.');
  check(chatWithdrawalsEnabled(),503,'WhatsApp withdrawals are disabled.');
  const permission=await tx.solanaWithdrawalPermission.findFirst({where:{userId,revokedAt:null,expiresAt:{gt:now}},orderBy:{createdAt:'desc'}});
  check(permission,409,'Approve separate WhatsApp withdrawal access on the website first. Trading approval does not authorize withdrawals.');
  const current=await validateWithdrawalPermission(tx,userId,permission.id,origin);
  check(current.channel.id===context.id&&current.channel.ownerId===context.ownerId,403,'The approved WhatsApp owner changed.');
  await noPendingChatTrade(tx,userId);
  await tx.solanaChatWithdrawal.updateMany({where:{userId,status:'AWAITING_CONFIRMATION'},data:{status:'CANCELLED',error:'Replaced by a fresh withdrawal request.'}});
  const amount=atomicAmount(request[1],9),budget=BigInt(amount)+BigInt(permission.maxFeeLamports);
  check(budget<=BigInt(permission.perWithdrawalLamports)&&await dailyWithdrawalUsage(tx,userId)+budget<=BigInt(permission.dailyLamports),409,'Withdrawal amount plus reserved fees exceeds your per-withdrawal or daily budget.');
  const code=randomBytes(6).toString('hex').toUpperCase(),expiresAt=new Date(Math.min(now.getTime()+120000,permission.expiresAt.getTime()));
  const command=await create(`CONFIRM SOL WITHDRAWAL\nAmount: ${humanAmount(amount,9)} SOL\nFrom trading wallet: ${current.wallet.address}\nTo original owner: ${current.wallet.ownerAddress}\nMaximum network fee: ${humanAmount(permission.maxFeeLamports,9)} SOL\nExpires: ${expiresAt.toISOString()}\n\nSend CONFIRM WITHDRAW ${code} to submit this one transfer.\nSend Cancel withdrawal to cancel. No transfer has been submitted.`);
  await tx.solanaChatWithdrawal.create({data:{userId,commandId:command.id,permissionId:permission.id,walletAddress:current.wallet.address,ownerAddress:current.wallet.ownerAddress,amount:humanAmount(amount,9),budgetLamports:String(budget),confirmationHash:hash(code),confirmationExpiresAt:expiresAt,status:'AWAITING_CONFIRMATION'}});return command;
}
export function withdrawalReply(row:Withdrawal){
  const title=row.status==='CONFIRMED'?'WITHDRAWAL CONFIRMED':row.status==='FAILED'?'WITHDRAWAL FAILED':['CANCELLED','EXPIRED','REJECTED'].includes(row.status)?'NOT EXECUTED':row.status==='AWAITING_CONFIRMATION'?'AWAITING WITHDRAWAL CONFIRMATION':'WITHDRAWAL CONFIRMATION PENDING';
  return `${title}\nAmount: ${row.amount} SOL\nFrom trading wallet: ${row.walletAddress}\nTo original owner: ${row.ownerAddress}\n${row.error?row.error+'\n':''}${row.signature?`https://solscan.io/tx/${row.signature}\n`:''}Reference: ${row.id}${['PREPARING','PREPARED','EXECUTING','UNKNOWN'].includes(row.status)?'\nDo not resend this withdrawal. Send Check withdrawal.':row.status==='AWAITING_CONFIRMATION'?`\nUse the code from your original preview before ${row.confirmationExpiresAt.toISOString()}.`:''}`;
}
export async function reconcileChatWithdrawal(userId:string,id:string){
  const row=await db.solanaChatWithdrawal.findFirst({where:{userId,id}});check(row,404,'Withdrawal not found.');
  if(['PREPARED','EXECUTING','UNKNOWN'].includes(row.status)&&row.signature){
    const chain=await signatureStatus(row.signature);
    if(chain&&(chain.err||['confirmed','finalized'].includes(chain.confirmationStatus)))await db.solanaChatWithdrawal.updateMany({where:{id,status:{in:['PREPARED','EXECUTING','UNKNOWN']}},data:{status:chain.err?'FAILED':'CONFIRMED',error:chain.err?'Transfer failed on-chain; network fees may apply.':null}});
    else if(!chain&&row.lastValidBlockHeight&&Date.now()-row.createdAt.getTime()>600000&&BigInt(await finalizedBlockHeight())>BigInt(row.lastValidBlockHeight)+32n&&!await signatureStatus(row.signature))await db.solanaChatWithdrawal.updateMany({where:{id,status:{in:['PREPARED','EXECUTING','UNKNOWN']}},data:{status:'FAILED',error:'Transfer expired without observed confirmation. It was not rebroadcast.'}});
  }else if(row.status==='AWAITING_CONFIRMATION'&&row.confirmationExpiresAt<=new Date())await db.solanaChatWithdrawal.updateMany({where:{id,status:row.status},data:{status:'EXPIRED',error:'Confirmation code expired. No transfer was submitted.'}});
  else if(row.status==='PREPARING'&&Date.now()-row.createdAt.getTime()>300000)await transaction(async tx=>{await lockUser(tx,userId);await tx.solanaChatWithdrawal.updateMany({where:{id,status:'PREPARING'},data:{status:'CANCELLED',error:'Preparation expired before signing.'}});});
  return db.solanaChatWithdrawal.findUniqueOrThrow({where:{id}});
}
export async function executeChatWithdrawal(command:ModelRows['AgentCommand'],context:ChannelContext){
  const claimed=await transaction(async tx=>{
    await lockUser(tx,command.userId);await activeChannel(tx,command,context);
    if((await tx.agentCommand.findUniqueOrThrow({where:{id:command.id}})).status!=='WITHDRAWAL_QUEUED')return null;
    const row=await tx.solanaChatWithdrawal.findFirst({where:{userId:command.userId,executeCommandId:command.id,status:'PREPARING'}});check(row,409,'Withdrawal was cancelled or already claimed.');
    await tx.agentCommand.update({where:{id:command.id},data:{status:'WITHDRAWAL_PROCESSING'}});return row;
  });if(!claimed)return;
  let attempted=false;
  try{
    const current=await validateWithdrawalPermission(db,claimed.userId,claimed.permissionId);
    const built=await buildWithdrawal(current.wallet.address,current.wallet.ownerAddress,SOL_MINT,claimed.amount,BigInt(current.permission.maxFeeLamports));
    const signed=await transaction(async tx=>{
      await lockUser(tx,claimed.userId);await activeChannel(tx,command,context);const fresh=await validateWithdrawalPermission(tx,claimed.userId,claimed.permissionId);
      await noPendingChatTrade(tx,claimed.userId,'',claimed.id);
      const row=await tx.solanaChatWithdrawal.findUniqueOrThrow({where:{id:claimed.id}});
      check(row.status==='PREPARING'&&row.confirmationExpiresAt>new Date()&&fresh.wallet.address===claimed.walletAddress&&fresh.wallet.ownerAddress===claimed.ownerAddress,409,'Withdrawal expired, was revoked, or its original recipient changed.');
      check(BigInt(row.budgetLamports)<=BigInt(fresh.permission.perWithdrawalLamports)&&await dailyWithdrawalUsage(tx,row.userId,row.id)+BigInt(row.budgetLamports)<=BigInt(fresh.permission.dailyLamports),409,'Withdrawal budget was exceeded.');
      const signed=signTradingTransaction(fresh.wallet,built.unsigned);
      await tx.solanaChatWithdrawal.update({where:{id:row.id},data:{status:'PREPARED',signature:signed.signature,lastValidBlockHeight:built.lastValidBlockHeight}});return signed;
    });
    // One send only. The user lock fences revocation, changes, and competing submissions.
    await db.transaction(async tx=>{
      await lockUser(tx,claimed.userId);await activeChannel(tx,command,context);const current=await validateWithdrawalPermission(tx,claimed.userId,claimed.permissionId),row=await tx.solanaChatWithdrawal.findUniqueOrThrow({where:{id:claimed.id}});
      check(row.status==='PREPARED'&&row.signature===signed.signature&&row.confirmationExpiresAt>new Date()&&current.wallet.address===row.walletAddress&&current.wallet.ownerAddress===row.ownerAddress,409,'Withdrawal expired, stopped, or was already claimed.');
      await tx.solanaChatWithdrawal.update({where:{id:row.id},data:{status:'EXECUTING'}});attempted=true;
      try{await rpc('sendTransaction',[signed.signedTransaction,{encoding:'base64',skipPreflight:false,maxRetries:0,preflightCommitment:'confirmed'}]);}catch{/* Acceptance may be uncertain. Never repeat this send. */}
      await tx.solanaChatWithdrawal.update({where:{id:row.id},data:{status:'UNKNOWN',error:'Submitted or submission uncertain. Check withdrawal before requesting another transfer.'}});
    },{timeout:45000,maxWait:15000});
    try{await reconcileChatWithdrawal(claimed.userId,claimed.id);}catch{/* Keep UNKNOWN until a read-only check succeeds. */}
  }catch(e){await db.solanaChatWithdrawal.updateMany({where:{id:claimed.id,status:{in:['PREPARING','PREPARED','EXECUTING']}},data:{status:attempted?'UNKNOWN':'CANCELLED',error:e instanceof AppError?e.message:'Withdrawal could not be completed. Check its status before trying again.'}});}
  const row=await db.solanaChatWithdrawal.findUniqueOrThrow({where:{id:claimed.id}});
  await db.agentCommand.update({where:{id:command.id},data:{status:['CANCELLED','EXPIRED','REJECTED'].includes(row.status)?'REJECTED':'COMPLETED',reply:withdrawalReply(row)}});
}
export async function checkChatWithdrawal(command:ModelRows['AgentCommand'],context:ChannelContext){
  await transaction(async tx=>{await lockUser(tx,command.userId);await activeChannel(tx,command,context);check((await tx.agentCommand.updateMany({where:{id:command.id,status:'WITHDRAWAL_CHECK_QUEUED'},data:{status:'WITHDRAWAL_CHECK_PROCESSING'}})).count,409,'Withdrawal check already claimed.');});
  const latest=await db.solanaChatWithdrawal.findFirst({where:{userId:command.userId},orderBy:{createdAt:'desc'}}),row=latest?await reconcileChatWithdrawal(command.userId,latest.id):null;
  await transaction(async tx=>{await lockUser(tx,command.userId);await activeChannel(tx,command,context);await tx.agentCommand.update({where:{id:command.id},data:{status:'COMPLETED',reply:row?withdrawalReply(row):'No WhatsApp SOL withdrawals have been requested.'}});});
}
