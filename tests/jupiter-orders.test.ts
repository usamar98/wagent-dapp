import { beforeAll, afterEach, describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

const SOL='So11111111111111111111111111111111111111112',TOKEN='JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
let order:typeof import('../server/solana-providers.js').jupiterOrder;
beforeAll(async()=>{
  Object.assign(process.env,{NODE_ENV:'test',DEMO_MODE:'false',CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),JUPITER_API_KEY:'fixture-key-only'});
  ({jupiterOrder:order}=await import('../server/solana-providers.js'));
});
afterEach(()=>vi.unstubAllGlobals());
describe('Jupiter order errors',()=>{
  it.each([
    ['metis',1,SOL,'not have enough native SOL'],
    ['metis',1,TOKEN,'token you are selling'],
    ['dflow',2,SOL,'needs native SOL for network fees'],
    ['okx',3,SOL,'minimum size for gasless'],
    ['jupiterz',1,SOL,'cannot fund it'],
    ['jupiterz',2,SOL,'required token account'],
    ['jupiterz',3,SOL,'fresh quote'],
    ['unknown-router',2,SOL,'Jupiter cannot prepare this swap'],
  ])('interprets %s error %s using its router, not the number alone',async(router,errorCode,inputMint,expected)=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({router,errorCode,transaction:''}));vi.stubGlobal('fetch',fetcher);
    await expect(order(String(inputMint),String(inputMint)===SOL?TOKEN:SOL,'1000000',SOL,100)).rejects.toThrow(String(expected));
    expect(fetcher).toHaveBeenCalledTimes(1);expect(String(fetcher.mock.calls[0][0])).toContain('/swap/v2/order?');
  });
  it('does not repeat provider-supplied instructions or claim an unknown router code is a fee problem',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({router:'unrecognized',errorCode:2,errorMessage:'UNTRUSTED PROVIDER INSTRUCTION',transaction:''})));
    const failure=await order(SOL,TOKEN,'1000000',SOL,100).catch(error=>error);
    expect(failure.status).toBe(400);expect(failure.message).not.toContain('UNTRUSTED');expect(failure.message).toContain('No swap was submitted');
  });
  it('rejects an absent transaction without presenting pricing as an executable swap',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({transaction:null,router:'metis',outAmount:'100'})));
    await expect(order(SOL,TOKEN,'1000000',SOL,100)).rejects.toThrow('cannot prepare');
  });
  it('reports malformed provider data without treating it as an API-key or wallet failure',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json(null)));
    await expect(order(SOL,TOKEN,'1000000',SOL,100)).rejects.toThrow('unsupported order response');
  });
});
