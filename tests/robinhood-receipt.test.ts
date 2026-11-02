import { describe, expect, it } from 'vitest';
import { Interface } from 'ethers';
import { receiptDetails } from '../server/robinhood/receipt.js';

const wallet='0x'+'11'.repeat(20),token='0x'+'22'.repeat(20),other='0x'+'33'.repeat(20),hash='0x'+'44'.repeat(32);
const abi=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
function log(from=other,to=wallet,amount=1000000n){const encoded=abi.encodeEventLog('Transfer',[from,to,amount]);return {address:token,topics:encoded.topics,data:encoded.data,transactionHash:hash};}
const receipt=(logs:unknown[]=[])=>({status:'0x1',transactionHash:hash,blockNumber:'0x10',gasUsed:'0x5208',effectiveGasPrice:'0x3b9aca00',logs});
describe('Robinhood receipt display data',()=>{
  it('reads exact gas and net token transfers from the matching receipt',()=>{const value=receiptDetails(receipt([log(),log(wallet,other,1000n),log(wallet,wallet,17n)]),hash,wallet,token);expect(value).toEqual({hash,blockNumber:'16',gasPaidWei:'21000000000000',tokenChangeRaw:'999000'});});
  it('keeps sale quantities negative and uses integer arithmetic for large amounts',()=>{const amount=2n**200n,value=receiptDetails(receipt([log(wallet,other,amount)]),hash,wallet,token);expect(value?.tokenChangeRaw).toBe('-'+amount.toString());});
  it('ignores other contracts, other wallets, removed events and unrelated transaction hashes',()=>{const value=receiptDetails(receipt([{...log(),address:other},log(other,other),{...log(),removed:true},{...log(),transactionHash:'0x'+'55'.repeat(32)}, {address:token,topics:[],data:'0x'}]),hash,wallet,token);expect(value?.tokenChangeRaw).toBeNull();});
  it('does not fabricate a zero fill or gas when events or quantities are missing',()=>{const value=receiptDetails({...receipt(),gasUsed:undefined,effectiveGasPrice:'broken'},hash,wallet,token);expect(value?.tokenChangeRaw).toBeNull();expect(value?.gasPaidWei).toBeNull();expect(receiptDetails(receipt([log(other,wallet,0n)]),hash,wallet,token)?.tokenChangeRaw).toBe('0');});
  it('never reports token transfers from a reverted transaction',()=>{expect(receiptDetails({...receipt([log()]),status:'0x0'},hash,wallet,token)?.tokenChangeRaw).toBeNull();});
  it.each([null,{}, {status:'0x1',transactionHash:123}, {...receipt(),transactionHash:'0x'+'66'.repeat(32)}])('rejects unsupported or mismatched receipts: %j',raw=>{expect(receiptDetails(raw,hash,wallet,token)).toBeNull();});
  it('bounds event parsing and leaves oversized receipts unpriced',()=>{expect(receiptDetails(receipt(Array.from({length:2001},()=>log())),hash,wallet,token)?.tokenChangeRaw).toBeNull();});
});
