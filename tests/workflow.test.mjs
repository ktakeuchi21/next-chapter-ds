import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {cleanup} from '../scripts/cleanup-test-item.mjs';
import {base,localWrangler} from './local-api.mjs';
const wrangler=localWrangler;
test('a real local Workflow persists a pre-provider failure and releases its active-job slot',async()=>{
 const response=await fetch(base+'/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Integration test workflow'})});assert.equal(response.status,201);const item=await response.json();const jobId=randomUUID(),date=new Date().toISOString();
 try{
  wrangler(['d1','execute','next-chapter','--local','--command',`INSERT INTO jobs(id,item_id,kind,media_id,created_at,updated_at) VALUES('${jobId}','${item.id}','transcribe','missing-test-recording','${date}','${date}');`]);
  // Missing audio fails before any OpenAI request, even when real credentials are configured.
  wrangler(['workflows','trigger','next-chapter-item-workflow',JSON.stringify({jobId,itemId:item.id,kind:'transcribe',mediaId:'missing-test-recording'}),'--id',jobId,'--local']);
  let job;const deadline=Date.now()+30000;
  do{const detail=await (await fetch(`${base}/items/${item.id}`)).json();job=detail.jobs.find(j=>j.id===jobId);if(job?.state==='failed')break;await new Promise(resolve=>setTimeout(resolve,250));}while(Date.now()<deadline);
  assert.equal(job?.state,'failed');assert.match(job.error,/Recording was not found/);
  const check=await fetch(`${base}/items/${item.id}/jobs/check`,{method:'POST'});assert.equal(check.status,200);assert.deepEqual((await check.json()).states,[]);
  const persisted=await (await fetch(`${base}/items/${item.id}`)).json();assert.equal(persisted.jobs[0].state,'failed');
 }finally{await cleanup(item.id);}
});
