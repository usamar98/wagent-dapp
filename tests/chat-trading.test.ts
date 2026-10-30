import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import request from 'supertest';
import { Wallet } from 'ethers';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import bs58 from 'bs58';
import { getTransactionDecoder } from '@solana/transactions';
import { getCompiledTransactionMessageDecoder } from '@solana/transaction-messages';
import { migrateEmbedded } from '../scripts/database.js';
import { defaultConfig } from '../shared/config.js';

const SOL='So11111111111111111111111111111111111111112',MINT='JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',OTHER='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SYSTEM='11111111111111111111111111111111',TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',JUP='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
let testIp=0;
const headers:Record<string,string>={'X-AgentBazaar':'1'},keys=generateKeyPairSync('ed25519'),ownerAddress=bs58.encode(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32)),source=bs58.encode(randomBytes(32)),destination=bs58.encode(randomBytes(32));
let pg:PGlite,socket:PGLiteSocketServer,db:any,app:any,client:any,other:any,userId:string,execute:any,channel:any,tradingAddress:string,environment:any,channelRuntime:any;
const limits={allowedMints:[MINT],perTradeSol:'0.05',dailySol:'0.2',maxFeeSol:'0.001',slippageBps:100,durationHours:24,consent:true};
const anyTokens={tokenScope:'ANY_SOLANA',allowedMints:[]};
const post=(path:string,body:unknown={})=>client.post(`/api/solana/chat-trading${path}`).set(headers).send(body);
async function login(client:any){const wallet=Wallet.createRandom(),challenge=await client.post('/api/auth/wallet/challenge').set(headers).send({address:wallet.address,chainId:1});expect(challenge.status).toBe(200);expect((await client.post('/api/auth/wallet/verify').set(headers).send({signature:await wallet.signMessage(challenge.body.message)})).status).toBe(200);return (await client.get('/api/bootstrap')).body.user.id;}
async function grant(change:Record<string,unknown>={}){const proof=await post('/challenge',{...limits,...change});expect(proof.status,JSON.stringify(proof.body)).toBe(200);const signature=sign(null,Buffer.from(proof.body.message),keys.privateKey).toString('base64');const result=await post('/authorize',{id:proof.body.id,signature});expect(result.status,JSON.stringify(result.body)).toBe(200);return {id:proof.body.id,signature};}
async function chat(text:string,id=randomUUID()){return execute(userId,text,'WHATSAPP',id,new Date(),{id:channel.id,ownerId:channel.ownerId,leaseToken:'test-lease'});}
function tokenData(mint:string,amount:bigint,delegate=0){const data=Buffer.alloc(165);Buffer.from(bs58.decode(mint)).copy(data);Buffer.from(bs58.decode(tradingAddress)).copy(data,32);data.writeBigUInt64LE(amount,64);data.writeUInt32LE(delegate,72);data[108]=1;return {owner:TOKEN,lamports:2039280,executable:false,data:[data.toString('base64'),'base64']};}
function systemAccount(amount:number){return {owner:SYSTEM,lamports:amount,executable:false,data:['','base64']};}
function unsigned(side:string,amount:string,out:string,badInput=false,mint=MINT,feeBps=0,badRouteMinimum=false){
  const addresses=[tradingAddress,source,destination,side==='BUY'?SOL:mint,side==='BUY'?mint:SOL,JUP,TOKEN],data=Buffer.alloc(34);
  createHash('sha256').update('global:route_v2').digest().subarray(0,8).copy(data);data.writeBigUInt64LE(BigInt(amount)+(badInput?1n:0n),8);data.writeBigUInt64LE(badRouteMinimum?BigInt(out)/2n:BigInt(out),16);data.writeUInt16LE(100,24);data.writeUInt16LE(feeBps,26);data.writeUInt32LE(1,30);
  const accounts=Buffer.from([0,1,2,3,4,6,6,2,5,5]),message=Buffer.concat([Buffer.from([1,0,2,addresses.length]),...addresses.map(a=>Buffer.from(bs58.decode(a))),Buffer.alloc(32),Buffer.from([1,5,accounts.length]),accounts,Buffer.from([data.length]),data]);
  return Buffer.concat([Buffer.from([1]),Buffer.alloc(64),message]).toString('base64');
}
function provider(options:{timeout?:boolean;badInput?:boolean;overdraw?:boolean;delegate?:boolean;onOrder?:()=>Promise<void>;onSubmit?:()=>Promise<void>;unknown?:boolean;badMinimum?:boolean;badRouteMinimum?:boolean;feeBps?:number;router?:string;portfolio?:boolean;priceFailure?:boolean;missingPrice?:boolean;largeBalance?:boolean;withdrawTimeout?:boolean;onWithdrawalBuild?:()=>Promise<void>}={}){
  let submissions=0,withdrawals=0,side='BUY',input='10000000',output='1000000',lastWire='',mint=MINT;const sent:string[]=[];
  const mock=vi.fn(async(url:any,init?:any):Promise<Response>=>{
    if(String(url).includes('api.dexscreener.com')){
      if(options.priceFailure)throw Error('Price fixture unavailable');
      const requested=new URL(url).pathname.split('/').at(-1)!.split(',');
      return Response.json([{id:SOL,symbol:'SOL',price:'100'},{id:MINT,symbol:'JUP',price:'2'},{id:OTHER,symbol:'USDC',price:'3'}].filter(t=>requested.includes(t.id)&&(!options.missingPrice||t.id!==OTHER)).map(t=>({chainId:'solana',pairAddress:MINT,dexId:'fixture',baseToken:{address:t.id,name:t.symbol,symbol:t.symbol},priceUsd:t.price,liquidity:{usd:100000}})));
    }
    if(String(url).includes('/tokens/v2/'))return Response.json([{id:new URL(url).searchParams.get('query'),name:'Fixture',symbol:'TEST',decimals:6}]);
    if(String(url).includes('/swap/v2/order')){const p=new URL(url).searchParams;side=p.get('inputMint')===SOL?'BUY':'SELL';mint=p.get(side==='BUY'?'outputMint':'inputMint')!;input=p.get('amount')!;output=side==='BUY'?'1000000':'10000000';lastWire=unsigned(side,input,output,options.badInput,mint,options.feeBps,options.badRouteMinimum);if(options.onOrder)await options.onOrder();return Response.json({requestId:randomUUID(),transaction:lastWire,inputMint:p.get('inputMint'),outputMint:p.get('outputMint'),inAmount:input,outAmount:output,otherAmountThreshold:String(BigInt(output)*99n/100n),router:options.router??'metis',slippageBps:100,feeBps:options.feeBps??0,feeMint:SOL,lastValidBlockHeight:'100',signatureFeePayer:tradingAddress});}
    if(String(url).includes('/swap/v2/execute')){submissions++;const signed=JSON.parse(init.body).signedTransaction,tx=getTransactionDecoder().decode(Buffer.from(signed,'base64'));const {validateSignedSwap}=await import('../server/solana-swaps.js');const signature=validateSignedSwap(lastWire,signed,tradingAddress);expect(Object.keys(tx.signatures)).toEqual([tradingAddress]);sent.push(signed);if(options.onSubmit)await options.onSubmit();if(options.timeout)throw new Error('timeout');return Response.json({status:'Success',code:0,signature});}
    const payload=JSON.parse(init?.body||'{}'),method=payload.method;
    if(method==='getMultipleAccounts')return Response.json({result:{context:{slot:100},value:payload.params[0].map((a:string)=>a===tradingAddress?systemAccount(1000000000):a===source?tokenData(side==='BUY'?SOL:mint,side==='BUY'?0n:100000000n):a===destination?tokenData(side==='BUY'?mint:SOL,0n):{owner:SYSTEM,lamports:0,executable:false,data:['','base64']})}});
    if(method==='getFeeForMessage')return Response.json({result:{value:5000}});
    if(method==='getBalance')return Response.json({result:{value:1000000000}});
    if(method==='simulateTransaction'){
      const tx=getTransactionDecoder().decode(Buffer.from(payload.params[0],'base64')),message=getCompiledTransactionMessageDecoder().decode(tx.messageBytes);if(message.version===1)throw new Error('Unsupported fixture version');const isSwap=message.staticAccounts.includes(JUP as any);
      if(!isSwap){const ix=message.instructions.at(-1)!,data=Buffer.from(ix.data||[]),isSol=message.staticAccounts[ix.programAddressIndex]===SYSTEM,amount=isSol?data.readBigUInt64LE(4):0n;return Response.json({result:{value:{err:null,accounts:[systemAccount(1000000000-Number(amount)-5000)]}}});}
      const native=side==='BUY'?1000000000-Number(input)-5000:1000000000+(options.badMinimum?0:Number(output))-5000;
      return Response.json({result:{value:{err:null,accounts:payload.params[1].accounts.addresses.map((a:string)=>a===tradingAddress?systemAccount(native-(options.overdraw?10000000:0)):a===source?tokenData(side==='BUY'?SOL:mint,side==='BUY'?0n:100000000n-BigInt(input)):tokenData(side==='BUY'?mint:SOL,side==='BUY'?(options.badMinimum?0n:BigInt(output)):0n,options.delegate?1:0))}}});
    }
    if(method==='getSignatureStatuses')return Response.json({result:{value:[options.unknown?null:{err:null,confirmationStatus:'confirmed'}]}});
    if(method==='getBlockHeight')return Response.json({result:1000});
    if(method==='getLatestBlockhash'&&options.onWithdrawalBuild)await options.onWithdrawalBuild();
    if(method==='getLatestBlockhash')return Response.json({result:{value:{blockhash:bs58.encode(randomBytes(32)),lastValidBlockHeight:100}}});
    if(method==='getTokenAccountsByOwner'){
      if(options.portfolio&&payload.params[1].programId){const program=payload.params[1].programId,rows=program===TOKEN?[[MINT,options.largeBalance?'9007199254740993':'3000000'],[MINT,options.largeBalance?'2':'2000000']]:[[OTHER,'2000000']];return Response.json({result:{value:rows.map(([id,amount],i)=>({pubkey:program===TOKEN?(i?destination:source):OTHER,account:{owner:program,data:{parsed:{info:{owner:payload.params[0],mint:id,tokenAmount:{amount,decimals:6}}}}}}))}});}
      return Response.json({result:{value:payload.params[1].mint?[{pubkey:source,account:{owner:TOKEN,data:{parsed:{info:{owner:tradingAddress,mint,tokenAmount:{amount:'100000000',decimals:6}}}}}}]:[]}});
    }
    if(method==='sendTransaction'){withdrawals++;if(options.withdrawTimeout)throw Error('Uncertain withdrawal response');sent.push(payload.params[0]);const tx=getTransactionDecoder().decode(Buffer.from(payload.params[0],'base64'));return Response.json({result:bs58.encode(tx.signatures[tradingAddress as keyof typeof tx.signatures]!)});}
    throw new Error(`Unexpected outbound request ${String(url)} ${method}`);
  });vi.stubGlobal('fetch',mock);return {mock,submissions:()=>submissions,withdrawals:()=>withdrawals,sent};
}
beforeAll(async()=>{
  Object.assign(process.env,{NODE_ENV:'test',VERCEL:'1',DEMO_MODE:'false',APP_URL:'http://localhost:5173',CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),JUPITER_API_KEY:'jupiter-test',SOLANA_SWAPS_ENABLED:'true'});
  pg=await PGlite.create();await migrateEmbedded(pg);socket=new PGLiteSocketServer({db:pg,host:'127.0.0.1',port:15439,maxConnections:20});await socket.start();process.env.DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:15439/postgres';
  ({db}=await import('../server/db.js'));const module=await import('../server/app.js');app=module.app;app.use(module.errorHandler);({executeCommand:execute}=await import('../server/trading.js'));({env:environment}=await import('../server/env.js'));channelRuntime=await import('../server/website-runtime.js');client=request.agent(app);other=request.agent(app);userId=await login(client);await login(other);
  const agent=await db.agent.create({data:{creatorId:userId,name:'Chat fixture',description:'Test only',category:'Monitoring',market:'crypto',tags:['Solana'],versions:{create:{number:1,config:{...defaultConfig,symbols:[MINT]},priceCents:100,setupInstructions:'Fixture'}}},include:{versions:true}}),instance=await db.instance.create({data:{userId,versionId:agent.versions[0].id}});
  await db.tradingWorkspace.create({data:{userId,activeInstanceId:instance.id}});await db.solanaWallet.create({data:{userId,address:ownerAddress}});
  const {encrypt}=await import('../server/security.js');channel=await db.personalAgentChannel.create({data:{userId,label:'Fixture chat',encryptedToken:encrypt('private-whatsapp-fixture-key'),tokenFingerprint:'fixture-key-fingerprint',ownerId:'user:owner',consentAt:new Date(),createdAt:new Date(Date.now()-1000),leaseToken:'test-lease',leaseUntil:new Date(Date.now()+3600000)}});
  const created=await post('/wallet',{consent:true});expect(created.status).toBe(201);tradingAddress=created.body.address;
});
beforeEach(async()=>{vi.unstubAllGlobals();headers['X-Vercel-Forwarded-For']=`198.51.100.${++testIp}`;environment.appUrl='http://localhost:5173';process.env.JUPITER_API_KEY='jupiter-test';process.env.SOLANA_SWAPS_ENABLED='true';delete process.env.SOLANA_CHAT_TRADING_ENABLED;delete process.env.SOLANA_CHAT_WITHDRAWALS_ENABLED;await db.solanaChatWithdrawal.deleteMany({where:{userId}});await db.solanaWithdrawalPermission.deleteMany({where:{userId}});await db.solanaChatTrade.deleteMany({where:{userId}});await db.solanaWalletWithdrawal.deleteMany({where:{userId}});await db.agentCommand.deleteMany({where:{userId}});await db.solanaPermissionChallenge.deleteMany({where:{userId}});await db.solanaTradePermission.deleteMany({where:{userId}});await db.user.update({where:{id:userId},data:{emergencyStop:false}});await db.personalAgentChannel.update({where:{id:channel.id},data:{appUrl:null,tokenFingerprint:'fixture-key-fingerprint',ownerId:'user:owner',enabled:true,leaseToken:'test-lease',leaseUntil:new Date(Date.now()+3600000)}});channelRuntime.clearWebsiteRuntimeCache();});
beforeEach(async()=>{await db.solanaSwap.deleteMany({where:{userId}});const {clearTokenCache}=await import('../server/solana.js');clearTokenCache();});
afterEach(()=>vi.unstubAllGlobals());afterAll(async()=>{await db?.close();await socket?.stop();await pg?.close();});

