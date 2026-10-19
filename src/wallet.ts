import {api} from './api';

export interface WalletProvider {
  isMetaMask?:boolean;
  providers?:WalletProvider[];
  request(args:{method:string;params?:unknown[]}):Promise<any>;
  on?(event:string,listener:(value:any)=>void):void;
  removeListener?(event:string,listener:(value:any)=>void):void;
}
declare global {interface Window {ethereum?:WalletProvider}}
export function shortWallet(address:string){return `${address.slice(0,6)}…${address.slice(-4)}`}
export async function findMetaMask():Promise<WalletProvider|null>{
  // EIP-6963 avoids accidentally selecting another injected wallet.
  const providers:WalletProvider[]=[];
  const announce=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.info?.rdns==='io.metamask'&&detail.provider)providers.push(detail.provider)};
  window.addEventListener('eip6963:announceProvider',announce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise(r=>setTimeout(r,150));window.removeEventListener('eip6963:announceProvider',announce);
  if(providers[0])return providers[0];
  const injected=window.ethereum;
  return injected?.providers?.find(p=>p.isMetaMask)||(injected?.isMetaMask?injected:null);
}
export async function signInWithMetaMask(){
  const provider=await findMetaMask();if(!provider)throw new Error('MetaMask was not detected. Open this site in a browser with the MetaMask extension installed.');
  const accounts=await provider.request({method:'eth_requestAccounts'});const address=accounts?.[0];
  if(typeof address!=='string')throw new Error('Select a MetaMask account to continue.');
  const chainHex=await provider.request({method:'eth_chainId'}),chainId=Number(chainHex);
  if(!Number.isSafeInteger(chainId)||chainId<=0||chainId>2147483647)throw new Error('This network is not supported for wallet sign-in. Switch to Ethereum or another supported EVM network.');
  const challenge=await api('/auth/wallet/challenge',{address,chainId});
  const messageHex='0x'+Array.from(new TextEncoder().encode(challenge.message),n=>n.toString(16).padStart(2,'0')).join('');
  const signature=await provider.request({method:'personal_sign',params:[messageHex,address]});
  await api('/auth/wallet/verify',{signature});
}
export function walletError(error:any){
  if(error?.code===4001)return 'You cancelled the wallet request. Connect again whenever you are ready.';
  if(error?.code===-32002)return 'MetaMask already has a pending request. Open the extension to complete it.';
  return error?.message||'The wallet could not connect. Please try again.';
}
