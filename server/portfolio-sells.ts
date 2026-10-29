import {Router} from 'express';
import {createHash} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {db,transaction,type Tx} from './db.js';
import {auth,check,hash,AppError,token} from './security.js';
import {env} from './env.js';
import {rateLimitKey} from './rate-limit.js';
import {SOL_MINT,addressSchema,atomicAmount,humanAmount,tokenMetadata,jupiterOrder,jupiterExecute,providerStatus,orderSchema} from './solana-providers.js';
import {permissionSession} from './solana-permissions.js';
import {verifySolanaSignature} from './solana-swaps.js';
import {validateChatTransaction} from './chat-transaction-policy.js';
import {noPendingChatTrade} from './solana-chat-trading.js';
import {signTradingTransaction} from './trading-wallet-keys.js';
import type {ModelRows} from './database/schema.js';

const feeCap=5000000n;
async function ownerWallet(tx:Tx,userId:string){
  const [wallet,owner]=await Promise.all([tx.solanaTradingWallet.findUnique({where:{userId}}),tx.solanaWallet.findUnique({where:{userId}})]);
  check(wallet&&owner?.address===wallet.ownerAddress,409,'Verify the original Solana owner wallet before selling from the trading wallet.');return wallet;
}
function view(swap:ModelRows['SolanaSwap'],review=false){
  const {authorization,...quote}=swap.quote;
  return {id:swap.id,status:swap.status,walletAddress:swap.walletAddress,expiresAt:swap.expiresAt,signature:swap.signature,error:swap.error,quote,...(review&&swap.status==='QUOTED'?{message:authorization.message,ownerAddress:authorization.ownerAddress,maxFeeSol:humanAmount(String(feeCap),9)}:{})};
}
export const portfolioSellsRouter=Router();portfolioSellsRouter.use(auth);
portfolioSellsRouter.use(rateLimit({windowMs:60000,limit:20,keyGenerator:rateLimitKey,standardHeaders:'draft-8',legacyHeaders:false}));
portfolioSellsRouter.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
portfolioSellsRouter.post('/sell/quote',async(req,res)=>{
  check(providerStatus().swapsEnabled,503,'Selling needs Jupiter trading enabled on the server.');
  const input=z.object({mint:addressSchema,amount:z.string().max(32),slippageBps:z.number().int().min(1).max(200),requestId:z.uuid()}).strict().parse(req.body);
  check(input.mint!==SOL_MINT,400,'Choose a token to sell for SOL.');
  const wallet=await transaction(async tx=>{const userId=await permissionSession(tx,req);await noPendingChatTrade(tx,userId);return ownerWallet(tx,userId);});
  const info=await tokenMetadata(input.mint),from={...info,symbol:info.symbol.replace(/[\r\n]/g,' ').slice(0,80)},to=await tokenMetadata(SOL_MINT),amount=atomicAmount(input.amount,info.decimals);
  const order=await jupiterOrder(input.mint,SOL_MINT,amount,wallet.address,input.slippageBps,true);
  check(order.slippageBps!==undefined&&order.slippageBps<=input.slippageBps&&/^\d{1,16}$/.test(order.lastValidBlockHeight||''),502,'The route did not provide bounded slippage and expiry.');
  const expiry=Math.min(Date.now()+60000,order.expireAt?Date.parse(order.expireAt):Infinity);check(Number.isFinite(expiry)&&expiry>Date.now()+5000,409,'Quote expired. Review a fresh sale.');
  await validateChatTransaction(order,wallet.address,feeCap,input.slippageBps);
  const transactionHash=createHash('sha256').update(Buffer.from(order.transaction,'base64')).digest('hex');
  const message=`${new URL(env.appUrl).host} · Wagent Ai one-time token sale\nAccount: ${req.user!.id}\nNetwork: solana:mainnet\nOwner: ${wallet.ownerAddress}\nTrading wallet: ${wallet.address}\nSell: ${humanAmount(amount,info.decimals)} ${from.symbol}\nToken address: ${input.mint}\nReceive: SOL in this same trading wallet\nMinimum receive: ${humanAmount(order.otherAmountThreshold,9)} SOL\nSlippage limit: ${input.slippageBps/100}%\nMaximum network fee and account rent: ${humanAmount(String(feeCap),9)} SOL\nProvider fee limit: 1%\nTransaction SHA-256: ${transactionHash}\nExpires: ${new Date(expiry).toISOString()}\nNonce: ${token()}\n\nI authorize Wagent Ai to sign and submit only this reviewed sale from my dedicated trading wallet. This permission is one use and does not enable ongoing trading.`;
  const swap=await transaction(async tx=>{
    const userId=await permissionSession(tx,req);await noPendingChatTrade(tx,userId);const fresh=await ownerWallet(tx,userId);check(fresh.address===wallet.address&&fresh.ownerAddress===wallet.ownerAddress,409,'Wallet changed. Review again.');
    check(!await tx.solanaSwap.findFirst({where:{userId,clientRequestId:input.requestId}}),409,'This review request was already used.');
    await tx.solanaSwap.updateMany({where:{userId,status:'QUOTED'},data:{status:'CANCELLED'}});
    const {transaction:_wire,requestId:_request,...orderData}=order;
    return tx.solanaSwap.create({data:{userId,clientRequestId:input.requestId,providerRequestId:order.requestId,walletAddress:wallet.address,inputMint:input.mint,outputMint:SOL_MINT,inputAmount:amount,outputAmount:order.outAmount,unsignedTransaction:order.transaction,expiresAt:new Date(expiry),quote:{side:'SELL',spendSource:'TRADING',from,to,input:humanAmount(amount,info.decimals),output:humanAmount(order.outAmount,9),minimumOutput:humanAmount(order.otherAmountThreshold,9),router:order.router,slippageBps:input.slippageBps,feeBps:order.feeBps??0,networkFeeLamports:(order.signatureFeeLamports??0)+(order.prioritizationFeeLamports??0)+(order.rentFeeLamports??0),lastValidBlockHeight:order.lastValidBlockHeight,authorization:{purpose:'PORTFOLIO_SELL',ownerAddress:wallet.ownerAddress,sessionId:hash(req.cookies.ab_session),message,orderData}}}});
  });res.status(201).json(view(swap,true));
});
portfolioSellsRouter.post('/sell/:id/execute',async(req,res)=>{
  check(providerStatus().swapsEnabled,503,'Selling is disabled.');
  const input=z.object({signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/)}).strict().parse(req.body),userId=req.user!.id;
  const swap=await db.solanaSwap.findFirst({where:{id:String(req.params.id),userId}});check(swap?.quote.authorization?.purpose==='PORTFOLIO_SELL',404,'Sale not found.');
  if(swap.status!=='QUOTED'){res.json(view(swap));return;}
  const proof=swap.quote.authorization;
  check(proof.sessionId===hash(req.cookies.ab_session)&&swap.expiresAt>new Date(),409,'Sale review expired or belongs to another session. Review again.');
  check(verifySolanaSignature(proof.ownerAddress,Buffer.from(proof.message),Buffer.from(input.signature,'base64')),400,'A fresh signature from the original owner wallet is required.');
  const order=orderSchema.parse({...proof.orderData,transaction:swap.unsignedTransaction,requestId:swap.providerRequestId});
  check(order.inputMint===swap.inputMint&&order.outputMint===SOL_MINT&&order.inAmount===swap.inputAmount,400,'Sale details changed. Review again.');
  await validateChatTransaction(order,swap.walletAddress,feeCap,swap.quote.slippageBps);
  const prepared=await transaction(async tx=>{
    await permissionSession(tx,req);await noPendingChatTrade(tx,userId);const wallet=await ownerWallet(tx,userId);
    const fresh=await tx.solanaSwap.findFirst({where:{id:swap.id,userId}});check(fresh,404,'Sale not found.');
    if(fresh.status!=='QUOTED')return null;
    check(wallet.address===swap.walletAddress&&wallet.ownerAddress===proof.ownerAddress&&fresh.quote.authorization?.message===proof.message&&fresh.expiresAt.getTime()>Date.now()+2000,409,'Sale expired or wallet changed. Review again.');
    const signed=signTradingTransaction(wallet,swap.unsignedTransaction);
    await tx.solanaSwap.update({where:{id:swap.id},data:{status:'EXECUTING',signature:signed.signature}});return signed;
  });
  if(!prepared){res.json(view(await db.solanaSwap.findUniqueOrThrow({where:{id:swap.id}})));return;}
  let attempted=false;
  try{
    // No retries: hold the user lock through the final emergency-stop check and send.
    await db.transaction(async tx=>{
      await permissionSession(tx,req);const wallet=await ownerWallet(tx,userId),fresh=await tx.solanaSwap.findUniqueOrThrow({where:{id:swap.id}});
      check(providerStatus().swapsEnabled&&fresh.status==='EXECUTING'&&fresh.signature===prepared.signature&&fresh.expiresAt>new Date()&&wallet.address===swap.walletAddress&&wallet.ownerAddress===proof.ownerAddress,409,'Sale expired, stopped, or wallet changed before submission.');
      attempted=true;let confirmed=false;
      try{const result=await jupiterExecute(prepared.signedTransaction,swap.providerRequestId,order.lastValidBlockHeight,12000);confirmed=result.status==='Success'&&result.code===0&&result.signature===prepared.signature;}catch{/* An uncertain submission is never replayed. */}
      await tx.solanaSwap.update({where:{id:swap.id},data:{status:confirmed?'CONFIRMED':'UNKNOWN',error:confirmed?null:'Sale confirmation is pending. Check status before placing another order.'}});
    },{timeout:45000,maxWait:15000});
  }catch(error){await db.solanaSwap.updateMany({where:{id:swap.id,status:'EXECUTING'},data:{status:attempted?'UNKNOWN':'CANCELLED',error:error instanceof AppError?error.message:'Check the sale status before trying again.'}});}
  res.json(view(await db.solanaSwap.findUniqueOrThrow({where:{id:swap.id}})));
});
