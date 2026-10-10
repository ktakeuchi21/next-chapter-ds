import {makeDraft,type Item,type Research,type Fields} from './domain';
import {researchName} from './research-input';
export function researchFacts(item:Pick<Fields,'condition'|'measurements'|'researchNotes'|'observations'|'identification'>){return JSON.stringify([item.condition,item.measurements,item.researchNotes,item.observations,item.identification]);}
export function researchIsStale(item:Item,report:Research){return !!report.inputFacts&&report.inputFacts!==researchFacts(item);}
// Old reports remain useful: build only from their identity and the user's facts.
export function listingProposal(item:Item,report:Research){
 const stale=researchIsStale(item,report);
 const title=(report.listing?.title||report.identity?.name||researchName(item)||'').slice(0,160);
 const fulfillment=item.fulfillment!=='undecided'?item.fulfillment:report.pricing?.channel==='online_shipping'?'shipping':'pickup';
 const description=!stale&&report.listing?.description?report.listing.description:makeDraft({...item,title,fulfillment}).description;
 return {title,draftTitle:title,draftDescription:description,price:item.price??report.pricing?.quickSale??null,fulfillment,draftResearchAt:report.researchedAt} satisfies Partial<Fields>;
}
export function initialProposal(item:Item,report:Research|null):Partial<Fields>|null{
 if(!report||!['intake','review','ready'].includes(item.status)||item.draftTitle||item.draftDescription||item.draftResearchAt)return null;
 const proposed=listingProposal(item,report);
 // Keep an existing human name. Suggested replacement remains an explicit choice.
 if(researchName(item)){proposed.title=item.title;proposed.draftTitle=item.title;}
 return proposed;
}