describe('request-specific read-only trade status',()=>{
  it('does not report a historical sale as the result of a newer review-only sell',async()=>{
    await grant(anyTokens);const p=provider(),old=await chat(`Sell 100 of ${MINT}`),trade=await db.solanaChatTrade.findFirst({where:{commandId:old.command.id}});await db.solanaChatTrade.update({where:{id:trade.id},data:{quote:{...trade.quote,tokenSymbol:'JOB'}}});await chat('Revoke trading');
    const review=await chat(`Sell 83.3 of ${OTHER}`);expect(review.command.reply).toContain('NOT SUBMITTED');expect(review.command.reply).toContain('was revoked');expect(review.command.reply).toContain(review.command.id);
    const result=await chat('Check trade');expect(result.command.reply).toContain('NO WHATSAPP ORDER SUBMITTED');expect(result.command.reply).toContain(`Sell 83.3 of ${OTHER}`);expect(result.command.reply).not.toContain('JOB');expect(result.command.reply).not.toContain(trade.signature);expect(result.command.reply).not.toContain('TRADE CONFIRMED');expect(p.submissions()).toBe(1);
  });
  it('does not return an unrelated historical sale after a newer review-only buy',async()=>{
    await grant();const p=provider(),old=await chat(`Sell 100 of ${MINT}`),trade=await db.solanaChatTrade.findFirst({where:{commandId:old.command.id}});await post('/revoke');const review=await chat(`Buy 0.0009 SOL of ${OTHER}`),result=await chat('check my trade');expect(result.command.reply).toContain(review.command.id);expect(result.command.reply).toContain('Buy 0.0009 SOL');expect(result.command.reply).not.toContain(trade.id);expect(p.submissions()).toBe(1);
  });
  it('reports unsigned and expired permission reasons without contacting a trading provider',async()=>{
    const p=provider();expect((await chat(`Buy 0.001 SOL of ${MINT}`)).command.reply).toContain('No WhatsApp trading permission has been signed');await grant();await db.solanaTradePermission.updateMany({where:{userId,revokedAt:null},data:{expiresAt:new Date(0)}});expect((await chat(`Buy 0.001 SOL of ${MINT}`)).command.reply).toContain('permission expired');expect(p.mock).not.toHaveBeenCalled();
  });
  it('checks an explicitly referenced older trade with the original request date and no new send',async()=>{
    await grant();const p=provider(),old=await chat(`Buy 0.01 SOL of ${MINT}`),trade=await db.solanaChatTrade.findFirst({where:{commandId:old.command.id}});await post('/revoke');const review=await chat(`Sell 83.3 of ${OTHER}`);const result=await chat(`Check trade ${trade.id}`);expect(result.command.reply).toContain('READ-ONLY TRADE STATUS');expect(result.command.reply).toContain(old.command.createdAt.toISOString());expect(result.command.reply).toContain(trade.id);expect(result.command.reply).not.toContain(review.command.id);expect(p.submissions()).toBe(1);
    const reviewed=await chat(`Check trade ${review.command.id}`);expect(reviewed.command.reply).toContain('NO WHATSAPP ORDER SUBMITTED');expect(reviewed.command.reply).not.toContain(trade.signature);expect(p.submissions()).toBe(1);
  });
  it('keeps an unresolved earlier order clearly separate from the latest rejected retry',async()=>{
    await grant();const p=provider({timeout:true}),old=await chat(`Buy 0.01 SOL of ${MINT}`);expect(old.command.reply).toContain('PENDING');const blocked=await chat(`Buy 0.02 SOL of ${MINT}`);expect(blocked.command.reply).toContain('needs confirmation');const result=await chat('Check trade');expect(result.command.reply).toContain('NO WHATSAPP ORDER SUBMITTED');expect(result.command.reply).toContain('EARLIER PENDING ORDER');expect(result.command.reply).toContain('TRADE CONFIRMED');expect(result.command.reply).toContain('Buy 0.02 SOL');expect(result.command.reply).toContain('Buy 0.01 SOL');expect(p.submissions()).toBe(1);
  });
  it('returns no trade when this paired recipient has no request and rejects foreign references',async()=>{
    const p=provider();expect((await chat('Check trade')).command.reply).toContain('NO TRADE REQUEST');expect((await chat(`Check trade ${randomUUID()}`)).command.reply).toContain('not found');expect(p.mock).not.toHaveBeenCalled();
    await grant();const old=await chat(`Buy 0.01 SOL of ${MINT}`),trade=await db.solanaChatTrade.findFirst({where:{commandId:old.command.id}});await db.agentCommand.update({where:{id:old.command.id},data:{recipientId:'user:someone-else'}});const result=await chat('Check trade');expect(result.command.reply).toContain('NO TRADE REQUEST');expect((await chat(`Check trade ${trade.id}`)).command.reply).toContain('not found');expect(p.submissions()).toBe(1);
  });
  it('binds delayed status checks to requests existing at the check timestamp',async()=>{
    provider();const old=await chat(`Buy 0.001 SOL of ${MINT}`),checkResult=await chat('Check trade');await db.agentCommand.create({data:{userId,source:'WHATSAPP',externalId:randomUUID(),text:`Sell 83.3 of ${OTHER}`,reply:'SOLANA SWAP REVIEW',status:'COMPLETED',channelId:channel.id,recipientId:channel.ownerId,createdAt:new Date(checkResult.command.createdAt.getTime()+1000)}});const reply=await (await import('../server/chat-trade-status.js')).tradeStatusReply(checkResult.command);expect(reply).toContain(old.command.id);expect(reply).not.toContain('Sell 83.3');
  });
});

