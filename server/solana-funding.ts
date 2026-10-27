import { Router } from 'express';
import { z } from 'zod';
import { transaction } from './db.js';
import { auth, check } from './security.js';
import { permissionSession } from './solana-permissions.js';
import { addressSchema, atomicAmount, humanAmount, rpc } from './solana-providers.js';
import { solTransferWire } from './solana-withdrawals.js';
import { decodeSwapTransaction } from './solana-swaps.js';

// This endpoint only prepares a transfer. The owner's wallet signs and broadcasts it.
export const solanaFundingRouter = Router();
solanaFundingRouter.use(auth);
solanaFundingRouter.post('/funding/prepare', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { amount } = z.object({ amount: z.string().max(32) }).strict().parse(req.body);
  const lamports = atomicAmount(amount, 9);
  const context = await transaction(async tx => {
    const userId = await permissionSession(tx, req);
    const [wallet, owner] = await Promise.all([tx.solanaTradingWallet.findUnique({ where: { userId } }), tx.solanaWallet.findUnique({ where: { userId } })]);
    check(wallet, 409, 'Create your trading wallet first.');
    check(owner?.address === wallet.ownerAddress, 409, 'Connect the original Solana owner wallet before adding SOL.');
    return { from: wallet.ownerAddress, to: wallet.address };
  });
  const [block, balance] = await Promise.all([
    rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]),
    rpc('getBalance', [context.from, { commitment: 'confirmed' }]),
  ]);
  check(addressSchema.safeParse(block?.value?.blockhash).success && Number.isSafeInteger(block.value.lastValidBlockHeight), 502, 'A fresh blockhash is unavailable. Try again.');
  check(Number.isSafeInteger(balance?.value) && balance.value >= 0, 502, 'Your owner-wallet balance is unavailable.');
  const transactionWire = solTransferWire(context.from, context.to, lamports, block.value.blockhash);
  const decoded = decodeSwapTransaction(transactionWire, context.from);
  const fee = await rpc('getFeeForMessage', [Buffer.from(decoded.messageBytes).toString('base64'), { commitment: 'confirmed' }]);
  check(Number.isSafeInteger(fee?.value) && fee.value >= 0 && fee.value <= 10000000, 502, 'A reliable network fee estimate is unavailable.');
  check(BigInt(balance.value) >= BigInt(lamports) + BigInt(fee.value), 400, 'Not enough SOL in your connected wallet for this amount and the network fee. Add SOL to that wallet or enter a smaller amount.');
  const simulation = await rpc('simulateTransaction', [transactionWire, { encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false }]);
  check(simulation?.value?.err === null, 400, 'The deposit could not be simulated. Check your SOL balance and the minimum needed to fund a new Solana account.');
  res.json({ ...context, amount: humanAmount(lamports, 9), lamports, feeSol: humanAmount(String(fee.value), 9), ownerBalanceSol: humanAmount(String(balance.value), 9), transaction: transactionWire, expiresAt: new Date(Date.now() + 60000).toISOString() });
});
