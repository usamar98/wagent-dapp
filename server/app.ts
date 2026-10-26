import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { rateLimitKey } from './rate-limit.js';
import { z, ZodError } from 'zod';
import { randomInt } from 'node:crypto';
import {walletAuth} from './wallet-auth.js';
import { db, transaction, lockUser } from './db.js';
import { env } from './env.js';
import { AppError, check, auth, admin, session, csrf, hash, encrypt, verifyHmac } from './security.js';
import { agentInput, configSchema, costs, licenseTerms } from '../shared/config.js';
import { decide, simulatedFeed } from '../shared/strategies.js';
import { canUseVersion, runInstance } from './execution.js';
import { createOrder, applyPaymentEvent, handleStripeWebhook, stripeClient } from './payments.js';
import { tradingRouter } from './trading.js';
import { personalWhatsAppRouter } from './personal-whatsapp.js';
import { solanaRouter } from './solana.js';

export const app=express();
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'",'https:','data:'],connectSrc:["'self'"],objectSrc:["'none'"],upgradeInsecureRequests:env.production?[]:null}},strictTransportSecurity:env.production?undefined:false}));
app.use('/api',rateLimit({windowMs:60000,limit:300,keyGenerator:rateLimitKey,standardHeaders:'draft-8',legacyHeaders:false}));
app.post('/api/webhooks/stripe',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{await handleStripeWebhook(req.body,req.get('stripe-signature')||'');res.json({received:true});});
app.get('/api/webhooks/whatsapp',(req,res)=>{check(process.env.META_VERIFY_TOKEN && req.query['hub.verify_token']===process.env.META_VERIFY_TOKEN && req.query['hub.mode']==='subscribe',403,'Webhook verification failed');res.type('text').send(String(req.query['hub.challenge']));});
app.post('/api/webhooks/whatsapp',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
  check(process.env.META_APP_SECRET && verifyHmac(req.body,req.get('x-hub-signature-256')||'',process.env.META_APP_SECRET),400,'Invalid webhook signature');
  const body=JSON.parse(req.body.toString());
  // Accept verified opt-outs only, never execution instructions or purchases.
  for(const entry of body.entry||[]) for(const change of entry.changes||[]) for(const message of change.value?.messages||[]) {
    if(/^(stop|unsubscribe|opt out)$/i.test(message.text?.body?.trim()||'')) await transaction(async tx=>{
      const id=`meta_${message.id}`;
      if(await tx.paymentEvent.findUnique({where:{id}})) return;
      const connections=await tx.connection.findMany({where:{provider:'whatsapp',recipient:message.from,optedOutAt:null}});
      for(const c of connections) {await tx.connection.update({where:{id:c.id},data:{optedOutAt:new Date()}});await tx.consentRecord.create({data:{userId:c.userId,connectionId:c.id,action:'OPT_OUT',text:'Recipient sent STOP through a signed Meta webhook.'}});}
      await tx.paymentEvent.create({data:{id,provider:'meta',type:'OPT_OUT'}});
    });
  }
  res.json({received:true});
});
app.use(express.json({limit:'64kb'}),cookieParser(),session);
app.use('/api',csrf);
// Preserve historical records while keeping the public release limited to setup and research.
app.use(['/api/marketplace','/api/checkout','/api/creator/connect','/api/versions/:id/submit'],(_req,_res,next)=>{
  if (!env.demo) return next(new AppError(409,'The agent marketplace and purchases are coming soon. Create a private Solana agent instead.'));
  next();
});
app.use('/api/instances/:id/control',(req,_res,next)=>{
  if (!env.demo && req.method==='POST' && req.body?.action==='start') return next(new AppError(409,'Automated token monitoring is coming soon. Your agent configuration and WhatsApp pairing are available now.'));
  next();
});
const authLimit=rateLimit({windowMs:15*60000,limit:env.demo?100:15,message:{error:'Too many authentication attempts. Try again later.'}});
app.get('/api/health',async(_req,res)=>{await db.sql`SELECT 1`;res.json({ok:true,demo:env.demo,network:'solana',execution:env.demo?'paper_only':'coming_soon'});});
app.get('/api/bootstrap',async(req,res)=>{res.json({user:req.user||null,demo:env.demo,costs,licenseTerms,commissionBps:Number((await db.setting.findUnique({where:{key:'commissionBps'}}))?.value||1000),whatsapp:{enabled:true,platform:'personal_agent',execution:'paper_only',termsUrl:'https://www.whatsapp.com/legal/third-party-agents-terms'},stripeEnabled:env.paymentsEligible&&env.stripeKey.startsWith('sk_test_')});});
app.use('/api/trading', tradingRouter);
app.use('/api/whatsapp-agent', personalWhatsAppRouter);
app.use('/api/solana', solanaRouter);
app.use('/api/auth/wallet',walletAuth);
app.post('/api/auth/logout',async(req,res)=>{if(req.cookies?.ab_session)await db.session.deleteMany({where:{id:hash(req.cookies.ab_session)}});res.clearCookie('ab_session',{path:'/'}).clearCookie('ab_wallet_challenge',{path:'/api/auth/wallet'}).json({ok:true});});

