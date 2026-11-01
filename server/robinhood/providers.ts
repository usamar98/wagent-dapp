import { Interface, Wallet, keccak256, getAddress } from 'ethers';
import { z } from 'zod';
import { check, AppError } from '../security.js';
import { env } from '../env.js';
import { ETH_TOKEN, ROBINHOOD_CHAIN_ID, evmAddress, fromWei, weiAmount as parseAmount } from '../../shared/robinhood.js';
export { ETH_TOKEN, ROBINHOOD_CHAIN_ID, evmAddress, fromWei };
export function weiAmount(value:string,decimals=18){try{return parseAmount(value,decimals);}catch(e){throw new AppError(400,e instanceof Error?e.message:'Invalid amount.');}}
export const robinhoodRelease = () => !env.demo && process.env.TRADING_CHAIN !== 'solana';
export const readiness = () => ({ network: 'robinhood', chainId: ROBINHOOD_CHAIN_ID, currency: 'ETH', rpc: !!process.env.ROBINHOOD_RPC_URL, swaps: !!process.env.ROBINHOOD_RPC_URL && !!process.env.ZEROX_API_KEY && process.env.ROBINHOOD_SWAPS_ENABLED !== 'false', source: 'DEX Screener', feeNotice: 'Free API plans have quotas. ETH gas, pool fees and applicable 0x fees are paid by the user. 0x may collect positive trade surplus.' });
export const erc20 = new Interface(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)', 'function transfer(address,uint256) returns(bool)', 'function symbol() view returns(string)', 'function name() view returns(string)', 'function decimals() view returns(uint8)']);
export const holder = '0x0000000000001ff3684f28c67538d4d072c22734';
export const registry = '0x00000000000004533fe15556b1e086bb1a72ceae';
export const holderAbi = new Interface(['function exec(address operator,address token,uint256 amount,address target,bytes data) payable returns(bytes)']);
export const settlerAbi = new Interface(['function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 zid) payable returns(bool)']);
const registryAbi = new Interface(['function ownerOf(uint256) view returns(address)']);
const uint = z.string().regex(/^\d{1,78}$/).refine(v => BigInt(v) < 2n ** 256n);
const address = z.string().regex(/^0x[\da-fA-F]{40}$/).transform(evmAddress);
const insufficientEth = 'Not enough ETH in the paying Robinhood wallet for the amount and gas. Add ETH to that wallet on Robinhood Chain or enter a smaller amount.';
export async function fetchBounded(url: string, init: RequestInit = {}, service = 'Provider') {
  try {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw Error('Unavailable');
    const reader = response.body?.getReader(); if (!reader) throw Error('Missing response');
    const chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 2_000_000) throw Error('Oversized response'); chunks.push(value); } } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new AppError(502, `${service} is unavailable or returned an unsupported response. No completed transaction can be assumed.`); }
}
async function rawRpc(method: string, params: unknown[]) {
  const endpoint = process.env.ROBINHOOD_RPC_URL;
  check(endpoint, 503, 'Robinhood setup required: add ROBINHOOD_RPC_URL from your free Alchemy Robinhood mainnet application.');
  let parsed:URL;try{parsed=new URL(endpoint);}catch{throw new AppError(503,'Configure a valid HTTPS Robinhood RPC endpoint.');}check(parsed.protocol === 'https:' && !parsed.username && !parsed.password, 503, 'Configure an HTTPS Robinhood RPC endpoint.');
  const raw = await fetchBounded(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, 'Robinhood RPC');
  if (['eth_estimateGas','eth_call'].includes(method) && /insufficient funds for gas(?:\s|\*|$)|insufficient funds for transfer|^insufficient funds$/i.test(String(raw?.error?.message || ''))) throw new AppError(400, insufficientEth);
  check(raw && !raw.error && Object.hasOwn(raw, 'result'), 502, `Robinhood RPC could not complete ${method}. No transaction was retried.`); return raw.result;
}
export async function rpc(method: string, params: unknown[] = []): Promise<any> {
  if (method !== 'eth_chainId') check(BigInt(await rawRpc('eth_chainId', [])) === BigInt(ROBINHOOD_CHAIN_ID), 503, 'RPC network mismatch. Robinhood mainnet chain ID 4663 is required.');
  return rawRpc(method, params);
}
export const hex = (n: bigint | number) => '0x' + BigInt(n).toString(16);
export async function tokenCall(token: string, method: string, args: unknown[] = []) { const data = await rpc('eth_call', [{ to: evmAddress(token), data: erc20.encodeFunctionData(method, args) }, 'latest']); return erc20.decodeFunctionResult(method, data)[0]; }
const metadataCache=new Map<string,{at:number;value:{address:string;name:string;symbol:string;decimals:number}}>();
export async function tokenInfo(token: string) {
  token = evmAddress(token); if (token === ETH_TOKEN) return { address: token, name: 'Ether', symbol: 'ETH', decimals: 18 };
  const cached=metadataCache.get(token);if(cached&&Date.now()-cached.at<300000)return cached.value;
  const decimals = Number(await tokenCall(token, 'decimals')); check(Number.isInteger(decimals) && decimals >= 0 && decimals <= 36, 400, 'Unsupported ERC-20 precision.');
  const [symbol, name] = await Promise.all([tokenCall(token, 'symbol').catch(() => 'Token'), tokenCall(token, 'name').catch(() => 'Unknown token')]);
  const clean = (v: unknown, n: number) => String(v).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, n);
  const value={ address: token, decimals, symbol: clean(symbol, 40), name: clean(name, 160) };if(metadataCache.size>=200)metadataCache.delete(metadataCache.keys().next().value!);metadataCache.set(token,{at:Date.now(),value});return value;
}
export function rpcQuantity(value:unknown){check(typeof value==='string'&&/^0x[\da-fA-F]{1,64}$/.test(value),502,'RPC returned an unsupported quantity. No zero balance is assumed.');return BigInt(value);}
export async function assetBalance(wallet: string, token = ETH_TOKEN) { return token === ETH_TOKEN ? rpcQuantity(await rpc('eth_getBalance', [evmAddress(wallet), 'latest'])) : BigInt(await tokenCall(token, 'balanceOf', [evmAddress(wallet)])); }
export type RhTransaction = { to: string; data: string; value: string; gasLimit?: string; gasPrice?: string; chainId: number };
export type RhQuote = { side: 'BUY' | 'SELL'; token: string; symbol: string; decimals: number; amount: string; sellToken: string; buyToken: string; sellAmount: string; buyAmount: string; minBuyAmount: string; slippageBps: number; providerFee: { amount: string; token: string } | null; feeNotice: string; expiresAt: string; transaction: RhTransaction; settler: string; approval: { token: string; amount: string } | null };
export async function latestSettler() {
  const data = await rpc('eth_call', [{ to: registry, data: registryAbi.encodeFunctionData('ownerOf', [2]) }, 'latest']);
  const settled = evmAddress(registryAbi.decodeFunctionResult('ownerOf', data)[0]);
  check(settled !== '0x' + '0'.repeat(40), 503, '0x settlement is paused.'); return settled;
}
// Bind the on-chain minimum, recipient and input authority, not just JSON quote labels.
// Interfaces and registry: https://github.com/0xProject/0x-settler .
export function validateSwapData(q: Pick<RhQuote, 'transaction' | 'sellToken' | 'buyToken' | 'sellAmount' | 'minBuyAmount' | 'settler'>, taker: string) {
  const tx = q.transaction; check(tx.chainId === ROBINHOOD_CHAIN_ID && BigInt(tx.value) === (q.sellToken === ETH_TOKEN ? BigInt(q.sellAmount) : 0n), 400, 'Swap value or network does not match the reviewed trade.');
  let data = tx.data;
  if (evmAddress(tx.to) === holder) {
    let args; try { args = holderAbi.decodeFunctionData('exec', data); } catch { throw new AppError(400, 'Unsupported 0x allowance-holder transaction.'); }
    check(evmAddress(args.operator) === q.settler && evmAddress(args.target) === q.settler, 400, 'Swap operator is not the current verified 0x Settler.');
    check(q.sellToken === ETH_TOKEN ? [ETH_TOKEN, '0x' + '0'.repeat(40)].includes(evmAddress(args.token)) && [0n, BigInt(q.sellAmount)].includes(BigInt(args.amount)) : evmAddress(args.token) === q.sellToken && BigInt(args.amount) === BigInt(q.sellAmount), 400, 'Swap input authorization does not match.');
    check(holderAbi.encodeFunctionData('exec', [...args]).toLowerCase() === data.toLowerCase(), 400, 'Noncanonical swap envelope.'); data = args.data;
  } else check(evmAddress(tx.to) === q.settler && q.sellToken === ETH_TOKEN, 400, 'Unsupported swap entry point.');
  let decoded; try { decoded = settlerAbi.decodeFunctionData('execute', data); } catch { throw new AppError(400, 'Unsupported swap route. The reviewed output cannot be verified.'); }
  check(settlerAbi.encodeFunctionData('execute', [...decoded]).toLowerCase() === data.toLowerCase(), 400, 'Noncanonical swap execution.');
  check(evmAddress(decoded.slippage.recipient) === evmAddress(taker) && evmAddress(decoded.slippage.buyToken) === q.buyToken && BigInt(decoded.slippage.minAmountOut) >= BigInt(q.minBuyAmount), 400, 'On-chain route does not protect the reviewed recipient, asset and minimum output.');
}
export async function quoteSwap(taker: string, side: 'BUY' | 'SELL', token: string, amount: string, slippageBps: number): Promise<RhQuote> {
  check(readiness().swaps, 503, 'Swap setup required: add free-plan ROBINHOOD_RPC_URL and ZEROX_API_KEY in Vercel. No paid subscription is enabled by this app.');
  taker = evmAddress(taker); token = evmAddress(token); check(token !== ETH_TOKEN && token !== '0x' + '0'.repeat(40), 400, 'Choose an ERC-20 token to buy or sell.');
  check(Number.isInteger(slippageBps) && slippageBps >= 1 && slippageBps <= 200, 400, 'Slippage must be between 0.01% and 2%.');
  const info = await tokenInfo(token), sellToken = side === 'BUY' ? ETH_TOKEN : token, buyToken = side === 'BUY' ? token : ETH_TOKEN;
  const sellAmount = weiAmount(amount, side === 'BUY' ? 18 : info.decimals).toString();
  const params = new URLSearchParams({ chainId: String(ROBINHOOD_CHAIN_ID), sellToken, buyToken, sellAmount, taker, recipient: taker, slippageBps: String(slippageBps) });
  const raw = await fetchBounded('https://api.0x.org/swap/allowance-holder/quote?' + params, { headers: { '0x-api-key': process.env.ZEROX_API_KEY!, '0x-version': 'v2', Accept: 'application/json' } }, '0x');
  const parsed = z.object({ liquidityAvailable: z.literal(true), sellToken: address, buyToken: address, sellAmount: uint, buyAmount: uint, minBuyAmount: uint, transaction: z.object({ to: address, data: z.string().regex(/^0x[\da-fA-F]+$/).max(150000), value: uint }), issues: z.object({ allowance: z.object({ spender: address }).nullable().optional(), simulationIncomplete: z.boolean().optional() }).passthrough().optional(), fees: z.object({ zeroExFee: z.object({ amount: uint, token: address }).nullable().optional(), integratorFee: z.object({ amount: uint }).nullable().optional() }).passthrough().optional() }).safeParse(raw);
  check(parsed.success, 400, '0x cannot prepare this trade. Check liquidity, token support and the paying wallet balance.'); const r = parsed.data;
  check(r.sellToken === sellToken && r.buyToken === buyToken && r.sellAmount === sellAmount && BigInt(r.buyAmount) > 0n && BigInt(r.minBuyAmount) > 0n && BigInt(r.minBuyAmount) <= BigInt(r.buyAmount) && BigInt(r.minBuyAmount) >= BigInt(r.buyAmount) * BigInt(10000 - slippageBps) / 10000n, 400, '0x quote differs from the requested amount or slippage.');
  check(!r.issues?.allowance || r.issues.allowance.spender === holder, 400, 'Unsupported token allowance target.');
  check(!r.fees?.integratorFee || BigInt(r.fees.integratorFee.amount) === 0n, 400, 'Unapproved integration fee.');
  const fee = r.fees?.zeroExFee || null;
  if (fee) { check([sellToken, buyToken].includes(fee.token), 400, 'Unsupported provider fee asset.'); check(BigInt(fee.amount) <= BigInt(fee.token === sellToken ? sellAmount : r.buyAmount) / 100n, 400, '0x fee exceeds the 1% provider fee ceiling.'); }
  const settler = await latestSettler(), approval = side === 'SELL' && BigInt(await tokenCall(token, 'allowance', [taker, holder])) < BigInt(sellAmount) ? { token, amount: sellAmount } : null;
  const q: RhQuote = { side, token, symbol: info.symbol, decimals: info.decimals, amount, sellToken, buyToken, sellAmount, buyAmount: r.buyAmount, minBuyAmount: r.minBuyAmount, slippageBps, providerFee: fee, feeNotice: readiness().feeNotice, expiresAt: new Date(Date.now() + 45000).toISOString(), transaction: { ...r.transaction, chainId: ROBINHOOD_CHAIN_ID }, settler, approval };
  validateSwapData(q, taker); return q;
}
export async function prepareTransaction(from: string, tx: RhTransaction, maxFee: bigint, simulate = true): Promise<RhTransaction> {
  check(tx.chainId === ROBINHOOD_CHAIN_ID, 400, 'Wrong transaction network.');
  const request = { from: evmAddress(from), to: evmAddress(tx.to), data: tx.data, value: hex(BigInt(tx.value)) };
  const balance = await assetBalance(from);
  check(balance > BigInt(tx.value), 400, insufficientEth);
  const gasPrice = BigInt(await rpc('eth_gasPrice')) * 125n / 100n, gasLimit = BigInt(await rpc('eth_estimateGas', [request])) * 125n / 100n;
  check(gasLimit > 0n && gasLimit < 10_000_000n && gasPrice > 0n && gasLimit * gasPrice <= maxFee, 400, 'Estimated gas exceeds the approved fee cap.');
  check(balance >= BigInt(tx.value) + gasLimit * gasPrice, 400, insufficientEth);
  if (simulate) {const result=await rpc('eth_call', [{ ...request, gas: hex(gasLimit), gasPrice: hex(gasPrice) }, 'pending']);for(const method of ['approve','transfer'])if(tx.data.startsWith(erc20.getFunction(method)!.selector)&&result!=='0x'){let ok=false;try{ok=erc20.decodeFunctionResult(method,result)[0]===true;}catch{/* Unknown token return data fails closed. */}check(ok,400,'Token simulation did not confirm a successful '+method+'.');}}
  return { ...tx, gasLimit: gasLimit.toString(), gasPrice: gasPrice.toString() };
}
export function transactionHash(tx: RhTransaction) { return keccak256(Buffer.from(JSON.stringify(tx))); }
export function signEvmTransaction(key: string, tx: RhTransaction, nonce: number) { return new Wallet(key).signTransaction({ chainId: ROBINHOOD_CHAIN_ID, to: getAddress(tx.to), data: tx.data, value: BigInt(tx.value), gasLimit: BigInt(tx.gasLimit!), gasPrice: BigInt(tx.gasPrice!), nonce, type: 0 }); }
