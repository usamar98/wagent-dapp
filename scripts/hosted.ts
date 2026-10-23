import { spawn, type ChildProcess } from 'node:child_process';
import { hostedConfig } from '../shared/hosted-config.js';

const config = hostedConfig(process.env);
const withWorker = process.argv.includes('--worker');
const { db } = await import('../server/db.js');
try {
  // Check both connectivity and the current schema without creating or seeding records.
  await db.sql`SELECT 1 FROM "User" LIMIT 0`;
  await db.sql`SELECT 1 FROM "PersonalAgentChannel" LIMIT 0`;
} catch {
  console.error('Hosted database check failed. Verify the Supabase connection, TLS trust, and applied SQL migrations.');
  process.exitCode = 1;
} finally { await db.close(); }

if (!process.exitCode) {
  const children: ChildProcess[] = [];
  let closing = false;
  let failureCode = 0;
  const childEnv = { ...process.env, NODE_ENV: 'development', DEMO_MODE: 'false', PAYMENT_PROVIDER: 'stripe_test', PORT: String(config.apiPort), APP_URL: config.appUrl, API_PROXY_TARGET: `http://127.0.0.1:${config.apiPort}` };
  function stop(code: number) {
    if (closing) return;
    closing = true; failureCode = code;
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    const unfinished = () => children.some(child => child.exitCode === null && child.signalCode === null);
    if (!unfinished()) process.exit(failureCode);
    const deadline = setTimeout(() => process.exit(failureCode), 5000);
    deadline.unref();
    for (const child of children) child.once('exit', () => { if (!unfinished()) { clearTimeout(deadline); process.exit(failureCode); } });
  }
  function launch(file: string, args: string[] = []) {
    const child = spawn(process.execPath, file.endsWith('.ts') ? ['--import', 'tsx', file, ...args] : [file, ...args], { env: childEnv, stdio: 'inherit', windowsHide: true });
    children.push(child);
    child.on('error', () => stop(1));
    child.on('exit', () => { if (!closing) stop(1); });
  }
  launch('server/index.ts');
  launch('node_modules/vite/bin/vite.js', ['--host', '127.0.0.1']);
  if (withWorker) launch('server/worker.ts');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => stop(0));
  console.log(`Wagent Ai: ${config.appUrl} | Hosted PostgreSQL: ${config.databaseHost}`);
  console.log(withWorker ? 'The paper/WhatsApp worker is enabled.' : 'Run with --worker to enable this machine’s paper/WhatsApp worker.');
}