const listingInclude={agent:{include:{creator:{select:{id:true,name:true,disabled:true,profile:{select:{bio:true}}}}}},version:true} as const;
function publicListing(listing:any) {const a=listing.agent,v=listing.version;return {id:a.id,name:a.name,description:a.description,category:a.category,market:v.config.market,tags:a.tags,cover:a.cover,createdAt:listing.publishedAt,creator:{id:a.creator.id,name:a.creator.name,profile:a.creator.profile},version:{id:v.id,number:v.number,config:v.config,priceCents:v.priceCents,setupInstructions:v.setupInstructions}};}
app.get('/api/marketplace',async(req,res)=>{
  const all=await db.listing.findMany({where:{version:{status:'APPROVED'},agent:{creator:{disabled:false}}},include:listingInclude,orderBy:{publishedAt:'desc'},take:200});
  let agents=all.map(publicListing);const q=String(req.query.q||'').toLowerCase(),market=String(req.query.market||''),strategy=String(req.query.strategy||''),max=Number(req.query.max||1000000);
  agents=agents.filter(a=>(!q||`${a.name} ${a.description} ${a.tags.join(' ')} ${a.creator.name}`.toLowerCase().includes(q))&&(!market||a.market===market)&&(!strategy||a.version.config.strategy===strategy)&&a.version.priceCents<=max);
  if(req.query.sort==='price_asc') agents.sort((a,b)=>a.version.priceCents-b.version.priceCents);if(req.query.sort==='price_desc') agents.sort((a,b)=>b.version.priceCents-a.version.priceCents);if(req.query.sort==='name')agents.sort((a,b)=>a.name.localeCompare(b.name));
  res.json({agents,total:all.length});
});
app.get('/api/marketplace/:id',async(req,res)=>{const listing=await db.listing.findUnique({where:{agentId:String(req.params.id)},include:listingInclude});check(listing&&listing.version.status==='APPROVED'&&!listing.agent.creator.disabled,404,'Listing not found');const reviews=await db.review.findMany({where:{agentId:listing.agentId},select:{id:true,rating:true,text:true,createdAt:true},orderBy:{createdAt:'desc'}});res.json({...publicListing(listing),reviews,costs,licenseTerms});});
app.get('/api/creators/:id',async(req,res)=>{const user=await db.user.findUnique({where:{id:String(req.params.id)},select:{id:true,name:true,profile:{select:{bio:true}},disabled:true}});check(user&&!user.disabled,404,'Creator not found');const listings=await db.listing.findMany({where:{agent:{creatorId:user.id},version:{status:'APPROVED'}},include:listingInclude});res.json({creator:{id:user.id,name:user.name,bio:user.profile?.bio},agents:listings.map(publicListing)});});
app.post('/api/marketplace/:id/reviews',auth,async(req,res)=>{const agentId=String(req.params.id),buyerId=req.user!.id;const entitlement=await db.entitlement.findUnique({where:{buyerId_agentId:{buyerId,agentId}}});check(entitlement?.status==='ACTIVE'&&(entitlement.environment!=='DEMO'||env.demo),403,'Only active purchasers may review');const input=z.object({rating:z.number().int().min(1).max(5),text:z.string().trim().min(10).max(1000)}).parse(req.body);res.json(await db.review.upsert({where:{buyerId_agentId:{buyerId,agentId}},create:{buyerId,agentId,...input},update:input}));});
app.post('/api/marketplace/:id/reports',auth,async(req,res)=>{const {reason}=z.object({reason:z.string().trim().min(10).max(1500)}).parse(req.body);check(await db.listing.findUnique({where:{agentId:String(req.params.id)}}),404,'Listing not found');await db.report.create({data:{userId:req.user!.id,agentId:String(req.params.id),reason}});res.status(201).json({ok:true});});

