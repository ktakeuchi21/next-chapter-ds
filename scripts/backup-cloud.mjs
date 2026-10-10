import {mediaAssets} from '../shared/media-files.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
if(config.name!=='next-chapter-ds'||config.vars.LOCAL_DEV!=='false')throw Error('Expected production Next Chapter configuration');
const database=config.d1_databases.find(b=>b.binding==='DB').database_name;
const bucket=config.r2_buckets.find(b=>b.binding==='MEDIA').bucket_name;
const candidateTables=JSON.parse(await readFile(new URL('../shared/backup-tables.json',import.meta.url),'utf8'));
let tables=candidateTables;
const hash=b=>createHash('sha256').update(b).digest('hex');
const out=resolve('work/cloud-backups',new Date().toISOString().replaceAll(':','-'));
await mkdir(out,{recursive:true,mode:0o700});await mkdir(out+'/media',{mode:0o700});
function run(args){const r=spawnSync('npx',['wrangler',...args],{encoding:'utf8',env:{...process.env,CI:'true'},maxBuffer:32*1024*1024});if(r.status!==0)throw Error(r.stderr||r.stdout);return r.stdout;}
function snapshot(){const results=JSON.parse(run(['d1','execute',database,'--remote','--command',tables.map(t=>`SELECT * FROM ${t} ORDER BY id`).join(';'),'--json']));if(results.length!==tables.length||results.some(r=>!r.success))throw Error('Cloud metadata export failed');return Object.fromEntries(tables.map((t,i)=>[t,results[i].results]));}
// A pre-migration backup must remain possible while the new code is on disk.
const schema=JSON.parse(run(['d1','execute',database,'--remote','--command',"SELECT name FROM sqlite_master WHERE type='table'",'--json']));
if(!schema[0]?.success)throw Error('Could not inspect backup schema');
const available=new Set(schema[0].results.map(r=>r.name)),optional=['marketplace_sync_cursors','listing_removals'];
const newTables=optional.filter(t=>available.has(t));if(newTables.length===1)throw Error('Incomplete marketplace migration; inspect the schema before backing up');
const mediaColumns=JSON.parse(run(['d1','execute',database,'--remote','--command','PRAGMA table_info(media)','--json']));
const version=available.has('facebook_handoffs')?8:mediaColumns[0]?.results.some(c=>c.name==='edited_key')?7:newTables.length===2?6:5;tables=candidateTables.filter(t=>(version>=6||!optional.includes(t))&&(version>=8||t!=='facebook_handoffs'));
if(tables.some(t=>!available.has(t)))throw Error('Required backup table missing');
const data=snapshot();if(data.jobs.some(j=>['queued','running'].includes(j.state)))throw Error('Wait for active AI tasks before backing up');
const files=[];
for(const entry of mediaAssets(data.media)){
 run(['r2','object','get',bucket+'/'+entry.sourceKey,'--remote','--file',out+'/'+entry.file]);
 const bytes=await readFile(out+'/'+entry.file);if(entry.size!==undefined&&bytes.length!==entry.size)throw Error('Cloud media size mismatch');
 await (await import('node:fs/promises')).chmod(out+'/'+entry.file,0o600);
 files.push({...entry,size:bytes.length,sha256:hash(bytes)});
}
if(JSON.stringify(data)!==JSON.stringify(snapshot()))throw Error('Inventory changed during backup; retry when editing is finished. Incomplete backup has no manifest.');
const inventory=JSON.stringify({version,exportedAt:new Date().toISOString(),...data},null,2);
await writeFile(out+'/inventory.json',inventory,{mode:0o600});
await writeFile(out+'/manifest.json',JSON.stringify({version,createdAt:new Date().toISOString(),source:'cloud',files,inventorySha256:hash(inventory)},null,2),{mode:0o600});
console.log(JSON.stringify({backup:out,items:data.items.length,media:files.length}));
