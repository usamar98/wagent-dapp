export async function api<T = any>(path:string,body?:unknown,method=body===undefined?'GET':'POST'):Promise<T> {
  const response=await fetch(`/api${path}`,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-AgentBazaar':'1'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({error:'The server returned an unreadable response'}));
  if(!response.ok) throw new Error(data.error||'Request failed');
  return data;
}
export const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:cents%100?2:0}).format(cents/100);
export const date=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
export interface Listing {id:string;name:string;description:string;category:string;market:string;cover:string;tags:string[];creator:{id:string;name:string;profile?:{bio:string}};version:{id:string;number:number;priceCents:number;config:any;setupInstructions:string};reviews?:{id:string;rating:number;text:string;createdAt:string}[]}
