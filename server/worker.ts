import './env.js';
import { tick } from './execution.js';
import { db } from './db.js';
import { tickPersonalAgents } from './personal-whatsapp.js';
let running=true;
for(const sig of ['SIGINT','SIGTERM'] as const) process.on(sig,()=>{running=false;});
console.log('Wagent Ai worker started. Personal WhatsApp pairing and replies. Live Solana trading and automated alerts are coming soon.');
async function heartbeat(){await db.setting.upsert({where:{key:'workerHeartbeat'},create:{key:'workerHeartbeat',value:String(Date.now())},update:{value:String(Date.now())}});}
const heartbeatTimer=setInterval(()=>void heartbeat().catch(()=>{}),10000);
await heartbeat();
while(running) {try{await Promise.all([tick(),tickPersonalAgents()]);}catch{console.error('Worker cycle failed; will retry.');} await new Promise(r=>setTimeout(r,5000));}
clearInterval(heartbeatTimer);
await db.close();
