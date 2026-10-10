import {FacebookHandoff} from './BrowserHelper';
import {orderedPhotoIds,photoUrl} from '../shared/photos';
import {useEffect,useRef,useState} from 'react';
import {send,ApiError} from './api';
import type {Detail,Item} from '../shared/domain';
import {pickupFormSchema,preparePickup,pickupSource,pickupReadiness,pickupStage,pickupReply,activeFacebook,type PickupForm,type PickupInput} from '../shared/pickup';
import './pickup.css';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function localTime(value:string){if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function LocalPickup({detail,disabled,onChanged,onDirty,onDetails}:{detail:Detail;disabled:boolean;onChanged:()=>Promise<void>;onDirty:(dirty:boolean)=>void;onDetails:()=>void}){
 const {item,media,listings}=detail;
 const initial=()=>item.pickup?pickupFormSchema.parse(item.pickup):preparePickup(item,media);
 const [form,setForm]=useState<PickupForm>(initial),[base,setBase]=useState<PickupForm>(initial),[baseItem,setBaseItem]=useState(item),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[url,setUrl]=useState(activeFacebook(listings)?.url||''),[published,setPublished]=useState(false),[collected,setCollected]=useState(false),[paid,setPaid]=useState(false),[reply,setReply]=useState('');
 const dirty=!same(form,base),dirtyRef=useRef(dirty);dirtyRef.current=dirty;
 const changedElsewhere=!same(item.pickup,baseItem.pickup);
 useEffect(()=>{if(item.version===baseItem.version)return;if(!dirty){const next=item.pickup?pickupFormSchema.parse(item.pickup):preparePickup(item,media);setForm(next);setBase(next);setBaseItem(item);}else if(!changedElsewhere)setBaseItem(item);},[item.version]);
 useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty]);
 useEffect(()=>{const guard=(e:BeforeUnloadEvent)=>{if(dirtyRef.current)e.preventDefault();};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[]);
 function edit<K extends keyof PickupForm>(key:K,value:PickupForm[K]){setForm(f=>({...f,[key]:value}));setNotice('');setPublished(false);}
 async function copy(text:string,label:string){try{await navigator.clipboard.writeText(text);setNotice(label+' copied.');}catch{setError('Copy was blocked by this browser. Select and copy the text shown instead.');}}
 async function run(action:PickupInput['action']){
  setBusy(true);setError('');setNotice('');
  try{
   const updated:Item=await send(`/items/${item.id}/pickup`,{version:baseItem.version,action,form,...(action==='listed'?{url,confirmed:published}:{}),...(action==='collect'?{confirmed:collected,paymentConfirmed:paid}:{}),...(action==='no_show'?{confirmed:true}:{})});
   const next=pickupFormSchema.parse(updated.pickup||{});setForm(next);setBase(next);setBaseItem(updated);setPublished(false);setCollected(false);setPaid(false);setReply('');await onChanged();
   setNotice(({save:'Pickup details saved.',listed:'Listing link saved. Facebook remains manually managed.',arrange:'Pickup saved. Mark the Facebook listing pending.',no_show:'Available again in Next Chapter. Update Facebook too.',collect:'Collection recorded. End the listings below.',complete:'Pickup completed.'})[action]);
  }catch(e){setError((e as Error).message);if(e instanceof ApiError&&e.status===409)await onChanged();}finally{setBusy(false);}
 }
 const locked=disabled||busy||changedElsewhere,done=!!item.pickup?.collectedAt,unavailable=['archived','fulfilled'].includes(item.status);
 const missing=pickupReadiness(item,form,media),link=activeFacebook(listings),photos=media.filter(m=>m.kind==='photo');
 return <section className="pickup-workflow" aria-label="Facebook local pickup">
  <div className="section-head"><div><span className="tiny-label">LOCAL PICKUP</span><h2>From listing to collection.</h2></div><span className="badge">{pickupStage(item)}</span></div>
  <p>Prepare here, post on Facebook, then keep the pickup together with the item. The Chrome helper can fill the listing; publishing, messages and Facebook status changes stay with you.</p>
  {disabled&&<p className="soft-note">Save your item details before updating pickup.</p>}
  {error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="soft-note" role="status">{notice}</p>}
  {changedElsewhere&&<div className="error" role="alert"><div><p>Pickup details changed in another session. Your unsaved text is still below. Copy anything you need before loading the saved version.</p><button disabled={busy} onClick={()=>{if(!dirty||confirm('Replace your unsaved pickup edits with the latest saved pickup details?')){const next=pickupFormSchema.parse(item.pickup||{});setForm(next);setBase(next);setBaseItem(item);setError('');}}}>Load saved pickup details</button></div></div>}
  {!done&&!unavailable&&<>
   <details open={!['listed','reserved','sold'].includes(item.status)} className="pickup-step"><summary>1. Prepare the public listing</summary>
    <p><strong>General area:</strong> {item.pickupArea||'Not set'} · <strong>Collect by:</strong> {item.clearBy||'Not set'}</p><p>{item.loadingNotes||'Add stairs, disassembly or help needed in Details.'}</p><button className="small" onClick={onDetails}>Edit pickup facts in Details</button>
    <fieldset disabled={locked}>
     <div className="button-row"><button onClick={()=>{if(!form.description||confirm('Replace the draft text and photo selection using the saved item details?')){setForm(preparePickup({...item,pickup:{...item.pickup,...form}},media));setPublished(false);}}}>Prepare from saved details</button></div>
     <label className="field"><span>Facebook title</span><input maxLength={160} value={form.title} onChange={e=>edit('title',e.target.value)}/></label>
     <label className="field"><span>Public description</span><textarea rows={7} maxLength={10000} value={form.description} onChange={e=>edit('description',e.target.value)}/><small>Review before posting. Leave out exact addresses, client names and private notes.</small></label>
     <p><strong>Asking price:</strong> {item.price===null?'Set in Details':`$${item.price.toFixed(2)}`}</p>
     {form.preparedFrom!==pickupSource(item)&&<div className="soft-note"><p>The saved item details changed since this draft was prepared.</p><button onClick={()=>edit('preparedFrom',pickupSource(item))}>I reviewed the draft against the current details</button></div>}
     <p>Select listing photos ({form.photoIds.length}/20). Photos use the saved order and rotation. Download the selected photos to upload on Facebook. Check backgrounds for personal details.</p>
     <div className="pickup-photos">{photos.map((m,i)=><div key={m.id}><label><input type="checkbox" checked={form.photoIds.includes(m.id)} disabled={!form.photoIds.includes(m.id)&&form.photoIds.length>=20} onChange={e=>edit('photoIds',orderedPhotoIds(e.target.checked?[...form.photoIds,m.id]:form.photoIds.filter(id=>id!==m.id),media))}/><img src={photoUrl(m,true)} alt={`Listing photo ${i+1}`}/><span>Photo {i+1}</span></label>{form.photoIds.includes(m.id)&&<a href={photoUrl(m)} download={`${item.code}-${String(i+1).padStart(2,'0')}.${m.mime==='image/png'?'png':m.mime==='image/webp'?'webp':'jpg'}`}>Download photo {i+1}</a>}</div>)}</div>
     <div className="button-row"><button className="primary" onClick={()=>run('save')}>{busy?'Saving…':'Save pickup draft'}</button><button disabled={!form.title} onClick={()=>copy(form.title,'Title')}>Copy title</button><button disabled={!form.description} onClick={()=>copy(form.description,'Description')}>Copy description</button></div>
    </fieldset>
   </details>
   {!['reserved','sold'].includes(item.status)&&<details className="pickup-step" open={item.status!=='listed'}><summary>2. Post and save the Facebook link</summary>
    <FacebookHandoff detail={detail} disabled={locked||dirty} missing={missing} onChanged={onChanged}/><p>For manual posting, copy the draft and upload the selected photos. Choose local pickup on Facebook, then save its published link here.</p>
    <a className="button" href="https://www.facebook.com/marketplace/create/item" target="_blank" rel="noreferrer">Open Facebook listing form</a>
    {missing.length>0&&<div className="readiness"><strong>Before recording publication</strong><ul>{missing.map(m=><li key={m}>{m}</li>)}</ul></div>}
    <fieldset disabled={locked}>
     <label className="field"><span>Published Facebook item link</span><input type="url" value={url} onChange={e=>{setUrl(e.target.value);setPublished(false);}} placeholder="https://www.facebook.com/marketplace/item/…"/></label>
     <label className="pickup-check"><input type="checkbox" checked={published} onChange={e=>setPublished(e.target.checked)}/><span>I published and checked this listing on Facebook.</span></label>
     <button className="primary" disabled={!published||!!missing.length} onClick={()=>run('listed')}>Save link & mark listed</button>
    </fieldset>
   </details>}
   {['listed','reserved','sold'].includes(item.status)&&<div className="pickup-step"><h3>3. Arrange the handoff</h3>
    <p><strong>Find it:</strong> {item.code} · {item.location||'Location needed'}</p>{item.clearBy&&<p><strong>Collection deadline:</strong> {item.clearBy}</p>}
    {link&&<a href={link.url} target="_blank" rel="noreferrer">Open the Facebook listing</a>}
    <fieldset disabled={locked}>
     <label className="field"><span>Buyer name or reference · private</span><input maxLength={160} value={form.buyer} onChange={e=>edit('buyer',e.target.value)}/></label>
     <div className="form-grid"><label className="field"><span>Agreed pickup time</span><input type="datetime-local" value={localTime(form.scheduledAt)} onInput={e=>{const value=e.currentTarget.value;edit('scheduledAt',value&&Number.isFinite(new Date(value).getTime())?new Date(value).toISOString():'');}}/><small>Shown in this device’s timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</small></label><label className="field"><span>Agreed price (USD)</span><input type="number" min="0" max="1000000" step="0.01" value={form.agreedPrice??''} onChange={e=>edit('agreedPrice',e.target.value===''?null:Number(e.target.value))}/></label></div>
     <label className="field"><span>Private pickup instructions</span><textarea rows={3} maxLength={3000} value={form.instructions} onChange={e=>edit('instructions',e.target.value)}/><small>Only included in a pickup reply when you explicitly prepare and copy one. Never added to the public listing.</small></label>
     <div className="button-row"><button onClick={()=>run('save')}>Save arrangements</button>{item.status!=='sold'&&<button className="primary" onClick={()=>run('arrange')}>{item.status==='reserved'?'Update arranged pickup':'Confirm pickup arranged'}</button>}{item.status==='reserved'&&<button onClick={()=>{if(confirm('Clear this buyer and pickup arrangement? This does not refund payments or update Facebook.'))run('no_show');}}>Buyer didn’t show / cancel pickup</button>}</div>
     {item.status==='reserved'&&<p className="soft-note">Mark the listing pending on Facebook. A promise to collect is not a completed sale.</p>}
     <div className="pickup-replies"><h4>Reply helpers</h4><p>Review the text, then copy it into Messenger yourself.</p><div className="button-row">{(['availability','measurements','pickup'] as const).map(kind=><button key={kind} onClick={()=>setReply(pickupReply({...item,pickup:{...item.pickup,...form}},kind))}>{kind==='availability'?'Availability reply':kind==='measurements'?'Measurements reply':'Pickup instructions'}</button>)}</div>{reply&&<><label className="field"><span>Message to review</span><textarea rows={5} value={reply} onChange={e=>setReply(e.target.value)}/></label><button onClick={()=>copy(reply,'Reply')}>Copy reviewed reply</button></>}</div>
     <h4>When they collect it</h4><label className="pickup-check"><input type="checkbox" checked={collected} onChange={e=>setCollected(e.target.checked)}/><span>The buyer has collected the item.</span></label><label className="pickup-check"><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/><span>Payment is received, or this was an agreed free handoff.</span></label><button className="primary" disabled={!collected||!paid||form.agreedPrice===null} onClick={()=>run('collect')}>Record collection & payment</button>
    </fieldset>
   </div>}
  </>}
  {done&&<div className="pickup-step"><h3>{item.status==='fulfilled'?'Pickup completed':'4. Close the listings'}</h3><p>Collected {new Date(item.pickup!.collectedAt!).toLocaleString()} · ${item.pickup!.agreedPrice?.toFixed(2)} · Payment confirmed.</p>{item.status!=='fulfilled'&&<><p>Mark Facebook sold and end any other marketplace listings. Confirm each removal in “Where it’s listed” below.</p><button className="primary" disabled={locked||listings.some(l=>l.state!=='removed')} onClick={()=>run('complete')}>Complete pickup</button></>}</div>}
 </section>;
}
