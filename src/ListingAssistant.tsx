import {Sparkles,LoaderCircle,ArrowRight} from 'lucide-react';
import type {Detail,Fields,Item} from '../shared/domain';
import {money,priceBasisLabels} from '../shared/pricing';
import {researchIsStale} from '../shared/listing-proposal';

type Props={pendingNotes:number;detail:Detail;form:Item;busy:boolean;dirty:boolean;blocked:boolean;aiConnected:boolean;update:(key:keyof Fields,value:unknown)=>void;onResearch:()=>void;onSuggestions:()=>void;onSave:()=>void;onHistory:()=>void};
export function ListingAssistant({pendingNotes,detail,form,busy,dirty,blocked,aiConnected,update,onResearch,onSuggestions,onSave,onHistory}:Props){
 const report=detail.research,price=report?.pricing;
 const active=detail.jobs.find(j=>['queued','running'].includes(j.state));
 const failed=detail.jobs.find(j=>j.kind==='research')?.state==='failed';
 const hasPhoto=detail.media.some(m=>m.kind==='photo');
 const hasDraft=!!(form.draftTitle||form.draftDescription);
 const stale=report&&researchIsStale(form,report);
 const canResearch=aiConnected&&hasPhoto&&!active&&!busy&&!blocked&&!pendingNotes;
 const researchLabel=hasDraft?'Update from photos & notes':'Create listing draft';
 return <section className="listing-assistant" aria-label="Prepare a listing">
  <div className="section-intro"><span className="eyebrow">PHOTOS → DRAFT → SELL</span><h2>{hasDraft?'Your listing, ready to review.':'Let’s turn this into a listing.'}</h2><p>{hasDraft?'Review the name, wording and price. Save them together, then choose where to post.':'Add photos and say what you know. We’ll suggest a name, a description and a price for you.'}</p></div>
  {active?<div className="draft-progress" role="status"><LoaderCircle size={20} className="spin" aria-hidden="true"/><div><strong>{active.kind==='research'?'Identifying, pricing and writing your draft…':'Preparing your voice-note details…'}</strong><p>{active.kind==='research'?'You can leave this page. The results will be here when you come back.':'Review the notes above when they’re ready, then create the listing draft.'}</p></div></div>:null}
  {pendingNotes>0&&<p className="draft-check-reminder">Review the voice notes above to include them in your draft.</p>}
  {!hasDraft&&<>
   {form.condition&&<div className="draft-facts"><strong>What you told us</strong><p>{form.condition}</p></div>}
   <label className="field"><span>Anything else to include? · optional</span><textarea rows={2} maxLength={6000} value={form.researchNotes} onChange={e=>update('researchNotes',e.target.value)} placeholder="e.g. About three years old, used maybe 10 times"/><small>Or record a voice note. Keep names and addresses out of these research notes.</small></label>
   <button className="primary" disabled={!canResearch} onClick={onResearch}><Sparkles size={18} aria-hidden="true"/>{busy?'Please wait…':researchLabel}</button>
   {!hasPhoto&&<p>Add at least one photo to get started. A name is optional.</p>}
   {!aiConnected&&<p>AI is not connected. Your photos and notes stay saved.</p>}
  </>}
  {failed&&!active&&<p className="error" role="alert">{detail.jobs.find(j=>j.kind==='research')?.error||'Research did not finish. Your photos and notes are saved.'}{!hasDraft&&' Use Create listing draft to try again.'}</p>}
  {hasDraft&&<>
   {report&&form.draftResearchAt!==report.researchedAt&&<div className="soft-note"><p>New research is ready. Review its suggested name and description before replacing your draft.</p><button disabled={busy||blocked||!!active} onClick={onSuggestions}>Review latest suggestions</button></div>}
   {stale&&<p className="soft-note">Your notes changed after this research. Update from photos &amp; notes to use them in a new proposal.</p>}
   <fieldset disabled={busy||blocked}>
    <label className="field"><span>Item name &amp; listing title</span><input maxLength={160} value={form.draftTitle} onChange={e=>{update('title',e.target.value);update('draftTitle',e.target.value);}}/><small>Editing this title also updates the item name when saved. The label stays {form.code}.</small></label>
    <label className="field"><span>Description for buyers</span><textarea rows={5} maxLength={10000} value={form.draftDescription} onChange={e=>update('draftDescription',e.target.value)}/></label>
    <div className="draft-pricing"><h3>Choose your price</h3>
     {price&&<><p><strong>{money(price.low)}–{money(price.high)}</strong> suggested range · {price.basis==='category_estimate'?'broad AI estimate, no priced comparisons':priceBasisLabels[price.basis]}</p><div className="price-choices" role="group" aria-label="Price strategy">
      <label className={form.price===price.quickSale?'selected':''}><input type="radio" name="draft-price-strategy" checked={form.price===price.quickSale} onChange={()=>update('price',price.quickSale)}/><span><strong>Sell sooner · {money(price.quickSale)}</strong><small>A lower starting price for quicker clearance</small></span></label>
      <label className={form.price===price.suggested&&price.suggested!==price.quickSale?'selected':''}><input type="radio" name="draft-price-strategy" checked={form.price===price.suggested&&price.suggested!==price.quickSale} disabled={price.suggested===price.quickSale} onChange={()=>update('price',price.suggested)}/><span><strong>Standard price · {money(price.suggested)}</strong><small>More room to negotiate</small></span></label>
     </div><small>A starting strategy, not a guaranteed sale. You can set any price below.</small></>}
     <label className="field"><span>Your asking price (USD)</span><input type="number" min="0" max="1000000" step="0.01" value={form.price??''} onChange={e=>update('price',e.target.value===''?null:Number(e.target.value))}/></label>
    </div>
    <label className="field"><span>How will the buyer get it?</span><select value={form.fulfillment} onChange={e=>update('fulfillment',e.target.value)}><option value="undecided">Decide later</option><option value="pickup">Local pickup · prepare for Facebook</option><option value="shipping">Shipping · prepare for eBay or Etsy</option></select></label>
   </fieldset>
   {report&&<details className="draft-evidence"><summary>Why this item and price?</summary>{report.identity&&<p><strong>{report.identity.name}</strong> · {report.identity.confidence} confidence<br/>{report.identity.evidence}</p>}{price&&<><p>{price.reason}</p>{price.assumptions.length>0&&<><strong>Price assumptions to check</strong><ul>{price.assumptions.map((a,i)=><li key={i}>{a}</li>)}</ul></>}</>}{report.listing?.checks.length? <><strong>Before posting</strong><ul>{report.listing.checks.map((a,i)=><li key={i}>{a}</li>)}</ul></>:null}{report.comparables?.filter(c=>c.amount!==null).map((c,i)=><p key={i}><a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> · {c.currency} {c.amount} · {c.kind==='asking'?'asking price':c.kind==='reported_sold'?'reported sale — check source':c.kind==='retail'?'new retail reference':'unconfirmed comparison'}<small>{c.differences}</small></p>)}{report.channelSuggestion&&<p>{report.channelSuggestion}</p>}<button className="subtle" onClick={onHistory}>View research history</button></details>}
   {report?.listing?.checks.length? <p className="draft-check-reminder">Check the wording against the item before posting. Any unknowns are listed under “Why this item and price?”.</p>:null}
   <div className="draft-save"><button className="primary" disabled={busy||blocked||!form.draftTitle.trim()||!form.draftDescription.trim()} onClick={onSave}>{busy?'Saving…':dirty?'Save draft & continue':'Continue to selling'}<ArrowRight size={18} aria-hidden="true"/></button><small>{dirty?'Name, description and price will be saved together.':'Your draft is saved.'} Nothing is posted yet.</small></div>
   <details className="draft-tools" open={stale||failed||undefined}><summary>Update the research or suggestions</summary><p>Research again after adding photos or changing notes. Existing wording and prices stay yours to review.</p><button disabled={!canResearch} onClick={onResearch}><Sparkles size={18} aria-hidden="true"/>{researchLabel}</button>{report&&<button disabled={busy||blocked||!!active} onClick={onSuggestions}>{form.draftResearchAt===report.researchedAt?'Review original suggestions':'Review latest suggestions'}</button>}{!aiConnected&&<p>Connect AI to run new research. Saved suggestions remain available.</p>}{report&&<button className="subtle" onClick={onHistory}>View research history</button>}</details>
  </>}
 </section>;
}
