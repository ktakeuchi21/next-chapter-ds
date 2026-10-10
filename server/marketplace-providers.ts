import {ebayBodies,etsyBody,etsyInventory,type MarketplaceFields} from '../shared/marketplaces';
import type {Item} from '../shared/domain';

export class ProviderError extends Error {
 constructor(public status:number,public action:'reconnect'|'fix_fields'|'retry_read'|'reconcile'|'retry_later',public retryAfterSeconds:number|null=null){super(`Marketplace request failed (${status||'network'}). ${action==='reconnect'?'Reconnect the seller account.':action==='reconcile'?'Check whether the request completed before retrying.':action==='fix_fields'?'Review marketplace field requirements.':'Try again later.'}`);}
}
// There is intentionally no automatic retry of a creation POST. A dropped
// response could represent a successful remote draft and must be reconciled.
export async function providerRequest(url:string,init:RequestInit,transport:typeof fetch=fetch){
 const read=!init.method||init.method==='GET';let response:Response;
 try{response=await transport(url,{...init,redirect:'manual',signal:AbortSignal.timeout(25000)});}catch{throw new ProviderError(0,read?'retry_read':'reconcile');}
 if(!response.ok){const retryHeader=response.headers.get('retry-after'),seconds=Number(retryHeader);const retry=retryHeader&&/^\d+$/.test(retryHeader.trim())?seconds:retryHeader?Math.ceil((Date.parse(retryHeader)-Date.now())/1000):0;throw new ProviderError(response.status,response.status===401||response.status===403?'reconnect':response.status===429?'retry_later':response.status>=500?(read?'retry_read':'reconcile'):'fix_fields',retry>0&&Number.isFinite(retry)?retry:null);}
 let data:unknown=null;
 if(response.status!==204){try{const body=await response.text();if(body)data=JSON.parse(body);}catch{throw new ProviderError(response.status,read?'retry_read':'reconcile');}}
 return {data,location:response.headers.get('location')};
}
const segment=(s:string)=>encodeURIComponent(s);
export class EbayProvider {
 readonly base:string;
 constructor(private token:string,environment:'sandbox'|'production'='sandbox',private transport:typeof fetch=fetch){this.base=`https://api${environment==='sandbox'?'.sandbox':''}.ebay.com`;}
 private request(path:string,method='GET',body?:unknown){return providerRequest(this.base+path,{method,headers:{Authorization:`Bearer ${this.token}`,'Content-Language':'en-US',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})},this.transport);}
 policies(kind:'payment'|'return'|'fulfillment'){return this.request(`/sell/account/v1/${kind}_policy?marketplace_id=EBAY_US`);}
 locations(){return this.request('/sell/inventory/v1/location?limit=100');}
 offers(sku:string){return this.request(`/sell/inventory/v1/offer?sku=${segment(sku)}&marketplace_id=EBAY_US`);}
 aspects(treeId:string,categoryId:string){return this.request(`/commerce/taxonomy/v1/category_tree/${segment(treeId)}/get_item_aspects_for_category?category_id=${segment(categoryId)}`);}
 putInventory(item:Item,d:MarketplaceFields,imageUrls:string[]){if(!imageUrls.length||imageUrls.some(u=>{try{const url=new URL(u);return url.protocol!=='https:'||!url.hostname.endsWith('.ebayimg.com');}catch{return true;}}))throw Error('Upload photos to eBay before preparing inventory.');return this.request(`/sell/inventory/v1/inventory_item/${segment(item.code)}`,'PUT',ebayBodies(item,d,imageUrls).inventory);}
 createUnpublishedOffer(item:Item,d:MarketplaceFields){return this.request('/sell/inventory/v1/offer','POST',ebayBodies(item,d,[]).offer);}
 uploadImage(file:Blob,name:string){const form=new FormData();form.append('image',file,name);return providerRequest(this.base+'/commerce/media/v1_beta/image/create_image_from_file',{method:'POST',headers:{Authorization:`Bearer ${this.token}`},body:form},this.transport);}
 image(id:string){return this.request(`/commerce/media/v1_beta/image/${segment(id)}`);}
}
export class EtsyProvider {
 private base='https://api.etsy.com/v3/application';
 constructor(private token:string,private keystring:string,private sharedSecret:string,private transport:typeof fetch=fetch){}
 private request(path:string,method='GET',body?:URLSearchParams|FormData){return providerRequest(this.base+path,{method,headers:{Authorization:`Bearer ${this.token}`,'x-api-key':`${this.keystring}:${this.sharedSecret}`},...(body?{body}:{})},this.transport);}
 me(){return this.request('/users/me');}
 taxonomy(){return this.request('/seller-taxonomy/nodes');}
 properties(id:string){return this.request(`/seller-taxonomy/nodes/${segment(id)}/properties`);}
 processingProfiles(id:string,offset=0){return this.request(`/shops/${segment(id)}/readiness-state-definitions?limit=100&offset=${offset}`);}
 returnPolicies(id:string){return this.request(`/shops/${segment(id)}/policies/return`);}
 listing(id:string){return this.request(`/listings/${segment(id)}`);}
 inventory(id:string){return this.request(`/listings/${segment(id)}/inventory`);}
 images(id:string){return this.request(`/listings/${segment(id)}/images`);}
 shop(id:string){return this.request(`/shops/${segment(id)}`);}
 shippingProfiles(shopId:string){return this.request(`/shops/${segment(shopId)}/shipping-profiles`);}
 drafts(shopId:string){return this.request(`/shops/${segment(shopId)}/listings?state=draft&limit=100`);}
 createDraft(item:Item,d:MarketplaceFields){const form=new URLSearchParams();for(const [k,v] of Object.entries(etsyBody(item,d))){if(v!==null)form.set(k,Array.isArray(v)?v.join(','):String(v));}return this.request(`/shops/${segment(d.shopId)}/listings`,'POST',form);}
 setInventory(listingId:string,item:Item,d:MarketplaceFields){return providerRequest(this.base+`/listings/${segment(listingId)}/inventory`,{method:'PUT',headers:{Authorization:`Bearer ${this.token}`,'x-api-key':`${this.keystring}:${this.sharedSecret}`,'Content-Type':'application/json'},body:JSON.stringify(etsyInventory(item,d))},this.transport);}
 uploadImage(shopId:string,listingId:string,file:Blob,name:string,rank:number){const form=new FormData();form.append('image',file,name);form.set('rank',String(rank));return this.request(`/shops/${segment(shopId)}/listings/${segment(listingId)}/images`,'POST',form);}
}

// Etsy draft transfers use these adapters with a durable operation ledger.
// eBay remains provisional until the sandbox account is approved.
// No publication, purchase, deletion, or sale endpoint is exposed to the UI.
