import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
try{await readFile('.env');console.log('.env already exists; left it unchanged.');}
catch(e){if(e.code!=='ENOENT')throw e;const example=await readFile('.env.example','utf8');await writeFile('.env',example.replace('replace_with_64_random_hex_characters',randomBytes(32).toString('hex')),{flag:'wx',mode:0o600});console.log('.env created with a random credential encryption key. Never commit this file.');}
