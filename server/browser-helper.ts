import {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {authenticate} from './auth';
import {getItem,now} from './db';
import {pickupReadiness,pickupFormSchema,facebookItemUrl} from '../shared/pickup';
import {orderedPhotoIds,currentPhoto} from '../shared/photos';
import {helperReasons,type HandoffPayload} from '../shared/browser-helper';
import config from '../shared/browser-helper-config.json';
import {mediaResponse} from './media-storage';
export const browserHelper=new Hono<{Bindings:Env;Variables:{owner:string}}>();
browserHelper.use('*',async(c,next)=>{try{c.set('owner',await authenticate(c.req.raw,c.env));}catch{return c.json({error:'Sign into Next Chapter in this browser.'},401);}await next();});
const id=z.string().uuid();
async function find(c:any,taskId:string){return c.env.DB.prepare('SELECT * FROM facebook_handoffs WHERE id=? AND owner=?').bind(taskId,c.get('owner')).first();}
async function current(c:any,row:any){const item=await getItem(c.env,row.item_id);return !!item&&item.version===row.source_version&&item.availability==='available'&&item.fulfillment==='pickup'&&['intake','review','ready'].includes(item.status);}
async function device(c:any,deviceId:string){return c.env.DB.prepare('SELECT id FROM browser_devices WHERE id=? AND owner=? AND revoked_at IS NULL').bind(deviceId,c.get('owner')).first();}
async function view(c:any,row:any){return {id:row.id,itemId:row.item_id,sourceVersion:row.source_version,state:row.state,revision:row.revision,reason:row.reason,listingUrl:row.listing_url,createdAt:row.created_at,updatedAt:row.updated_at,payload:JSON.parse(row.payload),stale:!await current(c,row),deviceId:row.device_id,attemptId:row.attempt_id};}
const actor=z.object({deviceId:id,attemptId:id});
browserHelper.get('/api/browser-helper/config',c=>c.json({extensionId:config.extensionId,version:config.version,downloadUrl:'/downloads/next-chapter-helper.zip'}));
browserHelper.get('/api/browser-helper/devices',async c=>c.json((await c.env.DB.prepare('SELECT id,name,created_at createdAt,last_seen_at lastSeenAt FROM browser_devices WHERE owner=? AND revoked_at IS NULL ORDER BY created_at').bind(c.get('owner')).all()).results));
browserHelper.post('/api/browser-helper/devices',async c=>{const b=z.object({id,name:z.string().trim().min(1).max(80)}).parse(await c.req.json()),date=now();const existing=await c.env.DB.prepare('SELECT owner FROM browser_devices WHERE id=?').bind(b.id).first<any>();if(existing&&existing.owner!==c.get('owner'))return c.json({error:'This browser belongs to another workspace account.'},409);await c.env.DB.prepare('INSERT INTO browser_devices(id,owner,name,created_at,last_seen_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,revoked_at=NULL,last_seen_at=excluded.last_seen_at WHERE browser_devices.owner=excluded.owner').bind(b.id,c.get('owner'),b.name,date,date).run();return c.json({id:b.id,name:b.name});});
browserHelper.delete('/api/browser-helper/devices/:id',async c=>{const deviceId=id.parse(c.req.param('id')),date=now();await c.env.DB.batch([c.env.DB.prepare('UPDATE browser_devices SET revoked_at=? WHERE id=? AND owner=?').bind(date,deviceId,c.get('owner')),c.env.DB.prepare("UPDATE facebook_handoffs SET state='attention',reason='device_revoked',revision=revision+1,updated_at=? WHERE device_id=? AND owner=? AND state NOT IN ('complete','cancelled','link_received')").bind(date,deviceId,c.get('owner'))]);return c.json({ok:true});});
browserHelper.get('/api/items/:id/facebook-handoffs',async c=>{const rows=await c.env.DB.prepare('SELECT * FROM facebook_handoffs WHERE item_id=? AND owner=? ORDER BY created_at DESC LIMIT 5').bind(c.req.param('id'),c.get('owner')).all();return c.json(await Promise.all(rows.results.map(row=>view(c,row))));});
browserHelper.post('/api/items/:id/facebook-handoffs',async c=>{
 const b=z.object({requestId:id,sourceVersion:z.number().int().positive(),reviewed:z.literal(true)}).parse(await c.req.json()),itemId=c.req.param('id');
 const prior=await find(c,b.requestId);if(prior){if(prior.item_id!==itemId)return c.json({error:'This task belongs to a different item.'},409);return c.json(await view(c,prior));}
 const item=await getItem(c.env,itemId);if(!item)return c.notFound();
 if(item.version!==b.sourceVersion)return c.json({error:'The item changed. Save and review the latest draft first.'},409);
 if(item.recordType!=='item'||item.fulfillment!=='pickup'||item.availability!=='available'||!['intake','review','ready'].includes(item.status))return c.json({error:'Only available, unlisted pickup items can start a Facebook handoff.'},400);
 if(await c.env.DB.prepare("SELECT id FROM listings WHERE item_id=? AND channel='Facebook Marketplace' AND state!='removed'").bind(itemId).first())return c.json({error:'A Facebook listing is already tracked. Open that listing instead of creating another.'},409);
 const existing=await c.env.DB.prepare("SELECT * FROM facebook_handoffs WHERE item_id=? AND state NOT IN ('complete','cancelled')").bind(itemId).first<any>();if(existing){if(existing.owner!==c.get('owner'))return c.json({error:'Another account is preparing this item.'},409);return c.json(await view(c,existing));}
 if(!item.pickup)return c.json({error:'Save the public pickup draft first.'},400);
 const p=pickupFormSchema.parse(item.pickup),photos=(await c.env.DB.prepare("SELECT * FROM media WHERE item_id=? ORDER BY sort_order,created_at,id").bind(itemId).all<any>()).results;
 const missing=pickupReadiness(item,p,photos);if(missing.length)return c.json({error:missing.join('. ')},400);
 const selected=orderedPhotoIds(p.photoIds,photos).map(mid=>photos.find(m=>m.id===mid)!);
 if(selected.some(m=>!['image/jpeg','image/png','image/webp'].includes(currentPhoto(m).mime)||currentPhoto(m).size<=0||currentPhoto(m).size>20*1024*1024))return c.json({error:'Use JPEG, PNG or WebP photos, each under 20 MB.'},400);
 if(selected.reduce((sum,m)=>sum+currentPhoto(m).size,0)>100*1024*1024)return c.json({error:'Select photos totaling under 100 MB for this browser handoff.'},400);
 const payload:HandoffPayload={version:1,code:item.code,fields:{title:p.title,price:item.price!.toFixed(2),description:p.description,pickupArea:item.pickupArea!},photos:selected.map((m,i)=>({id:m.id,revision:m.revision,mime:currentPhoto(m).mime,size:currentPhoto(m).size,name:`${item.code}-${String(i+1).padStart(2,'0')}.${currentPhoto(m).mime==='image/png'?'png':currentPhoto(m).mime==='image/webp'?'webp':'jpg'}`}))};
 const date=now();const r=await c.env.DB.prepare("INSERT OR IGNORE INTO facebook_handoffs(id,item_id,owner,source_version,payload,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM items WHERE id=? AND version=? AND status IN ('intake','review','ready')) AND NOT EXISTS(SELECT 1 FROM listings WHERE item_id=? AND channel='Facebook Marketplace' AND state!='removed')").bind(b.requestId,itemId,c.get('owner'),item.version,JSON.stringify(payload),date,date,itemId,item.version,itemId).run();
 if(!r.meta.changes)return c.json({error:'This item changed or a handoff already exists. Refresh to review it.'},409);
 return c.json(await view(c,await find(c,b.requestId)),201);
});
browserHelper.get('/api/browser-helper/tasks/:id',async c=>{const row=await find(c,c.req.param('id'));return row?c.json(await view(c,row)):c.notFound();});
browserHelper.post('/api/browser-helper/tasks/:id/claim',async c=>{
 const b=actor.parse(await c.req.json()),row=await find(c,c.req.param('id'));if(!row)return c.notFound();if(!await device(c,b.deviceId))return c.json({error:'Connect this browser in Next Chapter first.'},403);
 if(!await current(c,row))return c.json({error:'This saved task is out of date or the item is unavailable. Return to Next Chapter.'},409);
 if(row.state==='preparing'&&row.device_id===b.deviceId&&row.attempt_id===b.attemptId)return c.json({task:await view(c,row),resumed:true});
 const r=await c.env.DB.prepare("UPDATE facebook_handoffs SET state='preparing',device_id=?,attempt_id=?,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND state='queued' AND EXISTS(SELECT 1 FROM items WHERE id=facebook_handoffs.item_id AND version=facebook_handoffs.source_version AND status IN ('intake','review','ready')) AND EXISTS(SELECT 1 FROM browser_devices WHERE id=? AND owner=? AND revoked_at IS NULL)").bind(b.deviceId,b.attemptId,now(),row.id,c.get('owner'),b.deviceId,c.get('owner')).run();
 if(!r.meta.changes)return c.json({error:'This handoff already started. Inspect the existing Facebook draft before doing anything else.'},409);
 await c.env.DB.prepare('UPDATE browser_devices SET last_seen_at=? WHERE id=?').bind(now(),b.deviceId).run();return c.json({task:await view(c,await find(c,row.id)),resumed:false});
});
browserHelper.post('/api/browser-helper/tasks/:id/report',async c=>{
 const b=actor.extend({revision:z.number().int().positive(),kind:z.enum(['prepared','attention','link']),reason:z.enum(Object.keys(helperReasons) as [keyof typeof helperReasons,...(keyof typeof helperReasons)[]]).optional(),url:z.string().max(2000).optional()}).parse(await c.req.json()),row=await find(c,c.req.param('id'));if(!row)return c.notFound();
 if(!await device(c,b.deviceId)||row.device_id!==b.deviceId||row.attempt_id!==b.attemptId)return c.json({error:'This browser does not own the active handoff.'},403);
 const state=b.kind==='link'?'link_received':b.kind,url=b.kind==='link'?facebookItemUrl(b.url||''):null;
 if(b.kind==='link'&&!url)return c.json({error:'Use the direct Facebook Marketplace item link.'},400);
 if(row.state===state&&(b.kind!=='link'||row.listing_url===url))return c.json(await view(c,row));
 if(!['preparing','prepared','attention'].includes(row.state))return c.json({error:'This handoff is no longer accepting browser results.'},409);
 // Browser observations never mark inventory listed or sold. The owner confirms in the app.
 const r=await c.env.DB.prepare("UPDATE facebook_handoffs SET state=?,reason=?,listing_url=COALESCE(?,listing_url),revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=? AND state IN ('preparing','prepared','attention') AND EXISTS(SELECT 1 FROM browser_devices WHERE id=? AND owner=? AND revoked_at IS NULL)").bind(state,b.reason||'',url,now(),row.id,c.get('owner'),b.revision,b.deviceId,c.get('owner')).run();
 if(!r.meta.changes)return c.json({error:'Task progress changed. Reload its latest state.'},409);return c.json(await view(c,await find(c,row.id)));
});
browserHelper.post('/api/browser-helper/tasks/:id/cancel',async c=>{const row=await find(c,c.req.param('id'));if(!row)return c.notFound();await c.env.DB.prepare("UPDATE facebook_handoffs SET state='cancelled',revision=revision+1,updated_at=? WHERE id=? AND state NOT IN ('complete','cancelled')").bind(now(),row.id).run();return c.json({ok:true});});
browserHelper.post('/api/browser-helper/tasks/:id/complete',async c=>{const row=await find(c,c.req.param('id'));if(!row)return c.notFound();if(row.state==='complete')return c.json({ok:true});if(row.state!=='link_received'||!await c.env.DB.prepare("SELECT id FROM listings WHERE item_id=? AND channel='Facebook Marketplace' AND url=? AND state='active'").bind(row.item_id,row.listing_url).first())return c.json({error:'Confirm this exact listing link on the item first.'},409);await c.env.DB.prepare("UPDATE facebook_handoffs SET state='complete',revision=revision+1,updated_at=? WHERE id=? AND state='link_received'").bind(now(),row.id).run();return c.json({ok:true});});
browserHelper.get('/api/browser-helper/tasks/:id/photos/:photoId',async c=>{
 const b=actor.parse({deviceId:c.req.query('device'),attemptId:c.req.query('attempt')}),row=await find(c,c.req.param('id'));if(!row)return c.notFound();
 if(!await device(c,b.deviceId)||row.device_id!==b.deviceId||row.attempt_id!==b.attemptId||!['preparing','prepared','attention'].includes(row.state))return c.json({error:'This photo handoff is not active on this browser.'},403);
 if(!await current(c,row))return c.json({error:'Photos or item details changed. Return to Next Chapter.'},409);
 const photo=JSON.parse(row.payload).photos.find((p:any)=>p.id===c.req.param('photoId'));if(!photo)return c.notFound();
 const media=await c.env.DB.prepare("SELECT * FROM media WHERE id=? AND item_id=? AND kind='photo' AND revision=?").bind(photo.id,row.item_id,photo.revision).first<any>();if(!media)return c.notFound();const effective=currentPhoto(media);return mediaResponse(c.env.MEDIA,effective.key,effective.mime,c.req.raw);
});
