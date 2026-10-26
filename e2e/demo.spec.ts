import {test,expect} from '@playwright/test';
const mint='So11111111111111111111111111111111111111112';
const token={mint,pairAddress:mint,name:'Browser fixture token',symbol:'FIXTURE',dex:'fixture',priceUsd:1,change24h:2,volume24h:3000,liquidityUsd:20000,marketCap:null,pairCreatedAt:Date.now()-3600000,screenerUrl:`https://dexscreener.com/solana/${mint}`,toolsUrl:`https://www.dextools.io/app/en/solana/pair-explorer/${mint}`};
const feed={tokens:[token],source:'DEX Screener',fetchedAt:new Date().toISOString(),stale:false,coverage:'Browser-only fixture'};

test('Solana discovery, protected trading, responsive navigation and contained tables',async({page})=>{
  await page.route('**/api/solana/tokens**',route=>route.fulfill({json:feed}));
  await page.route('**/api/bootstrap',route=>route.fulfill({json:{user:null,demo:false}}));
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Your Solana edge. One WhatsApp away.'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Open FIXTURE on DEXTools'})).toHaveAttribute('href',token.toolsUrl);
  await page.getByRole('link',{name:'Buy & sell',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your agent starts here.'})).toBeVisible();
  await page.getByRole('link',{name:'Token explorer',exact:true}).click();
  await page.getByRole('textbox',{name:'Search Solana tokens'}).fill(mint);await page.getByRole('button',{name:'Search',exact:true}).click();
  await expect(page).toHaveURL(new RegExp('q='+mint));
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Open navigation'}).click();await expect(page.getByRole('link',{name:'WhatsApp connection',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Token alerts',exact:true}).click();await expect(page.getByRole('heading',{name:'Your agent starts here.'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('private builder saves exact Solana mints and points to WhatsApp setup',async({page})=>{
  await page.route('**/api/bootstrap',route=>route.fulfill({json:{user:{id:'browser-fixture',name:'Browser fixture',walletAddress:'0x1111111111111111111111111111111111111111',emergencyStop:false},demo:false}}));
  let payload:any;
  await page.route('**/api/agents',async route=>{payload=route.request().postDataJSON();await route.fulfill({status:201,json:{id:'browser-agent',versions:[{id:'browser-version'}]}})});
  await page.goto('/builder');await page.getByLabel('Agent name').fill('My Solana monitor');
  await page.getByLabel('What should it focus on?').fill('Follow selected Solana token mints and save a private agent configuration.');
  await page.getByLabel('Solana mint addresses').fill(mint);await page.getByRole('button',{name:'Create private agent'}).click();
  await expect(page.getByRole('heading',{name:'Now give it a conversation.'})).toBeVisible();
  expect(payload.config.network).toBe('solana');expect(payload.config.market).toBe('crypto');expect(payload.config.symbols).toEqual([mint]);
  await expect(page.getByRole('link',{name:'Connect WhatsApp',exact:true})).toHaveAttribute('href','/connections');
});

test('MetaMask identity is clearly separate from Solana transaction signing',async({page})=>{
  await page.route('**/api/bootstrap',route=>route.fulfill({json:{user:null,demo:false}}));
  await page.goto('/auth');await expect(page.getByRole('heading',{name:'Connect your account',exact:true})).toBeVisible();
  await expect(page.getByText(/This connects your workspace identity using an EVM account/)).toBeVisible();
  await page.getByRole('button',{name:'Continue with MetaMask'}).click();await expect(page.getByRole('alert')).toContainText('MetaMask was not detected');
});
