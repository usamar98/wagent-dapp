import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {db} from './db.js';
import {auth} from './security.js';
import {rateLimitKey} from './rate-limit.js';
import {SOL_MINT,providerStatus} from './solana-providers.js';
import {walletBalances} from './solana-balances.js';
import {discoverTokens} from './solana.js';
import type {Portfolio,PortfolioHolding,PortfolioSource} from '../shared/portfolio.js';
import type {SolanaToken,TokenFeed} from '../shared/solana.js';

export async function portfolioForUser(userId:string,source:PortfolioSource):Promise<Portfolio>{
  const [trading,owner,user]=await Promise.all([db.solanaTradingWallet.findUnique({where:{userId},select:{address:true,ownerAddress:true}}),db.solanaWallet.findUnique({where:{userId}}),db.user.findUnique({where:{id:userId}})]);
  const wallet=source==='TRADING'?trading:owner?{address:owner.address,ownerAddress:owner.address}:null;
  const empty:PortfolioHolding={mint:SOL_MINT,name:'Solana',symbol:'SOL',amount:'0',rawAmount:'0',decimals:9,priceUsd:null,valueUsd:null,change24h:null,liquidityUsd:null,screenerUrl:null};
  const base={source,wallet,balancesAt:new Date().toISOString(),pricesAt:null,pricesStale:false,pricingError:null,sol:empty,tokens:[],totalUsd:null,unpricedCount:0,tradingEnabled:providerStatus().swapsEnabled,stopped:!!user?.emergencyStop,history:[]} satisfies Portfolio;
  if(!wallet)return base;
  const balances=await walletBalances(wallet.address),identities=new Map<string,SolanaToken>();
  const mints=[...new Set([SOL_MINT,...balances.tokens.map(t=>t.mint)])];let pricingError:string|null=null;const feeds:TokenFeed[]=[];
  for(let i=0;i<mints.length;i+=30){
    try{const feed=await discoverTokens('',mints.slice(i,i+30));feeds.push(feed);feed.tokens.forEach(t=>identities.set(t.mint,t));}
    catch{pricingError='Some prices could not be refreshed. Balances still come from Solana.';}
  }
  const [chat,swaps]=await Promise.all([
    source==='TRADING'?db.solanaChatTrade.findMany({where:{userId,walletAddress:wallet.address},orderBy:{createdAt:'desc'},take:30}):Promise.resolve([]),
    db.solanaSwap.findMany({where:{userId,walletAddress:wallet.address},orderBy:{createdAt:'desc'},take:30}),
  ]);
  const fallback=new Map<string,{symbol:string;name:string}>();
  for(const swap of swaps)for(const t of [swap.quote.from,swap.quote.to])if(t?.id&&typeof t.symbol==='string'&&typeof t.name==='string')fallback.set(t.id,t);
  const holding=(t:{mint:string;amount:string;rawAmount:string;decimals:number}):PortfolioHolding=>{
    const p=identities.get(t.mint),known=fallback.get(t.mint),value=p?.priceUsd===null||p?.priceUsd===undefined?null:Number(t.amount)*p.priceUsd;
    return {...t,name:t.mint===SOL_MINT?'Solana':p?.name||known?.name||null,symbol:t.mint===SOL_MINT?'SOL':p?.symbol||known?.symbol||null,priceUsd:p?.priceUsd??null,valueUsd:value!==null&&Number.isFinite(value)?value:null,change24h:p?.change24h??null,liquidityUsd:p?.liquidityUsd??null,screenerUrl:p?.screenerUrl??null};
  };
  const sol=holding({mint:SOL_MINT,amount:balances.sol,rawAmount:balances.solRaw,decimals:9}),tokens=balances.tokens.map(holding);
  const rows=[sol,...tokens].filter(t=>BigInt(t.rawAmount)>0n),priced=rows.filter(t=>t.valueUsd!==null),total=priced.reduce((sum,t)=>sum+t.valueUsd!,0);
  const history=[...chat.map(t=>({id:t.id,side:t.side,mint:t.mint,symbol:identities.get(t.mint)?.symbol||t.quote.tokenSymbol||null,amount:t.amount,status:t.status,signature:t.signature,createdAt:t.createdAt.toISOString(),kind:'CHAT' as const})),...swaps.map(t=>({id:t.id,side:t.quote.side||'SWAP',mint:t.inputMint===SOL_MINT?t.outputMint:t.inputMint,symbol:(t.inputMint===SOL_MINT?t.quote.to:t.quote.from)?.symbol||null,amount:t.quote.input||t.inputAmount,status:t.status,signature:t.signature,createdAt:t.createdAt.toISOString(),kind:'SWAP' as const}))].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30);
  return {...base,balancesAt:balances.at,pricesAt:feeds.length?feeds.map(f=>f.fetchedAt).sort()[0]:null,pricesStale:feeds.some(f=>f.stale),pricingError,sol,tokens,totalUsd:!rows.length?0:priced.length&&Number.isFinite(total)?total:null,unpricedCount:rows.length-priced.length,history};
}
export const solanaPortfolioRouter=Router();
solanaPortfolioRouter.use(auth);
solanaPortfolioRouter.use(rateLimit({windowMs:60000,limit:20,keyGenerator:rateLimitKey,standardHeaders:'draft-8',legacyHeaders:false}));
solanaPortfolioRouter.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
solanaPortfolioRouter.get('/',async(req,res)=>{const source=z.enum(['TRADING','OWNER']).parse(req.query.source||'TRADING');res.json(await portfolioForUser(req.user!.id,source));});
