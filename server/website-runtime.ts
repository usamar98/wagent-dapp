import { z } from 'zod';
import { db } from './db.js';
import { env } from './env.js';
import { fetchJson, providerStatus } from './solana-providers.js';

const originKey='wagent:production-origin';
export function websiteOrigin(value:string){
  const url=new URL(value);
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))throw new Error('Invalid website origin.');
  return url.origin;
}
let registered=false;
export async function registerProductionWebsite(){
  if(registered||!env.production||(process.env.VERCEL_ENV&&process.env.VERCEL_ENV!=='production'))return;
  const value=websiteOrigin(env.appUrl);
  const existing=await db.setting.findUnique({where:{key:originKey}});
  if(existing?.value!==value)await db.setting.upsert({where:{key:originKey},create:{key:originKey,value},update:{value}});
  registered=true;
}
export type WebsiteRuntime={appUrl:string;swapsEnabled:boolean|null};
const statusCache=new Map<string,{at:number;value:WebsiteRuntime}>();
export function clearWebsiteRuntimeCache(){statusCache.clear();}
export async function channelWebsiteRuntime(savedOrigin:string|null):Promise<WebsiteRuntime>{
  const saved=savedOrigin||(!env.demo?(await db.setting.findUnique({where:{key:originKey}}))?.value:null)||env.appUrl;
  const appUrl=websiteOrigin(saved);
  if(appUrl===websiteOrigin(env.appUrl))return {appUrl,swapsEnabled:providerStatus().swapsEnabled};
  const cached=statusCache.get(appUrl);if(cached&&Date.now()-cached.at<15000)return cached.value;
  let swapsEnabled:boolean|null=null;
  try{const response=await fetchJson(`${appUrl}/api/solana/capabilities`,{},'Website status',5000);swapsEnabled=z.object({swapsEnabled:z.boolean()}).parse(response).swapsEnabled;}catch{/* Unreachable means unknown, not unconfigured. */}
  const value={appUrl,swapsEnabled};if(statusCache.size>=30)statusCache.delete(statusCache.keys().next().value!);statusCache.set(appUrl,{at:Date.now(),value});return value;
}
