import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './operations-fixture';
import {requestBackup,advanceBackup} from '../server/backups';
import {ingestOrder,acceptOrder} from '../server/orders';
const f=fixture(),item=f.item(),media=crypto.randomUUID(),key=`items/${item}/${media}`,date=new Date().toISOString();
f.db.prepare('INSERT INTO media(id,item_id,kind,name,mime,size,object_key,created_at) VALUES(?,?,?,?,?,?,?,?)').run(media,item,'photo','test.jpg','image/jpeg',3,key,date);await f.env.MEDIA.put(key,new Uint8Array([1,2,3]));
const edited=key+'/edits/'+crypto.randomUUID();await f.env.MEDIA.put(edited,new Uint8Array([4,5,6,7]));await f.env.MEDIA.put(edited+'/preview',new Uint8Array([8,9]));
f.db.prepare('UPDATE media SET rotation=90,sort_order=4,revision=2,edited_key=?,edited_preview_key=?,edited_mime=?,edited_size=4 WHERE id=?').run(edited,edited+'/preview','image/png',media);
f.db.prepare('INSERT INTO jobs(id,item_id,kind,state,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('interrupted',item,'research','running',date,date);
const {id}=await ingestOrder(f.env,{channel:'etsy',environment:'production',accountId:'fixture',externalId:'fixture',source:'fixture',updatedAt:date,payment:'paid',fulfillment:'unfulfilled',cancelled:false,currency:'USD',totalMinor:2000,lines:[{externalId:'line-1',listingId:'remote-1',sku:'code',title:'Test order',quantity:1,amountMinor:2000}]});
f.db.prepare('UPDATE order_lines SET item_id=? WHERE order_id=?').run(item,id);await acceptOrder(f.env,id,1);
f.db.prepare("INSERT INTO marketplace_sync_cursors(id,channel,environment,account_id,watermark,state,lease_token,lease_until,updated_at) VALUES('sync','etsy','production','fixture',?,'running','old-lease',9999999999999,?)").run(date,date);
f.db.prepare("INSERT INTO listing_removals(id,listing_id,item_id,target,state,attempt_token,started_at,message,created_at,updated_at) VALUES('removal','local-listing',?,?,'running','old-attempt',9999999999999,'request in flight',?,?)").run(item,JSON.stringify({channel:'etsy',environment:'production',accountId:'fixture',externalListingId:'remote',sku:'code'}),date,date);
f.db.prepare("INSERT INTO browser_devices(id,owner,name,created_at,last_seen_at) VALUES('browser','owner','test',?,?)").run(date,date);
f.db.prepare("INSERT INTO facebook_handoffs(id,item_id,owner,source_version,payload,state,device_id,attempt_id,created_at,updated_at) VALUES('handoff',?,'owner',1,'{}','preparing','browser','attempt',?,?)").run(item,date,date);
const run:any=await requestBackup(f.env);await advanceBackup(f.env);
const dir=process.argv[2];await mkdir(dir,{recursive:true,mode:0o700});await mkdir(dir+'/media',{mode:0o700});for(const [k,bytes] of f.env.BACKUPS.objects){if(k.startsWith(`snapshots/${run.id}/`))await writeFile(dir+'/'+k.slice(`snapshots/${run.id}/`.length),bytes as Uint8Array,{mode:0o600});}
f.db.close();
