import { app,errorHandler } from './app.js';
import { env } from './env.js';
import { db } from './db.js';
import express from 'express';
import { resolve } from 'node:path';
if(env.production||process.env.SERVE_STATIC==='true') { app.use(express.static(resolve('dist/web')));app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/web/index.html'))); }
app.use(errorHandler);
const server=app.listen(env.port,'0.0.0.0',()=>console.log(`Wagent Ai API: http://localhost:${env.port} | Paper execution only | Demo: ${env.demo}`));
for(const sig of ['SIGINT','SIGTERM'] as const) process.on(sig,()=>server.close(async()=>{await db.$disconnect();process.exit(0);}));
