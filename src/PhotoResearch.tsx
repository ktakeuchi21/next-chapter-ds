import {AlertCircle,LoaderCircle,Sparkles} from 'lucide-react';
import type {Detail} from '../shared/domain';
import {ResearchSummary} from './ResearchSummary';

type Props={detail:Detail;aiConnected:boolean;busy:boolean;dirty:boolean;conflicted:boolean;pickupDirty:boolean;onResearch:()=>void;onReview:()=>void;onUsePrice?:(price:number)=>void};
export function PhotoResearch({detail,aiConnected,busy,dirty,conflicted,pickupDirty,onResearch,onReview,onUsePrice}:Props){
 const researchJob=detail.jobs.find(j=>j.kind==='research');
 const researching=researchJob&&['queued','running'].includes(researchJob.state);
 const otherTask=detail.jobs.some(j=>['queued','running'].includes(j.state));
 const failed=researchJob?.state==='failed';
 const hasPhoto=detail.media.some(m=>m.kind==='photo');
 const blocked=!aiConnected||!hasPhoto||otherTask||conflicted||pickupDirty;
 const help=!hasPhoto?'Add a JPG, PNG or WebP photo to begin. Videos and voice notes can stay with the item, but research needs a still photo.':!aiConnected?'Connect OpenAI in Connections to identify this item. Your photos are saved.':conflicted?'Resolve the competing edits below before researching.':pickupDirty?'Save your pickup changes in Selling before researching.':otherTask&&!researching?'Your voice note or another task is still processing. Identification will be available when it finishes.':'';
 return <section className="photo-research" aria-label="Photo identification">
  <div className="photo-research-intro"><Sparkles size={24} aria-hidden="true"/><div>
   <span className="tiny-label">FROM PHOTO TO LISTING</span>
   <h2>{researching?'Identifying your item…':failed?'Research needs another try':detail.research?'Your research is ready':'Not sure what this is?'}</h2>
   <p>{researching?'AI is examining the photos and searching for matches and price evidence. This can take a few minutes. You can leave this page and come back.':detail.research&&!failed?'Review the likely identity and suggested price below. Check the assumptions before using it.':'Start with just a photo. AI will look for what it is, comparable prices and where to sell it. A name and notes are optional.'}</p>
  </div></div>
  {researching&&<p className="research-progress" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true"/>{researchJob.state==='queued'?'Research is queued.':'Looking at photos and checking sources…'}</p>}
  {failed&&!researching&&<p className="error" role="alert"><AlertCircle size={18} aria-hidden="true"/>{researchJob.error||'The last attempt did not finish. Your photos are saved; you can try again.'}</p>}
  {help&&<p id="photo-research-help" className="research-help">{help}</p>}
  {detail.research&&!researching&&onUsePrice&&<ResearchSummary research={detail.research} disabled={busy||pickupDirty||conflicted} onUsePrice={onUsePrice}/>}
  <div className="button-row">
   {!researching&&<button className="primary" disabled={busy||blocked} aria-describedby={help?'photo-research-help':undefined} onClick={onResearch}><Sparkles size={18} aria-hidden="true"/>{busy?'Please wait…':dirty?'Save & identify from photos':failed?'Try photo research again':detail.research?'Research photos again':'Identify from photos'}</button>}
   {detail.research&&<button disabled={pickupDirty} onClick={onReview}>View research history</button>}
  </div>
  {!researching&&!detail.research&&<small>Possible matches stay separate from confirmed details. If the evidence is thin, AI will suggest what to photograph next.</small>}
 </section>;
}
