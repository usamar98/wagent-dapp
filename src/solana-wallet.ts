import { getWallets } from '@wallet-standard/app';
import bs58 from 'bs58';
import { api } from './api';

const MAINNET = 'solana:mainnet';
export type WalletPurpose = 'permissions' | 'transactions';
export type WalletAccount = { address: string; chains: readonly string[]; publicKey: Uint8Array; features: readonly string[] };
export type SolanaWallet = {
  name: string;
  chains: readonly string[];
  accounts: readonly WalletAccount[];
  features: {
    'standard:connect'?: { connect(): Promise<{ accounts: readonly WalletAccount[] }> };
    'standard:events'?: { on(event: 'change', listener: () => void): () => void };
    'solana:signMessage'?: { signMessage(input: { account: WalletAccount; message: Uint8Array }): Promise<readonly { signature: Uint8Array; signedMessage: Uint8Array }[]> };
    'solana:signTransaction'?: { signTransaction(input: { account: WalletAccount; chain: string; transaction: Uint8Array }): Promise<readonly { signedTransaction: Uint8Array }[]> };
  };
};

export const isBinanceWallet = (wallet: Pick<SolanaWallet, 'name'>) => /^binance(?:\s+web3)?\s+wallet$/i.test(wallet.name.trim());
export const walletLabel = (wallet: Pick<SolanaWallet, 'name'>) => isBinanceWallet(wallet) ? 'Binance Wallet' : wallet.name;

// Binance's official Solana integration uses Wallet Standard, not its EVM provider.
export function availableWallets(purpose: WalletPurpose = 'permissions'): SolanaWallet[] {
  return (getWallets().get() as unknown as SolanaWallet[]).filter(wallet =>
    wallet.chains.includes(MAINNET) && typeof wallet.features['standard:connect']?.connect === 'function' &&
    typeof wallet.features['solana:signMessage']?.signMessage === 'function' &&
    (purpose === 'permissions' || typeof wallet.features['solana:signTransaction']?.signTransaction === 'function')
  ).sort((a, b) => Number(isBinanceWallet(b)) - Number(isBinanceWallet(a)) || a.name.localeCompare(b.name));
}

export function observeWallets(update: () => void) {
  const registry = getWallets(), subscriptions = new Map<SolanaWallet, () => void>();
  const synchronize = () => {
    const wallets = registry.get() as unknown as SolanaWallet[];
    for (const [wallet, off] of subscriptions) if (!wallets.includes(wallet)) { off(); subscriptions.delete(wallet); }
    for (const wallet of wallets) {
      const events = wallet.features['standard:events'];
      if (events && !subscriptions.has(wallet)) subscriptions.set(wallet, events.on('change', update));
    }
    update();
  };
  const registered = registry.on('register', synchronize), unregistered = registry.on('unregister', synchronize);
  synchronize();
  return () => { registered(); unregistered(); for (const off of subscriptions.values()) off(); subscriptions.clear(); };
}

function toBase64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function sameBytes(a: Uint8Array, b: Uint8Array) { return a.length === b.length && a.every((value, i) => value === b[i]); }
function validAccount(account: WalletAccount, feature: string) {
  return account.chains.includes(MAINNET) && account.features.includes(feature) &&
    account.publicKey instanceof Uint8Array && account.publicKey.length === 32 && bs58.encode(account.publicKey) === account.address;
}
async function connectAccount(wallet: SolanaWallet, feature: string, address?: string) {
  const connect = wallet.features['standard:connect'];
  if (!connect) throw new Error('This wallet cannot connect. Reopen the website in your Solana wallet browser.');
  const result = await connect.connect();
  const account = result.accounts.find(a => (!address || a.address === address) && validAccount(a, feature));
  if (!account) throw new Error(address ? 'Select the original owner Solana account in your wallet, with mainnet signing enabled.' : 'Choose a Solana mainnet account that supports message signing in your wallet.');
  return account;
}
function assertCurrentAccount(wallet: SolanaWallet, account: WalletAccount, feature: string) {
  if (!wallet.accounts.some(a => a.address === account.address && validAccount(a, feature))) {
    throw new Error('The wallet account changed or disconnected. Reconnect the original owner wallet and review again.');
  }
}
async function signExactMessage(wallet: SolanaWallet, account: WalletAccount, message: string) {
  const feature = wallet.features['solana:signMessage'];
  if (!feature) throw new Error('This wallet cannot sign Solana permissions. Update Binance Wallet, Phantom, or Solflare.');
  const bytes = new TextEncoder().encode(message);
  const results = await feature.signMessage({ account, message: bytes.slice() });
  const signed = results[0];
  assertCurrentAccount(wallet, account, 'solana:signMessage');
  if (results.length !== 1 || !(signed?.signature instanceof Uint8Array) || signed.signature.length !== 64 ||
      !(signed.signedMessage instanceof Uint8Array) || !sameBytes(signed.signedMessage, bytes)) {
    throw new Error('The wallet did not sign the exact reviewed message. Nothing was authorized.');
  }
  const publicKey = await crypto.subtle.importKey('raw', Uint8Array.from(account.publicKey), { name: 'Ed25519' }, false, ['verify']);
  if (!await crypto.subtle.verify('Ed25519', publicKey, Uint8Array.from(signed.signature), bytes)) {
    throw new Error('The signature does not match the original owner wallet. Nothing was authorized.');
  }
  return toBase64(signed.signature);
}

export async function signWalletMessage(wallet: SolanaWallet, address: string, message: string) {
  const account = await connectAccount(wallet, 'solana:signMessage', address);
  return signExactMessage(wallet, account, message);
}
export async function linkWallet(wallet: SolanaWallet) {
  const account = await connectAccount(wallet, 'solana:signMessage');
  const proof = await api<{ id: string; message: string }>('/solana/wallet/challenge', { address: account.address });
  assertCurrentAccount(wallet, account, 'solana:signMessage');
  const signature = await signExactMessage(wallet, account, proof.message);
  await api('/solana/wallet/verify', { id: proof.id, signature });
  return account;
}
export async function signSwap(wallet: SolanaWallet, address: string, transaction: string) {
  const feature = wallet.features['solana:signTransaction'];
  if (!feature) throw new Error('This wallet does not support signing swaps. Use a compatible Solana wallet.');
  const account = await connectAccount(wallet, 'solana:signTransaction', address);
  const results = await feature.signTransaction({ account, chain: MAINNET, transaction: Uint8Array.from(atob(transaction), c => c.charCodeAt(0)) });
  assertCurrentAccount(wallet, account, 'solana:signTransaction');
  if (results.length !== 1 || !(results[0]?.signedTransaction instanceof Uint8Array) || !results[0].signedTransaction.length) throw new Error('The wallet did not return a signed transaction.');
  return toBase64(results[0].signedTransaction);
}
