import {spawnSync} from 'node:child_process';

export const base=process.env.NEXT_CHAPTER_TEST_API||'http://127.0.0.1:8787/api';
const target=new URL(base);
if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.protocol!=='http:')throw Error('Integration tests require a local HTTP API.');
export function localWrangler(args){
 const command=[...args];if(args[0]==='workflows')command.push('--port',target.port||'80');
 if(process.env.NEXT_CHAPTER_TEST_CONFIG)command.push('--config',process.env.NEXT_CHAPTER_TEST_CONFIG);
 if(process.env.NEXT_CHAPTER_TEST_STATE&&args[0]!=='workflows')command.push('--persist-to',process.env.NEXT_CHAPTER_TEST_STATE);
 const result=spawnSync('npx',['wrangler',...command],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'./work/integration-checks.log'},maxBuffer:8*1024*1024});
 if(result.status!==0)throw Error('Local test database operation failed: '+(result.stderr||result.stdout));
 return result.stdout;
}
