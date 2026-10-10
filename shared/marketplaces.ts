import {z} from 'zod';
import {makeDraft,type Item,type Media} from './domain';

export const channels=['ebay','etsy'] as const;
export type Channel=typeof channels[number];
const text=z.string().trim().max(200).default('');
export const marketplaceFields=z.object({
 title:z.string().trim().max(160).default(''),description:z.string().max(10000).default(''),
 price:z.number().finite().min(0).max(1000000).nullable().default(null),
 photoIds:z.array(z.string().uuid()).max(24).default([]),categoryId:text,
 condition:text,aspects:z.record(z.string().max(80),z.array(z.string().max(200)).max(30)).default({}),
 merchantLocationKey:text,paymentPolicyId:text,returnPolicyId:text,fulfillmentPolicyId:text,
 shopId:text,shippingProfileId:text,readinessStateId:text,
 whenMade:text,latestYear:z.number().int().min(1000).max(3000).nullable().default(null),
 ageEvidence:z.string().trim().max(2000).default(''),vintageConfirmed:z.boolean().default(false),
});
export type MarketplaceFields=z.infer<typeof marketplaceFields>;
export interface MarketplaceDraft {id:string;itemId:string;channel:Channel;data:MarketplaceFields;sourceVersion:number;version:number;updatedAt:string;}
export interface Check {field:string;message:string;kind:'item'|'account'|'verification';}
export function seedMarketplace(item:Item,media:Media[]):MarketplaceFields {
 const generic=makeDraft(item);
 return marketplaceFields.parse({title:item.draftTitle||generic.title,description:item.draftDescription||generic.description,price:item.price,photoIds:media.filter(m=>m.kind==='photo').slice(0,10).map(m=>m.id)});
}
// This first release supports vintage Etsy resale only. The end of a decade
// must also be old enough, so a broad date range cannot silently certify age.
export const vintagePeriods:Record<string,number>={before_1700:1699,'1700s':1799,'1800s':1899,'1900s':1909,'1910s':1919,'1920s':1929,'1930s':1939,'1940s':1949,'1950s':1959,'1960s':1969,'1970s':1979,'1980s':1989,'1990s':1999,'2000_2006':2006};
export function checkMarketplace(channel:Channel,d:MarketplaceFields,item:Item,media:Media[],sourceVersion:number,year=new Date().getUTCFullYear()):Check[]{
 const checks:Check[]=[];
 const add=(field:string,message:string,kind:Check['kind']='item')=>checks.push({field,message,kind});
 if(!d.title)add('title','Add a listing title.');
 if(d.title.length>(channel==='ebay'?80:140))add('title',`Shorten the title to ${channel==='ebay'?80:140} characters or fewer.`);
 if(channel==='etsy'&&(/[^\p{L}\p{Nd}\p{P}\p{Sm}\p{Zs}™©®]/u.test(d.title)||['%',':','&','+'].some(c=>d.title.split(c).length>2)))add('title','Etsy titles cannot contain emoji or repeat %, :, & or +.');
 if(!d.description.trim())add('description','Add a description.');
 if(d.price===null||d.price<=0||Math.abs(d.price*100-Math.round(d.price*100))>0.00001)add('price','Choose a positive USD asking price with no more than two decimal places.');
 if(!d.photoIds.length)add('photoIds','Choose at least one photo.');
 if(new Set(d.photoIds).size!==d.photoIds.length)add('photoIds','Choose each photo only once.');
 if(d.photoIds.some(id=>!media.some(m=>m.id===id&&m.kind==='photo')))add('photoIds','A chosen photo is missing or belongs to another item.');
 if(channel==='etsy'&&d.photoIds.length>20)add('photoIds','Choose up to 20 photos for this initial Etsy integration.');
 if(item.availability!=='available'||['sold','fulfilled','archived','reserved'].includes(item.status))add('availability','Confirm the item is available and not reserved or sold.');
 if(!item.owner.trim()||!item.location.trim())add('item','Save the owner and storage location in Details.');
 if(!item.condition.trim())add('item','Record the condition in Details and review it in the description.');
 if(item.fulfillment!=='shipping')add('fulfillment','This first connector supports shipping. Keep pickup listings in the manual workflow.');
 if(sourceVersion!==item.version)add('sourceVersion','The item changed after this draft was saved. Review the draft against the current details, then save it again.');
 if(!/^\d+$/.test(d.categoryId))add('categoryId','Choose a marketplace category after account access is available.','account');
 if(channel==='ebay'){
  if(!['NEW','LIKE_NEW','USED_EXCELLENT','USED_VERY_GOOD','USED_GOOD','USED_ACCEPTABLE','FOR_PARTS_OR_NOT_WORKING'].includes(d.condition))add('condition','Choose an eBay condition; category support still needs verification.');
  for(const [field,label] of [['merchantLocationKey','inventory location'],['paymentPolicyId','payment policy'],['returnPolicyId','return policy'],['fulfillmentPolicyId','shipping policy']] as const){if(!d[field])add(field,`Select the seller’s ${label} after connecting eBay.`,'account');}
  add('categoryVerification','Check the category’s required item specifics, allowed condition, and seller policies with eBay.','verification');
 }else{
  if(!d.vintageConfirmed||!d.ageEvidence||d.latestYear===null||d.latestYear>year-20||!vintagePeriods[d.whenMade]||vintagePeriods[d.whenMade]>year-20||d.latestYear>vintagePeriods[d.whenMade]|| (d.whenMade!=='before_1700'&&d.latestYear!==null&&d.latestYear<Number(d.whenMade.slice(0,4))))add('ageEvidence','Confirm vintage eligibility with age evidence and a matching date range at least 20 years old.');
  for(const [field,label] of [['shopId','shop'],['shippingProfileId','shipping profile'],['readinessStateId','processing profile'],['returnPolicyId','return policy']] as const){if(!/^\d+$/.test(d[field]))add(field,`Select the Etsy ${label} after connecting.`,'account');}
  add('shopVerification','Verify USD shop currency, taxonomy properties, return policy, and vintage eligibility with Etsy.','verification');
 }
 return checks;
}

