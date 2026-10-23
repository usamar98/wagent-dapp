export function hostedConfig(values: Record<string, string | undefined>) {
  const invalid = (message: string): never => { throw new Error(message); };
  if (values.NODE_ENV === 'production') invalid('Use the production server for production. This launcher is for local development.');
  let database: URL;
  try { database = new URL(values.DATABASE_URL || ''); } catch { return invalid('Set DATABASE_URL to the Supabase PostgreSQL connection string.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) invalid('DATABASE_URL must be a PostgreSQL connection string, not a Supabase HTTP API URL.');
  if (!database.username || !database.password) invalid('The database connection requires its database username and password.');
  if (/PROJECT_REF|ENCODED_PASSWORD|POOLER_HOST/i.test(database.href)) invalid('Replace the Supabase connection placeholders before starting.');
  if (!/^[a-f0-9]{64}$/i.test(values.CREDENTIAL_ENCRYPTION_KEY || '')) invalid('Set the existing 64-character credential encryption key before connecting.');
  if (values.DEMO_MODE === 'true' || values.PAYMENT_PROVIDER === 'simulator') invalid('The hosted launcher requires DEMO_MODE=false and does not run demo payments or seed data.');
  if (!['verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode') || '')) invalid('Use a verified PostgreSQL connection with sslmode=verify-full and configure its CA if needed.');
  let app: URL;
  try { app = new URL(values.APP_URL || 'http://localhost:5173'); } catch { return invalid('Set APP_URL to the local website origin.'); }
  if (!['http:', 'https:'].includes(app.protocol) || !['localhost', '127.0.0.1'].includes(app.hostname) || app.pathname !== '/' || app.search || app.hash || app.username || app.password) invalid('The local hosted launcher requires a localhost APP_URL.');
  const port = Number(values.PORT || 4000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === Number(app.port || (app.protocol === 'https:' ? 443 : 80))) invalid('Use distinct valid ports for the local API and website.');
  // Vite is deliberately configured on 5173; keep its origin aligned with wallet sign-in.
  if (app.protocol !== 'http:' || app.port !== '5173') invalid('Use APP_URL=http://localhost:5173 or http://127.0.0.1:5173 for the development website.');
  return { appUrl: app.origin, apiPort: port, databaseHost: database.hostname };
}
