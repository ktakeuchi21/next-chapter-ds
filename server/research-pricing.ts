import {z} from 'zod';
import type {Confidence,PricingRecommendation} from '../shared/pricing';

export const pricingEvidence=z.object({currency:z.string(),low:z.number(),high:z.number(),suggested:z.number(),quickSale:z.number(),confidence:z.enum(['low','medium','high']),basis:z.enum(['matching_sales','similar_sales','asking_prices','retail_reference','category_estimate']),reason:z.string(),assumptions:z.array(z.string()),sourceUrls:z.array(z.string()),channel:z.enum(['local_pickup','online_shipping','either'])});
type Comparison={url:string;kind:string;amount:number|null;currency:string;match:string};
const confidenceOrder:Confidence[]=['low','medium','high'];
export function validatePricing(raw:z.infer<typeof pricingEvidence>|null|undefined,comps:Comparison[],identityConfidence:Confidence='low'):PricingRecommendation|null {
 if(!raw)return null;
 const {low,high,suggested,quickSale}=raw;
 if(raw.currency!=='USD'||![low,high,suggested,quickSale].every(n=>Number.isFinite(n)&&n>0&&n<=1000000)||low>quickSale||quickSale>suggested||suggested>high||!raw.reason.trim())return null;
 const urls=[...new Set(raw.sourceUrls)];
 const references=comps.filter(c=>urls.includes(c.url)&&c.currency==='USD'&&c.amount!==null&&c.amount>0&&['same_model','similar'].includes(c.match));
 let basis=raw.basis,ceiling:Confidence='low';
 if(basis==='category_estimate'){
  // This is an explicitly unsourced judgment, never a claim about actual sales.
  return {...raw,currency:'USD',confidence:'low',sourceUrls:[],assumptions:raw.assumptions.slice(0,8)};
 }
 const sold=references.filter(c=>c.kind==='reported_sold');
 if(sold.filter(c=>c.match==='same_model').length>=2){basis='matching_sales';ceiling='high';}
 else if(sold.length){basis='similar_sales';ceiling='medium';}
 else if(references.some(c=>c.kind==='asking')){basis='asking_prices';ceiling=references.filter(c=>c.kind==='asking').length>=2?'medium':'low';}
 else if(references.some(c=>c.kind==='retail')){basis='retail_reference';}
 else return null; // Fabricated URLs, auctions without sale proof, mismatches and other currencies cannot support a sourced recommendation.
 const usable=references.filter(c=>['reported_sold','asking','retail'].includes(c.kind));
 // Identity uncertainty and unconfirmed condition assumptions also limit confidence.
 if(raw.assumptions.length&&ceiling==='high')ceiling='medium';
 const confidence=confidenceOrder[Math.min(confidenceOrder.indexOf(raw.confidence),confidenceOrder.indexOf(ceiling),confidenceOrder.indexOf(identityConfidence))];
 return {...raw,currency:'USD',basis,confidence,sourceUrls:usable.map(c=>c.url),assumptions:raw.assumptions.slice(0,8)};
}
