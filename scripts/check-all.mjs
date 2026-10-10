import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createTestEnvironment} from './test-environment.mjs';

const fixture=await createTestEnvironment();
const port=await new Promise((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
const env={...process.env,NEXT_CHAPTER_TEST_API:`http://127.0.0.1:${port}/api`,NEXT_CHAPTER_TEST_CONFIG:fixture.config,NEXT_CHAPTER_TEST_STATE:fixture.persist,WRANGLER_REGISTRY_PATH:join(fixture.directory,'registry'),WRANGLER_LOG_PATH:join(fixture.directory,'wrangler.log'),CI:'true'};
let server;const checks=[];
function run(command,args,label){return new Promise((resolve,reject)=>{
 console.log(`\nChecking ${label}`);const start=Date.now();const child=spawn(command,args,{env,stdio:'inherit'});
 child.on('error',reject);child.on('exit',code=>{checks.push({label,passed:code===0,durationMs:Date.now()-start});code===0?resolve():reject(Error(`${label} failed (${code})`));});
});}
try{
 if(!process.argv.includes('--integration-only')){await run('npm',['run','build'],'typecheck and production build');await run('npm',['test'],'unit and contract tests');}
 await run('npx',['wrangler','d1','migrations','apply','next-chapter','--local','--config',fixture.config,'--persist-to',fixture.persist],'fresh database migrations');
 server=spawn('npx',['wrangler','dev','--config',fixture.config,'--persist-to',fixture.persist,'--ip','127.0.0.1','--port',String(port),'--inspector-port','0'],{env,detached:true,stdio:['ignore','pipe','pipe']});
 let logs='';for(const stream of [server.stdout,server.stderr])stream.on('data',b=>{logs=(logs+b.toString()).slice(-32000);});
 let ready=false;for(let i=0;i<120;i++){
  try{const response=await fetch(env.NEXT_CHAPTER_TEST_API+'/config');if(response.ok){const cfg=await response.json();if(cfg.local!==true||cfg.aiConnected!==false)throw Error('Test isolation failed: remote or AI-enabled API');ready=true;break;}}catch(e){if(e.message.startsWith('Test isolation'))throw e;}
  if(server.exitCode!==null)break;await new Promise(r=>setTimeout(r,500));
 }
 await writeFile(join(fixture.directory,'server-startup.log'),logs);
 if(!ready)throw Error('Isolated API did not start; inspect '+join(fixture.directory,'server-startup.log'));
 await run(process.execPath,['--test','--test-concurrency=1','tests/integration.test.mjs','tests/intake-integration.mjs','tests/pickup-integration.mjs','tests/browser-helper-integration.mjs','tests/orders-integration.mjs','tests/marketplace-integration.mjs','tests/workflow.test.mjs','tests/api-edgecases.test.mjs','tests/research-history-integration.mjs'],'API, bulk capture, pickup, orders, marketplace and Workflow integration');
 await run(process.execPath,['--test','--test-concurrency=1','tests/marketplace-runtime.test.mjs','tests/backup-restore.test.mjs'],'Worker transport and backup restore integration');
 console.log('\nAll checks passed. Live AI and marketplace account verification remain separate.');
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
 if(server?.pid){try{process.kill(-server.pid,'SIGTERM');}catch{}}
 await writeFile(join(fixture.directory,'results.json'),JSON.stringify({checkedAt:new Date().toISOString(),isolated:true,liveProvidersTested:false,passed:!process.exitCode,checks},null,2));
 console.log('Audit evidence: '+fixture.directory);
}
