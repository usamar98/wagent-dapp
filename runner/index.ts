import 'dotenv/config';
import { readFile,writeFile,mkdir,rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { configSchema } from '../shared/config.js';
import { decide,riskBudget,simulatedFeed,timeframeMs,type MarketData } from '../shared/strategies.js';

const directory=process.env.RUNNER_STATE_DIR||'runner/data';await mkdir(directory,{recursive:true});
const controlFile=join(directory,'control.json'),stateFile=join(directory,'ledger.json');
async function read<T>(file:string,fallback:T):Promise<T>{try{return JSON.parse(await readFile(file,'utf8'))}catch(e:any){if(e.code==='ENOENT')return fallback;throw e}}
async function write(file:string,data:unknown){const temp=`${file}.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(data,null,2));await rename(temp,file)}
type Control={status:'RUNNING'|'PAUSED'|'STOPPED';emergency:boolean};
const command=process.argv[2];
if(command){const control=await read<Control>(controlFile,{status:'STOPPED',emergency:false});if(command==='status'){console.log(control);process.exit(0)}if(command==='emergency-stop'){control.emergency=true;control.status='STOPPED'}else if(command==='clear-emergency'){control.emergency=false;control.status='STOPPED'}else if(command==='pause')control.status='PAUSED';else if(command==='stop')control.status='STOPPED';else if(command==='start'){if(control.emergency)throw new Error('Clear emergency stop first');control.status='RUNNING'}else throw new Error('Commands: status, start, pause, stop, emergency-stop, clear-emergency');await write(controlFile,control);console.log(control);process.exit(0)}
const exported=JSON.parse(await readFile(process.env.AGENT_CONFIG_PATH||'runner/agent.json','utf8'));
if(exported.format!=='agentbazaar-export-v1')throw new Error('Expected a purchased Wagent Ai configuration export');
const config=configSchema.parse(exported.config),fingerprint=createHash('sha256').update(JSON.stringify(config)).digest('hex');
type Position={symbol:string;quantity:number;entryPrice:number;costCents:number};
type Ledger={fingerprint:string;cashCents:number;positions:Position[];lastSignalAt:number;runs:any[];signals:any[];orders:any[]};
const ledger=await read<Ledger>(stateFile,{fingerprint,cashCents:1000000,positions:[],lastSignalAt:0,runs:[],signals:[],orders:[]});
if(ledger.fingerprint!==fingerprint)throw new Error('Configuration changed. Use a separate state directory for each purchased version.');
await write(controlFile,await read<Control>(controlFile,{status:'RUNNING',emergency:false}));
const lockFile=join(directory,'runner.lock');
let lock:import('node:fs/promises').FileHandle;
try{const {open}=await import('node:fs/promises');lock=await open(lockFile,'wx');await lock.writeFile(String(process.pid));}catch{throw new Error('A runner already owns this ledger. If it crashed, verify that no runner is active before removing runner.lock.');}
let alive=true;for(const sig of ['SIGINT','SIGTERM'] as const)process.on(sig,()=>{alive=false});
console.log(`${exported.agent.name} v${exported.agent.version} | PAPER ONLY | ${exported.license.environment} license | No real-money adapter`);
console.log(process.env.MARKET_DATA_URL?'External JSON market-data adapter configured. Quotes must include source, timestamps, and chronological candles.':'Using deterministic simulated market feed. No external provider is contacted.');
try{while(alive){
  const control=await read<Control>(controlFile,{status:'STOPPED',emergency:true}),now=new Date(),bucket=String(Math.floor(now.getTime()/timeframeMs[config.timeframe]));
  if(control.status==='RUNNING'&&!control.emergency&&!ledger.runs.some(r=>r.bucket===bucket)){
    try{
      const feeds:MarketData[]=[];
      for(const symbol of config.symbols){
        if(process.env.MARKET_DATA_URL){const url=new URL(process.env.MARKET_DATA_URL);if(!['https:','http:'].includes(url.protocol))throw new Error('Market data URL must use HTTP(S)');url.searchParams.set('symbol',symbol);url.searchParams.set('timeframe',config.timeframe);const response=await fetch(url,{headers:process.env.MARKET_DATA_API_KEY?{Authorization:`Bearer ${process.env.MARKET_DATA_API_KEY}`}:{},signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('Market data request failed');feeds.push(await response.json() as MarketData);}else feeds.push(simulatedFeed(symbol,now,config.timeframe));
      }
      const decisions=feeds.map(d=>decide(config,d,now));
      // Calculate against a clone; invalid feeds cannot leave partial trades in the ledger.
      const next:Ledger=structuredClone(ledger),cooling=now.getTime()-next.lastSignalAt<config.cooldownMinutes*60000;
      for(let i=0;i<feeds.length;i++){
        const feed=feeds[i],d=decisions[i],position=next.positions.find(p=>p.symbol===feed.symbol);
        const riskExit=position&&(d.price<=position.entryPrice*(1-config.stopLoss/100)||d.price>=position.entryPrice*(1+config.takeProfit/100));
        if(riskExit){d.action='SELL';d.reason=`Risk exit. ${d.reason}`}
        if(d.action==='HOLD'||(cooling&&!riskExit))continue;
        const signal={id:`${fingerprint}:${bucket}:${feed.symbol}`,symbol:feed.symbol,...d,source:feed.source,simulated:feed.simulated,timestamp:feed.candles.at(-1)!.timestamp,paperOnly:true};next.signals.push(signal);
        if(d.action==='BUY'&&!position){const cents=riskBudget(config,next.cashCents,next.positions);if(cents>0){const quantity=cents/100/d.price;next.positions.push({symbol:feed.symbol,quantity,entryPrice:d.price,costCents:cents});next.cashCents-=cents;next.orders.push({...signal,quantity,amountCents:cents,status:'PAPER_FILLED'});}}
        if(d.action==='SELL'&&position){const cents=Math.round(position.quantity*d.price*100);next.cashCents+=cents;next.positions=next.positions.filter(p=>p.symbol!==position.symbol);next.orders.push({...signal,quantity:position.quantity,amountCents:cents,status:'PAPER_FILLED'});}
        next.lastSignalAt=now.getTime();
      }
      const latestControl=await read<Control>(controlFile,{status:'STOPPED',emergency:true});
      if(latestControl.status==='RUNNING'&&!latestControl.emergency){const priorSignalCount=ledger.signals.length;next.runs.push({bucket,status:'COMPLETED',source:feeds[0].source,marketTimestamp:feeds[0].candles.at(-1)!.timestamp,at:now.toISOString()});await write(stateFile,next);Object.assign(ledger,next);for(const signal of next.signals.slice(priorSignalCount))console.log('[LOCAL NOTIFICATION SIMULATOR]',signal);console.log(`Paper cycle ${bucket} persisted. ${next.signals.length} total signals; ${next.orders.length} total paper orders.`);}
    }catch{ledger.runs.push({bucket,status:'ERROR',at:now.toISOString(),error:'Market data or execution failed. No real orders were submitted.'});await write(stateFile,ledger);console.error('Paper cycle rejected; see ledger. Provider credentials are not logged.');}
  }
  if(process.env.RUNNER_ONCE==='true')break;
  await new Promise(r=>setTimeout(r,2000));
}}finally{await lock.close();const {unlink}=await import('node:fs/promises');await unlink(lockFile);}
