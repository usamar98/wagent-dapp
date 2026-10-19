import {afterEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import type {Request} from 'express';
import request from 'supertest';
import {rateLimit} from 'express-rate-limit';
import {rateLimitKey} from '../server/rate-limit.js';

function client(headers:Record<string,string>={},ip='192.0.2.10'):Request {
  return {get:(name:string)=>headers[name.toLowerCase()],ip,socket:{remoteAddress:'127.0.0.1'}} as unknown as Request;
}
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()});

describe('client rate limits behind Vercel',()=>{
  it('separates clients sharing the same Vercel proxy',()=>{
    vi.stubEnv('VERCEL','1');
    expect(rateLimitKey(client({'x-vercel-forwarded-for':'198.51.100.1'}))).not.toBe(rateLimitKey(client({'x-vercel-forwarded-for':'198.51.100.2'})));
  });
  it('ignores spoofed forwarding headers outside Vercel',()=>{
    vi.stubEnv('VERCEL','0');
    expect(rateLimitKey(client({'x-vercel-forwarded-for':'198.51.100.1','x-forwarded-for':'198.51.100.2',forwarded:'for=198.51.100.3'}))).toBe('192.0.2.10');
  });
  it('falls back safely when the platform header is malformed',()=>{
    vi.stubEnv('VERCEL','1');
    expect(rateLimitKey(client({'x-vercel-forwarded-for':'not-an-ip'}))).toBe('192.0.2.10');
  });
  it('groups IPv6 address rotations within one subnet',()=>{
    vi.stubEnv('VERCEL','1');
    expect(rateLimitKey(client({'x-vercel-forwarded-for':'2001:db8:abcd:1200::1'}))).toBe(rateLimitKey(client({'x-vercel-forwarded-for':'2001:db8:abcd:12ff::2'})));
  });
  it('blocks repeat requests while allowing another client without proxy validation errors',async()=>{
    vi.stubEnv('VERCEL','1');
    const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
    const app=express();
    app.use(rateLimit({windowMs:60000,limit:1,keyGenerator:rateLimitKey}));
    app.get('/',(_req,res)=>res.json({ok:true}));
    const first=()=>request(app).get('/').set('X-Vercel-Forwarded-For','198.51.100.1').set('Forwarded','for=198.51.100.1').set('X-Forwarded-For','198.51.100.1');
    expect((await first()).status).toBe(200);
    expect((await first()).status).toBe(429);
    expect((await request(app).get('/').set('X-Vercel-Forwarded-For','198.51.100.2')).status).toBe(200);
    expect(errors).not.toHaveBeenCalled();
  });
});
