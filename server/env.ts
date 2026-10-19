import 'dotenv/config';
export const env = {
  production: process.env.NODE_ENV === 'production',
  demo: process.env.DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production',
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  port: Number(process.env.PORT || 4000),
  encryptionKey: process.env.CREDENTIAL_ENCRYPTION_KEY || '',
  stripeKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  paymentsEligible: process.env.STRIPE_ELIGIBILITY_CONFIRMED === 'true',
  adminWalletAddresses: (process.env.ADMIN_WALLET_ADDRESSES || '').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean),
};
if(env.adminWalletAddresses.some(v=>!/^0x[a-f0-9]{40}$/.test(v)))throw new Error('ADMIN_WALLET_ADDRESSES must contain comma-separated Ethereum addresses');
if (!/^[a-f0-9]{64}$/i.test(env.encryptionKey)) throw new Error('Set CREDENTIAL_ENCRYPTION_KEY to 32 random bytes encoded as 64 hex characters. npm run dev creates a local key automatically.');
if (env.production && (!process.env.APP_URL?.startsWith('https://') || process.env.PAYMENT_PROVIDER === 'simulator')) throw new Error('Production requires an HTTPS APP_URL and forbids the payment simulator');
