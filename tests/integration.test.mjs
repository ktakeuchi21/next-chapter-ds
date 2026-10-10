import {test,after} from 'node:test';
import {cleanup} from '../scripts/cleanup-test-item.mjs';
import assert from 'node:assert/strict';
import {base,localWrangler} from './local-api.mjs';
async function req(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
let item;
test('persistent intake, media, status transitions and manual listing removal',async()=>{
 const created=await req('/items',{title:'Integration test item',owner:'Test estate',location:'Test shelf',condition:'Test condition',price:12,fulfillment:'pickup'});assert.equal(created.status,201);item=created.data;assert.equal(item.availability,'available');
 const upload=new FormData();upload.append('file',new Blob([Uint8Array.from([137,80,78,71,13,10,26,10])],{type:'image/png'}),'test.png');const media=await fetch(`${base}/items/${item.id}/media`,{method:'POST',body:upload});assert.equal(media.status,201);
 const conflict=await req(`/items/${item.id}`,{...item,title:'Should not save',version:0},'PUT');assert.equal(conflict.status,400);
 item=(await req(`/items/${item.id}`)).data.item;
 const saved=await req(`/items/${item.id}`,{...item,title:'Integration test edited'},'PUT');assert.equal(saved.status,200);const stale=await req(`/items/${item.id}`,{...item,title:'Stale edit'},'PUT');assert.equal(stale.status,409);item=saved.data;
 for(const next of ['review','ready']){const r=await req(`/items/${item.id}/status`,{status:next,version:item.version});assert.equal(r.status,200,JSON.stringify(r.data));item=r.data;}
 const noLink=await req(`/items/${item.id}/status`,{status:'listed',version:item.version});assert.equal(noLink.status,400);
 const link=await req(`/items/${item.id}/listings`,{channel:'eBay',url:'https://example.com/test-item'});assert.equal(link.status,201);
 for(const next of ['listed','sold']){const r=await req(`/items/${item.id}/status`,{status:next,version:item.version});assert.equal(r.status,200);item=r.data;}
 const detail=await req(`/items/${item.id}`);assert.equal(detail.data.listings[0].state,'removal_needed');
 const early=await req(`/items/${item.id}/status`,{status:'fulfilled',version:item.version});assert.equal(early.status,400);
 const removed=await req(`/items/${item.id}/listings/${detail.data.listings[0].id}/removed`,{});assert.equal(removed.status,200);
 const finish=await req(`/items/${item.id}/status`,{status:'fulfilled',version:item.version});assert.equal(finish.status,200);
});
test('no fake AI success without a configured key',async()=>{const config=await req('/config');if(!config.data.aiConnected){const r=await req(`/items/${item.id}/jobs`,{kind:'research'});assert.equal(r.status,503);assert.match(r.data.error,/not connected/);}});
test('cross-origin write is denied',async()=>{const r=await fetch(base+'/items',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({title:'Forbidden'})});assert.equal(r.status,403);});
test('metadata export includes records',async()=>{const r=await req('/export');assert.equal(r.status,200);assert.ok(r.data.items.some(i=>i.id===item.id));});

after(async()=>{if(item)await cleanup(item.id);});
