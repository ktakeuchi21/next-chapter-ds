import {z} from 'zod';
import type {Pickup} from './pickup';
import type {Confidence,PricingRecommendation} from './pricing';
export const statuses=['intake','review','ready','listed','reserved','sold','fulfilled','archived'] as const;
export const statusLabel:Record<string,string>={intake:'New intake',review:'Needs review',ready:'Ready to list',listed:'Listed',reserved:'Reserved',sold:'Sold · to fulfill',fulfilled:'Completed',archived:'Archived'};
export const itemFields=z.object({pickupArea:z.string().trim().max(160).optional(),loadingNotes:z.string().max(2000).optional(),clearBy:z.string().max(300).optional(),title:z.string().trim().max(160).default(''),owner:z.string().trim().max(160).default(''),location:z.string().trim().max(200).default(''),category:z.string().trim().max(80).default('Other'),notes:z.string().max(10000).default(''),condition:z.string().max(2000).default(''),measurements:z.string().max(300).default(''),price:z.number().min(0).max(1000000).nullable().default(null),fulfillment:z.enum(['undecided','pickup','shipping']).default('undecided'),availability:z.enum(['unknown','available','unavailable']).default('unknown'),observations:z.array(z.string().max(1000)).max(30).default([]),questions:z.array(z.string().max(1000)).max(30).default([]),identification:z.string().max(3000).default(''),researchNotes:z.string().max(6000).default(''),valueEstimate:z.string().max(6000).default(''),draftResearchAt:z.string().max(80).default(''),draftTitle:z.string().max(160).default(''),draftDescription:z.string().max(10000).default('')});
export type Fields=z.infer<typeof itemFields>;
export interface Item extends Fields {pickup?:Pickup;id:string;code:string;clientId?:string|null;visitId?:string|null;recordType?:'item'|'batch';sampleId:string|null;status:typeof statuses[number];version:number;createdAt:string;updatedAt:string;cover:string|null;photoCount:number;}
export interface Media {rotation?:number;revision?:number;sortOrder?:number;id:string;itemId:string;kind:'photo'|'audio'|'video';name:string;mime:string;size:number;transcript:string|null;createdAt:string;}
export interface Listing {id:string;itemId:string;channel:string;url:string;state:'active'|'removal_needed'|'removed';updatedAt:string;}
export interface Job {id:string;itemId:string;kind:'research'|'transcribe'|'organize'|'notes';state:'queued'|'running'|'completed'|'failed';error:string|null;result:string|null;createdAt:string;}
export interface Research {text:string;sources:{url:string;title:string}[];researchedAt:string;version?:2;identity?:{name:string;confidence:Confidence;evidence:string;nextPhotos:string[]};pricing?:PricingRecommendation|null;pricingMessage?:string;listing?:{title:string;description:string;checks:string[]};channelSuggestion?:string;inputFacts?:string;comparables?:{title:string;url:string;kind:string;amount:number|null;currency:string;differences:string}[];}
export interface Detail {item:Item;media:Media[];listings:Listing[];jobs:Job[];activity:{id:string;message:string;createdAt:string}[];research:Research|null;}
export function readiness(item:Fields){return [!item.owner&&'Add the owner or estate',!item.location&&'Add a storage location',item.availability!=='available'&&'Confirm this item is available',!item.condition&&'Describe its condition',item.price===null&&'Set an asking price',item.fulfillment==='undecided'&&'Choose pickup or shipping'].filter(Boolean) as string[];}
export function validateTransition(from:string,to:string,fields:Fields,photoCount:number){
 const allowed:Record<string,string[]>={intake:['review','archived'],review:['ready','archived'],ready:['review','listed','archived'],listed:['reserved','sold','archived'],reserved:['listed','sold','archived'],sold:['fulfilled'],fulfilled:[],archived:['review']};
 if(!allowed[from]?.includes(to))return 'This status change is not available.';
 if(to==='ready'){const missing=readiness(fields);if(!photoCount)missing.push('Add at least one photo');if(missing.length)return missing.join('. ')+'.';}
 return null;
}
export function makeDraft(item:Fields){return {title:item.title,description:[item.title,item.condition&&`Condition: ${item.condition}`,item.measurements&&`Measurements: ${item.measurements}`,item.fulfillment==='pickup'?'Local pickup. Pickup details arranged after purchase.':item.fulfillment==='shipping'?'Shipping available. Shipping cost will be confirmed using packed weight and dimensions.':'', 'Please review the photos and ask about any details that matter to you.'].filter(Boolean).join('\n\n')};}
export function safeExternalUrl(url:string){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
export const listingInput=z.object({channel:z.enum(['eBay','Etsy','Facebook Marketplace','Other']),url:z.string().max(2000).refine(safeExternalUrl,'Use an HTTPS listing URL.')});
export function fileKind(mime:string){const base=mime.split(';')[0];if(['image/jpeg','image/png','image/webp'].includes(base))return 'photo';if(['video/mp4','video/webm','video/quicktime'].includes(base))return 'video';if(['audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/ogg'].includes(base))return 'audio';return null;}

// Preserve entries made during the brief two-field release. An explicit blank
// combined estimate means the user cleared it and must not resurrect old values.
export function combinedValueEstimate(data:{valueEstimate?:unknown;sellerValueEstimate?:unknown;clientValueEstimate?:unknown}){
 if(typeof data.valueEstimate==='string')return data.valueEstimate;
 const seller=typeof data.sellerValueEstimate==='string'?data.sellerValueEstimate.trim():'';
 const client=typeof data.clientValueEstimate==='string'?data.clientValueEstimate.trim():'';
 if(seller===client)return seller;
 return [seller&&`Seller: ${seller}`,client&&`Client: ${client}`].filter(Boolean).join('\n');
}
