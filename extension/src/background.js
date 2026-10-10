// The build embeds the public configuration above this script, so listeners register synchronously.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reasons = ['form_changed','occupied','login_required','challenge','upload_uncertain','interrupted','photo_limit','device_revoked','restored','manual','readback_mismatch','adapter_error'];
const ready = chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
let filling = false;
async function appMessage(tabId,message) {
  let timer,expired=false;
  try {
    const request=(async()=>{
      // Ensure the receiver exists even when the app tab was open before installation or restored by Chrome.
      if (!appOrigin((await chrome.tabs.get(tabId)).url)) throw Error('Return to the signed-in Next Chapter tab.');
      await chrome.scripting.executeScript({target:{tabId},files:['bridge.js']});
      if (expired) throw Error('The app connection timed out before dispatch.');
      return chrome.tabs.sendMessage(tabId,message);
    })();
    return await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Open the signed-in Next Chapter tab, then refresh saved progress here.'));},23000);})]);
  }
  finally {clearTimeout(timer);}
}
async function identity() {await ready; const saved = await chrome.storage.local.get('device'); if (saved.device) return saved.device; const device = crypto.randomUUID(); await chrome.storage.local.set({device}); return device;}
function appOrigin(url) {try {const origin = new URL(url).origin; return config.appOrigins.includes(origin) ? origin : null;} catch {return null;}}
function itemUrl(url) {try {const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password && !u.port && ['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com'].includes(u.hostname) && /^\/marketplace\/item\/\d+\/?$/.test(u.pathname) ? `https://www.facebook.com${u.pathname.replace(/\/$/,'')}/` : null;} catch {return null;}}
function formUrl(url) {try {const u = new URL(url); return (u.origin === 'https://www.facebook.com' && u.pathname === '/marketplace/create/item') || (config.fixtureOrigin && u.origin === config.fixtureOrigin && u.pathname === '/facebook-fixture.html');} catch {return false;}}
async function bridge(path, method = 'GET', body, offset) {
  const {pair} = await chrome.storage.local.get('pair'); if (!pair) throw Error('Open Next Chapter → Connections and connect this browser.');
  const tabs = (await chrome.tabs.query({})).filter(t => appOrigin(t.url) === pair.origin).sort((a,b) => Number(!!a.frozen||!!a.discarded)-Number(!!b.frozen||!!b.discarded)||Number(!!b.active)-Number(!!a.active)||Number(b.id === pair.tabId)-Number(a.id === pair.tabId));
  if (!tabs.length) throw Error('Keep a signed-in Next Chapter tab open, then try again.');
  if (tabs[0].frozen || tabs[0].discarded) throw Error('Open the signed-in Next Chapter tab to wake it up, then refresh saved progress here.');
  // Try another signed-in tab only when no request was dispatched. Never replay a write after an ambiguous response.
  const tab = tabs[0]; let response;
  try {response = await appMessage(tab.id, {type:'NC_BRIDGE_V1',path,method,body,offset});}
  catch {throw Error('Reload the Next Chapter tab so the helper can connect, then return here.');}
  if (!response?.ok) throw Error(response?.error || 'The app connection was interrupted. Open Next Chapter to check the saved task.');
  return response.data;
}
async function task(id) {if (!UUID.test(id)) throw Error('Open a saved handoff from the item in Next Chapter.'); return bridge(`/api/browser-helper/tasks/${id}`);}
async function saveRun(id, change) {const {runs = {}} = await chrome.storage.local.get('runs'); runs[id] = {...runs[id], ...change}; await chrome.storage.local.set({runs}); return runs[id];}
async function form(tabId, message) {const tab = await chrome.tabs.get(tabId); if (!formUrl(tab.url)) throw Error('form_changed'); const r = await chrome.tabs.sendMessage(tabId, {type:'NC_FORM_V1',...message}); if (!r?.ok) throw Error(r?.reason || 'adapter_error'); return r.data;}
async function fill(id, confirmed) {
  if (!confirmed) throw Error('Review the item, seller account and empty form first.');
  if (filling) throw Error('Another item is being prepared. Wait for it to finish.');
  filling = true; let t, run;
  try {
    const {runs = {}, pair} = await chrome.storage.local.get(['runs','pair']); if (!pair) throw Error('Connect this browser in Next Chapter first.');
    if (runs[id]?.attemptId) throw Error('This preparation already started. Inspect Facebook and finish manually; it will not be sent twice.');
    t = await task(id); if (t.stale || t.state !== 'queued') throw Error('This task changed or already started. Return to Next Chapter to review it.');
    const tabId = runs[id]?.facebookTab; const tab = tabId && await chrome.tabs.get(tabId).catch(()=>null);
    if (!tab || !formUrl(tab.url)) throw Error('Open the Facebook form using the button above first.');
    const deviceId = await identity(), attemptId = crypto.randomUUID();
    run = await saveRun(id,{attemptId,deviceId,phase:'claiming',message:'Saving progress before changing Facebook…'});
    const claimed = await bridge(`/api/browser-helper/tasks/${id}/claim`,'POST',{deviceId,attemptId}); t = claimed.task;
    if (claimed.resumed) throw Error('interrupted');
    await saveRun(id,{phase:'writing',message:'Filling title, price and description…'});
    await chrome.scripting.executeScript({target:{tabId},files:['adapter.js']});
    await form(tabId,{action:'begin',attemptId,payload:t.payload});
    let i = 0;
    for (const photo of t.payload.photos) {
      await saveRun(id,{phase:'loading-photos',message:`Preparing photo ${++i} of ${t.payload.photos.length}…`});
      for (let offset=0;offset<photo.size;) {
        const segment = await bridge(`/api/browser-helper/tasks/${id}/photos/${photo.id}?device=${deviceId}&attempt=${attemptId}`,'GET',undefined,offset);
        if (!segment.length || segment.length > photo.size-offset) throw Error('upload_uncertain');
        const received = await form(tabId,{action:'chunk',attemptId,photoId:photo.id,offset,data:segment.data});
        offset += segment.length; if (received.received !== offset) throw Error('upload_uncertain');
      }
    }
    // Recheck the app immediately before the photo upload, after potentially slow transfers.
    t = await task(id); if (t.stale || t.state !== 'preparing' || t.attemptId !== attemptId) throw Error('interrupted');
    await saveRun(id,{phase:'photos-dispatched',message:'Sending the selected photos. Check Facebook previews before adding any again.'});
    await form(tabId,{action:'photos',attemptId});
    t = await bridge(`/api/browser-helper/tasks/${id}/report`,'POST',{deviceId,attemptId,revision:t.revision,kind:'prepared'});
    await saveRun(id,{phase:'prepared',message:'Text filled and photos handed to Facebook. Check every preview, choose category, condition and pickup location, then publish yourself.'});
    return t;
  } catch (error) {
    if (run?.attemptId) {
      const reason = reasons.includes(error.message) ? error.message : 'interrupted';
      await saveRun(id,{phase:'attention',message:'Preparation stopped. Inspect the existing Facebook draft before continuing.',reason});
      try {const latest=await task(id); if (latest.attemptId===run.attemptId && ['preparing','prepared','attention'].includes(latest.state)) await bridge(`/api/browser-helper/tasks/${id}/report`,'POST',{deviceId:run.deviceId,attemptId:run.attemptId,revision:latest.revision,kind:'attention',reason});} catch {}
    }
    throw error;
  } finally {filling=false;}
}
async function openHelper(id) {
  const base=chrome.runtime.getURL('helper.html'),url=base+`?task=${encodeURIComponent(id)}`;
  const existing=(await chrome.tabs.query({})).find(t=>t.url===base||t.url?.startsWith(base+'?'));
  if (filling && existing?.url!==url) throw Error('Finish the current preparation before opening another item.');
  await chrome.storage.local.set({lastTask:id});
  // One helper tab follows the current item; its other handoffs stay saved in Next Chapter.
  return existing?chrome.tabs.update(existing.id,{active:true,...(existing.url===url?{}:{url})}):chrome.tabs.create({url});
}
chrome.runtime.onMessageExternal.addListener((m,sender,reply)=>{
  const origin=appOrigin(sender.url); if (!origin || sender.frameId !== 0 || !sender.tab?.id || m?.protocol !== 1) return;
  (async()=>{
    const deviceId=await identity();
    if (m.action==='ping') {const {pair}=await chrome.storage.local.get('pair');return {deviceId,version:config.version,connected:pair?.origin===origin};}
    if (m.action==='pair') {
      // Verify the user's app-side pairing in that authenticated tab before retaining it.
      const result=await appMessage(sender.tab.id,{type:'NC_BRIDGE_V1',path:'/api/browser-helper/devices'});
      if (!result?.ok || !result.data.some(d=>d.id===deviceId)) throw Error('Connect this browser in the app first. If just installed, reload the app tab.');
      await chrome.storage.local.set({pair:{origin,tabId:sender.tab.id}}); return {connected:true};
    }
    if (m.action==='openTask' && UUID.test(m.taskId)) {await task(m.taskId); await openHelper(m.taskId); return {opened:true};}
    throw Error('Unsupported helper action.');
  })().then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message}));return true;
});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if (sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('helper.html')) || m?.type!=='NC_PANEL_V1') return;
  (async()=>{
    if (m.action==='state') {
      const local=await chrome.storage.local.get(['pair','runs','lastTask']);const id=m.taskId||local.lastTask;
      let current=id?await task(id):null;const run=id&&local.runs?.[id];
      // A fresh worker has no operation in flight. Reconcile saved intent without replaying a form write.
      if (!filling && current?.state==='preparing' && run?.attemptId===current.attemptId) {
        current=await bridge(`/api/browser-helper/tasks/${id}/report`,'POST',{deviceId:run.deviceId,attemptId:run.attemptId,revision:current.revision,kind:'attention',reason:'interrupted'});
      }
      return {...local,task:current,running:filling};
    }
    if (m.action==='openApp') {const {pair}=await chrome.storage.local.get('pair');return chrome.tabs.create({url:(pair?.origin||config.appOrigins[0])+'/#settings'});}
    if (!UUID.test(m.taskId)) throw Error('Choose an item in Next Chapter first.');
    if (m.action==='openForm') {
      const {runs={}}=await chrome.storage.local.get('runs'); const existing=runs[m.taskId]?.facebookTab;
      if (existing) {const tab=await chrome.tabs.get(existing).catch(()=>null);if (tab && (formUrl(tab.url)||itemUrl(tab.url))) {await chrome.tabs.update(existing,{active:true});return {opened:true};}}
      if (runs[m.taskId]?.attemptId) throw Error('The original Facebook tab closed. Reopen its draft yourself and use the listing-link box after publishing; a second listing will not be created.');
      const tab=await chrome.tabs.create({url:config.fixtureOrigin?config.fixtureOrigin+'/facebook-fixture.html':'https://www.facebook.com/marketplace/create/item'});await saveRun(m.taskId,{facebookTab:tab.id,phase:'queued'});return {opened:true};
    }
    if (m.action==='fill') return fill(m.taskId,m.confirmed===true);
    if (m.action==='listingLink') {
      const {runs={}}=await chrome.storage.local.get('runs');const run=runs[m.taskId]; if (!run?.attemptId) throw Error('Start this handoff first, or save the listing link directly in Next Chapter.');
      let url=m.url;if (!url) {const tab=await chrome.tabs.get(run.facebookTab).catch(()=>null);url=tab?.url;}
      const canonical=itemUrl(url);if (!canonical) throw Error('Open the published Marketplace item in its Facebook tab, or paste the direct item link below.');
      const t=await task(m.taskId); const result=await bridge(`/api/browser-helper/tasks/${t.id}/report`,'POST',{deviceId:run.deviceId,attemptId:run.attemptId,revision:t.revision,kind:'link',url:canonical});
      await saveRun(t.id,{phase:'link_received',message:'Link sent. Confirm that it is the correct item in Next Chapter.'});return result;
    }
    throw Error('Unsupported helper action.');
  })().then(data=>reply({ok:true,data}),error=>reply({ok:false,error:error.message}));return true;
});
chrome.action.onClicked.addListener(async()=>{const {lastTask}=await chrome.storage.local.get('lastTask');await openHelper(lastTask||'');});
