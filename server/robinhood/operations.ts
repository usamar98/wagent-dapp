import { randomUUID, randomBytes } from 'node:crypto';
import { keccak256, verifyMessage } from 'ethers';
import { db, transaction, lockUser, type Tx } from '../db.js';
import { check, AppError, hash } from '../security.js';
import { assetBalance, ETH_TOKEN, erc20, evmAddress, fromWei, hex, holder, verifySettler, prepareTransaction, quoteSwap, ROBINHOOD_CHAIN_ID, rpc, signEvmTransaction, tokenInfo, transactionHash, validateSwapData, weiAmount, type RhQuote, type RhTransaction } from './providers.js';
import { assertIdle, dailyUsage, openKey, pendingStates, validatePermission, walletFor, type ChatContext, type RhOperation, type RhWallet } from './access.js';
export async function operationFor(userId:string,id:string,tx:Tx=db) {return (await tx.sql<RhOperation>`SELECT * FROM "RHOperation" WHERE id=${id} AND "userId"=${userId}`)[0]||null;}
export async function operationList(userId:string,tx:Tx=db) {return tx.sql<RhOperation>`SELECT * FROM "RHOperation" WHERE "userId"=${userId} ORDER BY "createdAt" DESC,id DESC LIMIT 30`;}
export function operationPresentation(op:RhOperation) {
  if(op.status!=='PREVIEW')return {statusLabel:op.status.replaceAll('_',' '),statusDescription:null};
  const expiry=op.confirmationExpiresAt||op.data.reviewExpiry||op.data.quote?.expiresAt;
  const expired=!!expiry&&new Date(expiry).getTime()<=Date.now();
  if(op.kind!=='WITHDRAW')return {
    statusLabel:expired?'Quote expired · Not submitted':'Quote only · Not submitted',
    statusDescription:'This website quote did not buy or sell tokens. With active trading permission, send a new Buy or Sell command in your paired WhatsApp chat. Status checks never submit an order.',
  };
  return {statusLabel:expired?'Withdrawal review expired · Not sent':'Withdrawal awaiting approval · Not sent',statusDescription:op.permissionId?'No funds have been sent. An unexpired withdrawal requires its unique CONFIRM WITHDRAW code in your paired chat.':'No funds have been sent. This website withdrawal requires a fresh signature from the original owner.'};
}
export async function queueOperation(tx:Tx,userId:string,kind:RhOperation['kind'],tokenAddress:string,amount:string,wallet:RhWallet,permissionId:string|null,commandId:string|null,data:any={},status='QUEUED') {
  await assertIdle(tx,userId);const id=randomUUID();
  const op=(await tx.sql<RhOperation>`INSERT INTO "RHOperation" (id,"userId","commandId","permissionId",kind,"tokenAddress",amount,"walletAddress",status,data) VALUES (${id},${userId},${commandId},${permissionId},${kind},${evmAddress(tokenAddress)},${amount},${wallet.address},${status},${JSON.stringify(data)}::jsonb) RETURNING *`)[0];return op;
}
async function guard(tx:Tx,op:RhOperation,context?:ChatContext) {
  const user=await tx.user.findUnique({where:{id:op.userId}}),wallet=await walletFor(op.userId,tx);check(user&&!user.disabled&&wallet?.address===op.walletAddress,403,'Trading wallet ownership changed.');
  check(!user.emergencyStop||op.data.recovery===true,409,'Emergency stop is active.');
  if(op.permissionId)return validatePermission(tx,op.userId,op.permissionId,op.kind==='WITHDRAW'?'WITHDRAW':'TRADE',context);
  let signer='';try{signer=evmAddress(verifyMessage(op.data.ownerMessage,op.data.ownerSignature));}catch{/* No unsigned operation is authorized. */}
  check(signer===wallet.ownerAddress&&op.data.ownerMessage.includes(`Operation: ${op.id}\n`)&&op.data.ownerMessage.includes(`Chain ID: ${ROBINHOOD_CHAIN_ID}\n`)&&op.data.ownerMessage.includes(`Review hash: ${reviewHash(op.data)}\n`)&&new Date(op.data.reviewExpiry)>new Date(),403,'A fresh original-owner signature for this exact review is required.');
  return {wallet,permission:null};
}
function canonical(value:any):any {return Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;}
export function reviewHash(data:any) {return keccak256(Buffer.from(JSON.stringify(canonical({quote:data.quote||null,transfer:data.transfer||null,maxFeeWei:data.maxFeeWei,reviewExpiry:data.reviewExpiry}))));}
async function budgets(tx:Tx,op:RhOperation,context?:ChatContext) {
  const access=await guard(tx,op,context),fee=BigInt(access.permission?.maxFeeWei||op.data.maxFeeWei),budget=op.kind==='WITHDRAW'?(op.tokenAddress===ETH_TOKEN?BigInt(op.data.rawAmount):0n)+fee:BigInt(op.kind==='BUY'?op.data.quote.sellAmount:op.data.quote.buyAmount)+fee;
  if(access.permission){const p=access.permission;check(budget<=BigInt(p.perLimitWei),409,'Amount plus the reserved gas fee exceeds your per-operation budget.');check(await dailyUsage(tx,op.userId,p.kind,op.id)+budget<=BigInt(p.dailyLimitWei),409,'The UTC daily spending budget would be exceeded.');if(op.kind!=='WITHDRAW')check(p.tokenScope==='ANY_ROBINHOOD'||p.tokens.includes(op.tokenAddress),403,'This token is outside the signed token scope.');}
  return {...access,fee,budget};
}
export async function prepareOperation(userId:string,id:string,context?:ChatContext) {
  let op=await operationFor(userId,id);check(op,404,'Operation not found.');
  if(op.data.quote||op.data.transfer)return op;
  const access=await transaction(async tx=>{await lockUser(tx,userId);await assertIdle(tx,userId,id);const row=await operationFor(userId,id,tx);check(row?.status==='QUEUED',409,'Operation is already claimed.');const access=await guard(tx,row,context);await tx.sql`UPDATE "RHOperation" SET status='PREPARING',"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${id}`;return access;});
  const p=access.permission!;
  let data:any;
  if(op.kind==='WITHDRAW') {
    const rawAmount=weiAmount(op.amount);data={rawAmount:rawAmount.toString(),maxFeeWei:p.maxFeeWei,recipient:access.wallet.ownerAddress,transfer:{to:access.wallet.ownerAddress,value:rawAmount.toString(),data:'0x',chainId:ROBINHOOD_CHAIN_ID}};
  } else {const q=await quoteSwap(op.walletAddress,op.kind,op.tokenAddress,op.amount,p.slippageBps);data={quote:q,maxFeeWei:p.maxFeeWei};}
  await transaction(async tx=>{await lockUser(tx,userId);const fresh=await operationFor(userId,id,tx);check(fresh?.status==='PREPARING',409,'Operation was cancelled during preparation.');op={...fresh,data};const {budget}=await budgets(tx,op,context);await tx.sql`UPDATE "RHOperation" SET data=${JSON.stringify(data)}::jsonb,"budgetWei"=${budget.toString()},"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${id}`;});
  return (await operationFor(userId,id))!;
}
export async function prepareWithdrawalPreview(userId:string,op:RhOperation,context:ChatContext) {
  op=await prepareOperation(userId,op.id,context);const tx=await prepareTransaction(op.walletAddress,op.data.transfer,BigInt(op.data.maxFeeWei));
  const code=randomBytes(6).toString('hex').toUpperCase(),expiry=new Date(Date.now()+120000);
  await transaction(async txdb=>{await lockUser(txdb,userId);const fresh=await operationFor(userId,op.id,txdb);check(fresh?.status==='PREPARING',409,'Withdrawal was cancelled.');await budgets(txdb,{...fresh,data:op.data},context);await txdb.sql`UPDATE "RHOperation" SET status='PREVIEW',data=${JSON.stringify({...op.data,transfer:tx})}::jsonb,"confirmationHash"=${hash(code)},"confirmationExpiresAt"=${expiry},"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${op.id}`;});
  return {code,expiry,op:(await operationFor(userId,op.id))!};
}
async function gasRemaining(op:RhOperation) {
  let used=0n;if(op.approvalHash){const receipt=await rpc('eth_getTransactionReceipt',[op.approvalHash]);check(receipt?.status==='0x1',409,'Token approval is not confirmed. No swap was submitted.');used=BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice);}
  const remaining=BigInt(op.data.maxFeeWei)-used;check(remaining>0n,400,'Approval used the signed gas allowance. No swap was submitted.');return remaining;
}
async function sendOnce(op:RhOperation,tx:RhTransaction,phase:'APPROVAL'|'SWAP'|'WITHDRAW',context?:ChatContext) {
  const access=await transaction(async txdb=>{await lockUser(txdb,op.userId);await assertIdle(txdb,op.userId,op.id);const fresh=await operationFor(op.userId,op.id,txdb);check(fresh&&['PREPARING','APPROVAL_CONFIRMED'].includes(fresh.status),409,'Operation is no longer available for signing.');return budgets(txdb,fresh,context);});
  const nonce=Number(BigInt(await rpc('eth_getTransactionCount',[op.walletAddress,'pending']))),mined=Number(BigInt(await rpc('eth_getTransactionCount',[op.walletAddress,'latest'])));check(Number.isSafeInteger(nonce)&&nonce===mined,409,'This trading wallet has an unresolved network transaction. Check its status first.');
  if(op.kind!=='WITHDRAW'){check(new Date(op.data.quote.expiresAt)>new Date(),409,'The swap quote expired before signing. No swap was submitted.');await verifySettler(op.data.quote.settler);validateSwapData(op.data.quote,op.walletAddress);}
  const key=openKey(access.wallet);const wire=await signEvmTransaction(key,tx,nonce),txHash=keccak256(wire);
  // Persist the exact signature before the only network send. Unknown results are never resent.
  await transaction(async txdb=>{await lockUser(txdb,op.userId);const fresh=await operationFor(op.userId,op.id,txdb);check(fresh&&['PREPARING','APPROVAL_CONFIRMED'].includes(fresh.status),409,'Operation changed before signing.');await budgets(txdb,fresh,context);await assertIdle(txdb,op.userId,op.id);if(phase==='APPROVAL')await txdb.sql`UPDATE "RHOperation" SET status='SIGNED',"approvalHash"=${txHash},nonce=${nonce},"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${op.id}`;else await txdb.sql`UPDATE "RHOperation" SET status='SIGNED',"txHash"=${txHash},nonce=${nonce},"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${op.id}`;});
  let broadcastStarted=false;
  try {
    // No auto-retrying transaction wrapper around a financial network send.
    await db.transaction(async txdb=>{await lockUser(txdb,op.userId);const fresh=await operationFor(op.userId,op.id,txdb);check(fresh?.status==='SIGNED',409,'Operation was already claimed.');await budgets(txdb,fresh,context);broadcastStarted=true;const returned=await rpc('eth_sendRawTransaction',[wire]);check(typeof returned==='string'&&returned.toLowerCase()===txHash,502,'Submission could not be verified. Check its saved hash; do not repeat the order.');await txdb.sql`UPDATE "RHOperation" SET status=${phase==='APPROVAL'?'APPROVAL_SUBMITTED':'EXECUTING'},"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${op.id}`;});
  } catch {
    if(!broadcastStarted){await db.sql`UPDATE "RHOperation" SET status='CANCELLED',"txHash"=NULL,"approvalHash"=${op.approvalHash},error='Access changed before submission. This transaction was not sent.',"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${op.id} AND status='SIGNED'`;return {hash:txHash,pending:true};}
    await db.sql`UPDATE "RHOperation" SET status='UNKNOWN',error='Submission is uncertain. No automatic retry will occur.',"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${op.id} AND status='SIGNED'`;
    return {hash:txHash,pending:true};
  }
  const receipt=await rpc('eth_getTransactionReceipt',[txHash]).catch(()=>null);
  return {hash:txHash,pending:!receipt,receipt};
}
export async function executeOperation(userId:string,id:string,context?:ChatContext) {
  let op=await operationFor(userId,id);check(op,404,'Operation not found.');
  if(op.txHash||op.approvalHash||!['QUEUED','PREVIEW','PREPARING'].includes(op.status))return reconcileOperation(userId,id);
  try {
    if(!op.data.quote&&!op.data.transfer)op=await prepareOperation(userId,id,context);
    if(op.status==='PREVIEW') {await transaction(async tx=>{await lockUser(tx,userId);const fresh=await operationFor(userId,id,tx);check(fresh?.status==='PREVIEW',409,'Review was already used.');await budgets(tx,fresh,context);await assertIdle(tx,userId,id);await tx.sql`UPDATE "RHOperation" SET status='PREPARING',"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${id}`;});op=(await operationFor(userId,id))!;}
    if(op.kind==='WITHDRAW') {const tx=await prepareTransaction(op.walletAddress,op.data.transfer,BigInt(op.data.maxFeeWei));await sendOnce(op,tx,'WITHDRAW',context);return reconcileOperation(userId,id);}
    const q=op.data.quote as RhQuote;
    if(q.approval){
      check(await assetBalance(op.walletAddress,q.token)>=BigInt(q.sellAmount),400,'Not enough tokens in the dedicated trading wallet.');
      const approval:RhTransaction={to:q.approval.token,data:erc20.encodeFunctionData('approve',[holder,q.approval.amount]),value:'0',chainId:ROBINHOOD_CHAIN_ID};
      const prepared=await prepareTransaction(op.walletAddress,approval,BigInt(op.data.maxFeeWei));const result=await sendOnce(op,prepared,'APPROVAL',context);
      if(!result.receipt)for(let i=0;i<6;i++){await new Promise(resolve=>setTimeout(resolve,800));result.receipt=await rpc('eth_getTransactionReceipt',[result.hash]).catch(()=>null);if(result.receipt)break;}
      if(!result.receipt)return (await operationFor(userId,id))!;
      if(result.receipt.status!=='0x1'){await db.sql`UPDATE "RHOperation" SET status='FAILED',error='Token approval failed. No swap was submitted.',"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${id}`;return (await operationFor(userId,id))!;}
      await db.sql`UPDATE "RHOperation" SET status='APPROVAL_CONFIRMED',"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${id}`;op=(await operationFor(userId,id))!;
    }
    const tx=await prepareTransaction(op.walletAddress,q.transaction,await gasRemaining(op));await sendOnce(op,tx,'SWAP',context);return reconcileOperation(userId,id);
  } catch(error) {
    const saved=await operationFor(userId,id);if(saved&&(saved.txHash||saved.approvalHash)){await db.sql`UPDATE "RHOperation" SET status=${saved.status==='APPROVAL_CONFIRMED'?'APPROVAL_ONLY':'UNKNOWN'},error=${error instanceof AppError?error.message:'Operation could not complete. Check the saved transaction before retrying.'},"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${id}`;}
    else await db.sql`UPDATE "RHOperation" SET status='REJECTED',error=${error instanceof AppError?error.message:'Preparation failed. No transaction was submitted.'},"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${id}`;
    return (await operationFor(userId,id))!;
  }
}
export async function reconcileOperation(userId:string,id:string) {
  const op=await operationFor(userId,id);check(op,404,'Operation not found.');
  if(!pendingStates.includes(op.status))return op;
  const signature=op.txHash||op.approvalHash;
  if(signature){const receipt=await rpc('eth_getTransactionReceipt',[signature]).catch(()=>null);if(receipt){const status=receipt.status==='0x1'?(op.txHash?'CONFIRMED':'APPROVAL_ONLY'):'FAILED';await db.sql`UPDATE "RHOperation" SET status=${status},error=${!op.txHash?'Only token approval completed. No swap was submitted; send a fresh order after checking limits.':receipt.status==='0x1'?null:'Transaction failed on-chain. Gas may still apply.'},"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${id}`;}}
  else if(Date.now()-op.updatedAt.getTime()>120000)await db.sql`UPDATE "RHOperation" SET status='CANCELLED',error='Preparation expired before signing.',"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE id=${id}`;
  return (await operationFor(userId,id))!;
}
export function operationReply(op:RhOperation) {
  const presentation=operationPresentation(op);
  const title=op.status==='CONFIRMED'?'CONFIRMED':op.status==='PREVIEW'?presentation.statusLabel.toUpperCase():op.status==='APPROVAL_ONLY'?'APPROVAL ONLY · SWAP NOT SUBMITTED':['REJECTED','CANCELLED','FAILED'].includes(op.status)?'NOT EXECUTED':!op.txHash&&!op.approvalHash?'PREPARING · NOT SUBMITTED':'CONFIRMATION PENDING';
  const q=op.data.quote as RhQuote|undefined;
  return `ROBINHOOD ${title} · ${op.kind==='BUY'?`Buy with ${op.amount} ETH`:op.kind==='SELL'?`Sell ${op.amount} ${q?.symbol||'tokens'}`:`Withdraw ${op.amount} ${op.data.assetSymbol||(op.tokenAddress===ETH_TOKEN?'ETH':'tokens')}`}\n${op.kind!=='WITHDRAW'?`Token address: ${op.tokenAddress}\n`: `Recipient: ${op.data.recipient}\n`}Trading wallet: ${op.walletAddress}\nRequested at (UTC): ${op.createdAt.toISOString()}\n${q?`Minimum receive: ${fromWei(q.minBuyAmount,op.kind==='BUY'?q.decimals:18)} ${op.kind==='BUY'?q.symbol:'ETH'}\n`:''}${presentation.statusDescription?presentation.statusDescription+'\n':''}${op.error?op.error+'\n':''}${op.txHash?'https://robinhoodchain.blockscout.com/tx/'+op.txHash+'\n':''}${op.approvalHash?'Approval transaction: https://robinhoodchain.blockscout.com/tx/'+op.approvalHash+'\n':''}Reference: ${op.id}${pendingStates.includes(op.status)?'\nDo not resend. Check trade or Check withdrawal reads status without repeating the operation.':''}`;
}
