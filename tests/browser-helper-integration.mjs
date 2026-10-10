import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {cleanup} from '../scripts/cleanup-test-item.mjs';
import {base,localWrangler} from './local-api.mjs';
let itemId,deviceId;
async function req(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
test('real Worker browser bridge: authenticated pairing, bounded photo transfer, candidate link and explicit publication confirmation',async()=>{
 const created=await req('/items',{title:'Integration test browser helper',owner:'PRIVATE owner',location:'PRIVATE shelf',notes:'PRIVATE notes',condition:'Fixture only',price:30,fulfillment:'pickup',pickupArea:'Test city'});assert.equal(created.status,201);itemId=created.data.id;
 const pixels=Uint8Array.from({length:700000},(_,i)=>i%256);const upload=new FormData();upload.append('file',new Blob([pixels],{type:'image/png'}),'helper-fixture.png');const photo=await fetch(`${base}/items/${itemId}/media`,{method:'POST',body:upload}).then(r=>r.json());
 let item=(await req('/items/'+itemId)).data.item;
 const preparedFrom=JSON.stringify([item.title,item.condition,item.measurements,item.price,item.pickupArea||'',item.loadingNotes||'',item.clearBy||'',item.draftTitle||'',item.draftDescription||'']);
 item=(await req(`/items/${itemId}/pickup`,{version:item.version,action:'save',form:{title:item.title,description:'Reviewed public description',photoIds:[photo.id],preparedFrom}})).data;
 deviceId=crypto.randomUUID();assert.equal((await req('/browser-helper/devices',{id:deviceId,name:'Integration Chrome'})).status,200);
 const requestId=crypto.randomUUID(),t=(await req(`/items/${itemId}/facebook-handoffs`,{requestId,sourceVersion:item.version,reviewed:true})).data;assert.equal(t.id,requestId);assert.ok(!JSON.stringify(t.payload).includes('PRIVATE'));
 const attemptId=crypto.randomUUID(),claim=(await req(`/browser-helper/tasks/${t.id}/claim`,{deviceId,attemptId})).data;assert.equal(claim.resumed,false);
 const path=`${base}/browser-helper/tasks/${t.id}/photos/${photo.id}?device=${deviceId}&attempt=${attemptId}`;
 const segment=await fetch(path,{headers:{Range:'bytes=524288-1048575'}});assert.equal(segment.status,206);assert.equal(segment.headers.get('content-range'),'bytes 524288-699999/700000');assert.deepEqual(new Uint8Array(await segment.arrayBuffer()),pixels.slice(524288));
 const originDenied=await fetch(base+'/browser-helper/devices',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),name:'forbidden'})});assert.equal(originDenied.status,403);
 const candidate=await req(`/browser-helper/tasks/${t.id}/report`,{deviceId,attemptId,revision:claim.task.revision,kind:'link',url:'https://www.facebook.com/marketplace/item/999000111222333/'});assert.equal(candidate.status,200);assert.equal((await req('/items/'+itemId)).data.item.status,'intake');
 assert.equal((await req(`/browser-helper/tasks/${t.id}/complete`,{})).status,409);
 const published=await req(`/items/${itemId}/pickup`,{version:item.version,action:'listed',form:item.pickup,url:candidate.data.listingUrl,confirmed:true});assert.equal(published.status,200,JSON.stringify(published.data));assert.equal(published.data.status,'listed');assert.equal((await req(`/browser-helper/tasks/${t.id}/complete`,{})).status,200);
 const snapshot=(await req('/export')).data;assert.equal(snapshot.version,8);assert.equal(snapshot.facebook_handoffs.find(h=>h.id===t.id).state,'complete');assert.equal(snapshot.browser_devices,undefined);
});
after(async()=>{if(itemId)await cleanup(itemId);if(deviceId)await localWrangler(['d1','execute','next-chapter','--local','--command',`DELETE FROM browser_devices WHERE id='${deviceId}'`]);});
