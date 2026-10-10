import {orderedPhotoIds} from '../shared/photos';
import {Hono} from 'hono';
import type {Env} from './types';
import {getItem,now} from './db';
import {pickupFormSchema,pickupInput,pickupReadiness,facebookItemUrl,type Pickup} from '../shared/pickup';
import type {Media} from '../shared/domain';
export const pickupRoutes=new Hono<{Bindings:Env}>();
pickupRoutes.post('/api/items/:id/pickup',async c=>{
 const b=pickupInput.parse(await c.req.json()),id=c.req.param('id'),item=await getItem(c.env,id);
 if(!item)return c.json({error:'Item not found.'},404);
 if(item.version!==b.version)return c.json({error:'This item changed. Your pickup edits are kept; review the latest saved details before retrying.'},409);
 if(item.recordType==='batch'||['archived','fulfilled'].includes(item.status))return c.json({error:'This item is not available for pickup changes.'},400);
 const old=item.pickup,p:Pickup={...pickupFormSchema.parse(old||{}),...b.form,...(old?.collectedAt?{collectedAt:old.collectedAt,paymentConfirmed:old.paymentConfirmed}:{}),noShows:old?.noShows||0};
 const photos=(await c.env.DB.prepare("SELECT id,kind FROM media WHERE item_id=? ORDER BY sort_order,created_at,id").bind(id).all<Media>()).results;
 if(p.photoIds.some(mid=>!photos.some(m=>m.id===mid&&m.kind==='photo'))||new Set(p.photoIds).size!==p.photoIds.length)return c.json({error:'Review the selected photos.'},400);
 p.photoIds=orderedPhotoIds(p.photoIds,photos);
 let status=item.status;let message='Pickup details saved.';let url:string|null=null;
 if(old?.collectedAt&&b.action!=='complete')return c.json({error:'This pickup is already collected. End the remaining listings, then complete it.'},400);
 if(b.action==='complete'&&old)Object.assign(p,old);
 if(b.action==='save'){
  if(item.status==='reserved'&&(!p.buyer||!p.scheduledAt||p.agreedPrice===null))return c.json({error:'An arranged pickup needs a buyer, time and price. Use cancel pickup to clear it.'},400);
  if(item.fulfillment!=='pickup'&&['listed','reserved','sold'].includes(item.status))return c.json({error:'Choose local pickup in Details before starting this workflow.'},400);
  if(item.status==='sold'&&!old)return c.json({error:'This sale was recorded outside the pickup workflow. Finish it using the existing fulfillment steps.'},400);
 }else if(b.action==='listed'){
  if(!['intake','review','ready','listed'].includes(item.status))return c.json({error:'This item cannot be marked listed now.'},400);
  const media=await c.env.DB.prepare('SELECT id,kind FROM media WHERE item_id=?').bind(id).all<Media>();
  const missing=pickupReadiness({...item,fulfillment:'pickup'},p,media.results);if(missing.length)return c.json({error:missing.join('. ')+'.'},400);
  url=facebookItemUrl(b.url||'');if(!url)return c.json({error:'Paste the Facebook Marketplace item link, beginning https://www.facebook.com/marketplace/item/.'},400);
  if(!b.confirmed)return c.json({error:'Confirm you published and checked the listing on Facebook.'},400);
  const existing=await c.env.DB.prepare("SELECT url FROM listings WHERE item_id=? AND channel='Facebook Marketplace' AND state!='removed'").bind(id).all<{url:string}>();
  if(existing.results.some(l=>facebookItemUrl(l.url)!==url))return c.json({error:'A different Facebook listing is already tracked. End it and confirm removal before adding another.'},409);
  if(existing.results.length)url=existing.results[0].url;
  status='listed';message='Facebook publication confirmed manually; listing link saved.';
 }else if(b.action==='arrange'){
  if(!['listed','reserved'].includes(item.status)||!old)return c.json({error:'Record the published pickup listing first.'},400);
  if(!await c.env.DB.prepare("SELECT id FROM listings WHERE item_id=? AND channel='Facebook Marketplace' AND state='active'").bind(id).first())return c.json({error:'Add an active Facebook listing before arranging pickup.'},400);
  if(item.availability!=='available')return c.json({error:'Confirm the item is available before arranging pickup.'},400);
  if(!p.buyer||!p.scheduledAt||p.agreedPrice===null)return c.json({error:'Add the buyer, agreed pickup time and agreed price (use 0 for free).'},400);
  if(new Date(p.scheduledAt).getTime()<=Date.now())return c.json({error:'Choose a future pickup time.'},400);
  status='reserved';message='Pickup arranged. Update Facebook to pending manually.';
 }else if(b.action==='no_show'){
  if(item.status!=='reserved'||!old||old.collectedAt||!b.confirmed)return c.json({error:'Confirm the arranged pickup was cancelled or the buyer did not show.'},400);
  p.buyer='';p.scheduledAt='';p.agreedPrice=null;p.instructions='';p.noShows=(old.noShows||0)+1;status='listed';message='Pickup cancelled / no-show recorded. Make the Facebook listing available again manually.';
 }else if(b.action==='collect'){
  if(!['listed','reserved','sold'].includes(item.status)||!old||old.collectedAt||!b.confirmed||!b.paymentConfirmed)return c.json({error:'Confirm collection and payment received (or an agreed free handoff).'},400);
  if(p.agreedPrice===null)return c.json({error:'Record the actual agreed price, including 0 for a free handoff.'},400);
  p.collectedAt=now();p.paymentConfirmed=true;status='sold';message='Collection and payment confirmed. All tracked listings must now be ended.';
 }else{
  if(item.status!=='sold'||!old?.collectedAt||!old.paymentConfirmed)return c.json({error:'Confirm collection and payment before completing this pickup.'},400);
  if(await c.env.DB.prepare("SELECT id FROM listings WHERE item_id=? AND state!='removed'").bind(id).first())return c.json({error:'End every tracked marketplace listing and confirm removal below first.'},400);
  status='fulfilled';message='Local pickup completed.';
 }
 const date=now();
 // One conditional statement persists metadata and lifecycle together. Database triggers
 // flag cross-listings when sold; link/audit inserts are gated on this update in one batch.
 const statements=[c.env.DB.prepare("UPDATE items SET data=json_set(data,'$.pickup',json(?),'$.fulfillment','pickup'),status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND (?!='fulfilled' OR NOT EXISTS(SELECT 1 FROM listings WHERE item_id=? AND state!='removed'))").bind(JSON.stringify(p),status,date,id,b.version,status,id)];
 if(url)statements.push(c.env.DB.prepare("INSERT INTO listings(id,item_id,channel,url,state,updated_at) SELECT ?,?,'Facebook Marketplace',?,'active',? WHERE changes()=1 ON CONFLICT(item_id,url) DO UPDATE SET state='active',updated_at=excluded.updated_at").bind(crypto.randomUUID(),id,url,date));
 statements.push(c.env.DB.prepare('INSERT INTO activity(id,item_id,message,created_at) SELECT ?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),id,message,date));
 const results=await c.env.DB.batch(statements);if(!results[0].meta.changes)return c.json({error:'This item changed. Your edits are kept; review the latest saved details.'},409);
 return c.json(await getItem(c.env,id));
});
