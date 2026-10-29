import {useEffect,useState} from 'react';
import {isSolanaAddress,type TokenFeed} from '../shared/solana';
import {useResource} from './solana-ui';

export function useTokenIdentities(addresses:string[]){
  const key=[...new Set(addresses.filter(isSolanaAddress))].slice(0,30).sort().join(',');
  const [ready,setReady]=useState('');
  useEffect(()=>{const timer=setTimeout(()=>setReady(key),350);return()=>clearTimeout(timer);},[key]);
  const result=useResource<TokenFeed>(`/solana/tokens?mints=${ready}`,!!ready);
  return ((ready===key?result.data?.tokens:[])||[]).filter(token=>key.split(',').includes(token.mint));
}
export function TokenIdentityHint({addresses}:{addresses:string[]}){
  const tokens=useTokenIdentities(addresses);
  return tokens.length?<small role="status">{tokens.map(t=><span key={t.mint} style={{display:'block'}}><strong>{t.symbol}</strong> · {t.name} · {t.mint.slice(0,5)}…{t.mint.slice(-5)}</span>)}</small>:null;
}
