import {api} from './api';

export interface WalletProvider {
  isMetaMask?:boolean;
  isBinance?:boolean;
  isPhantom?:boolean;
  providers?:WalletProvider[];
  request(args:{method:string;params?:unknown[]}):Promise<any>;
  on?(event:string,listener:(value:any)=>void):void;
  removeListener?(event:string,listener:(value:any)=>void):void;
}
export type AccountWallet = 'metamask' | 'binance' | 'phantom';
const accountWalletKey='wagent:account-wallet';
declare global {interface Window {ethereum?:WalletProvider;binancew3w?:{ethereum?:WalletProvider};phantom?:{ethereum?:WalletProvider}}}
export function shortWallet(address:string){return `${address.slice(0,6)}…${address.slice(-4)}`}
export async function findMetaMask():Promise<WalletProvider|null>{
  // EIP-6963 avoids accidentally selecting another injected wallet.
  const providers:WalletProvider[]=[];
  const announce=(event:Event)=>{const detail=(event as CustomEvent).detail;if(detail?.info?.rdns==='io.metamask'&&detail.provider&&!detail.provider.isBinance&&!detail.provider.isPhantom)providers.push(detail.provider)};
  window.addEventListener('eip6963:announceProvider',announce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise(r=>setTimeout(r,150));window.removeEventListener('eip6963:announceProvider',announce);
  if(providers[0])return providers[0];
  const injected=window.ethereum;
  return injected?.providers?.find(p=>p.isMetaMask&&!p.isBinance&&!p.isPhantom)||(injected?.isMetaMask&&!injected.isBinance&&!injected.isPhantom?injected:null);
}
export async function findAccountWallet(kind:AccountWallet):Promise<WalletProvider|null>{
  if(kind==='metamask')return findMetaMask();
  if(kind==='phantom'){
    const scoped=window.phantom?.ethereum;if(typeof scoped?.request==='function')return scoped;
    const injected=window.ethereum;return injected?.providers?.find(p=>p.isPhantom)||(injected?.isPhantom?injected:null);
  }
  // Binance documents this namespace for both its extension and DApp browser.
  const scoped=window.binancew3w?.ethereum;
  if(typeof scoped?.request==='function')return scoped;
  const injected=window.ethereum;
  return injected?.providers?.find(p=>p.isBinance)||(injected?.isBinance?injected:null);
}
export function signedInWalletKind():AccountWallet{try{const kind=sessionStorage.getItem(accountWalletKey);return kind==='binance'||kind==='phantom'?kind:'metamask';}catch{return 'metamask';}}
export async function signInWithWallet(kind:AccountWallet){
  const label={binance:'Binance Wallet',phantom:'Phantom',metamask:'MetaMask'}[kind];
  const provider=await findAccountWallet(kind);if(!provider)throw new Error(`${label} was not detected. ${kind!=='metamask'?`Open this site in ${label}’s DApp browser or install its wallet extension.`:'Open this site in a browser with the MetaMask extension installed.'}`);
  const accounts=await provider.request({method:'eth_requestAccounts'});const address=accounts?.[0];
  if(typeof address!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(address))throw new Error(`Select an EVM account in ${label} to sign in. Your Solana account is connected separately for trading.`);
  const chainHex=await provider.request({method:'eth_chainId'}),chainId=Number(chainHex);
  if(!Number.isSafeInteger(chainId)||chainId<=0||chainId>2147483647)throw new Error('This network is not supported for wallet sign-in. Switch to Ethereum or another supported EVM network.');
  const challenge=await api('/auth/wallet/challenge',{address,chainId});
  const messageHex='0x'+Array.from(new TextEncoder().encode(challenge.message),n=>n.toString(16).padStart(2,'0')).join('');
  const signature=await provider.request({method:'personal_sign',params:[messageHex,address]});
  const current=await provider.request({method:'eth_accounts'});
  if(current?.[0]?.toLowerCase()!==address.toLowerCase())throw new Error('The wallet account changed. Connect the original account and try again.');
  await api('/auth/wallet/verify',{signature});
  try{sessionStorage.setItem(accountWalletKey,kind);}catch{/* Only the provider preference is stored; the session remains in its HTTP-only cookie. */}
}
export async function signInWithMetaMask(){return signInWithWallet('metamask');}
export function walletError(error:any){
  if(error?.code===4001)return 'You cancelled the wallet request. Connect again whenever you are ready.';
  if(error?.code===-32002)return 'Your wallet already has a pending request. Open it to complete or cancel that request.';
  return error?.message||'The wallet could not connect. Please try again.';
}
