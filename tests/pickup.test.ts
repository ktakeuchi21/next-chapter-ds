import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {Hono} from 'hono';
import {pickupRoutes} from '../server/pickup';
import {getItem} from '../server/db';
import {itemFields,type Item,type Media} from '../shared/domain';
import {preparePickup,pickupSource,pickupReminder,pickupReply,facebookItemUrl,pickupReadiness} from '../shared/pickup';
import {extractedNotes} from '../shared/intake';
const id=crypto.randomUUID(),photo=crypto.randomUUID();
function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['0001_initial.sql','0002_visits.sql','0009_photo_edits.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const env:any={DB:{prepare(sql:string){const stmt=db.prepare(sql);let values:any[]=[];const q={bind(...args:any[]){values=args;return q;},async first(){return stmt.get(...values)??null;},async all(){return {results:stmt.all(...values)};},async run(){const r=stmt.run(...values);return {meta:{changes:Number(r.changes)}};}};return q;},async batch(statements:any[]){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 db.prepare('INSERT INTO items(id,code,data,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,'TEST-001',JSON.stringify(itemFields.parse({title:'Oak dresser',owner:'PRIVATE OWNER',location:'PRIVATE ADDRESS',notes:'PRIVATE NOTES',valueEstimate:'PRIVATE ESTIMATE',condition:'Scratches on top',price:150,fulfillment:'pickup',availability:'available',pickupArea:'Bountiful',loadingNotes:'Bring two people',clearBy:'Friday'})),'now','now');
 db.prepare('INSERT INTO media(id,item_id,kind,name,mime,size,object_key,created_at) VALUES(?,?,?,?,?,?,?,?)').run(photo,id,'photo','p.jpg','image/jpeg',1,'p','now');
 const app=new Hono().route('/',pickupRoutes);const item=()=>getItem(env,id) as Promise<Item>;
 const req=async(b:any)=>{const response=await app.request('/api/items/'+id+'/pickup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)},env);return {status:response.status,data:await response.json() as any};};
 const setup=async()=>{const i=await item(),form=preparePickup(i,[{id:photo,kind:'photo'} as Media]);return {form,version:i.version};};
 const listed=async()=>req({...await setup(),action:'listed',url:'https://www.facebook.com/marketplace/item/123/?ref=test',confirmed:true});
 return {db,env,item,req,setup,listed};
}
describe('local pickup',()=>{
 it('builds a public package from allowlisted facts and detects stale details',async()=>{const f=fixture();try{const i=await f.item(),{form}=await f.setup();expect(form.description).not.toContain('PRIVATE');expect(form.description).toContain('Bring two people');expect(pickupReadiness(i,form,[{id:photo,kind:'photo'} as Media])).toEqual([]);expect(pickupReadiness({...i,price:100},form,[{id:photo,kind:'photo'} as Media])).toContain('Prepare or review the draft after the item details changed');expect(pickupSource(i)).not.toContain('PRIVATE');}finally{f.db.close();}});
 it('normalizes only real Facebook item URLs',()=>{expect(facebookItemUrl('https://m.facebook.com/marketplace/item/123?x=1')).toBe('https://www.facebook.com/marketplace/item/123/');for(const url of ['https://facebook.com.evil.test/marketplace/item/123','javascript:alert(1)','https://www.facebook.com/','https://user:pass@facebook.com/marketplace/item/123'])expect(facebookItemUrl(url)).toBeNull();});
 it('requires listing review and essentials, persists one link and rejects replayed revisions',async()=>{const f=fixture();try{const payload={...await f.setup(),action:'listed',url:'https://www.facebook.com/marketplace/item/123/'};expect((await f.req(payload)).status).toBe(400);const posted=await f.req({...payload,confirmed:true});expect(posted.status).toBe(200);expect(posted.data.status).toBe('listed');expect((await f.req({...payload,confirmed:true})).status).toBe(409);expect((await f.listed()).status).toBe(200);expect(f.db.prepare('SELECT COUNT(*) n FROM listings').get()).toMatchObject({n:1});const i=await f.item();expect((await f.req({...payload,version:i.version,url:'https://www.facebook.com/marketplace/item/456/',confirmed:true})).status).toBe(409);}finally{f.db.close();}});
 it('schedules pickup, clears a no-show, and requires explicit payment and collection before closing all listings',async()=>{const f=fixture();try{
  await f.listed();let i=await f.item();const form={...i.pickup!,buyer:'Test buyer',scheduledAt:new Date(Date.now()+86400000).toISOString(),agreedPrice:125,instructions:'PRIVATE DIRECTIONS'};
  expect((await f.req({action:'arrange',version:i.version,form:{...form,scheduledAt:''}})).status).toBe(400);
  let r=await f.req({action:'arrange',version:i.version,form});expect(r.data.status).toBe('reserved');expect(pickupReminder(r.data)).toContain('Pickup arranged');expect(pickupReply(r.data,'pickup')).toContain('PRIVATE DIRECTIONS');expect(pickupReply(r.data,'availability')).not.toContain('PRIVATE');
  r=await f.req({action:'no_show',version:r.data.version,confirmed:true});expect(r.data.status).toBe('listed');expect(r.data.pickup).toMatchObject({buyer:'',scheduledAt:'',noShows:1});
  expect((await f.req({action:'collect',version:r.data.version,form,confirmed:true})).status).toBe(400);
  r=await f.req({action:'collect',version:r.data.version,form,confirmed:true,paymentConfirmed:true});expect(r.data.status).toBe('sold');expect(f.db.prepare('SELECT state FROM listings').get()).toMatchObject({state:'removal_needed'});
  expect((await f.req({action:'collect',version:r.data.version,form,confirmed:true,paymentConfirmed:true})).status).toBe(400);
  expect((await f.req({action:'complete',version:r.data.version})).status).toBe(400);
  f.db.exec("UPDATE listings SET state='removed'");r=await f.req({action:'complete',version:r.data.version,form:{...form,agreedPrice:999}});expect(r.data.status).toBe('fulfilled');expect(r.data.pickup.agreedPrice).toBe(125);
 }finally{f.db.close();}});
 it('does not change workflow or links for stale concurrent requests',async()=>{const f=fixture();try{const b=await f.setup();await f.req({...b,action:'save'});const r=await f.req({...b,action:'listed',confirmed:true,url:'https://facebook.com/marketplace/item/123'});expect(r.status).toBe(409);expect(f.db.prepare('SELECT COUNT(*) n FROM listings').get()).toMatchObject({n:0});expect((await f.item()).status).toBe('intake');}finally{f.db.close();}});
 it('accepts pickup voice suggestions without merging them with the value estimate',()=>{const parsed=extractedNotes.parse({notes:['pickupArea','loadingNotes','clearBy','valueEstimate'].map(field=>({itemId:id,field,value:'Spoken fact',quote:'Spoken fact',confidence:'clear'}))});expect(parsed.notes).toHaveLength(4);});
});