function testConfig(config:unknown) {const c=configSchema.parse(config),now=new Date();const data=c.symbols.map(s=>simulatedFeed(s,now,c.timeframe));return {label:'Reproducible simulated data. Paper-only test; no claimed returns.',source:data[0].source,timestamp:now.toISOString(),decisions:data.map(d=>({symbol:d.symbol,...decide(c,d,now)})),candles:data[0].candles};}
app.post('/api/test',auth,async(req,res)=>res.json(testConfig(req.body)));
app.post('/api/agents',auth,async(req,res)=>{const i=agentInput.parse(req.body);const agent=await db.agent.create({data:{creatorId:req.user!.id,name:i.name,description:i.description,category:i.category,market:i.config.market,tags:i.tags,cover:i.cover,versions:{create:{number:1,config:i.config,priceCents:i.priceCents,setupInstructions:i.setupInstructions}}},include:{versions:true}});res.status(201).json(agent);});
app.get('/api/agents/:id',auth,async(req,res)=>{const a=await db.agent.findFirst({where:{id:String(req.params.id),creatorId:req.user!.id},include:{versions:{orderBy:{number:'desc'}},listing:true}});check(a,404,'Private agent not found');res.json(a);});
app.post('/api/agents/:id/versions',auth,async(req,res)=>{const i=agentInput.parse(req.body);const v=await transaction(async tx=>{await lockUser(tx,req.user!.id);const a=await tx.agent.findFirst({where:{id:String(req.params.id),creatorId:req.user!.id},include:{versions:{orderBy:{number:'desc'},take:1}}});check(a,404,'Private agent not found');check(i.name===a.name&&i.description===a.description&&i.category===a.category&&i.cover===a.cover&&JSON.stringify(i.tags)===JSON.stringify(a.tags),409,'Agent identity is fixed. Create a new agent to change its name, description, category, cover, or tags. Strategy updates use new versions.');return tx.agentVersion.create({data:{agentId:a.id,number:(a.versions[0]?.number||0)+1,config:i.config,priceCents:i.priceCents,setupInstructions:i.setupInstructions}});});res.status(201).json(v);});
app.post('/api/versions/:id/test',auth,async(req,res)=>{const v=await db.agentVersion.findFirst({where:{id:String(req.params.id),agent:{creatorId:req.user!.id}}});check(v,404,'Private version not found');const result=testConfig(v.config);await db.agentVersion.update({where:{id:v.id},data:{testedAt:new Date()}});res.json(result);});
app.post('/api/versions/:id/submit',auth,async(req,res)=>{const v=await db.agentVersion.findFirst({where:{id:String(req.params.id),agent:{creatorId:req.user!.id}}});check(v,404,'Private version not found');check(v.testedAt,409,'Test this saved version before submitting');check(['DRAFT','REJECTED'].includes(v.status),409,'Version is already submitted or approved');await db.agentVersion.update({where:{id:v.id},data:{status:'PENDING',reviewNote:null}});res.json({ok:true});});
app.get('/api/library',auth,async(req,res)=>{const userId=req.user!.id;const [created,entitlements,instances]=await Promise.all([db.agent.findMany({where:{creatorId:userId},include:{versions:{orderBy:{number:'desc'}},listing:true}}),db.entitlement.findMany({where:{buyerId:userId},include:{agent:true,version:true}}),db.instance.findMany({where:{userId},include:{version:{include:{agent:true}},positions:true,executions:{orderBy:{createdAt:'desc'},take:10},signals:{orderBy:{createdAt:'desc'},take:15},trades:{orderBy:{createdAt:'desc'},take:10}}})]);res.json({created,entitlements,instances});});
app.get('/api/versions/:id/download',auth,async(req,res)=>{const v=await transaction(tx=>canUseVersion(tx,req.user!.id,String(req.params.id)));const entitlement=await db.entitlement.findFirst({where:{buyerId:req.user!.id,versionId:v.id,status:'ACTIVE'}});res.attachment(`wagent-ai-${v.agent.name.replace(/[^a-z0-9]/gi,'-')}-v${v.number}.json`).json({format:'agentbazaar-export-v1',agent:{id:v.agentId,name:v.agent.name,version:v.number},config:v.config,license:{terms:licenseTerms,environment:entitlement?.environment||'CREATOR',personalUseOnly:true},setupInstructions:v.setupInstructions,runtime:'See runner/README.md. Run docker compose -f runner/compose.yaml up --build with this export mounted as /config/agent.json. Supply your own provider credentials through environment variables.'});});