// Only these allowlisted public fields go to a provider. Neither a full item
// object nor a private media URL should ever be serialized into a listing.
export function ebayBodies(item:Item,d:MarketplaceFields,imageUrls:string[]){
 return {inventory:{availability:{shipToLocationAvailability:{quantity:1}},condition:d.condition,conditionDescription:item.condition,product:{title:d.title,description:d.description,aspects:d.aspects,imageUrls}},offer:{sku:item.code,marketplaceId:'EBAY_US',format:'FIXED_PRICE',availableQuantity:1,categoryId:d.categoryId,listingDescription:d.description,listingDuration:'GTC',merchantLocationKey:d.merchantLocationKey,listingPolicies:{paymentPolicyId:d.paymentPolicyId,returnPolicyId:d.returnPolicyId,fulfillmentPolicyId:d.fulfillmentPolicyId},pricingSummary:{price:{value:d.price?.toFixed(2)??'',currency:'USD'}}}};
}
export function etsyBody(item:Item,d:MarketplaceFields){
 return {quantity:1,title:d.title,description:d.description,price:d.price,who_made:'someone_else',when_made:d.whenMade,is_supply:false,taxonomy_id:d.categoryId,type:'physical',shipping_profile_id:d.shippingProfileId,readiness_state_id:d.readinessStateId,should_auto_renew:false,...(d.returnPolicyId?{return_policy_id:d.returnPolicyId}:{}),};
}
export function requestPreview(channel:Channel,item:Item,d:MarketplaceFields){
 return channel==='ebay'?{note:'Preparation only. Upload chosen photos first; replace placeholders with EPS URLs. Offer remains unpublished.',...ebayBodies(item,d,d.photoIds.map((_,i)=>`<uploaded-photo-${i+1}>`))}:{note:'Preparation only. Create an unpublished draft, then upload chosen photos. Shop currency must be verified as USD.',draft:etsyBody(item,d),inventory:etsyInventory(item,d),photoIds:d.photoIds};
}

export function etsyInventory(item:Item,d:MarketplaceFields){return {products:[{sku:item.code,property_values:[],offerings:[{price:d.price,quantity:1,is_enabled:true,readiness_state_id:Number(d.readinessStateId)||null}]}],price_on_property:[],quantity_on_property:[],sku_on_property:[]};}
