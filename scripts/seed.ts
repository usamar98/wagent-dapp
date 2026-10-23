import 'dotenv/config';
import { db } from '../server/db.js';
import { env } from '../server/env.js';
import { defaultConfig,type AgentConfig } from '../shared/config.js';
export async function seed(){
  if(!env.demo)throw new Error('Demo seeding requires DEMO_MODE=true and NODE_ENV other than production');
  const users=[{id:'buyer_demo',name:'Alex Rivera',role:'USER'},{id:'creator_demo',name:'Mira Chen',role:'USER'},{id:'admin_demo',name:'Jordan Lee',role:'ADMIN'},{id:'creator_theo',name:'Theo Brooks',role:'USER'},{id:'creator_nora',name:'Nora Ellis',role:'USER'}];
  for(const u of users){await db.user.upsert({where:{id:u.id},create:{...u,profile:{create:{bio:'Independent strategy creator. These sample agents demonstrate transparent, rule-based automation using simulated data.'}}},update:{}});}
  await db.setting.upsert({where:{key:'commissionBps'},create:{key:'commissionBps',value:'1000'},update:{}});
  const agents:{id:string;name:string;description:string;creatorId:string;category:string;cover:string;price:number;tags:string[];config:AgentConfig}[]=[
    {id:'signal-atlas',name:'Signal Atlas',description:'A clear-eyed Bitcoin price sentinel. Set your levels and get a signal when the market meets your conditions.',creatorId:'creator_demo',category:'Signals',cover:'orbit',price:3900,tags:['Bitcoin','Price alerts','Starter'],config:{...defaultConfig,strategy:'price_alert',entry:1000000,exit:2000000}},
    {id:'momentum-scout',name:'Momentum Scout',description:'Follow the rhythm of the market with RSI thresholds, measured entries, and a disciplined paper-trading rulebook.',creatorId:'creator_theo',category:'Momentum',cover:'pulse',price:5900,tags:['RSI','Momentum','Multi-asset'],config:{...defaultConfig,symbols:['BTC/USD','ETH/USD'],strategy:'rsi',entry:35,exit:65,timeframe:'4h'}},
    {id:'portfolio-lens',name:'Portfolio Lens',description:'Keep a quiet watch on your stock portfolio. Timestamped observations, exposure checks, and useful notifications.',creatorId:'creator_nora',category:'Monitoring',cover:'waves',price:2900,tags:['Portfolio','Stocks','Monitoring'],config:{...defaultConfig,market:'stocks',symbols:['AAPL','MSFT'],strategy:'portfolio_monitor',timeframe:'1d'}},
    {id:'golden-cross',name:'Golden Cross',description:'Turn moving-average crossovers into repeatable signals. Simple trend logic with explicit position and risk limits.',creatorId:'creator_demo',category:'Momentum',cover:'grid',price:4900,tags:['SMA','Crossover','Trend'],config:{...defaultConfig,market:'stocks',symbols:['SPY'],strategy:'ma_crossover',fastPeriod:5,slowPeriod:20,timeframe:'1h'}},
    {id:'range-keeper',name:'Range Keeper',description:'A patient Ethereum range strategy that watches your chosen levels and keeps paper exposure within your limits.',creatorId:'creator_theo',category:'Mean reversion',cover:'candle',price:6900,tags:['Ethereum','Range','Risk limits'],config:{...defaultConfig,symbols:['ETH/USD'],strategy:'price_alert',entry:3100,exit:3350,timeframe:'15m'}},
    {id:'forex-radar',name:'Forex Radar',description:'Stay aware of EUR/USD levels with a focused price monitor, a configurable cooldown, and transparent signal records.',creatorId:'creator_nora',category:'Signals',cover:'radar',price:3500,tags:['EUR/USD','Forex','Alerts'],config:{...defaultConfig,market:'forex',symbols:['EUR/USD'],strategy:'price_alert',entry:1.04,exit:1.12,timeframe:'5m'}},
  ];
  for(let i=0;i<agents.length;i++){
    const a=agents[i];
    await db.agent.upsert({where:{id:a.id},create:{id:a.id,creatorId:a.creatorId,name:a.name,description:a.description,category:a.category,market:a.config.market,tags:a.tags,cover:a.cover},update:{}});
    const v=await db.agentVersion.upsert({where:{agentId_number:{agentId:a.id,number:1}},create:{id:`${a.id}-v1`,agentId:a.id,number:1,config:a.config,priceCents:a.price,status:'APPROVED',testedAt:new Date(),reviewNote:'Pre-reviewed demo seed configuration. Not a performance endorsement.',setupInstructions:'Download the versioned configuration from My agents. Start the Docker runner in simulated-feed, paper-only mode. Connect the local notification simulator to preview messages. Supply your own eligible provider credentials for external operating services.'},update:{}});
    await db.listing.upsert({where:{agentId:a.id},create:{agentId:a.id,versionId:v.id,publishedAt:new Date(Date.UTC(2026,9,18,12,0,6-i))},update:{}});
  }
  const welcome=await db.notification.findFirst({where:{userId:'buyer_demo',title:'Your independent workspace starts here.'}});
  if(!welcome)await db.notification.create({data:{userId:'buyer_demo',channel:'in_app',title:'Your independent workspace starts here.',body:'LOCAL DEMO: Explore the marketplace, buy a demo license through the payment simulator, and run a paper agent. No real money moves and no real trades execute.'}});
  console.log('Demo seed ready: 6 reviewed sample agents; buyer, creator, and admin accounts.');
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('scripts/seed.ts')){await seed();await db.close();}
