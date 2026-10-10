import {useEffect,useState} from 'react';
import {api,send} from './api';
import type {EtsySetup,EtsyOption,EtsyTransfer} from '../shared/etsy';
import type {MarketplaceDraft,MarketplaceFields} from '../shared/marketplaces';

export function EtsyShopCheck(){
 const [setup,setSetup]=useState<EtsySetup|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function check(){setBusy(true);setError('');try{setSetup(await api<EtsySetup>('/marketplaces/etsy/setup'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <div className="etsy-setup"><button disabled={busy} onClick={check}>{busy?'Checking Etsy…':'Check Etsy shop setup'}</button>{error&&<p role="alert">{error}</p>}{setup&&<div role="status"><p><strong>{setup.shop?`${setup.shop.name} · ${setup.shop.currency}`:'Account linked · seller shop not ready'}</strong></p>{setup.issues.length?<ul>{setup.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>:<p>Shop settings are available. Open an item’s Etsy draft to select its profiles and prepare an unpublished test.</p>}{setup.status!=='ready'&&<a href="https://www.etsy.com/sell" target="_blank" rel="noreferrer">Continue seller setup on Etsy ↗</a>}</div>}</div>;
}
export function EtsyDraftSettings({data,edit}:{data:MarketplaceFields;edit:(field:keyof MarketplaceFields,value:unknown)=>void}){
 const [setup,setSetup]=useState<EtsySetup|null>(null),[categories,setCategories]=useState<EtsyOption[]>([]),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){setBusy(true);setError('');try{const result=await api<EtsySetup>('/marketplaces/etsy/setup');setSetup(result);if(result.shop)setCategories(await api<EtsyOption[]>('/marketplaces/etsy/categories'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const select=(label:string,name:'shopId'|'categoryId'|'shippingProfileId'|'readinessStateId'|'returnPolicyId',options:EtsyOption[])=><label className="field"><span>{label}</span><select value={data[name]} onChange={e=>edit(name,e.target.value)}><option value="">Choose {label.toLowerCase()}</option>{data[name]&&!options.some(o=>o.id===data[name])&&<option value={data[name]}>Saved choice {data[name]} · verify after loading</option>}{options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>;
 const matches=categories.filter(c=>c.label.toLowerCase().includes(search.toLowerCase())),filtered=matches.slice(0,100);
 const chosen=categories.find(c=>c.id===data.categoryId);if(chosen&&!filtered.some(c=>c.id===chosen.id))filtered.unshift(chosen);
 return <div className="evidence-box"><h4>Etsy shop settings</h4><p>Load the connected shop’s settings, then choose the category and policies for this item.</p><button type="button" disabled={busy} onClick={load}>{busy?'Loading shop settings…':'Load Etsy shop settings'}</button>{error&&<p role="alert">{error}</p>}{setup?.issues.length? <ul>{setup.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>:null}
 {select('Shop','shopId',setup?.shop?[{id:setup.shop.id,label:setup.shop.name}]:[])}
 <label className="field"><span>Filter Etsy categories</span><input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="For example: dolls or figurines"/></label>
 {matches.length>100&&<small>Showing 100 of {matches.length} categories. Type a more specific filter to find yours.</small>}{select('Category','categoryId',filtered)}{select('Shipping profile','shippingProfileId',setup?.shipping||[])}{select('Processing profile','readinessStateId',setup?.processing||[])}{select('Return policy','returnPolicyId',setup?.returns||[])}
 <small>This first transfer supports USD, fixed-price shipping, and ready-to-ship vintage items. Category-specific attributes are reviewed in Etsy before publication.</small></div>;
}
export function EtsyDraftTransfer({draft,blocked}:{draft:MarketplaceDraft;blocked:boolean}){
 const [transfer,setTransfer]=useState<EtsyTransfer|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;setLoading(true);api<EtsyTransfer|null>(`/items/${draft.itemId}/etsy-transfer`).then(t=>{if(!cancelled)setTransfer(t);}).catch(e=>{if(!cancelled)setError(e.message);}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[draft.itemId]);
 useEffect(()=>{setConfirmed(false);},[draft.version,draft.sourceVersion]);
 async function refresh(){setBusy(true);setError('');try{setTransfer(await api(`/items/${draft.itemId}/etsy-transfer`));}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function start(){setBusy(true);setError('');try{
  let current=transfer||await send(`/items/${draft.itemId}/etsy-transfer`,{version:draft.version,sourceVersion:draft.sourceVersion,confirmed:true});setTransfer(current);
  // Each request commits exactly one step. Stop on any uncertain response;
  // refreshing reads the ledger instead of repeating a creation request.
  for(let i=0;i<24&&current.state==='ready';i++){current=await send(`/items/${draft.itemId}/etsy-transfer/advance`,{});setTransfer(current);}
 }catch(e){setError(`${(e as Error).message} Check transfer status before continuing.`);}finally{setBusy(false);}}
 const changed=transfer&&(transfer.draftVersion!==draft.version||transfer.sourceVersion!==draft.sourceVersion);
 return <div className="evidence-box etsy-transfer"><h4>Send an unpublished draft to Etsy</h4><p>Creates one draft with the selected photos and item label. Buyers cannot purchase it until you review and publish it in Etsy.</p>
 {loading?<p role="status">Checking transfer status…</p>:transfer?<div aria-live="polite"><p><strong>{transfer.state==='complete'?'Draft verified in Etsy':transfer.state==='review_required'?'Needs review in Etsy':transfer.state==='running'?'Transfer step in progress':'Transfer ready to continue'}</strong> · {transfer.uploaded} / {transfer.total} photos</p><p>{transfer.message}</p>{transfer.listingId&&<p>Etsy listing ID: <strong>{transfer.listingId}</strong></p>}<a href="https://www.etsy.com/your/shops/me/tools/listings" target="_blank" rel="noreferrer">Open Etsy Shop Manager ↗</a>{changed&&<p>Local edits were made after this transfer was prepared. They have not been sent to Etsy; review the existing draft there.</p>}</div>:<label className="market-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed this saved draft and want to send its listing text, price and selected photos to the selected Etsy shop.</label>}
 {error&&<p role="alert">{error}</p>}{blocked&&<p>Save and review the item and Etsy draft, including its shop settings, before sending.</p>}
 <div className="button-row"><button type="button" className="primary" disabled={busy||loading||blocked||!!changed||(transfer?transfer.state!=='ready':!confirmed)} onClick={start}>{busy?'Transferring draft…':transfer?'Continue draft transfer':'Create unpublished Etsy draft'}</button><button type="button" disabled={busy||loading} onClick={refresh}>Check transfer status</button></div><small>Publishing, payments, and sale synchronization are not enabled here. If a response is uncertain, the transfer stops for review rather than creating another draft.</small></div>;
}
