import './env.js';
import { tick } from './execution.js';
import { db } from './db.js';
let running=true;
for(const sig of ['SIGINT','SIGTERM'] as const) process.on(sig,()=>{running=false;});
console.log('Wagent Ai worker started. Deterministic simulated data and paper trading only.');
while(running) {try{await tick();}catch{console.error('Worker cycle failed; will retry.');} await new Promise(r=>setTimeout(r,5000));}
await db.$disconnect();
