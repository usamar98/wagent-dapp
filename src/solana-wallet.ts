import { getWallets } from '@wallet-standard/app';
import { api } from './api';

export type WalletAccount = { address: string; chains: readonly string[]; publicKey: Uint8Array };
export type SolanaWallet = { name: string; accounts: readonly WalletAccount[]; features: Record<string, any> };
export function availableWallets(): SolanaWallet[] {
  return getWallets().get().filter(wallet => wallet.chains.includes('solana:mainnet') && wallet.features['standard:connect'] && wallet.features['solana:signMessage'] && wallet.features['solana:signTransaction']) as unknown as SolanaWallet[];
}
export function observeWallets(update: () => void) {
  const registry = getWallets(); const a = registry.on('register', update), b = registry.on('unregister', update);
  return () => { a(); b(); };
}
function toBase64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
export async function signWalletMessage(wallet: SolanaWallet, address: string, message: string) {
  const connection = await wallet.features['standard:connect'].connect();
  const account = (connection.accounts as WalletAccount[]).find(a => a.address === address && a.chains.includes('solana:mainnet'));
  if (!account) throw new Error('Select the original owner Solana account in your wallet.');
  const [signed] = await wallet.features['solana:signMessage'].signMessage({ account, message: new TextEncoder().encode(message) });
  return toBase64(signed.signature);
}
export async function linkWallet(wallet: SolanaWallet) {
  const result = await wallet.features['standard:connect'].connect();
  const account = (result.accounts as WalletAccount[]).find(a => a.chains.includes('solana:mainnet'));
  if (!account) throw new Error('Choose a Solana mainnet account in your wallet.');
  const proof = await api<{ id: string; message: string }>('/solana/wallet/challenge', { address: account.address });
  const [signed] = await wallet.features['solana:signMessage'].signMessage({ account, message: new TextEncoder().encode(proof.message) });
  await api('/solana/wallet/verify', { id: proof.id, signature: toBase64(signed.signature) });
  return account;
}
export async function signSwap(wallet: SolanaWallet, address: string, transaction: string) {
  const connection = await wallet.features['standard:connect'].connect();
  const account = (connection.accounts as WalletAccount[]).find(a => a.address === address && a.chains.includes('solana:mainnet'));
  if (!account) throw new Error('The linked Solana account changed. Reconnect the correct wallet.');
  const [result] = await wallet.features['solana:signTransaction'].signTransaction({ account, chain: 'solana:mainnet', transaction: Uint8Array.from(atob(transaction), c => c.charCodeAt(0)) });
  return toBase64(result.signedTransaction);
}
