import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db, transaction, lockUser } from './db.js';
import { auth, check, encrypt, decrypt, hash, token, AppError } from './security.js';
import { executeCommand } from './trading.js';

const base = 'https://api.whatsapp.com/agent/v1';
const senderId = z.string().regex(/^user:[A-Za-z0-9._-]{1,160}$/);
const updateSchema = z.object({
  object: z.literal('whatsapp_agent_platform'),
  next_offset: z.string().regex(/^\d+$/).refine(s => BigInt(s) <= 9223372036854775807n),
  entry: z.array(z.object({ id: z.string().min(1).max(160), changes: z.array(z.object({ field: z.literal('messages'), value: z.object({ messages: z.array(z.object({ from: senderId, id: z.string().min(1).max(300), timestamp: z.string().regex(/^\d+$/), type: z.string(), text: z.object({ body: z.string().max(4096) }).optional() })).max(100) }) })).max(1) })).max(1),
});

class WhatsAppError extends AppError {
  constructor(message: string, public retryable = false, public uncertain = false) { super(502, message); }
}

async function requestAgent(apiToken: string, path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${apiToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(25000) });
  } catch {
    throw new WhatsAppError('WhatsApp could not be reached. Check the connection and try again.', false, body !== undefined);
  }
  if (response.status === 204) return null;
  const raw = await response.text();
  check(raw.length < 1024 * 1024, 502, 'WhatsApp returned an oversized response.');
  let payload: any;
  try {
    // Offsets are 64-bit integers. Preserve their exact decimal representation.
    payload = JSON.parse(raw.replace(/("next_offset"\s*:\s*)(\d+)/g, '$1"$2"'));
  } catch { throw new WhatsAppError('WhatsApp returned an unreadable response.', false, body !== undefined); }
  if (!response.ok) {
    const code = payload?.error?.code;
    if (response.status === 429 || (response.status === 503 && code === 131016)) throw new WhatsAppError('WhatsApp is busy. The connection will retry after a short delay.', true);
    if (response.status >= 500) throw new WhatsAppError('WhatsApp delivery could not be confirmed. The reply will not be resent automatically.', false, body !== undefined);
    if (response.status === 403) throw new WhatsAppError('WhatsApp only allows this personal agent to reply to its creator. Check that you used your own agent key.');
    throw new WhatsAppError('WhatsApp did not accept this request. Check your agent key and account access.');
  }
  return payload;
}

async function sendReply(apiToken: string, recipient: string, text: string) {
  const payload = await requestAgent(apiToken, '/messages', { messaging_product: 'whatsapp', to: recipient, type: 'text', text: { body: text.slice(0, 4096) } });
  const messageId = z.string().min(1).safeParse(payload?.messages?.[0]?.id);
  if (!messageId.success) throw new WhatsAppError('WhatsApp did not return a reply receipt. Delivery is unknown.', false, true);
  return messageId.data;
}

async function deliverPending(channel: { id: string; ownerId: string | null; encryptedToken: string }, commandId: string) {
  if (!channel.ownerId) return;
  const claimed = await db.agentCommand.updateMany({ where: { id: commandId, channelId: channel.id, recipientId: channel.ownerId, deliveryStatus: { in: ['PENDING', 'RETRY'] } }, data: { deliveryStatus: 'SENDING' } });
  if (!claimed.count) return;
  const command = await db.agentCommand.findUniqueOrThrow({ where: { id: commandId } });
  try {
    const messageId = await sendReply(decrypt(channel.encryptedToken), channel.ownerId, command.reply);
    await db.agentCommand.update({ where: { id: command.id }, data: { deliveryStatus: 'SENT', replyMessageId: messageId } });
  } catch (error) {
    const failure = error instanceof WhatsAppError ? error : new WhatsAppError('Reply delivery failed.', false, true);
    await db.agentCommand.update({ where: { id: command.id }, data: { deliveryStatus: failure.uncertain ? 'UNKNOWN' : failure.retryable ? 'RETRY' : 'FAILED' } });
    throw failure;
  }
}

