import {Router,type Response} from 'express';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {getAddress,verifyMessage} from 'ethers';
import {db,transaction} from './db.js';
import {env} from './env.js';
import {check,createSession,hash,token} from './security.js';

export const walletAuth=Router();
const limit=rateLimit({windowMs:15*60000,limit:env.demo?100:30,message:{error:'Too many wallet sign-in attempts. Try again later.'}});
const addressSchema=z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(v=>v.toLowerCase());
const cookieOptions={httpOnly:true,sameSite:'strict' as const,secure:env.production,path:'/api/auth/wallet'};
function clearChallenge(res:Response){res.clearCookie('ab_wallet_challenge',cookieOptions);}

walletAuth.post('/challenge',limit,async(req,res)=>{
  const {address,chainId}=z.object({address:addressSchema,chainId:z.number().int().positive().max(2147483647)}).strict().parse(req.body);
  const raw=token(),nonce=token(),now=new Date(),expiresAt=new Date(+now+5*60000),url=new URL(env.appUrl);
  const message=`${url.host} wants you to sign in with your Ethereum account:\n${getAddress(address)}\n\nSign in to Wagent Ai. This message does not authorize transactions or token transfers.\n\nURI: ${url.origin}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${now.toISOString()}\nExpiration Time: ${expiresAt.toISOString()}`;
  await db.walletChallenge.deleteMany({where:{expiresAt:{lt:now}}});
  await db.walletChallenge.create({data:{id:hash(raw),walletAddress:address,chainId,domain:url.host,message,expiresAt}});
  res.cookie('ab_wallet_challenge',raw,{...cookieOptions,maxAge:5*60000});
  res.json({message,address:getAddress(address),expiresAt:expiresAt.toISOString()});
});

walletAuth.post('/verify',limit,async(req,res)=>{
  const {signature}=z.object({signature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}).strict().parse(req.body);
  const raw=req.cookies?.ab_wallet_challenge;check(typeof raw==='string',401,'Request a wallet sign-in message first');
  const challenge=await db.walletChallenge.findUnique({where:{id:hash(raw)}});
  check(challenge&&!challenge.usedAt&&challenge.expiresAt>new Date()&&challenge.domain===new URL(env.appUrl).host,401,'Wallet sign-in message is expired or has already been used');
  let recovered:string;try{recovered=verifyMessage(challenge.message,signature).toLowerCase();}catch{check(false,401,'Wallet signature could not be verified');}
  check(recovered===challenge.walletAddress,401,'The signature does not match the requested wallet');
  const user=await transaction(async tx=>{
    const claimed=await tx.walletChallenge.updateMany({where:{id:challenge.id,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
    check(claimed.count===1,401,'Wallet sign-in message is expired or has already been used');
    const role=env.adminWalletAddresses.includes(recovered)?'ADMIN':'USER';
    const existing=await tx.user.findUnique({where:{walletAddress:recovered}});
    check(!existing?.disabled,403,'This account has been disabled');
    return tx.user.upsert({where:{walletAddress:recovered},create:{walletAddress:recovered,name:`Wallet ${recovered.slice(0,6)}…${recovered.slice(-4)}`,role,profile:{create:{}}},update:{role}});
  });
  // Rotate the current browser session on every successful sign-in.
  if(req.cookies?.ab_session)await db.session.deleteMany({where:{id:hash(req.cookies.ab_session)}});
  await createSession(res,user.id);clearChallenge(res);res.json({ok:true});
});
