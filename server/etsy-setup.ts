import {Hono} from 'hono';
import type {Env} from './types';
import type {EtsySetup,EtsyOption} from '../shared/etsy';
import {EtsyProvider,ProviderError} from './marketplace-providers';
import {getMarketplaceToken} from './marketplace-tokens';
import {oauthConfig} from './marketplace-oauth';

export function numericId(value:unknown):string|null {
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0)return String(value);
 if(typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value)&&Number.isSafeInteger(Number(value)))return value;
 return null;
}
export async function etsyProvider(env:Env){
 const config=oauthConfig(env,'etsy');if(!config)throw Error('Etsy is not configured.');
 return new EtsyProvider(await getMarketplaceToken(env,'etsy'),config.clientId,config.clientSecret);
}
export const results=(value:any):any[]=>{if(!Array.isArray(value?.results))throw Error('Etsy returned an unexpected response.');return value.results;};
export async function loadEtsySetup(provider:EtsyProvider):Promise<EtsySetup>{
 const me:any=(await provider.me()).data;
 if(!numericId(me?.user_id))throw Error('Could not verify the connected Etsy account.');
 const id=numericId(me.shop_id);
 if(!id)return {status:'no_shop',shop:null,shipping:[],processing:[],returns:[],issues:['Finish seller-shop setup on Etsy, then check again. Account linking is already complete.']};
 const shop:any=(await provider.shop(id)).data;
 if(numericId(shop?.shop_id)!==id||numericId(shop?.user_id)!==numericId(me.user_id))throw Error('Etsy shop ownership could not be verified.');
 const [shippingResponse,returnResponse]=await Promise.all([provider.shippingProfiles(id),provider.returnPolicies(id)]);
 const processingRows:any[]=[];
 for(let offset=0;offset<1000;offset+=100){const page:any=(await provider.processingProfiles(id,offset)).data;const rows=results(page);processingRows.push(...rows);if(rows.length<100||processingRows.length>=page.count)break;if(offset===900)throw Error('Too many processing profiles. Review setup in Etsy.');}
 const shipping=results(shippingResponse.data).filter(p=>!p.is_deleted&&p.profile_type==='manual').flatMap(p=>{const id=numericId(p.shipping_profile_id);return id?[{id,label:p.title||`Shipping profile ${id}`}]:[];});
 const processing=processingRows.filter(p=>p.readiness_state==='ready_to_ship').flatMap(p=>{const id=numericId(p.readiness_state_id);return id?[{id,label:`Ready to ship · ${p.processing_days_display_label||`${p.min_processing_days}–${p.max_processing_days} days`}`}]:[];});
 const returns=results(returnResponse.data).flatMap(p=>{const id=numericId(p.return_policy_id);return id?[{id,label:`${p.accepts_returns?'Returns accepted':'No returns'} · ${p.accepts_exchanges?'exchanges accepted':'no exchanges'}${p.return_deadline?` · ${p.return_deadline} days`:''}`}]:[];});
 const issues:string[]=[];
 if(shop.currency_code!=='USD')issues.push('This connector currently requires a USD shop.');
 if(shop.is_etsy_payments_onboarded!==true)issues.push('Finish Etsy Payments onboarding in your shop.');
 if(!shipping.length)issues.push('Create a fixed-price shipping profile in Etsy. Calculated shipping needs dimensions and is not supported by this first draft test.');
 if(!processing.length)issues.push('Create a ready-to-ship processing profile in Etsy.');
 if(!returns.length)issues.push('Set up a return policy in Etsy, including whether you accept returns.');
 return {status:issues.length?'setup_required':'ready',shop:{id,name:String(shop.shop_name||id),currency:String(shop.currency_code||''),paymentsReady:shop.is_etsy_payments_onboarded===true},shipping,processing,returns,issues};
}
export function flattenTaxonomy(nodes:any[],parents:string[]=[]):EtsyOption[]{return nodes.flatMap(n=>{const path=[...parents,String(n.name)],children=n.children||[];return children.length?flattenTaxonomy(children,path):numericId(n.id)?[{id:String(n.id),label:path.join(' / ')}]:[];});}
export function etsyError(e:unknown){return e instanceof ProviderError?e.message:'Could not check Etsy. Check the connection and try again; if it keeps failing, re-authorize Etsy.';}
export const etsySetup=new Hono<{Bindings:Env}>();
etsySetup.get('/api/marketplaces/etsy/setup',async c=>{try{return c.json(await loadEtsySetup(await etsyProvider(c.env)));}catch(e){return c.json({error:etsyError(e)},502);}});
etsySetup.get('/api/marketplaces/etsy/categories',async c=>{try{return c.json(flattenTaxonomy(results((await (await etsyProvider(c.env)).taxonomy()).data)));}catch(e){return c.json({error:etsyError(e)},502);}});
