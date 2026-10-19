import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db, transaction, lockUser, type Tx } from './db.js';
import { auth, check, AppError } from './security.js';
import { canUseVersion } from './execution.js';
import { configSchema } from '../shared/config.js';
import { parseCommand } from '../shared/commands.js';
import { riskBudget, simulatedFeed } from '../shared/strategies.js';
import { env } from './env.js';

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const help = 'PAPER MODE · Try: Buy $100 of BTC; Sell $25 of BTC; Show portfolio; Status; Start agent; Pause agent; Stop all. Orders create a preview first. Reply CONFIRM followed by its eight-character code within two minutes. Prices and fills are simulated. No real funds move.';

export async function getWorkspace(userId: string) {
  return transaction(async tx => {
  await lockUser(tx,userId);
  await tx.tradeIntent.updateMany({ where: { userId, status: 'PENDING', expiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } });
  const channel = await tx.personalAgentChannel.findUnique({ where: { userId } });
  const broker = await tx.brokerAuthorization.findUnique({ where: { userId } });
  const [workspace, versions, instances, commands, intents, worker] = await Promise.all([
    tx.tradingWorkspace.upsert({ where: { userId }, create: { userId }, update: {} }),
    tx.agentVersion.findMany({ where: { OR: [{ agent: { creatorId: userId } }, { entitlements: { some: { buyerId: userId, status: 'ACTIVE', ...(env.demo ? {} : { environment: { not: 'DEMO' } }) } } }] }, include: { agent: { select: { id: true, name: true, creatorId: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
    tx.instance.findMany({ where: { userId }, include: { positions: true, version: { include: { agent: { select: { name: true } } } } } }),
    tx.agentCommand.findMany({ where: { userId }, select: { id: true, source: true, text: true, reply: true, status: true, intentId: true, deliveryStatus: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 40 }),
    tx.tradeIntent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    tx.setting.findUnique({ where: { key: 'workerHeartbeat' } }),
  ]);
  return {
    workspace, versions, instances, commands: commands.reverse(), intents,
    channel: channel ? { label:channel.label, paired:!!channel.ownerId, enabled:channel.enabled, pairingExpiresAt:channel.pairingExpiresAt, lastPollAt:channel.lastPollAt, lastMessageAt:channel.lastMessageAt, lastError:channel.lastError } : null,
    broker: broker ? {connectedAt:broker.connectedAt,scope:broker.scope} : null, workerOnline: !!worker && Date.now() - Number(worker.value) < 30000,
    coinbaseConfigured: !!process.env.COINBASE_CLIENT_ID && !!process.env.COINBASE_CLIENT_SECRET,
    liveTrading: false,
  };
  });
}

async function activeRuntime(tx: Tx, userId: string) {
  const workspace = await tx.tradingWorkspace.findUnique({ where: { userId } });
  check(workspace?.activeInstanceId, 409, 'Choose one of your agents in the trading desk first.');
  const instance = await tx.instance.findFirst({ where: { id: workspace.activeInstanceId, userId }, include: { positions: true, version: { include: { agent: true } } } });
  check(instance, 404, 'Selected agent runtime is unavailable. Choose your agent again.');
  await canUseVersion(tx, userId, instance.versionId);
  return { workspace, instance, config: configSchema.parse(instance.version.config) };
}

export async function executeCommand(userId: string, text: string, source: 'WEB' | 'WHATSAPP', externalId: string, now = new Date(), channelContext?: { id: string; leaseToken: string; ownerId: string }) {
  return transaction(async tx => {
    await lockUser(tx, userId);
    const user = await tx.user.findUnique({ where: { id: userId } });
    check(user && !user.disabled, 403, 'This account is unavailable.');
    if (source === 'WHATSAPP') {
      check(channelContext, 403, 'A verified personal agent connection is required.');
      const channel = await tx.personalAgentChannel.findFirst({ where: { id: channelContext.id, userId, enabled: true, leaseToken: channelContext.leaseToken, ownerId: channelContext.ownerId } });
      check(channel && channel.leaseUntil && channel.leaseUntil > new Date(), 403, 'This WhatsApp connection was disconnected or changed.');
    }
    const existing = await tx.agentCommand.findUnique({ where: { userId_source_externalId: { userId, source, externalId } } });
    if (existing) return { command: existing, duplicate: true };
    let reply = '', status = 'COMPLETED', intentId: string | undefined;
    try {
      const command = parseCommand(text);
      if (command.kind === 'invalid') throw new AppError(400, command.reason);
      if (command.kind === 'help') reply = help;
      else if (command.kind === 'emergency') {
        await tx.user.update({ where: { id: userId }, data: { emergencyStop: true } });
        await tx.instance.updateMany({ where: { userId }, data: { status: 'STOPPED' } });
        await tx.tradeIntent.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
        reply = 'EMERGENCY STOP · All agents stopped and pending orders cancelled. Clear the stop on the website before starting again.';
      } else {
        const { workspace, instance, config } = await activeRuntime(tx, userId);
        if (command.kind === 'status') reply = `PAPER MODE · ${instance.version.agent.name} v${instance.version.number} is ${instance.status.toLowerCase()}. Cash: ${usd(instance.cashCents)}. ${instance.positions.length} open position(s). Order limit: ${usd(workspace.maxOrderCents)}. Live trading is unavailable.`;
        else if (command.kind === 'portfolio') reply = `PAPER PORTFOLIO · Cash: ${usd(instance.cashCents)}. ${instance.positions.length ? instance.positions.map(p => `${p.symbol}: ${p.quantity.toFixed(8)}, entry $${p.entryPrice.toFixed(2)}`).join('; ') : 'No open positions.'} Simulated balances, separate from Coinbase.`;
        else if (['start', 'pause', 'stop'].includes(command.kind)) {
          if (command.kind === 'start') check(!user.emergencyStop, 409, 'Emergency stop is active. Clear it on the website first.');
          const state = command.kind === 'start' ? 'RUNNING' : command.kind === 'pause' ? 'PAUSED' : 'STOPPED';
          await tx.instance.update({ where: { id: instance.id }, data: { status: state } });
          if (state !== 'RUNNING') await tx.tradeIntent.updateMany({ where: { userId, instanceId: instance.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
          reply = `PAPER MODE · ${instance.version.agent.name} ${state.toLowerCase()}. ${state === 'RUNNING' ? 'Strategy cycles run when the worker is online. Command orders still need confirmation.' : 'Pending orders cancelled.'}`;
        } else if (command.kind === 'cancel' || command.kind === 'confirm') {
          const intent = await tx.tradeIntent.findUnique({ where: { userId_confirmationCode: { userId, confirmationCode: command.code } } });
          check(intent && intent.instanceId === instance.id, 404, 'No matching order preview for your selected agent.');
          intentId = intent.id;
          check(intent.status === 'PENDING', 409, `This order is ${intent.status.toLowerCase()}. It cannot execute again.`);
          if (command.kind === 'cancel') {
            await tx.tradeIntent.update({ where: { id: intent.id }, data: { status: 'CANCELLED' } });
            reply = `PAPER ORDER · ${command.code} cancelled.`;
          } else if (intent.expiresAt <= now) {
            await tx.tradeIntent.update({ where: { id: intent.id }, data: { status: 'EXPIRED' } });
            status = 'REJECTED'; reply = 'PAPER ORDER · This preview expired. Send a new order to get a fresh confirmation code.';
          } else {
            check(!user.emergencyStop && instance.status === 'RUNNING', 409, 'Start the agent and clear emergency stop before confirming an order.');
            check(config.market === 'crypto' && config.symbols.includes(intent.symbol), 409, 'This asset is not allowed by the selected crypto agent.');
            const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
            const spent = await tx.tradeIntent.aggregate({ where: { userId, status: 'PAPER_FILLED', filledAt: { gte: today } }, _sum: { amountCents: true } });
            check(intent.amountCents <= workspace.maxOrderCents && (spent._sum.amountCents || 0) + intent.amountCents <= workspace.maxDailyCents, 409, 'Your per-order or daily limit would be exceeded.');
            const position = instance.positions.find(p => p.symbol === intent.symbol);
            const quantity = intent.amountCents / 100 / intent.price;
            if (intent.side === 'BUY') check(intent.amountCents <= riskBudget(config, instance.cashCents, instance.positions), 409, 'Insufficient paper cash or agent exposure limit reached.');
            else check(position && quantity <= position.quantity + 1e-12, 409, 'You do not hold enough of this asset. Short selling is unavailable.');
            const execution = await tx.execution.create({ data: { instanceId: instance.id, bucket: `command:${intent.id}`, status: 'COMPLETED', source: intent.source, marketTimestamp: intent.createdAt } });
            const signal = await tx.signal.create({ data: { instanceId: instance.id, executionId: execution.id, symbol: intent.symbol, action: intent.side, price: intent.price, reason: `User-confirmed ${source.toLowerCase()} paper order ${command.code}.`, source: intent.source, marketTimestamp: intent.createdAt } });
            await tx.paperTrade.create({ data: { instanceId: instance.id, signalId: signal.id, symbol: intent.symbol, side: intent.side, quantity, price: intent.price, amountCents: intent.amountCents } });
            if (intent.side === 'BUY') {
              if (position) await tx.position.update({ where: { id: position.id }, data: { quantity: position.quantity + quantity, costCents: position.costCents + intent.amountCents, entryPrice: (position.costCents + intent.amountCents) / 100 / (position.quantity + quantity) } });
              else await tx.position.create({ data: { instanceId: instance.id, symbol: intent.symbol, quantity, costCents: intent.amountCents, entryPrice: intent.price } });
            } else if (position) {
              const remaining = position.quantity - quantity;
              if (remaining < 1e-12) await tx.position.delete({ where: { id: position.id } });
              else await tx.position.update({ where: { id: position.id }, data: { quantity: remaining, costCents: Math.max(0, Math.round(position.costCents * remaining / position.quantity)) } });
            }
            await tx.instance.update({ where: { id: instance.id }, data: { cashCents: instance.cashCents + (intent.side === 'BUY' ? -intent.amountCents : intent.amountCents) } });
            await tx.tradeIntent.update({ where: { id: intent.id }, data: { status: 'PAPER_FILLED', filledAt: now } });
            reply = `PAPER FILLED · ${intent.side} ${usd(intent.amountCents)} of ${intent.symbol} at simulated $${intent.price.toFixed(2)}. Quantity: ${quantity.toFixed(8)}. No real funds moved. Reference: ${command.code}.`;
          }
        } else if (command.kind === 'trade') {
          check(!user.emergencyStop && instance.status === 'RUNNING', 409, 'Start your selected agent before creating an order.');
          check(config.market === 'crypto', 409, 'WhatsApp command orders currently support crypto agents only. Stocks and forex remain strategy simulations.');
          check(config.symbols.includes(command.symbol), 400, `${command.symbol} is not in this agent’s allowed assets: ${config.symbols.join(', ')}.`);
          check(command.amountCents <= workspace.maxOrderCents && command.amountCents <= config.positionSize * 100, 400, 'Order exceeds your workspace or agent position-size limit.');
          const feed = simulatedFeed(command.symbol, now, config.timeframe), price = feed.candles.at(-1)!.close;
          await tx.tradeIntent.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
          const code = randomBytes(4).toString('hex').toUpperCase();
          const intent = await tx.tradeIntent.create({ data: { userId, instanceId: instance.id, confirmationCode: code, side: command.side, symbol: command.symbol, amountCents: command.amountCents, price, source: feed.source, expiresAt: new Date(now.getTime() + 120000), createdAt: now } });
          intentId = intent.id; status = 'AWAITING_CONFIRMATION';
          reply = `PAPER PREVIEW · ${command.side} ${usd(command.amountCents)} of ${command.symbol} at simulated $${price.toFixed(2)}. No broker order will be sent. Reply CONFIRM ${code} within two minutes, or CANCEL ${code}. Your limits are checked again before filling.`;
        }
      }
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      reply = `NOT EXECUTED · ${error.message}`; status = 'REJECTED';
    }
    const command = await tx.agentCommand.create({ data: { userId, source, externalId, text, reply, status, intentId, channelId: channelContext?.id, recipientId: channelContext?.ownerId, deliveryStatus: source === 'WHATSAPP' ? 'PENDING' : 'NOT_REQUIRED', createdAt: now } });
    return { command, duplicate: false };
  });
}

export const tradingRouter = Router();
tradingRouter.use(auth);
tradingRouter.get('/', async (req, res) => res.json(await getWorkspace(req.user!.id)));
tradingRouter.post('/settings', async (req, res) => {
  const input = z.object({ versionId: z.string().min(1).optional(), maxOrderCents: z.number().int().min(100).max(1000000).optional(), maxDailyCents: z.number().int().min(100).max(10000000).optional() }).strict().parse(req.body);
  const result = await transaction(async tx => {
    const userId = req.user!.id; await lockUser(tx, userId);
    const workspace = await tx.tradingWorkspace.upsert({ where: { userId }, create: { userId }, update: {} });
    let activeInstanceId = workspace.activeInstanceId;
    if (input.versionId) {
      await canUseVersion(tx, userId, input.versionId);
      const instance = await tx.instance.upsert({ where: { userId_versionId: { userId, versionId: input.versionId } }, create: { userId, versionId: input.versionId }, update: {} });
      activeInstanceId = instance.id;
      if (activeInstanceId !== workspace.activeInstanceId) await tx.tradeIntent.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    }
    const maxOrderCents = input.maxOrderCents ?? workspace.maxOrderCents, maxDailyCents = input.maxDailyCents ?? workspace.maxDailyCents;
    check(maxDailyCents >= maxOrderCents, 400, 'Daily limit must be at least the per-order limit.');
    return tx.tradingWorkspace.update({ where: { userId }, data: { activeInstanceId, maxOrderCents, maxDailyCents } });
  });
  res.json(result);
});
tradingRouter.post('/commands', async (req, res) => {
  const { text, requestId } = z.object({ text: z.string().trim().min(1).max(240), requestId: z.string().uuid() }).strict().parse(req.body);
  res.json(await executeCommand(req.user!.id, text, 'WEB', requestId));
});
