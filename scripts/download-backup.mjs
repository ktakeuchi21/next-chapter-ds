// Download one completed cloud snapshot for an isolated restore or off-provider copy.
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const id=process.argv[2];if(!/^\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}$/.test(id||''))throw Error('Usage: node scripts/download-backup.mjs BACKUP_ID');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8')),bucket=config.r2_buckets.find(b=>b.binding==='BACKUPS')?.bucket_name;
if(!bucket)throw Error('Backup bucket is not configured');
const out=resolve('work/downloaded-backups',id);await mkdir(resolve('work/downloaded-backups'),{recursive:true,mode:0o700});await mkdir(out,{mode:0o700});await mkdir(out+'/media',{mode:0o700});
function get(file){const r=spawnSync('npx',['wrangler','r2','object','get',`${bucket}/snapshots/${id}/${file}`,'--remote','--file',out+'/'+file],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'./work/download-backup.log'},maxBuffer:1024*1024});if(r.status)throw Error('Could not download backup file. Inspect work/download-backup.log.');}
get('manifest.json');const manifest=JSON.parse(await readFile(out+'/manifest.json','utf8'));await chmod(out+'/manifest.json',0o600);
if(![5,6,7,8].includes(manifest.version)||!Array.isArray(manifest.files))throw Error('Unsupported backup');
// Keep completion marker out of the way until local bytes have been verified.
const manifestRaw=await readFile(out+'/manifest.json');await (await import('node:fs/promises')).unlink(out+'/manifest.json');
get('inventory.json');await chmod(out+'/inventory.json',0o600);const inventory=await readFile(out+'/inventory.json');if(createHash('sha256').update(inventory).digest('hex')!==manifest.inventorySha256)throw Error('Inventory checksum mismatch');
for(const f of manifest.files){if(!/^media\/[a-f0-9-]{36}(\.preview|\.edited|\.edited-preview)?$/.test(f.file))throw Error('Invalid media path');get(f.file);await chmod(out+'/'+f.file,0o600);const b=await readFile(out+'/'+f.file);if(b.length!==f.size||createHash('md5').update(b).digest('hex')!==f.etag)throw Error('Media checksum mismatch');}
await writeFile(out+'/manifest.json',manifestRaw,{mode:0o600});console.log(JSON.stringify({backup:out,verifiedFiles:manifest.files.length}));
