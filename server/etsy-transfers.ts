import {orderedPhotoIds,currentPhoto} from '../shared/photos';
import {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import type {Item,Media} from '../shared/domain';
import type {EtsyTransfer} from '../shared/etsy';
import {marketplaceFields,checkMarketplace,type MarketplaceFields} from '../shared/marketplaces';
import {getItem,now} from './db';
import {EtsyProvider} from './marketplace-providers';
import {etsyProvider,loadEtsySetup,numericId,results,flattenTaxonomy,etsyError} from './etsy-setup';

class TransferInputError extends Error {}
type Row={id:string;item_id:string;shop_id:string;listing_id:string|null;draft_version:number;source_version:number;payload:string;state:EtsyTransfer['state'];step:EtsyTransfer['step'];uploaded:string;message:string;started_at:number;updated_at:string};
type Payload={code:string;data:MarketplaceFields};
const interrupted='The last step may have reached Etsy. Check the draft in Etsy before doing anything else. Automatic retries are stopped to avoid duplicates.';
export function transferView(row:Row):EtsyTransfer {
 const stale=row.state==='running'&&row.started_at<Date.now()-90000;
 return {id:row.id,shopId:row.shop_id,listingId:row.listing_id,state:stale?'review_required':row.state,step:row.step,uploaded:JSON.parse(row.uploaded).length,total:JSON.parse(row.payload).data.photoIds.length,message:stale?interrupted:row.message,draftVersion:row.draft_version,sourceVersion:row.source_version,updatedAt:row.updated_at};
}
async function rowFor(env:Env,itemId:string){return env.DB.prepare('SELECT * FROM etsy_transfers WHERE item_id=?').bind(itemId).first<Row>();}
async function checkSaved(env:Env,itemId:string,version:number,sourceVersion:number){
 const item=await getItem(env,itemId);
 const saved=await env.DB.prepare("SELECT * FROM marketplace_drafts WHERE item_id=? AND channel='etsy'").bind(itemId).first<any>();
 if(!item||!saved||item.recordType==='batch')throw new TransferInputError('Save an Etsy draft for this item first.');
 if(saved.version!==version||saved.source_version!==sourceVersion||item.version!==sourceVersion)throw new TransferInputError('The item or draft changed. Review and save it before sending to Etsy.');
 const data=marketplaceFields.parse(JSON.parse(saved.data));
 const photos=(await env.DB.prepare('SELECT * FROM media WHERE item_id=? ORDER BY sort_order,created_at,id').bind(itemId).all<any>()).results;
 const checks=checkMarketplace('etsy',data,item,photos as Media[],sourceVersion).filter(x=>x.kind!=='verification');
 if(checks.length)throw new TransferInputError(checks.map(c=>c.message).join(' '));
 data.photoIds=orderedPhotoIds(data.photoIds,photos);
 // Full-size saved JPEG/PNG photos are accepted. Never silently upload a tiny
 // preview or give Etsy a URL to the private media service.
 for(const id of data.photoIds){const row=photos.find(p=>p.id===id),photo=row?currentPhoto(row):null;if(!photo||!['image/jpeg','image/png'].includes(photo.mime)||photo.size>20000000)throw new TransferInputError('For this draft test, choose JPEG or PNG photos under 20 MB each.');if(!await env.MEDIA.head(photo.key))throw new TransferInputError('A selected photo is missing from storage.');}
 return {item,data,photos};
}
export async function prepareEtsyTransfer(env:Env,itemId:string,version:number,sourceVersion:number,provider:EtsyProvider){
 const existing=await rowFor(env,itemId);if(existing)return transferView(existing);
 const {item,data}=await checkSaved(env,itemId,version,sourceVersion);
 const setup=await loadEtsySetup(provider);
 if(setup.status!=='ready'||setup.shop?.id!==data.shopId)throw new TransferInputError(setup.issues.join(' ')||'The connected Etsy shop does not match this draft.');
 for(const [options,id,label] of [[setup.shipping,data.shippingProfileId,'shipping'],[setup.processing,data.readinessStateId,'processing'],[setup.returns,data.returnPolicyId,'return']] as const){if(!options.some(x=>x.id===id))throw new TransferInputError(`Choose a current ${label} profile from the connected Etsy shop.`);}
 const categories=flattenTaxonomy(results((await provider.taxonomy()).data));
 if(!categories.some(x=>x.id===data.categoryId))throw new TransferInputError('Choose an Etsy category from the current category list.');
 const date=now();
 // Unique item_id plus source/draft revision checks make double clicks and
 // competing sessions converge on one immutable transfer.
 await env.DB.prepare(`INSERT OR IGNORE INTO etsy_transfers(id,item_id,shop_id,draft_version,source_version,payload,created_at,updated_at)
 SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM items WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM marketplace_drafts WHERE item_id=? AND channel='etsy' AND version=? AND source_version=?)`).bind(crypto.randomUUID(),itemId,data.shopId,version,sourceVersion,JSON.stringify({code:item.code,data}),date,date,itemId,sourceVersion,itemId,version,sourceVersion).run();
 const row=await rowFor(env,itemId);if(!row)throw new TransferInputError('The item changed while checking Etsy. Review and save it again.');return transferView(row);
}

// One remote write per request. Persist 'running' BEFORE sending it. If the
// process dies or the response is ambiguous, never repeat the remote POST.
export async function advanceEtsyTransfer(env:Env,itemId:string,provider:EtsyProvider){
 let row=await rowFor(env,itemId);if(!row)throw new TransferInputError('Prepare the transfer first.');
 if(row.state!=='ready')return transferView(row);
 const snapshot:Payload=JSON.parse(row.payload),uploaded:string[]=JSON.parse(row.uploaded);
 const item=await getItem(env,itemId);
 if(!item||item.availability!=='available'||['sold','fulfilled','archived','reserved'].includes(item.status))throw new TransferInputError('The item is no longer available. Review the Etsy draft manually.');
 if(item.version!==row.source_version)throw new TransferInputError('Item details changed after this transfer was prepared. Review the existing transfer in Etsy before continuing.');
 const saved=await env.DB.prepare("SELECT version FROM marketplace_drafts WHERE item_id=? AND channel='etsy'").bind(itemId).first<any>();
 if(saved?.version!==row.draft_version)throw new TransferInputError('The saved draft changed after transfer preparation. Review the existing transfer in Etsy.');
 const me:any=(await provider.me()).data;
 if(numericId(me?.shop_id)!==row.shop_id)throw new TransferInputError('The connected Etsy shop changed. Reconnect the original shop before continuing.');
 if(row.listing_id){const listing:any=(await provider.listing(row.listing_id)).data;if(numericId(listing?.shop_id)!==row.shop_id||listing.state!=='draft')throw new TransferInputError('This listing is no longer an unpublished draft in the expected shop. Review it in Etsy.');}
 // Read the actual photo before acquiring the lease, so a missing file does
 // not leave an uncertain write in the operation ledger.
 let file:Blob|null=null;
 if(row.step==='photos'){
  const photo=await env.DB.prepare("SELECT COALESCE(edited_key,object_key) object_key,COALESCE(edited_mime,mime) mime FROM media WHERE id=? AND item_id=? AND kind='photo'").bind(snapshot.data.photoIds[uploaded.length],itemId).first<any>();
  if(!photo||!['image/jpeg','image/png'].includes(photo.mime))throw new TransferInputError('A selected photo is unavailable.');
  const object=await env.MEDIA.get(photo.object_key);if(!object||object.size>20000000)throw new TransferInputError('A selected photo is missing or too large.');file=new Blob([await object.arrayBuffer()],{type:photo.mime});
 }
 const started=Date.now();
 const acquired=await env.DB.prepare("UPDATE etsy_transfers SET state='running',started_at=?,updated_at=? WHERE id=? AND state='ready' AND step=? AND uploaded=?").bind(started,now(),row.id,row.step,row.uploaded).run();
 if(!acquired.meta.changes)return transferView((await rowFor(env,itemId))!);
 let listingId=row.listing_id,step=row.step,state:EtsyTransfer['state']='ready',message='';
 try{
  const publicItem={code:snapshot.code} as Item;
  if(step==='create'){
   const created:any=(await provider.createDraft(publicItem,snapshot.data)).data;
   listingId=numericId(created?.listing_id);
   if(!listingId)throw new TransferInputError('Missing listing identifier.');
   // Preserve the identifier immediately, even if subsequent validation fails.
   await env.DB.prepare('UPDATE etsy_transfers SET listing_id=? WHERE id=? AND started_at=?').bind(listingId,row.id,started).run();
   if(created.state!=='draft'||numericId(created.shop_id)!==row.shop_id)throw new TransferInputError('Unexpected listing state.');
   step='inventory';message='Unpublished Etsy draft created. Next: set the item label as its SKU.';
  }else if(step==='inventory'){
   await provider.setInventory(listingId!,publicItem,snapshot.data);step='photos';message='Item label saved to Etsy. Next: upload photos.';
  }else if(step==='photos'){
   const image:any=(await provider.uploadImage(row.shop_id,listingId!,file!,`item-${uploaded.length+1}.${file!.type==='image/png'?'png':'jpg'}`,uploaded.length+1)).data;
   const id=numericId(image?.listing_image_id);if(!id)throw new TransferInputError('Missing image identifier.');uploaded.push(id);
   step=uploaded.length===snapshot.data.photoIds.length?'verify':'photos';message=`${uploaded.length} of ${snapshot.data.photoIds.length} photos uploaded.`;
  }else{
   const images=results((await provider.images(listingId!)).data);
   if(uploaded.some((id,index)=>!images.some(image=>numericId(image.listing_image_id)===id&&image.rank===index+1)))throw new TransferInputError('The photos or their order differ from the transfer.');
   const listing:any=(await provider.listing(listingId!)).data;
   if(listing.state!=='draft'||numericId(listing.shop_id)!==row.shop_id||listing.title!==snapshot.data.title||listing.description!==snapshot.data.description)throw new TransferInputError('The listing changed.');
   const inventory:any=(await provider.inventory(listingId!)).data;
   const product=inventory?.products?.filter((p:any)=>!p.is_deleted);
   if(product?.length!==1||product[0].sku!==snapshot.code)throw new TransferInputError('The item label differs in Etsy.');
   const offering=product[0].offerings?.filter((o:any)=>!o.is_deleted);
   if(offering?.length!==1||offering[0].quantity!==1||offering[0].is_enabled!==true||offering[0].price?.currency_code!=='USD'||offering[0].price?.amount/offering[0].price?.divisor!==snapshot.data.price)throw new TransferInputError('Price or quantity differs in Etsy.');
   state='complete';message='Unpublished draft and photo order verified in Etsy. Review category attributes, shipping, condition and price in Shop Manager before publishing. Local edits do not sync automatically.';
  }
 }catch{
  state='review_required';message=interrupted;
 }
 await env.DB.prepare('UPDATE etsy_transfers SET state=?,step=?,listing_id=?,uploaded=?,message=?,updated_at=? WHERE id=? AND state=\'running\' AND started_at=?').bind(state,step,listingId,JSON.stringify(uploaded),message,now(),row.id,started).run();
 row=(await rowFor(env,itemId))!;return transferView(row);
}
export const etsyTransfers=new Hono<{Bindings:Env}>();
etsyTransfers.get('/api/items/:id/etsy-transfer',async c=>{const row=await rowFor(c.env,c.req.param('id'));return c.json(row?transferView(row):null);});
etsyTransfers.post('/api/items/:id/etsy-transfer',async c=>{
 const input=z.object({version:z.number().int().positive(),sourceVersion:z.number().int().positive(),confirmed:z.literal(true)}).parse(await c.req.json());
 try{return c.json(await prepareEtsyTransfer(c.env,c.req.param('id'),input.version,input.sourceVersion,await etsyProvider(c.env)));}catch(e){return c.json({error:e instanceof TransferInputError?e.message:etsyError(e)},400);}
});
etsyTransfers.post('/api/items/:id/etsy-transfer/advance',async c=>{try{return c.json(await advanceEtsyTransfer(c.env,c.req.param('id'),await etsyProvider(c.env)));}catch(e){return c.json({error:e instanceof TransferInputError?e.message:etsyError(e)},400);}});