export async function syncPersonalAgent(userId: string) {
  const channel = await db.personalAgentChannel.findUnique({ where: { userId } });
  check(channel?.enabled, 409, 'Connect and enable your personal WhatsApp agent first.');
  const lease = token(), now = new Date();
  const claimed = await db.personalAgentChannel.updateMany({ where: { id: channel.id, enabled: true, nextPollAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 90000), nextPollAt: new Date(Date.now() + 6000) } });
  if (!claimed.count) return { busy: true };
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { disabled: true } });
    check(user && !user.disabled, 403, 'This account is unavailable.');
    // A process that stopped during a send cannot safely replay that reply.
    await db.agentCommand.updateMany({ where: { channelId: channel.id, deliveryStatus: 'SENDING' }, data: { deliveryStatus: 'UNKNOWN' } });
    const pending = await db.agentCommand.findFirst({ where: { channelId: channel.id, deliveryStatus: { in: ['PENDING', 'RETRY'] } }, orderBy: { createdAt: 'asc' } });
    if (pending && channel.ownerId) { await deliverPending(channel, pending.id); return { processed: 0, replyRetried: true }; }
    const raw = await requestAgent(decrypt(channel.encryptedToken), `/updates?offset=${encodeURIComponent(channel.offset)}&limit=1&timeout=0`);
    await db.personalAgentChannel.updateMany({ where: { id: channel.id, leaseToken: lease }, data: { lastPollAt: new Date(), lastError: null } });
    if (!raw) return { processed: 0 };
    const parsed = updateSchema.safeParse(raw);
    check(parsed.success, 502, 'WhatsApp returned an unsupported update format.');
    const payload = parsed.data;
    check(BigInt(payload.next_offset) >= BigInt(channel.offset), 502, 'WhatsApp returned an older message cursor.');
    let processed = 0;
    for (const entry of payload.entry) {
      check(!channel.agentId || channel.agentId === entry.id, 409, 'The connected WhatsApp agent changed. Reconnect its key.');
      for (const change of entry.changes) for (const message of change.value.messages) {
        const sentAt = Number(message.timestamp) * 1000;
        if (!Number.isFinite(sentAt) || sentAt < channel.createdAt.getTime() - 5000 || sentAt > Date.now() + 30000) continue;
        const fresh = await db.personalAgentChannel.findFirst({ where: { id: channel.id, enabled: true, leaseToken: lease, tokenFingerprint: channel.tokenFingerprint } });
        check(fresh, 409, 'The WhatsApp connection changed while syncing.');
        if (!fresh.ownerId) {
          const pairing = message.text?.body.trim().match(/^link ([A-F0-9]{12})$/i);
          if (!pairing || !fresh.pairingHash || hash(pairing[1].toUpperCase()) !== fresh.pairingHash || !fresh.pairingExpiresAt || fresh.pairingExpiresAt < new Date()) continue;
          // Meta rejects sends to anyone other than this agent's creator.
          await sendReply(decrypt(fresh.encryptedToken), message.from, 'Wagent Ai connected. PAPER MODE only. Choose and start an agent on the website, then try “Buy $100 of BTC”. Every order needs a confirmation code. Send Help for commands.');
          await transaction(async tx => {
            await lockUser(tx, userId);
            await tx.personalAgentChannel.updateMany({ where: { id: fresh.id, leaseToken: lease, pairingHash: fresh.pairingHash, enabled: true }, data: { ownerId: message.from, agentId: entry.id, pairingHash: null, pairingExpiresAt: null, lastMessageAt: new Date() } });
          });
          processed++;
        } else if (message.from === fresh.ownerId && sentAt >= Date.now() - 120000) {
          const instruction = message.type !== 'text' || !message.text ? 'Unsupported media. Send a text command.' : message.text.body.length > 240 ? 'Message too long. Send a command with at most 240 characters.' : message.text.body;
          const result = await executeCommand(userId, instruction, 'WHATSAPP', message.id, new Date(), { id: fresh.id, ownerId: fresh.ownerId, leaseToken: lease });
          await deliverPending(fresh, result.command.id);
          await db.personalAgentChannel.updateMany({ where: { id: fresh.id, leaseToken: lease }, data: { lastMessageAt: new Date() } });
          processed++;
        }
      }
    }
    await db.personalAgentChannel.updateMany({ where: { id: channel.id, leaseToken: lease }, data: { offset: payload.next_offset, agentId: payload.entry[0]?.id } });
    return { processed };
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Sync failed. Please try again. Your saved orders will not execute twice.';
    await db.personalAgentChannel.updateMany({ where: { id: channel.id, leaseToken: lease }, data: { lastError: message, nextPollAt: new Date(Date.now() + 30000) } });
    throw new AppError(502, message);
  } finally {
    await db.personalAgentChannel.updateMany({ where: { id: channel.id, leaseToken: lease }, data: { leaseToken: null, leaseUntil: null } });
  }
}

