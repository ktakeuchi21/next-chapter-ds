import {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {orderSnapshot,type OrderSnapshot} from '../shared/orders';
import {now,uuid} from './db';
import {sha256} from './snapshot';
type Row={id:string;state:string;version:number;data:string;fingerprint:string;provider_updated_at:string;accepted_at:string|null};
const key=(o:OrderSnapshot)=>JSON.stringify([o.channel,o.environment,o.accountId,o.externalId]);
const eventState=(o:OrderSnapshot)=>o.cancelled?'cancelled':o.payment==='refunded'?'refunded':o.payment==='paid'?(o.fulfillment==='unfulfilled'?'review':'attention'):'awaiting_payment';
export async function ingestOrder(env:Env,input:unknown){
 const o=orderSnapshot.parse(input);o.lines.sort((a,b)=>a.externalId.localeCompare(b.externalId));
 if(o.source==='fixture'&&env.LOCAL_DEV!=='true')throw Error('Fixture orders are local only');
 const id=await sha256(key(o)),fingerprint=await sha256(JSON.stringify(o)),date=now();
 const existing=await env.DB.prepare('SELECT * FROM marketplace_orders WHERE id=?').bind(id).first<Row>();
 if(existing){
  if(existing.fingerprint===fingerprint)return {id,outcome:'duplicate'};
  if(o.updatedAt<existing.provider_updated_at){await recordEvent(env,id,o,fingerprint,'stale');return {id,outcome:'stale'};}
  if(o.updatedAt===existing.provider_updated_at){
   const conflictToken=uuid();
   await env.DB.batch([
    env.DB.prepare("UPDATE marketplace_orders SET state='attention',process_token=?,version=version+1,updated_at=? WHERE id=? AND version=?").bind(conflictToken,date,id,existing.version),
    env.DB.prepare("INSERT OR IGNORE INTO order_tasks(id,order_id,kind,message,created_at,updated_at) SELECT ?,?,'review','Conflicting marketplace updates have the same timestamp. Re-fetch the order before processing.',?,? WHERE EXISTS(SELECT 1 FROM marketplace_orders WHERE id=? AND process_token=?)").bind(id+'-conflict',id,date,date,id,conflictToken),
    env.DB.prepare("UPDATE order_tasks SET state='held',updated_at=? WHERE order_id=? AND kind='fulfill' AND state='open' AND EXISTS(SELECT 1 FROM marketplace_orders WHERE id=? AND process_token=?)").bind(date,id,id,conflictToken)
   ]);
   await recordEvent(env,id,o,fingerprint,'conflict');return {id,outcome:'conflict'};
  }
 }
 const previous=existing?JSON.parse(existing.data) as OrderSnapshot:null;
 const changedLines=previous&&JSON.stringify(previous.lines)!==JSON.stringify(o.lines);
 const needsAttention=!!existing?.accepted_at&&(existing.state==='attention'||o.fulfillment!=='unfulfilled'||o.cancelled||o.payment!=='paid'||changedLines||previous?.currency!==o.currency||previous?.totalMinor!==o.totalMinor);
 const state=needsAttention?'attention':existing?.accepted_at?'accepted':eventState(o);
 const statements:D1PreparedStatement[]=[],ingestToken=uuid();
 if(existing)statements.push(env.DB.prepare('UPDATE marketplace_orders SET data=?,fingerprint=?,provider_updated_at=?,state=?,version=version+1,process_token=?,updated_at=? WHERE id=? AND version=?').bind(JSON.stringify(o),fingerprint,o.updatedAt,state,ingestToken,date,id,existing.version));
 else statements.push(env.DB.prepare('INSERT OR IGNORE INTO marketplace_orders(id,channel,environment,account_id,external_id,source,provider_updated_at,fingerprint,data,state,process_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,o.channel,o.environment,o.accountId,o.externalId,o.source,o.updatedAt,fingerprint,JSON.stringify(o),state,ingestToken,date,date));
 // All following writes are gated on this exact snapshot winning the version race.
 const guard='EXISTS(SELECT 1 FROM marketplace_orders WHERE id=? AND process_token=?)';
 if(!existing?.accepted_at){
  statements.push(env.DB.prepare(`DELETE FROM order_lines WHERE order_id=? AND ${guard} AND external_id NOT IN (SELECT json_extract(value,'$.externalId') FROM json_each(?))`).bind(id,id,ingestToken,JSON.stringify(o.lines)));
  for(const line of o.lines)statements.push(env.DB.prepare(`INSERT INTO order_lines(id,order_id,external_id,listing_id,sku,title,quantity,amount_minor)
   SELECT ?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(order_id,external_id) DO UPDATE SET
   item_id=CASE WHEN order_lines.listing_id=excluded.listing_id AND order_lines.sku=excluded.sku AND order_lines.quantity=excluded.quantity AND order_lines.amount_minor=excluded.amount_minor THEN order_lines.item_id ELSE NULL END,
   listing_id=excluded.listing_id,sku=excluded.sku,title=excluded.title,quantity=excluded.quantity,amount_minor=excluded.amount_minor`).bind(await sha256(id+':'+line.externalId),id,line.externalId,line.listingId,line.sku,line.title,line.quantity,line.amountMinor,id,ingestToken));
 }
 if(needsAttention){
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO order_tasks(id,order_id,kind,message,created_at,updated_at) SELECT ?,?,'review','An accepted order changed payment, cancellation, fulfillment or item details. Check the marketplace; do not ship or restock automatically.',?,? WHERE ${guard}`).bind(id+'-changed',id,date,date,id,ingestToken));
  statements.push(env.DB.prepare(`UPDATE order_tasks SET state='held',updated_at=? WHERE order_id=? AND kind='fulfill' AND state='open' AND ${guard}`).bind(date,id,id,ingestToken));
 }
 statements.push(env.DB.prepare(`INSERT OR IGNORE INTO order_events(id,order_id,provider_updated_at,fingerprint,outcome,created_at) SELECT ?,?,?,?,'received',? WHERE ${guard}`).bind(uuid(),id,o.updatedAt,fingerprint,date,id,ingestToken));
 const result=await env.DB.batch(statements);
 if(!result[0].meta.changes)throw Error('Order changed concurrently; re-fetch and retry ingestion');
 return {id,outcome:state};
}
async function recordEvent(env:Env,id:string,o:OrderSnapshot,fingerprint:string,outcome:string){await env.DB.prepare('INSERT OR IGNORE INTO order_events(id,order_id,provider_updated_at,fingerprint,outcome,created_at) VALUES(?,?,?,?,?,?)').bind(uuid(),id,o.updatedAt,fingerprint,outcome,now()).run();}
export async function acceptOrder(env:Env,id:string,version:number){
 const row=await env.DB.prepare('SELECT * FROM marketplace_orders WHERE id=?').bind(id).first<Row>();if(!row)throw Error('Order not found.');
 if(row.version!==version)throw Error('This order changed. Refresh and review it again.');
 const order=orderSnapshot.parse(JSON.parse(row.data));
 if(row.accepted_at)return {alreadyAccepted:true};
 if(row.state!=='review'||order.cancelled||order.payment!=='paid')throw Error('Only a confirmed paid order can be accepted.');
 if(order.fulfillment!=='unfulfilled')throw Error('The marketplace must confirm this order has not already been fulfilled.');
 if(order.environment==='sandbox')throw Error('Sandbox orders never change real inventory.');
 if(order.source==='fixture'&&env.LOCAL_DEV!=='true')throw Error('Test orders cannot change production inventory.');
 if(order.currency!=='USD')throw Error('Review currency support before accepting this order.');
 const lines=(await env.DB.prepare('SELECT * FROM order_lines WHERE order_id=? ORDER BY id').bind(id).all<any>()).results;
 if(!lines.length||lines.some(l=>!l.item_id||l.quantity!==1)||new Set(lines.map(l=>l.item_id)).size!==lines.length)throw Error('Match each quantity-one order line to a different inventory item first.');
 const items=[];for(const line of lines){const item=await env.DB.prepare('SELECT id,version,status,data FROM items WHERE id=? AND record_type=\'item\'').bind(line.item_id).first<any>();
  if(!item||!['ready','listed'].includes(item.status)||JSON.parse(item.data).availability!=='available'||JSON.parse(item.data).pickup)throw Error('One matched item is unavailable or has a pickup in progress. Review the match before accepting.');items.push(item);
 }
 const date=now(),token=uuid();
 const itemChecks=items.map(()=>`EXISTS(SELECT 1 FROM items WHERE id=? AND version=? AND status IN ('ready','listed') AND json_extract(data,'$.availability')='available')`).join(' AND ');
 const statements=[env.DB.prepare(`UPDATE marketplace_orders SET state='accepted',accepted_at=?,process_token=?,version=version+1,updated_at=? WHERE id=? AND version=? AND accepted_at IS NULL AND state='review' AND ${itemChecks}
 AND NOT EXISTS(SELECT 1 FROM order_allocations WHERE item_id IN (SELECT item_id FROM order_lines WHERE order_id=?))`).bind(date,token,date,id,version,...items.flatMap(i=>[i.id,i.version]),id)];
 const guard='EXISTS(SELECT 1 FROM marketplace_orders WHERE id=? AND process_token=?)';
 for(const line of lines){
  statements.push(env.DB.prepare(`INSERT INTO order_allocations(id,order_id,line_id,item_id,created_at) SELECT ?,?,?,?,? WHERE ${guard}`).bind(uuid(),id,line.id,line.item_id,date,id,token));
  statements.push(env.DB.prepare(`UPDATE items SET status='sold',version=version+1,updated_at=? WHERE id=? AND ${guard}`).bind(date,line.item_id,id,token));
  statements.push(env.DB.prepare(`INSERT INTO activity(id,item_id,message,created_at) SELECT ?,?,?,? WHERE ${guard}`).bind(uuid(),line.item_id,`Paid ${order.channel} order reviewed and accepted. Fulfillment and listing removals need attention.`,date,id,token));
  statements.push(env.DB.prepare(`INSERT INTO order_tasks(id,order_id,item_id,kind,message,created_at,updated_at) SELECT ?,?,?,'fulfill','Retrieve this item and arrange shipping or pickup. Confirm the delivery details in the marketplace.',?,? WHERE ${guard}`).bind(uuid(),id,line.item_id,date,date,id,token));
  statements.push(env.DB.prepare(`INSERT INTO order_tasks(id,order_id,item_id,listing_id,kind,message,created_at,updated_at)
   SELECT ?||listings.id,?,item_id,listings.id,'remove_listing','Check this listing and confirm that it is no longer available to buyers.',?,? FROM listings WHERE item_id=? AND state!='removed' AND ${guard}`).bind(id+'-',id,date,date,line.item_id,id,token));
 }
 const results=await env.DB.batch(statements);if(!results[0].meta.changes)throw Error('The order or inventory changed, or another order already owns an item. Refresh before trying again.');return {accepted:true};
}
export const orderRoutes=new Hono<{Bindings:Env}>();
orderRoutes.get('/api/orders',async c=>{
 const [orders,lines,tasks]=await c.env.DB.batch<any>([
  c.env.DB.prepare('SELECT * FROM marketplace_orders ORDER BY updated_at DESC LIMIT 100'),
  c.env.DB.prepare('SELECT * FROM order_lines WHERE order_id IN (SELECT id FROM marketplace_orders ORDER BY updated_at DESC LIMIT 100)'),
  c.env.DB.prepare('SELECT * FROM order_tasks WHERE order_id IN (SELECT id FROM marketplace_orders ORDER BY updated_at DESC LIMIT 100) ORDER BY created_at')
 ]);
 const results=orders.results.map(order=>({...order,data:JSON.parse(order.data),lines:lines.results.filter(l=>l.order_id===order.id),tasks:tasks.results.filter(t=>t.order_id===order.id)}));
 return c.json({liveSyncEnabled:false,orders:results});
});
orderRoutes.post('/api/orders/:id/match',async c=>{
 const id=c.req.param('id'),input=z.object({version:z.number().int(),lineId:z.string(),itemId:z.string().uuid()}).parse(await c.req.json());
 const date=now(),token=uuid();
 const results=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE marketplace_orders SET version=version+1,process_token=?,updated_at=? WHERE id=? AND version=? AND accepted_at IS NULL
   AND EXISTS(SELECT 1 FROM order_lines WHERE id=? AND order_id=?) AND EXISTS(SELECT 1 FROM items WHERE id=? AND record_type='item')`).bind(token,date,id,input.version,input.lineId,id,input.itemId),
  c.env.DB.prepare('UPDATE order_lines SET item_id=? WHERE id=? AND order_id=? AND EXISTS(SELECT 1 FROM marketplace_orders WHERE id=? AND process_token=?)').bind(input.itemId,input.lineId,id,id,token)
 ]);if(!results[0].meta.changes)return c.json({error:'Order changed or match not found. Refresh and try again.'},409);return c.json({ok:true});
});
orderRoutes.post('/api/orders/:id/accept',async c=>{const {version}=z.object({version:z.number().int()}).parse(await c.req.json());try{return c.json(await acceptOrder(c.env,c.req.param('id'),version));}catch(e){return c.json({error:(e as Error).message},409);}});
// There is intentionally no public ingestion/webhook endpoint. Future connectors
// call ingestOrder only after authenticating and fetching the provider snapshot.
export async function reconcileOrderTasks(env:Env){
 await env.DB.batch([
  env.DB.prepare("UPDATE order_tasks SET state='done',updated_at=? WHERE kind='remove_listing' AND state='open' AND EXISTS(SELECT 1 FROM listings WHERE listings.id=order_tasks.listing_id AND listings.state='removed')").bind(now()),
  env.DB.prepare("UPDATE order_tasks SET state='done',updated_at=? WHERE kind='fulfill' AND state='open' AND EXISTS(SELECT 1 FROM items WHERE items.id=order_tasks.item_id AND items.status='fulfilled')").bind(now())
 ]);
}
