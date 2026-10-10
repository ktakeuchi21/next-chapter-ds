import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {cleanup} from '../scripts/cleanup-test-item.mjs';
import {base,localWrangler} from './local-api.mjs';let id;
async function req(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
test('pickup metadata survives item edits, rejects lifecycle bypass and stays in backup export',async()=>{
 let r=await req('/items',{title:'Integration test pickup',owner:'Fixture',location:'PRIVATE shelf',fulfillment:'pickup',condition:'Test only',availability:'available',price:150,pickupArea:'Test city'});id=r.data.id;
 r=await req(`/items/${id}/pickup`,{version:r.data.version,action:'save',form:{title:'Fixture',description:'Public fixture',buyer:'Test buyer',agreedPrice:100,instructions:'Private instructions'}});assert.equal(r.status,200,JSON.stringify(r.data));
 const saved=r.data.pickup;
 r=await req(`/items/${id}`,{...r.data,notes:'Edited separately',pickup:{buyer:'Should be ignored'}},'PUT');assert.equal(r.status,200);assert.deepEqual(r.data.pickup,saved);
 const bypass=await req(`/items/${id}/status`,{version:r.data.version,status:'listed'});assert.equal(bypass.status,400);assert.match(bypass.data.error,/local-pickup/);
 const invalid=await req(`/items/${id}/pickup`,{version:r.data.version,action:'arrange',form:{...saved,scheduledAt:'nonsense'}});assert.equal(invalid.status,400);
 const exp=await req('/export');const record=exp.data.items.find(i=>i.id===id);assert.deepEqual(JSON.parse(record.data).pickup,saved);
});
after(async()=>{if(id)await cleanup(id);});
