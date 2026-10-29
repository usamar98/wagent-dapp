import { z } from 'zod';
import { AppError, check } from './security.js';
import { isSolanaAddress } from '../shared/solana.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const addressSchema = z.string().refine(isSolanaAddress, 'Enter a valid Solana WGT or wallet address.');
export function providerStatus() {
  return { jupiter:!!process.env.JUPITER_API_KEY, discovery:'DEX Screener', swapsEnabled:process.env.SOLANA_SWAPS_ENABLED==='true' && !!process.env.JUPITER_API_KEY, alertsEnabled:process.env.SOLANA_ALERTS_ENABLED!=='false' };
}
export async function fetchJson(url: string, options: RequestInit = {}, service = 'Provider', timeout = 12000): Promise<any> {
  try {
    const response = await fetch(url, { ...options, redirect:'error', signal:AbortSignal.timeout(timeout) });
    if (!response.ok) throw new AppError(response.status===429?503:502, `${service} is temporarily unavailable or its API key/plan needs attention.`);
    const reader=response.body?.getReader(); if(!reader)throw new Error('Empty response');
    const parts:Uint8Array[]=[];let size=0;
    try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>3000000)throw new Error('Response too large');parts.push(value);} } finally {await reader.cancel().catch(()=>{});}
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch(error) { if(error instanceof AppError)throw error;throw new AppError(502,`${service} could not be reached. No completed operation can be assumed.`); }
}
const jupiterHeaders=()=>({'x-api-key':process.env.JUPITER_API_KEY || '',Accept:'application/json'});
const tokenSchema=z.object({id:addressSchema,symbol:z.string().max(80),name:z.string().max(200),decimals:z.number().int().min(0).max(18)});
const metadataCache=new Map<string,{saved:number;token:z.infer<typeof tokenSchema>}>();
export async function tokenMetadata(mint:string) {
  if(mint===SOL_MINT)return {id:mint,symbol:'SOL',name:'Solana',decimals:9};
  const cached=metadataCache.get(mint);if(cached&&Date.now()-cached.saved<300000)return cached.token;
  const raw=await fetchJson(`https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`,{headers:jupiterHeaders()},'Jupiter token data');
  check(Array.isArray(raw)&&raw.length<=100,502,'Jupiter token metadata is unavailable.');
  const result=raw.map(item=>tokenSchema.safeParse(item)).find(item=>item.success&&item.data.id===mint);
  check(result?.success,400,'Jupiter has not indexed this WGT. A swap cannot be prepared yet.');
  if(metadataCache.size>=200)metadataCache.delete(metadataCache.keys().next().value!);
  metadataCache.set(mint,{saved:Date.now(),token:result.data});return result.data;
}
export function atomicAmount(value:string,decimals:number):string {
  check(/^\d{1,12}(?:\.\d{1,18})?$/.test(value),400,'Enter a positive decimal token amount.');
  const [whole,fraction='']=value.split('.');check(fraction.length<=decimals,400,`This token supports at most ${decimals} decimal places.`);
  const amount=BigInt(whole)*10n**BigInt(decimals)+BigInt((fraction+'0'.repeat(decimals)).slice(0,decimals)||'0');
  check(amount>0n&&amount<=18446744073709551615n,400,'The token amount is outside the supported range.');return amount.toString();
}
export function humanAmount(value:string,decimals:number) {const padded=value.padStart(decimals+1,'0');return decimals?`${padded.slice(0,-decimals)}.${padded.slice(-decimals)}`.replace(/\.?0+$/,''):value;}
export const orderSchema=z.object({requestId:z.string().min(1).max(200),transaction:z.string().min(1).max(10000),inputMint:addressSchema,outputMint:addressSchema,inAmount:z.string().regex(/^[1-9]\d{0,19}$/),outAmount:z.string().regex(/^[1-9]\d{0,19}$/),otherAmountThreshold:z.string().regex(/^[1-9]\d{0,19}$/),router:z.string().max(80),feeBps:z.number().finite().nonnegative().optional(),feeMint:z.string().optional(),priceImpact:z.number().finite().optional(),priceImpactPct:z.union([z.number(),z.string()]).optional(),slippageBps:z.number().int().min(0).max(500).optional(),expireAt:z.string().optional(),lastValidBlockHeight:z.string().optional(),signatureFeeLamports:z.number().nonnegative().optional(),prioritizationFeeLamports:z.number().nonnegative().optional(),rentFeeLamports:z.number().nonnegative().optional(),signatureFeePayer:z.string().nullable().optional(),taker:z.string().nullable().optional()});
function orderFailure(raw:{router?:unknown;errorCode?:unknown},inputMint:string){
  // Jupiter reuses error numbers across routers. Never interpret a number alone
  // or display an untrusted provider errorMessage as instructions to the user.
  if(['metis','dflow','okx'].includes(String(raw.router))){
    if(raw.errorCode===1)return inputMint===SOL_MINT?'The Solana wallet paying for this swap does not have enough native SOL. Fund that wallet on the Solana network and leave SOL for fees.':'The Solana wallet paying for this swap does not have enough of the token you are selling. Check its token balance and keep native SOL for fees.';
    if(raw.errorCode===2)return 'The Solana wallet paying for this swap needs native SOL for network fees. SOL or other assets on Ethereum and BNB Chain cannot pay Solana fees.';
    if(raw.errorCode===3)return 'This swap is below Jupiter’s minimum size for gasless execution. Review the amount and available fee options.';
  }
  if(raw.router==='jupiterz'){
    if(raw.errorCode===1)return 'The Solana wallet paying for this swap cannot fund it. Check its input-token balance and native SOL for fees.';
    if(raw.errorCode===2)return 'Jupiter could not find the required token account for this wallet. Check the token WGT address and Solana wallet setup.';
    if(raw.errorCode===3)return 'Jupiter could not build a transaction for this quote. Request a fresh quote or check whether the token has a supported route.';
  }
  return 'Jupiter cannot prepare this swap. Check token support, the paying Solana wallet’s balance, and SOL for fees. No swap was submitted.';
}
export async function jupiterOrder(inputMint:string,outputMint:string,amount:string,taker:string,slippageBps:number,chatOnly=false) {
  const params=new URLSearchParams({inputMint,outputMint,amount,taker,slippageBps:String(slippageBps),maxSupportedTransactionVersion:'0',excludeRouters:chatOnly?'jupiterz,dflow,okx':'jupiterz'});
  const raw=await fetchJson(`https://api.jup.ag/swap/v2/order?${params}`,{headers:jupiterHeaders()},'Jupiter');
  check(raw&&typeof raw==='object'&&!Array.isArray(raw),502,'Jupiter returned an unsupported order response.');
  check(!raw.errorCode&&raw.transaction,400,orderFailure(raw,inputMint));
  const order=orderSchema.safeParse(raw);check(order.success,502,'Jupiter returned an unsupported order response.');
  check(order.data.inputMint===inputMint&&order.data.outputMint===outputMint&&order.data.inAmount===amount,502,'Jupiter returned an order that does not match the requested tokens or amount.');
  check(!order.data.taker||order.data.taker===taker,502,'Jupiter returned a different wallet.');
  check(BigInt(order.data.otherAmountThreshold)<=BigInt(order.data.outAmount)&&BigInt(order.data.otherAmountThreshold)>=BigInt(order.data.outAmount)*BigInt(10000-slippageBps)/10000n,502,'Jupiter returned an output threshold outside your slippage limit.');
  return order.data;
}
export async function jupiterExecute(signedTransaction:string,requestId:string,lastValidBlockHeight?:string,timeout=25000) {
  return fetchJson('https://api.jup.ag/swap/v2/execute',{method:'POST',headers:{...jupiterHeaders(),'Content-Type':'application/json'},body:JSON.stringify({signedTransaction,requestId,...(lastValidBlockHeight?{lastValidBlockHeight}:{})})},'Jupiter execution',timeout);
}
export async function rpc(method:string,params:unknown[]) {
  const url=process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  check(new URL(url).protocol==='https:',503,'SOLANA_RPC_URL must use HTTPS.');
  const raw=await fetchJson(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})},'Solana confirmation');
  check(!raw.error&&raw.result!==undefined,502,'Solana confirmation is temporarily unavailable.');return raw.result;
}
export async function signatureStatus(signature:string) {const result=await rpc('getSignatureStatuses',[[signature],{searchTransactionHistory:true}]);check(Array.isArray(result?.value)&&result.value.length===1,502,'Solana returned an unsupported confirmation response.');return result.value[0];}
export async function finalizedBlockHeight(){const height=await rpc('getBlockHeight',[{commitment:'finalized'}]);check(Number.isSafeInteger(height)&&height>0,502,'Finalized block height is unavailable.');return height as number;}
