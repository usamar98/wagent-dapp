import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto';
import { getWallets } from '@wallet-standard/app';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import bs58 from 'bs58';
import { availableWallets, isSupportedSolanaWallet, linkWallet, observeWallets, signSwap, signWalletMessage, fundSolanaWallet, validateSolFundingTransaction, type SolanaWallet, type WalletAccount } from '../src/solana-wallet';
import { findAccountWallet, signInWithWallet, signedInWalletKind, walletError, type WalletProvider } from '../src/wallet';
import { SolanaWalletPicker } from '../src/solana-wallet-picker';
import { api } from '../src/api';

vi.mock('../src/api', () => ({ api: vi.fn() }));
const cleanups: (() => void)[] = [];
const MAINNET = 'solana:mainnet';
function fixture(name = 'Phantom', transactions = true) {
  const keys = generateKeyPairSync('ed25519'), publicKey = new Uint8Array(keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
  const account: WalletAccount = { address: bs58.encode(publicKey), publicKey, chains: [MAINNET], features: ['solana:signMessage', ...(transactions ? ['solana:signTransaction'] : [])] };
  const listeners = new Set<() => void>();
  const message = vi.fn(async ({ message }: { message: Uint8Array }) => [{ signedMessage: message.slice(), signature: new Uint8Array(sign(null, message, keys.privateKey)) }]);
  const wallet: SolanaWallet = { name, chains: [MAINNET], accounts: [account], features: {
    'standard:connect': { connect: vi.fn(async () => ({ accounts: wallet.accounts })) },
    'standard:events': { on: (_event, listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
    'solana:signMessage': { signMessage: message },
    ...(transactions ? { 'solana:signTransaction': { signTransaction: vi.fn(async ({ transaction }) => [{ signedTransaction: transaction }]) } } : {}),
  } };
  return { wallet, account, keys, message, changed: () => listeners.forEach(listener => listener()), listeners };
}
function register(wallet: SolanaWallet) { cleanups.push(getWallets().register(wallet as never)); }
function browser() {
  const target = new EventTarget() as EventTarget & { ethereum?: WalletProvider; binancew3w?: { ethereum?: WalletProvider }; phantom?: { ethereum?: WalletProvider } };
  const storage = new Map<string, string>();
  vi.stubGlobal('window', target);
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) });
  return target;
}
afterEach(() => { cleanups.splice(0).reverse().forEach(off => off()); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('supported Solana Wallet Standard connections', () => {
  it('offers only MetaMask and Phantom, excluding unsupported and EVM-only wallets', () => {
    register(fixture('Phantom').wallet); register(fixture('MetaMask').wallet);register(fixture('Binance Web3 Wallet').wallet);register(fixture('Solflare').wallet);
    const evm = fixture('EVM only').wallet; evm.chains = ['eip155:1']; register(evm);
    const broken = fixture('No connect').wallet; delete broken.features['standard:connect']; register(broken);
    expect(availableWallets().map(w => w.name)).toEqual(['MetaMask', 'Phantom']);
    expect(isSupportedSolanaWallet({ name: 'Binance Wallet' })).toBe(false);
  });
  it('does not connect or request a signature from an unsupported wallet passed directly',async()=>{const f=fixture('Binance Wallet');await expect(linkWallet(f.wallet)).rejects.toThrow('MetaMask or Phantom');expect(f.message).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();});
  it('allows message-only wallets for permissions while requiring transaction signing for manual swaps', () => {
    const { wallet } = fixture('Phantom', false); register(wallet);
    expect(availableWallets()).toContain(wallet); expect(availableWallets('transactions')).not.toContain(wallet);
  });
  it('detects late registration, account changes, and removal and cleans up listeners', () => {
    const update = vi.fn(), off = observeWallets(update), f = fixture();
    const unregister = getWallets().register(f.wallet as never); cleanups.push(unregister);
    expect(update).toHaveBeenCalledTimes(2); f.changed(); expect(update).toHaveBeenCalledTimes(3);
    unregister(); expect(update).toHaveBeenCalledTimes(4); expect(f.listeners.size).toBe(0); off();
    const before = update.mock.calls.length; f.changed(); expect(update).toHaveBeenCalledTimes(before);
  });
  it('verifies an owner through the real adapter and submits only the public address and signature', async () => {
    const f = fixture(); vi.mocked(api).mockResolvedValueOnce({ id: 'proof', message: 'Wagent owner verification' }).mockResolvedValueOnce({ ok: true });
    expect(await linkWallet(f.wallet)).toEqual(f.account);
    expect(api).toHaveBeenNthCalledWith(1, '/solana/wallet/challenge', { address: f.account.address });
    const body = vi.mocked(api).mock.calls[1][1] as { id: string; signature: string };
    expect(Object.keys(body).sort()).toEqual(['id', 'signature']); expect(Buffer.from(body.signature, 'base64')).toHaveLength(64);
  });
  it.each(['Grant spending limits: 0.05 SOL; expiry: 1 hour', 'Withdraw 0.01 SOL to original owner'])('signs the exact permission/withdrawal message: %s', async message => {
    const f = fixture(); const signature = await signWalletMessage(f.wallet, f.account.address, message);
    expect(Buffer.from(signature, 'base64')).toHaveLength(64);
    expect(new TextDecoder().decode(f.message.mock.calls[0][0].message)).toBe(message);
  });
  it('never prompts another account to sign for the original owner', async () => {
    const f = fixture(), other = fixture();
    await expect(signWalletMessage(f.wallet, other.account.address, 'Permission')).rejects.toThrow('original owner'); expect(f.message).not.toHaveBeenCalled();
  });
  it('uses the already-authorized exact owner when a repeated MetaMask connection handshake would fail',async()=>{
    const f=fixture('MetaMask');vi.mocked(f.wallet.features['standard:connect']!.connect).mockRejectedValueOnce(new Error('Failed to connect to MetaMask'));
    const signature=await signWalletMessage(f.wallet,f.account.address,'Fresh reviewed permission');
    expect(Buffer.from(signature,'base64')).toHaveLength(64);expect(f.message).toHaveBeenCalledTimes(1);expect(f.wallet.features['standard:connect']!.connect).not.toHaveBeenCalled();
  });
  it('connects again when the expected account is not already authorized and never falls back to another account',async()=>{
    const f=fixture('MetaMask'),other=fixture();f.wallet.accounts=[other.account];
    await expect(signWalletMessage(f.wallet,f.account.address,'Fresh reviewed permission')).rejects.toThrow('original owner');
    expect(f.wallet.features['standard:connect']!.connect).toHaveBeenCalledTimes(1);expect(f.message).not.toHaveBeenCalled();
  });
  it('rejects a mainnet account without message support and a mismatched public key', async () => {
    const f = fixture(); f.account.features = ['solana:signTransaction'];
    await expect(linkWallet(f.wallet)).rejects.toThrow('message signing');
    f.account.features = ['solana:signMessage']; f.account.address = fixture().account.address;
    await expect(linkWallet(f.wallet)).rejects.toThrow('message signing'); expect(api).not.toHaveBeenCalled();
  });
  it('rejects a wallet that rewrites the reviewed message or signs with a different key', async () => {
    const f = fixture(), other = fixture();
    f.message.mockResolvedValueOnce([{ signature: new Uint8Array(64), signedMessage: new TextEncoder().encode('Different limits') }]);
    await expect(signWalletMessage(f.wallet, f.account.address, 'Reviewed limits')).rejects.toThrow('exact reviewed message');
    f.message.mockImplementationOnce(async ({ message }) => [{ signedMessage: message.slice(), signature: new Uint8Array(sign(null, message, other.keys.privateKey)) }]);
    await expect(signWalletMessage(f.wallet, f.account.address, 'Reviewed limits')).rejects.toThrow('original owner wallet');
  });
  it('rejects disconnects during approval and propagates cancellation without API verification', async () => {
    const f = fixture();
    f.message.mockImplementationOnce(async ({ message }) => { f.wallet.accounts = []; return [{ signedMessage: message.slice(), signature: new Uint8Array(sign(null, message, f.keys.privateKey)) }]; });
    await expect(signWalletMessage(f.wallet, f.account.address, 'Reviewed')).rejects.toThrow('disconnected');
    f.wallet.accounts = [f.account]; f.message.mockRejectedValueOnce(Object.assign(new Error('User cancelled'), { code: 4001 }));
    await expect(signWalletMessage(f.wallet, f.account.address, 'Reviewed')).rejects.toThrow('cancelled'); expect(api).not.toHaveBeenCalled();
  });
  it('signs manual swaps on Solana mainnet without calling a broadcast feature', async () => {
    const f = fixture(); expect(await signSwap(f.wallet, f.account.address, 'AQID')).toBe('AQID');
    expect(f.wallet.features['solana:signTransaction']!.signTransaction).toHaveBeenCalledWith({ account: f.account, chain: MAINNET, transaction: Uint8Array.of(1, 2, 3) });
  });
  it('shows supported selection and setup guidance without inventing an installed wallet', () => {
    const f = fixture('Phantom');
    const installed = renderToStaticMarkup(createElement(SolanaWalletPicker, { wallets: [f.wallet], selected: f.wallet, disabled: false, onChange: () => {} }));
    expect(installed).toContain('Phantom detected'); expect(installed).toContain('value="Phantom"');
    const absent = renderToStaticMarkup(createElement(SolanaWalletPicker, { wallets: [], selected: undefined, disabled: false, onChange: () => {} }));
    expect(absent).toContain('DApp browser'); expect(absent).not.toContain('<option'); expect(absent).toContain('Set up Phantom');expect(absent).not.toContain('Binance');
  });
  it('keeps MetaMask guidance and excludes unsupported selections',()=>{
    const f=fixture('MetaMask');const html=renderToStaticMarkup(createElement(SolanaWalletPicker,{wallets:[f.wallet],selected:f.wallet,disabled:false,onChange:()=>{}}));
    expect(html).toContain('MetaMask detected');expect(html).not.toContain('Binance');
    expect(html).toContain('Find your Solana address');expect(html).toContain('address dropdown below your account name');
    const unsupported=fixture('Binance Wallet'),filtered=renderToStaticMarkup(createElement(SolanaWalletPicker,{wallets:[f.wallet,unsupported.wallet],selected:unsupported.wallet,disabled:false,onChange:()=>{}}));expect(filtered).not.toContain('Binance');expect(filtered).not.toContain('value="Binance');
  });
});

describe('one-time SOL deposits from a connected wallet', () => {
  function depositFixture() {
    const f=fixture(),to=fixture().account.address,data=Buffer.alloc(12);data.writeUInt32LE(2);data.writeBigUInt64LE(50000000n,4);
    const wire=Buffer.concat([Buffer.of(1),Buffer.alloc(64),Buffer.of(1,0,1,3),Buffer.from(f.account.publicKey),Buffer.from(bs58.decode(to)),Buffer.alloc(32),randomBytes(32),Buffer.of(1,2,2,0,1,12),data]);
    const send=vi.fn(async()=>[{signature:new Uint8Array(64).fill(7)}]);f.account.features=[...f.account.features,'solana:signAndSendTransaction'];f.wallet.features['solana:signAndSendTransaction']={signAndSendTransaction:send};
    return {f,send,input:{from:f.account.address,to,amount:'0.05',transaction:wire.toString('base64'),expiresAt:new Date(Date.now()+60000).toISOString()},wire};
  }
  it('asks the selected supported wallet to approve one mainnet transfer with preflight, and never retries',async()=>{
    const {f,send,input}=depositFixture();const signature=await fundSolanaWallet(f.wallet,input);expect(bs58.decode(signature)).toHaveLength(64);expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({account:f.account,chain:MAINNET,transaction:Uint8Array.from(Buffer.from(input.transaction,'base64')),options:{preflightCommitment:'confirmed',skipPreflight:false,maxRetries:0}});
  });
  it.each(['recipient','amount','program','instruction count','trailing instruction'])('rejects a changed %s before opening a wallet request',async change=>{
    const {f,send,input,wire}=depositFixture();let modified=Buffer.from(wire);if(change==='recipient')modified[101]^=1;if(change==='amount')modified[207]^=1;if(change==='program')modified[133]=1;if(change==='instruction count')modified[197]=2;if(change==='trailing instruction')modified=Buffer.concat([modified,Buffer.of(0)]);
    await expect(fundSolanaWallet(f.wallet,{...input,transaction:modified.toString('base64')})).rejects.toThrow('reviewed');expect(send).not.toHaveBeenCalled();
  });
  it('rejects stale reviews, wrong owners and excess precision before sending',async()=>{
    const {f,send,input}=depositFixture();await expect(fundSolanaWallet(f.wallet,{...input,expiresAt:new Date(0).toISOString()})).rejects.toThrow('expired');
    await expect(fundSolanaWallet(f.wallet,{...input,from:fixture().account.address})).rejects.toThrow('reviewed');
    expect(()=>validateSolFundingTransaction(input.transaction,input.from,input.to,'0.0000000001')).toThrow('decimal places');expect(send).not.toHaveBeenCalled();
  });
  it('propagates cancellation and uncertain wallet responses without another send attempt',async()=>{
    const {f,send,input}=depositFixture();send.mockRejectedValueOnce(Object.assign(new Error('Cancelled'),{code:4001}));await expect(fundSolanaWallet(f.wallet,input)).rejects.toThrow('Cancelled');expect(send).toHaveBeenCalledTimes(1);
    send.mockResolvedValueOnce([{signature:new Uint8Array(0)}]);await expect(fundSolanaWallet(f.wallet,input)).rejects.toThrow('Activity');expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('MetaMask and Phantom workspace sign-in', () => {
  const address = '0x1111111111111111111111111111111111111111';
  function provider() { return { request: vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x1' : method === 'personal_sign' ? '0xsignature' : [address]) }; }
  it('signs into the existing EVM workspace through the scoped Phantom provider',async()=>{
    const target=browser(),phantom=provider(),binance=provider();target.phantom={ethereum:phantom};target.binancew3w={ethereum:binance};target.ethereum={...binance,isBinance:true};
    vi.mocked(api).mockResolvedValueOnce({message:'Same Wagent workspace'}).mockResolvedValueOnce({ok:true});await signInWithWallet('phantom');
    expect(signedInWalletKind()).toBe('phantom');expect(binance.request).not.toHaveBeenCalled();expect(api).toHaveBeenNthCalledWith(1,'/auth/wallet/challenge',{address,chainId:1});
    expect(phantom.request).toHaveBeenCalledWith({method:'personal_sign',params:['0x'+Buffer.from('Same Wagent workspace').toString('hex'),address]});
  });
  it('does not choose Binance or MetaMask when Phantom is missing',async()=>{
    const target=browser();target.ethereum={...provider(),isMetaMask:true};expect(await findAccountWallet('phantom')).toBeNull();
    await expect(signInWithWallet('phantom')).rejects.toThrow('Phantom');target.ethereum={...provider(),isPhantom:true};expect(await findAccountWallet('phantom')).toBe(target.ethereum);
  });
  it('uses MetaMask and ignores the removed wallet namespace', async () => {
    const target = browser(), binance = provider(), metamask = provider(); target.binancew3w = { ethereum: binance }; target.ethereum = { ...metamask, isMetaMask: true };
    vi.mocked(api).mockResolvedValueOnce({ message: 'Sign in to Wagent Ai' }).mockResolvedValueOnce({ ok: true });
    await signInWithWallet('metamask'); expect(binance.request).not.toHaveBeenCalled(); expect(signedInWalletKind()).toBe('metamask');
    expect(metamask.request).toHaveBeenCalledWith({ method: 'personal_sign', params: ['0x'+Buffer.from('Sign in to Wagent Ai').toString('hex'), address] });
    expect(api).toHaveBeenNthCalledWith(1, '/auth/wallet/challenge', { address, chainId: 1 });
    expect(api).toHaveBeenNthCalledWith(2, '/auth/wallet/verify', { signature: '0xsignature' });
  });
  it('rejects unsupported provider requests before wallet interaction or authentication', async () => {
    const target = browser(),binance=provider(),metamask=provider();target.binancew3w={ethereum:binance};target.ethereum={...metamask,isMetaMask:true};
    expect(await findAccountWallet('binance' as any)).toBeNull();await expect(signInWithWallet('binance' as any)).rejects.toThrow('MetaMask or Phantom');expect(binance.request).not.toHaveBeenCalled();expect(metamask.request).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();
  });
  it('ignores obsolete saved wallet preferences and never treats a Binance injector as MetaMask or Phantom',async()=>{const target=browser();sessionStorage.setItem('wagent:account-wallet','binance');expect(signedInWalletKind()).toBe('metamask');target.ethereum={...provider(),isMetaMask:true,isPhantom:true,isBinance:true};expect(await findAccountWallet('metamask')).toBeNull();expect(await findAccountWallet('phantom')).toBeNull();});
  it('keeps MetaMask sign-in available without using the Binance provider', async () => {
    const target = browser(), metamask = { ...provider(), isMetaMask: true }; target.ethereum = metamask; target.binancew3w = { ethereum: provider() };
    vi.mocked(api).mockResolvedValueOnce({ message: 'Existing account' }).mockResolvedValueOnce({ ok: true });
    await signInWithWallet('metamask'); expect(signedInWalletKind()).toBe('metamask'); expect(target.binancew3w.ethereum!.request).not.toHaveBeenCalled();
  });
  it('blocks an EVM account switch during signing before verifying the session', async () => {
    const target = browser(), phantom = provider(); target.phantom = { ethereum: phantom };
    phantom.request.mockImplementation(async ({ method }) => method === 'eth_accounts' ? ['0x2222222222222222222222222222222222222222'] : method === 'eth_chainId' ? '0x1' : method === 'personal_sign' ? '0xsignature' : [address]);
    vi.mocked(api).mockResolvedValueOnce({ message: 'Sign in' });
    await expect(signInWithWallet('phantom')).rejects.toThrow('account changed'); expect(api).toHaveBeenCalledTimes(1);
    expect(walletError({ code: -32002 })).toContain('Your wallet'); expect(walletError({ code: 4001 })).toContain('cancelled');
  });
});