export const personalWhatsAppRouter = Router();
personalWhatsAppRouter.use(auth);
personalWhatsAppRouter.post('/', async (req, res) => {
  const input = z.object({ label: z.string().trim().min(2).max(60), apiKey: z.string().trim().min(20).max(4096).regex(/^\S+$/), consent: z.literal(true) }).strict().parse(req.body);
  const code = randomBytes(6).toString('hex').toUpperCase();
  await transaction(async tx => {
    const userId = req.user!.id; await lockUser(tx, userId);
    const data = { label: input.label, encryptedToken: encrypt(input.apiKey), tokenFingerprint: hash(input.apiKey), ownerId: null, agentId: null, pairingHash: hash(code), pairingExpiresAt: new Date(Date.now() + 10 * 60000), enabled: true, offset: '0', leaseToken: null, leaseUntil: null, nextPollAt: new Date(), lastError: null, lastPollAt: null, lastMessageAt: null, createdAt: new Date(), consentAt: new Date() };
    const previous = await tx.personalAgentChannel.findUnique({ where: { userId } });
    if (previous) await tx.agentCommand.updateMany({ where: { channelId: previous.id, deliveryStatus: { in: ['PENDING', 'RETRY'] } }, data: { deliveryStatus: 'CANCELLED' } });
    await tx.personalAgentChannel.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  });
  res.status(201).json({ pairingCommand: `LINK ${code}`, expiresInSeconds: 600 });
});
personalWhatsAppRouter.post('/sync', async (req, res) => res.json(await syncPersonalAgent(req.user!.id)));
personalWhatsAppRouter.post('/pairing', async (req, res) => {
  const code = randomBytes(6).toString('hex').toUpperCase();
  await transaction(async tx => {
    const userId = req.user!.id; await lockUser(tx, userId);
    const channel = await tx.personalAgentChannel.findUnique({ where: { userId } });
    check(channel && !channel.ownerId, 409, 'Reconnect your key to change an already paired agent.');
    await tx.personalAgentChannel.update({ where: { userId }, data: { pairingHash: hash(code), pairingExpiresAt: new Date(Date.now() + 600000) } });
  });
  res.json({ pairingCommand: `LINK ${code}`, expiresInSeconds: 600 });
});
personalWhatsAppRouter.post('/disconnect', async (req, res) => {
  await transaction(async tx => {
    const userId = req.user!.id; await lockUser(tx, userId);
    const channel = await tx.personalAgentChannel.findUnique({ where: { userId } });
    if (channel) {
      await tx.agentCommand.updateMany({ where: { channelId: channel.id, deliveryStatus: { in: ['PENDING', 'RETRY'] } }, data: { deliveryStatus: 'CANCELLED' } });
      await tx.personalAgentChannel.delete({ where: { userId } });
    }
    await tx.tradeIntent.updateMany({ where: { userId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  });
  res.json({ ok: true });
});

export async function tickPersonalAgents() {
  const channels = await db.personalAgentChannel.findMany({ where: { enabled: true, nextPollAt: { lte: new Date() } }, select: { userId: true }, take: 50 });
  for (let start = 0; start < channels.length; start += 4) {
    await Promise.allSettled(channels.slice(start, start + 4).map(channel => syncPersonalAgent(channel.userId)));
  }
}
