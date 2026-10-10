import {it,expect} from 'vitest';
import {mkdtempSync,readdirSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const script=new URL('../scripts/backup-local.mjs',import.meta.url).href;
function run(version:unknown){
 const dir=mkdtempSync(join(tmpdir(),'next-chapter-backup-version-'));
 const snapshot={version,exportedAt:'2026-09-25T00:00:00Z',jobs:[],media:[],items:[]};
 // Run the actual script with an in-memory local API. No network or app state.
 const code=`const snapshot=${JSON.stringify(snapshot)};globalThis.fetch=async url=>Response.json(String(url).endsWith('/config')?{local:true}:snapshot);await import(${JSON.stringify(script)});`;
 const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{cwd:dir,encoding:'utf8'});
 return {dir,result,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
it.each([5,6,7,8])('local backup preserves the connected server snapshot version %s',version=>{
 const f=run(version);try{expect(f.result.status).toBe(0);const parent=join(f.dir,'work/backups'),backup=join(parent,readdirSync(parent)[0]);expect(JSON.parse(readFileSync(join(backup,'manifest.json'),'utf8')).version).toBe(version);expect(JSON.parse(readFileSync(join(backup,'inventory.json'),'utf8')).version).toBe(version);}finally{f.cleanup();}
});
it.each([undefined,4,9,'6'])('local backup rejects unsupported snapshot version %s before writing a backup',version=>{
 const f=run(version);try{expect(f.result.status).not.toBe(0);expect(f.result.stderr).toContain('Unsupported backup snapshot version');expect(existsSync(join(f.dir,'work/backups'))).toBe(false);}finally{f.cleanup();}
});
