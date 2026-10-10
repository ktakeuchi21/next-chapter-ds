// The build embeds the public configuration above this script.
const $=id=>document.getElementById(id);let taskId=new URLSearchParams(location.search).get('task'),state,busy=false;
async function send(action,extra={}) {const r=await chrome.runtime.sendMessage({type:'NC_PANEL_V1',action,taskId,...extra});if(!r?.ok)throw Error(r?.error||'The helper stopped responding. Refresh saved progress before continuing.');return r.data;}
function error(message){$('error').hidden=!message;$('error').textContent=message;}
const friendly={form_changed:'Facebook’s form looks different. Use the manual steps below.',occupied:'The form already has content. Inspect it before changing anything.',readback_mismatch:'Facebook did not keep one of the fields. Review its form.',interrupted:'Preparation was interrupted. Check the existing draft before doing anything else.',upload_uncertain:'Check Facebook’s photo previews. Photos may already have been uploaded.',login_required:'Sign into Facebook yourself, then finish the draft.',challenge:'Facebook needs you to complete a check. Follow its instructions.',photo_limit:'Review and upload the selected photos manually.',adapter_error:'Preparation stopped. Review the existing Facebook draft.'};
function render(){const t=state?.task;$('empty').hidden=!!t;$('item').hidden=!t;if(!t){$('status').textContent='Choose an item to begin.';return;}taskId=t.id;const run=state.runs?.[t.id];$('code').textContent=t.payload.code;$('stage').textContent=({queued:'Ready to prepare',preparing:'Preparation started',prepared:'Review on Facebook',attention:'Needs attention',link_received:'Confirm in Next Chapter',complete:'Listing linked',cancelled:'Cancelled'})[t.state];$('title').textContent=t.payload.fields.title;$('price').textContent='$'+t.payload.fields.price;$('area').textContent=t.payload.fields.pickupArea;$('photos').textContent=t.payload.photos.length+' selected photos';$('description').textContent=t.payload.fields.description;
$('status').textContent=t.state==='complete'?'The listing is linked to this item.':t.state==='link_received'?'Link received. Return to Next Chapter and confirm the correct item.':t.state==='cancelled'?'This task was cancelled. Any Facebook draft still needs your review.':t.stale?'Item details changed. Return to Next Chapter to review the saved draft.':friendly[t.reason]||(t.state==='preparing'&&!state.running?'Preparation was interrupted. Inspect the existing Facebook draft; finish manually to avoid repeating an upload.':run?.message)||'Your saved draft is ready.';
$('fill').disabled=busy||state.running||t.stale||t.state!=='queued'||!!run?.attemptId||!$('confirmed').checked;
$('open-form').disabled=busy||['complete','cancelled'].includes(t.state);$('capture').disabled=$('send-link').disabled=busy||!run?.attemptId||['complete','cancelled'].includes(t.state);$('return').href=(state.pair?.origin||config.appOrigins[0])+'/#item/'+t.itemId;
}
async function refresh(){try{state=await send('state');render();}catch(e){state=null;render();error(e.message);$('status').textContent='Your item remains saved in Next Chapter.';}}
async function action(fn){if(busy)return;busy=true;error('');render();try{await fn();}catch(e){error(friendly[e.message]||e.message);}finally{busy=false;await refresh();}}
$('open-app').onclick=()=>action(()=>send('openApp'));
$('refresh').onclick=()=>{error('');void refresh();};$('confirmed').onchange=render;
$('open-form').onclick=()=>action(async()=>{
 // A user gesture grants access to Facebook only, never arbitrary websites.
 const origins=config.fixtureOrigin?[config.fixtureOrigin+'/*']:['https://www.facebook.com/*'];
 const granted=await chrome.permissions.request({origins});if(!granted)throw Error('Facebook access was not enabled. You can still use the copy buttons and manual posting in the app.');await send('openForm');
});
$('fill').onclick=()=>action(()=>send('fill',{confirmed:$('confirmed').checked}));
$('capture').onclick=()=>action(()=>send('listingLink'));
$('send-link').onclick=()=>action(()=>send('listingLink',{url:$('link').value.trim()}));
for(const key of ['title','price','description'])$('copy-'+key).onclick=()=>action(async()=>{await navigator.clipboard.writeText(state.task.payload.fields[key]);$('status').textContent='Copied.';});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.runs){if(state){state.runs=changes.runs.newValue;render();}}});
window.addEventListener('focus',()=>{if(!busy)void refresh();});void refresh();
