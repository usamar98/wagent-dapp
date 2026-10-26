import { Router, type Request } from 'express';
import { createPublicKey, verify } from 'node:crypto';
import bs58 from 'bs58';
import { getTransactionDecoder, getTransactionEncoder } from '@solana/transactions';
import { getCompiledTransactionMessageDecoder } from '@solana/transaction-messages';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db, transaction, lockUser, type Tx } from './db.js';
import { auth, check, hash, token, AppError } from './security.js';
import { env } from './env.js';
import { rateLimitKey } from './rate-limit.js';
import { SOL_MINT, addressSchema, providerStatus, atomicAmount, humanAmount, tokenMetadata, jupiterOrder, jupiterExecute, signatureStatus, finalizedBlockHeight } from './solana-providers.js';
import type { ModelRows } from './database/schema.js';
import { registerProductionWebsite } from './website-runtime.js';
import { revokeTrading, chatTradingEnabled } from './solana-permissions.js';

type Swap=ModelRows['SolanaSwap'];
const unresolved=['EXECUTING','UNKNOWN'];
function sessionId(req:Request){return hash(req.cookies?.ab_session || '');}
export function verifySolanaSignature(address:string,message:Uint8Array,signature:Uint8Array){
  try{return signature.length===64&&verify(null,message,createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),bs58.decode(address)]),format:'der',type:'spki'}),signature);}catch{return false;}
}
function base64(value:string){check(/^[A-Za-z0-9+/]+={0,2}$/.test(value)&&value.length%4===0,400,'Invalid transaction encoding.');const bytes=Buffer.from(value,'base64');check(bytes.length<=1232,400,'Transaction exceeds Solana’s size limit.');return bytes;}
export function decodeSwapTransaction(value:string,wallet:string){
  try{
    const bytes=base64(value),tx=getTransactionDecoder().decode(bytes),message=getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    check(Buffer.from(getTransactionEncoder().encode(tx)).equals(bytes),400,'Non-canonical transaction.');
    check(message.version===0||message.version==='legacy',400,'Unsupported transaction version.');
    check(message.staticAccounts[0]===wallet&&Object.keys(tx.signatures)[0]===wallet,400,'This route requires a different fee payer. Keep SOL for fees and request a new quote.');
    return tx;
  }catch(error){if(error instanceof AppError)throw error;throw new AppError(400,'The Solana transaction could not be decoded.');}
}
export function validateSignedSwap(unsigned:string,signed:string,wallet:string){
  const original=decodeSwapTransaction(unsigned,wallet),tx=decodeSwapTransaction(signed,wallet);
  check(Buffer.from(tx.messageBytes).equals(Buffer.from(original.messageBytes)),400,'The signed transaction differs from the reviewed quote.');
  for(const [address,signature]of Object.entries(tx.signatures)){
    if(address===wallet){check(signature&&verifySolanaSignature(wallet,Buffer.from(tx.messageBytes),Buffer.from(signature)),400,'The wallet signature is invalid.');}
    else{const before=original.signatures[address as keyof typeof original.signatures];check(signature&&before&&Buffer.from(signature).equals(Buffer.from(before))&&verifySolanaSignature(address,Buffer.from(tx.messageBytes),Buffer.from(signature)),400,'An additional transaction signature changed or is missing.');}
  }
  return bs58.encode(tx.signatures[wallet as keyof typeof tx.signatures]!);
}
function view(swap:Swap,includeTransaction=false){const {unsignedTransaction,providerRequestId,userId,...rest}=swap;return {...rest,...(includeTransaction&&swap.status==='QUOTED'&&swap.expiresAt>new Date()?{transaction:unsignedTransaction}:{})};}
async function liveUser(tx:Tx,req:Request){
  const userId=req.user!.id;await lockUser(tx,userId);
  const [user,session]=await Promise.all([tx.user.findUnique({where:{id:userId}}),tx.session.findUnique({where:{id:sessionId(req)}})]);
  check(user&&!user.disabled&&session?.userId===userId&&session.expiresAt>new Date(),401,'Your account session expired. Sign in again.');
  check(!user.emergencyStop,409,'Emergency stop is active. Clear it before preparing or submitting a swap.');return user;
}
async function noUnresolved(tx:Tx,userId:string){check(!await tx.solanaSwap.findFirst({where:{userId,status:{in:unresolved}}}),409,'A previous swap still needs confirmation. Check its status before creating another order.');}
export const solanaSwapsRouter=Router();
solanaSwapsRouter.get('/capabilities',async(_req,res)=>{await registerProductionWebsite();res.json({...providerStatus(),chatTradingEnabled:chatTradingEnabled()});});
solanaSwapsRouter.use(auth);
solanaSwapsRouter.use(rateLimit({windowMs:60000,limit:60,keyGenerator:rateLimitKey,standardHeaders:'draft-8',legacyHeaders:false}));
solanaSwapsRouter.post('/wallet/challenge',async(req,res)=>{
  const {address}=z.object({address:addressSchema}).strict().parse(req.body);
  const challenge=await transaction(async tx=>{
    await liveUser(tx,req);await noUnresolved(tx,req.user!.id);
    const expiresAt=new Date(Date.now()+300000);
    const message=`${new URL(env.appUrl).host} wants to link your Solana wallet to Wagent Ai.\n\nWallet: ${address}\nAccount: ${req.user!.id}\nNetwork: solana:mainnet\nNonce: ${token()}\nExpires: ${expiresAt.toISOString()}\n\nThis proves ownership. It does not authorize a swap or transfer funds.`;
    return tx.solanaWalletChallenge.upsert({where:{userId:req.user!.id},create:{userId:req.user!.id,address,message,sessionId:sessionId(req),expiresAt},update:{address,message,sessionId:sessionId(req),expiresAt}});
  });res.json({id:challenge.id,message:challenge.message,expiresAt:challenge.expiresAt});
});
solanaSwapsRouter.post('/wallet/verify',async(req,res)=>{
  const input=z.object({id:z.string().max(100),signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/)}).strict().parse(req.body);
  const wallet=await transaction(async tx=>{
    await liveUser(tx,req);await noUnresolved(tx,req.user!.id);
    const proof=await tx.solanaWalletChallenge.findFirst({where:{id:input.id,userId:req.user!.id,sessionId:sessionId(req)}});
    check(proof&&proof.expiresAt>new Date(),400,'Wallet proof expired or was already used. Connect again.');
    check(verifySolanaSignature(proof.address,Buffer.from(proof.message,'utf8'),Buffer.from(input.signature,'base64')),400,'Invalid Solana ownership signature.');
    await tx.solanaWalletChallenge.delete({where:{id:proof.id}});
    await tx.solanaSwap.updateMany({where:{userId:req.user!.id,status:'QUOTED'},data:{status:'CANCELLED'}});
    const owner=await tx.solanaWallet.findUnique({where:{address:proof.address}});check(!owner||owner.userId===req.user!.id,409,'This Solana wallet is already linked to another account.');
    const previous=await tx.solanaWallet.findUnique({where:{userId:req.user!.id}});if(previous?.address!==proof.address)await revokeTrading(tx,req.user!.id,'Changing the linked Solana wallet revoked chat trading permission.');
    return tx.solanaWallet.upsert({where:{userId:req.user!.id},create:{userId:req.user!.id,address:proof.address},update:{address:proof.address,verifiedAt:new Date()}});
  });res.json(wallet);
});
solanaSwapsRouter.post('/wallet/disconnect',async(req,res)=>{
  await transaction(async tx=>{await lockUser(tx,req.user!.id);await noUnresolved(tx,req.user!.id);await revokeTrading(tx,req.user!.id,'Unlinking the Solana wallet revoked chat trading permission.');await tx.solanaWallet.deleteMany({where:{userId:req.user!.id}});await tx.solanaWalletChallenge.deleteMany({where:{userId:req.user!.id}});await tx.solanaSwap.updateMany({where:{userId:req.user!.id,status:'QUOTED'},data:{status:'CANCELLED'}});});res.json({ok:true});
});
solanaSwapsRouter.get('/swaps',async(req,res)=>{
  await db.solanaSwap.updateMany({where:{userId:req.user!.id,status:'QUOTED',expiresAt:{lte:new Date()}},data:{status:'EXPIRED'}});
  const [wallet,swaps]=await Promise.all([db.solanaWallet.findUnique({where:{userId:req.user!.id}}),db.solanaSwap.findMany({where:{userId:req.user!.id},orderBy:{createdAt:'desc'},take:30})]);res.json({wallet,swaps:swaps.map(s=>view(s)),providers:providerStatus()});
});
solanaSwapsRouter.post('/swaps/quote',rateLimit({windowMs:60000,limit:12,keyGenerator:rateLimitKey,standardHeaders:'draft-8',legacyHeaders:false}),async(req,res)=>{
  check(providerStatus().swapsEnabled,503,'Swaps need JUPITER_API_KEY and SOLANA_SWAPS_ENABLED=true on the server.');
  const input=z.object({side:z.enum(['BUY','SELL']),mint:addressSchema,amount:z.string().max(32),slippageBps:z.number().int().min(1).max(500),requestId:z.uuid()}).strict().parse(req.body);
  check(input.mint!==SOL_MINT,400,'Choose a Solana token other than SOL.');
  const state=await transaction(async tx=>{await liveUser(tx,req);const existing=await tx.solanaSwap.findFirst({where:{userId:req.user!.id,clientRequestId:input.requestId}});if(existing)return {existing,wallet:null};await noUnresolved(tx,req.user!.id);const wallet=await tx.solanaWallet.findUnique({where:{userId:req.user!.id}});check(wallet,409,'Connect and verify your Solana wallet first.');return {existing:null,wallet};});
  if(state.existing){res.json(view(state.existing,true));return;}
  const wallet=state.wallet!;
  const tokenInfo=await tokenMetadata(input.mint),sol=await tokenMetadata(SOL_MINT),from=input.side==='BUY'?sol:tokenInfo,to=input.side==='BUY'?tokenInfo:sol;
  const amount=atomicAmount(input.amount,from.decimals),order=await jupiterOrder(from.id,to.id,amount,wallet.address,input.slippageBps);
  check(!order.signatureFeePayer||order.signatureFeePayer===wallet.address,400,'This quote uses a sponsored fee payer. Keep SOL for network fees and request a new quote.');
  decodeSwapTransaction(order.transaction,wallet.address);
  check(order.slippageBps!==undefined&&order.slippageBps<=input.slippageBps,502,'Jupiter returned slippage above your limit.');
  const expiry=Math.min(Date.now()+60000,order.expireAt?Date.parse(order.expireAt):Infinity);check(Number.isFinite(expiry)&&expiry>Date.now()+3000,502,'Jupiter returned an expired quote. Request another.');
  const swap=await transaction(async tx=>{
    await liveUser(tx,req);await noUnresolved(tx,req.user!.id);
    const existing=await tx.solanaSwap.findFirst({where:{userId:req.user!.id,clientRequestId:input.requestId}});if(existing)return existing;
    check((await tx.solanaWallet.findUnique({where:{userId:req.user!.id}}))?.address===wallet.address,409,'Your Solana wallet changed. Request a fresh quote.');
    await tx.solanaSwap.updateMany({where:{userId:req.user!.id,status:'QUOTED'},data:{status:'CANCELLED'}});
    return tx.solanaSwap.create({data:{userId:req.user!.id,clientRequestId:input.requestId,providerRequestId:order.requestId,walletAddress:wallet.address,inputMint:from.id,outputMint:to.id,inputAmount:amount,outputAmount:order.outAmount,unsignedTransaction:order.transaction,expiresAt:new Date(expiry),quote:{side:input.side,from,to,input:humanAmount(amount,from.decimals),output:humanAmount(order.outAmount,to.decimals),minimumOutput:humanAmount(order.otherAmountThreshold,to.decimals),router:order.router,slippageBps:order.slippageBps,feeBps:order.feeBps??0,feeMint:order.feeMint??null,networkFeeLamports:(order.signatureFeeLamports??0)+(order.prioritizationFeeLamports??0)+(order.rentFeeLamports??0),priceImpact:order.priceImpact??null,lastValidBlockHeight:order.lastValidBlockHeight??null}}});
  });res.status(201).json(view(swap,true));
});
solanaSwapsRouter.post('/swaps/:id/execute',async(req,res)=>{
  check(providerStatus().swapsEnabled,503,'Swaps are currently disabled.');
  const {signedTransaction}=z.object({signedTransaction:z.string().max(2000)}).strict().parse(req.body);
  const claimed=await transaction(async tx=>{
    await liveUser(tx,req);const swap=await tx.solanaSwap.findFirst({where:{id:String(req.params.id),userId:req.user!.id}});check(swap,404,'Swap not found.');
    if(swap.status!=='QUOTED')return {swap,send:false};
    check(swap.expiresAt>new Date(),409,'Quote expired. Request a fresh quote.');
    check((await tx.solanaWallet.findUnique({where:{userId:req.user!.id}}))?.address===swap.walletAddress,409,'The connected Solana wallet changed.');
    await noUnresolved(tx,req.user!.id);
    const signature=validateSignedSwap(swap.unsignedTransaction,signedTransaction,swap.walletAddress);
    const updated=await tx.solanaSwap.update({where:{id:swap.id},data:{status:'EXECUTING',signature}});return {swap:updated,send:true};
  });
  if(!claimed.send){res.json(view(claimed.swap));return;}
  let status='UNKNOWN',error:string|null='Submission could not be confirmed. Check confirmation before placing another order.';
  try{
    const result=await jupiterExecute(signedTransaction,claimed.swap.providerRequestId,claimed.swap.quote.lastValidBlockHeight||undefined);
    if(result.status==='Success'&&result.code===0&&result.signature===claimed.swap.signature){status='CONFIRMED';error=null;}
    // A negative response may still be a landing timeout. Only explicit on-chain failure is final.
    else if(result.status==='Failed'&&result.signature===claimed.swap.signature){const chain=await signatureStatus(claimed.swap.signature!);if(chain?.err){status='FAILED';error='The transaction failed on-chain. Network fees may still apply.';}}
  }catch{/* Persist the uncertain state; never replay a signed transaction automatically. */}
  await db.solanaSwap.updateMany({where:{id:claimed.swap.id,status:'EXECUTING'},data:{status,error}});
  res.json(view(await db.solanaSwap.findUniqueOrThrow({where:{id:claimed.swap.id}})));
});
solanaSwapsRouter.post('/swaps/:id/reconcile',async(req,res)=>{
  const swap=await db.solanaSwap.findFirst({where:{id:String(req.params.id),userId:req.user!.id}});check(swap,404,'Swap not found.');
  if(unresolved.includes(swap.status)&&swap.signature){
    const chain=await signatureStatus(swap.signature);if(chain&&(chain.err||['confirmed','finalized'].includes(chain.confirmationStatus))){await db.solanaSwap.updateMany({where:{id:swap.id,status:{in:unresolved}},data:{status:chain.err?'FAILED':'CONFIRMED',error:chain.err?'The transaction failed on-chain. Network fees may still apply.':null}});}
    else if(!chain&&/^\d{1,16}$/.test(swap.quote.lastValidBlockHeight||'')&&Date.now()-swap.createdAt.getTime()>600000){
      // Wait for finalized expiry plus a grace period, then query history again. No rebroadcast.
      const finalized=await finalizedBlockHeight();
      if(BigInt(finalized)>BigInt(swap.quote.lastValidBlockHeight)+32n){
        const checked=await signatureStatus(swap.signature);
        if(!checked)await db.solanaSwap.updateMany({where:{id:swap.id,status:{in:unresolved}},data:{status:'FAILED',error:'Transaction expired without an observed on-chain confirmation. Check the explorer before preparing a new swap.'}});
      }
    }
  }res.json(view(await db.solanaSwap.findUniqueOrThrow({where:{id:swap.id}})));
});
