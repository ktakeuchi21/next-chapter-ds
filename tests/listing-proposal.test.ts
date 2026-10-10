import {describe,it,expect} from 'vitest';
import {itemFields,type Item,type Research,type Media} from '../shared/domain';
import {initialProposal,listingProposal,researchFacts,researchIsStale} from '../shared/listing-proposal';
import {seedMarketplace} from '../shared/marketplaces';
import {preparePickup,pickupSource,pickupReadiness} from '../shared/pickup';
const item={...itemFields.parse({title:'Item DEMO-002',condition:'about three years old, used maybe 10 times',owner:'PRIVATE OWNER',location:'PRIVATE ADDRESS',notes:'PRIVATE NOTES',valueEstimate:'PRIVATE ESTIMATE'}),id:'test',code:'DEMO-002',status:'intake',version:1} as Item;
const report:Research={text:'Research',sources:[],researchedAt:'2026-09-27T12:00:00.000Z',identity:{name:'Instant Pot Duo',confidence:'medium',evidence:'Duo is on the panel.',nextPhotos:[]},listing:{title:'Instant Pot Duo',description:'Instant Pot Duo. About three years old, used maybe 10 times. Please review the photos.',checks:['Check the capacity and test it before posting.']},pricing:{currency:'USD',low:20,high:60,suggested:45,quickSale:30,confidence:'low',basis:'category_estimate',reason:'Provisional family estimate.',assumptions:['Working condition unknown.'],sourceUrls:[],channel:'local_pickup'}};
describe('photo-to-listing proposal',()=>{
 it('proposes name, buyer wording, clearance price and pickup together without changing the saved item',()=>{
  const p=initialProposal(item,report)!;expect(p).toMatchObject({title:'Instant Pot Duo',draftTitle:'Instant Pot Duo',draftDescription:report.listing!.description,price:30,fulfillment:'pickup',draftResearchAt:report.researchedAt});expect(item.title).toBe('Item DEMO-002');expect(JSON.stringify(p)).not.toContain('PRIVATE');
 });
 it('preserves an existing asking price, human name and fulfillment preference',()=>{expect(initialProposal({...item,title:'My cooker',price:49,fulfillment:'shipping'},report)).toMatchObject({title:'My cooker',draftTitle:'My cooker',price:49,fulfillment:'shipping'});});
 it('never automatically replaces saved or unsaved listing text on a re-run',()=>{for(const existing of [{draftDescription:'Custom wording'},{draftTitle:'Custom title'},{draftResearchAt:report.researchedAt}])expect(initialProposal({...item,...existing},report)).toBeNull();for(const status of ['listed','reserved','sold','fulfilled','archived'] as const)expect(initialProposal({...item,status},report)).toBeNull();});
 it('uses the current condition with old reports that have no generated listing',()=>{const p=listingProposal(item,{...report,listing:undefined});expect(p.draftDescription).toContain('used maybe 10 times');expect(p.title).toBe('Instant Pot Duo');expect(JSON.stringify(p)).not.toContain('PRIVATE');});
 it('does not reuse a stale description when newer notes contradict the research input',()=>{const old={...report,inputFacts:researchFacts(item)};const updated={...item,condition:'Does not turn on'};expect(researchIsStale(updated,old)).toBe(true);expect(listingProposal(updated,old).draftDescription).toContain('Does not turn on');expect(listingProposal(updated,old).draftDescription).not.toContain('used maybe 10 times');});
 it('never invents a price when the research could not recognize the item',()=>{expect(listingProposal(item,{...report,pricing:null}).price).toBeNull();});
 it('carries approved wording to Facebook and makes existing pickup drafts stale when it changes',()=>{
  const prepared={...item,...listingProposal(item,report),owner:'Estate',location:'Bin A',availability:'available',pickupArea:'Salt Lake City'} as Item;
  const media=[{id:'f38ab8ae-0146-4bfa-9a40-760f451a9775',kind:'photo'}] as Media[];
  expect(seedMarketplace(prepared,media)).toMatchObject({title:'Instant Pot Duo',description:report.listing!.description,price:30});
  const pickup=preparePickup(prepared,media);expect(pickup.title).toBe('Instant Pot Duo');expect(pickup.description).toContain(report.listing!.description);expect(pickup.description).toContain('Salt Lake City');expect(pickup.description).not.toContain('PRIVATE');
  const revised={...prepared,draftDescription:'Revised wording'};expect(pickupSource(revised)).not.toBe(pickupSource(prepared));expect(pickupReadiness(revised,pickup,media)).toContain('Prepare or review the draft after the item details changed');
 });
});
