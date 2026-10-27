import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import express from 'express';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { cloudWorkerToken, validCloudWorkerAuthorization } from '../shared/cloud-worker-auth.js';

const work = vi.hoisted(() => ({ chats: vi.fn(), alerts: vi.fn() }));
vi.mock('../server/personal-whatsapp.js', () => ({ tickPersonalAgents: work.chats }));
vi.mock('../server/solana-alerts.js', () => ({ tickSolanaAlerts: work.alerts }));
let pg: PGlite, socket: PGLiteSocketServer, db: typeof import('../server/db.js').db;
let app: express.Express, cycle: typeof import('../server/cloud-worker.js').runCloudWorkerCycle, environment: typeof import('../server/env.js').env;
const encryptionKey = randomBytes(32).toString('hex'), authorization = `Bearer ${cloudWorkerToken(encryptionKey)}`;
const post = () => request(app).post('/worker').set('Authorization', authorization);
beforeAll(async () => {
  Object.assign(process.env, { NODE_ENV: 'test', DEMO_MODE: 'false', CREDENTIAL_ENCRYPTION_KEY: encryptionKey, VERCEL_ENV: 'production' });
  pg = await PGlite.create();
  await pg.exec('CREATE TABLE "Setting" (key text PRIMARY KEY, value text NOT NULL)');
  socket = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 15444, maxConnections: 10 });
  await socket.start(); process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:15444/postgres';
  ({ db } = await import('../server/db.js')); ({ env: environment } = await import('../server/env.js'));
  const worker = await import('../server/cloud-worker.js'); cycle = worker.runCloudWorkerCycle;
  app = express(); app.use('/worker', worker.cloudWorkerRouter);
  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(error.status || 500).json({ error: error.message }); });
});
beforeEach(async () => {
  environment.production = true; environment.demo = false; process.env.VERCEL_ENV = 'production';
  await db.setting.deleteMany({ where: {} }); work.chats.mockReset().mockResolvedValue(undefined); work.alerts.mockReset().mockResolvedValue(undefined);
});
afterAll(async () => { await db?.close(); await socket?.stop(); await pg?.close(); });

