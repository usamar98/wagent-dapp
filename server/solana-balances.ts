import {check} from './security.js';
import {addressSchema,humanAmount,rpc} from './solana-providers.js';
const programs=['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
export async function walletBalances(wallet:string){
  const sol=await rpc('getBalance',[wallet,{commitment:'confirmed'}]);
  check(Number.isSafeInteger(sol?.value)&&sol.value>=0,502,'Wallet balance is unavailable.');
  const tokens=new Map<string,{mint:string;raw:bigint;decimals:number}>(),seen=new Set<string>();
  for(const programId of programs){
    const response=await rpc('getTokenAccountsByOwner',[wallet,{programId},{encoding:'jsonParsed',commitment:'confirmed'}]);
    check(Array.isArray(response?.value)&&response.value.length<=100,502,'Token balances are unavailable.');
    for(const row of response.value){
      const info=row.account?.data?.parsed?.info;
      if(info?.owner!==wallet||row.account.owner!==programId||!addressSchema.safeParse(info.mint).success)continue;
      check(addressSchema.safeParse(row.pubkey).success,502,'Token account address could not be verified.');
      if(seen.has(row.pubkey))continue;seen.add(row.pubkey);
      check(/^\d{1,20}$/.test(info.tokenAmount?.amount)&&Number.isInteger(info.tokenAmount.decimals)&&info.tokenAmount.decimals>=0&&info.tokenAmount.decimals<=18,502,'Unsupported token balance.');
      const raw=BigInt(info.tokenAmount.amount);if(!raw)continue;
      const previous=tokens.get(info.mint);check(!previous||previous.decimals===info.tokenAmount.decimals,502,'Token decimals could not be verified.');
      tokens.set(info.mint,{mint:info.mint,raw:(previous?.raw||0n)+raw,decimals:info.tokenAmount.decimals});
    }
  }
  return {sol:humanAmount(String(sol.value),9),solRaw:String(sol.value),tokens:[...tokens.values()].map(t=>({mint:t.mint,amount:humanAmount(String(t.raw),t.decimals),rawAmount:String(t.raw),decimals:t.decimals})),at:new Date().toISOString()};
}
