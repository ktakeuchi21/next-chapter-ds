import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {base,localWrangler} from './local-api.mjs';
import {cleanup} from '../scripts/cleanup-test-item.mjs';
const ids=[];
const req=async(path,body,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64');
async function item(){const r=await req('/items',{title:'Integration test audit',owner:'Fixture',location:'Test shelf',condition:'Fixture',price:12,fulfillment:'shipping',availability:'available'});assert.equal(r.status,201);ids.push(r.data.id);return r.data;}
async function upload(id,mediaId,bytes=photo){const form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),'fixture.png');form.append('requestId',mediaId);const r=await fetch(base+'/items/'+id+'/media',{method:'POST',body:form});return {status:r.status,data:await r.json()};}
test('simultaneous retry writes one original and one activity entry; media supports seeking',async()=>{
 const i=await item(),mid=randomUUID();const results=await Promise.all([upload(i.id,mid),upload(i.id,mid)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
 const detail=(await req('/items/'+i.id)).data;assert.equal(detail.media.length,1);assert.equal(detail.item.version,i.version+1);assert.equal(detail.activity.filter(a=>a.message==='Photo added.').length,1);
 const full=await fetch(base+'/media/'+mid);assert.deepEqual(Buffer.from(await full.arrayBuffer()),photo);
 const partial=await fetch(base+'/media/'+mid,{headers:{Range:'bytes=2-7'}});assert.equal(partial.status,206);assert.equal(partial.headers.get('Content-Range'),`bytes 2-7/${photo.length}`);assert.deepEqual(Buffer.from(await partial.arrayBuffer()),photo.subarray(2,8));
 const suffix=await fetch(base+'/media/'+mid,{headers:{Range:'bytes=-4'}});assert.equal(suffix.status,206);assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),photo.subarray(-4));
 const invalid=await fetch(base+'/media/'+mid,{headers:{Range:'bytes=9999-'}});assert.equal(invalid.status,416);
 const head=await fetch(base+'/media/'+mid,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),String(photo.length));assert.equal((await head.arrayBuffer()).byteLength,0);
 assert.equal((await upload(i.id,mid,Buffer.from('different'))).status,409);
 const sameSize=Buffer.from(photo);sameSize[20]^=1;assert.equal((await upload(i.id,mid,sameSize)).status,409);
 assert.deepEqual(Buffer.from(await (await fetch(base+'/media/'+mid)).arrayBuffer()),photo);
});
test('different simultaneous files cannot overwrite the same upload key',async()=>{
 const i=await item(),mid=randomUUID(),other=Buffer.concat([photo,Buffer.from('extra')]);
 const results=await Promise.all([upload(i.id,mid,photo),upload(i.id,mid,other)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const detail=(await req('/items/'+i.id)).data;const bytes=Buffer.from(await (await fetch(base+'/media/'+mid)).arrayBuffer());assert.equal(bytes.length,detail.media[0].size);assert.equal(detail.item.version,i.version+1);
});
test('a concurrent upload identifier cannot be acknowledged for two different items',async()=>{
 const a=await item(),b=await item(),mid=randomUUID();const results=await Promise.all([upload(a.id,mid),upload(b.id,mid)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const left=(await req('/items/'+a.id)).data,right=(await req('/items/'+b.id)).data;assert.equal(left.media.length+right.media.length,1);assert.equal(left.item.version+right.item.version,a.version+b.version+1);
});
test('duplicate links and a sale racing with a new listing leave no active listing',async()=>{
 let i=await item();await upload(i.id,randomUUID());i=(await req('/items/'+i.id)).data.item;
 for(const status of ['review','ready']){const r=await req('/items/'+i.id+'/status',{status,version:i.version});assert.equal(r.status,200);i=r.data;}
 const link={channel:'eBay',url:'https://example.com/audit-'+randomUUID()};const duplicates=await Promise.all([req('/items/'+i.id+'/listings',link),req('/items/'+i.id+'/listings',link)]);assert.deepEqual(duplicates.map(r=>r.status).sort(),[201,409]);
 i=(await req('/items/'+i.id+'/status',{status:'listed',version:i.version})).data;
 const [sale,added]=await Promise.all([req('/items/'+i.id+'/status',{status:'sold',version:i.version}),req('/items/'+i.id+'/listings',{channel:'Etsy',url:'https://example.com/audit-'+randomUUID()})]);assert.equal(sale.status,200);assert.ok([201,400,409].includes(added.status));
 const d=(await req('/items/'+i.id)).data;assert.equal(d.item.status,'sold');assert.ok(d.listings.every(l=>l.state==='removal_needed'));
 const early=await req('/items/'+i.id+'/status',{status:'fulfilled',version:d.item.version});assert.equal(early.status,400);
});
test('opaque and malformed browser origins are denied with a helpful response',async()=>{
 for(const Origin of ['null','not a URL','https://untrusted.example']){const r=await fetch(base+'/items',{method:'POST',headers:{Origin,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);assert.match((await r.json()).error,/another site/);}
});
test('capture identifiers cannot be replayed into a different visit',async()=>{
 const i=await item();const replay=await req('/items',{requestId:i.id,visitId:randomUUID()});assert.equal(replay.status,409);assert.equal((await req('/items/'+i.id)).data.item.visitId,null);
});
test('an unidentified photo-only item keeps its permanent label when saved without a name',async()=>{
 const created=await req('/items',{});assert.equal(created.status,201);ids.push(created.data.id);
 const original=created.data;assert.equal(original.title,`Item ${original.code}`);
 await upload(original.id,randomUUID());const captured=(await req('/items/'+original.id)).data;
 const saved=await req('/items/'+original.id,{...captured.item,title:'',researchNotes:''},'PUT');assert.equal(saved.status,200);
 const reloaded=(await req('/items/'+original.id)).data;
 assert.equal(reloaded.item.title,`Item ${original.code}`);assert.equal(reloaded.item.code,original.code);assert.equal(reloaded.item.researchNotes,'');assert.equal(reloaded.media.length,1);
 // Restore the fixture marker so the existing cleanup guard can safely identify it.
 assert.equal((await req('/items/'+original.id,{...reloaded.item,title:'Integration test unnamed photo'},'PUT')).status,200);
});
after(async()=>{for(const id of ids)await cleanup(id);});
