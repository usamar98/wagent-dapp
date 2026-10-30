import {db,type Tx} from './db.js';
import {env} from './env.js';
import {check} from './security.js';
import {reconcileChatTrade,tradeReply} from './solana-chat-trading.js';
import {unresolvedChatTrades} from './solana-permissions.js';
import type {ModelRows} from './database/schema.js';
type Command=ModelRows['AgentCommand'];
export function tradeCheckCommand(text:string){
  const match=/^check (?:my )?trade(?:\s+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?$/i.exec(text.trim());
  return match?{reference:match[1]?.toLowerCase()}:null;
}
export async function whatsappReviewReason(tx:Tx,userId:string){
  const permission=await tx.solanaTradePermission.findFirst({where:{userId},orderBy:{createdAt:'desc'}});
  if(!permission)return 'No WhatsApp trading permission has been signed. Review and sign trading limits to enable chat execution.';
  if(permission.revokedAt)return `WhatsApp trading permission was revoked at ${permission.revokedAt.toISOString()}: ${(permission.revokeReason||'Access revoked.').replace(/[\r\n]/g,' ').slice(0,180)} Review and sign a new permission to resume.`;
  if(permission.expiresAt<=new Date())return `WhatsApp trading permission expired at ${permission.expiresAt.toISOString()}. Review and sign a new permission to resume.`;
  return 'WhatsApp trading permission is inactive. Review your connected wallet, paired chat and signed limits.';
}
const isTradeRequest=(text:string)=>/^\s*(buy|sell)(\s|$)/i.test(text);
const requestLabel=(command:Command)=>`Original request: ${command.text}\nRequested at (UTC): ${command.createdAt.toISOString()}\nRequest reference: ${command.id}`;
async function submittedReply(request:Command,tradeId:string){
  const trade=await reconcileChatTrade(request.userId,tradeId);
  return `READ-ONLY TRADE STATUS · This check does not place or repeat an order.\n${requestLabel(request)}\n\n${tradeReply(trade)}`;
}
export async function tradeStatusReply(command:Command){
  const input=tradeCheckCommand(command.text);check(input&&command.source==='WHATSAPP'&&command.channelId&&command.recipientId,400,'Use Check trade or Check trade <reference> in your paired chat.');
  const scope={userId:command.userId,source:'WHATSAPP',channelId:command.channelId,recipientId:command.recipientId};let request:Command|null=null;
  if(input.reference){
    const trade=await db.solanaChatTrade.findFirst({where:{id:input.reference,userId:command.userId}});
    request=await db.agentCommand.findFirst({where:{...scope,id:trade?.commandId||input.reference}});
    check(request&&isTradeRequest(request.text),404,'That trade/request reference was not found in this paired chat. No order was submitted by this check.');
  }else{
    // Follow the latest attempted request, including review-only and rejected commands.
    // The cutoff binds delayed checks to the requests that existed when the check arrived.
    const ids=await db.sql<{id:string}>`SELECT id FROM "AgentCommand" WHERE "userId"=${command.userId} AND source='WHATSAPP' AND "channelId"=${command.channelId} AND "recipientId"=${command.recipientId} AND "createdAt"<=${command.createdAt} AND id<>${command.id} AND text ~* '^[[:space:]]*(buy|sell)([[:space:]]|$)' ORDER BY "createdAt" DESC,id DESC LIMIT 1`;
    request=ids.length?await db.agentCommand.findFirst({where:{...scope,id:ids[0].id}}):null;
  }
  if(!request)return 'NO TRADE REQUEST · No buy/sell request was found in this paired chat. Check trade only reads status and never places an order.';
  const trade=await db.solanaChatTrade.findFirst({where:{userId:command.userId,commandId:request.id}});
  if(trade)return submittedReply(request,trade.id);
  const review=request.reply.startsWith('SOLANA SWAP REVIEW'),reason=review?request.reply.match(/\nReason: ([^\n]+)/)?.[1]:request.reply.split('\n')[0];
  let reply=`NO WHATSAPP ORDER SUBMITTED\n${requestLabel(request)}\n${review?'This request produced a website review link. A review link alone does not execute a swap.':'This request was not accepted for execution.'}${reason?`\nReason: ${reason}`:''}\nCheck trade does not buy, sell, or retry a request.\n${review?`To trade directly in WhatsApp, review and sign active trading permission: ${new URL('/chat-trading',env.appUrl)}\nWallet-approved website swaps are listed in Portfolio.`:''}`;
  // A rejected retry can be blocked by an actually unresolved earlier order.
  // Reconcile that specific pending order, with a separate original-request label.
  // Never fall back to an unrelated terminal historical trade.
  if(!review&&request.reply.includes('needs confirmation')){
    const pending=await db.solanaChatTrade.findMany({where:{userId:command.userId,status:{in:unresolvedChatTrades}},orderBy:{createdAt:'desc'},take:10});
    for(const prior of pending){const original=await db.agentCommand.findFirst({where:{...scope,id:prior.commandId,createdAt:{lte:request.createdAt}}});if(original){reply+=`\n\nEARLIER PENDING ORDER · The following result belongs to this earlier request, not the request above.\n${await submittedReply(original,prior.id)}`;break;}}
  }
  return reply;
}
