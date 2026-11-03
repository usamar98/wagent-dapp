import { findAccountWallet, type AccountWallet, type WalletProvider } from './wallet';
import { ROBINHOOD_CHAIN_HEX, ROBINHOOD_CHAIN_ID, RH_EXPLORER, evmAddress } from '../shared/robinhood';
export async function rhProvider(kind:AccountWallet,expected?:string):Promise<{provider:WalletProvider;address:string}>{
  const provider=await findAccountWallet(kind);if(!provider)throw Error(`${kind==='phantom'?'Phantom':'MetaMask'} was not detected. Open the site in its DApp browser or compatible extension.`);
  let accounts=await provider.request({method:'eth_accounts'});if(!accounts?.length)accounts=await provider.request({method:'eth_requestAccounts'});const address=evmAddress(accounts?.[0]||'');if(expected&&address!==evmAddress(expected))throw Error('Select the original owner account in this wallet. No other account will be used.');
  const chain=await provider.request({method:'eth_chainId'});if(Number(chain)!==ROBINHOOD_CHAIN_ID){try{await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:ROBINHOOD_CHAIN_HEX}]});}catch(e:any){if(e?.code!==4902)throw e;await provider.request({method:'wallet_addEthereumChain',params:[{chainId:ROBINHOOD_CHAIN_HEX,chainName:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:['https://rpc.mainnet.chain.robinhood.com'],blockExplorerUrls:[RH_EXPLORER]}]});await provider.request({method:'wallet_switchEthereumChain',params:[{chainId:ROBINHOOD_CHAIN_HEX}]});}}
  await assertRhAccount(provider,address);return {provider,address};
}
async function assertRhAccount(provider:WalletProvider,address:string){const [accounts,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);if(evmAddress(accounts?.[0]||'')!==address||Number(chain)!==ROBINHOOD_CHAIN_ID)throw Error('Wallet account or network changed. Select your original owner on Robinhood Chain.');}
export class RhWalletRequestError extends Error {
  constructor(message:string,public readonly uncertain:boolean,public readonly walletCode?:number){super(message);}
}
const activeWalletRequests=new Set<AccountWallet>();
async function walletRequest<T>(kind:AccountWallet,work:()=>Promise<T>):Promise<T>{
  if(activeWalletRequests.has(kind))throw new RhWalletRequestError('A wallet approval is already open in this tab. Complete or cancel it in your wallet before starting another request.',true,-32002);
  activeWalletRequests.add(kind);try{return await work();}finally{activeWalletRequests.delete(kind);}
}
function submissionError(error:unknown,kind:AccountWallet){
  const wallet=kind==='phantom'?'Phantom':'MetaMask',queue:unknown[]=[error];let code:number|undefined,message='';
  const specific=[4001,-32002,4100,-32602,4200,-32601];
  for(let i=0;i<queue.length&&i<8;i++){const item=queue[i] as any;if(!item||typeof item!=='object')continue;const candidate=Number(item.code);if(item.code!==undefined&&Number.isFinite(candidate)&&(code===undefined||(!specific.includes(code)&&specific.includes(candidate))))code=candidate;message+=' '+String(item.message||'');if(item.error)queue.push(item.error);if(item.data?.originalError)queue.push(item.data.originalError);if(item.cause)queue.push(item.cause);}
  if(code===4001)return new RhWalletRequestError('You cancelled the wallet approval. No automatic retry was made.',false,code);
  if(code===-32002)return new RhWalletRequestError(`${wallet} already has a pending request. Open its pending requests and complete or cancel the existing one. Check wallet Activity before requesting another deposit.`,true,code);
  if(code===4100)return new RhWalletRequestError(`${wallet} has not authorized this account or transaction method. Connect your original owner account to this site, then review again.`,false,code);
  if(code===-32602)return new RhWalletRequestError(`${wallet} rejected the transaction parameters (code -32602). Update the wallet extension and create a fresh review. No automatic retry was made.`,false,code);
  if(code===4200||code===-32601)return new RhWalletRequestError(`${wallet} does not support this transaction request. Use a compatible, updated wallet extension or its DApp browser.`,false,code);
  if(/insufficient funds|insufficient balance/i.test(message))return new RhWalletRequestError(`${wallet} reports insufficient ETH for the amount and gas on Robinhood Chain. ETH on another network is a separate balance. No automatic retry was made.`,false,code);
  return new RhWalletRequestError(`${wallet} could not confirm the submission${code===undefined?'':` (wallet code ${code})`}. Check wallet Activity before starting another transfer. Its outcome is unknown; nothing will be retried automatically.`,true,code);
}
export async function signRhMessage(kind:AccountWallet,address:string,message:string){return walletRequest(kind,async()=>{const {provider}=await rhProvider(kind,address),hex='0x'+Array.from(new TextEncoder().encode(message),n=>n.toString(16).padStart(2,'0')).join('');const signature=await provider.request({method:'personal_sign',params:[hex,address]});await assertRhAccount(provider,evmAddress(address));return signature as string;});}
function assertFreshReview(expiresAt:string){const expiry=new Date(expiresAt).getTime();if(!Number.isFinite(expiry)||expiry<=Date.now())throw Error('This review expired. Review the transfer again.');}
export async function sendRhTransaction(kind:AccountWallet,transaction:any,expiresAt:string){return walletRequest(kind,async()=>{
  assertFreshReview(expiresAt);if(Number(transaction.chainId)!==ROBINHOOD_CHAIN_ID)throw Error('Incorrect transaction network.');
  const {provider}=await rhProvider(kind,transaction.from);await assertRhAccount(provider,evmAddress(transaction.from));assertFreshReview(expiresAt);
  try{const hash=await provider.request({method:'eth_sendTransaction',params:[transaction]});if(typeof hash!=='string'||!/^0x[\da-fA-F]{64}$/.test(hash))throw Error('Unknown response');return hash;}
  catch(error){throw submissionError(error,kind);}
});}
