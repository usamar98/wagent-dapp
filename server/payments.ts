import Stripe from 'stripe';
import { db, lockUser, transaction, type Tx } from './db.js';
import { env } from './env.js';
import { AppError, check } from './security.js';

export interface PaymentProvider { name: string; createCheckout(order: {id:string; amountCents:number; commissionCents:number; checkoutAttempt:number; agent:{name:string}; creatorId:string}): Promise<{url:string; sessionId:string}> }
export function stripeClient() { check(env.paymentsEligible && env.stripeKey.startsWith('sk_test_'),503,'Stripe requires test credentials and confirmation of marketplace, country, and product eligibility'); return new Stripe(env.stripeKey); }
export const stripeProvider: PaymentProvider = { name:'stripe_test', async createCheckout(order) {
  const stripe=stripeClient(), profile=await db.creatorProfile.findUnique({where:{userId:order.creatorId}});
  check(profile?.stripeAccountId && profile.chargesEnabled,409,'Creator must finish eligible Stripe Connect test onboarding before checkout');
  const s=await stripe.checkout.sessions.create({mode:'payment',line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:order.amountCents,product_data:{name:order.agent.name,description:'Personal-use license for one reviewed agent version. External operating costs excluded.'}}}],client_reference_id:order.id,metadata:{orderId:order.id},success_url:`${env.appUrl}/orders/${order.id}`,cancel_url:`${env.appUrl}/orders/${order.id}?cancelled=true`,payment_intent_data:{application_fee_amount:order.commissionCents,transfer_data:{destination:profile.stripeAccountId},metadata:{orderId:order.id}}},{idempotencyKey:`checkout-${order.id}-${order.checkoutAttempt}`});
  check(s.url,502,'Payment provider returned no checkout URL'); return {url:s.url,sessionId:s.id};
} };
export const simulatorProvider: PaymentProvider = { name:'simulator', async createCheckout(order) { check(env.demo,403,'Payment simulator is disabled outside development demo mode'); return {url:`${env.appUrl}/orders/${order.id}`,sessionId:`sim_${order.id}_${order.checkoutAttempt}`}; } };

export async function createOrder(buyerId: string, agentId: string, providerName: string) {
  const provider=providerName==='stripe_test'?stripeProvider:simulatorProvider;
  if(provider===simulatorProvider) check(env.demo,403,'Simulator cannot grant production licenses');
  const order=await transaction(async tx=>{
    await lockUser(tx,buyerId);
    const listing=await tx.listing.findUnique({where:{agentId},include:{agent:{include:{creator:true}},version:true}});
    check(listing && listing.version.status==='APPROVED' && !listing.agent.creator.disabled,404,'Listing is not available');
    check(listing.agent.creatorId!==buyerId,409,'You already own your created agent');
    const existing=await tx.order.findUnique({where:{buyerId_agentId:{buyerId,agentId}}});
    if(existing) { check(existing.provider===provider.name,409,'Continue your existing order using its original payment provider'); check(existing.status==='PENDING'||existing.status==='FAILED',409,'An order already exists for this agent'); return tx.order.update({where:{id:existing.id},data:{status:'PENDING',checkoutAttempt:existing.status==='FAILED'?{increment:1}:undefined},include:{agent:true}}); }
    const setting=await tx.setting.findUnique({where:{key:'commissionBps'}}), bps=Number(setting?.value||1000), amount=listing.version.priceCents, fee=Math.round(amount*bps/10000);
    return tx.order.create({data:{buyerId,agentId,versionId:listing.versionId,creatorId:listing.agent.creatorId,amountCents:amount,commissionCents:fee,creatorCents:amount-fee,provider:provider.name},include:{agent:true}});
  });
  const checkout=await provider.createCheckout(order);
  await db.order.update({where:{id:order.id},data:{providerSessionId:checkout.sessionId}});
  return {order,...checkout};
}

