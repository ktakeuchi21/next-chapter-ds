import {mediaAssets} from '../shared/media-files.mjs';
import {readFile,mkdir,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const input=process.argv[2],target=process.argv[3];if(!input||!target)throw new Error('Usage: node scripts/restore-local.mjs BACKUP_DIR NEW_LOCAL_STATE_DIR');
const backup=resolve(input),destination=resolve(target);if(!destination.startsWith(resolve('work')+'/'))throw new Error('Restore only into a new folder under this project’s work directory.');
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(join(backup,'manifest.json'),'utf8'));const raw=await readFile(join(backup,'inventory.json'));if(![1,2,3,4,5,6,7,8].includes(manifest.version)||hash(raw)!==manifest.inventorySha256)throw new Error('Invalid or damaged backup manifest.');const snapshot=JSON.parse(raw);
const columns={...(manifest.version>=2?{clients:['id','name','code','default_location','next_number','created_at'],visits:['id','client_id','location','state','created_at'],label_reservations:['id','visit_id','code','block_id','created_at']}:{}),items:['id','code','sample_id','data','status','version','research','created_at','updated_at'],media:['id','item_id','kind','name','mime','size','object_key','transcript','created_at'],listings:['id','item_id','channel','url','state','updated_at'],jobs:['id','item_id','kind','media_id','state','error','result','created_at','updated_at'],activity:['id','item_id','message','created_at']};
if(manifest.version>=2){columns.items.push('client_id','visit_id','record_type','intake_report');columns.media.push('origin_item_id','preview_key');columns.intake_commits=['id','source_id','result','created_at'];columns.note_suggestions=['id','source_id','media_id','item_id','field','value','quote','confidence','state','previous_value','applied_version','created_at'];}
if(manifest.version>=3)columns.marketplace_drafts=['id','item_id','channel','data','source_version','version','created_at','updated_at'];
if(manifest.version>=4)columns.etsy_transfers=['id','item_id','shop_id','listing_id','draft_version','source_version','payload','state','step','uploaded','message','started_at','created_at','updated_at'];
if(manifest.version>=5){
 columns.marketplace_orders=['id','channel','environment','account_id','external_id','source','provider_updated_at','fingerprint','data','state','version','accepted_at','process_token','created_at','updated_at'];
 columns.order_events=['id','order_id','provider_updated_at','fingerprint','outcome','created_at'];
 columns.order_lines=['id','order_id','external_id','listing_id','sku','title','quantity','amount_minor','item_id'];
 columns.order_allocations=['id','order_id','line_id','item_id','created_at'];
 columns.order_tasks=['id','order_id','item_id','listing_id','kind','state','message','created_at','updated_at'];
}
if(manifest.version>=6){
 columns.marketplace_sync_cursors=['id','channel','environment','account_id','watermark','window_start','window_end','page_offset','pass_ids','previous_pass_hash','pass_number','state','failures','retry_at','lease_token','lease_until','message','updated_at'];
 columns.listing_removals=['id','listing_id','item_id','target','state','attempt_token','started_at','message','created_at','updated_at','verified_at'];
}
if(manifest.version>=7)columns.media.push('sort_order','rotation','edited_key','edited_preview_key','edited_mime','edited_size','revision');
if(manifest.version>=8)columns.facebook_handoffs=['id','item_id','owner','source_version','payload','state','revision','device_id','attempt_id','reason','listing_url','created_at','updated_at'];
const verifyFile=(bytes,entry)=>entry.sha256?hash(bytes)===entry.sha256:/^[a-f0-9]{32}$/.test(entry.etag||'')&&createHash('md5').update(bytes).digest('hex')===entry.etag;
for(const name of Object.keys(columns))if(!Array.isArray(snapshot[name]))throw new Error('Missing backup table.');
// A restored workspace cannot reuse workflow instances from the source.
for(const j of snapshot.jobs)if(['queued','running'].includes(j.state)){j.state='failed';j.error='Task interrupted by restore. Review before starting it again.';}
for(const t of snapshot.etsy_transfers||[])if(t.state==='running'){t.state='review_required';t.message='Transfer interrupted by restore. Check Etsy before retrying.';}
for(const c of snapshot.marketplace_sync_cursors||[]){c.state='paused';c.lease_token=null;c.lease_until=0;c.message='Sync paused after restore. Verify the seller connection before resuming.';}
for(const r of snapshot.listing_removals||[])if(r.state!=='complete'){r.state='review_required';r.attempt_token=null;r.started_at=0;r.message='Removal interrupted by restore. Read the marketplace state before any further action.';}
// Browser pairings are never restored, and an in-flight browser action cannot be replayed.
for(const h of snapshot.facebook_handoffs||[])if(!['complete','cancelled'].includes(h.state)){h.state='attention';h.device_id=null;h.attempt_id=null;h.reason='restored';h.revision++;}
const assets=mediaAssets(snapshot.media);
if(manifest.files.length!==assets.length)throw Error('Media inventory mismatch.');
for(const asset of assets){const entry=manifest.files.find(f=>f.file===asset.file);if(!entry||entry.id!==asset.id)throw Error('Invalid media manifest.');const file=join(backup,asset.file);if((await lstat(file)).isSymbolicLink())throw Error('Symlink media is not accepted.');const b=await readFile(file);if((asset.size!==undefined&&b.length!==asset.size)||b.length!==entry.size||!verifyFile(b,entry))throw Error('Media checksum mismatch.');}
// mkdir without recursive refuses an existing state directory. Never overwrite active local inventory.
await mkdir(destination,{mode:0o700});
function run(args){const r=spawnSync('npx',['wrangler',...args,'--local','--persist-to',destination],{encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,CI:'true',WRANGLER_LOG_PATH:'./work/restore.log'}});if(r.status!==0)throw new Error('Local restore command failed. Inspect work/restore.log.');return r.stdout;}
run(['d1','migrations','apply','next-chapter']);
const quote=v=>v===null||v===undefined?'NULL':typeof v==='number'&&Number.isFinite(v)?String(v):"'"+String(v).replaceAll("'","''")+"'";
const statements=[];for(const [table,cols] of Object.entries(columns))for(const row of snapshot[table])statements.push(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c=>quote(row[c])).join(',')});`);
const sql=join(destination,'restore.sql');await writeFile(sql,statements.join('\n'),{mode:0o600});if(statements.length)run(['d1','execute','next-chapter','--file',sql]);
for(const asset of assets)run(['r2','object','put',`next-chapter-media/${asset.sourceKey}`,'--file',join(backup,asset.file),'--content-type',asset.mime]);
console.log(JSON.stringify({restoredLocalState:destination,items:snapshot.items.length,media:snapshot.media.length,note:'Original local state was not modified. Start Wrangler with --persist-to pointing at this directory to inspect.'}));
