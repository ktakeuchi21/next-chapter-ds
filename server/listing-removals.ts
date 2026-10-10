import {z} from 'zod';
import type {Env} from './types';
import {providerRequest} from './marketplace-providers';

export const removalTarget=z.object({channel:z.enum(['etsy','ebay']),environment:z.enum(['production','sandbox']),accountId:z.string().min(1).max(160),externalListingId:z.string().min(1).max(160),offerId:z.string().max(160).optional(),sku:z.string().min(1).max(160)});
export type RemovalTarget=z.infer<typeof removalTarget>;
export type ListingObservation={state:'active'|'inactive'|'unknown';accountId:string;externalListingId:string|null;offerId?:string;sku:string;singleItem:boolean};
export interface RemovalAdapter {target:RemovalTarget;read():Promise<ListingObservation>;deactivate():Promise<unknown>;}
type RemovalRow={id:string;listing_id:string;item_id:string;target:string;state:string;attempt_token:string|null;started_at:number};
const label={etsy:'Etsy',ebay:'eBay'};
function sameIdentity(target:RemovalTarget,observation:ListingObservation,allowWithdrawn=false){return observation.accountId===target.accountId&&observation.sku===target.sku&&observation.singleItem&&(observation.externalListingId===target.externalListingId||(allowWithdrawn&&target.channel==='ebay'&&observation.state==='inactive'&&observation.externalListingId===null))&&(target.channel!=='ebay'||!!target.offerId&&observation.offerId===target.offerId);}
async function unavailable(env:Env,row:{listing_id:string;item_id:string},target:RemovalTarget){return env.DB.prepare("SELECT listings.id FROM listings JOIN items ON items.id=listings.item_id WHERE listings.id=? AND listings.item_id=? AND listings.channel=? AND listings.state='removal_needed' AND items.status IN ('sold','fulfilled') AND items.code=?").bind(row.listing_id,row.item_id,label[target.channel],target.sku).first();}
// No target is derived from a pasted marketplace URL. A future activation flow
// supplies authenticated listing/offer identifiers and the seller-scoped adapter.
export async function prepareListingRemoval(env:Env,listingId:string,adapter:RemovalAdapter,options:{enabled?:boolean}={}){
 if(!options.enabled)return {state:'disabled'};
 const target=removalTarget.parse(adapter.target);if(target.environment!=='production')throw Error('Sandbox listings cannot change production inventory');
 const existing=await env.DB.prepare('SELECT * FROM listing_removals WHERE listing_id=?').bind(listingId).first<RemovalRow>();if(existing){if(existing.target!==JSON.stringify(target))throw Error('The verified marketplace target changed');return existing;}
 const listing=await env.DB.prepare('SELECT id listing_id,item_id FROM listings WHERE id=?').bind(listingId).first<{listing_id:string;item_id:string}>();if(!listing||!await unavailable(env,listing,target))throw Error('Only an unavailable item with a pending listing removal can be prepared');
 const observation=await adapter.read();if(!sameIdentity(target,observation)||observation.state==='unknown')throw Error('Verify the seller, listing identifier, SKU and single-item listing in the marketplace first');
 const id=crypto.randomUUID(),date=new Date().toISOString();
 await env.DB.prepare("INSERT OR IGNORE INTO listing_removals(id,listing_id,item_id,target,state,message,created_at,updated_at) VALUES(?,?,?,?,'ready','Verified target. Removal has not been sent.',?,?)").bind(id,listingId,listing.item_id,JSON.stringify(target),date,date).run();
 return (await env.DB.prepare('SELECT * FROM listing_removals WHERE listing_id=?').bind(listingId).first<RemovalRow>())!;
}
// Persist the uncertain-write state BEFORE any remote request. A network timeout,
// process crash or 5xx can only be followed by readback, never an automatic POST.
export async function advanceListingRemoval(env:Env,listingId:string,adapter:RemovalAdapter,options:{enabled?:boolean;time?:number}={}){
 if(!options.enabled)return {state:'disabled'};
 const row=await env.DB.prepare('SELECT * FROM listing_removals WHERE listing_id=?').bind(listingId).first<RemovalRow>();if(!row)throw Error('Prepare the verified listing target first');
 const target=removalTarget.parse(adapter.target);if(JSON.stringify(target)!==row.target)throw Error('The connected marketplace target changed');
 if(row.state==='complete')return {state:'complete'};
 const time=options.time??Date.now();if(row.state==='running'&&row.started_at>time-120000)return {state:'busy'};
 const date=new Date(time).toISOString(),token=crypto.randomUUID();
 const locked=await env.DB.prepare("UPDATE listing_removals SET state='running',attempt_token=?,started_at=?,updated_at=? WHERE id=? AND state=? AND started_at=?").bind(token,time,date,row.id,row.state,row.started_at).run();if(!locked.meta.changes)return {state:'busy'};
 const save=async(state:string,message:string)=>{await env.DB.prepare('UPDATE listing_removals SET state=?,message=?,updated_at=? WHERE id=? AND attempt_token=?').bind(state,message,date,row.id,token).run();return {state,message};};
 try {
  if(!await unavailable(env,row,target))return save('review_required','Item availability or listing state changed. Review this removal manually.');
  let observation=await adapter.read();if(!sameIdentity(target,observation,row.state!=='ready')||observation.state==='unknown')return save('review_required','Marketplace identity or availability could not be verified. No automatic retry.');
  if(observation.state==='active'){
   if(row.state!=='ready')return save('review_required','The earlier removal may have reached the marketplace. The listing is still active; review before attempting another removal.');
   if(!await unavailable(env,row,target))return save('review_required','Item availability changed before removal. Review it manually.');
   await adapter.deactivate();
   observation=await adapter.read();
   if(!sameIdentity(target,observation,true)||observation.state!=='inactive')return save('review_required','The marketplace has not confirmed that this listing is inactive.');
  }
  const results=await env.DB.batch([
   env.DB.prepare("UPDATE listing_removals SET state='complete',message='Marketplace confirmed this listing is inactive.',verified_at=?,updated_at=? WHERE id=? AND attempt_token=? AND EXISTS(SELECT 1 FROM items WHERE id=? AND status IN ('sold','fulfilled'))").bind(date,date,row.id,token,row.item_id),
   env.DB.prepare("UPDATE listings SET state='removed',updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM listing_removals WHERE id=? AND attempt_token=? AND state='complete')").bind(date,listingId,row.id,token)
  ]);
  if(!results[0].meta.changes)return save('review_required','Item state changed while checking the marketplace. Review before continuing.');
  return {state:'complete'};
 }catch{return save('review_required','The marketplace request may have completed. Check its current state before attempting another removal.');}
}

