import 'dotenv/config';
import {getAddress} from 'ethers';
import {readFile} from 'node:fs/promises';
if(!process.env.CREDENTIAL_ENCRYPTION_KEY)process.env.CREDENTIAL_ENCRYPTION_KEY=await readFile('.data/encryption-key','utf8');
if(!process.env.DATABASE_URL)process.env.DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5433/postgres';
await import('../server/env.js');
const {db}=await import('../server/db.js');
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)]}));
if(!args['--user-id']||!args['--address'])throw new Error('Usage: npm run wallet:assign -- --user-id=USER_ID --address=0xYOUR_WALLET');
const walletAddress=getAddress(args['--address']).toLowerCase();
try{
  const user=await db.user.findUnique({where:{id:args['--user-id']}});if(!user)throw new Error('Existing user not found');
  if(user.walletAddress&&user.walletAddress!==walletAddress)throw new Error('This user already has a linked wallet; existing links are not overwritten');
  const linked=await db.user.findUnique({where:{walletAddress}});if(linked&&linked.id!==user.id)throw new Error('Wallet is already assigned to another user');
  await db.user.update({where:{id:user.id},data:{walletAddress}});await db.session.deleteMany({where:{userId:user.id}});
  console.log(`Wallet ${getAddress(walletAddress)} linked to ${user.id}. Sign in with MetaMask to prove ownership.`);
}finally{await db.$disconnect()}
