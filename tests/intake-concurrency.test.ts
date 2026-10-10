import {it,expect} from 'vitest';
import {Hono} from 'hono';
import {fixture} from './operations-fixture';
import {intake} from '../server/intake';

it('two devices applying one note to different items cannot change the losing item',async()=>{
 const f=fixture();let queue=Promise.resolve();const batch=f.env.DB.batch;f.env.DB.batch=(statements:any[])=>{const pending=queue.then(()=>batch(statements));queue=pending.then(()=>undefined,()=>undefined);return pending;};try{
  const a=f.item(),b=f.item(),client=crypto.randomUUID(),visit=crypto.randomUUID(),note=crypto.randomUUID();
  f.db.prepare('INSERT INTO clients(id,name,code,default_location,created_at) VALUES(?,?,?,?,?)').run(client,'Fixture','FIX','Shelf','now');
  f.db.prepare('INSERT INTO visits(id,client_id,location,created_at) VALUES(?,?,?,?)').run(visit,client,'Shelf','now');
  f.db.prepare("UPDATE items SET status='intake',visit_id=? WHERE id IN (?,?)").run(visit,a,b);
  f.db.prepare('INSERT INTO note_suggestions(id,source_id,item_id,field,value,quote,confidence,created_at) VALUES(?,?,?,?,?,?,?,?)').run(note,a,a,'condition','Chip underneath','Chip underneath','clear','now');
  const app=new Hono().route('/',intake);
  const apply=(id:string)=>app.request('/api/notes/'+note,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'apply',itemId:id,version:1})},f.env);
  const responses=await Promise.all([apply(a),apply(b)]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  const rows=f.db.prepare('SELECT id,data,version FROM items WHERE id IN (?,?)').all(a,b) as any[];
  const changed=rows.filter(r=>JSON.parse(r.data).condition==='Chip underneath');expect(changed).toHaveLength(1);
  expect(rows.reduce((total,r)=>total+r.version,0)).toBe(3);expect(f.db.prepare('SELECT item_id FROM note_suggestions WHERE id=?').get(note)).toMatchObject({item_id:changed[0].id});
 }finally{f.db.close();}
});

it('a grouping request reused across simultaneous batches cannot move the losing batch files',async()=>{
 const f=fixture();let queue=Promise.resolve();const batch=f.env.DB.batch;f.env.DB.batch=(statements:any[])=>{const pending=queue.then(()=>batch(statements));queue=pending.then(()=>undefined,()=>undefined);return pending;};try{
  const a=f.item(),b=f.item(),client=crypto.randomUUID(),visit=crypto.randomUUID(),requestId=crypto.randomUUID(),ma=crypto.randomUUID(),mb=crypto.randomUUID();
  f.db.prepare('INSERT INTO clients(id,name,code,default_location,created_at) VALUES(?,?,?,?,?)').run(client,'Fixture','FIX','Shelf','now');f.db.prepare('INSERT INTO visits(id,client_id,location,created_at) VALUES(?,?,?,?)').run(visit,client,'Shelf','now');
  f.db.prepare("UPDATE items SET record_type='batch',status='intake',client_id=?,visit_id=? WHERE id IN (?,?)").run(client,visit,a,b);
  for(const [source,mid] of [[a,ma],[b,mb]])f.db.prepare('INSERT INTO media(id,item_id,origin_item_id,kind,name,mime,size,object_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(mid,source,source,'photo','fixture.png','image/png',3,`items/${source}/${mid}`,'now');
  const app=new Hono().route('/',intake);
  const group=(id:string,mid:string)=>app.request('/api/intake/'+id+'/groups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId,version:1,groups:[{title:'Grouped item',mediaIds:[mid]}]})},f.env);
  const responses=await Promise.all([group(a,ma),group(b,mb)]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  const commit=f.db.prepare('SELECT source_id,result FROM intake_commits WHERE id=?').get(requestId) as any;const child=JSON.parse(commit.result).items[0].id;const losingSource=commit.source_id===a?b:a,losingMedia=losingSource===a?ma:mb;
  expect(f.db.prepare('SELECT item_id FROM media WHERE id=?').get(losingMedia)).toMatchObject({item_id:losingSource});expect(f.db.prepare('SELECT COUNT(*) n FROM media WHERE item_id=?').get(child)).toMatchObject({n:1});expect(f.db.prepare('SELECT version FROM items WHERE id=?').get(losingSource)).toMatchObject({version:1});
 }finally{f.db.close();}
});
