import { describe, expect, it, vi } from 'vitest';
import { discoverRhTokens, normalizeRhPairs, RH_DISCOVERY_LIMIT } from '../server/robinhood/discovery.js';

const address = (value: number) => '0x' + value.toString(16).padStart(40, '0');
const quote = address(9999);
const pair = (value: number, extra: Record<string, unknown> = {}) => ({ chainId: 'robinhood', pairAddress: address(10000 + value), baseToken: { address: address(value), name: 'Token ' + value, symbol: 'T' + value }, quoteToken: { address: quote, name: 'Quote asset', symbol: 'QTE' }, priceUsd: '2', liquidity: { usd: value * 100 }, volume: { h24: 150 }, priceChange: { h24: 5 }, pairCreatedAt: Date.now() - 10000, ...extra });

describe('Robinhood market normalization', () => {
  it('deduplicates addresses and chooses the most liquid base-token pool', () => {
    const result = normalizeRhPairs([pair(1), pair(1, { pairAddress: address(20000), liquidity: { usd: 9000 } }), pair(2, { chainId: 'ethereum' }), pair(3, { pairAddress: 'invalid' })]);
    expect(result.filter(t => t.address === address(1))).toHaveLength(1);
    expect(result.find(t => t.address === address(1))?.liquidityUsd).toBe(9000);
    expect(result.some(t => t.address === address(2) || t.address === address(3))).toBe(false);
  });
  it('includes quote-side tokens without assigning the base token price or change', () => {
    const result = normalizeRhPairs([pair(1)], [quote]);
    expect(result).toEqual([expect.objectContaining({ address: quote, symbol: 'QTE', priceUsd: null, change24h: null, liquidityUsd: 100 })]);
    expect(normalizeRhPairs([pair(1)], [])).toEqual([]);
  });
  it('prefers an actual base-token price over a larger quote-side pool', () => {
    const result = normalizeRhPairs([pair(1, { liquidity: { usd: 999999 } }), pair(9999, { priceUsd: '1' })]);
    expect(result.find(t => t.address === quote)?.priceUsd).toBe(1);
  });
  it('keeps absent prices and pool dates unavailable and bounds untrusted labels', () => {
    const result = normalizeRhPairs([pair(1, { priceUsd: '', pairCreatedAt: Date.now() + 86400000, baseToken: { address: address(1), symbol: 'X'.repeat(10000), name: '<script>\u202etest</script>' } })]);
    expect(result[0].priceUsd).toBeNull(); expect(result[0].pairCreatedAt).toBeNull();
    expect(result[0].symbol).toHaveLength(40); expect(result[0].name).not.toContain('\u202e');
    expect(normalizeRhPairs([pair(0)])).not.toEqual(expect.arrayContaining([expect.objectContaining({ address: address(0) })]));
  });
});

describe('Expanded public Robinhood discovery', () => {
  it('combines feeds beyond the old 30-profile and 60-result limits in batches of 30', async () => {
    const ids = Array.from({ length: 105 }, (_, i) => i + 1);
    let concurrent = 0, peak = 0;
    const get = vi.fn(async (path: string) => {
      concurrent++; peak = Math.max(peak, concurrent);
      await new Promise(resolve => setTimeout(resolve, 1));
      concurrent--;
      if (path.includes('/latest/dex/search')) return { pairs: [pair(106), pair(1000, { chainId: 'solana' })] };
      if (path.includes('/token-pairs/')) return [pair(107)];
      if (path.includes('/tokens/v1/')) {
        const batch = path.split('/').at(-1)!.split(','); expect(batch.length).toBeLessThanOrEqual(30);
        return batch.map(value => pair(Number(BigInt(value))));
      }
      if (path === '/token-profiles/latest/v1') return ids.slice(0, 30).map(id => ({ chainId: 'robinhood', tokenAddress: address(id) }));
      if (path === '/token-profiles/recent-updates/v1') return ids.slice(30, 60).map(id => ({ chainId: 'robinhood', tokenAddress: address(id) }));
      if (path === '/token-boosts/latest/v1') return ids.slice(60).map(id => ({ chainId: 'robinhood', tokenAddress: address(id) }));
      return [];
    });
    const result = await discoverRhTokens(get);
    expect(result.tokens.length).toBeGreaterThan(105);
    expect(new Set(result.tokens.map(t => t.address)).size).toBe(result.tokens.length);
    expect(result.tokens.some(t => t.address === address(107))).toBe(true);
    expect(result.tokens.some(t => t.address === address(1000))).toBe(false);
    expect(result.discovery.partial).toBe(false); expect(peak).toBeLessThanOrEqual(4);
  });
  it('preserves useful results when one public feed fails and reports partial coverage', async () => {
    const result = await discoverRhTokens(async path => {
      if (path.includes('token-boosts/latest')) throw Error('Provider quota');
      if (path.includes('/latest/dex/search')) return { pairs: [pair(1)] };
      return path.includes('/token-pairs/') || path.includes('/tokens/v1/') ? [pair(1)] : [];
    });
    expect(result.tokens.some(t => t.address === address(1))).toBe(true);
    expect(result.discovery.partial).toBe(true); expect(result.discovery.available).toBeLessThan(result.discovery.checked);
  });
  it('requeries earlier observations instead of reusing their old market prices', async () => {
    const calls: string[] = [];
    const result = await discoverRhTokens(async path => {
      calls.push(path);
      if (path.includes('/latest/dex/search')) return { pairs: [] };
      if (path.includes('/tokens/v1/')) return [pair(77, { priceUsd: '9' })];
      return [];
    }, [address(77)]);
    expect(result.tokens.find(t => t.address === address(77))?.priceUsd).toBe(9);
    expect(calls.some(path => path.endsWith(address(77)))).toBe(true);
  });
  it('bounds scans and marks truncation, instead of issuing unbounded upstream calls', async () => {
    const get = vi.fn(async (path: string) => path.includes('/latest/dex/search') ? { pairs: [] } : []);
    const result = await discoverRhTokens(get, Array.from({ length: 1000 }, (_, i) => address(i + 1)));
    expect(result.discovery.candidates).toBe(RH_DISCOVERY_LIMIT); expect(result.discovery.partial).toBe(true);
    expect(get.mock.calls.filter(([path]) => path.includes('/tokens/v1/'))).toHaveLength(20);
  });
  it('searches both the requested text and a chain-focused variant', async () => {
    const get = vi.fn(async (path: string) => path.includes('/latest/dex/search') ? { pairs: [pair(1), pair(2, { chainId: 'base' })] } : [pair(1)]);
    const result = await discoverRhTokens(get, [], 'HELLO');
    expect(get.mock.calls.map(([path]) => path)).toContain('/latest/dex/search?q=robinhood%20HELLO');
    expect(result.tokens.some(t => t.address === address(2))).toBe(false);
    expect(get.mock.calls.some(([path]) => path.includes('token-profiles'))).toBe(false);
  });
  it('fails clearly when every source is unavailable', async () => {
    await expect(discoverRhTokens(async () => { throw Error('Offline'); })).rejects.toThrow('temporarily unavailable');
  });
  it('does not report an empty fresh market when only profile endpoints responded', async () => {
    await expect(discoverRhTokens(async path => {
      if (path.includes('/latest/dex/search')) throw Error('Search unavailable');
      return [];
    })).rejects.toThrow('temporarily unavailable');
  });
});
