import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
try{await readFile('.env.supabase.local');console.log('.env.supabase.local already exists; left it unchanged.');}
catch(e){if(e.code!=='ENOENT')throw e;const example=await readFile('supabase.env.example','utf8');await writeFile('.env.supabase.local',example.replace('replace_with_existing_64_character_encryption_key',randomBytes(32).toString('hex')),{flag:'wx',mode:0o600});console.log('.env.supabase.local created. Set the Supabase connection. Retain the original encryption key when connecting to an existing database. Never commit this file.');}
