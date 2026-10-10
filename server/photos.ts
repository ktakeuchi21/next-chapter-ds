import {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {getItem,now,uuid} from './db';
import {putOriginal} from './media-storage';
export const photoRoutes=new Hono<{Bindings:Env}>();
const idle="NOT EXISTS(SELECT 1 FROM jobs WHERE item_id=? AND state IN ('queued','running')) AND NOT EXISTS(SELECT 1 FROM etsy_transfers WHERE item_id=? AND state IN ('ready','running'))";
const conflict='The item changed or a task is using these photos. Refresh and finish active research or transfers before editing photos.';
photoRoutes.put('/api/items/:id/photos/order',async c=>{
 const b=z.object({version:z.number().int().positive(),photoIds:z.array(z.string().uuid()).min(1).max(100)}).parse(await c.req.json()),id=c.req.param('id');
 const item=await getItem(c.env,id);if(!item)return c.notFound();
 const rows=(await c.env.DB.prepare("SELECT id FROM media WHERE item_id=? AND kind='photo' ORDER BY sort_order,created_at,id").bind(id).all<{id:string}>()).results;
 if(new Set(b.photoIds).size!==rows.length||b.photoIds.length!==rows.length||rows.some(p=>!b.photoIds.includes(p.id)))return c.json({error:'Include every photo from this item exactly once.'},400);
 const date=now();
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE items SET version=version+1,updated_at=? WHERE id=? AND version=? AND ${idle}`).bind(date,id,b.version,id,id),
  c.env.DB.prepare("UPDATE media SET sort_order=(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=media.id) WHERE item_id=? AND kind='photo' AND changes()=1").bind(JSON.stringify(b.photoIds),id)
 ]);
 if(!result[0].meta.changes)return c.json({error:conflict},409);
 // Selected subsets use this order at every listing boundary, including old drafts.
 await c.env.DB.prepare('INSERT INTO activity(id,item_id,message,created_at) VALUES(?,?,?,?)').bind(uuid(),id,'Photo order updated. First photo is the cover.',date).run();
 return c.json(await getItem(c.env,id));
});
photoRoutes.post('/api/items/:id/photos/:photoId/rotation',async c=>{
 const id=c.req.param('id'),photoId=c.req.param('photoId'),form=await c.req.formData();
 const version=z.coerce.number().int().positive().parse(form.get('version')),rotation=z.coerce.number().refine(v=>[0,90,180,270].includes(v)).parse(form.get('rotation'));
 const row=await c.env.DB.prepare("SELECT * FROM media WHERE id=? AND item_id=? AND kind='photo'").bind(photoId,id).first<any>();if(!row)return c.json({error:'Photo not found on this item.'},404);
 const item=await getItem(c.env,id);if(!item||item.version!==version)return c.json({error:conflict},409);
 let key:string|null=null,previewKey:string|null=null,mime:string|null=null,size:number|null=null;
 if(rotation!==0){
  const file=form.get('file'),preview=form.get('preview');
  if(!file||typeof file==='string'||!['image/jpeg','image/png'].includes(file.type)||file.size===0||file.size>20*1024*1024||!preview||typeof preview==='string'||preview.type!=='image/jpeg'||preview.size===0||preview.size>2*1024*1024)return c.json({error:'Save a JPG/PNG photo under 20 MB with a JPG preview under 2 MB.'},400);
  key=row.object_key+'/edits/'+uuid();previewKey=key+'/preview';mime=file.type;size=file.size;
  try{await putOriginal(c.env.MEDIA,key,await file.arrayBuffer(),mime);await putOriginal(c.env.MEDIA,previewKey,await preview.arrayBuffer(),'image/jpeg');}catch(e){await c.env.MEDIA.delete([key,previewKey]);throw e;}
 }
 try{
  const date=now();const result=await c.env.DB.batch([
   c.env.DB.prepare(`UPDATE items SET version=version+1,updated_at=? WHERE id=? AND version=? AND ${idle} AND EXISTS(SELECT 1 FROM media WHERE id=? AND item_id=? AND revision=?)`).bind(date,id,version,id,id,photoId,id,row.revision),
   c.env.DB.prepare('UPDATE media SET rotation=?,edited_key=?,edited_preview_key=?,edited_mime=?,edited_size=?,revision=revision+1 WHERE id=? AND item_id=? AND changes()=1').bind(rotation,key,previewKey,mime,size,photoId,id),
   c.env.DB.prepare('INSERT INTO activity(id,item_id,message,created_at) SELECT ?,?,?,? WHERE changes()=1').bind(uuid(),id,rotation?'Photo rotation saved for listings.':'Photo restored to original orientation.',date)
  ]);
  if(!result[0].meta.changes){if(key)await c.env.MEDIA.delete([key,previewKey!]);return c.json({error:conflict},409);}
 }catch(e){if(key)await c.env.MEDIA.delete([key,previewKey!]);throw e;}
 // Retain old revisions so a backup already in progress can finish its snapshot.
 return c.json(await getItem(c.env,id));
});
