import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {mkdir,readdir,readFile,writeFile,cp} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
const run=args=>{const r=spawnSync(process.execPath,args,{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'./work/restore-test.log'},maxBuffer:1024*1024});if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout;};
test('scheduled backup restores order ownership/media and stops interrupted jobs in a new local database',async()=>{
 const base='work/restore-test-'+Date.now(),backup=base+'/backup',restored=base+'/restored';await mkdir(base,{recursive:true});
 // Keep import.meta.url relative fixture paths intact by bundling beside tests.
 const bundle='tests/.backup-restore-fixture.mjs';await build({entryPoints:['tests/backup-restore-fixture.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external'});
 try{run([bundle,backup]);run(['scripts/restore-local.mjs',backup,restored]);}finally{await (await import('node:fs/promises')).rm(bundle,{force:true});}
 const files=await readdir(restored+'/v3/d1/miniflare-D1DatabaseObject');const db=new DatabaseSync(restored+'/v3/d1/miniflare-D1DatabaseObject/'+files.find(n=>n.endsWith('.sqlite')),{readOnly:true});
 try{assert.deepEqual({...db.prepare('SELECT rotation,sort_order,revision,edited_mime,edited_size FROM media').get()},{rotation:90,sort_order:4,revision:2,edited_mime:'image/png',edited_size:4});assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_orders').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM order_allocations').get().n,1);assert.equal(db.prepare('SELECT status FROM items').get().status,'sold');assert.equal(db.prepare('SELECT state FROM jobs').get().state,'failed');assert.equal(db.prepare('SELECT COUNT(*) n FROM marketplace_connections').get().n,0);assert.equal(db.prepare('SELECT state FROM marketplace_sync_cursors').get().state,'paused');assert.equal(db.prepare('SELECT lease_token FROM marketplace_sync_cursors').get().lease_token,null);assert.equal(db.prepare('SELECT state FROM listing_removals').get().state,'review_required');assert.equal(db.prepare('SELECT attempt_token FROM listing_removals').get().attempt_token,null);assert.equal(db.prepare('SELECT COUNT(*) n FROM browser_devices').get().n,0);assert.deepEqual({...db.prepare('SELECT state,device_id,attempt_id,reason FROM facebook_handoffs').get()},{state:'attention',device_id:null,attempt_id:null,reason:'restored'});}finally{db.close();}
 const damaged=base+'/damaged';await cp(backup,damaged,{recursive:true});const manifest=JSON.parse(await readFile(damaged+'/manifest.json'));await writeFile(damaged+'/'+manifest.files[0].file,'bad data');const result=spawnSync(process.execPath,['scripts/restore-local.mjs',damaged,base+'/should-not-exist'],{encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/checksum mismatch/);
 console.log(JSON.stringify({verifiedRestore:restored,verifiedCorruptionRefusal:true}));
});
