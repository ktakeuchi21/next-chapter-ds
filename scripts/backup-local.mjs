import {mediaAssets} from '../shared/media-files.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const base=process.env.BACKUP_API||'http://127.0.0.1:8787/api';if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/api$/.test(base))throw Error('Use a local test API only');
async function json(path){const r=await fetch(base+path);if(!r.ok)throw new Error(`Local backup request failed (${r.status}).`);return r.json();}
const config=await json('/config');if(config.local!==true)throw new Error('This command only backs up the local development app.');
const snapshot=await json('/export');if(![5,6,7,8].includes(snapshot.version))throw new Error('Unsupported backup snapshot version.');if(snapshot.jobs.some(j=>['queued','running'].includes(j.state)))throw new Error('Finish active tasks before taking a consistent backup.');
const out=resolve('work/backups',new Date().toISOString().replaceAll(':','-'));await mkdir(out,{recursive:true,mode:0o700});await mkdir(out+'/media',{mode:0o700});
const files=[];
for(const entry of mediaAssets(snapshot.media)){
 const query=entry.variant==='edited-preview'?'?preview=1':entry.variant==='edited'?'':entry.preview?'?original=1&preview=1':'?original=1';
 const r=await fetch(base+'/media/'+entry.id+query);if(!r.ok)throw Error('A media file could not be backed up.');
 const bytes=Buffer.from(await r.arrayBuffer());if(entry.size!==undefined&&bytes.length!==entry.size)throw Error('Media size did not match inventory.');
 await writeFile(out+'/'+entry.file,bytes,{mode:0o600});files.push({...entry,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const end=await json('/export');const stable=s=>JSON.stringify(Object.fromEntries(Object.keys(s).filter(k=>!['exportedAt','note'].includes(k)).map(k=>[k,s[k]])));
if(stable(snapshot)!==stable(end))throw new Error('Inventory changed during backup. No complete manifest was written; try again when editing is finished.');
await writeFile(out+'/inventory.json',JSON.stringify(snapshot,null,2),{mode:0o600});
await writeFile(out+'/manifest.json',JSON.stringify({version:snapshot.version,createdAt:new Date().toISOString(),files,inventorySha256:createHash('sha256').update(await (await import('node:fs/promises')).readFile(out+'/inventory.json')).digest('hex')},null,2),{mode:0o600});
console.log(JSON.stringify({backup:out,items:snapshot.items.length,media:files.length}));
