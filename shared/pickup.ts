import {z} from 'zod';
import {readiness,type Item,type Media,type Listing} from './domain';

export const pickupFormSchema=z.object({
 title:z.string().trim().max(160).default(''),description:z.string().trim().max(10000).default(''),
 photoIds:z.array(z.string().uuid()).max(20).default([]),preparedFrom:z.string().max(20000).default(''),
 buyer:z.string().trim().max(160).default(''),scheduledAt:z.string().datetime({offset:true}).or(z.literal('')).default(''),
 agreedPrice:z.number().min(0).max(1000000).nullable().default(null),
 instructions:z.string().max(3000).default(''),
});
export type PickupForm=z.infer<typeof pickupFormSchema>;
export type Pickup=PickupForm&{collectedAt?:string;paymentConfirmed?:boolean;noShows?:number};
export const pickupInput=z.object({version:z.number().int().positive(),action:z.enum(['save','listed','arrange','no_show','collect','complete']),form:pickupFormSchema.optional(),url:z.string().max(2000).optional(),confirmed:z.boolean().optional(),paymentConfirmed:z.boolean().optional()});
export type PickupInput=z.infer<typeof pickupInput>;
export function facebookItemUrl(value:string){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com'].includes(u.hostname))return null;const m=u.pathname.match(/^\/marketplace\/item\/(\d+)\/?$/);return m?`https://www.facebook.com/marketplace/item/${m[1]}/`:null;}catch{return null;}}
// Deliberate allowlist: no owner, exact storage location, estimates, research or buyer information.
export function pickupSource(item:Item){return JSON.stringify([item.title,item.condition,item.measurements,item.price,item.pickupArea||'',item.loadingNotes||'',item.clearBy||'',item.draftTitle||'',item.draftDescription||'']);}
export function preparePickup(item:Item,media:Media[]):PickupForm{return {...pickupFormSchema.parse(item.pickup||{}),title:item.draftTitle||item.title,description:[item.draftDescription||[item.title,item.condition&&`Condition: ${item.condition}`,item.measurements&&`Measurements: ${item.measurements}`].filter(Boolean).join('\n\n'),item.pickupArea&&`Local pickup: ${item.pickupArea}`,item.loadingNotes&&`Collection: ${item.loadingNotes}`,item.clearBy&&`Please collect by: ${item.clearBy}`,'Pickup only. Please agree on a time before coming.'].filter(Boolean).join('\n\n'),photoIds:media.filter(m=>m.kind==='photo').slice(0,10).map(m=>m.id),preparedFrom:pickupSource(item)};}
export function pickupReadiness(item:Item,form:PickupForm,media:Media[]){return [...readiness(item),!item.pickupArea?.trim()&&'Add a general pickup area in Details (not an exact address)',!form.title&&'Prepare a listing title',!form.description&&'Prepare a listing description',!form.photoIds.length&&'Select at least one photo',form.photoIds.some(id=>!media.some(m=>m.id===id&&m.kind==='photo'))&&'Review the selected photos',new Set(form.photoIds).size!==form.photoIds.length&&'Select each photo only once',form.preparedFrom!==pickupSource(item)&&'Prepare or review the draft after the item details changed'].filter(Boolean) as string[];}
export function pickupStage(item:Item){return item.pickup?.collectedAt?(item.status==='fulfilled'?'Completed':'Collected · close listings'):item.status==='reserved'?'Pickup arranged':item.status==='listed'?'Listed':'Prepare listing';}
export function pickupReminder(item:Item,now=Date.now()){
 if(!item.pickup||item.fulfillment!=='pickup'||['archived','fulfilled'].includes(item.status))return '';
 if(item.pickup.collectedAt)return 'Collected. Confirm all marketplace listings ended, then complete the sale.';
 if(item.status==='reserved'&&item.pickup.scheduledAt){const time=new Date(item.pickup.scheduledAt);return `${time.getTime()<now?'Pickup time passed — confirm collection or record a no-show':'Pickup arranged'}: ${time.toLocaleString()}. Find it: ${item.location||'location needed'}.`;}
 return item.status==='listed'?'Waiting for a buyer. Record an agreed pickup time when arranged.':'Prepare and review the Facebook pickup listing.';
}
export function routeSuggestion(item:Item){
 if(item.fulfillment==='pickup')return 'Local pickup selected. Facebook is a useful starting point; keep this item on one marketplace if that is enough.';
 if(item.fulfillment==='shipping')return 'Shipping selected. Prepare an eBay draft; consider Etsy only if the item is eligible.';
 if(/\b(dresser|chest|sofa|couch|wardrobe|television|TV|bookcase|dining table|bed frame)\b/i.test(item.title))return 'Consider local pickup for this item. Confirm its size, packing effort and value before choosing.';
 return 'Choose based on packing effort, fragility and expected proceeds. Small items can still be better for local pickup; low-value items may suit a bundle.';
}
export function pickupReply(item:Item,kind:'availability'|'measurements'|'pickup'){
 const p=item.pickup;
 if(kind==='availability')return item.status==='listed'?`Yes, ${item.title} is still available.${item.price!==null?` The asking price is $${item.price}.`:''}${item.pickupArea?` Pickup is in ${item.pickupArea}.`:''} What pickup time works for you?`:item.status==='reserved'?'A pickup is currently arranged. I can let you know if it becomes available again.':'Please check availability before replying.';
 if(kind==='measurements')return item.measurements?`Measurements: ${item.measurements}`:'I will check the measurements and get back to you.';
 return [`Pickup for ${item.title}.`,p?.scheduledAt&&`Agreed time: ${new Date(p.scheduledAt).toLocaleString()}.`,item.loadingNotes,p?.instructions,'Please message before arriving.'].filter(Boolean).join('\n\n');
}
export function activeFacebook(listings:Listing[]){return listings.find(l=>l.channel==='Facebook Marketplace'&&l.state==='active');}