describe('WhatsApp information commands',()=>{
  it('returns live SOL balance and token holdings directly without submitting a trade',async()=>{
    const p=provider({portfolio:true});const b=await chat('Balance');expect(b.command.reply).toContain('Native SOL: 1 SOL');expect(b.command.reply).toContain(tradingAddress);expect(b.command.reply).toContain('$100.00');
    const portfolio=await chat('Portfolio');expect(portfolio.command.reply).toContain('JUP: 5');expect(portfolio.command.reply).toContain('USDC: 2');expect(portfolio.command.reply).toContain('Estimated total value');expect(p.submissions()).toBe(0);expect(p.withdrawals()).toBe(0);
  });
  it('returns token metrics for an exact address and labels missing metadata',async()=>{
    const p=provider({portfolio:true});const result=await chat(`Token details ${MINT}`);expect(result.command.reply).toContain('TOKEN DETAILS · JUP');expect(result.command.reply).toContain(MINT);expect(result.command.reply).toContain('Market cap: Unavailable');expect(result.command.reply).toContain('Pool liquidity: $100,000.00');
    const before=p.mock.mock.calls.length;expect((await chat('Token https://example.com')).command.status).toBe('REJECTED');expect(p.mock.mock.calls.length).toBe(before);
  });
  it('keeps missing prices explicit and does not substitute paper or sample balances',async()=>{
    provider({portfolio:true,priceFailure:true});const result=await chat('Show my portfolio');expect(result.command.reply).toContain('no available price');expect(result.command.reply).toContain('Unavailable');expect(result.command.reply).not.toContain('PAPER');
  });
  it('returns only this user’s stored trade history with ticker and transaction link',async()=>{
    await grant();const p=provider();await chat(`Buy 0.01 SOL of ${MINT}`);const result=await chat('Trade history');expect(result.command.reply).toContain('BUY · TEST');expect(result.command.reply).toContain('CONFIRMED');expect(result.command.reply).toContain('https://solscan.io/tx/');expect(p.submissions()).toBe(1);
    const alternateId=(await other.get('/api/bootstrap')).body.user.id;const empty=await (await import('../server/whatsapp-information.js')).informationReply(alternateId,{kind:'HISTORY'});expect(empty).not.toContain(tradingAddress);
  });
  it('reports remaining daily trading budget and keeps withdrawal access separate',async()=>{
    await grant();provider();await chat(`Buy 0.01 SOL of ${MINT}`);const result=await chat('My limits');expect(result.command.reply).toContain('Trading: active');expect(result.command.reply).toContain('Remaining today: 0.189 SOL');expect(result.command.reply).toContain('Withdrawals: inactive');
  });
  it('does not process information from a changed WhatsApp owner',async()=>{
    const p=provider();await expect(execute(userId,'Balance','WHATSAPP',randomUUID(),new Date(),{id:channel.id,ownerId:'different-owner',leaseToken:'test-lease'})).rejects.toThrow();expect(p.mock).not.toHaveBeenCalled();
  });
});

describe('separate permission for confirmed WhatsApp SOL withdrawals',()=>{
  const settings={perWithdrawalSol:'0.01',dailySol:'0.05',maxFeeSol:'0.00001',durationHours:24,consent:true};
  const route='/api/solana/chat-trading/withdrawal-permission';
  const access=(suffix:string,body:unknown={})=>client.post(route+suffix).set(headers).send(body);
  async function permit(change:Record<string,unknown>={}){const proof=await access('/challenge',{...settings,...change});expect(proof.status,JSON.stringify(proof.body)).toBe(200);const signature=sign(null,Buffer.from(proof.body.message),keys.privateKey).toString('base64');const result=await access('/authorize',{id:proof.body.id,signature});expect(result.status,JSON.stringify(result.body)).toBe(200);return proof.body;}
  const code=(reply:string)=>reply.match(/CONFIRM WITHDRAW ([A-F0-9]{12})/)?.[1]||'MISSING';
  it('requires a separate original-owner signature; old trading permission grants no withdrawal access',async()=>{
    await grant();const p=provider();expect((await chat('Withdraw 0.001 SOL')).command.reply).toContain('separate WhatsApp withdrawal access');expect(await db.solanaWithdrawalPermission.count({where:{userId}})).toBe(0);expect(p.withdrawals()).toBe(0);
    expect((await request(app).get(route)).status).toBe(401);const proof=await access('/challenge',settings);expect(proof.body.message).toContain('Fixed original owner recipient: '+ownerAddress);
    expect((await access('/authorize',{id:proof.body.id,signature:Buffer.alloc(64).toString('base64')})).status).toBe(400);
    expect((await other.post(route+'/authorize').set(headers).send({id:proof.body.id,signature:sign(null,Buffer.from(proof.body.message),keys.privateKey).toString('base64')})).status).toBe(400);
  });
  it('shows a preview, then signs only one native SOL transfer to the original owner',async()=>{
    await permit();const p=provider(),preview=await chat('Withdraw 0.001 SOL');expect(code(preview.command.reply)).not.toBe('MISSING');expect(preview.command.reply).toContain(ownerAddress);expect(p.withdrawals()).toBe(0);
    const confirmation='CONFIRM WITHDRAW '+code(preview.command.reply),id=randomUUID(),result=await chat(confirmation,id);expect(result.command.reply).toContain('WITHDRAWAL CONFIRMED');expect(p.withdrawals()).toBe(1);
    await chat(confirmation,id);await chat(confirmation);expect(p.withdrawals()).toBe(1);
    const tx=getTransactionDecoder().decode(Buffer.from(p.sent[0],'base64')),message=getCompiledTransactionMessageDecoder().decode(tx.messageBytes);if(message.version!=='legacy')throw Error('Expected a native SOL legacy transfer');const ix=message.instructions[0];expect(message.staticAccounts[ix.programAddressIndex]).toBe(SYSTEM);expect(message.staticAccounts[ix.accountIndices![1]]).toBe(ownerAddress);expect(Buffer.from(ix.data!).readBigUInt64LE(4)).toBe(1000000n);
    const view=await client.get(route);expect(JSON.stringify(view.body)).not.toMatch(/confirmationHash|consentMessage|encryptedSecret|sessionId/);expect(view.body.history[0].status).toBe('CONFIRMED');
  });
  it('claims concurrent confirmations at most once',async()=>{
    await permit();const p=provider(),preview=await chat('Withdraw 0.001 SOL'),confirm='CONFIRM WITHDRAW '+code(preview.command.reply);await Promise.all([chat(confirm),chat(confirm)]);expect(p.withdrawals()).toBe(1);expect(await db.solanaChatWithdrawal.count({where:{userId,status:'CONFIRMED'}})).toBe(1);
  });
  it('rejects custom recipients, other assets, zero amounts and excessive budgets',async()=>{
    await permit();const p=provider();for(const text of [`Withdraw 0.001 SOL to ${source}`,'Withdraw 2 USDC','Withdraw 0 SOL','Withdraw 0.02 SOL'])expect((await chat(text)).command.status).toBe('REJECTED');expect(p.withdrawals()).toBe(0);
    expect((await access('/challenge',{...settings,recipient:source})).status).toBe(400);expect((await access('/challenge',{...settings,maxFeeSol:'0.002'})).status).toBe(400);
  });
  it('rejects wrong and expired confirmation codes without signing or sending',async()=>{
    await permit();const p=provider(),preview=await chat('Withdraw 0.001 SOL');expect((await chat('CONFIRM WITHDRAW AAAAAAAAAAAA')).command.status).toBe('REJECTED');await db.solanaChatWithdrawal.updateMany({where:{userId},data:{confirmationExpiresAt:new Date(Date.now()-1000)}});expect((await chat('CONFIRM WITHDRAW '+code(preview.command.reply))).command.reply).toContain('expired');expect(p.withdrawals()).toBe(0);expect((await db.solanaChatWithdrawal.findFirst({where:{userId}})).signature).toBeNull();
  });
  it('cancels a preview and invalidates its code when replaced by another request',async()=>{
    await permit();const p=provider(),a=await chat('Withdraw 0.001 SOL'),b=await chat('Withdraw 0.002 SOL');expect((await chat('CONFIRM WITHDRAW '+code(a.command.reply))).command.status).toBe('REJECTED');expect((await chat('Cancel withdrawal')).command.reply).toContain('WITHDRAWAL CANCELLED');expect((await chat('CONFIRM WITHDRAW '+code(b.command.reply))).command.status).toBe('REJECTED');expect(p.withdrawals()).toBe(0);
  });
  it('keeps daily usage across newly signed permissions and includes fee reserves',async()=>{
    await permit({perWithdrawalSol:'0.00101',dailySol:'0.00101'});const p=provider(),preview=await chat('Withdraw 0.001 SOL');await chat('CONFIRM WITHDRAW '+code(preview.command.reply));await permit({perWithdrawalSol:'0.00101',dailySol:'0.00101'});expect((await chat('Withdraw 0.001 SOL')).command.reply).toContain('budget');expect(p.withdrawals()).toBe(1);expect((await chat('My limits')).command.reply).toContain('Remaining today: 0 SOL');
  });
  it('revokes pending requests from chat and from the website',async()=>{
    await permit();const p=provider(),a=await chat('Withdraw 0.001 SOL');await chat('Revoke withdrawals');expect((await chat('CONFIRM WITHDRAW '+code(a.command.reply))).command.status).toBe('REJECTED');await permit();const b=await chat('Withdraw 0.001 SOL');expect((await access('/revoke')).status).toBe(200);expect((await chat('CONFIRM WITHDRAW '+code(b.command.reply))).command.status).toBe('REJECTED');expect(p.withdrawals()).toBe(0);
  });
  it('Stop all and Revoke access block withdrawals while trading-only revoke stays separate',async()=>{
    await permit();const p=provider();await chat('Revoke trading');expect((await client.get(route)).body.permission.active).toBe(true);await chat('Revoke access');expect((await client.get(route)).body.permission.active).toBe(false);await permit();await chat('Stop all');expect((await client.get(route)).body.permission.active).toBe(false);expect((await chat('Withdraw 0.001 SOL')).command.status).toBe('REJECTED');expect(p.withdrawals()).toBe(0);
  });
  it('blocks expired permissions and the server withdrawal kill switch',async()=>{
    await permit();const p=provider();await db.solanaWithdrawalPermission.updateMany({where:{userId},data:{expiresAt:new Date(Date.now()-1000)}});expect((await chat('Withdraw 0.001 SOL')).command.status).toBe('REJECTED');await permit();process.env.SOLANA_CHAT_WITHDRAWALS_ENABLED='false';expect((await chat('Withdraw 0.001 SOL')).command.status).toBe('REJECTED');expect(p.withdrawals()).toBe(0);
  });
  it('invalidates access when the WhatsApp key or verified owner changes',async()=>{
    await permit();const p=provider();await db.personalAgentChannel.update({where:{id:channel.id},data:{tokenFingerprint:'changed'}});expect((await chat('Withdraw 0.001 SOL')).command.status).toBe('REJECTED');await db.personalAgentChannel.update({where:{id:channel.id},data:{tokenFingerprint:'fixture-key-fingerprint'}});await db.solanaWallet.update({where:{userId},data:{address:source}});expect((await chat('Withdraw 0.001 SOL')).command.status).toBe('REJECTED');await db.solanaWallet.update({where:{userId},data:{address:ownerAddress}});expect(p.withdrawals()).toBe(0);
  });
  it('honors revocation while constructing a withdrawal before signing',async()=>{
    await permit();const p=provider({onWithdrawalBuild:async()=>{expect((await access('/revoke')).status).toBe(200);}}),preview=await chat('Withdraw 0.001 SOL');await chat('CONFIRM WITHDRAW '+code(preview.command.reply));expect(p.withdrawals()).toBe(0);expect((await db.solanaChatWithdrawal.findFirst({where:{userId}})).signature).toBeNull();
  });
  it('never resends an uncertain transfer and blocks competing chat trades and withdrawals',async()=>{
    await permit();await grant();const p=provider({withdrawTimeout:true,unknown:true}),preview=await chat('Withdraw 0.001 SOL'),confirmation='CONFIRM WITHDRAW '+code(preview.command.reply);expect((await chat(confirmation)).command.reply).toContain('PENDING');await chat(confirmation);expect((await chat('Withdraw 0.001 SOL')).command.reply).toContain('needs confirmation');expect((await chat(`Buy 0.001 SOL of ${MINT}`)).command.reply).toContain('needs confirmation');expect((await post('/withdrawal/challenge',{mint:SOL,amount:'0.001'})).status).toBe(409);expect((await chat('Check withdrawal')).command.reply).toContain('PENDING');expect(p.withdrawals()).toBe(1);
    provider();expect((await chat('Check withdrawal')).command.reply).toContain('WITHDRAWAL CONFIRMED');expect((await db.solanaChatWithdrawal.findFirst({where:{userId}})).status).toBe('CONFIRMED');
  });
  it('requires a fresh review after the connected website changes',async()=>{
    const proof=await access('/challenge',settings);expect(proof.status).toBe(200);environment.appUrl='https://different.example';expect((await access('/authorize',{id:proof.body.id,signature:sign(null,Buffer.from(proof.body.message),keys.privateKey).toString('base64')})).status).toBe(409);
  });
});

