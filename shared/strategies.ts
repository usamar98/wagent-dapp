import type { AgentConfig } from './config.js';

export interface Candle { timestamp: string; close: number }
export interface MarketData { symbol: string; source: string; simulated: boolean; candles: Candle[] }
export type Decision = { action: 'BUY' | 'SELL' | 'HOLD' | 'ALERT'; reason: string; price: number };
export const timeframeMs: Record<AgentConfig['timeframe'], number> = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };
export function rsi(prices: number[], period: number) {
  if(prices.length <= period) throw new Error('Not enough candles for RSI');
  let gain = 0, loss = 0;
  for(let i = 1; i <= period; i++) { const d = prices[i] - prices[i-1]; gain += Math.max(0,d); loss += Math.max(0,-d); }
  gain /= period; loss /= period;
  for(let i = period+1; i < prices.length; i++) { const d = prices[i]-prices[i-1]; gain = (gain*(period-1)+Math.max(0,d))/period; loss = (loss*(period-1)+Math.max(0,-d))/period; }
  return loss === 0 ? gain === 0 ? 50 : 100 : 100-100/(1+gain/loss);
}
function sma(p: number[], n: number) { return p.slice(-n).reduce((a,b)=>a+b,0)/n; }
export function validateMarket(data: MarketData, now: Date, interval = 60000) {
  if(!data.source || !data.candles.length) throw new Error('Missing market data or source');
  const times = data.candles.map(c=>Date.parse(c.timestamp));
  if(data.candles.some(c=>!Number.isFinite(c.close)||c.close<=0) || times.some(t=>!Number.isFinite(t))) throw new Error('Invalid market prices or timestamps');
  if(times.some((t,i)=>i>0 && t<=times[i-1])) throw new Error('Market candles must be strictly chronological');
  const age=now.getTime()-times.at(-1)!;
  if(age>interval*2 || age< -5000) throw new Error('Stale or future market data rejected');
  if(times.some((t,i)=>i>0 && t-times[i-1]>interval*2)) throw new Error('Missing market candles rejected');
}
export function decide(config: AgentConfig, data: MarketData, now = new Date()): Decision {
  if(!config.symbols.includes(data.symbol)) throw new Error('Unexpected market symbol');
  validateMarket(data, now, timeframeMs[config.timeframe]);
  const p=data.candles.map(c=>c.close), price=p.at(-1)!;
  if(config.strategy === 'price_alert') return { action: price<=config.entry ? 'BUY' : price>=config.exit ? 'SELL' : 'HOLD', reason: `Price ${price.toFixed(4)} compared with entry ${config.entry} and exit ${config.exit}`, price };
  if(config.strategy === 'rsi') { const value=rsi(p,config.period); return { action: value<=config.entry?'BUY':value>=config.exit?'SELL':'HOLD', reason: `RSI(${config.period}) ${value.toFixed(2)}; thresholds ${config.entry}/${config.exit}`,price }; }
  if(config.strategy === 'ma_crossover') {
    if(p.length<=config.slowPeriod) throw new Error('Not enough candles for moving averages');
    const fast=sma(p,config.fastPeriod), slow=sma(p,config.slowPeriod), prev=p.slice(0,-1), pf=sma(prev,config.fastPeriod), ps=sma(prev,config.slowPeriod);
    return { action: pf<=ps && fast>slow?'BUY':pf>=ps && fast<slow?'SELL':'HOLD', reason:`SMA(${config.fastPeriod}) ${fast.toFixed(4)} / SMA(${config.slowPeriod}) ${slow.toFixed(4)}`,price };
  }
  return { action:'ALERT',reason:`Portfolio observation: ${data.symbol} ${price.toFixed(4)}. Exposure is checked against the paper ledger.`,price };
}
export function simulatedFeed(symbol: string, now = new Date(), timeframe: AgentConfig['timeframe'] = '1h'): MarketData {
  const step=timeframeMs[timeframe], end=Math.floor(now.getTime()/step)*step;
  const seed=[...symbol].reduce((a,c)=>a+c.charCodeAt(0),0);
  const base=symbol.startsWith('BTC')?65000:symbol.startsWith('ETH')?3200:symbol.includes('EUR')?1.08:symbol.startsWith('SOL')?145:190;
  const candles=Array.from({length:80},(_,i)=>{const n=end/step-79+i; return {timestamp:new Date(end-(79-i)*step).toISOString(), close:Number((base*(1+0.026*Math.sin((n+seed)/7)+0.008*Math.sin((n+seed)/2.3))).toFixed(6))};});
  return {symbol, source:'Wagent Ai deterministic simulated feed v1',simulated:true,candles};
}
export function riskBudget(config: AgentConfig, cashCents: number, positions: { costCents: number }[]) {
  const exposure=positions.reduce((a,p)=>a+p.costCents,0), equity=cashCents+exposure;
  return Math.max(0,Math.min(Math.round(config.positionSize*100),cashCents,Math.floor(equity*config.maxExposure/100)-exposure));
}
