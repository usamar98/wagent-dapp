import { isIP } from 'node:net';
import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

export function rateLimitKey(req: Request): string {
  // Vercel supplies this header at its edge. Never trust it on a direct server.
  const forwarded = process.env.VERCEL === '1' ? req.get('x-vercel-forwarded-for')?.trim() : undefined;
  const ip = forwarded && isIP(forwarded) ? forwarded : req.ip || req.socket.remoteAddress || 'unknown';
  return ipKeyGenerator(ip);
}