describe('private portfolio and one-time owner-approved sales',()=>{
  const sell=(body:unknown)=>client.post('/api/solana/portfolio/sell/quote').set(headers).send(body);
  const input=()=>({mint:MINT,amount:'2.5',slippageBps:100,requestId:randomUUID()});
  const executeSale=(id:string,signature:string)=>client.post(`/api/solana/portfolio/sell/${id}/execute`).set(headers).send({signature});
  const ownerProof=(q:any)=>sign(null,Buffer.from(q.message),keys.privateKey).toString('base64');
  it('isolates wallet addresses, merges token accounts exactly, and values only real balances',async()=>{
    const p=provider({portfolio:true});expect((await request(app).get('/api/solana/portfolio')).status).toBe(401);
    const privateView=await other.get('/api/solana/portfolio');expect(privateView.body.wallet).toBeNull();expect(p.mock).not.toHaveBeenCalled();
    const result=await client.get('/api/solana/portfolio?source=TRADING&wallet=attacker');expect(result.status,JSON.stringify(result.body)).toBe(200);
    expect(result.body.wallet.address).toBe(tradingAddress);expect(result.body.tokens.find((t:any)=>t.mint===MINT)).toMatchObject({amount:'5',rawAmount:'5000000',symbol:'JUP',priceUsd:2,valueUsd:10});
    expect(result.body.tokens.find((t:any)=>t.mint===OTHER)).toMatchObject({amount:'2',symbol:'USDC',valueUsd:6});expect(result.body.totalUsd).toBe(116);expect(result.body.unpricedCount).toBe(0);expect(JSON.stringify(result.body)).not.toMatch(/encryptedSecret|privateKey|authorization/);
    const owner=await client.get('/api/solana/portfolio?source=OWNER');expect(owner.body.wallet.address).toBe(ownerAddress);
  });
  it('keeps unpriced tokens visible and explicitly marks a partial total',async()=>{
    provider({portfolio:true,missingPrice:true});const result=await client.get('/api/solana/portfolio');expect(result.status).toBe(200);
    expect(result.body.tokens.find((t:any)=>t.mint===OTHER)).toMatchObject({amount:'2',priceUsd:null,valueUsd:null,symbol:null});expect(result.body.unpricedCount).toBe(1);expect(result.body.totalUsd).toBe(110);
  });
  it('returns balances with unavailable values when the pricing provider is down',async()=>{
    provider({portfolio:true,priceFailure:true});const result=await client.get('/api/solana/portfolio');expect(result.status).toBe(200);expect(result.body.tokens).toHaveLength(2);expect(result.body.totalUsd).toBeNull();expect(result.body.pricingError).toContain('prices');
  });
  it('preserves raw token units above the JavaScript integer precision limit',async()=>{
    provider({portfolio:true,largeBalance:true});const result=await client.get('/api/solana/portfolio');expect(result.body.tokens.find((t:any)=>t.mint===MINT)).toMatchObject({rawAmount:'9007199254740995',amount:'9007199254.740995'});
  });
  it('requires the original owner proof and executes one reviewed sale only once',async()=>{
    const p=provider(),q=await sell(input());expect(q.status,JSON.stringify(q.body)).toBe(201);expect(q.body.ownerAddress).toBe(ownerAddress);expect(q.body.walletAddress).toBe(tradingAddress);expect(q.body.message).toContain('one-time token sale');expect(q.body.message).toContain(MINT);expect(q.body.quote.from.symbol).toBe('TEST');
    expect(JSON.stringify((await client.get('/api/solana/swaps')).body)).not.toMatch(/sessionId|orderData|authorization/);
    expect((await executeSale(q.body.id,randomBytes(64).toString('base64'))).status).toBe(400);expect((await other.post(`/api/solana/portfolio/sell/${q.body.id}/execute`).set(headers).send({signature:ownerProof(q.body)})).status).toBe(404);expect(p.submissions()).toBe(0);
    const result=await executeSale(q.body.id,ownerProof(q.body));expect(result.status,JSON.stringify(result.body)).toBe(200);expect(result.body.status).toBe('CONFIRMED');expect(p.submissions()).toBe(1);
    await executeSale(q.body.id,ownerProof(q.body));expect(p.submissions()).toBe(1);
  });
  it('rejects changed sessions, expired reviews and emergency stop without a submission',async()=>{
    const p=provider(),q=await sell(input()),stored=await db.solanaSwap.findUniqueOrThrow({where:{id:q.body.id}});
    await db.solanaSwap.update({where:{id:stored.id},data:{quote:{...stored.quote,authorization:{...stored.quote.authorization,sessionId:'changed'}}}});expect((await executeSale(q.body.id,ownerProof(q.body))).status).toBe(409);
    const expired=await sell(input());await db.solanaSwap.update({where:{id:expired.body.id},data:{expiresAt:new Date(0)}});expect((await executeSale(expired.body.id,ownerProof(expired.body))).status).toBe(409);
    const stopped=await sell(input());await client.post('/api/emergency-stop').set(headers).send({});expect((await executeSale(stopped.body.id,ownerProof(stopped.body))).body.status).toBe('CANCELLED');expect(p.submissions()).toBe(0);
  });
  it('submits concurrent copies of the same owner approval at most once',async()=>{
    const p=provider(),q=await sell(input()),proof=ownerProof(q.body);const responses=await Promise.all([executeSale(q.body.id,proof),executeSale(q.body.id,proof)]);expect(responses.some(r=>r.status===200)).toBe(true);expect(p.submissions()).toBe(1);
  });
  it('invalidates the old review when preparing another sale',async()=>{
    const p=provider(),first=await sell(input()),second=await sell(input());expect((await executeSale(first.body.id,ownerProof(first.body))).body.status).toBe('CANCELLED');expect(p.submissions()).toBe(0);expect((await executeSale(second.body.id,ownerProof(second.body))).body.status).toBe('CONFIRMED');expect(p.submissions()).toBe(1);
  });
  it('rejects a changed owner wallet and amount overrides',async()=>{
    const p=provider(),q=await sell(input()),proof=ownerProof(q.body);
    expect((await client.post(`/api/solana/portfolio/sell/${q.body.id}/execute`).set(headers).send({signature:proof,amount:'999'})).status).toBe(400);
    try{await db.solanaWallet.update({where:{userId},data:{address:OTHER}});expect((await executeSale(q.body.id,proof)).status).toBe(409);expect(p.submissions()).toBe(0);}finally{await db.solanaWallet.update({where:{userId},data:{address:ownerAddress}});}
  });
  it.each([{badInput:true},{overdraw:true},{delegate:true},{badMinimum:true},{router:'dflow'}])('keeps transaction validation on portfolio sales %j',async options=>{
    const p=provider(options);expect((await sell(input())).status).toBe(400);expect(p.submissions()).toBe(0);
  });
  it('never resubmits uncertain sales and blocks competing chat trades and withdrawals',async()=>{
    const p=provider({timeout:true}),q=await sell(input());expect((await executeSale(q.body.id,ownerProof(q.body))).body.status).toBe('UNKNOWN');await executeSale(q.body.id,ownerProof(q.body));expect(p.submissions()).toBe(1);
    expect((await sell(input())).status).toBe(409);await grant(anyTokens);expect((await chat(`Buy 0.001 SOL of ${MINT}`)).command.reply).toContain('website swap');expect((await post('/withdrawal/challenge',{mint:SOL,amount:'0.001'})).status).toBe(409);
    expect((await client.post(`/api/solana/swaps/${q.body.id}/reconcile`).set(headers).send({})).body.status).toBe('CONFIRMED');expect(p.submissions()).toBe(1);
  });
});

