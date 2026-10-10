import {z} from 'zod';
import {orderSnapshot,type OrderSnapshot} from '../shared/orders';
import {providerRequest} from './marketplace-providers';

const id=z.union([z.string().trim().min(1).max(160),z.number().int().positive().refine(Number.isSafeInteger)]).transform(String);
const money=z.object({amount:z.number().int().min(0).refine(Number.isSafeInteger),divisor:z.number().int().positive(),currency_code:z.literal('USD')});
const decimal=z.object({value:z.string().regex(/^\d+(?:\.\d{1,2})?$/),currency:z.literal('USD')});
const cents=(s:string)=>{const [whole,fraction='']=s.split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(n))throw Error('Unsupported monetary amount');return n;};
const etsyCents=(m:z.infer<typeof money>)=>{const n=m.amount*100/m.divisor;if(!Number.isSafeInteger(n))throw Error('Unsupported monetary precision');return n;};
export const sellerScope=z.object({channel:z.enum(['etsy','ebay']),environment:z.enum(['production','sandbox']),accountId:z.string().min(1).max(160),sellerUserId:z.string().min(1).max(160).optional()});
export type SellerScope=z.infer<typeof sellerScope>;
export type OrderWindow={start:string;end:string;offset:number;limit:number};
export interface OrderReader {scope:SellerScope;page(window:OrderWindow):Promise<{orders:OrderSnapshot[];nextOffset:number|null}>;}
const receipt=z.object({receipt_id:id,seller_user_id:id,status:z.string(),is_paid:z.boolean(),is_shipped:z.boolean(),updated_timestamp:z.number().int().positive().optional(),update_timestamp:z.number().int().positive().optional(),grandtotal:money,refunds:z.array(z.unknown()).default([]),shipments:z.array(z.unknown()).default([]),transactions:z.array(z.object({transaction_id:id,listing_id:id.nullable().optional(),sku:z.string().nullable().optional(),title:z.string().nullable().optional(),is_digital:z.boolean().optional(),quantity:z.number().int().min(0),price:money,shipped_timestamp:z.number().nullable().optional()})).max(50)});
export function normalizeEtsyOrder(input:unknown,scope:SellerScope):OrderSnapshot {
 sellerScope.parse(scope);if(scope.channel!=='etsy'||scope.environment!=='production'||!scope.sellerUserId)throw Error('Verified Etsy shop and seller identity are required');
 const r=receipt.parse(input);if(r.seller_user_id!==scope.sellerUserId)throw Error('Receipt belongs to another seller');
 const timestamp=r.updated_timestamp??r.update_timestamp;if(!timestamp)throw Error('Missing receipt update time');
 if(r.updated_timestamp&&r.update_timestamp&&r.updated_timestamp!==r.update_timestamp)throw Error('Conflicting receipt update times');
 const status=r.status.toLowerCase(),cancelled=['canceled','cancelled'].includes(status);
 // A partial refund or unknown status must never be mistaken for paid inventory.
 const payment=status==='fully refunded'?'refunded':r.refunds.length||r.transactions.some(t=>t.is_digital)?'unknown':r.is_paid&&['paid','completed'].includes(status)?'paid':!r.is_paid&&['open','payment processing','unpaid'].includes(status)?'unpaid':'unknown';
 return orderSnapshot.parse({channel:'etsy',environment:'production',accountId:scope.accountId,externalId:r.receipt_id,source:'provider',updatedAt:new Date(timestamp*1000).toISOString(),cancelled,payment,fulfillment:r.is_shipped?'fulfilled':r.shipments.length||r.transactions.some(t=>t.shipped_timestamp)?'partial':'unfulfilled',currency:'USD',totalMinor:etsyCents(r.grandtotal),lines:r.transactions.map(t=>({externalId:t.transaction_id,listingId:t.listing_id??'',sku:t.sku??'',title:t.title??`Transaction ${t.transaction_id}`,quantity:t.quantity,amountMinor:etsyCents(t.price)*t.quantity}))});
}
const ebayOrder=z.object({orderId:id,sellerId:id,lastModifiedDate:z.string().datetime({offset:true}),orderPaymentStatus:z.string(),orderFulfillmentStatus:z.string(),cancelStatus:z.object({cancelState:z.string(),cancelRequests:z.array(z.unknown()).default([])}),pricingSummary:z.object({total:decimal}),paymentSummary:z.object({refunds:z.array(z.unknown()).default([])}).optional(),lineItems:z.array(z.object({lineItemId:id,legacyItemId:id,sku:z.string().optional(),title:z.string(),quantity:z.number().int().min(0),total:decimal,refunds:z.array(z.unknown()).default([])})).max(50)});
export function normalizeEbayOrder(input:unknown,scope:SellerScope):OrderSnapshot {
 sellerScope.parse(scope);if(scope.channel!=='ebay')throw Error('Expected an eBay account');
 const o=ebayOrder.parse(input);if(o.sellerId!==scope.accountId)throw Error('Order belongs to another seller');
 const cancelled=o.cancelStatus.cancelState==='CANCELED'||o.cancelStatus.cancelState==='CANCELLED';
 const cancellationUnclear=o.cancelStatus.cancelState!=='NONE_REQUESTED'||o.cancelStatus.cancelRequests.length>0;
 const hasRefund=!!o.paymentSummary?.refunds.length||o.lineItems.some(l=>l.refunds.length);
 const payment=o.orderPaymentStatus==='FULLY_REFUNDED'?'refunded':cancellationUnclear||hasRefund?'unknown':o.orderPaymentStatus==='PAID'?'paid':['PENDING','FAILED'].includes(o.orderPaymentStatus)?'unpaid':'unknown';
 const fulfillment=({NOT_STARTED:'unfulfilled',IN_PROGRESS:'partial',FULFILLED:'fulfilled'} as const)[o.orderFulfillmentStatus as 'NOT_STARTED']??'unknown';
 return orderSnapshot.parse({channel:'ebay',environment:scope.environment,accountId:scope.accountId,externalId:o.orderId,source:'provider',updatedAt:o.lastModifiedDate,cancelled,payment,fulfillment,currency:'USD',totalMinor:cents(o.pricingSummary.total.value),lines:o.lineItems.map(l=>({externalId:l.lineItemId,listingId:l.legacyItemId,sku:l.sku??'',title:l.title,quantity:l.quantity,amountMinor:cents(l.total.value)}))});
}
function windowParams(w:OrderWindow){if(!Number.isInteger(w.offset)||w.offset<0||w.offset>9900||!Number.isInteger(w.limit)||w.limit<1||w.limit>10||!Number.isFinite(Date.parse(w.start))||!Number.isFinite(Date.parse(w.end))||Date.parse(w.start)>=Date.parse(w.end))throw Error('Invalid order page window');}
function nextOffset(offset:number,length:number,total:number){if(!length&&offset<total)throw Error('Provider returned an incomplete order page');return offset+length<total?offset+length:null;}
// Credentials are supplied by a future server connector; no UI or cron constructs
// these readers today. We construct all URLs, never follow provider next links.
export class EtsyOrderReader implements OrderReader {
 constructor(public readonly scope:SellerScope,private token:string,private key:string,private secret:string,private transport:typeof fetch=fetch){if(scope.channel!=='etsy'||scope.environment!=='production'||!/^\d+$/.test(scope.accountId)||!scope.sellerUserId)throw Error('Verified Etsy shop identity is required');}
 async page(w:OrderWindow){windowParams(w);const q=new URLSearchParams({min_last_modified:String(Math.floor(Date.parse(w.start)/1000)),max_last_modified:String(Math.floor(Date.parse(w.end)/1000)),sort_on:'updated',sort_order:'asc',limit:String(w.limit),offset:String(w.offset)});
  const {data}=await providerRequest(`https://api.etsy.com/v3/application/shops/${encodeURIComponent(this.scope.accountId)}/receipts?${q}`,{headers:{Authorization:`Bearer ${this.token}`,'x-api-key':`${this.key}:${this.secret}`}},this.transport);
  const page=z.object({count:z.number().int().min(0),results:z.array(z.unknown()).max(w.limit)}).parse(data);
  return {orders:page.results.map(r=>normalizeEtsyOrder(r,this.scope)),nextOffset:nextOffset(w.offset,page.results.length,page.count)};
 }
}
export class EbayOrderReader implements OrderReader {
 private base:string;
 constructor(public readonly scope:SellerScope,private token:string,private transport:typeof fetch=fetch){if(scope.channel!=='ebay')throw Error('Expected eBay seller identity');this.base=`https://api${scope.environment==='sandbox'?'.sandbox':''}.ebay.com/sell/fulfillment/v1`;}
 private async get(path:string){return (await providerRequest(this.base+path,{headers:{Authorization:`Bearer ${this.token}`}},this.transport)).data;}
 async page(w:OrderWindow){windowParams(w);const q=new URLSearchParams({filter:`lastmodifieddate:[${w.start}..${w.end}]`,limit:String(w.limit),offset:String(w.offset)});
  const page=z.object({total:z.number().int().min(0),offset:z.number().int().optional(),orders:z.array(z.object({orderId:id})).max(w.limit)}).parse(await this.get('/order?'+q));
  if(page.offset!==undefined&&page.offset!==w.offset)throw Error('Provider returned the wrong page');
  // getOrders may omit cancellation-request details; fetch each authenticated
  // order before payment is used by the local processing foundation.
  const orders:OrderSnapshot[]=[];for(const o of page.orders){const normalized=normalizeEbayOrder(await this.get('/order/'+encodeURIComponent(o.orderId)),this.scope);if(normalized.externalId!==o.orderId)throw Error('Order detail identity changed');orders.push(normalized);}
  return {orders,nextOffset:nextOffset(w.offset,page.orders.length,page.total)};
 }
}