export class EtsyRemovalAdapter implements RemovalAdapter {
 constructor(public readonly target:RemovalTarget,private token:string,private key:string,private secret:string,private transport:typeof fetch=fetch){if(target.channel!=='etsy'||target.environment!=='production')throw Error('Expected production Etsy listing');}
 private async request(path:string,method='GET',body?:URLSearchParams){return (await providerRequest('https://api.etsy.com/v3/application'+path,{method,headers:{Authorization:`Bearer ${this.token}`,'x-api-key':`${this.key}:${this.secret}`},body},this.transport)).data;}
 async read():Promise<ListingObservation>{
  const t=this.target,listing=z.object({listing_id:z.union([z.string(),z.number()]).transform(String),shop_id:z.union([z.string(),z.number()]).transform(String),state:z.string()}).parse(await this.request('/listings/'+encodeURIComponent(t.externalListingId)));
  const inventory=z.object({products:z.array(z.object({sku:z.string(),is_deleted:z.boolean().optional(),offerings:z.array(z.object({quantity:z.number().int().min(0),is_deleted:z.boolean().optional()}))}))}).parse(await this.request('/listings/'+encodeURIComponent(t.externalListingId)+'/inventory'));
  const products=inventory.products.filter(p=>!p.is_deleted),offers=products.flatMap(p=>p.offerings.filter(o=>!o.is_deleted));
  return {accountId:listing.shop_id,externalListingId:listing.listing_id,sku:products[0]?.sku??'',singleItem:products.length===1&&offers.length===1&&offers[0].quantity<=1,state:listing.state==='active'?'active':['inactive','sold_out','expired','draft'].includes(listing.state)?'inactive':'unknown'};
 }
 deactivate(){const t=this.target;return this.request(`/shops/${encodeURIComponent(t.accountId)}/listings/${encodeURIComponent(t.externalListingId)}`,'PATCH',new URLSearchParams({state:'inactive'}));}
}
// getOffer does not establish the seller or prove that a listing has no other
// variations. Activation must provide both independently verified identities.
// This context is server-only: never construct it from a browser payload or URL.
export type EbayRemovalVerification={
 seller:{accountId:string;environment:'production'|'sandbox'};
 listing:{externalListingId:string;offerId:string;sku:string;kind:'single_item';source:'authenticated_import'|'recorded_creation'};
};
export class EbayRemovalAdapter implements RemovalAdapter {
 private base:string;
 constructor(public readonly target:RemovalTarget,private token:string,private transport:typeof fetch=fetch,private verification?:EbayRemovalVerification){if(target.channel!=='ebay'||!target.offerId)throw Error('A verified Inventory API offer is required');this.base=`https://api${target.environment==='sandbox'?'.sandbox':''}.ebay.com/sell/inventory/v1`;}
 private verifiedContext(){const v=this.verification,t=this.target;return !!v&&v.seller.accountId===t.accountId&&v.seller.environment===t.environment&&v.listing.externalListingId===t.externalListingId&&v.listing.offerId===t.offerId&&v.listing.sku===t.sku&&v.listing.kind==='single_item'&&['authenticated_import','recorded_creation'].includes(v.listing.source);}
 private async request(path:string,method='GET'){return (await providerRequest(this.base+path,{method,headers:{Authorization:`Bearer ${this.token}`}},this.transport)).data;}
 async read():Promise<ListingObservation>{const t=this.target,o=z.object({offerId:z.string(),sku:z.string(),status:z.string(),availableQuantity:z.number().int().min(0),inventoryItemGroupKey:z.string().optional(),listing:z.object({listingId:z.string().optional(),listingStatus:z.string().optional()}).optional()}).parse(await this.request('/offer/'+encodeURIComponent(t.offerId!)));
  const verified=this.verifiedContext();
  return {accountId:verified?this.verification!.seller.accountId:'',externalListingId:o.listing?.listingId??null,offerId:o.offerId,sku:o.sku,singleItem:verified&&!o.inventoryItemGroupKey&&o.availableQuantity<=1,state:o.status==='UNPUBLISHED'?'inactive':o.status==='PUBLISHED'&&o.listing?.listingStatus==='ACTIVE'?'active':'unknown'};
 }
 deactivate(){if(!this.verifiedContext())throw Error('Verify the authenticated seller and single-item listing mapping before removing this eBay offer.');return this.request('/offer/'+encodeURIComponent(this.target.offerId!)+'/withdraw','POST');}
}