describe('chat trading agent setup',()=>{
  async function withAgent(symbols:string[],work:(agent:any)=>Promise<void>){
    const previous=await db.tradingWorkspace.findUnique({where:{userId}});
    const agent=await db.agent.create({data:{creatorId:userId,name:'Repairable private agent',description:'Disposable configuration for setup recovery tests.',category:'Monitoring',market:'crypto',tags:['Solana'],versions:{create:{number:1,config:{...defaultConfig,symbols},priceCents:100,setupInstructions:'Fixture setup only'}}},include:{versions:true}});
    try{await work(agent);}finally{
      await db.solanaPermissionChallenge.deleteMany({where:{userId}});await db.solanaTradePermission.deleteMany({where:{userId}});
      await db.tradingWorkspace.update({where:{userId},data:{activeInstanceId:previous.activeInstanceId}});
      const versions=await db.agentVersion.findMany({where:{agentId:agent.id}});
      await db.instance.deleteMany({where:{userId,versionId:{in:versions.map((v:any)=>v.id)}}});
      await db.agentVersion.deleteMany({where:{agentId:agent.id}});await db.agent.delete({where:{id:agent.id}});
    }
  }
  it('reports private agent choices and separates an unselected agent from an already verified wallet and paired chat',async()=>{
    await withAgent([SOL],async agent=>{
      await db.tradingWorkspace.update({where:{userId},data:{activeInstanceId:null}});
      const snapshot=(await client.get('/api/solana/chat-trading')).body;
      expect(snapshot.paired).toBe(true);expect(snapshot.agentSetup.selectedVersionId).toBeNull();expect(snapshot.availableMints).toEqual([]);
      expect(snapshot.agentSetup.agents.find((a:any)=>a.id===agent.versions[0].id).mints).toEqual([]);
      expect((await other.get('/api/solana/chat-trading')).body.agentSetup.agents).toEqual([]);
      expect((await db.solanaWallet.findUnique({where:{userId}})).address).toBe(ownerAddress);
    });
  });
  it('saves a new token version and selects it atomically without replacing WhatsApp, the owner, or the original version',async()=>{
    await withAgent([SOL],async agent=>{
      await db.tradingWorkspace.update({where:{userId},data:{activeInstanceId:null}});
      const before=await db.personalAgentChannel.findUnique({where:{userId}}),p=provider();
      const saved=await post('/agent',{versionId:agent.versions[0].id,mints:[MINT]});expect(saved.status,JSON.stringify(saved.body)).toBe(200);
      expect(saved.body.versionId).not.toBe(agent.versions[0].id);
      expect((await db.agentVersion.findUnique({where:{id:agent.versions[0].id}})).config.symbols).toEqual([SOL]);
      expect((await db.agentVersion.findUnique({where:{id:saved.body.versionId}})).number).toBe(2);
      const snapshot=(await client.get('/api/solana/chat-trading')).body;
      expect(snapshot.agentSetup.selectedVersionId).toBe(saved.body.versionId);expect(snapshot.availableMints).toEqual([MINT]);expect(snapshot.paired).toBe(true);expect(snapshot.permission).toBeNull();
      const after=await db.personalAgentChannel.findUnique({where:{userId}});expect(after.id).toBe(before.id);expect(after.tokenFingerprint).toBe(before.tokenFingerprint);expect(after.ownerId).toBe(before.ownerId);
      expect((await db.solanaWallet.findUnique({where:{userId}})).address).toBe(ownerAddress);expect(p.mock).not.toHaveBeenCalled();
    });
  });
  it('rejects unsigned sessions, foreign agents, SOL-only lists, duplicated mints and legacy configurations',async()=>{
    await withAgent([SOL],async agent=>{
      const input={versionId:agent.versions[0].id,mints:[MINT]};
      expect((await request(app).post('/api/solana/chat-trading/agent').set(headers).send(input)).status).toBe(401);
      expect((await other.post('/api/solana/chat-trading/agent').set(headers).send(input)).status).toBe(404);
      for(const mints of [[SOL],[],[MINT,MINT],['BTC/USD']])expect((await post('/agent',{...input,mints})).status).toBe(400);
      await db.agentVersion.update({where:{id:agent.versions[0].id},data:{config:{...defaultConfig,symbols:['BTC/USD']}}});
      expect((await post('/agent',input)).status).toBe(409);
      expect(await db.agentVersion.count({where:{agentId:agent.id}})).toBe(1);
    });
  });
  it('revokes existing trading access when changing the selected agent and does not authorize the replacement',async()=>{
    await withAgent([SOL],async agent=>{
      await grant();expect((await client.get('/api/solana/chat-trading')).body.permission.active).toBe(true);
      expect((await post('/agent',{versionId:agent.versions[0].id,mints:[OTHER]})).status).toBe(200);
      const snapshot=(await client.get('/api/solana/chat-trading')).body;
      expect(snapshot.permission.active).toBe(false);expect(snapshot.permission.revokedAt).not.toBeNull();expect(snapshot.availableMints).toEqual([OTHER]);
    });
  });
  it('adds a token to the current agent without broadening permission until a fresh owner signature',async()=>{
    await withAgent([MINT],async agent=>{
      expect((await post('/agent',{versionId:agent.versions[0].id,mints:[MINT]})).status).toBe(200);
      await grant();const p=provider();
      const saved=await post('/agent',{versionId:agent.versions[0].id,mints:[MINT,OTHER]});expect(saved.status).toBe(200);
      const version=await db.agentVersion.findUniqueOrThrow({where:{id:saved.body.versionId}});
      expect(version.agentId).toBe(agent.id);expect(version.number).toBe(2);expect(version.config.symbols).toEqual([MINT,OTHER]);
      expect((await db.agentVersion.findUniqueOrThrow({where:{id:agent.versions[0].id}})).config.symbols).toEqual([MINT]);
      const snapshot=(await client.get('/api/solana/chat-trading')).body;
      expect(snapshot.agentSetup.selectedVersionId).toBe(version.id);expect(snapshot.availableMints).toEqual([MINT,OTHER]);
      expect(snapshot.permission.active).toBe(false);expect(snapshot.permission.revokedAt).not.toBeNull();expect(snapshot.permission.allowedMints).toEqual([MINT]);
      expect(snapshot.wallet.address).toBe(tradingAddress);expect(snapshot.wallet.ownerAddress).toBe(ownerAddress);expect(snapshot.paired).toBe(true);
      expect(await db.solanaPermissionChallenge.count({where:{userId}})).toBe(0);expect(p.mock).not.toHaveBeenCalled();
      await grant({allowedMints:[MINT,OTHER]});
      const approved=(await client.get('/api/solana/chat-trading')).body.permission;
      expect(approved.active).toBe(true);expect(approved.allowedMints).toEqual([MINT,OTHER].sort());
      expect(approved.perTradeSol).toBe(limits.perTradeSol);expect(approved.dailySol).toBe(limits.dailySol);expect(p.submissions()).toBe(0);
    });
  });
  it('reuses an unchanged selected version without duplicates or revoking an unchanged permission',async()=>{
    await withAgent([MINT],async agent=>{
      const input={versionId:agent.versions[0].id,mints:[MINT]};expect((await post('/agent',input)).body.versionId).toBe(input.versionId);
      await grant();expect((await post('/agent',input)).status).toBe(200);
      expect(await db.agentVersion.count({where:{agentId:agent.id}})).toBe(1);expect((await client.get('/api/solana/chat-trading')).body.permission.active).toBe(true);
    });
  });
});

