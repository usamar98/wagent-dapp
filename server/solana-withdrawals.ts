import { Router } from 'express';
import bs58 from 'bs58';
import { address, getProgramDerivedAddress } from '@solana/addresses';
import { z } from 'zod';
import { db, transaction } from './db.js';
import { auth, check, hash, token, AppError } from './security.js';
import { env } from './env.js';
import { SOL_MINT, addressSchema, atomicAmount, humanAmount, rpc, signatureStatus, finalizedBlockHeight } from './solana-providers.js';
import { permissionSession, permissionProofInput, revokeTrading } from './solana-permissions.js';
import { noPendingChatTrade, reconcileChatTrade } from './solana-chat-trading.js';
import { SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022, ASSOCIATED_PROGRAM } from './chat-transaction-policy.js';
import { signTradingTransaction } from './trading-wallet-keys.js';
import { verifySolanaSignature, decodeSwapTransaction } from './solana-swaps.js';

const MAX_WITHDRAWAL_FEE=10000000n;
function short(value:number){const bytes:number[]=[];do{const next=value&127;value>>>=7;bytes.push(next|(value?128:0));}while(value);return Buffer.from(bytes);}
type Instruction={program:string;accounts:string[];data:Buffer};
function wire(wallet:string,blockhash:string,instructions:Instruction[],mint:string){
  const all=[...new Set(instructions.flatMap(ix=>[...ix.accounts,ix.program]))],readonly=all.filter(a=>a!==wallet&&[mint,SYSTEM_PROGRAM,TOKEN_PROGRAM,TOKEN_2022,ASSOCIATED_PROGRAM].includes(a)),writable=all.filter(a=>a!==wallet&&!readonly.includes(a)),keys=[wallet,...writable,...readonly];
  const parts:Buffer[]=[Buffer.from([1,0,readonly.length]),short(keys.length),...keys.map(k=>Buffer.from(bs58.decode(k))),Buffer.from(bs58.decode(blockhash)),short(instructions.length)];
  for(const ix of instructions)parts.push(Buffer.from([keys.indexOf(ix.program)]),short(ix.accounts.length),Buffer.from(ix.accounts.map(a=>keys.indexOf(a))),short(ix.data.length),ix.data);
  const message=Buffer.concat(parts),transaction=Buffer.concat([Buffer.from([1]),Buffer.alloc(64),message]).toString('base64');decodeSwapTransaction(transaction,wallet);return transaction;
}
export function solTransferWire(from:string,to:string,amount:string,blockhash:string){
  check(from!==to,400,'The owner and trading-wallet addresses must be different.');
  const data=Buffer.alloc(12);data.writeUInt32LE(2);data.writeBigUInt64LE(BigInt(amount),4);
  return wire(from,blockhash,[{program:SYSTEM_PROGRAM,accounts:[from,to],data}],SOL_MINT);
}
export async function buildWithdrawal(wallet:string,owner:string,mint:string,value:string){
  check(wallet!==owner,400,'Withdrawal recipient must be your original owner wallet.');
  const block=await rpc('getLatestBlockhash',[{commitment:'confirmed'}]);check(addressSchema.safeParse(block?.value?.blockhash).success&&Number.isSafeInteger(block.value.lastValidBlockHeight),502,'A fresh blockhash is unavailable.');
  const instructions:Instruction[]=[];let rawAmount:string;
  if(mint===SOL_MINT){rawAmount=atomicAmount(value,9);const data=Buffer.alloc(12);data.writeUInt32LE(2);data.writeBigUInt64LE(BigInt(rawAmount),4);instructions.push({program:SYSTEM_PROGRAM,accounts:[wallet,owner],data});}
  else{
    const response=await rpc('getTokenAccountsByOwner',[wallet,{mint},{encoding:'jsonParsed',commitment:'confirmed'}]);check(Array.isArray(response?.value)&&response.value.length<=100,502,'Token accounts could not be read.');
    const candidates=response.value.filter((row:any)=>[TOKEN_PROGRAM,TOKEN_2022].includes(row.account?.owner)&&row.account?.data?.parsed?.info?.owner===wallet&&row.account.data.parsed.info.mint===mint);
    check(candidates.length,400,'This trading wallet has no account for that token.');
    const decimals=candidates[0].account.data.parsed.info.tokenAmount.decimals;check(Number.isInteger(decimals)&&decimals>=0&&decimals<=18,400,'Unsupported token decimals.');rawAmount=atomicAmount(value,decimals);
    const source=candidates.find((row:any)=>/^\d{1,20}$/.test(row.account.data.parsed.info.tokenAmount.amount)&&BigInt(row.account.data.parsed.info.tokenAmount.amount)>=BigInt(rawAmount));check(source,400,'No single token account holds the requested amount. Withdraw a smaller amount.');
    const program=source.account.owner;check(addressSchema.safeParse(source.pubkey).success,502,'Invalid token account.');
    const [destination]=await getProgramDerivedAddress({programAddress:address(ASSOCIATED_PROGRAM),seeds:[bs58.decode(owner),bs58.decode(program),bs58.decode(mint)]});
    instructions.push({program:ASSOCIATED_PROGRAM,accounts:[wallet,destination,owner,mint,SYSTEM_PROGRAM,program],data:Buffer.from([1])});
    const data=Buffer.alloc(10);data[0]=12;data.writeBigUInt64LE(BigInt(rawAmount),1);data[9]=decimals;
    instructions.push({program,accounts:[source.pubkey,mint,destination,wallet],data});
  }
  const unsigned=wire(wallet,block.value.blockhash,instructions,mint),decoded=decodeSwapTransaction(unsigned,wallet);
  const fee=await rpc('getFeeForMessage',[Buffer.from(decoded.messageBytes).toString('base64'),{commitment:'confirmed'}]);check(Number.isSafeInteger(fee?.value)&&fee.value>=0&&BigInt(fee.value)<=MAX_WITHDRAWAL_FEE,400,'Withdrawal network fee exceeds 0.01 SOL.');
  // Verify total rent plus network cost, rather than relying on the fee estimate alone.
  const balance=await rpc('getBalance',[wallet,{commitment:'confirmed'}]);check(Number.isSafeInteger(balance?.value)&&balance.value>=0,502,'Wallet balance is unavailable.');
  const simulation=await rpc('simulateTransaction',[unsigned,{encoding:'base64',commitment:'confirmed',sigVerify:false,replaceRecentBlockhash:false,accounts:{encoding:'base64',addresses:[wallet]}}]);
  check(simulation?.value?.err===null,400,'Withdrawal simulation failed. Check token funds and keep SOL for fees and account rent.');
  const after=simulation.value.accounts?.[0];check(after&&Number.isSafeInteger(after.lamports)&&after.owner===SYSTEM_PROGRAM&&BigInt(balance.value)-BigInt(after.lamports)<=(mint===SOL_MINT?BigInt(rawAmount):0n)+MAX_WITHDRAWAL_FEE,400,'Withdrawal would exceed the approved fee and rent cap.');
  return {unsigned,rawAmount,lastValidBlockHeight:String(block.value.lastValidBlockHeight)};
}
export const solanaWithdrawalRouter=Router();solanaWithdrawalRouter.use(auth);
solanaWithdrawalRouter.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
solanaWithdrawalRouter.get('/balance',async(req,res)=>{
  const wallet=await db.solanaTradingWallet.findUnique({where:{userId:req.user!.id}});check(wallet,404,'Create a dedicated wallet first.');
  const sol=await rpc('getBalance',[wallet.address,{commitment:'confirmed'}]);check(Number.isSafeInteger(sol?.value)&&sol.value>=0,502,'Balance is unavailable.');
  const tokens:any[]=[];
  for(const programId of [TOKEN_PROGRAM,TOKEN_2022]){
    const response=await rpc('getTokenAccountsByOwner',[wallet.address,{programId},{encoding:'jsonParsed',commitment:'confirmed'}]);check(Array.isArray(response?.value)&&response.value.length<=100,502,'Token balances are unavailable.');
    for(const row of response.value){const info=row.account?.data?.parsed?.info;if(info?.owner===wallet.address&&addressSchema.safeParse(info.mint).success&&/^\d{1,20}$/.test(info.tokenAmount?.amount)&&Number.isInteger(info.tokenAmount.decimals)&&info.tokenAmount.decimals>=0&&info.tokenAmount.decimals<=18&&BigInt(info.tokenAmount.amount)>0n)tokens.push({mint:info.mint,amount:humanAmount(info.tokenAmount.amount,info.tokenAmount.decimals)});}
  }
  res.json({sol:humanAmount(String(sol.value),9),tokens});
});
solanaWithdrawalRouter.post('/withdrawal/challenge',async(req,res)=>{
  const input=z.object({mint:addressSchema,amount:z.string().regex(/^\d{1,12}(?:\.\d{1,18})?$/)}).strict().parse(req.body);check(Number(input.amount)>0,400,'Enter a positive withdrawal amount.');
  const proof=await transaction(async tx=>{
    const userId=await permissionSession(tx,req,true),wallet=await tx.solanaTradingWallet.findUnique({where:{userId}});check(wallet,404,'Trading wallet not found.');
    await revokeTrading(tx,userId,'Trading permission revoked to withdraw funds.');await noPendingChatTrade(tx,userId);
    const message=`${new URL(env.appUrl).host} · Wagent Ai withdrawal authorization\nAccount: ${userId}\nNetwork: solana:mainnet\nFrom dedicated wallet: ${wallet.address}\nTo original owner wallet: ${wallet.ownerAddress}\nAsset: ${input.mint===SOL_MINT?'Native SOL':input.mint}\nAmount: ${input.amount}\nMaximum network fee and account rent: 0.01 SOL\n\nI authorize this one transfer to my original owner wallet. This revokes chat trading. It does not grant ongoing spending permission.\nNonce: ${token()}`;
    return tx.solanaPermissionChallenge.upsert({where:{userId_purpose:{userId,purpose:'WITHDRAWAL'}},create:{userId,purpose:'WITHDRAWAL',sessionId:hash(req.cookies.ab_session),address:wallet.ownerAddress,message,payload:input,expiresAt:new Date(Date.now()+300000)},update:{sessionId:hash(req.cookies.ab_session),address:wallet.ownerAddress,message,payload:input,expiresAt:new Date(Date.now()+300000)}});
  });res.json({id:proof.id,address:proof.address,message:proof.message});
});
solanaWithdrawalRouter.post('/withdrawal',async(req,res)=>{
  const input=permissionProofInput.parse(req.body),userId=req.user!.id;
  const proof=await db.solanaPermissionChallenge.findFirst({where:{id:input.id,userId,purpose:'WITHDRAWAL',sessionId:hash(req.cookies.ab_session)}});
  check(proof&&proof.expiresAt>new Date()&&verifySolanaSignature(proof.address,Buffer.from(proof.message),Buffer.from(input.signature,'base64')),400,'A fresh signature from the original owner wallet is required.');
  const wallet=await db.solanaTradingWallet.findUnique({where:{userId}});check(wallet?.ownerAddress===proof.address,409,'Trading wallet ownership changed.');
  const built=await buildWithdrawal(wallet.address,wallet.ownerAddress,proof.payload.mint,proof.payload.amount);
  const prepared=await transaction(async tx=>{
    await permissionSession(tx,req,true);await noPendingChatTrade(tx,userId);
    const fresh=await tx.solanaPermissionChallenge.findFirst({where:{id:proof.id,userId,purpose:'WITHDRAWAL',sessionId:hash(req.cookies.ab_session)}});check(fresh&&fresh.expiresAt>new Date()&&fresh.message===proof.message,400,'Withdrawal proof changed, expired, or was already used.');
    await tx.solanaPermissionChallenge.delete({where:{id:proof.id}});await revokeTrading(tx,userId,'Trading revoked for an owner-signed withdrawal.');
    const signed=signTradingTransaction(wallet,built.unsigned);
    const withdrawal=await tx.solanaWalletWithdrawal.create({data:{userId,walletAddress:wallet.address,ownerAddress:wallet.ownerAddress,mint:proof.payload.mint,amount:proof.payload.amount,signature:signed.signature,lastValidBlockHeight:built.lastValidBlockHeight}});return {signed,withdrawal};
  });let attempted=false;
  try{
    await db.transaction(async tx=>{
      await permissionSession(tx,req,true);
      const record=await tx.solanaWalletWithdrawal.findUniqueOrThrow({where:{id:prepared.withdrawal.id}});check(record.status==='PREPARED',409,'Withdrawal already claimed.');
      await tx.solanaWalletWithdrawal.update({where:{id:record.id},data:{status:'EXECUTING'}});attempted=true;
      let accepted=false;try{accepted=await rpc('sendTransaction',[prepared.signed.signedTransaction,{encoding:'base64',skipPreflight:false,maxRetries:0,preflightCommitment:'confirmed'}])===record.signature;}catch{/* Persist unknown, never resend. */}
      await tx.solanaWalletWithdrawal.update({where:{id:record.id},data:{status:'UNKNOWN',error:accepted?'Submitted; check confirmation.':'Submission could not be confirmed. Do not repeat the withdrawal.'}});
    },{timeout:45000,maxWait:15000});
  }catch(error){await db.solanaWalletWithdrawal.updateMany({where:{id:prepared.withdrawal.id,status:{in:['PREPARED','EXECUTING']}},data:{status:attempted?'UNKNOWN':'CANCELLED',error:error instanceof AppError?error.message:'Check withdrawal confirmation before trying again.'}});}
  res.json(await db.solanaWalletWithdrawal.findUniqueOrThrow({where:{id:prepared.withdrawal.id}}));
});
solanaWithdrawalRouter.post('/trades/:id/reconcile',async(req,res)=>res.json(await reconcileChatTrade(req.user!.id,String(req.params.id))));
solanaWithdrawalRouter.post('/withdrawals/:id/reconcile',async(req,res)=>{
  const record=await db.solanaWalletWithdrawal.findFirst({where:{id:String(req.params.id),userId:req.user!.id}});check(record,404,'Withdrawal not found.');
  if(['PREPARED','EXECUTING','UNKNOWN'].includes(record.status)){
    const status=await signatureStatus(record.signature);
    if(status&&(status.err||['confirmed','finalized'].includes(status.confirmationStatus)))await db.solanaWalletWithdrawal.updateMany({where:{id:record.id,status:{in:['PREPARED','EXECUTING','UNKNOWN']}},data:{status:status.err?'FAILED':'CONFIRMED',error:status.err?'Transfer failed on-chain; network fees may apply.':null}});
    else if(!status&&Date.now()-record.createdAt.getTime()>600000&&BigInt(await finalizedBlockHeight())>BigInt(record.lastValidBlockHeight)+32n&&!await signatureStatus(record.signature))await db.solanaWalletWithdrawal.updateMany({where:{id:record.id,status:{in:['PREPARED','EXECUTING','UNKNOWN']}},data:{status:'FAILED',error:'Transfer expired without an observed confirmation. No transaction was rebroadcast.'}});
  }res.json(await db.solanaWalletWithdrawal.findUniqueOrThrow({where:{id:record.id}}));
});
