import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {transaction} from './db.js';
import {auth,check,hash,token} from './security.js';
import {env} from './env.js';
import {rateLimitKey} from './rate-limit.js';
import {atomicAmount,humanAmount} from './solana-providers.js';
import {permissionProofInput,permissionSession} from './solana-permissions.js';
import {verifySolanaSignature} from './solana-swaps.js';
import {chatWithdrawalsEnabled,revokeWithdrawals,withdrawalContext,withdrawalPermissionView} from './withdrawal-access.js';
import {reconcileChatWithdrawal} from './solana-chat-withdrawals.js';
export const withdrawalPermissionsRouter=Router();withdrawalPermissionsRouter.use(auth);
withdrawalPermissionsRouter.use(rateLimit({windowMs:60000,limit:30,keyGenerator:rateLimitKey,standardHeaders:'draft-8',legacyHeaders:false}));
withdrawalPermissionsRouter.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
withdrawalPermissionsRouter.get('/',async(req,res)=>res.json(await withdrawalPermissionView(req.user!.id)));
withdrawalPermissionsRouter.post('/:id/check',async(req,res)=>{const row=await reconcileChatWithdrawal(req.user!.id,String(req.params.id));res.json({id:row.id,status:row.status,error:row.error,signature:row.signature});});
withdrawalPermissionsRouter.post('/challenge',async(req,res)=>{
  check(chatWithdrawalsEnabled(),503,'WhatsApp withdrawals are disabled.');
  const input=z.object({perWithdrawalSol:z.string().max(20),dailySol:z.string().max(20),maxFeeSol:z.string().max(20),durationHours:z.number().int().min(1).max(168),consent:z.literal(true)}).strict().parse(req.body);
  const perWithdrawalLamports=atomicAmount(input.perWithdrawalSol,9),dailyLamports=atomicAmount(input.dailySol,9),maxFeeLamports=atomicAmount(input.maxFeeSol,9);
  check(BigInt(perWithdrawalLamports)<=10000000000n&&BigInt(dailyLamports)<=100000000000n&&BigInt(dailyLamports)>=BigInt(perWithdrawalLamports),400,'Withdrawal budget must be at most 10 SOL; daily budget must cover it and be at most 100 SOL.');
  check(BigInt(maxFeeLamports)>=5000n&&BigInt(maxFeeLamports)<=1000000n&&BigInt(maxFeeLamports)<BigInt(perWithdrawalLamports),400,'Network-fee cap must be between 0.000005 and 0.001 SOL and below the withdrawal budget.');
  const proof=await transaction(async tx=>{
    const userId=await permissionSession(tx,req),context=await withdrawalContext(tx,userId);
    const expiresAt=new Date(Date.now()+input.durationHours*3600000),payload={userId,channelId:context.channel.id,channelFingerprint:context.channel.tokenFingerprint,channelOwnerId:context.channel.ownerId,ownerAddress:context.wallet.ownerAddress,tradingAddress:context.wallet.address,perWithdrawalLamports,dailyLamports,maxFeeLamports,expiresAt:expiresAt.toISOString()};
    const message=`${new URL(env.appUrl).host} · Wagent Ai WhatsApp withdrawal permission\nWebsite: ${new URL(env.appUrl).origin}\nAccount: ${userId}\nNetwork: solana:mainnet\nFrom dedicated wallet: ${context.wallet.address}\nFixed original owner recipient: ${context.wallet.ownerAddress}\nWhatsApp connection: ${context.channel.id}\nPaired owner: ${context.channel.ownerId}\nAsset: Native SOL only\nPer-withdrawal total budget: ${humanAmount(perWithdrawalLamports,9)} SOL\nDaily total budget (UTC): ${humanAmount(dailyLamports,9)} SOL\nNetwork-fee cap per withdrawal: ${humanAmount(maxFeeLamports,9)} SOL\nPermission expires: ${expiresAt.toISOString()}\n\nI authorize Wagent Ai to sign native SOL withdrawals from my dedicated trading wallet only to this fixed original owner, after my paired WhatsApp chat requests an amount and confirms its unique code within two minutes. No other recipient or token is authorized. Transfer amount plus the full reserved fee cap counts toward these budgets. Failed and uncertain submissions keep their reservation. Replacing permission does not reset daily usage. Limits are enforced by Wagent Ai software, not an on-chain contract. Wagent Ai holds the encrypted trading-wallet signing key. Revoke withdrawals, Revoke access, or Stop all blocks new submissions; already-submitted transfers cannot be recalled. This approval does not transfer funds.\nNonce: ${token()}`;
    return tx.solanaPermissionChallenge.upsert({where:{userId_purpose:{userId,purpose:'WITHDRAWAL_GRANT'}},create:{userId,purpose:'WITHDRAWAL_GRANT',sessionId:hash(req.cookies.ab_session),address:context.wallet.ownerAddress,message,payload,expiresAt:new Date(Date.now()+300000)},update:{sessionId:hash(req.cookies.ab_session),address:context.wallet.ownerAddress,message,payload,expiresAt:new Date(Date.now()+300000)}});
  });res.json({id:proof.id,address:proof.address,message:proof.message});
});
withdrawalPermissionsRouter.post('/authorize',async(req,res)=>{
  check(chatWithdrawalsEnabled(),503,'WhatsApp withdrawals are disabled.');const input=permissionProofInput.parse(req.body);
  await transaction(async tx=>{
    const userId=await permissionSession(tx,req),proof=await tx.solanaPermissionChallenge.findFirst({where:{id:input.id,userId,purpose:'WITHDRAWAL_GRANT',sessionId:hash(req.cookies.ab_session)}});
    check(proof&&proof.expiresAt>new Date()&&verifySolanaSignature(proof.address,Buffer.from(proof.message),Buffer.from(input.signature,'base64')),400,'A fresh signature from the original owner wallet is required.');
    const c=await withdrawalContext(tx,userId),p=proof.payload;
    check(p.userId===userId&&p.ownerAddress===c.wallet.ownerAddress&&proof.address===c.wallet.ownerAddress&&p.tradingAddress===c.wallet.address&&p.channelId===c.channel.id&&p.channelFingerprint===c.channel.tokenFingerprint&&p.channelOwnerId===c.channel.ownerId&&new Date(p.expiresAt)>new Date()&&proof.message.includes(`\nWebsite: ${new URL(env.appUrl).origin}\n`),409,'Your setup changed. Review withdrawal permission again.');
    await revokeWithdrawals(tx,userId,'Replaced by a newly signed withdrawal permission.');
    await tx.solanaWithdrawalPermission.create({data:{...p,expiresAt:new Date(p.expiresAt),consentMessage:proof.message,signature:input.signature}});
  });res.json({ok:true});
});
withdrawalPermissionsRouter.post('/revoke',async(req,res)=>{await transaction(async tx=>{const userId=await permissionSession(tx,req,true);await revokeWithdrawals(tx,userId,'Withdrawal access revoked by the account owner.');});res.json({ok:true});});
