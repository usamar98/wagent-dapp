import {env} from './env.js';
import {db,type Tx} from './db.js';
import {check} from './security.js';
import {websiteOrigin} from './website-runtime.js';
import {humanAmount} from './solana-providers.js';
export const chatWithdrawalsEnabled=()=>!env.demo&&process.env.SOLANA_CHAT_WITHDRAWALS_ENABLED!=='false';
export async function revokeWithdrawals(tx:Tx,userId:string,reason:string){
  await tx.solanaWithdrawalPermission.updateMany({where:{userId,revokedAt:null},data:{revokedAt:new Date(),revokeReason:reason}});
  await tx.solanaPermissionChallenge.deleteMany({where:{userId,purpose:'WITHDRAWAL_GRANT'}});
  await tx.solanaChatWithdrawal.updateMany({where:{userId,status:{in:['AWAITING_CONFIRMATION','PREPARING','PREPARED']}},data:{status:'CANCELLED',error:reason}});
  await tx.agentCommand.updateMany({where:{userId,status:'WITHDRAWAL_QUEUED'},data:{status:'REJECTED',reply:`NOT EXECUTED · ${reason}`}});
}
export async function withdrawalContext(tx:Tx,userId:string,origin=env.appUrl){
  const [user,owner,wallet,channel]=await Promise.all([tx.user.findUnique({where:{id:userId}}),tx.solanaWallet.findUnique({where:{userId}}),tx.solanaTradingWallet.findUnique({where:{userId}}),tx.personalAgentChannel.findUnique({where:{userId}})]);
  check(user&&!user.disabled&&!user.emergencyStop,409,'Withdrawals are stopped or this account is unavailable.');
  check(wallet&&owner?.address===wallet.ownerAddress,409,'Verify the original Solana owner wallet before enabling WhatsApp withdrawals.');
  check(channel?.enabled&&channel.ownerId,409,'Pair your own WhatsApp agent before enabling withdrawals.');
  const linkedOrigin=websiteOrigin(channel.appUrl||(await tx.setting.findUnique({where:{key:'wagent:production-origin'}}))?.value||env.appUrl);
  check(linkedOrigin===websiteOrigin(origin),409,'Manage withdrawal permission on the website connected to this WhatsApp agent.');
  return {user,owner,wallet,channel};
}
export async function validateWithdrawalPermission(tx:Tx,userId:string,id:string,origin=env.appUrl){
  check(chatWithdrawalsEnabled(),503,'WhatsApp withdrawals are disabled.');
  const context=await withdrawalContext(tx,userId,origin),permission=await tx.solanaWithdrawalPermission.findFirst({where:{id,userId,revokedAt:null}});
  check(permission&&permission.expiresAt>new Date(),409,'Withdrawal permission expired or was revoked. Approve it on the website.');
  check(permission.consentMessage.includes(`\nWebsite: ${websiteOrigin(origin)}\n`)&&permission.consentMessage.includes('\nAsset: Native SOL only\n'),409,'Withdrawal permission belongs to another website or asset.');
  check(permission.ownerAddress===context.wallet.ownerAddress&&permission.tradingAddress===context.wallet.address&&permission.channelId===context.channel.id&&permission.channelFingerprint===context.channel.tokenFingerprint&&permission.channelOwnerId===context.channel.ownerId&&context.channel.createdAt<=permission.createdAt,409,'The approved wallet or WhatsApp connection changed. Review withdrawal permission again.');
  return {...context,permission};
}
export async function dailyWithdrawalUsage(tx:Tx,userId:string,excludeId=''){
  const day=new Date();day.setUTCHours(0,0,0,0);
  const rows=await tx.sql<{amount:string}>`SELECT COALESCE(SUM("budgetLamports"::numeric),0)::text AS amount FROM "SolanaChatWithdrawal" WHERE "userId"=${userId} AND id<>${excludeId} AND "createdAt">=${day} AND (status IN ('PREPARING','PREPARED','EXECUTING','UNKNOWN','CONFIRMED','FAILED') OR (status='AWAITING_CONFIRMATION' AND "confirmationExpiresAt">${new Date()}))`;
  return BigInt(rows[0].amount);
}
export async function withdrawalPermissionView(userId:string){
  const permission=await db.solanaWithdrawalPermission.findFirst({where:{userId},orderBy:{createdAt:'desc'}});let active=false;
  if(permission)try{await validateWithdrawalPermission(db,userId,permission.id);active=true;}catch{/* Invalid grants are displayed inactive. */}
  const history=await db.solanaChatWithdrawal.findMany({where:{userId},select:{id:true,amount:true,ownerAddress:true,status:true,signature:true,error:true,createdAt:true},orderBy:{createdAt:'desc'},take:10});
  return {enabled:chatWithdrawalsEnabled(),permission:permission?{id:permission.id,active,ownerAddress:permission.ownerAddress,perWithdrawalSol:humanAmount(permission.perWithdrawalLamports,9),dailySol:humanAmount(permission.dailyLamports,9),maxFeeSol:humanAmount(permission.maxFeeLamports,9),expiresAt:permission.expiresAt,revokedAt:permission.revokedAt,revokeReason:permission.revokeReason}:null,usedTodaySol:humanAmount(String(await dailyWithdrawalUsage(db,userId)),9),history};
}
