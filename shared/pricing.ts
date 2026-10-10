export type Confidence='low'|'medium'|'high';
export type PriceBasis='matching_sales'|'similar_sales'|'asking_prices'|'retail_reference'|'category_estimate';
export interface PricingRecommendation {
 currency:'USD';low:number;high:number;suggested:number;quickSale:number;
 confidence:Confidence;basis:PriceBasis;reason:string;assumptions:string[];sourceUrls:string[];
 channel:'local_pickup'|'online_shipping'|'either';
}
export const priceBasisLabels:Record<PriceBasis,string>={
 matching_sales:'Matching sold items',similar_sales:'Sold-item comparisons',asking_prices:'Asking prices · not completed sales',
 retail_reference:'Retail reference · adjusted for resale',category_estimate:'Broad AI estimate · no usable price comparisons'
};
export const priceChannelLabels={local_pickup:'Local pickup',online_shipping:'Online sale · shipping extra',either:'Pickup or online sale'};
export const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