describe('owner-wallet SOL funding preparation',()=>{
  it('requires an authenticated account and a dedicated wallet and rejects recipient overrides',async()=>{
    expect((await request(app).post('/api/solana/chat-trading/funding/prepare').set(headers).send({amount:'0.1'})).status).toBe(401);
    expect((await other.post('/api/solana/chat-trading/funding/prepare').set(headers).send({amount:'0.1'})).status).toBe(409);
    const p=provider();expect((await post('/funding/prepare',{amount:'0.1',to:OTHER})).status).toBe(400);expect(p.mock).not.toHaveBeenCalled();
    expect((await post('/funding/prepare',{amount:'0.0000000001'})).status).toBe(400);
  });
  it('prepares exactly one unsigned owner-to-trading-wallet transfer without moving funds or revoking permission',async()=>{
    await grant();const p=provider(),response=await post('/funding/prepare',{amount:'0.05'});expect(response.status,JSON.stringify(response.body)).toBe(200);
    const result=response.body;expect(result.from).toBe(ownerAddress);expect(result.to).toBe(tradingAddress);expect(result.lamports).toBe('50000000');expect(result.feeSol).toBe('0.000005');
    const decoded=getTransactionDecoder().decode(Buffer.from(result.transaction,'base64')),message=getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
    if(message.version===1)throw new Error('A funding transfer must use the supported legacy wire format.');
    expect(message.staticAccounts).toEqual([ownerAddress,tradingAddress,SYSTEM]);expect(message.instructions).toHaveLength(1);
    const ix=message.instructions[0];expect(message.staticAccounts[ix.programAddressIndex]).toBe(SYSTEM);expect([...ix.accountIndices!]).toEqual([0,1]);expect(Buffer.from(ix.data!).readUInt32LE()).toBe(2);expect(Buffer.from(ix.data!).readBigUInt64LE(4)).toBe(50000000n);
    expect(Object.values(decoded.signatures).every(value=>value===null||Buffer.from(value).every(byte=>byte===0))).toBe(true);
    const {validateSolFundingTransaction}=await import('../src/solana-wallet');expect(validateSolFundingTransaction(result.transaction,ownerAddress,tradingAddress,'0.05')).toHaveLength(215);
    expect(p.submissions()).toBe(0);expect(p.withdrawals()).toBe(0);expect((await client.get('/api/solana/chat-trading')).body.permission.active).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/encryptedSecret|privateKey|secretKey/);
  });
  it('refuses insufficient balances, unreliable fees, and failed simulation without broadcasting',async()=>{
    const p=provider(),base=globalThis.fetch;
    for(const method of ['getBalance','getFeeForMessage','simulateTransaction']){
      vi.stubGlobal('fetch',vi.fn(async(url:any,init?:any)=>{const payload=JSON.parse(init?.body||'{}');if(payload.method===method)return Response.json({result:method==='getBalance'?{value:0}:method==='getFeeForMessage'?{value:10000001}:{value:{err:'InsufficientFundsForRent'}}});return base(url,init);}));
      expect((await post('/funding/prepare',{amount:'0.05'})).status).toBe(method==='getFeeForMessage'?502:400);
    }
    expect(p.submissions()).toBe(0);expect(p.withdrawals()).toBe(0);
  });
  it('requires the original verified owner and an active session',async()=>{
    const p=provider();await db.solanaWallet.update({where:{userId},data:{address:OTHER}});
    try{expect((await post('/funding/prepare',{amount:'0.05'})).status).toBe(409);expect(p.mock).not.toHaveBeenCalled();}
    finally{await db.solanaWallet.update({where:{userId},data:{address:ownerAddress}});}
    await db.user.update({where:{id:userId},data:{emergencyStop:true}});expect((await post('/funding/prepare',{amount:'0.05'})).status).toBe(409);
  });
});

