import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {itemFields} from '../shared/domain';
import {marketplaceFields} from '../shared/marketplaces';
import {loadEtsySetup} from '../server/etsy-setup';
import {prepareEtsyTransfer,advanceEtsyTransfer,transferView} from '../server/etsy-transfers';
import {EtsyProvider} from '../server/marketplace-providers';
import type {Env} from '../server/types';
const photo=crypto.randomUUID(),itemId=crypto.randomUUID();
function fixture(){
 const db=new DatabaseSync(':memory:');for(const file of ['0001_initial.sql','0002_visits.sql','0009_photo_edits.sql','0003_marketplace_drafts.sql','0004_marketplace_refresh.sql','0005_etsy_transfers.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const adapter={prepare(sql:string){const stmt=db.prepare(sql);let values:any[]=[];const q={bind(...args:any[]){values=args;return q;},async first(){return stmt.get(...values)??null;},async all(){return {results:stmt.all(...values)};},async run(){const r=stmt.run(...values);return {meta:{changes:Number(r.changes)}};}};return q;}};
 const item=itemFields.parse({title:'Vintage doll',owner:'PRIVATE OWNER',location:'PRIVATE LOCATION',condition:'Wear on box',fulfillment:'shipping',availability:'available',price:12.5});
 const data=marketplaceFields.parse({title:'Vintage doll',description:'Doll with wear on box.',price:12.5,photoIds:[photo],shopId:'99',categoryId:'123',shippingProfileId:'5',readinessStateId:'6',returnPolicyId:'7',whenMade:'1990s',latestYear:1999,ageEvidence:'Dated original packaging',vintageConfirmed:true});
 db.prepare('INSERT INTO items(id,code,data,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(itemId,'NC-001',JSON.stringify(item),'review','now','now');
 db.prepare('INSERT INTO media(id,item_id,kind,name,mime,size,object_key,created_at) VALUES(?,?,?,?,?,?,?,?)').run(photo,itemId,'photo','private-name.jpg','image/jpeg',6,'photo-key','now');
 db.prepare('INSERT INTO marketplace_drafts(id,item_id,channel,data,source_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(itemId+':etsy',itemId,'etsy',JSON.stringify(data),1,'now','now');
 const env={DB:adapter,MEDIA:{head:async()=>({size:6}),get:async()=>({size:6,arrayBuffer:async()=>new TextEncoder().encode('pixels').buffer})}} as unknown as Env;
 const writes:{url:string;body:any;method:string}[]=[];
 let shopId='99',mode='',images:any[]=[],created=false;
 const transport=vi.fn(async(url:any,init:any)=>{
  const path=new URL(url).pathname;
  if(init.method!=='GET'){
   writes.push({url,body:init.body,method:init.method});
   if(path.endsWith('/listings')){created=true;if(mode==='drop-create')throw Error('PRIVATE FAILURE');return Response.json({listing_id:500,shop_id:99,state:'draft'});}
   if(path.endsWith('/inventory'))return Response.json({products:[]});
   if(path.endsWith('/images')){images=[{listing_image_id:800,rank:1}];if(mode==='drop-photo')throw Error('PRIVATE FAILURE');return Response.json(images[0]);}
  }
  if(path.endsWith('/users/me'))return Response.json({user_id:88,shop_id:Number(shopId)});
  if(path.endsWith('/shops/99'))return Response.json({shop_id:99,user_id:88,shop_name:'TestShop',currency_code:mode==='currency'?'GBP':'USD',is_etsy_payments_onboarded:true});
  if(path.endsWith('/shipping-profiles'))return Response.json({results:[{shipping_profile_id:5,title:'Fixed shipping',profile_type:'manual'},{shipping_profile_id:50,profile_type:'calculated'}]});
  if(path.endsWith('/readiness-state-definitions'))return Response.json({count:1,results:[{readiness_state_id:6,readiness_state:'ready_to_ship',min_processing_days:1,max_processing_days:3}]});
  if(path.endsWith('/policies/return'))return Response.json({results:[{return_policy_id:7,accepts_returns:false,accepts_exchanges:false}]});
  if(path.endsWith('/seller-taxonomy/nodes'))return Response.json({results:[{id:123,name:'Dolls',children:[]}]});
  if(path.endsWith('/listings/500'))return Response.json({listing_id:500,shop_id:99,state:mode==='published'?'active':'draft',title:data.title,description:data.description});
  if(path.endsWith('/images'))return Response.json({results:images});
  if(path.endsWith('/inventory'))return Response.json({products:[{sku:'NC-001',offerings:[{quantity:1,is_enabled:true,price:{amount:mode==='bad-price'?999:1250,divisor:100,currency_code:'USD'}}]}]});
  throw Error('Unexpected fixture request '+path);
 });
 return {db,env,data,writes,transport,provider:new EtsyProvider('private-token','key','secret',transport as any),setMode:(m:string)=>{mode=m;},setShop:(s:string)=>{shopId=s;},created:()=>created};
}
describe('Etsy shop discovery and durable draft transfers',()=>{

 it('uploads the full rotated photo bytes in the saved item order',async()=>{const f=fixture();try{
  const second=crypto.randomUUID();f.db.prepare("INSERT INTO media(id,item_id,kind,name,mime,size,object_key,sort_order,created_at) VALUES(?,?,'photo','second.png','image/png',6,'second-original',-1,'now')").run(second,itemId);
  f.db.prepare("UPDATE media SET edited_key='rotated-file',edited_mime='image/png',edited_size=7,rotation=90 WHERE id=?").run(second);
  const data={...f.data,photoIds:[photo,second]};f.db.prepare('UPDATE marketplace_drafts SET data=?').run(JSON.stringify(data));
  f.env.MEDIA.get=async(key:string)=>({size:7,arrayBuffer:async()=>new TextEncoder().encode(key==='rotated-file'?'rotated':'pixels').buffer}) as any;
  await prepareEtsyTransfer(f.env,itemId,1,1,f.provider);await advanceEtsyTransfer(f.env,itemId,f.provider);await advanceEtsyTransfer(f.env,itemId,f.provider);await advanceEtsyTransfer(f.env,itemId,f.provider);
  const form=f.writes[2].body as FormData;expect(form.get('rank')).toBe('1');expect(await (form.get('image') as Blob).text()).toBe('rotated');expect((form.get('image') as Blob).type).toBe('image/png');
 }finally{f.db.close();}});
 it('discovers the connected shop and excludes calculated shipping',async()=>{const f=fixture();try{const setup=await loadEtsySetup(f.provider);expect(setup.status).toBe('ready');expect(setup.shipping.map(p=>p.id)).toEqual(['5']);f.setShop('0');expect((await loadEtsySetup(f.provider)).status).toBe('no_shop');expect(f.writes).toEqual([]);}finally{f.db.close();}});
 it('creates one unpublished draft, sets SKU, uploads bytes and verifies it; repeated calls do not create duplicates',async()=>{const f=fixture();try{
  const [a,b]=await Promise.all([prepareEtsyTransfer(f.env,itemId,1,1,f.provider),prepareEtsyTransfer(f.env,itemId,1,1,f.provider)]);expect(a.id).toBe(b.id);expect(f.writes).toHaveLength(0);
  await Promise.all([advanceEtsyTransfer(f.env,itemId,f.provider),advanceEtsyTransfer(f.env,itemId,f.provider)]);
  expect(f.writes).toHaveLength(1);
  for(let i=0;i<3;i++)await advanceEtsyTransfer(f.env,itemId,f.provider);
  expect((await advanceEtsyTransfer(f.env,itemId,f.provider)).state).toBe('complete');expect(f.writes).toHaveLength(3);
  expect(f.writes[0].body.get('state')).toBeNull();expect(f.writes[0].body.get('should_auto_renew')).toBe('false');expect(f.writes[0].body.get('description')).not.toContain('PRIVATE');expect(JSON.parse(f.writes[1].body).products[0].sku).toBe('NC-001');expect(f.writes[2].body.get('image')).toBeInstanceOf(Blob);
  expect(await prepareEtsyTransfer(f.env,itemId,1,1,f.provider)).toMatchObject({id:a.id,listingId:'500',state:'complete'});
 }finally{f.db.close();}});
 it('never repeats a create POST whose response was lost',async()=>{const f=fixture();try{await prepareEtsyTransfer(f.env,itemId,1,1,f.provider);f.setMode('drop-create');expect((await advanceEtsyTransfer(f.env,itemId,f.provider)).state).toBe('review_required');expect(f.created()).toBe(true);await advanceEtsyTransfer(f.env,itemId,f.provider);expect(f.writes).toHaveLength(1);}finally{f.db.close();}});
 it('preserves the listing ID when a photo response is lost, and stops rather than uploading duplicates',async()=>{const f=fixture();try{await prepareEtsyTransfer(f.env,itemId,1,1,f.provider);await advanceEtsyTransfer(f.env,itemId,f.provider);await advanceEtsyTransfer(f.env,itemId,f.provider);f.setMode('drop-photo');expect(await advanceEtsyTransfer(f.env,itemId,f.provider)).toMatchObject({state:'review_required',listingId:'500'});await advanceEtsyTransfer(f.env,itemId,f.provider);expect(f.writes).toHaveLength(3);}finally{f.db.close();}});
 it('rejects stale revisions, wrong shops, and non-USD setup before creating anything',async()=>{const f=fixture();try{await expect(prepareEtsyTransfer(f.env,itemId,2,1,f.provider)).rejects.toThrow('changed');f.setMode('currency');await expect(prepareEtsyTransfer(f.env,itemId,1,1,f.provider)).rejects.toThrow('USD');f.setMode('');await prepareEtsyTransfer(f.env,itemId,1,1,f.provider);f.setShop('100');await expect(advanceEtsyTransfer(f.env,itemId,f.provider)).rejects.toThrow('shop changed');expect(f.writes).toHaveLength(0);}finally{f.db.close();}});
 it('blocks subsequent writes if someone publishes the draft outside the app',async()=>{const f=fixture();try{await prepareEtsyTransfer(f.env,itemId,1,1,f.provider);await advanceEtsyTransfer(f.env,itemId,f.provider);f.setMode('published');await expect(advanceEtsyTransfer(f.env,itemId,f.provider)).rejects.toThrow('no longer an unpublished draft');expect(f.writes).toHaveLength(1);}finally{f.db.close();}});
 it('does not report completion if the price read back from Etsy differs',async()=>{const f=fixture();try{await prepareEtsyTransfer(f.env,itemId,1,1,f.provider);for(let i=0;i<3;i++)await advanceEtsyTransfer(f.env,itemId,f.provider);f.setMode('bad-price');expect((await advanceEtsyTransfer(f.env,itemId,f.provider)).state).toBe('review_required');}finally{f.db.close();}});
 it('keeps remote-operation history after item removal and treats abandoned in-flight steps as uncertain',async()=>{const f=fixture();try{await prepareEtsyTransfer(f.env,itemId,1,1,f.provider);f.db.exec("UPDATE etsy_transfers SET state='running',started_at=1; DELETE FROM media; DELETE FROM marketplace_drafts; DELETE FROM items;");const row:any=f.db.prepare('SELECT * FROM etsy_transfers').get();expect(transferView(row).state).toBe('review_required');await advanceEtsyTransfer(f.env,itemId,f.provider);expect(f.writes).toHaveLength(0);}finally{f.db.close();}});
});
