import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {cleanup} from '../scripts/cleanup-test-item.mjs';
import {base,localWrangler} from './local-api.mjs';
async function req(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
let item;
test('marketplace preparation persists, rejects stale saves and keeps channels independent',async()=>{
 const config=await req('/config');assert.equal(config.data.local,true,'Use the local development API only');
 item=(await req('/items',{title:'Integration test marketplace',owner:'Private client',location:'Private shelf',notes:'Private code 123',valueEstimate:'Private estimate 999',condition:'Chip on base',price:25,fulfillment:'shipping',availability:'available'})).data;
 const path=`/items/${item.id}/marketplace-drafts`,initial=await req(path);assert.equal(initial.status,200);assert.equal(initial.data.length,2);
 const ebay=initial.data.find(e=>e.draft.channel==='ebay');assert.equal(ebay.draft.version,0);assert.ok(!JSON.stringify(ebay.preview).includes('Private'));
 const body={data:{...ebay.draft.data,title:'Reviewed title'},version:0,sourceVersion:item.version};
 const created=await req(path+'/ebay',body,'PUT');assert.equal(created.status,200);assert.equal(created.data.draft.version,1);
 const repeated=await req(path+'/ebay',body,'PUT');assert.equal(repeated.status,409);
 const saved=await req(path);assert.equal(saved.data[0].draft.data.title,'Reviewed title');assert.notEqual(saved.data[1].draft.data.title,'Reviewed title');
 const foreign=await req(path+'/ebay',{...body,version:1,data:{...body.data,photoIds:[crypto.randomUUID()]}},'PUT');assert.equal(foreign.status,400);
 const updated=await req(`/items/${item.id}`,{...item,title:'Integration test marketplace changed'},'PUT');assert.equal(updated.status,200);item=updated.data;
 const stale=await req(path+'/ebay',{...body,version:1},'PUT');assert.equal(stale.status,409);
 const checks=(await req(path)).data[0].checks;assert.ok(checks.some(c=>c.field==='sourceVersion'));
 const rechecked=await req(path+'/ebay',{...body,version:1,sourceVersion:item.version},'PUT');assert.equal(rechecked.status,200);assert.equal(rechecked.data.draft.version,2);
 const exported=(await req('/export')).data;assert.ok(exported.marketplace_drafts.some(d=>d.item_id===item.id));assert.ok(!Object.hasOwn(exported,'marketplace_connections'));assert.ok(!Object.hasOwn(exported,'marketplace_oauth_states'));
});
test('connection APIs report unavailable credentials and cannot post listings',async()=>{
 const status=await req('/marketplaces/connections');assert.equal(status.status,200);assert.equal(status.data.length,2);assert.ok(status.data.every(c=>c.remoteWritesEnabled===false&&!c.linked));
 for(const channel of ['ebay','etsy']){assert.equal((await req(`/marketplaces/${channel}/connect`,{})).status,503);assert.equal((await req(`/marketplaces/${channel}/callback?state=invalid&code=invalid`)).status,400);}
 assert.equal((await req(`/items/${item.id}/marketplace-drafts/ebay/publish`,{})).status,404);
});
after(async()=>{if(item)await cleanup(item.id);});
