import {db,transaction,lockUser} from './db.js';
import {AppError,check} from './security.js';
import {portfolioForUser} from './solana-portfolio.js';
import {walletBalances} from './solana-balances.js';
import {addressSchema,humanAmount} from './solana-providers.js';
import {discoverTokens} from './solana.js';
import {dailyTradingUsage,validateTradePermission} from './solana-permissions.js';
import {dailyWithdrawalUsage,validateWithdrawalPermission} from './withdrawal-access.js';
import {activeChannel,type ChannelContext} from './solana-chat-trading.js';
import type {ModelRows} from './database/schema.js';
type Info={kind:'BALANCE'|'PORTFOLIO'|'HISTORY'|'LIMITS'}|{kind:'TOKEN';mint:string};
export function informationCommand(text:string):Info|null{
  const value=text.trim().replace(/\s+/g,' ');
  if(/^(balance|wallet balance|show balance)$/i.test(value))return {kind:'BALANCE'};
  if(/^(portfolio|show (my )?portfolio|positions)$/i.test(value))return {kind:'PORTFOLIO'};
  if(/^(trade history|my trades|history)$/i.test(value))return {kind:'HISTORY'};
  if(/^(my limits|limits|spending limits)$/i.test(value))return {kind:'LIMITS'};
  const token=/^(?:token(?: details)?|details)\s+(.+)$/i.exec(value);return token?{kind:'TOKEN',mint:token[1]}:null;
}
const inline=(s:string)=>s.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,100);
const usd=(v:number|null)=>v===null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:v>0&&v<0.01?10:2}).format(v);
const sol=(n:bigint)=>humanAmount(String(n),9),remaining=(cap:string,used:bigint)=>sol(BigInt(cap)>used?BigInt(cap)-used:0n);
export async function informationReply(userId:string,info:Info):Promise<string>{
  if(info.kind==='TOKEN'){
    const mint=addressSchema.parse(info.mint),feed=await discoverTokens('',[mint]),t=feed.tokens.find(t=>t.mint===mint);
    if(!t)return `TOKEN DETAILS · Solana\nToken address: ${mint}\nDEX Screener has no indexed pool data for this address. No price or safety assessment is available.`;
    return `TOKEN DETAILS · ${inline(t.symbol)}\nName: ${inline(t.name)}\nToken address: ${mint}\nPrice: ${usd(t.priceUsd)}\n24h change: ${t.change24h===null?'Unavailable':t.change24h.toFixed(2)+'%'}\n24h volume: ${usd(t.volume24h)}\nPool liquidity: ${usd(t.liquidityUsd)}\nMarket cap: ${usd(t.marketCap)}\nPool created: ${t.pairCreatedAt?new Date(t.pairCreatedAt).toISOString():'Unavailable'}\nDEX: ${inline(t.dex)}\nSource: DEX Screener · ${feed.fetchedAt}${feed.stale?' · CACHED, refresh unavailable':''}\nPool age is not token age. Indexed data is not a safety endorsement.\n${t.screenerUrl}`;
  }
  if(info.kind==='LIMITS'){
    const [trade,withdraw,used,withdrawUsed]=await Promise.all([db.solanaTradePermission.findFirst({where:{userId},orderBy:{createdAt:'desc'}}),db.solanaWithdrawalPermission.findFirst({where:{userId},orderBy:{createdAt:'desc'}}),dailyTradingUsage(db,userId),dailyWithdrawalUsage(db,userId)]);
    let tradingActive=false,withdrawalActive=false;
    if(trade)try{await validateTradePermission(db,userId,trade.id);tradingActive=true;}catch{}
    if(withdraw)try{await validateWithdrawalPermission(db,userId,withdraw.id);withdrawalActive=true;}catch{}
    return `MY LIMITS · Daily reset 00:00 UTC\nTrading: ${tradingActive?'active':'inactive'}${trade?`\nPer-trade total budget: ${sol(BigInt(trade.perTradeLamports))} SOL\nDaily trading budget: ${sol(BigInt(trade.dailyLamports))} SOL\nReserved today: ${sol(used)} SOL\nRemaining today: ${remaining(trade.dailyLamports,used)} SOL\nFee/rent reserve per trade: ${sol(BigInt(trade.maxFeeLamports))} SOL\nSlippage cap: ${trade.slippageBps/100}%\nToken access: ${trade.tokenScope==='ANY_SOLANA'?'any supported Solana token':'selected agent tokens'}\nTrading expiry: ${trade.expiresAt.toISOString()}`:''}\n\nWithdrawals: ${withdrawalActive?'active':'inactive'}${withdraw?`\nFixed recipient: ${withdraw.ownerAddress}\nPer-withdrawal total budget: ${sol(BigInt(withdraw.perWithdrawalLamports))} SOL\nDaily withdrawal budget: ${sol(BigInt(withdraw.dailyLamports))} SOL\nReserved today: ${sol(withdrawUsed)} SOL\nRemaining today: ${remaining(withdraw.dailyLamports,withdrawUsed)} SOL\nFee reserve: ${sol(BigInt(withdraw.maxFeeLamports))} SOL\nWithdrawal expiry: ${withdraw.expiresAt.toISOString()}`:''}\nAmounts plus reserved fees count toward budgets. Failed/uncertain submissions keep reservations.\nRevoke trading · Revoke withdrawals · Revoke access · Stop all`;
  }
  const [trading,owner]=await Promise.all([db.solanaTradingWallet.findUnique({where:{userId},select:{address:true}}),db.solanaWallet.findUnique({where:{userId}})]);
  const wallet=trading?.address||owner?.address,source=trading?'WhatsApp trading wallet':'Connected Solana owner wallet';
  if(!wallet)return 'WALLET NOT SET UP · Connect your Solana owner wallet and create a dedicated trading wallet on the website first. No balance is available yet.';
  if(info.kind==='BALANCE'){
    const b=await walletBalances(wallet);let price:number|null=null,at:string|null=null,stale=false;
    try{const feed=await discoverTokens('', ['So11111111111111111111111111111111111111112']);price=feed.tokens[0]?.priceUsd??null;at=feed.fetchedAt;stale=feed.stale;}catch{}
    return `BALANCE · ${source}\nAddress: ${wallet}\nNative SOL: ${b.sol} SOL\nEstimated SOL value: ${usd(price===null?null:Number(b.sol)*price)}\nToken balances held: ${b.tokens.length}\nBalance checked: ${b.at}\n${at?`DEX Screener price: ${at}${stale?' · CACHED':''}`:'USD price unavailable; SOL balance is on-chain.'}\nSend Portfolio to see your tokens.`;
  }
  if(info.kind==='HISTORY'){
    const [chat,swaps]=await Promise.all([db.solanaChatTrade.findMany({where:{userId,walletAddress:wallet},orderBy:{createdAt:'desc'},take:5}),db.solanaSwap.findMany({where:{userId,walletAddress:wallet},orderBy:{createdAt:'desc'},take:5})]);
    const rows=[...chat.map(t=>({at:t.createdAt,side:t.side,symbol:t.quote.tokenSymbol,mint:t.mint,amount:t.amount,unit:t.side==='BUY'?'SOL':t.quote.tokenSymbol||'tokens',status:t.status,signature:t.signature})),...swaps.map(t=>({at:t.createdAt,side:t.quote.side||'SWAP',symbol:(t.quote.side==='BUY'?t.quote.to:t.quote.from)?.symbol,mint:t.quote.side==='BUY'?t.outputMint:t.inputMint,amount:t.quote.input||t.inputAmount,unit:t.quote.side==='BUY'?'SOL':t.quote.from?.symbol||'tokens',status:t.status,signature:t.signature}))].sort((a,b)=>b.at.getTime()-a.at.getTime()).slice(0,5);
    return `TRADE HISTORY · ${source}\nAddress: ${wallet}\n${rows.length?rows.map(t=>`\n${t.side} · ${inline(t.symbol||'Token')} · ${t.amount} ${inline(t.unit)}\nToken address: ${t.mint}\n${t.status} · ${t.at.toISOString()}${t.signature?`\nhttps://solscan.io/tx/${t.signature}`:''}`).join('\n'):'No Wagent purchases or sales recorded for this wallet.'}\nLatest Wagent records only. Send Check trade to refresh the latest WhatsApp trade result.`;
  }
  const p=await portfolioForUser(userId,trading?'TRADING':'OWNER');
  return `PORTFOLIO · ${source}\nAddress: ${wallet}\nNative SOL: ${p.sol.amount} SOL\n${p.unpricedCount?'Priced holdings value':'Estimated total value'}: ${usd(p.totalUsd)}${p.unpricedCount?`\n${p.unpricedCount} holding(s) have no available price.`:''}\n${p.tokens.length?p.tokens.slice(0,8).map(t=>`\n${inline(t.symbol||'Unknown token')}: ${t.amount}\nPrice: ${usd(t.priceUsd)} · Value: ${usd(t.valueUsd)}\nAddress: ${t.mint}`).join('\n'):'No token balances held.'}${p.tokens.length>8?`\nShowing 8 of ${p.tokens.length} tokens. Full list is available in website Portfolio.`:''}\nBalances: ${p.balancesAt}\nPrices: ${p.pricesAt||'Unavailable'}${p.pricesStale?' · CACHED':''}${p.pricingError?' · Some prices unavailable':''}\nUSD values are estimates from DEX Screener indexed pools.`;
}
export async function completeInformation(command:ModelRows['AgentCommand'],context:ChannelContext){
  const claimed=await transaction(async tx=>{await lockUser(tx,command.userId);await activeChannel(tx,command,context);return (await tx.agentCommand.updateMany({where:{id:command.id,status:'INFO_QUEUED'},data:{status:'INFO_PROCESSING'}})).count;});if(!claimed)return;
  let reply:string,status='COMPLETED';
  try{const user=await db.user.findUnique({where:{id:command.userId}});check(user&&!user.disabled,403,'Account unavailable.');const info=informationCommand(command.text);check(info,400,'Use Balance, Portfolio, Token <address>, Trade history, or My limits.');reply=await informationReply(command.userId,info);}
  catch(e){status='REJECTED';reply=`INFORMATION UNAVAILABLE · ${e instanceof AppError?e.message:'The requested information could not be refreshed. Try again shortly.'}`;}
  await transaction(async tx=>{await lockUser(tx,command.userId);await activeChannel(tx,command,context);const user=await tx.user.findUnique({where:{id:command.userId}});check(user&&!user.disabled,403,'Account unavailable.');await tx.agentCommand.update({where:{id:command.id},data:{status,reply:reply.slice(0,3800)}});});
}
