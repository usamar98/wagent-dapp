import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { getCompiledTransactionMessageDecoder } from '@solana/transaction-messages';
import { decodeSwapTransaction } from './solana-swaps.js';
import { check } from './security.js';
import { SOL_MINT, rpc, type orderSchema } from './solana-providers.js';
import type { z } from 'zod';

export const SYSTEM_PROGRAM='11111111111111111111111111111111', TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', TOKEN_2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', ASSOCIATED_PROGRAM='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', JUPITER_PROGRAM='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const COMPUTE='ComputeBudget111111111111111111111111111111', LOOKUP='AddressLookupTab1e1111111111111111111111111';
const discriminator=(name:string)=>createHash('sha256').update(`global:${name}`).digest().subarray(0,8);
type Account={owner:string;lamports:number;executable:boolean;data:[string,string]}|null;
export function tokenAccount(account:Account) {
  if(!account||![TOKEN_PROGRAM,TOKEN_2022].includes(account.owner))return null;
  const data=Buffer.from(account.data[0],'base64');if(data.length<165)return null;
  return {mint:bs58.encode(data.subarray(0,32)),owner:bs58.encode(data.subarray(32,64)),amount:data.readBigUInt64LE(64),delegate:data.readUInt32LE(72),state:data[108],closeAuthority:data.readUInt32LE(129)?bs58.encode(data.subarray(133,165)):null};
}
function lamports(account:Account){check(account&&Number.isSafeInteger(account.lamports)&&account.lamports>=0,502,'RPC returned an unsupported wallet balance.');return BigInt(account.lamports);}
async function resolveAccounts(message:ReturnType<ReturnType<typeof getCompiledTransactionMessageDecoder>['decode']>) {
  check(message.version===0||message.version==='legacy',400,'Unsupported chat transaction version.');
  const lookups=message.version===0?message.addressTableLookups||[]:[];
  const writable:string[]=[],readonly:string[]=[];
  if(lookups.length){
    const response=await rpc('getMultipleAccounts',[lookups.map(t=>t.lookupTableAddress),{encoding:'base64',commitment:'confirmed'}]);
    check(Array.isArray(response?.value)&&response.value.length===lookups.length,502,'Address lookup tables could not be verified.');
    lookups.forEach((table,i)=>{
      const account=response.value[i] as Account;check(account?.owner===LOOKUP,400,'Unsupported address lookup table.');
      const bytes=Buffer.from(account.data[0],'base64');check(bytes.length>=56&&(bytes.length-56)%32===0,400,'Malformed address lookup table.');
      const read=(index:number)=>{check(56+(index+1)*32<=bytes.length,400,'Missing address lookup entry.');return bs58.encode(bytes.subarray(56+index*32,56+(index+1)*32));};
      writable.push(...table.writableIndexes.map(read));readonly.push(...table.readonlyIndexes.map(read));
    });
  }
  return [...message.staticAccounts,...writable,...readonly] as string[];
}
// Fixed-layout exact-input Metis v2 instructions only. Unknown routers/instructions fail closed.
// Layout sources: Jupiter CPI IDL and carbon's route_v2/shared_accounts_route_v2 decoders.
export function verifyRouteData(data:Buffer,order:z.infer<typeof orderSchema>,maxSlippage:number){
  const shared=data.subarray(0,8).equals(discriminator('shared_accounts_route_v2'));
  check(shared||data.subarray(0,8).equals(discriminator('route_v2')),400,'This Jupiter route needs manual wallet approval. Chat trading supports Metis exact-input v2 routes.');
  const start=shared?9:8;check(data.length>=start+26,400,'Malformed Jupiter route.');
  const input=data.readBigUInt64LE(start),quoted=data.readBigUInt64LE(start+8),slippage=data.readUInt16LE(start+16),fee=data.readUInt16LE(start+18);
  check(input===BigInt(order.inAmount)&&slippage<=maxSlippage&&fee<=100,400,'The on-chain route exceeds the approved input, slippage, or 1% provider-fee limit.');
  const minimum=quoted*BigInt(10000-slippage)/10000n*BigInt(10000-fee)/10000n;
  check(minimum+1n>=BigInt(order.otherAmountThreshold),400,'The on-chain route does not protect the quoted minimum output.');
  return shared?{authority:1,source:2,destination:5,inputMint:6,outputMint:7}:{authority:0,source:1,destination:2,inputMint:3,outputMint:4};
}
export async function validateChatTransaction(order:z.infer<typeof orderSchema>,wallet:string,maxFee:bigint,maxSlippage:number) {
  check(order.router.toLowerCase()==='metis'&&(!order.signatureFeePayer||order.signatureFeePayer===wallet),400,'Chat trading requires a user-paid Metis route. Try a wallet-approved swap for this token.');
  const tx=decodeSwapTransaction(order.transaction,wallet),message=getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  check(Object.keys(tx.signatures).length===1&&message.version!==1&&message.header.numSignerAccounts===1,400,'Chat routes must use only the dedicated wallet signer.');
  const addresses=await resolveAccounts(message);check(addresses.length<=100&&new Set(addresses).size===addresses.length,400,'Chat route account list is unsupported.');
  const routes=message.instructions.filter(ix=>addresses[ix.programAddressIndex]===JUPITER_PROGRAM);check(routes.length===1,400,'A chat trade must contain exactly one Jupiter swap.');
  const route=routes[0],binding=verifyRouteData(Buffer.from(route.data||[]),order,maxSlippage),indices=route.accountIndices||[];
  const get=(index:number)=>addresses[indices[index]];
  check(get(binding.authority)===wallet&&get(binding.inputMint)===order.inputMint&&get(binding.outputMint)===order.outputMint,400,'The swap instruction does not match this wallet or token pair.');
  const source=get(binding.source),destination=get(binding.destination);check(source&&destination&&source!==destination,400,'Invalid swap token accounts.');
  const raw=await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:165}}]);
  check(Array.isArray(raw?.value)&&raw.value.length===addresses.length&&Number.isSafeInteger(raw.context?.slot),502,'RPC account verification failed.');
  const before=raw.value as Account[];
  for(const ix of message.instructions){
    const program=addresses[ix.programAddressIndex],accounts=(ix.accountIndices||[]).map(i=>addresses[i]),data=Buffer.from(ix.data||[]);
    if(program===JUPITER_PROGRAM)continue;
    if(program===COMPUTE){check(data.length>0&&[1,2,3,4].includes(data[0]),400,'Unsupported compute instruction.');continue;}
    if(program===ASSOCIATED_PROGRAM){check((data.length===0||data.length===1&&[0,1].includes(data[0]))&&accounts[0]===wallet&&accounts[2]===wallet,400,'Only the trading wallet’s associated accounts may be created.');continue;}
    if(program===SYSTEM_PROGRAM){check(data.length===12&&data.readUInt32LE(0)===2&&accounts[0]===wallet&&accounts[1]===source&&order.inputMint===SOL_MINT&&data.readBigUInt64LE(4)<=BigInt(order.inAmount),400,'The route contains an unauthorized SOL transfer.');continue;}
    if(program===TOKEN_PROGRAM||program===TOKEN_2022){
      check(data.length>0&&[3,9,12,17,18,22].includes(data[0]),400,'Token approvals, authority changes, and unsupported token instructions are not allowed.');
      if(data[0]===9)check(accounts[1]===wallet&&accounts[2]===wallet&&[source,destination].includes(accounts[0])&&[order.inputMint,order.outputMint].includes(SOL_MINT),400,'Unsupported token account close.');
      if(data[0]===18)check(data.length===33&&bs58.encode(data.subarray(1))===wallet,400,'Token account owner must be the dedicated wallet.');
      continue;
    }
    check(false,400,'The route contains an unsupported instruction. Use manual wallet approval.');
  }
  const fee=await rpc('getFeeForMessage',[Buffer.from(tx.messageBytes).toString('base64'),{commitment:'confirmed',minContextSlot:raw.context.slot}]);
  check(Number.isSafeInteger(fee?.value)&&fee.value>=0&&BigInt(fee.value)<=maxFee,400,'The network fee exceeds your approved fee/rent cap.');
  const observed=[...new Set([wallet,source,destination,...addresses.filter((_,i)=>tokenAccount(before[i])?.owner===wallet)])];
  const sim=await rpc('simulateTransaction',[order.transaction,{encoding:'base64',commitment:'confirmed',minContextSlot:raw.context.slot,sigVerify:false,replaceRecentBlockhash:false,accounts:{encoding:'base64',addresses:observed}}]);
  check(sim?.value&&sim.value.err===null&&Array.isArray(sim.value.accounts)&&sim.value.accounts.length===observed.length,400,'The swap simulation failed. Check trading-wallet funds and token support.');
  const after=sim.value.accounts as Account[],preWallet=before[addresses.indexOf(wallet)],postWallet=after[observed.indexOf(wallet)];
  check(postWallet?.owner===SYSTEM_PROGRAM&&!postWallet.executable&&Buffer.from(postWallet.data[0],'base64').length===0,400,'The route changed the trading wallet authority.');
  const preTotals=new Map<string,bigint>(),postTotals=new Map<string,bigint>();
  for(const address of observed){
    const pre=tokenAccount(before[addresses.indexOf(address)]),post=tokenAccount(after[observed.indexOf(address)]);
    if(pre?.owner===wallet){check(post?.owner===wallet||pre.mint===SOL_MINT&&!after[observed.indexOf(address)],400,'The route changed token account ownership.');preTotals.set(pre.mint,(preTotals.get(pre.mint)||0n)+pre.amount);}
    if(post?.owner===wallet){check(post.delegate===0&&post.state===1&&(!post.closeAuthority||post.closeAuthority===wallet),400,'The route leaves unsafe token authority permissions.');postTotals.set(post.mint,(postTotals.get(post.mint)||0n)+post.amount);}
  }
  const delta=(mint:string)=>(postTotals.get(mint)||0n)-(preTotals.get(mint)||0n);
  const nativeDelta=lamports(postWallet)-lamports(preWallet)+delta(SOL_MINT),isBuy=order.inputMint===SOL_MINT;
  const token=isBuy?order.outputMint:order.inputMint;
  for(const mint of new Set([...preTotals.keys(),...postTotals.keys()]))check([SOL_MINT,token].includes(mint)||delta(mint)===0n,400,'The route changes an unrelated token balance.');
  if(isBuy){check(nativeDelta>=-BigInt(order.inAmount)-maxFee&&delta(token)>=BigInt(order.otherAmountThreshold),400,'Simulation exceeds your spending cap or misses the minimum token output.');}
  else check(delta(token)===-BigInt(order.inAmount)&&nativeDelta>=BigInt(order.otherAmountThreshold)-maxFee,400,'Simulation exceeds the token quantity or misses the minimum SOL output.');
  return {feeLamports:fee.value as number};
}
