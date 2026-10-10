import {z} from 'zod';

export const demoChannels=['eBay','Etsy','Facebook Marketplace'] as const;
const channel=z.enum(demoChannels);
const photo=z.string().refine(s=>/^\/api\/media\/[a-zA-Z0-9-]+\?preview=1$/.test(s),'Invalid sample photo');
const listing=z.object({channel,state:z.enum(['active','failed','sold','removal_needed','removed'])});
const sale=z.object({id:z.string(),channel,state:z.enum(['pending','processed']),deliveries:z.number().int().nonnegative()});
const demoItemSchema=z.object({
 id:z.string().uuid(),code:z.string().regex(/^DEMO-\d+$/),title:z.string().max(160),photo:photo.or(z.literal('')),
 clues:z.array(z.string()),questions:z.array(z.string()),location:z.string().max(200),condition:z.string().max(2000),
 measurements:z.string().max(300),price:z.number().min(0).max(1000000).nullable(),method:z.enum(['shipping','pickup']),
 description:z.string().max(10000),reviewed:z.boolean(),eligibleEtsy:z.boolean(),
 channels:z.array(channel).min(1),stage:z.enum(['review','listed','sold','complete']),listings:z.array(listing),
 event:sale.nullable(),tasks:z.record(z.string(),z.boolean()),arrangement:z.string().max(500),
 history:z.array(z.object({at:z.string(),message:z.string()}))
});
export const demoStoreSchema=z.object({version:z.literal(1),revision:z.number().int().nonnegative(),nextLabel:z.number().int().positive(),items:z.array(demoItemSchema).max(20)});
export type DemoItem=z.infer<typeof demoItemSchema>;
export type DemoStore=z.infer<typeof demoStoreSchema>;
export type Channel=typeof demoChannels[number];
export const DEMO_KEY='next-chapter-sales-demo-v1';
export const emptyDemo=():DemoStore=>({version:1,revision:0,nextLabel:1,items:[]});
export function readDemo(raw:string|null):DemoStore{return raw?demoStoreSchema.parse(JSON.parse(raw)):emptyDemo();}
export function captureDemo(sequence:number,source:{title:string;cover:string|null;observations?:string[];questions?:string[]},id:string,at:string):DemoItem{
 return demoItemSchema.parse({id,code:`DEMO-${String(sequence).padStart(3,'0')}`,title:source.title,photo:source.cover?`/api/media/${source.cover}?preview=1`:'',clues:source.observations||[],questions:source.questions||[],location:'',condition:'',measurements:'',price:null,method:'shipping',description:'',reviewed:false,eligibleEtsy:false,channels:['eBay','Facebook Marketplace'],stage:'review',listings:[],event:null,tasks:{},arrangement:'',history:[{at,message:'Practice copy captured. Original inventory is unchanged.'}]});
}
export function demoMissing(item:DemoItem):string[]{return [!item.photo&&'Choose a sample with a photo.',!item.title.trim()&&'Add a listing title.',!item.location.trim()&&'Add a practice storage location.',!item.condition.trim()&&'Describe the condition.',!item.price&&'Set a practice price above $0.',!item.description.trim()&&'Write the listing description.',!item.reviewed&&'Confirm you reviewed the photos, facts and description.',item.channels.includes('Etsy')&&!item.eligibleEtsy&&'Confirm Etsy eligibility before selecting Etsy.'].filter(Boolean) as string[];}
export function demoTasks(method:DemoItem['method']):{id:string;label:string}[]{return [{id:'found',label:'Find the item using its label and storage location'},{id:'condition',label:'Check the item and photograph its condition'},{id:'paid',label:'Confirm payment in the simulated order'},...(method==='shipping'?[{id:'protect',label:'Protect delicate parts and cushion the item so it cannot move'},{id:'measure',label:'Record packed weight and dimensions in the practice notes'},{id:'label',label:'Rehearse checking the address and attaching a shipping label'},{id:'handoff',label:'Mark the practice parcel handed to the carrier'}]:[{id:'arrange',label:'Agree on the pickup time and meeting place'},{id:'handoff',label:'Mark the practice item handed to the buyer'}])];}
export function fulfillmentMissing(item:DemoItem){return [...demoTasks(item.method).filter(t=>!item.tasks[t.id]).map(t=>t.label),...item.listings.filter(l=>l.state==='removal_needed').map(l=>`Remove the ${l.channel} practice listing`),...(!item.arrangement.trim()?['Add practice packing details or pickup arrangements']:[])];}
export type DemoAction=
 | {type:'edit';patch:Partial<Pick<DemoItem,'title'|'condition'|'location'|'measurements'|'price'|'method'|'description'|'reviewed'|'eligibleEtsy'|'channels'>>}
 | {type:'publish';failChannel?:Channel}
 | {type:'retryListing';channel:Channel}
 | {type:'sale';channel:Channel;eventId:string;fail?:boolean}
 | {type:'retrySale'} | {type:'replaySale'}
 | {type:'remove';channel:Channel;fail?:boolean}
 | {type:'task';id:string;checked:boolean}
 | {type:'arrangement';value:string} | {type:'complete'};