describe('scheduled production WhatsApp worker', () => {
  it('uses a scoped credential and rejects browser sessions, the master key, and malformed authorization before doing work', async () => {
    expect(cloudWorkerToken(encryptionKey)).not.toBe(encryptionKey);
    for (const header of ['', 'Bearer wrong', `Bearer ${encryptionKey}`, authorization + 'x', authorization.toLowerCase()]) {
      expect(validCloudWorkerAuthorization(header, encryptionKey)).toBe(false);
      expect((await request(app).post('/worker').set('Authorization', header).set('Cookie', 'ab_session=browser')).status).toBe(401);
    }
    expect(work.chats).not.toHaveBeenCalled(); expect(await db.setting.count()).toBe(0);
  });
  it('offers an authenticated readiness probe without polling or creating a heartbeat', async () => {
    const response = await request(app).get('/worker').set('Authorization', authorization);
    expect(response.status).toBe(200); expect(response.body).toEqual({ ok: true, mode: 'cloud', intervalSeconds: 10 });
    expect(response.headers['cache-control']).toBe('no-store'); expect(work.chats).not.toHaveBeenCalled(); expect(await db.setting.count()).toBe(0);
  });
  it('never starts on previews, demos, or local development even with a valid service credential', async () => {
    environment.production = false; expect((await post()).status).toBe(503);
    environment.production = true; environment.demo = true; expect((await post()).status).toBe(503);
    environment.demo = false; process.env.VERCEL_ENV = 'preview'; expect((await post()).status).toBe(503);
    expect(work.chats).not.toHaveBeenCalled();
  });
  it('runs bounded chat and alert batches and records cloud liveness and completed work', async () => {
    const response = await post(); expect(response.status).toBe(200); expect(response.body).toEqual({ ok: true, busy: false });
    expect(work.chats).toHaveBeenCalledWith({ limit: 20, deadline: expect.any(Number) });
    expect(work.alerts).toHaveBeenCalledWith(undefined, { limit: 20, deadline: expect.any(Number) });
    expect(Number((await db.setting.findUniqueOrThrow({ where: { key: 'cloudWorkerHeartbeat' } })).value)).toBeGreaterThan(Date.now() - 5000);
    expect(await db.setting.findUnique({ where: { key: 'workerHeartbeat' } })).not.toBeNull();
    const lease = JSON.parse((await db.setting.findUniqueOrThrow({ where: { key: 'cloudWorkerLease' } })).value);
    expect(lease.until).toBe(0); expect(lease.ok).toBe(true); expect(lease.completedAt).toBeGreaterThanOrEqual(lease.startedAt);
    expect(JSON.stringify(response.body)).not.toMatch(/token|secret|key/i);
  });
  it('skips an overlapping scheduler invocation using a real persisted database lease', async () => {
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    work.chats.mockImplementationOnce(() => { started(); return new Promise<void>(resolve => { release = resolve; }); });
    const first = cycle(); await entered;
    try { expect((await post()).status).toBe(202); expect(work.chats).toHaveBeenCalledTimes(1); }
    finally { release(); await first; }
  });
  it('recovers after an expired lease without skipping ahead over an active lease', async () => {
    await db.setting.create({ data: { key: 'cloudWorkerLease', value: JSON.stringify({ token: 'old', until: Date.now() + 60000 }) } });
    expect(await cycle()).toEqual({ ok: true, busy: true }); expect(work.chats).not.toHaveBeenCalled();
    await db.setting.update({ where: { key: 'cloudWorkerLease' }, data: { value: JSON.stringify({ token: 'old', until: Date.now() - 1 }) } });
    expect(await cycle()).toEqual({ ok: true, busy: false }); expect(work.chats).toHaveBeenCalledTimes(1);
  });
  it('finishes the other task on a failure, records the failed cycle, and permits a later retry', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      work.chats.mockRejectedValueOnce(new Error('fixture database error'));
      expect((await post()).status).toBe(503); expect(work.alerts).toHaveBeenCalledTimes(1);
      expect(JSON.parse((await db.setting.findUniqueOrThrow({ where: { key: 'cloudWorkerLease' } })).value).ok).toBe(false);
      expect((await post()).status).toBe(200); expect(work.chats).toHaveBeenCalledTimes(2);
    } finally { log.mockRestore(); }
  });
  it('does not clear a replacement lease while an older invocation finishes', async () => {
    work.chats.mockImplementationOnce(async () => { await db.setting.update({ where: { key: 'cloudWorkerLease' }, data: { value: JSON.stringify({ token: 'newer', until: Date.now() + 310000 }) } }); });
    await cycle(); const lease = JSON.parse((await db.setting.findUniqueOrThrow({ where: { key: 'cloudWorkerLease' } })).value);
    expect(lease.token).toBe('newer'); expect(lease.until).toBeGreaterThan(Date.now());
  });
  it('recovers from an invalid saved lease value', async () => {
    await db.setting.create({ data: { key: 'cloudWorkerLease', value: 'null' } });
    expect(await cycle()).toEqual({ ok: true, busy: false });
  });
  it('preserves the previous completion while the next cycle is running', async () => {
    await cycle(); const previous = JSON.parse((await db.setting.findUniqueOrThrow({ where: { key: 'cloudWorkerLease' } })).value);
    work.chats.mockImplementationOnce(async () => {
      const current = JSON.parse((await db.setting.findUniqueOrThrow({ where: { key: 'cloudWorkerLease' } })).value);
      expect(current.completedAt).toBe(previous.completedAt); expect(current.ok).toBe(true); expect(current.until).toBeGreaterThan(Date.now());
    });
    await cycle(); expect(work.chats).toHaveBeenCalledTimes(2);
  });
});
