import {mediaAssets} from '../shared/media-files.mjs';
import {Hono} from 'hono';
import type {Env} from './types';
import {inventorySnapshot,sha256} from './snapshot';
import {now,uuid} from './db';
const DAY=86400000;
type Run={id:string;state:string;cursor:number;file_count:number;inventory_hash:string|null;created_at:string;updated_at:string;completed_at:string|null;error:string|null};
export function backupFiles(snapshot:any){return mediaAssets(snapshot.media);}
export async function requestBackup(env:Env){
 if(!env.BACKUPS)throw Error('Backup storage is not configured');
 const date=now(),id=date.slice(0,10)+'-'+uuid();
 await env.DB.prepare(`INSERT INTO backup_runs(id,created_at,updated_at) SELECT ?,?,?
 WHERE NOT EXISTS(SELECT 1 FROM backup_runs WHERE state IN ('queued','copying'))
 AND (SELECT COUNT(*) FROM backup_runs WHERE created_at>=?)<3`).bind(id,date,date,date.slice(0,10)).run();
 return env.DB.prepare("SELECT id,state FROM backup_runs WHERE state IN ('queued','copying') ORDER BY created_at DESC LIMIT 1").first();
}
export async function backupStatus(env:Env){
 const rows=await env.DB.prepare("SELECT id,state,cursor,file_count,error,created_at,updated_at,completed_at FROM backup_runs WHERE state!='expired' ORDER BY created_at DESC LIMIT 8").all<Run>();
 const last=await env.DB.prepare("SELECT id,completed_at FROM backup_runs WHERE state='completed' ORDER BY completed_at DESC LIMIT 1").first<{id:string;completed_at:string}>();
 return {configured:!!env.BACKUPS,scheduled:env.BACKUPS_ENABLED==='true'&&env.LOCAL_DEV!=='true',schedule:env.LOCAL_DEV==='true'?'Manual backups in local development':'Daily after 09:00 UTC',retentionDays:30,stale:!last||Date.now()-Date.parse(last.completed_at)>2*DAY,lastSuccess:last,runs:rows.results};
}
export async function advanceBackup(env:Env,budget=5){
 const started=Date.now();
 if(!env.BACKUPS)return;
 const run=await env.DB.prepare("SELECT * FROM backup_runs WHERE state IN ('queued','copying') ORDER BY created_at LIMIT 1").first<Run>();if(!run)return;
 const token=uuid();
 const claim=await env.DB.prepare("UPDATE backup_runs SET lease_token=?,lease_until=?,updated_at=? WHERE id=? AND lease_until<? AND state IN ('queued','copying')").bind(token,Date.now()+240000,now(),run.id,Date.now()).run();if(!claim.meta.changes)return;
 const prefix=`snapshots/${run.id}/`;
 try{
  let raw:string;
  const saved=await env.BACKUPS.get(prefix+'inventory.json');
  if(saved)raw=await saved.text();else{
   raw=JSON.stringify(await inventorySnapshot(env));
   if(new TextEncoder().encode(raw).length>16*1024*1024)throw Error('Snapshot needs a larger export strategy');
   await env.BACKUPS.put(prefix+'inventory.json',raw,{httpMetadata:{contentType:'application/json'}});
  }
  const snapshot=JSON.parse(raw);
  if(![5,6,7,8].includes(snapshot.version))throw Error('Unsupported backup snapshot version');
  const files=backupFiles(snapshot),hash=await sha256(raw);
  if(run.inventory_hash&&run.inventory_hash!==hash)throw Error('Inventory checksum mismatch');
  await env.DB.prepare("UPDATE backup_runs SET state='copying',inventory_hash=?,file_count=? WHERE id=? AND lease_token=?").bind(hash,files.length,run.id,token).run();
  // Bounded work keeps each scheduled invocation small. Crashes resume at the cursor.
  for(let i=run.cursor;i<Math.min(run.cursor+budget,files.length)&&Date.now()-started<40000;i++){
   const f=files[i],source=await env.MEDIA.get(f.sourceKey);if(!source||(f.size!==undefined&&source.size!==f.size))throw Error('Missing or changed source media');
   const target=await env.BACKUPS.put(prefix+f.file,source.body,{httpMetadata:source.httpMetadata,...(source.checksums.md5?{md5:source.checksums.md5}:{})});
   if(!target||target.size!==source.size||target.etag!==source.etag)throw Error('Media copy could not be verified');
   await env.DB.prepare(`UPDATE backup_runs SET cursor=?,files=json_insert(files,'$[#]',json(?)),lease_until=?,updated_at=? WHERE id=? AND lease_token=?`).bind(i+1,JSON.stringify({...f,size:target.size,etag:target.etag}),Date.now()+240000,now(),run.id,token).run();
  }
  const progress=await env.DB.prepare('SELECT cursor,files FROM backup_runs WHERE id=? AND lease_token=?').bind(run.id,token).first<{cursor:number;files:string}>();
  if(progress?.cursor===files.length){
   const entries=JSON.parse(progress.files);if(entries.length!==files.length)throw Error('Incomplete backup');
   // The manifest is the completion marker; incomplete runs are never restorable.
   const manifest={version:snapshot.version,source:'scheduled-cloud',createdAt:now(),inventorySha256:hash,files:entries};
   await env.BACKUPS.put(prefix+'manifest.json',JSON.stringify(manifest),{httpMetadata:{contentType:'application/json'}});
   await env.DB.prepare("UPDATE backup_runs SET state='completed',completed_at=?,error=NULL WHERE id=? AND lease_token=?").bind(now(),run.id,token).run();
  }
 }catch{
  // Don't log customer data or provider payloads; an operator can inspect the run.
  await env.DB.prepare("UPDATE backup_runs SET state='failed',error='Backup did not finish. The next scheduled attempt will retry; previous complete backups are kept.' WHERE id=? AND lease_token=?").bind(run.id,token).run();
 }finally{await env.DB.prepare('UPDATE backup_runs SET lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND lease_token=?').bind(now(),run.id,token).run();}
}
export async function pruneBackups(env:Env){
 if(!env.BACKUPS)return;
 const healthy=await env.DB.prepare("SELECT id FROM backup_runs WHERE state='completed' AND completed_at>? LIMIT 1").bind(new Date(Date.now()-2*DAY).toISOString()).first();if(!healthy)return;
 // Retain 30 days and at least seven successful runs. Never expire the last good copy.
 const old=await env.DB.prepare(`SELECT id FROM backup_runs WHERE state IN ('completed','failed') AND created_at<? AND id NOT IN
 (SELECT id FROM backup_runs WHERE state='completed' ORDER BY completed_at DESC LIMIT 7) ORDER BY created_at LIMIT 1`).bind(new Date(Date.now()-30*DAY).toISOString()).first<{id:string}>();if(!old)return;
 const page=await env.BACKUPS.list({prefix:`snapshots/${old.id}/`,limit:100});
 if(page.objects.length)await env.BACKUPS.delete(page.objects.map(o=>o.key));
 if(!page.truncated)await env.DB.prepare("UPDATE backup_runs SET state='expired' WHERE id=? AND state IN ('completed','failed')").bind(old.id).run();
}
export async function scheduledBackups(env:Env){
 if(env.BACKUPS_ENABLED!=='true')return;
 const date=now(),today=date.slice(0,10);
 const done=await env.DB.prepare("SELECT id FROM backup_runs WHERE state='completed' AND created_at>=? LIMIT 1").bind(today).first();
 if(!done&&date.slice(11,13)>='09')await requestBackup(env);
 await advanceBackup(env,20);await pruneBackups(env);
}
export const backupRoutes=new Hono<{Bindings:Env}>();
backupRoutes.get('/api/backups',async c=>c.json(await backupStatus(c.env)));
backupRoutes.post('/api/backups',async c=>{if(!c.env.BACKUPS)return c.json({error:'Backup storage is not configured.'},503);const run=await requestBackup(c.env);if(!run)return c.json({error:'Today’s three backup attempts have been used. Check the failed run before trying tomorrow.'},429);c.executionCtx.waitUntil(advanceBackup(c.env,20));return c.json(run,202);});
