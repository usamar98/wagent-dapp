import { createHmac, timingSafeEqual } from 'node:crypto';

// A separate, one-purpose scheduler credential. Never send the encryption key.
export function cloudWorkerToken(encryptionKey: string) {
  if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) throw new Error('A valid server encryption key is required.');
  return createHmac('sha256', Buffer.from(encryptionKey, 'hex')).update('wagent-ai:cloud-worker:v1').digest('hex');
}
export function validCloudWorkerAuthorization(header: string | undefined, encryptionKey: string) {
  if (!header || !/^Bearer [a-f0-9]{64}$/.test(header)) return false;
  return timingSafeEqual(Buffer.from(header.slice(7), 'hex'), Buffer.from(cloudWorkerToken(encryptionKey), 'hex'));
}
