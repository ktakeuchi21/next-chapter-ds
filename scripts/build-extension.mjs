import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const base=JSON.parse(await readFile(new URL('../shared/browser-helper-config.json',import.meta.url),'utf8'));
const dev=process.argv.includes('--dev'),origin=process.env.NEXT_CHAPTER_HELPER_ORIGIN||'http://127.0.0.1:8787',fixtureOrigin=process.env.NEXT_CHAPTER_HELPER_FIXTURE||'http://127.0.0.1:8790';
if(dev&&![origin,fixtureOrigin].every(s=>{const u=new URL(s);return u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)&&u.origin===s;}))throw Error('Development origins must be explicit loopback origins.');
const out=resolve(dev?'work/browser-helper/extension-dev':'extension/dist');await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});await cp('extension/src',out,{recursive:true});
const origins=dev?[base.appOrigin,origin]:[base.appOrigin];
const config={version:base.version,appOrigins:origins,fixtureOrigin:dev?fixtureOrigin:null};
for(const name of ['background.js','helper.js'])await writeFile(out+'/'+name,'const config = '+JSON.stringify(config)+';\n'+await readFile('extension/src/'+name,'utf8'));
await writeFile(out+'/bridge.js','(() => { const config = '+JSON.stringify(config)+';\n'+await readFile('extension/src/bridge.js','utf8')+'\n})();\n');
const manifest={manifest_version:3,name:dev?'Next Chapter Helper (development)':'Next Chapter · Facebook helper',version:base.version,key:base.publicKey,description:'Prepare a reviewed Next Chapter listing in your Facebook browser, then return the published link. You stay in control of publishing.',permissions:['storage','scripting'],host_permissions:[...origins,...(dev?[fixtureOrigin]:[])].map(o=>o+'/*'),optional_host_permissions:dev?['https://www.facebook.com/*',fixtureOrigin+'/*']:['https://www.facebook.com/*'],background:{service_worker:'background.js'},action:{default_title:'Open Next Chapter helper'},content_scripts:[{matches:origins.map(o=>o+'/*'),js:['bridge.js'],run_at:'document_idle'}],externally_connectable:{matches:origins.map(o=>o+'/*')},content_security_policy:{extension_pages:"script-src 'self'; object-src 'none'"}};
await writeFile(out+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
if(!dev){await mkdir('public/downloads',{recursive:true});const zip=resolve('public/downloads/next-chapter-helper.zip');await rm(zip,{force:true});execFileSync('/usr/bin/zip',['-q','-r',zip,'.'],{cwd:out});}
console.log(JSON.stringify({directory:out,extensionId:base.extensionId,development:dev}));
