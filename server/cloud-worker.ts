import { Router } from 'express';
import { db, transaction } from './db.js';
import { env } from './env.js';
import { check, token } from './security.js';
import { validCloudWorkerAuthorization } from '../shared/cloud-worker-auth.js';
import { tickPersonalAgents } from './personal-whatsapp.js';
import { tickSolanaAlerts } from './solana-alerts.js';

const leaseKey = 'cloudWorkerLease';
const leaseMilliseconds = 310000; // Longer than Vercel's 300-second function lifetime.
type Lease = { token: string; until: number; startedAt: number; completedAt?: number; ok?: boolean };
function leaseValue(value?: string): Partial<Lease> {
  try { const parsed = value ? JSON.parse(value) : null; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
async function locked<T>(work: (tx: typeof db) => Promise<T>) {
  return transaction(async tx => { await tx.sql`SELECT pg_advisory_xact_lock(870263)`; return work(tx); });
}

export async function runCloudWorkerCycle() {
  const id = token(), startedAt = Date.now();
  const claimed = await locked(async tx => {
    const previous = leaseValue((await tx.setting.findUnique({ where: { key: leaseKey } }))?.value);
    if ((previous.until || 0) > Date.now()) return false;
    const value = JSON.stringify({ ...previous, token: id, until: Date.now() + leaseMilliseconds, startedAt });
    await tx.setting.upsert({ where: { key: leaseKey }, create: { key: leaseKey, value }, update: { value } });
    return true;
  });
  if (!claimed) return { ok: true, busy: true };
  async function heartbeat() {
    await locked(async tx => {
      const lease = leaseValue((await tx.setting.findUnique({ where: { key: leaseKey } }))?.value);
      if (lease.token !== id || (lease.until || 0) <= Date.now()) return;
      const value = String(Date.now());
      for (const key of ['workerHeartbeat', 'cloudWorkerHeartbeat']) {
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      }
    });
  }
  let ok = false;
  const timer = setInterval(() => void heartbeat().catch(() => {}), 10000);
  timer.unref();
  try {
    await heartbeat();
    // Stop starting new batches after one minute; finish already-started work.
    // Channel/command leases and trade records still enforce deduplication.
    const deadline = Date.now() + 60000;
    const results = await Promise.allSettled([
      tickPersonalAgents({ limit: 20, deadline }),
      tickSolanaAlerts(undefined, { limit: 20, deadline }),
    ]);
    ok = results.every(result => result.status === 'fulfilled');
    if (!ok) console.error('Cloud worker cycle failed; the scheduler will retry.');
    return { ok, busy: false };
  } finally {
    clearInterval(timer);
    await locked(async tx => {
      const lease = leaseValue((await tx.setting.findUnique({ where: { key: leaseKey } }))?.value);
      if (lease.token === id) await tx.setting.update({ where: { key: leaseKey }, data: { value: JSON.stringify({ ...lease, until: 0, completedAt: Date.now(), ok }) } });
    });
  }
}

export const cloudWorkerRouter = Router();
cloudWorkerRouter.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  check(validCloudWorkerAuthorization(req.get('authorization'), env.encryptionKey), 401, 'Invalid worker authorization.');
  check(env.production && !env.demo && process.env.VERCEL_ENV === 'production', 503, 'Cloud worker is available only on the production deployment.');
  next();
});
// Authenticated readiness check never reads chats or places orders.
cloudWorkerRouter.get('/', (_req, res) => { res.json({ ok: true, mode: 'cloud', intervalSeconds: 10 }); });
cloudWorkerRouter.post('/', async (_req, res) => {
  const result = await runCloudWorkerCycle();
  res.status(result.ok ? result.busy ? 202 : 200 : 503).json(result);
});
