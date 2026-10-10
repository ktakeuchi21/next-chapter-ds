import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID as uid} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {base,localWrangler} from './local-api.mjs';
async function req(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64');
async function upload(id,requestId=uid(),type='image/png'){const f=new FormData();f.append('file',new Blob([photo],{type}),'test.png');f.append('requestId',requestId);const r=await fetch(base+'/items/'+id+'/media',{method:'POST',body:f});return {status:r.status,data:await r.json()};}
let visit,otherVisit,labels,batch,created;
test('client inheritance, collision handling and stable label reservations',async()=>{
 const client=(await req('/clients',{id:uid(),name:'Jane Smith'})).data;const other=(await req('/clients',{id:uid(),name:'John Smith'})).data;assert.notEqual(client.code,other.code);
 visit=(await req('/visits',{id:uid(),clientId:client.id,location:'Client house · dining room'})).data;otherVisit=(await req('/visits',{id:uid(),clientId:other.id})).data;
 const blockId=uid();const [a,b]=await Promise.all([req(`/visits/${visit.id}/labels`,{requestId:blockId}),req(`/visits/${visit.id}/labels`,{requestId:blockId})]);assert.equal(a.status,200);assert.deepEqual(a.data,b.data);assert.equal(a.data.length,64);labels=a.data;
 const draft=await req('/items',{requestId:labels[0].id,visitId:visit.id});assert.equal(draft.status,201);assert.equal(draft.data.availability,'available');assert.equal(draft.data.owner,'Jane Smith');assert.equal(draft.data.location,visit.location);assert.equal(draft.data.code,labels[0].code);const retry=await req('/items',{requestId:labels[0].id,visitId:visit.id,title:'Changed retry'});assert.equal(retry.data.title,draft.data.title);
 const invalid=await req('/items',{requestId:labels[1].id,visitId:otherVisit.id});assert.equal(invalid.status,400);
 batch=(await req('/items',{requestId:labels[2].id,visitId:visit.id,recordType:'batch'})).data;
 assert.ok(!(await req('/items')).data.some(i=>i.id===batch.id));
});
test('40-file bulk upload survives duplicate retries and partitions atomically',async()=>{
 const mids=[];for(let i=0;i<40;i++){const id=uid();const r=await upload(batch.id,id);assert.equal(r.status,201);mids.push(r.data.id);if(i===0)assert.equal((await upload(batch.id,id)).status,200);}
 const detail=(await req('/items/'+batch.id)).data;assert.equal(detail.media.length,40);
 const bad=await req(`/intake/${batch.id}/groups`,{requestId:uid(),version:detail.item.version,groups:[{title:'Bad group',mediaIds:[mids[0],mids[0]]}]});assert.equal(bad.status,400);
 const requestId=uid(),body={requestId,version:detail.item.version,groups:[{title:'First item',mediaIds:mids.slice(0,20)},{title:'Second item',mediaIds:mids.slice(20)}]};const good=await req(`/intake/${batch.id}/groups`,body);assert.equal(good.status,200,JSON.stringify(good));created=good.data.items;assert.equal(created.length,2);for(const row of created)assert.equal((await req('/items/'+row.id)).data.item.availability,'available');const retry=await req(`/intake/${batch.id}/groups`,body);assert.deepEqual(retry.data,good.data);
 assert.equal((await req('/items/'+batch.id)).data.media.length,0);assert.equal((await req('/items/'+created[0].id)).data.media.length,20);assert.equal((await req('/items/'+created[1].id)).data.media.length,20);
 // An interrupted upload retry must not put moved files back in the batch.
 assert.equal((await upload(batch.id,mids[0])).status,200);assert.equal((await req('/items/'+batch.id)).data.media.length,0);
 const stale=await req(`/intake/${batch.id}/groups`,{...body,requestId:uid()});assert.equal(stale.status,409);
});
test('draft file correction and bulk relocation preserve written labels',async()=>{
 const a=(await req('/items/'+created[0].id)).data,b=(await req('/items/'+created[1].id)).data;
 assert.equal((await req('/media/'+a.media[0].id+'/move',{targetId:b.item.id})).status,200);
 const fresh=(await req('/items/'+a.item.id)).data.item;
 const result=await req('/items/move',{items:[{id:fresh.id,version:fresh.version},{id:b.item.id,version:-1}],location:'Seller basement · A3'});assert.equal(result.data.results[0].moved,true);assert.equal(result.data.results[1].moved,false);const moved=(await req('/items/'+fresh.id)).data.item;assert.equal(moved.code,fresh.code);assert.equal(moved.owner,'Jane Smith');assert.equal(moved.location,'Seller basement · A3');
});
test('voice suggestions cannot cross visits; review and undo respect item edits',async()=>{
 const mid=(await upload(batch.id,uid(),'audio/wav')).data.id;const noteId='test-'+uid();
 const sql=`INSERT INTO note_suggestions(id,source_id,media_id,item_id,field,value,quote,confidence,created_at) VALUES('${noteId}','${batch.id}','${mid}','${created[0].id}','condition','Chip underneath','chip underneath','clear','2026-09-24');`;
 localWrangler(['d1','execute','next-chapter','--local','--command',sql]);
 const otherLabels=(await req(`/visits/${otherVisit.id}/labels`,{requestId:uid()})).data;
 const foreign=(await req('/items',{requestId:otherLabels[0].id,visitId:otherVisit.id})).data;
 assert.equal((await req('/notes/'+noteId,{action:'apply',itemId:foreign.id,version:foreign.version})).status,400);
 let item=(await req('/items/'+created[0].id)).data.item;
 assert.equal((await req('/notes/'+noteId,{action:'apply',itemId:item.id,version:item.version-1})).status,409);

 const apply=await req('/notes/'+noteId,{action:'apply',itemId:item.id,version:item.version});assert.equal(apply.status,200,JSON.stringify(apply));item=(await req('/items/'+item.id)).data.item;assert.equal(item.condition,'Chip underneath');
 assert.equal((await req('/notes/'+noteId,{action:'undo',itemId:item.id})).status,200);assert.equal((await req('/items/'+item.id)).data.item.condition,'');
 assert.equal((await req('/notes/'+noteId,{action:'apply',itemId:item.id,version:item.version})).status,409);
});
