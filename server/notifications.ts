import type {Tx} from './db.js';

type NotificationInput={userId:string;signalId:string;title:string;body:string};
export interface NotificationAdapter {
  readonly channel:string;
  deliver(tx:Tx,input:NotificationInput):Promise<void>;
}
export const inAppAdapter:NotificationAdapter={channel:'in_app',async deliver(tx,input){
  const user=await tx.user.findUniqueOrThrow({where:{id:input.userId}});
  if(user.inboxEnabled)await tx.notification.create({data:{...input,channel:'in_app'}});
}};
export const localMessageAdapter:NotificationAdapter={channel:'simulator',async deliver(tx,input){
  const connection=await tx.connection.findUnique({where:{userId_provider:{userId:input.userId,provider:'simulator'}}});
  if(connection?.verifiedAt&&connection.consentAt&&!connection.optedOutAt)await tx.notification.create({data:{...input,title:`[SIMULATED MESSAGE] ${input.title}`,channel:'simulator',status:'SIMULATED_DELIVERY'}});
}};
export const whatsappAdapter:NotificationAdapter={channel:'whatsapp',async deliver(){
  throw new Error('Official WhatsApp delivery is disabled: exact trading, crypto, forex, and AI-agent use-case eligibility has not been established. Recipient consent and approved templates alone do not establish eligibility.');
}};
export async function deliverNotifications(tx:Tx,input:NotificationInput,channels:string[]){
  for(const adapter of [inAppAdapter,localMessageAdapter])if(channels.includes(adapter.channel))await adapter.deliver(tx,input);
}