describe('signed WhatsApp trading permission',()=>{
  it('uses Binance Wallet Standard owner proofs for chat buys, sells, and owner-signed withdrawals',async()=>{
    const {linkWallet,signWalletMessage}=await import('../src/solana-wallet');
    const publicKey=new Uint8Array(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32));
    const account={address:ownerAddress,publicKey,chains:['solana:mainnet'],features:['solana:signMessage']};
    const binance={name:'Binance Wallet',chains:['solana:mainnet'],accounts:[account],features:{
      'standard:connect':{connect:async()=>({accounts:[account]})},
      'solana:signMessage':{signMessage:async({message}:{message:Uint8Array})=>[{signedMessage:message.slice(),signature:new Uint8Array(sign(null,message,keys.privateKey))}]},
    }};
    const p=provider(),providerFetch=globalThis.fetch;
    vi.stubGlobal('fetch',vi.fn(async(input:any,init?:RequestInit)=>{
      if(!String(input).startsWith('/api/'))return providerFetch(input,init);
      const result=await client.post(String(input)).set(headers).send(JSON.parse(String(init?.body||'{}')));
      return Response.json(result.body,{status:result.status});
    }));
    expect((await linkWallet(binance)).address).toBe(ownerAddress);
    const proof=await post('/challenge',limits);
    const signature=await signWalletMessage(binance,ownerAddress,proof.body.message);
    expect((await post('/authorize',{id:proof.body.id,signature})).status).toBe(200);
    expect((await chat(`Buy 0.01 SOL of ${MINT}`)).command.reply).toContain('TRADE CONFIRMED');
    expect((await chat(`Sell 2.5 of ${MINT}`)).command.reply).toContain('TRADE CONFIRMED');expect(p.submissions()).toBe(2);
    const withdrawal=await post('/withdrawal/challenge',{mint:SOL,amount:'0.01'});
    const ownerSignature=await signWalletMessage(binance,ownerAddress,withdrawal.body.message);
    expect((await post('/withdrawal',{id:withdrawal.body.id,signature:ownerSignature})).status).toBe(200);expect(p.withdrawals()).toBe(1);
    expect((await client.get('/api/solana/chat-trading')).body.permission.active).toBe(false);
  });
  it('requires account auth, explicit custody consent, and hides signing keys',async()=>{
    expect((await request(app).get('/api/solana/chat-trading')).status).toBe(401);expect((await post('/wallet',{consent:false})).status).toBe(400);
    expect((await other.get('/api/solana/chat-trading')).body.wallet).toBeNull();const snapshot=await client.get('/api/solana/chat-trading');expect(JSON.stringify(snapshot.body)).not.toMatch(/encryptedSecret|privateKey|secretKey|encryptedToken/);expect((await db.solanaTradingWallet.findUnique({where:{userId}})).encryptedSecret).toMatch(/^v1\./);
  });
  it('needs a fresh owner signature bound to the reviewed limits and rejects reuse',async()=>{
    const proof=await post('/challenge',limits);expect(proof.body.message).toContain('not an on-chain');expect(proof.body.message).toContain(tradingAddress);expect(proof.body.message).toContain('0.05 SOL');
    expect((await post('/authorize',{id:proof.body.id,signature:randomBytes(64).toString('base64')})).status).toBe(400);
    const signed=await grant();expect((await post('/authorize',signed)).status).toBe(400);expect((await client.get('/api/solana/chat-trading')).body.permission.active).toBe(true);
  });
  it('rejects unapproved mints, invalid precision, and expired permission proofs',async()=>{
    expect((await post('/challenge',{...limits,allowedMints:[OTHER]})).status).toBe(400);expect((await post('/challenge',{...limits,perTradeSol:'0.0000000001'})).status).toBe(400);
    const proof=await post('/challenge',limits);await db.solanaPermissionChallenge.update({where:{id:proof.body.id},data:{expiresAt:new Date(0)}});expect((await post('/authorize',{id:proof.body.id,signature:sign(null,Buffer.from(proof.body.message),keys.privateKey).toString('base64')})).status).toBe(400);
  });
  it('keeps review links as the default and does not execute web-origin commands',async()=>{
    const p=provider(),before=await chat(`Buy 0.01 SOL of ${MINT}`);expect(before.command.reply).toContain('SWAP REVIEW');expect(p.mock).not.toHaveBeenCalled();await grant();const web=await execute(userId,`Buy 0.01 SOL of ${MINT}`,'WEB',randomUUID());expect(web.command.reply).toContain('SWAP REVIEW');expect(p.submissions()).toBe(0);
  });
});
describe('explicit any-Solana-token permission',()=>{
  it('requires an explicit scope and a fresh signature before widening a restricted grant',async()=>{
    await grant();const p=provider(),proof=await post('/challenge',{...limits,...anyTokens});expect(proof.status).toBe(200);
    expect(proof.body.message).toContain('Token scope: Any supported Solana token');expect(proof.body.message).toContain('outside my agent’s saved mint list');
    expect((await client.get('/api/solana/chat-trading')).body.permission.tokenScope).toBe('AGENT_MINTS');
    expect((await chat(`Buy 0.01 SOL of ${OTHER}`)).command.reply).toContain('outside your signed permission');expect(p.mock).not.toHaveBeenCalled();
    expect((await post('/authorize',{id:proof.body.id,signature:sign(null,Buffer.from(proof.body.message),keys.privateKey).toString('base64')})).status).toBe(200);
    const permission=(await client.get('/api/solana/chat-trading')).body.permission;
    expect(permission.active).toBe(true);expect(permission.tokenScope).toBe('ANY_SOLANA');expect(permission.allowedMints).toEqual([]);
    expect(permission.perTradeSol).toBe(limits.perTradeSol);expect(permission.dailySol).toBe(limits.dailySol);
    expect((await chat('Status')).command.reply).toContain('Token access: any supported Solana token');
  });
  it('uses one approval to buy and sell mints outside the saved agent list',async()=>{
    await grant(anyTokens);const p=provider(),permission=(await client.get('/api/solana/chat-trading')).body.permission;
    expect((await chat(`Buy 0.01 SOL of ${OTHER}`)).command.reply).toContain('TRADE CONFIRMED');
    expect((await chat(`Sell 2.5 of ${OTHER}`)).command.reply).toContain('TRADE CONFIRMED');
    expect((await chat(`Buy 0.01 SOL of ${MINT}`)).command.reply).toContain('TRADE CONFIRMED');
    expect(p.submissions()).toBe(3);const snapshot=(await client.get('/api/solana/chat-trading')).body;
    expect(snapshot.permission.id).toBe(permission.id);expect(snapshot.availableMints).toEqual([MINT]);
    expect(snapshot.trades.every((trade:any)=>trade.walletAddress===tradingAddress)).toBe(true);
  });
  it('does not treat an empty list, unknown scope, or mixed all-token/list request as approval',async()=>{
    for(const input of [{allowedMints:[]},{tokenScope:'ANY'},{tokenScope:'ANY_SOLANA',allowedMints:[MINT]},{tokenScope:'AGENT_MINTS',allowedMints:[]}])expect((await post('/challenge',{...limits,...input})).status).toBe(400);
    expect((await client.get('/api/solana/chat-trading')).body.permission).toBeNull();
  });
  it('rejects a changed challenge payload whose signed message did not authorize broad scope',async()=>{
    const proof=await post('/challenge',limits),stored=await db.solanaPermissionChallenge.findUniqueOrThrow({where:{id:proof.body.id}});
    await db.solanaPermissionChallenge.update({where:{id:stored.id},data:{payload:{...stored.payload,...anyTokens}}});
    expect((await post('/authorize',{id:stored.id,signature:sign(null,Buffer.from(proof.body.message),keys.privateKey).toString('base64')})).status).toBe(409);
    expect((await client.get('/api/solana/chat-trading')).body.permission).toBeNull();
  });
  it('keeps a pre-upgrade signed proof restricted to its original mints',async()=>{
    const proof=await post('/challenge',limits),stored=await db.solanaPermissionChallenge.findUniqueOrThrow({where:{id:proof.body.id}});
    const payload={...stored.payload};delete payload.tokenScope;const message=stored.message.replace('\nToken scope: Only the listed agent tokens','');
    await db.solanaPermissionChallenge.update({where:{id:stored.id},data:{payload,message}});
    expect((await post('/authorize',{id:stored.id,signature:sign(null,Buffer.from(message),keys.privateKey).toString('base64')})).status).toBe(200);
    const permission=(await client.get('/api/solana/chat-trading')).body.permission;expect(permission.tokenScope).toBe('AGENT_MINTS');expect(permission.allowedMints).toEqual([MINT]);
    const p=provider();expect((await chat(`Buy 0.01 SOL of ${OTHER}`)).command.reply).toContain('outside');expect(p.mock).not.toHaveBeenCalled();
  });
  it('allows selecting a Solana agent and granting broad access without saving individual token mints',async()=>{
    const workspace=await db.tradingWorkspace.findUniqueOrThrow({where:{userId}}),instance=await db.instance.findUniqueOrThrow({where:{id:workspace.activeInstanceId}}),version=await db.agentVersion.findUniqueOrThrow({where:{id:instance.versionId}});
    try{
      await db.agentVersion.update({where:{id:version.id},data:{config:{...version.config,symbols:[SOL]}}});
      expect((await post('/agent',{versionId:version.id})).body.versionId).toBe(version.id);
      expect((await client.get('/api/solana/chat-trading')).body.availableMints).toEqual([]);
      await grant(anyTokens);const p=provider();expect((await chat(`Buy 0.01 SOL of ${OTHER}`)).command.reply).toContain('TRADE CONFIRMED');expect(p.submissions()).toBe(1);
    }finally{await db.agentVersion.update({where:{id:version.id},data:{config:version.config}});}
  });
  it('retains per-trade limits and previously reserved daily usage when widening access',async()=>{
    await grant({dailySol:'0.06'});const p=provider();expect((await chat(`Buy 0.03 SOL of ${MINT}`)).command.reply).toContain('TRADE CONFIRMED');
    await grant({...anyTokens,dailySol:'0.06'});
    expect((await chat(`Buy 0.05 SOL of ${OTHER}`)).command.reply).toContain('per-trade budget');
    expect((await chat(`Buy 0.03 SOL of ${OTHER}`)).command.reply).toContain('daily');expect(p.submissions()).toBe(1);
  });
  it('still requires the paired chat and blocks submissions after revoke or expiry',async()=>{
    await grant(anyTokens);const p=provider();
    const web=await execute(userId,`Buy 0.01 SOL of ${OTHER}`,'WEB',randomUUID());expect(web.command.reply).toContain('SWAP REVIEW');
    await expect(execute(userId,`Buy 0.01 SOL of ${OTHER}`,'WHATSAPP',randomUUID(),new Date(),{id:channel.id,ownerId:'user:attacker',leaseToken:'bad'})).rejects.toThrow('changed');
    await chat('Revoke trading');expect((await client.get('/api/solana/chat-trading')).body.permission.active).toBe(false);expect((await chat(`Buy 0.01 SOL of ${OTHER}`)).command.reply).toContain('SWAP REVIEW');
    await grant(anyTokens);await db.solanaTradePermission.updateMany({where:{userId,revokedAt:null},data:{expiresAt:new Date(0)}});expect((await chat(`Buy 0.01 SOL of ${OTHER}`)).command.reply).toContain('SWAP REVIEW');expect(p.submissions()).toBe(0);
  });
  it('blocks a broad-scope order revoked while Jupiter prepares its quote',async()=>{
    await grant(anyTokens);const p=provider({onOrder:async()=>{expect((await post('/revoke')).status).toBe(200);}});
    expect((await chat(`Buy 0.01 SOL of ${OTHER}`)).command.reply).toContain('NOT EXECUTED');expect(p.submissions()).toBe(0);
  });
  it.each([{badInput:true},{overdraw:true},{delegate:true},{badMinimum:true},{router:'dflow'}])('keeps transaction and route protections for broad scope %j',async options=>{
    await grant(anyTokens);const p=provider(options);expect((await chat(`Buy 0.01 SOL of ${OTHER}`)).command.reply).toContain('NOT EXECUTED');expect(p.submissions()).toBe(0);
  });
});

describe('Metis v2 minimum-output decoding',()=>{
  it.each(['route_v2','shared_accounts_route_v2'])('protects the fee-inclusive net minimum for %s',async name=>{
    const {verifyRouteData}=await import('../server/chat-transaction-policy.js');
    const shared=name==='shared_accounts_route_v2',start=shared?9:8,data=Buffer.alloc(start+26);
    createHash('sha256').update(`global:${name}`).digest().subarray(0,8).copy(data);
    // Production /order regression: 67.101857 SI, 1% slippage, 0.1% fee.
    // The encoded output is net; its minimum is 66.430838, not 66.364407.
    data.writeBigUInt64LE(1000000n,start);data.writeBigUInt64LE(67101857n,start+8);data.writeUInt16LE(100,start+16);
    const order={requestId:'regression',transaction:'unused',inputMint:SOL,outputMint:MINT,inAmount:'1000000',outAmount:'67101857',otherAmountThreshold:'66430838',router:'metis'};
    for(const fee of [0,10,100]){
      data.writeUInt16LE(fee,start+18);
      expect(verifyRouteData(data,order,100)).toEqual(shared?{authority:1,source:2,destination:5,inputMint:6,outputMint:7}:{authority:0,source:1,destination:2,inputMint:3,outputMint:4});
      expect(()=>verifyRouteData(data,{...order,otherAmountThreshold:'66430840'},100)).toThrow('minimum output');
    }
    data.writeUInt16LE(101,start+18);expect(()=>verifyRouteData(data,order,100)).toThrow('provider-fee limit');
    data.writeUInt16LE(10,start+18);expect(()=>verifyRouteData(data,order,99)).toThrow('slippage');
    expect(()=>verifyRouteData(data,{...order,inAmount:'1000001'},100)).toThrow('approved input');
  });
});