app.post('/api/checkout',auth,async(req,res)=>{const {agentId,provider,acceptLicense,acceptCosts}=z.object({agentId:z.string(),provider:z.enum(['simulator','stripe_test']),acceptLicense:z.literal(true),acceptCosts:z.literal(true)}).parse(req.body);void acceptLicense;void acceptCosts;res.status(201).json(await createOrder(req.user!.id,agentId,provider));});
app.get('/api/orders/:id',auth,async(req,res)=>{const order=await db.order.findFirst({where:{id:String(req.params.id),buyerId:req.user!.id},include:{agent:{select:{name:true,id:true}},version:{select:{number:true,id:true}}}});check(order,404,'Order not found');res.json(order);});
app.post('/api/orders/:id/simulate',auth,async(req,res)=>{check(env.demo,403,'Development simulator is disabled');const {outcome}=z.object({outcome:z.enum(['paid','failed','refunded','disputed'])}).parse(req.body);const order=await db.order.findFirst({where:{id:String(req.params.id),buyerId:req.user!.id,provider:'simulator'}});check(order,404,'Simulator order not found');check(outcome==='paid'||outcome==='failed'||order.status==='PAID',409,'Only a paid order can be reversed');res.json(await applyPaymentEvent({id:`sim_${order.id}_${order.checkoutAttempt}_${outcome}`,orderId:order.id,provider:'simulator',type:outcome,amountCents:order.amountCents}));});
app.post('/api/instances',auth,async(req,res)=>{const {versionId}=z.object({versionId:z.string()}).parse(req.body);res.status(201).json(await transaction(async tx=>{await lockUser(tx,req.user!.id);await canUseVersion(tx,req.user!.id,versionId);return tx.instance.upsert({where:{userId_versionId:{userId:req.user!.id,versionId}},create:{userId:req.user!.id,versionId},update:{}});}));});
app.post('/api/instances/:id/control',auth,async(req,res)=>{const {action}=z.object({action:z.enum(['start','pause','stop'])}).parse(req.body);const instance=await transaction(async tx=>{await lockUser(tx,req.user!.id);const user=await tx.user.findUniqueOrThrow({where:{id:req.user!.id}});const i=await tx.instance.findFirst({where:{id:String(req.params.id),userId:user.id}});check(i,404,'Runtime not found');if(action==='start'){check(!user.emergencyStop,409,'Clear emergency stop in Connections before starting');await canUseVersion(tx,user.id,i.versionId);}if(action!=='start')await tx.tradeIntent.updateMany({where:{userId:user.id,instanceId:i.id,status:'PENDING'},data:{status:'CANCELLED'}});return tx.instance.update({where:{id:i.id},data:{status:action==='start'?'RUNNING':action==='pause'?'PAUSED':'STOPPED'}});});res.json(instance);});
app.post('/api/instances/:id/run',auth,async(req,res)=>{check(await db.instance.findFirst({where:{id:String(req.params.id),userId:req.user!.id}}),404,'Runtime not found');res.json(await runInstance(String(req.params.id)));});
app.post('/api/emergency-stop',auth,async(req,res)=>{await transaction(async tx=>{await lockUser(tx,req.user!.id);await tx.user.update({where:{id:req.user!.id},data:{emergencyStop:true}});await tx.instance.updateMany({where:{userId:req.user!.id},data:{status:'STOPPED'}});await tx.tradeIntent.updateMany({where:{userId:req.user!.id,status:'PENDING'},data:{status:'CANCELLED'}});});res.json({ok:true});});
app.post('/api/emergency-stop/clear',auth,async(req,res)=>{await transaction(async tx=>{await lockUser(tx,req.user!.id);await tx.user.update({where:{id:req.user!.id},data:{emergencyStop:false}});});res.json({ok:true});});
app.get('/api/notifications',auth,async(req,res)=>res.json(await db.notification.findMany({where:{userId:req.user!.id},orderBy:{createdAt:'desc'},take:100})));
app.post('/api/notifications/read',auth,async(req,res)=>{await db.notification.updateMany({where:{userId:req.user!.id,readAt:null},data:{readAt:new Date()}});res.json({ok:true});});
app.get('/api/connections',auth,async(req,res)=>{const cs=await db.connection.findMany({where:{userId:req.user!.id}});res.json(cs.map(({encryptedCredentials,verificationHash,...c})=>({...c,hasCredentials:!!encryptedCredentials})));});
app.post('/api/connections',auth,async(req,res)=>{
  const i=z.object({provider:z.enum(['simulator','whatsapp','market_data','ai']),label:z.string().min(2).max(60),credentials:z.string().max(10000).default(''),recipient:z.string().max(40).default(''),consent:z.boolean().default(false),templateName:z.string().regex(/^[a-z0-9_]*$/).max(100).default('')}).strict().parse(req.body);
  if(['simulator','whatsapp'].includes(i.provider)) check(/^\+?[1-9][0-9]{7,14}$/.test(i.recipient),400,'Enter a valid international recipient number');
  const code=String(randomInt(100000,1000000));
  const c=await transaction(async tx=>{const fields={label:i.label,encryptedCredentials:encrypt(i.credentials),recipient:i.recipient,verificationHash:hash(code),verificationExpiresAt:new Date(Date.now()+10*60000),verifiedAt:null,consentAt:i.consent?new Date():null,optedOutAt:i.consent?null:new Date(),templateName:i.templateName||null,templateStatus:'NOT_SUBMITTED',eligibility:i.provider==='whatsapp'?'DISABLED_USE_CASE_UNVERIFIED':'LOCAL_ONLY'};const connection=await tx.connection.upsert({where:{userId_provider:{userId:req.user!.id,provider:i.provider}},create:{userId:req.user!.id,provider:i.provider,...fields},update:fields});await tx.consentRecord.create({data:{userId:req.user!.id,connectionId:connection.id,action:i.consent?'OPT_IN':'OPT_OUT',text:'Recipient notification consent. Local simulation is separate from official WhatsApp eligibility.'}});return connection;});
  res.status(201).json({id:c.id,enabled:i.provider!=='whatsapp',message:i.provider==='whatsapp'?'Saved securely. Real delivery and recipient verification remain disabled pending exact use-case approval.':'Connection saved.',...(i.provider==='simulator'&&env.demo?{demoVerificationCode:code}: {})});
});
app.post('/api/connections/:id/verify',auth,authLimit,async(req,res)=>{const {code}=z.object({code:z.string().length(6)}).parse(req.body);const c=await db.connection.findFirst({where:{id:String(req.params.id),userId:req.user!.id,provider:'simulator'}});check(env.demo&&c&&c.verificationHash===hash(code)&&c.verificationExpiresAt&&c.verificationExpiresAt>new Date(),400,'Invalid or expired local verification code');await db.connection.update({where:{id:c.id},data:{verifiedAt:new Date(),verificationHash:null,verificationExpiresAt:null}});res.json({ok:true});});
app.post('/api/connections/:id/opt-out',auth,async(req,res)=>{await transaction(async tx=>{const c=await tx.connection.findFirst({where:{id:String(req.params.id),userId:req.user!.id}});check(c,404,'Connection not found');await tx.connection.update({where:{id:c.id},data:{optedOutAt:new Date()}});await tx.consentRecord.create({data:{userId:req.user!.id,connectionId:c.id,action:'OPT_OUT',text:'User opted out in Connections.'}});});res.json({ok:true});});
app.post('/api/settings/notifications',auth,async(req,res)=>{const {enabled}=z.object({enabled:z.boolean()}).parse(req.body);await db.user.update({where:{id:req.user!.id},data:{inboxEnabled:enabled}});res.json({ok:true});});
app.get('/api/creator/dashboard',auth,async(req,res)=>{const userId=req.user!.id;const [agents,orders,profile,payouts]=await Promise.all([db.agent.findMany({where:{creatorId:userId},include:{versions:{orderBy:{number:'desc'}},listing:true}}),db.order.findMany({where:{creatorId:userId},select:{id:true,amountCents:true,commissionCents:true,creatorCents:true,status:true,payoutStatus:true,provider:true,createdAt:true,agent:{select:{name:true}}},orderBy:{createdAt:'desc'}}),db.creatorProfile.findUnique({where:{userId},select:{bio:true,chargesEnabled:true,payoutsEnabled:true}}),db.payout.findMany({where:{creatorId:userId},orderBy:{updatedAt:'desc'}})]);res.json({agents,orders,profile,payouts});});
app.post('/api/creator/profile',auth,async(req,res)=>{const {bio}=z.object({bio:z.string().trim().min(10).max(1000)}).parse(req.body);await db.creatorProfile.upsert({where:{userId:req.user!.id},create:{userId:req.user!.id,bio},update:{bio}});res.json({ok:true});});
app.get('/api/creator/payouts',auth,async(req,res)=>res.json(await db.payout.findMany({where:{creatorId:req.user!.id},orderBy:{updatedAt:'desc'}})));
app.post('/api/creator/connect',auth,async(req,res)=>{const stripe=stripeClient();let profile=await db.creatorProfile.upsert({where:{userId:req.user!.id},create:{userId:req.user!.id},update:{}});if(!profile.stripeAccountId){check(process.env.STRIPE_CONNECT_COUNTRY,503,'Set the eligible STRIPE_CONNECT_COUNTRY before onboarding');const account=await stripe.accounts.create({type:'express',country:process.env.STRIPE_CONNECT_COUNTRY,capabilities:{card_payments:{requested:true},transfers:{requested:true}}},{idempotencyKey:`creator-${req.user!.id}`});profile=await db.creatorProfile.update({where:{id:profile.id},data:{stripeAccountId:account.id}});}const link=await stripe.accountLinks.create({account:profile.stripeAccountId!,refresh_url:`${env.appUrl}/creator`,return_url:`${env.appUrl}/creator`,type:'account_onboarding'});res.json({url:link.url});});

