import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { Wallet, verifyMessage } from 'ethers';
import type { Request } from 'express';
import { db, lockUser, type Tx } from '../db.js';
import { check, hash } from '../security.js';
import { env } from '../env.js';
import { ROBINHOOD_CHAIN_ID, evmAddress, fromWei } from './providers.js';
import {weiAmount} from '../../shared/robinhood.js';
export type RhWallet = { userId: string; address: string; ownerAddress: string; encryptedSecret: string; chainId: number };
export type RhPermission = { id: string; userId: string; kind: 'TRADE' | 'WITHDRAW'; channelId: string; fingerprint: string; recipient: string; instanceId: string | null; ownerAddress: string; walletAddress: string; tokenScope: 'ANY_ROBINHOOD' | 'SELECTED_TOKENS'; tokens: string[]; perLimitWei: string; dailyLimitWei: string; maxFeeWei: string; slippageBps: number; expiresAt: Date; revokedAt: Date | null; revokeReason: string | null; message: string; signature: string; createdAt: Date };
export type RhOperation = { id: string; userId: string; commandId: string | null; permissionId: string | null; kind: 'BUY' | 'SELL' | 'WITHDRAW'; tokenAddress: string; amount: string; walletAddress: string; status: string; budgetWei: string; txHash: string | null; approvalHash: string | null; nonce: number | null; data: any; error: string | null; confirmationHash: string | null; confirmationExpiresAt: Date | null; createdAt: Date; updatedAt: Date };
export type ChatContext = { id: string; ownerId: string; leaseToken: string };
export const pendingStates = ['QUEUED','PREPARING','SIGNED','EXECUTING','APPROVAL_SUBMITTED','UNKNOWN'];
export async function walletFor(userId: string, tx: Tx = db) { return (await tx.sql<RhWallet>`SELECT * FROM "RHWallet" WHERE "userId"=${userId}`)[0] || null; }
function encryptionKey(userId: string) { return Buffer.from(hkdfSync('sha256', Buffer.from(env.encryptionKey, 'hex'), Buffer.from(userId), Buffer.from('wagent-robinhood-wallet-v1:4663'), 32)); }
export function createKey(userId: string) {
  const wallet = Wallet.createRandom(), secret = Buffer.from(wallet.privateKey.slice(2), 'hex'), address = evmAddress(wallet.address), iv = randomBytes(12);
  try { const cipher = createCipheriv('aes-256-gcm', encryptionKey(userId), iv); cipher.setAAD(Buffer.from(`${userId}:4663:${address}`)); const encrypted = Buffer.concat([cipher.update(secret), cipher.final()]); return { address, encryptedSecret: ['rh1',iv.toString('hex'),cipher.getAuthTag().toString('hex'),encrypted.toString('hex')].join('.') }; } finally { secret.fill(0); }
}
export function openKey(wallet: RhWallet) {
  const [v,iv,tag,data] = wallet.encryptedSecret.split('.'); check(v==='rh1' && wallet.chainId===4663,503,'Robinhood trading key is unavailable.');
  const cipher=createDecipheriv('aes-256-gcm',encryptionKey(wallet.userId),Buffer.from(iv,'hex'));cipher.setAAD(Buffer.from(`${wallet.userId}:4663:${wallet.address}`));cipher.setAuthTag(Buffer.from(tag,'hex'));
  const secret=Buffer.concat([cipher.update(Buffer.from(data,'hex')),cipher.final()]);
  try {const key='0x'+secret.toString('hex');check(evmAddress(new Wallet(key).address)===wallet.address,503,'Trading key does not match its wallet.');return key;} finally {secret.fill(0);}
}
export async function freshSession(tx: Tx, req: Request, allowStopped=false) {
  const userId=req.user!.id;await lockUser(tx,userId);const session=await tx.session.findUnique({where:{id:hash(req.cookies?.ab_session||'')}}),user=await tx.user.findUnique({where:{id:userId}});
  check(session?.userId===userId&&session.expiresAt>new Date()&&user&&!user.disabled,401,'Sign in again before changing wallet access.');check(allowStopped||!user.emergencyStop,409,'Clear emergency stop before enabling access.');return userId;
}
export async function paired(tx:Tx,userId:string, context?:ChatContext) {
  const channel=await tx.personalAgentChannel.findUnique({where:{userId}});
  check(channel?.enabled&&channel.ownerId,409,'Pair your personal WhatsApp agent first.');
  check(!channel.appUrl||new URL(channel.appUrl).origin===new URL(env.appUrl).origin,409,'Manage this paired chat on its original production website.');
  if(context)check(channel.id===context.id&&channel.ownerId===context.ownerId&&channel.leaseToken===context.leaseToken&&channel.leaseUntil&&channel.leaseUntil>new Date(),403,'WhatsApp connection changed or its worker lease expired.');
  return channel;
}
export async function selectedAgent(tx:Tx,userId:string) { const workspace=await tx.tradingWorkspace.findUnique({where:{userId}});const instance=workspace?.activeInstanceId?await tx.instance.findFirst({where:{id:workspace.activeInstanceId,userId},include:{version:{include:{agent:true}}}}):null;check(instance?.version.agent.creatorId===userId,409,'Select a private agent you created in Connections.');return instance; }
export async function revokeRh(tx:Tx,userId:string,kind:'TRADE'|'WITHDRAW'|'ALL',reason:string) {
  await tx.sql`UPDATE "RHPermission" SET "revokedAt"=timezone('UTC',CURRENT_TIMESTAMP),"revokeReason"=${reason} WHERE "userId"=${userId} AND "revokedAt" IS NULL AND (${kind}='ALL' OR kind=${kind})`;
  await tx.sql`DELETE FROM "RHChallenge" WHERE "userId"=${userId} AND (purpose=${kind} OR ${kind}='ALL')`;
  await tx.sql`UPDATE "RHOperation" SET status='CANCELLED',error=${reason},"updatedAt"=timezone('UTC',CURRENT_TIMESTAMP) WHERE "userId"=${userId} AND status IN ('QUEUED','PREPARING','PREVIEW') AND ((${kind}='TRADE' AND kind IN ('BUY','SELL')) OR (${kind}='WITHDRAW' AND kind='WITHDRAW') OR ${kind}='ALL')`;
}
export async function latestPermission(userId:string,kind:'TRADE'|'WITHDRAW',tx:Tx=db) { return (await tx.sql<RhPermission>`SELECT * FROM "RHPermission" WHERE "userId"=${userId} AND kind=${kind} ORDER BY "createdAt" DESC,id DESC LIMIT 1`)[0]||null; }
export async function validatePermission(tx:Tx,userId:string,id:string,kind:'TRADE'|'WITHDRAW',context?:ChatContext) {
  const user=await tx.user.findUnique({where:{id:userId}});check(user&&!user.disabled&&!user.emergencyStop,409,'Trading is stopped.');
  const wallet=await walletFor(userId,tx),permission=(await tx.sql<RhPermission>`SELECT * FROM "RHPermission" WHERE id=${id} AND "userId"=${userId} AND kind=${kind}`)[0];
  check(wallet&&permission&&!permission.revokedAt&&permission.expiresAt>new Date(),409,'Permission expired or was revoked. Review and sign a new permission on the website.');
  let consentValid=false;
  try{
    const line=(label:string)=>permission.message.split('\n').find(value=>value.startsWith(label+': '))?.slice(label.length+2)||'';
    const scope=kind==='WITHDRAW'?'Native ETH withdrawals only to '+wallet.ownerAddress:permission.tokenScope==='ANY_ROBINHOOD'?'Any supported Robinhood Chain token, including tokens outside the saved agent list':permission.tokens.join(', ');
    consentValid=evmAddress(verifyMessage(permission.message,permission.signature))===wallet.ownerAddress&&line('Website')===new URL(env.appUrl).origin&&line('Chain ID')==='4663'&&line('Owner')===wallet.ownerAddress&&line('Trading wallet')===wallet.address&&line('Connection')===permission.channelId&&line('Paired chat')===permission.recipient&&line('Agent')===(permission.instanceId||'Not applicable')&&line('Nonce')===permission.id&&line('Scope')===scope&&line('Permission expires')===permission.expiresAt.toISOString()&&weiAmount(line('Per-operation total budget').replace(/ ETH$/,''))===BigInt(permission.perLimitWei)&&weiAmount(line('UTC daily total budget').replace(/ ETH$/,''))===BigInt(permission.dailyLimitWei)&&weiAmount(line('Maximum gas per operation').replace(/ ETH$/,''))===BigInt(permission.maxFeeWei)&&line('Slippage limit')===`${permission.slippageBps/100}%`&&(permission.tokenScope==='ANY_ROBINHOOD'?permission.tokens.length===0:permission.tokens.length>0&&permission.tokens.length<=10);
  }catch{/* A modified persisted grant must never expand signed authority. */}
  check(consentValid,403,'Stored permission fields do not match the original signed consent. Review and sign a new permission.');
  const channel=await paired(tx,userId,context);
  check(permission.channelId===channel.id&&permission.fingerprint===channel.tokenFingerprint&&permission.recipient===channel.ownerId&&channel.createdAt<=permission.createdAt,409,'The approved WhatsApp connection changed. Sign a new permission.');
  check(permission.ownerAddress===wallet.ownerAddress&&permission.walletAddress===wallet.address&&permission.message.includes(`\nChain ID: ${ROBINHOOD_CHAIN_ID}\n`),409,'Wallet or network authorization mismatch.');
  if(kind==='TRADE')check(permission.instanceId===(await selectedAgent(tx,userId)).id,409,'The selected agent changed. Sign a new permission.');
  return {wallet,permission};
}
export async function assertIdle(tx:Tx,userId:string,exclude='') {const row=await tx.sql`SELECT id FROM "RHOperation" WHERE "userId"=${userId} AND id<>${exclude} AND status=ANY(${pendingStates}::text[]) LIMIT 1`;check(!row.length,409,'An earlier operation needs confirmation. Use Check trade or Check withdrawal before another financial command.');}
export async function dailyUsage(tx:Tx,userId:string,kind:'TRADE'|'WITHDRAW',exclude='') {
  const day=new Date();day.setUTCHours(0,0,0,0);
  const rows=await tx.sql<{amount:string}>`SELECT COALESCE(SUM("budgetWei"),0)::text AS amount FROM "RHOperation" WHERE "userId"=${userId} AND "walletAddress"=(SELECT address FROM "RHWallet" WHERE "userId"=${userId}) AND id<>${exclude} AND "createdAt">=${day} AND (${kind}='WITHDRAW' AND kind='WITHDRAW' OR ${kind}='TRADE' AND kind IN ('BUY','SELL')) AND (status NOT IN ('PREVIEW','QUEUED','PREPARING','CANCELLED','REJECTED') OR "txHash" IS NOT NULL OR "approvalHash" IS NOT NULL)`;return BigInt(rows[0].amount);
}
export async function createChallenge(tx:Tx,req:Request,purpose:string,address:string,payload:any,detail:string,ttl=180000) {
  const userId=await freshSession(tx,req,purpose==='RECOVER'),id=randomUUID(),expiresAt=new Date(Date.now()+ttl);
  const message=`${new URL(env.appUrl).host} · Wagent Ai ${purpose}\nWebsite: ${new URL(env.appUrl).origin}\nChain ID: ${ROBINHOOD_CHAIN_ID}\nNetwork: Robinhood Chain\nOwner: ${address}\n${detail}\nExpires: ${expiresAt.toISOString()}\nNonce: ${id}`;
  await tx.sql`INSERT INTO "RHChallenge" (id,"userId","sessionId",purpose,address,message,payload,"expiresAt") VALUES (${id},${userId},${hash(req.cookies.ab_session)},${purpose},${address},${message},${JSON.stringify(payload)}::jsonb,${expiresAt})`;
  return {id,message,address,expiresAt:expiresAt.toISOString()};
}
export async function consumeChallenge(tx:Tx,req:Request,id:string,signature:string,purpose:string) {
  const userId=await freshSession(tx,req,purpose==='RECOVER');const row=(await tx.sql<{id:string;address:string;message:string;payload:any;expiresAt:Date}>`DELETE FROM "RHChallenge" WHERE id=${id} AND "userId"=${userId} AND "sessionId"=${hash(req.cookies.ab_session)} AND purpose=${purpose} AND "expiresAt">timezone('UTC',CURRENT_TIMESTAMP) RETURNING *`)[0];
  check(row,409,'This review expired or was already used. Review it again.');let signer='';try{signer=evmAddress(verifyMessage(row.message,signature));}catch{/* A malformed signature grants no authority. */}check(signer===row.address,403,'The original owner must sign this exact review.');return row;
}
export function permissionView(p:RhPermission|null) {return p?{id:p.id,kind:p.kind,active:!p.revokedAt&&p.expiresAt>new Date(),tokenScope:p.tokenScope,tokens:p.tokens,perLimitEth:fromWei(p.perLimitWei),dailyEth:fromWei(p.dailyLimitWei),maxFeeEth:fromWei(p.maxFeeWei),slippageBps:p.slippageBps,expiresAt:p.expiresAt,revokedAt:p.revokedAt,revokeReason:p.revokeReason}:null;}
