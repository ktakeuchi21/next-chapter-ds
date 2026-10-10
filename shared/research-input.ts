import type {Item} from './domain';

// A tracking label is not a clue about what the photographed object is.
export function researchName(item:Pick<Item,'title'|'code'>):string {
 const title=item.title.trim();
 return title===`Item ${item.code}`||/^(unknown|unidentified|new item|unknown item|unidentified item)$/i.test(title)?'':title;
}
export function researchContext(item:Item){
 return {salePreference:item.fulfillment,title:researchName(item)||null,condition:item.condition,measurements:item.measurements,observations:item.observations,identification:item.identification,researchNotes:item.researchNotes,valueEstimate:item.valueEstimate};
}