app.get('/api/admin',auth,admin,async(_req,res)=>{const [pending,users,orders,reports,moderation,settings]=await Promise.all([db.agentVersion.findMany({where:{status:'PENDING'},include:{agent:{include:{creator:{select:{name:true,id:true}}}}},orderBy:{createdAt:'asc'}}),db.user.findMany({select:{id:true,name:true,walletAddress:true,role:true,disabled:true,createdAt:true}}),db.order.findMany({include:{agent:{select:{name:true}},buyer:{select:{name:true}}},orderBy:{createdAt:'desc'},take:100}),db.report.findMany({orderBy:{createdAt:'desc'}}),db.moderation.findMany({orderBy:{createdAt:'desc'},take:30}),db.setting.findMany()]);res.json({pending,users,orders,reports,moderation,settings});});
app.post('/api/admin/versions/:id/review',auth,admin,async(req,res)=>{const {approve,note}=z.object({approve:z.boolean(),note:z.string().min(5).max(2000)}).parse(req.body);await transaction(async tx=>{const v=await tx.agentVersion.findUnique({where:{id:String(req.params.id)},include:{agent:true}});check(v&&v.status==='PENDING'&&v.testedAt,409,'Tested pending version required');check(v.agent.creatorId!==req.user!.id,403,'Administrators cannot approve their own listings');configSchema.parse(v.config);await tx.agentVersion.update({where:{id:v.id},data:{status:approve?'APPROVED':'REJECTED',reviewNote:note}});if(approve) await tx.listing.upsert({where:{agentId:v.agentId},create:{agentId:v.agentId,versionId:v.id},update:{versionId:v.id,publishedAt:new Date()}});await tx.moderation.create({data:{adminId:req.user!.id,versionId:v.id,action:approve?'APPROVED':'REJECTED',note}});});res.json({ok:true});});
app.post('/api/admin/commission',auth,admin,async(req,res)=>{const {bps}=z.object({bps:z.number().int().min(0).max(5000)}).parse(req.body);await db.setting.upsert({where:{key:'commissionBps'},create:{key:'commissionBps',value:String(bps)},update:{value:String(bps)}});res.json({ok:true});});
app.post('/api/admin/reports/:id/resolve',auth,admin,async(req,res)=>{await db.report.update({where:{id:String(req.params.id)},data:{status:'RESOLVED'}});res.json({ok:true});});
app.post('/api/admin/users/:id',auth,admin,async(req,res)=>{const {disabled}=z.object({disabled:z.boolean()}).parse(req.body);check(String(req.params.id)!==req.user!.id,400,'You cannot disable yourself');await transaction(async tx=>{await lockUser(tx,String(req.params.id));const u=await tx.user.findUnique({where:{id:String(req.params.id)}});check(u&&u.role!=='ADMIN',403,'Administrators cannot disable other administrators');await tx.user.update({where:{id:u.id},data:{disabled}});if(disabled){await tx.session.deleteMany({where:{userId:u.id}});await tx.instance.updateMany({where:{userId:u.id},data:{status:'STOPPED'}});}});res.json({ok:true});});

app.use('/api',(_req,_res,next)=>next(new AppError(404,'API route not found')));
export function errorHandler(err:any,_req:express.Request,res:express.Response,_next:express.NextFunction) {
  if(err instanceof ZodError) return res.status(400).json({error:err.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')});
  if(err instanceof AppError) return res.status(err.status).json({error:err.message});
  if(err.type==='entity.too.large') return res.status(413).json({error:'Request exceeds the allowed size'});
  if(err instanceof SyntaxError) return res.status(400).json({error:'Malformed JSON request'});
  if(err.code==='23505') return res.status(409).json({error:'This record already exists'});
  if(err.code==='NOT_FOUND') return res.status(404).json({error:'Record not found'});
  console.error('Request failed', {type:err?.name,code:err?.code});
  return res.status(500).json({error:'The request could not be completed. Please try again.'});
}
