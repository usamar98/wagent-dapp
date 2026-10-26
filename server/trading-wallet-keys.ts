import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign } from 'node:crypto';
import bs58 from 'bs58';
import { getTransactionEncoder } from '@solana/transactions';
import { env } from './env.js';
import { check } from './security.js';
import { decodeSwapTransaction } from './solana-swaps.js';

function privateKey(seed: Buffer) {
  check(seed.length === 32, 503, 'Trading wallet key is unavailable.');
  return createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' });
}
function publicBytes(seed: Buffer) { return createPublicKey(privateKey(seed)).export({ format: 'der', type: 'spki' }).subarray(-32); }
function encryptionKey(userId: string) { return Buffer.from(hkdfSync('sha256', Buffer.from(env.encryptionKey, 'hex'), Buffer.from(userId), Buffer.from('wagent-trading-wallet-v1'), 32)); }
export function createTradingKey(userId: string) {
  const seed = randomBytes(32);
  try {
    const address = bs58.encode(publicBytes(seed)), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(userId), iv);
    cipher.setAAD(Buffer.from(`${userId}:${address}`));
    const encrypted = Buffer.concat([cipher.update(seed), cipher.final()]);
    return { address, encryptedSecret: ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join('.') };
  } finally { seed.fill(0); }
}
function open(userId: string, address: string, encryptedSecret: string) {
  try {
    const [version, iv, tag, data] = encryptedSecret.split('.');
    check(version === 'v1' && /^[a-f0-9]{24}$/.test(iv) && /^[a-f0-9]{32}$/.test(tag) && /^[a-f0-9]{64}$/.test(data), 503, 'Trading wallet key is unavailable.');
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey(userId), Buffer.from(iv, 'hex')); cipher.setAAD(Buffer.from(`${userId}:${address}`)); cipher.setAuthTag(Buffer.from(tag, 'hex'));
    const seed = Buffer.concat([cipher.update(Buffer.from(data, 'hex')), cipher.final()]);
    check(bs58.encode(publicBytes(seed)) === address, 503, 'Trading wallet key does not match its address.'); return seed;
  } catch { throw new Error('Trading wallet key could not be opened. Check the original encryption key.'); }
}
export function signTradingTransaction(wallet: { userId: string; address: string; encryptedSecret: string }, transaction: string) {
  const tx = decodeSwapTransaction(transaction, wallet.address), seed = open(wallet.userId, wallet.address, wallet.encryptedSecret);
  try {
    check(Object.keys(tx.signatures).length === 1, 400, 'Chat trading requires a single wallet signer.');
    const signature = sign(null, Buffer.from(tx.messageBytes), privateKey(seed));
    const signed = { ...tx, signatures: { ...tx.signatures, [wallet.address]: signature } };
    return { signedTransaction: Buffer.from(getTransactionEncoder().encode(signed as typeof tx)).toString('base64'), signature: bs58.encode(signature) };
  } finally { seed.fill(0); }
}
