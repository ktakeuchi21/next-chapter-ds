import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {base,localWrangler} from './local-api.mjs';
import {cleanup} from '../scripts/cleanup-test-item.mjs';
const created=[];
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
async function get(path){const r=await fetch(base+path);return {status:r.status,data:await r.json()};}
test('research history preserves each report, paginates older searches and scopes access to the item',async()=>{
 for(let i=0;i<2;i++){
  const r=await fetch(base+'/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Integration test research history '+i,price:72})});assert.equal(r.status,201);created.push((await r.json()).id);
 }
 const [id,other]=created,ids=Array.from({length:12},(_,i)=>`${id}-research-${String(i).padStart(2,'0')}`);
 const report=i=>({text:`Search ${i}: earlier recommendation $${i+20}.`,sources:[{title:`Comparison ${i}`,url:`https://example.com/${i}`}],researchedAt:'2026-09-21T12:00:00.000Z'});
 const sql=[];
 for(let i=0;i<12;i++)sql.push(`INSERT INTO jobs(id,item_id,kind,state,result,created_at,updated_at) VALUES(${quote(ids[i])},${quote(id)},'research','completed',${quote(JSON.stringify(report(i)))},'2026-09-21T12:00:00.000Z','2026-09-21T12:01:00.000Z');`);
 // Enough more recent note jobs to push all research outside the item's last-20 task list.
 for(let i=0;i<22;i++)sql.push(`INSERT INTO jobs(id,item_id,kind,state,created_at,updated_at) VALUES(${quote(id+'-note-'+i)},${quote(id)},'notes','completed','2026-09-22T12:00:00.000Z','2026-09-22T12:01:00.000Z');`);
 sql.push(`UPDATE items SET research=${quote(JSON.stringify({...report(99),text:'The latest item report is different.'}))} WHERE id=${quote(id)};`);
 localWrangler(['d1','execute','next-chapter','--local','--command',sql.join('\n')]);
 assert.equal((await get(`/items/${id}`)).data.jobs.filter(j=>j.kind==='research').length,0);
 const first=await get(`/items/${id}/research-history`);assert.equal(first.status,200);assert.equal(first.data.runs.length,10);assert.ok(first.data.nextCursor);
 assert.equal(first.data.runs[0].id,ids[11]);assert.equal(first.data.runs[0].hasReport,true);assert.equal('result' in first.data.runs[0],false);
 const second=await get(`/items/${id}/research-history?before=${encodeURIComponent(first.data.nextCursor)}`);
 assert.equal(second.data.runs.length,2);assert.equal(second.data.nextCursor,null);
 assert.deepEqual([...first.data.runs,...second.data.runs].map(r=>r.id),ids.toReversed());
 const saved=await get(`/items/${id}/research-history/${ids[0]}`);assert.deepEqual(saved.data.report,report(0));
 assert.equal((await get(`/items/${other}/research-history/${ids[0]}`)).status,404);
 assert.equal((await get(`/items/${id}/research-history/${id}-note-0`)).status,404);
 assert.equal((await get(`/items/${id}/research-history?before=invalid`)).status,400);
 assert.equal((await get('/items/missing/research-history')).status,404);
 assert.deepEqual((await get(`/items/${other}/research-history`)).data,{runs:[],nextCursor:null});
 // Legacy damage and a failed run must never masquerade as the latest successful report.
 localWrangler(['d1','execute','next-chapter','--local','--command',`UPDATE jobs SET result='{broken' WHERE id=${quote(ids[0])}; UPDATE jobs SET state='failed',error='Search timed out.' WHERE id=${quote(ids[1])};`]);
 const damaged=await get(`/items/${id}/research-history/${ids[0]}`);assert.equal(damaged.data.report,null);assert.equal(damaged.data.run.hasReport,false);assert.match(damaged.data.message,/unavailable/);
 const failed=await get(`/items/${id}/research-history/${ids[1]}`);assert.equal(failed.data.report,null);assert.equal(failed.data.message,'Search timed out.');
 const item=(await get(`/items/${id}`)).data;assert.equal(item.research.text,'The latest item report is different.');assert.equal(item.item.price,72);
});
after(async()=>{for(const id of created)await cleanup(id);});
