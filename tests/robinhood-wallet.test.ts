import {afterEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {sendRhTransaction,signRhMessage,RhWalletRequestError} from '../src/robinhood-wallet';
import {Funding} from '../src/robinhood-setup';
import {walletError} from '../src/wallet';
const owner='0x'+'11'.repeat(20),trading='0x'+'22'.repeat(20),txHash='0x'+'ab'.repeat(32);
const tx={from:owner,to:trading,value:'0x1',data:'0x',gas:'0x5208',gasPrice:'0x1',chainId:'0x1237'};
const expiry=()=>new Date(Date.now()+60000).toISOString();
function wallet(options:{kind?:'metamask'|'phantom';send?:()=>Promise<unknown>;chain?:string;account?:string}={}){
  const target=new EventTarget() as any;let chain=options.chain||'0x1237';
  const request=vi.fn(async({method}:any):Promise<any>=>{
    if(method==='eth_accounts'||method==='eth_requestAccounts')return[options.account||owner];
    if(method==='eth_chainId')return chain;
    if(method==='wallet_switchEthereumChain'){chain='0x1237';return null;}
    if(method==='eth_sendTransaction')return options.send?options.send():txHash;
    if(method==='personal_sign')return '0x'+'11'.repeat(65);
    throw Error('Unexpected fixture method '+method);
  });
  if(options.kind==='phantom')target.phantom={ethereum:{request,isPhantom:true}};else target.ethereum={request,isMetaMask:true};
  vi.stubGlobal('window',target);return request;
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('Robinhood owner wallet request handling',()=>{
  it.each(['metamask','phantom'] as const)('submits the exact reviewed transfer once through %s',async kind=>{const request=wallet({kind});expect(await sendRhTransaction(kind,tx,expiry())).toBe(txHash);expect(request.mock.calls.filter(([arg])=>arg.method==='eth_sendTransaction')).toEqual([[{method:'eth_sendTransaction',params:[tx]}]]);});
  it.each([
    {error:{code:-32002,message:'request already pending'},text:'pending request',uncertain:true,code:-32002},
    {error:{code:-32603,data:{originalError:{code:-32002,message:'pending'}}},text:'pending request',uncertain:true,code:-32002},
    {error:{code:4001},text:'cancelled',uncertain:false,code:4001},
    {error:{code:4100},text:'not authorized',uncertain:false,code:4100},
    {error:{code:-32602},text:'transaction parameters',uncertain:false,code:-32602},
    {error:{code:4200},text:'does not support',uncertain:false,code:4200},
    {error:{code:-32000,message:'insufficient funds for gas * price + value'},text:'insufficient ETH',uncertain:false,code:-32000},
    {error:{code:4900,message:'disconnected'},text:'outcome is unknown',uncertain:true,code:4900},
    {error:new Error('network timeout'),text:'outcome is unknown',uncertain:true,code:undefined},
  ])('explains $text without retrying or declaring an uncertain transfer completed',async({error,text,uncertain,code})=>{
    const request=wallet({send:async()=>{throw error;}});let received:unknown;try{await sendRhTransaction('metamask',tx,expiry());}catch(e){received=e;}
    expect(received).toBeInstanceOf(RhWalletRequestError);expect(received).toMatchObject({uncertain,walletCode:code});expect(walletError(received)).toContain(text);expect(request.mock.calls.filter(([arg])=>arg.method==='eth_sendTransaction')).toHaveLength(1);
  });
  it('treats a missing transaction hash as unknown rather than success or an automatic retry',async()=>{const request=wallet({send:async()=>undefined});await expect(sendRhTransaction('metamask',tx,expiry())).rejects.toMatchObject({uncertain:true});expect(request.mock.calls.filter(([arg])=>arg.method==='eth_sendTransaction')).toHaveLength(1);});
  it('blocks a second transaction or message prompt while a wallet approval is already open',async()=>{
    let settle!:(hash:string)=>void;const request=wallet({send:()=>new Promise(resolve=>{settle=resolve;})}),first=sendRhTransaction('metamask',tx,expiry());await vi.waitFor(()=>expect(settle).toBeTypeOf('function'));
    await expect(sendRhTransaction('metamask',tx,expiry())).rejects.toThrow('already open');await expect(signRhMessage('metamask',owner,'Another permission')).rejects.toThrow('already open');expect(request.mock.calls.filter(([arg])=>arg.method==='eth_sendTransaction')).toHaveLength(1);expect(request.mock.calls.some(([arg])=>arg.method==='personal_sign')).toBe(false);settle(txHash);expect(await first).toBe(txHash);
  });
  it('releases the prompt guard after cancellation so a later explicit request can proceed',async()=>{let attempts=0;wallet({send:async()=>{if(++attempts===1)throw{code:4001};return txHash;}});await expect(sendRhTransaction('metamask',tx,expiry())).rejects.toThrow('cancelled');expect(await sendRhTransaction('metamask',tx,expiry())).toBe(txHash);expect(attempts).toBe(2);});
  it('rejects an expired review after a delayed network switch without sending',async()=>{const request=wallet({chain:'0x1'}),original=request.getMockImplementation()!,date=expiry();request.mockImplementation(async(arg:any)=>{const result=await original(arg);if(arg.method==='wallet_switchEthereumChain')vi.setSystemTime(Date.now()+120000);return result;});await expect(sendRhTransaction('metamask',tx,date)).rejects.toThrow('expired');expect(request.mock.calls.some(([arg])=>arg.method==='eth_sendTransaction')).toBe(false);});
  it('rejects the wrong owner or invalid expiry before opening a transaction prompt',async()=>{const request=wallet({account:trading});await expect(sendRhTransaction('metamask',tx,expiry())).rejects.toThrow('original owner');await expect(sendRhTransaction('metamask',tx,'invalid-date')).rejects.toThrow('expired');expect(request.mock.calls.some(([arg])=>arg.method==='eth_sendTransaction')).toBe(false);});
});
describe('Returning-device funding guidance',()=>{
  it('shows the existing trading balance and a route to permissions without requesting another deposit',()=>{vi.stubGlobal('localStorage',{getItem:()=>null});const html=renderToStaticMarkup(createElement(Funding,{wallet:{ownerAddress:owner,address:trading},kind:'metamask',balance:'0.003186',onDone:async()=>{}}));expect(html).toContain('already funded:');expect(html).toContain('0.003186');expect(html).toContain('Continue to WhatsApp permissions');expect(html).toContain('same balance');});
  it('retains an unresolved wallet request across a page reload and offers only a read-only check until acknowledged',()=>{vi.stubGlobal('localStorage',{getItem:()=> '1'});const html=renderToStaticMarkup(createElement(Funding,{wallet:{ownerAddress:owner,address:trading},kind:'metamask',onDone:async()=>{}}));expect(html).toContain('Check the existing wallet request first');expect(html).toContain('Check Robinhood balances (no transfer)');expect(html).toContain('disabled="">Review ETH deposit');expect(html).not.toContain('Approve in MetaMask');});
});
