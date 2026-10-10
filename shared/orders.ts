import {z} from 'zod';
const identifier=z.string().trim().min(1).max(160);
// Connectors must fetch an authenticated provider order before calling ingestOrder.
// No unsigned webhook or browser payload is accepted as evidence of payment.
export const orderSnapshot=z.object({
 channel:z.enum(['etsy','ebay']),environment:z.enum(['production','sandbox']),
 accountId:identifier,externalId:identifier,source:z.enum(['provider','fixture']),
 updatedAt:z.string().datetime({offset:true}).transform(s=>new Date(s).toISOString()),
 payment:z.enum(['unpaid','partial','paid','refunded','unknown']),
 fulfillment:z.enum(['unfulfilled','partial','fulfilled','unknown']).default('unknown'),
 cancelled:z.boolean(),currency:z.string().regex(/^[A-Z]{3}$/),
 totalMinor:z.number().int().min(0).max(100_000_000),
 lines:z.array(z.object({externalId:identifier,listingId:z.string().max(160).default(''),sku:z.string().max(160).default(''),title:z.string().max(300),quantity:z.number().int().min(0).max(1000),amountMinor:z.number().int().min(0).max(100_000_000)})).max(50)
}).superRefine((o,c)=>{if(new Set(o.lines.map(l=>l.externalId)).size!==o.lines.length)c.addIssue({code:'custom',message:'Duplicate order line identifiers'});});
export type OrderSnapshot=z.infer<typeof orderSnapshot>;
export type OrderView={id:string;channel:string;environment:string;external_id:string;source:string;state:string;version:number;accepted_at:string|null;data:OrderSnapshot;lines:{id:string;title:string;sku:string;quantity:number;amount_minor:number;item_id:string|null}[];tasks:{id:string;kind:string;state:string;message:string;item_id:string|null}[]};
