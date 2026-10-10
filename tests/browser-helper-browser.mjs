// Opt-in installed-extension regression against an already-running, migrated LOCAL Worker.
// Uses CDP directly: Playwright's MV3 auto-attachment can pause extension/app renderers.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
const base=process.env.NEXT_CHAPTER_TEST_API||'http://127.0.0.1:8787/api',origin=new URL(base).origin;
assert.ok(new URL(base).protocol==='http:'&&['127.0.0.1','localhost'].includes(new URL(base).hostname),'Only a local HTTP API is allowed');
const executable=process.env.NEXT_CHAPTER_CHROME;assert.ok(executable,'Set NEXT_CHAPTER_CHROME to a Chrome for Testing executable');
const {extensionId}=JSON.parse(await readFile('shared/browser-helper-config.json','utf8'));
const output=resolve('work/browser-helper/browser');await mkdir(output,{recursive:true});
await build({entryPoints:['shared/pickup.ts'],outfile:join(output,'pickup.mjs'),bundle:true,platform:'node',format:'esm'});
const {preparePickup}=await import(join(output,'pickup.mjs'));
const fixture=await readFile('tests/fixtures/facebook-form.html');
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(fixture);});
server.listen(0,'127.0.0.1');await once(server,'listening');const fixtureOrigin='http://127.0.0.1:'+server.address().port;
execFileSync(process.execPath,['scripts/build-extension.mjs','--dev'],{env:{...process.env,NEXT_CHAPTER_HELPER_ORIGIN:origin,NEXT_CHAPTER_HELPER_FIXTURE:fixtureOrigin},stdio:'ignore'});
const extension=resolve('work/browser-helper/extension-dev'),profile=await mkdtemp(join(tmpdir(),'next-chapter-extension-'));
let chrome,browser,app,port;const sockets=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>{chrome?.kill('SIGKILL');console.error('Browser suite exceeded its three-minute limit');process.exit(1);},180000);deadline.unref();
async function connect(url){
 const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});sockets.push(socket);
 let id=0;const pending=new Map(),listeners=new Map();
 socket.onmessage=e=>{const d=JSON.parse(e.data);if(d.id){const p=pending.get(d.id);if(p){pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}}else listeners.get(d.method)?.(d.params);};
 return {on:(name,fn)=>listeners.set(name,fn),send:(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method));},10000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));})};
}
async function evaluate(tab,expression){const r=await tab.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;}
async function wait(fn,label){for(let i=0;i<240;i++){const value=await fn();if(value)return value;await sleep(150);}throw Error('Timed out: '+label);}
async function targets(){return (await browser.send('Target.getTargets')).targetInfos;}
async function tab(id){const list=await fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json());const info=list.find(t=>t.id===id);assert.ok(info,'Missing browser tab');const client={...await connect(info.webSocketDebuggerUrl),id};client.on('Runtime.exceptionThrown',e=>console.error('Browser exception:',e.exceptionDetails?.exception?.description||e.exceptionDetails?.text));await client.send('Runtime.enable');return client;}
async function page(url){const {targetId}=await browser.send('Target.createTarget',{url});const t=await tab(targetId);await wait(()=>evaluate(t,'document.readyState === "complete"'),'page loaded');return t;}
function button(name){return `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(name)})`;}
async function click(t,name){if(app&&t.id!==app.id)await browser.send('Target.activateTarget',{targetId:app.id}).catch(()=>{});const expr=button(name);await wait(()=>evaluate(t,`!!(${expr}) && !(${expr}).disabled`),'button '+name);await evaluate(t,`${expr}.click()`);}
async function check(t,phrase){const expr=`[...document.querySelectorAll('label')].find(e=>e.textContent.includes(${JSON.stringify(phrase)}))?.querySelector('input[type="checkbox"]')`;await wait(()=>evaluate(t,`!!(${expr})`),'checkbox '+phrase);await evaluate(t,`if(!(${expr}).checked)(${expr}).click()`);}
async function status(t,text){try{await wait(()=>evaluate(t,`document.querySelector('#status')?.textContent.includes(${JSON.stringify(text)})`),'status '+text);}catch(e){console.error('Unexpected helper state:',await evaluate(t,`({status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent,busy,taskId,taskState:state?.task?.state,running:state?.running})`));throw e;}}
async function fillField(t,selector,value){await evaluate(t,`{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}`);}
async function screenshot(t,name){const {data}=await t.send('Page.captureScreenshot',{captureBeyondViewport:true});await writeFile(join(output,name),Buffer.from(data,'base64'));}
async function launch(){
 await rm(join(profile,'DevToolsActivePort'),{force:true});
 chrome=spawn(executable,['--headless=new','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'--disable-extensions-except='+extension,'--load-extension='+extension,'about:blank'],{stdio:'ignore'});
 let endpoint;await wait(async()=>{try{const lines=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n');port=Number(lines[0]);endpoint=lines[1];return !!port;}catch{return false;}},'Chrome startup');
 browser=await connect('ws://127.0.0.1:'+port+endpoint);app=await page(origin+'/#settings');await click(app,'Connect this browser');
 await wait(()=>evaluate(app,'document.body.innerText.includes("This browser is connected")'),'pairing');console.log('Browser paired');
}
async function req(path,body,method=body?'POST':'GET'){const r=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;}
async function seed(suffix){
 let item=await req('/items',{title:'Browser test Instant Pot '+suffix,owner:'PRIVATE owner',location:'PRIVATE shelf',notes:'PRIVATE notes',condition:'Used around 10 times; untested',fulfillment:'pickup',pickupArea:'Denver',price:30});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHdUAAAAASUVORK5CYII=','base64');const photos=[];
 for(let i=0;i<2;i++){const body=new FormData();body.append('file',new Blob([png],{type:'image/png'}),'fixture-'+i+'.png');const r=await fetch(base+'/items/'+item.id+'/media',{method:'POST',body});assert.ok(r.ok);photos.push({...await r.json(),kind:'photo'});}
 item=(await req('/items/'+item.id)).item;await req('/items/'+item.id+'/photos/order',{photoIds:photos.map(m=>m.id).reverse(),version:item.version},'PUT');
 item=(await req('/items/'+item.id)).item;return req('/items/'+item.id+'/pickup',{version:item.version,action:'save',form:preparePickup(item,photos.reverse())});
}
async function open(item){
 console.log('Opening fixture:',item.title);await evaluate(app,`location.hash=${JSON.stringify('#item/'+item.id)}`);
 await wait(()=>evaluate(app,`document.querySelector('h1')?.textContent===${JSON.stringify(item.title)}`),'item loaded');
 await evaluate(app,`[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.trim()==='Selling').click()`);
 await check(app,'I reviewed the saved title');await click(app,'Send to Chrome helper');
 const target=await wait(async()=>{const tasks=await req('/items/'+item.id+'/facebook-handoffs');return tasks.length&&(await targets()).find(t=>t.url.includes('/helper.html?task='+tasks[0].id));},'helper tab');
 await browser.send('Target.activateTarget',{targetId:app.id});const helper=await tab(target.targetId);try{await wait(()=>evaluate(helper,`!!document.querySelector('#open-form') && !document.querySelector('#item').hidden && document.querySelector('#code').textContent===${JSON.stringify(item.code)}`),'helper ready');}catch(e){console.error('Helper error:',await evaluate(helper,`({status:document.querySelector('#status')?.textContent,error:document.querySelector('#error')?.textContent,scriptLoaded:typeof send,task:typeof taskId==='undefined'?null:taskId})`));throw e;}
 const previous=(await targets()).map(t=>t.targetId);await click(helper,'Open Facebook form');
 const next=await wait(async()=>(await targets()).find(t=>t.url.startsWith(fixtureOrigin)&&!previous.includes(t.targetId)),'form tab');
 const form=await tab(next.targetId);await wait(()=>evaluate(form,'!!window.fixture'),'form ready');return {helper,form,taskId:new URL(target.url).searchParams.get('task'),helperUrl:target.url};
}
async function fill(helper){await browser.send('Target.activateTarget',{targetId:app.id});await check(helper,'I checked this item and price');await click(helper,'Fill text & add photos');}
const results={};
try{
 await launch();const item=await seed('happy'),first=await open(item);await fill(first.helper);await status(first.helper,'Text filled and photos handed to Facebook');
 const saved=await req('/browser-helper/tasks/'+first.taskId);const actual=await evaluate(first.form,'({title:document.querySelector("[aria-label=Title]").value,price:document.querySelector("[aria-label=Price]").value,description:document.querySelector("[aria-label=Description]").value,...window.fixture})');
 assert.equal(actual.price,'30.00');assert.equal(actual.title,saved.payload.fields.title);assert.ok(!actual.description.includes('PRIVATE'));assert.equal(actual.uploads,1);assert.equal(actual.publishes,0);assert.deepEqual(actual.files.map(f=>f.name),saved.payload.photos.map(p=>p.name));assert.equal(await evaluate(first.helper,'document.querySelector("#fill").disabled'),true);
 await evaluate(first.helper,'document.querySelector("#link").closest("details").open=true');await fillField(first.helper,'#link','https://www.facebook.com/marketplace/item/999000111222/');await browser.send('Target.activateTarget',{targetId:app.id});await click(first.helper,'Send link to Next Chapter');await status(first.helper,'Link received');assert.equal((await req('/items/'+item.id)).item.status,'intake');
 await browser.send('Target.activateTarget',{targetId:app.id});await check(app,'I checked this link: it is my published listing for');await click(app,'Confirm link & mark listed');await wait(async()=>(await req('/browser-helper/tasks/'+first.taskId)).state==='complete','confirmed listing');
 results.roundTrip={orderedPhotos:2,uploadDispatches:1,publishClicks:0,confirmed:true};await click(first.helper,'Refresh saved progress');await status(first.helper,'listing is linked');await screenshot(first.helper,'helper-complete.png');
 const denied=await evaluate(first.helper,`(async()=>{const tabs=await chrome.tabs.query({});const app=tabs.find(t=>t.url?.includes('/#item/'));return chrome.tabs.sendMessage(app.id,{type:'NC_BRIDGE_V1',path:'/api/export',method:'GET'});})()`);assert.equal(denied.ok,false);assert.match(denied.error,/not supported/);results.privateExportBlocked=true;
 const occupied=await open(await seed('occupied'));await fillField(occupied.form,'[aria-label=Title]','Keep this existing draft');await fill(occupied.helper);await status(occupied.helper,'already has content');assert.equal(await evaluate(occupied.form,'document.querySelector("[aria-label=Title]").value'),'Keep this existing draft');assert.equal(await evaluate(occupied.form,'fixture.uploads'),0);results.occupiedFormPreserved=true;
 await occupied.helper.send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false});assert.equal(await evaluate(occupied.helper,'document.documentElement.scrollWidth<=innerWidth'),true);await screenshot(occupied.helper,'helper-mobile.png');results.mobileLayout=true;
 const staleItem=await seed('stale'),stale=await open(staleItem);await req('/items/'+staleItem.id,{...staleItem,title:'Browser test renamed while reviewing'},'PUT');await click(stale.helper,'Refresh saved progress');await status(stale.helper,'details changed');assert.equal(await evaluate(stale.helper,'document.querySelector("#fill").disabled'),true);assert.equal(await evaluate(stale.form,'fixture.uploads'),0);results.staleTaskBlocked=true;
 const interrupted=await open(await seed('interrupted'));let paused=false;app.on('Fetch.requestPaused',()=>{paused=true;});await app.send('Fetch.enable',{patterns:[{urlPattern:origin+'/api/browser-helper/tasks/*/photos/*',requestStage:'Request'}]});await fill(interrupted.helper);await wait(()=>Promise.resolve(paused),'photo transfer interrupted');assert.equal((await req('/browser-helper/tasks/'+interrupted.taskId)).state,'preparing');
 chrome.kill('SIGKILL');await once(chrome,'exit');for(const s of sockets)s.close();await launch();const resumed=await page(interrupted.helperUrl);await browser.send('Target.activateTarget',{targetId:app.id});await status(resumed,'interrupted');assert.equal(await evaluate(resumed,'document.querySelector("#fill").disabled'),true);assert.equal((await req('/browser-helper/tasks/'+interrupted.taskId)).state,'attention');results.restartNoReplay=true;
 for(const t of await targets())if(t.type==='page'&&t.url.startsWith(origin))await browser.send('Target.closeTarget',{targetId:t.targetId});await click(resumed,'Refresh saved progress');await wait(()=>evaluate(resumed,'document.querySelector("#error").textContent.includes("signed-in Next Chapter tab")'),'connection recovery message');assert.equal(await evaluate(resumed,'document.querySelector("#item").hidden'),true);results.disconnectionExplained=true;
 await writeFile(join(output,'regression-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}catch(error){console.error('Completed checks:',results);if(browser)console.error((await targets().catch(()=>[])).filter(t=>t.type==='page').map(t=>t.url));throw error;}
finally{for(const s of sockets)s.close();chrome?.kill();server.close();clearTimeout(deadline);}
