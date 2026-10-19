import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultConfig} from '../shared/config.js';
const execute=promisify(execFile);
it('self-hosted runner persists one paper order on retry and honors emergency stop',async()=>{
  const directory=resolve('.data',`runner-test-${randomUUID()}`);await mkdir(directory,{recursive:true});const configPath=resolve(directory,'agent.json');await writeFile(configPath,JSON.stringify({format:'agentbazaar-export-v1',agent:{name:'Runner fixture',version:1},config:{...defaultConfig,strategy:'price_alert',entry:1000000,exit:2000000},license:{environment:'DEMO'}}));
  const run=(command?:string)=>execute(process.execPath,['--import','tsx','runner/index.ts',...(command?[command]:[])],{env:{...process.env,AGENT_CONFIG_PATH:configPath,RUNNER_STATE_DIR:directory,RUNNER_ONCE:'true'},timeout:20000});
  const first=await run();expect(first.stdout).toContain('LOCAL NOTIFICATION SIMULATOR');await run();const ledger=JSON.parse(await readFile(resolve(directory,'ledger.json'),'utf8'));expect(ledger.runs).toHaveLength(1);expect(ledger.orders).toHaveLength(1);expect(ledger.signals).toHaveLength(1);expect(ledger.cashCents).toBe(980000);await run('emergency-stop');await expect(run('start')).rejects.toThrow();await run('clear-emergency');expect(JSON.parse(await readFile(resolve(directory,'control.json'),'utf8')).status).toBe('STOPPED');
});
