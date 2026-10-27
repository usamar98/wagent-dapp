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
const post=(path:string,body:unknown={})=>client.post(`/api/solana/chat-trading${path}`).set(headers).send(body);
async function login(client:any){const wallet=Wallet.createRandom(),challenge=await client.post('/api/auth/wallet/challenge').set(headers).send({address:wallet.address,chainId:1});expect(challenge.status).toBe(200);expect((await client.post('/api/auth/wallet/verify').set(headers).send({signature:await wallet.signMessage(challenge.body.message)})).status).toBe(200);return (await client.get('/api/bootstrap')).body.user.id;}
async function grant(change:Record<string,unknown>={}){const proof=await post('/challenge',{...limits,...change});expect(proof.status,JSON.stringify(proof.body)).toBe(200);const signature=sign(null,Buffer.from(proof.body.message),keys.privateKey).toString('base64');const result=await post('/authorize',{id:proof.body.id,signature});expect(result.status,JSON.stringify(result.body)).toBe(200);return {id:proof.body.id,signature};}
async function chat(text:string,id=randomUUID()){return execute(userId,text,'WHATSAPP',id,new Date(),{id:channel.id,ownerId:channel.ownerId,leaseToken:'test-lease'});}
function tokenData(mint:string,amount:bigint,delegate=0){const data=Buffer.alloc(165);Buffer.from(bs58.decode(mint)).copy(data);Buffer.from(bs58.decode(tradingAddress)).copy(data,32);data.writeBigUInt64LE(amount,64);data.writeUInt32LE(delegate,72);data[108]=1;return {owner:TOKEN,lamports:2039280,executable:false,data:[data.toString('base64'),'base64']};}
function systemAccount(amount:number){return {owner:SYSTEM,lamports:amount,executable:false,data:['','base64']};}
function unsigned(side:string,amount:string,out:string,badInput=false){
  const addresses=[tradingAddress,source,destination,side==='BUY'?SOL:MINT,side==='BUY'?MINT:SOL,JUP,TOKEN],data=Buffer.alloc(34);
  createHash('sha256').update('global:route_v2').digest().subarray(0,8).copy(data);data.writeBigUInt64LE(BigInt(amount)+(badInput?1n:0n),8);data.writeBigUInt64LE(BigInt(out),16);data.writeUInt16LE(100,24);data.writeUInt32LE(1,30);
  const accounts=Buffer.from([0,1,2,3,4,6,6,2,5,5]),message=Buffer.concat([Buffer.from([1,0,2,addresses.length]),...addresses.map(a=>Buffer.from(bs58.decode(a))),Buffer.alloc(32),Buffer.from([1,5,accounts.length]),accounts,Buffer.from([data.length]),data]);
  return Buffer.concat([Buffer.from([1]),Buffer.alloc(64),message]).toString('base64');
}
function provider(options:{timeout?:boolean;badInput?:boolean;overdraw?:boolean;delegate?:boolean;onOrder?:()=>Promise<void>;onSubmit?:()=>Promise<void>;unknown?:boolean;badMinimum?:boolean}={}){
  let submissions=0,withdrawals=0,side='BUY',input='10000000',output='1000000',lastWire='';const sent:string[]=[];
  const mock=vi.fn(async(url:any,init?:any):Promise<Response>=>{
    if(String(url).includes('/tokens/v2/'))return Response.json([{id:MINT,name:'Fixture',symbol:'TEST',decimals:6}]);
    if(String(url).includes('/swap/v2/order')){const p=new URL(url).searchParams;side=p.get('inputMint')===SOL?'BUY':'SELL';input=p.get('amount')!;output=side==='BUY'?'1000000':'10000000';lastWire=unsigned(side,input,output,options.badInput);if(options.onOrder)await options.onOrder();return Response.json({requestId:randomUUID(),transaction:lastWire,inputMint:p.get('inputMint'),outputMint:p.get('outputMint'),inAmount:input,outAmount:output,otherAmountThreshold:String(BigInt(output)*99n/100n),router:'metis',slippageBps:100,lastValidBlockHeight:'100',signatureFeePayer:tradingAddress});}
    if(String(url).includes('/swap/v2/execute')){submissions++;const signed=JSON.parse(init.body).signedTransaction,tx=getTransactionDecoder().decode(Buffer.from(signed,'base64'));const {validateSignedSwap}=await import('../server/solana-swaps.js');const signature=validateSignedSwap(lastWire,signed,tradingAddress);expect(Object.keys(tx.signatures)).toEqual([tradingAddress]);sent.push(signed);if(options.onSubmit)await options.onSubmit();if(options.timeout)throw new Error('timeout');return Response.json({status:'Success',code:0,signature});}
    const payload=JSON.parse(init?.body||'{}'),method=payload.method;
    if(method==='getMultipleAccounts')return Response.json({result:{context:{slot:100},value:payload.params[0].map((a:string)=>a===tradingAddress?systemAccount(1000000000):a===source?tokenData(side==='BUY'?SOL:MINT,side==='BUY'?0n:100000000n):a===destination?tokenData(side==='BUY'?MINT:SOL,0n):{owner:SYSTEM,lamports:0,executable:false,data:['','base64']})}});
    if(method==='getFeeForMessage')return Response.json({result:{value:5000}});
    if(method==='getBalance')return Response.json({result:{value:1000000000}});
    if(method==='simulateTransaction'){
      const tx=getTransactionDecoder().decode(Buffer.from(payload.params[0],'base64')),message=getCompiledTransactionMessageDecoder().decode(tx.messageBytes);if(message.version===1)throw new Error('Unsupported fixture version');const isSwap=message.staticAccounts.includes(JUP as any);
      if(!isSwap){const ix=message.instructions.at(-1)!,data=Buffer.from(ix.data||[]),isSol=message.staticAccounts[ix.programAddressIndex]===SYSTEM,amount=isSol?data.readBigUInt64LE(4):0n;return Response.json({result:{value:{err:null,accounts:[systemAccount(1000000000-Number(amount)-5000)]}}});}
      const native=side==='BUY'?1000000000-Number(input)-5000:1000000000+Number(output)-5000;
      return Response.json({result:{value:{err:null,accounts:payload.params[1].accounts.addresses.map((a:string)=>a===tradingAddress?systemAccount(native-(options.overdraw?10000000:0)):a===source?tokenData(side==='BUY'?SOL:MINT,side==='BUY'?0n:100000000n-BigInt(input)):tokenData(side==='BUY'?MINT:SOL,side==='BUY'?(options.badMinimum?0n:BigInt(output)):0n,options.delegate?1:0))}}});
    }
    if(method==='getSignatureStatuses')return Response.json({result:{value:[options.unknown?null:{err:null,confirmationStatus:'confirmed'}]}});
    if(method==='getBlockHeight')return Response.json({result:1000});
    if(method==='getLatestBlockhash')return Response.json({result:{value:{blockhash:bs58.encode(randomBytes(32)),lastValidBlockHeight:100}}});
    if(method==='getTokenAccountsByOwner')return Response.json({result:{value:payload.params[1].mint?[{pubkey:source,account:{owner:TOKEN,data:{parsed:{info:{owner:tradingAddress,mint:MINT,tokenAmount:{amount:'100000000',decimals:6}}}}}}]:[]}});
    if(method==='sendTransaction'){withdrawals++;sent.push(payload.params[0]);const tx=getTransactionDecoder().decode(Buffer.from(payload.params[0],'base64'));return Response.json({result:bs58.encode(tx.signatures[tradingAddress as keyof typeof tx.signatures]!)});}
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
beforeEach(async()=>{vi.unstubAllGlobals();headers['X-Vercel-Forwarded-For']=`198.51.100.${++testIp}`;environment.appUrl='http://localhost:5173';process.env.JUPITER_API_KEY='jupiter-test';process.env.SOLANA_SWAPS_ENABLED='true';delete process.env.SOLANA_CHAT_TRADING_ENABLED;await db.solanaChatTrade.deleteMany({where:{userId}});await db.solanaWalletWithdrawal.deleteMany({where:{userId}});await db.agentCommand.deleteMany({where:{userId}});await db.solanaPermissionChallenge.deleteMany({where:{userId}});await db.solanaTradePermission.deleteMany({where:{userId}});await db.user.update({where:{id:userId},data:{emergencyStop:false}});await db.personalAgentChannel.update({where:{id:channel.id},data:{appUrl:null,tokenFingerprint:'fixture-key-fingerprint',ownerId:'user:owner',enabled:true,leaseToken:'test-lease',leaseUntil:new Date(Date.now()+3600000)}});channelRuntime.clearWebsiteRuntimeCache();});
afterEach(()=>vi.unstubAllGlobals());afterAll(async()=>{await db?.close();await socket?.stop();await pg?.close();});

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
describe('budgeted Jupiter chat execution',()=>{
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