async function grant(tx: Tx, order: {id:string;buyerId:string;agentId:string;versionId:string;provider:string}) {
  check(order.provider!=='simulator'||env.demo,403,'Simulator entitlements cannot be granted in production');
  await tx.entitlement.upsert({where:{buyerId_agentId:{buyerId:order.buyerId,agentId:order.agentId}},create:{buyerId:order.buyerId,agentId:order.agentId,versionId:order.versionId,orderId:order.id,environment:order.provider==='simulator'?'DEMO':'STRIPE_TEST'},update:{status:'ACTIVE'}});
}
export async function applyPaymentEvent(input: {id:string;orderId:string;provider:string;type:'paid'|'failed'|'refunded'|'disputed'|'dispute_won';amountCents?:number;paymentIntentId?:string}) {
  if(input.provider==='simulator') check(env.demo,403,'Payment simulator is disabled');
  return transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`;
    if(await tx.paymentEvent.findUnique({where:{id:input.id}})) return {duplicate:true};
    const order=await tx.order.findUnique({where:{id:input.orderId}}); check(order && order.provider===input.provider,404,'Payment order not found');
    await lockUser(tx,order.buyerId);
    if(input.type==='paid') {
      check(input.amountCents===order.amountCents,400,'Payment amount mismatch');
      if(order.status==='PENDING'||order.status==='FAILED') { await tx.order.update({where:{id:order.id},data:{status:'PAID',paymentIntentId:input.paymentIntentId,payoutStatus:order.provider==='simulator'?'SIMULATED_NOT_PAID':'TRANSFER_TO_CONNECT_PENDING'}}); await grant(tx,order); }
    } else if(input.type==='failed') { if(order.status==='PENDING') await tx.order.update({where:{id:order.id},data:{status:'FAILED'}}); }
    else if(input.type==='dispute_won') { if(order.status==='DISPUTED') {await tx.order.update({where:{id:order.id},data:{status:'PAID',payoutStatus:'RECONCILIATION_REQUIRED'}}); await grant(tx,order);} }
    else if(order.status!=='REFUNDED') {
      await tx.order.update({where:{id:order.id},data:{status:input.type==='refunded'?'REFUNDED':'DISPUTED',payoutStatus:'REVERSED_OR_HELD'}});
      await tx.entitlement.updateMany({where:{orderId:order.id},data:{status:input.type==='refunded'?'REVOKED':'SUSPENDED'}});
      await tx.instance.updateMany({where:{userId:order.buyerId,versionId:order.versionId},data:{status:'STOPPED'}});
    }
    await tx.paymentEvent.create({data:{id:input.id,orderId:order.id,provider:input.provider,type:input.type}});
    return {duplicate:false};
  });
}
export async function handleStripeWebhook(raw: Buffer, signature: string) {
  check(env.stripeWebhookSecret,503,'Stripe webhook secret is not configured');
  let event: Stripe.Event; const stripe=stripeClient();
  try { event=stripe.webhooks.constructEvent(raw,signature,env.stripeWebhookSecret,300); } catch { throw new AppError(400,'Invalid or expired Stripe webhook signature'); }
  check(!event.livemode,403,'Live payment events are disabled in this MVP');
  const object:any=event.data.object;
  if(['payout.created','payout.updated','payout.paid','payout.failed','payout.canceled'].includes(event.type)) {
    const profile=event.account?await db.creatorProfile.findUnique({where:{stripeAccountId:event.account}}):null;
    if(!profile)return;
    await transaction(async tx=>{
      if(await tx.paymentEvent.findUnique({where:{id:event.id}}))return;
      const previous=await tx.payout.findUnique({where:{providerPayoutId:object.id}}),at=new Date(event.created*1000);
      if(!previous || previous.providerEventAt<=at)await tx.payout.upsert({where:{providerPayoutId:object.id},create:{creatorId:profile.userId,providerPayoutId:object.id,status:`TEST_${String(object.status).toUpperCase()}`,amountCents:object.amount,currency:object.currency,providerEventAt:at},update:{status:`TEST_${String(object.status).toUpperCase()}`,providerEventAt:at}});
      await tx.paymentEvent.create({data:{id:event.id,provider:'stripe_test',type:event.type}});
    });return;
  }
  if(event.type==='account.updated') {await db.creatorProfile.updateMany({where:{stripeAccountId:object.id},data:{chargesEnabled:object.charges_enabled,payoutsEnabled:object.payouts_enabled}});return;}
  if(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'].includes(event.type)) {
    const order=await db.order.findUnique({where:{providerSessionId:object.id}}); check(order,404,'Checkout order not found');
    if(object.payment_status!=='paid' && event.type!=='checkout.session.async_payment_failed') return;
    check(object.currency==='usd',400,'Payment currency mismatch');
    return applyPaymentEvent({id:event.id,orderId:order.id,provider:'stripe_test',type:event.type==='checkout.session.async_payment_failed'?'failed':'paid',amountCents:object.amount_total,paymentIntentId:typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id});
  }
  if(['charge.refunded','charge.dispute.created','charge.dispute.closed'].includes(event.type)) {
    const pi=typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id;
    const order=pi?await db.order.findUnique({where:{paymentIntentId:pi}}):null; check(order,404,'Payment order for reversal not found');
    return applyPaymentEvent({id:event.id,orderId:order.id,provider:'stripe_test',type:event.type==='charge.refunded'?'refunded':event.type==='charge.dispute.closed'&&object.status==='won'?'dispute_won':'disputed'});
  }
}
