import { Interface } from 'ethers';
import { isEvmAddress } from '../../shared/robinhood.js';

const transfers = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const quantity = (value: unknown) => typeof value === 'string' && /^0x[\da-fA-F]{1,64}$/.test(value) ? BigInt(value) : null;
export type ReceiptDetails = { hash: string; blockNumber: string | null; gasPaidWei: string | null; tokenChangeRaw: string | null };

/** Optional display data only. Never authorizes a send or changes execution status. */
export function receiptDetails(raw: any, hash: string, wallet: string, token: string): ReceiptDetails | null {
  if (!raw || !['0x0', '0x1'].includes(raw.status)) return null;
  if (raw.transactionHash !== undefined && (typeof raw.transactionHash !== 'string' || raw.transactionHash.toLowerCase() !== hash.toLowerCase())) return null;
  const block = quantity(raw.blockNumber), used = quantity(raw.gasUsed), price = quantity(raw.effectiveGasPrice);
  let change = 0n, matched = false;
  if (raw.status === '0x1' && Array.isArray(raw.logs) && raw.logs.length <= 2000) {
    for (const log of raw.logs) {
      if (!log || log.removed || typeof log.address !== 'string' || !isEvmAddress(log.address) || log.address.toLowerCase() !== token.toLowerCase()) continue;
      if (log.transactionHash && (typeof log.transactionHash !== 'string' || log.transactionHash.toLowerCase() !== hash.toLowerCase())) continue;
      try {
        const event = transfers.parseLog(log);
        if (event?.name !== 'Transfer') continue;
        if (event.args.to.toLowerCase() === wallet.toLowerCase()) { change += event.args.value; matched = true; }
        if (event.args.from.toLowerCase() === wallet.toLowerCase()) { change -= event.args.value; matched = true; }
      } catch { /* A malformed or nonstandard event does not become a fabricated fill. */ }
    }
  }
  return { hash: hash.toLowerCase(), blockNumber: block?.toString() ?? null, gasPaidWei: used !== null && price !== null ? (used * price).toString() : null, tokenChangeRaw: matched ? change.toString() : null };
}
