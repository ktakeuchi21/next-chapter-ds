import type {Env} from './types';
import {sha256} from './snapshot';
import {ingestOrder} from './orders';
import {orderSnapshot} from '../shared/orders';
import {sellerScope,type OrderReader} from './marketplace-order-readers';
import {ProviderError} from './marketplace-providers';

type Cursor={id:string;watermark:string;window_start:string|null;window_end:string|null;page_offset:number;pass_ids:string;previous_pass_hash:string|null;pass_number:number;state:string;failures:number;retry_at:number;lease_until:number};
const minute=60_000,day=24*60*minute;
// This is not scheduled or exposed as an HTTP route. Enabling a verified seller
// connection, token rotation, monitoring and production smoke tests come first.
export async function syncOrderPage(env:Env,reader:OrderReader,options:{enabled?:boolean;initialSince:string;time?:number}){
 if(options.enabled!==true)return {state:'disabled'};
 const scope=sellerScope.parse(reader.scope),time=options.time??Date.now(),date=new Date(time).toISOString();
 const initial=Date.parse(options.initialSince);if(!Number.isFinite(initial)||initial<946684800000||initial>=time-minute)throw Error('Choose a valid initial order sync date');
 const id=await sha256(JSON.stringify([scope.channel,scope.environment,scope.accountId])),token=crypto.randomUUID();
 await env.DB.prepare('INSERT OR IGNORE INTO marketplace_sync_cursors(id,channel,environment,account_id,watermark,updated_at) VALUES(?,?,?,?,?,?)').bind(id,scope.channel,scope.environment,scope.accountId,new Date(initial).toISOString(),date).run();
 const cursor=(await env.DB.prepare('SELECT * FROM marketplace_sync_cursors WHERE id=?').bind(id).first<Cursor>())!;
 if(cursor.state==='paused'||cursor.state==='reconnect')return {state:cursor.state};
 if(cursor.retry_at>time)return {state:'backoff',retryAt:cursor.retry_at};
 // Overlap each completed range by two minutes so equal timestamps and late
 // provider updates are replayed through the existing idempotent order ledger.
 const start=cursor.window_start??new Date(Math.max(946684800000,Date.parse(cursor.watermark)-2*minute)).toISOString();
 const end=cursor.window_end??new Date(Math.min(time-minute,Date.parse(start)+day)).toISOString();
 if(Date.parse(end)<=Date.parse(cursor.watermark)&&!cursor.window_end)return {state:'idle'};
 const acquired=await env.DB.prepare("UPDATE marketplace_sync_cursors SET state='running',window_start=?,window_end=?,lease_token=?,lease_until=?,updated_at=? WHERE id=? AND lease_until<=? AND state NOT IN ('paused','reconnect') AND retry_at<=? AND watermark=? AND page_offset=?").bind(start,end,token,time+5*minute,date,id,time,time,cursor.watermark,cursor.page_offset).run();
 if(!acquired.meta.changes)return {state:'busy'};
 try {
  const page=await reader.page({start,end,offset:cursor.page_offset,limit:10});
  if(!Array.isArray(page.orders)||page.orders.length>10||page.nextOffset!==null&&(!Number.isInteger(page.nextOffset)||page.nextOffset!==cursor.page_offset+page.orders.length||page.nextOffset<=cursor.page_offset||page.nextOffset>9900))throw Error('Invalid continuation from order provider');
  const orders=page.orders.map(o=>orderSnapshot.parse(o));
  if(orders.some(o=>o.source!=='provider'||o.channel!==scope.channel||o.environment!==scope.environment||o.accountId!==scope.accountId))throw Error('Order identity does not match the connected seller');
  // A failed page can have a committed prefix of orders, but NEVER a committed
  // cursor. Retrying the page safely deduplicates that prefix.
  for(const order of orders){const lease=await env.DB.prepare('SELECT id FROM marketplace_sync_cursors WHERE id=? AND lease_token=?').bind(id,token).first();if(!lease)throw Error('Sync lease changed');await ingestOrder(env,order);}
  const seen:string[]=JSON.parse(cursor.pass_ids),all=[...seen,...orders.map(o=>o.externalId)];
  if(all.length>10000||new Set(all).size!==all.length)throw Error('Repeated order identity or excessive page population');
  const endOfPass=page.nextOffset===null,digest=endOfPass?await sha256(JSON.stringify(all)):null;
  // Offset pagination is not a snapshot. Records can leave the range when they
  // change, shifting later offsets. Read the entire fixed window again and only
  // advance after two consecutive passes contain the same ordered identities.
  const completed=endOfPass&&cursor.previous_pass_hash===digest;
  const unstable=endOfPass&&!completed&&cursor.pass_number>=2;
  const saved=await env.DB.prepare("UPDATE marketplace_sync_cursors SET state=?,watermark=?,window_start=?,window_end=?,page_offset=?,pass_ids=?,previous_pass_hash=?,pass_number=?,failures=0,retry_at=0,lease_token=NULL,lease_until=0,message=?,updated_at=? WHERE id=? AND lease_token=?").bind(unstable?'paused':'idle',completed?end:cursor.watermark,completed?null:start,completed?null:end,page.nextOffset??0,JSON.stringify(endOfPass?[]:all),completed?null:digest??cursor.previous_pass_hash,completed?0:endOfPass?cursor.pass_number+1:cursor.pass_number,unstable?'The marketplace order pages kept changing. Review and reconcile this window before resuming.':null,date,id,token).run();
  if(!saved.meta.changes)throw Error('Sync lease changed before checkpoint');
  return {state:unstable?'paused':completed?'complete':endOfPass?'verifying':'more',count:orders.length,watermark:completed?end:cursor.watermark};
 }catch(error){
  const reconnect=error instanceof ProviderError&&error.action==='reconnect';
  const retry=Math.min(day,Math.max(error instanceof ProviderError?(error.retryAfterSeconds??0)*1000:0,minute*2**Math.min(cursor.failures,8)));
  await env.DB.prepare('UPDATE marketplace_sync_cursors SET state=?,failures=failures+1,retry_at=?,lease_token=NULL,lease_until=0,message=?,updated_at=? WHERE id=? AND lease_token=?').bind(reconnect?'reconnect':'backoff',time+retry,reconnect?'Reconnect the seller account before syncing orders.':'Order sync paused after an incomplete page. The saved cursor has not advanced.',date,id,token).run();
  return {state:reconnect?'reconnect':'backoff',retryAt:time+retry};
 }
}