describe('budgeted Jupiter chat execution',()=>{
  it.each(['BUY','SELL'])('accepts fee-inclusive %s quotes without discounting the net minimum twice',async side=>{
    await grant(anyTokens);const p=provider({feeBps:10});
    const result=await chat(side==='BUY'?`Buy 0.001 SOL of ${OTHER}`:`Sell 2.5 of ${OTHER}`);
    expect(result.command.reply).toContain('TRADE CONFIRMED');expect(p.submissions()).toBe(1);
  });
  it.each([{feeBps:101},{feeBps:10,badRouteMinimum:true},{feeBps:10,badMinimum:true},{feeBps:10,overdraw:true}])('keeps fee, encoded-minimum and simulation guards on fee-inclusive routes %j',async options=>{
    await grant(anyTokens);const p=provider(options);
    expect((await chat(`Buy 0.001 SOL of ${OTHER}`)).command.reply).toContain('NOT EXECUTED');expect(p.submissions()).toBe(0);
    expect((await db.solanaChatTrade.findFirst({where:{userId}})).signature).toBeNull();
  });
  it('buys directly from the dedicated wallet and verifies the server-created signature',async()=>{
    await grant();const p=provider(),result=await chat(`Buy 0.01 SOL of ${MINT}`);expect(result.command.reply,JSON.stringify(result)).toContain('TRADE CONFIRMED');expect(result.command.reply).not.toContain('localhost');expect(p.submissions()).toBe(1);const trade=await db.solanaChatTrade.findFirst({where:{userId}});expect(trade.budgetLamports).toBe('11000000');expect(trade.walletAddress).toBe(tradingAddress);expect(trade.walletAddress).not.toBe(ownerAddress);
  });
  it('sells token quantities for SOL and charges quoted SOL value to the budget',async()=>{
    await grant();const p=provider(),result=await chat(`Sell 2.5 of ${MINT}`);expect(result.command.reply).toContain('TRADE CONFIRMED');expect(p.submissions()).toBe(1);expect((await db.solanaChatTrade.findFirst({where:{userId}})).quote.inputAmount).toBe('2500000');
  });
  it('enforces per-trade totals including reserved fees before asking for a quote',async()=>{
    await grant();const p=provider(),result=await chat(`Buy 0.05 SOL of ${MINT}`);expect(result.command.reply).toContain('per-trade budget');expect(p.mock).not.toHaveBeenCalled();
  });
  it('enforces daily totals across replacement permissions without resetting usage',async()=>{
    await grant({dailySol:'0.06'});const p=provider();expect((await chat(`Buy 0.03 SOL of ${MINT}`)).command.reply).toContain('CONFIRMED');await grant({dailySol:'0.06'});expect((await chat(`Buy 0.03 SOL of ${MINT}`)).command.reply).toContain('daily');expect(p.submissions()).toBe(1);
  });
  it('blocks tokens outside the signed list and never accepts a forged chat lease',async()=>{
    await grant();const p=provider();expect((await chat(`Buy 0.01 SOL of ${OTHER}`)).command.reply).toContain('outside');await expect(execute(userId,`Buy 0.01 SOL of ${MINT}`,'WHATSAPP',randomUUID(),new Date(),{id:channel.id,ownerId:'user:attacker',leaseToken:'bad'})).rejects.toThrow('changed');expect(p.mock).not.toHaveBeenCalled();
  });
  it.each([{badInput:true},{overdraw:true},{delegate:true},{badMinimum:true}])('blocks unsafe transaction data or simulation %j',async options=>{
    await grant();const p=provider(options),result=await chat(`Buy 0.01 SOL of ${MINT}`);expect(result.command.reply).toContain('NOT EXECUTED');expect(p.submissions()).toBe(0);
  });
  it('claims duplicate message deliveries once, including concurrent delivery',async()=>{
    await grant();const p=provider(),id=randomUUID();await Promise.all([chat(`Buy 0.01 SOL of ${MINT}`,id),chat(`Buy 0.01 SOL of ${MINT}`,id)]);await chat(`Buy 0.01 SOL of ${MINT}`,id);expect(p.submissions()).toBe(1);expect(await db.solanaChatTrade.count({where:{userId}})).toBe(1);
  });
  it('revokes during quote preparation and blocks signing/submission',async()=>{
    await grant();const p=provider({onOrder:async()=>{expect((await post('/revoke')).status).toBe(200);}});const result=await chat(`Buy 0.01 SOL of ${MINT}`);expect(result.command.reply).toContain('NOT EXECUTED');expect(p.submissions()).toBe(0);
  });
  it('retains unknown submissions, never resends, and checks confirmation from chat',async()=>{
    await grant();const p=provider({timeout:true}),id=randomUUID();expect((await chat(`Buy 0.01 SOL of ${MINT}`,id)).command.reply).toContain('CONFIRMATION PENDING');await chat(`Buy 0.01 SOL of ${MINT}`,id);expect((await chat(`Buy 0.01 SOL of ${MINT}`)).command.reply).toContain('needs confirmation');expect(p.submissions()).toBe(1);expect((await chat('Check trade')).command.reply).toContain('TRADE CONFIRMED');expect(p.submissions()).toBe(1);
  });
  it('honors expiry, global disable, chat revoke, and emergency stop without auto-resume',async()=>{
    await grant();const p=provider();process.env.SOLANA_CHAT_TRADING_ENABLED='false';expect((await chat(`Buy 0.01 SOL of ${MINT}`)).command.reply).toContain('disabled');expect(p.submissions()).toBe(0);delete process.env.SOLANA_CHAT_TRADING_ENABLED;
    await chat('Revoke trading');expect((await client.get('/api/solana/chat-trading')).body.permission.active).toBe(false);await grant();await client.post('/api/emergency-stop').set(headers).send({});await client.post('/api/emergency-stop/clear').set(headers).send({});expect((await client.get('/api/solana/chat-trading')).body.permission.active).toBe(false);
    await grant();await db.solanaTradePermission.updateMany({where:{userId,revokedAt:null},data:{expiresAt:new Date(0)}});expect((await chat(`Buy 0.01 SOL of ${MINT}`)).command.reply).toContain('SWAP REVIEW');expect(p.submissions()).toBe(0);
  });
  it('authenticates production dispatch when the shared worker has no Jupiter key',async()=>{
    await db.personalAgentChannel.update({where:{id:channel.id},data:{appUrl:'https://wagent-ai.vercel.app'}});environment.appUrl='https://wagent-ai.vercel.app';await grant();environment.appUrl='http://localhost:5173';const p=provider(),base=p.mock;let delegated=0;delete process.env.JUPITER_API_KEY;
    vi.stubGlobal('fetch',vi.fn(async(url:any,init?:any)=>{
      if(String(url)==='https://wagent-ai.vercel.app/api/solana/capabilities')return Response.json({swapsEnabled:true});
      if(String(url).endsWith('/api/solana/chat-trading/execute-command')){delegated++;expect(init.headers['X-Wagent-Worker-Signature']).toMatch(/^sha256=/);environment.appUrl='https://wagent-ai.vercel.app';process.env.JUPITER_API_KEY='jupiter-production-fixture';try{const response=await request(app).post('/api/solana/chat-trading/execute-command').set(init.headers).send(JSON.parse(init.body));expect(response.status,JSON.stringify(response.body)).toBe(200);return Response.json(response.body);}finally{environment.appUrl='http://localhost:5173';delete process.env.JUPITER_API_KEY;}}
      return base(url,init);
    }));expect((await chat(`Buy 0.01 SOL of ${MINT}`)).command.reply).toContain('TRADE CONFIRMED');expect(delegated).toBe(1);expect(p.submissions()).toBe(1);
  });
  it('rejects unsigned remote execution requests',async()=>{
    await grant();const p=provider();expect((await request(app).post('/api/solana/chat-trading/execute-command').set(headers).send({commandId:randomUUID(),channelId:channel.id,leaseToken:'test-lease',at:Date.now()})).status).toBe(403);expect(p.submissions()).toBe(0);
  });
  it('rejects a local grant moved to a production channel and directs setup to that website',async()=>{
    await grant();await db.personalAgentChannel.update({where:{id:channel.id},data:{appUrl:'https://wagent-ai.vercel.app'}});const p=provider();expect((await chat(`Buy 0.01 SOL of ${MINT}`)).command.reply).toContain('different website');expect(p.submissions()).toBe(0);expect((await post('/challenge',limits)).status).toBe(409);expect((await client.get('/api/solana/chat-trading')).body.permission.active).toBe(false);
  });
  it('serializes revocation against a submission already in progress',async()=>{
    await grant();let started!:()=>void,release!:()=>void;const submitting=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});const p=provider({onSubmit:async()=>{started();await gate;}}),running=chat(`Buy 0.01 SOL of ${MINT}`);await submitting;
    let revoked=false;const revocation=post('/revoke').then((result:any)=>{revoked=true;expect(result.status).toBe(200);});await new Promise(resolve=>setTimeout(resolve,30));expect(revoked).toBe(false);release();await Promise.all([running,revocation]);expect((await chat(`Buy 0.01 SOL of ${MINT}`)).command.reply).toContain('SWAP REVIEW');expect(p.submissions()).toBe(1);
  });
});
describe('owner-signed fund withdrawals',()=>{
  it('fixes the recipient, requires the original owner signature, and revokes trading',async()=>{
    await grant();provider();expect((await post('/withdrawal/challenge',{mint:SOL,amount:'0.1',recipient:OTHER})).status).toBe(400);const proof=await post('/withdrawal/challenge',{mint:SOL,amount:'0.1'});expect(proof.status).toBe(200);expect(proof.body.message).toContain(ownerAddress);expect((await client.get('/api/solana/chat-trading')).body.permission.active).toBe(false);expect((await post('/withdrawal',{id:proof.body.id,signature:randomBytes(64).toString('base64')})).status).toBe(400);
  });
  it('submits an owner-approved SOL transfer once and reconciles without resending',async()=>{
    await grant();const p=provider(),proof=await post('/withdrawal/challenge',{mint:SOL,amount:'0.1'}),body={id:proof.body.id,signature:sign(null,Buffer.from(proof.body.message),keys.privateKey).toString('base64')};
    const response=await post('/withdrawal',body);expect(response.status,JSON.stringify(response.body)).toBe(200);expect(p.withdrawals()).toBe(1);const decoded=getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(p.sent[0],'base64')).messageBytes);expect(decoded.staticAccounts[1]).toBe(ownerAddress);expect((await post('/withdrawal',body)).status).toBe(400);expect((await post(`/withdrawals/${response.body.id}/reconcile`)).body.status).toBe('CONFIRMED');expect(p.withdrawals()).toBe(1);
  });
  it('returns SPL tokens to the original owner’s derived token account',async()=>{
    const p=provider(),proof=await post('/withdrawal/challenge',{mint:MINT,amount:'2'}),response=await post('/withdrawal',{id:proof.body.id,signature:sign(null,Buffer.from(proof.body.message),keys.privateKey).toString('base64')});expect(response.status,JSON.stringify(response.body)).toBe(200);expect(p.withdrawals()).toBe(1);const decoded=getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(Buffer.from(p.sent[0],'base64')).messageBytes);expect(decoded.staticAccounts).toContain(ownerAddress);expect(decoded.staticAccounts).toContain(MINT);expect((await other.post(`/api/solana/chat-trading/withdrawals/${response.body.id}/reconcile`).set(headers).send({})).status).toBe(404);
  });
});
