import { z } from 'zod';
import { isSolanaAsset } from './solana.js';

export const configSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  market: z.literal('crypto'),
  network: z.literal('solana').default('solana'),
  symbols: z.array(z.string().refine(isSolanaAsset, 'Choose a Solana WGT address or supported Solana asset.')).min(1).max(10).refine(a => new Set(a).size === a.length, 'Tokens must be unique'),
  timeframe: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']),
  strategy: z.enum(['price_alert', 'rsi', 'ma_crossover', 'portfolio_monitor']),
  entry: z.number().positive().max(10000000),
  exit: z.number().positive().max(10000000),
  period: z.number().int().min(2).max(50).default(14),
  fastPeriod: z.number().int().min(2).max(49).default(5),
  slowPeriod: z.number().int().min(3).max(50).default(20),
  positionSize: z.number().min(1).max(10000),
  maxExposure: z.number().min(1).max(100),
  stopLoss: z.number().min(0.1).max(50),
  takeProfit: z.number().min(0.1).max(200),
  cooldownMinutes: z.number().int().min(1).max(10080),
  aiInstructions: z.string().max(1000).default(''),
  notifications: z.array(z.enum(['in_app', 'simulator'])).min(1).default(['in_app']),
}).strict().superRefine((v, ctx) => {
  if(v.strategy === 'ma_crossover' && v.fastPeriod >= v.slowPeriod) ctx.addIssue({ code: 'custom', message: 'Fast period must be smaller than slow period', path: ['fastPeriod'] });
  if(v.strategy === 'rsi' && (v.entry >= v.exit || v.exit > 100)) ctx.addIssue({ code: 'custom', message: 'RSI requires entry < exit ≤ 100', path: ['entry'] });
  if(v.strategy === 'price_alert' && v.entry >= v.exit) ctx.addIssue({ code: 'custom', message: 'Price alert exit must exceed entry', path: ['exit'] });
});
export type AgentConfig = z.infer<typeof configSchema>;
export const defaultConfig: AgentConfig = { schemaVersion: 1, market: 'crypto', network: 'solana', symbols: ['SOL/USD'], timeframe: '1h', strategy: 'rsi', entry: 30, exit: 70, period: 14, fastPeriod: 5, slowPeriod: 20, positionSize: 200, maxExposure: 20, stopLoss: 3, takeProfit: 6, cooldownMinutes: 60, aiInstructions: '', notifications: ['in_app', 'simulator'] };
export const agentInput = z.object({ name: z.string().trim().min(3).max(80), description: z.string().trim().min(20).max(2000), category: z.enum(['Signals', 'Momentum', 'Monitoring', 'Mean reversion']), tags: z.array(z.string().trim().min(1).max(24)).max(6), cover: z.string().max(600).refine(v => ['orbit', 'pulse', 'waves', 'grid', 'candle', 'radar'].includes(v) || /^https:\/\/[^\s]+\.(png|jpe?g|webp)(\?[^\s]*)?$/i.test(v), 'Choose a cover or an HTTPS image URL'), config: configSchema, priceCents: z.number().int().min(100).max(1000000), setupInstructions: z.string().min(10).max(4000) }).strict();
export const strategyLabels: Record<AgentConfig['strategy'], string> = { price_alert: 'Price alert', rsi: 'RSI threshold', ma_crossover: 'MA crossover', portfolio_monitor: 'Portfolio monitor' };
export const costs = 'Bring your own market-data, AI, messaging, and hosting accounts. Their usage fees are separate and are not included in your purchase. Local simulated data and paper execution require no paid provider.';
export const licenseTerms = 'Perpetual, non-transferable personal-use license for this purchased version. Creator retains intellectual property. No resale, redistribution, or ownership transfer. Future versions are not included. Setup support covers this version for 30 days; external services, hosting, AI calls, and messaging are not included.';
