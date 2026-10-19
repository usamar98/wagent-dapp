import { randomBytes, createHash, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';
import { env } from './env.js';
export class AppError extends Error { constructor(public status: number, message: string) { super(message); } }
export function check(condition: unknown, status: number, message: string): asserts condition { if(!condition) throw new AppError(status,message); }
export const hash = (v: string) => createHash('sha256').update(v).digest('hex');
export const token = () => randomBytes(32).toString('hex');
export function encrypt(value: string) { const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',Buffer.from(env.encryptionKey,'hex'),iv); const encrypted=Buffer.concat([c.update(value,'utf8'),c.final()]); return [iv.toString('hex'),c.getAuthTag().toString('hex'),encrypted.toString('hex')].join('.'); }
export function decrypt(value: string) { const [iv,tag,data]=value.split('.'), c=createDecipheriv('aes-256-gcm',Buffer.from(env.encryptionKey,'hex'),Buffer.from(iv,'hex')); c.setAuthTag(Buffer.from(tag,'hex')); return Buffer.concat([c.update(Buffer.from(data,'hex')),c.final()]).toString('utf8'); }
export function verifyHmac(raw: Buffer, signature: string, secret: string) { const expected='sha256='+createHmac('sha256',secret).update(raw).digest('hex'); return expected.length===signature.length && timingSafeEqual(Buffer.from(expected),Buffer.from(signature)); }
declare global { namespace Express { interface Request { user?: {id: string; walletAddress: string; name: string; role: string; emergencyStop: boolean; inboxEnabled: boolean} } } }
export async function session(req: Request,_res: Response,next: NextFunction) {
  const raw=req.cookies?.ab_session;
  if(raw) { const s=await db.session.findUnique({where:{id:hash(raw)},include:{user:true}}); if(s && s.expiresAt>new Date() && !s.user.disabled && s.user.walletAddress) { const {id,walletAddress,name,emergencyStop,inboxEnabled}=s.user; const role=env.adminWalletAddresses.includes(walletAddress.toLowerCase())?'ADMIN':'USER'; req.user={id,walletAddress,name,role,emergencyStop,inboxEnabled}; } }
  next();
}
export function auth(req: Request,_res: Response,next: NextFunction) { if(!req.user) return next(new AppError(401,'Sign in to continue')); next(); }
export function admin(req: Request,_res: Response,next: NextFunction) { if(req.user?.role!=='ADMIN') return next(new AppError(403,'Administrator access required')); next(); }
export async function createSession(res: Response,userId: string) { const raw=token(); await db.session.create({data:{id:hash(raw),userId,expiresAt:new Date(Date.now()+7*86400000)}}); res.cookie('ab_session',raw,{httpOnly:true,sameSite:'strict',secure:env.production,maxAge:7*86400000,path:'/'}); }
export function csrf(req: Request,_res: Response,next: NextFunction) { if(['GET','HEAD','OPTIONS'].includes(req.method)) return next(); if(req.get('x-agentbazaar')!=='1') return next(new AppError(403,'Missing request verification header')); const origin=req.get('origin'); if(origin && origin!==new URL(env.appUrl).origin) return next(new AppError(403,'Request origin rejected')); next(); }
