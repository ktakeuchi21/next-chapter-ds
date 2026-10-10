import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {base,localWrangler} from './local-api.mjs';
const query=sql=>localWrangler(['d1','execute','next-chapter','--local','--command',sql]);
const request=async(path,body,method='POST')=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
test('held marketplace order cannot be fulfilled through the ordinary item API',async()=>{
 assert.equal((await (await fetch(base+'/config')).json()).local,true);
 const item=(await request('/items',{title:'Integration test order hold',availability:'available',fulfillment:'shipping'})).data;
 const order=crypto.randomUUID(),line=crypto.randomUUID();
 try{
  query(`UPDATE items SET status='sold' WHERE id='${item.id}'; INSERT INTO marketplace_orders(id,channel,environment,account_id,external_id,source,provider_updated_at,fingerprint,data,state,created_at,updated_at) VALUES('${order}','etsy','production','fixture','${order}','fixture','now','fixture','{}','attention','now','now'); INSERT INTO order_allocations(id,order_id,line_id,item_id,created_at) VALUES('${line}','${order}','${line}','${item.id}','now');`);
  let r=await request('/items/'+item.id+'/status',{version:item.version,status:'fulfilled'});assert.equal(r.status,409);assert.match(r.data.error,/on hold/);
  query(`UPDATE marketplace_orders SET state='accepted' WHERE id='${order}';`);
  r=await request('/items/'+item.id+'/status',{version:item.version,status:'fulfilled'});assert.equal(r.status,200);assert.equal(r.data.status,'fulfilled');
 }finally{query(`DELETE FROM order_allocations WHERE order_id='${order}'; DELETE FROM marketplace_orders WHERE id='${order}' AND source='fixture'; DELETE FROM activity WHERE item_id='${item.id}'; DELETE FROM items WHERE id='${item.id}';`);}
});