export function stepDemo(current:DemoItem,action:DemoAction,at:string):DemoItem{
 const item=structuredClone(current);
 const log=(message:string)=>{item.history.push({at,message});item.history=item.history.slice(-100);};
 const requireStage=(stage:DemoItem['stage'])=>{if(item.stage!==stage)throw Error(`This action requires the ${stage} step.`);};
 const deliver=()=>{
  const event=item.event;if(!event)throw Error('No sale notification to deliver.');
  event.deliveries++;
  if(event.state==='processed'){log('Repeated sale notification ignored. One sale and one fulfillment checklist remain.');return;}
  requireStage('listed');
  const sold=item.listings.find(l=>l.channel===event.channel);if(sold?.state!=='active')throw Error('This practice listing is not active.');
  event.state='processed';sold.state='sold';item.stage='sold';
  item.listings.forEach(l=>{if(l.state==='active')l.state='removal_needed';});
  log(`Simulated sale received from ${event.channel}. Fulfillment is ready; other active listings need removal.`);
 };
 switch(action.type){
  case 'edit':requireStage('review');Object.assign(item,action.patch);if(Object.keys(action.patch).some(k=>k!=='reviewed'))item.reviewed=false;break;
  case 'publish':requireStage('review');{const missing=demoMissing(item);if(missing.length)throw Error(missing.join(' '));item.listings=item.channels.map(c=>({channel:c,state:c===action.failChannel?'failed':'active'}));item.stage='listed';log(action.failChannel?`Simulated publish: ${action.failChannel} failed. Other selected listings are active. Retry does not create duplicates.`:'Practice listings are active. Nothing was sent to a marketplace.');}break;
  case 'retryListing':requireStage('listed');{const l=item.listings.find(l=>l.channel===action.channel);if(l?.state!=='failed')throw Error('No failed listing to retry.');l.state='active';log(`${action.channel} practice listing retry succeeded.`);}break;
  case 'sale':requireStage('listed');if(item.event)throw Error('A sale notification already exists. Retry that notification.');if(!item.listings.some(l=>l.channel===action.channel&&l.state==='active'))throw Error('Choose an active practice listing.');item.event={id:action.eventId,channel:action.channel,state:'pending',deliveries:0};if(action.fail)log('Simulated connection failure: sale notification is pending. Inventory stays listed until delivery succeeds.');else deliver();break;
  case 'retrySale':if(item.event?.state!=='pending')throw Error('No pending notification to retry.');deliver();break;
  case 'replaySale':if(item.event?.state!=='processed')throw Error('Process a sale before testing a repeated notification.');deliver();break;
  case 'remove':requireStage('sold');{const l=item.listings.find(l=>l.channel===action.channel);if(l?.state!=='removal_needed')throw Error('No listing removal is pending.');if(action.fail)log(`${action.channel} simulated removal failed. It remains outstanding; retry is available.`);else{l.state='removed';log(`${action.channel} practice listing removal confirmed.`);}}break;
  case 'task':requireStage('sold');if(!demoTasks(item.method).some(t=>t.id===action.id))throw Error('Unknown fulfillment step.');item.tasks[action.id]=action.checked;break;
  case 'arrangement':requireStage('sold');item.arrangement=action.value;break;
  case 'complete':requireStage('sold');if(fulfillmentMissing(item).length)throw Error('Finish the checklist, notes and outstanding listing removals first.');item.stage='complete';log('Practice sale completed. The item was located, fulfilled, and all other active listings were removed.');break;
 }
 return demoItemSchema.parse(item);
}
