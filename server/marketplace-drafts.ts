import {orderedPhotoIds} from '../shared/photos';
import {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {getItem,now} from './db';
import type {Media} from '../shared/domain';
import {channels,marketplaceFields,seedMarketplace,checkMarketplace,requestPreview,type MarketplaceDraft} from '../shared/marketplaces';
export const marketplaceDrafts=new Hono<{Bindings:Env}>();
const from=(r:any):MarketplaceDraft=>({id:r.id,itemId:r.item_id,channel:r.channel,data:marketplaceFields.parse(JSON.parse(r.data)),sourceVersion:r.source_version,version:r.version,updatedAt:r.updated_at});
async function media(env:Env,id:string){return (await env.DB.prepare('SELECT id,kind FROM media WHERE item_id=? ORDER BY sort_order,created_at,id').bind(id).all<Media>()).results;}
marketplaceDrafts.get('/api/items/:id/marketplace-drafts',async c=>{
 const item=await getItem(c.env,c.req.param('id'));if(!item||item.recordType==='batch')return c.json({error:'Item not found.'},404);
 const photos=await media(c.env,item.id),rows=await c.env.DB.prepare('SELECT * FROM marketplace_drafts WHERE item_id=?').bind(item.id).all<any>();
 return c.json(channels.map(channel=>{const row=rows.results.find(r=>r.channel===channel),draft=row?from(row):{id:`${item.id}:${channel}`,itemId:item.id,channel,data:seedMarketplace(item,photos),sourceVersion:item.version,version:0,updatedAt:''};draft.data.photoIds=orderedPhotoIds(draft.data.photoIds,photos);return {draft,checks:checkMarketplace(channel,draft.data,item,photos,draft.sourceVersion),preview:requestPreview(channel,item,draft.data)};}));
});
marketplaceDrafts.put('/api/items/:id/marketplace-drafts/:channel',async c=>{
 const channel=z.enum(channels).parse(c.req.param('channel')),body=z.object({data:marketplaceFields,version:z.number().int().nonnegative(),sourceVersion:z.number().int().positive()}).parse(await c.req.json());
 const item=await getItem(c.env,c.req.param('id'));if(!item||item.recordType==='batch')return c.json({error:'Item not found.'},404);
 if(item.version!==body.sourceVersion)return c.json({error:'Item details changed. Your draft edits are kept. Reload the item in another tab to compare, then review and save again.'},409);
 const photos=await media(c.env,item.id);if(body.data.photoIds.some(id=>!photos.some(m=>m.id===id&&m.kind==='photo')))return c.json({error:'Choose photos belonging to this item.'},400);
 body.data.photoIds=orderedPhotoIds(body.data.photoIds,photos);
 const id=`${item.id}:${channel}`,date=now();
 // The item revision is checked in the same statement as the draft revision.
 const result=body.version===0?await c.env.DB.prepare('INSERT OR IGNORE INTO marketplace_drafts(id,item_id,channel,data,source_version,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM items WHERE id=? AND version=?)').bind(id,item.id,channel,JSON.stringify(body.data),body.sourceVersion,date,date,item.id,body.sourceVersion).run():await c.env.DB.prepare('UPDATE marketplace_drafts SET data=?,source_version=?,version=version+1,updated_at=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM items WHERE id=? AND version=?)').bind(JSON.stringify(body.data),body.sourceVersion,date,id,body.version,item.id,body.sourceVersion).run();
 if(!result.meta.changes)return c.json({error:'This draft or item changed in another session. Your edits are kept. Compare the saved draft before replacing it.'},409);
 const draft=from(await c.env.DB.prepare('SELECT * FROM marketplace_drafts WHERE id=?').bind(id).first());
 return c.json({draft,checks:checkMarketplace(channel,draft.data,item,photos,draft.sourceVersion),preview:requestPreview(channel,item,draft.data)});
});
