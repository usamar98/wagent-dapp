import 'dotenv/config';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn,type ChildProcess } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { migrateEmbedded } from './database.js';
if(process.env.NODE_ENV==='production')throw new Error('The local demo launcher must not run in production');
await mkdir('.data',{recursive:true});
let key:string;try{key=await readFile('.data/encryption-key','utf8')}catch{key=randomBytes(32).toString('hex');await writeFile('.data/encryption-key',key,{mode:0o600});}
const port=Number(process.env.LOCAL_DB_PORT||5433);
const database=await PGlite.create('.data/postgres');
await migrateEmbedded(database);
const socket=new PGLiteSocketServer({db:database,host:'127.0.0.1',port,maxConnections:30});
await socket.start();
const built=process.argv.includes('--built');
const childEnv={...process.env,NODE_ENV:'development',DEMO_MODE:'true',PAYMENT_PROVIDER:'simulator',DATABASE_URL:`postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,CREDENTIAL_ENCRYPTION_KEY:key,APP_URL:process.env.APP_URL||'http://localhost:5173',...(built?{PORT:'5173',SERVE_STATIC:'true'}:{})};
const children:ChildProcess[]=[];
function launch(file:string,args:string[]=[]){const child=spawn(process.execPath,file.endsWith('.ts')?['--import','tsx',file,...args]:[file,...args],{env:childEnv,stdio:'inherit',windowsHide:true});children.push(child);return child;}
console.log('Wagent Ai local demo: applying seed data to embedded PostgreSQL.');
await new Promise<void>((resolve,reject)=>{launch('scripts/seed.ts').on('exit',code=>code===0?resolve():reject(new Error('Seed failed')));});
launch(built?'dist/server/server/index.js':'server/index.ts');
launch(built?'dist/server/server/worker.js':'server/worker.ts');
if(!built)launch('node_modules/vite/bin/vite.js',['--host','127.0.0.1']);
console.log('\nWagent Ai: http://localhost:5173\nLocal simulated data, demo payments, paper execution.\nSign in with MetaMask. Configure ADMIN_WALLET_ADDRESSES for administrator access.\n');
let closing=false;async function shutdown(){if(closing)return;closing=true;for(const c of children)if(c.exitCode===null)c.kill('SIGTERM');await new Promise(r=>setTimeout(r,500));await socket.stop();await database.close();process.exit(0);}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void shutdown());
for(const child of children)child.on('exit',()=>{if(!closing&&children.slice(1).includes(child))void shutdown()});
