import {describe,it,expect} from 'vitest';
import {captureDemo,demoMissing,demoTasks,emptyDemo,readDemo,stepDemo,type DemoItem,type DemoAction} from '../shared/demo';
const at='2026-09-24T00:00:00Z';
const id='123e4567-e89b-42d3-a456-426614174000';
const source={title:'Sample figurine',cover:'123e4567-e89b-42d3-a456-426614174001',observations:['Unconfirmed maker'],questions:['Check base mark']};
const step=(i:DemoItem,a:DemoAction)=>stepDemo(i,a,at);
function reviewed(method:'shipping'|'pickup'='shipping'){
 let i=captureDemo(1,source,id,at);
 i=step(i,{type:'edit',patch:{condition:'Practice wear',location:'Demo basement B2',price:25,method,description:'Practice only'}});
 return step(i,{type:'edit',patch:{reviewed:true}});
}
const listed=()=>step(reviewed(),{type:'publish'});
const sold=()=>step(listed(),{type:'sale',channel:'eBay',eventId:'sale-1'});
describe('isolated practice sale lifecycle',()=>{
 it('copies only sample clues and photo into its own identity; source stays unchanged',()=>{
  const before=structuredClone(source);const i=captureDemo(1,source,id,at);
  expect(i.code).toBe('DEMO-001');expect(i.price).toBeNull();expect(i.location).toBe('');expect(i.stage).toBe('review');
  step(i,{type:'edit',patch:{title:'Edited practice copy'}});expect(source).toEqual(before);expect(i.title).toBe(source.title);
 });
 it('blocks incomplete drafts, invalid prices and unconfirmed Etsy eligibility',()=>{
  expect(()=>step(captureDemo(1,source,id,at),{type:'publish'})).toThrow();
  expect(()=>step(reviewed(),{type:'edit',patch:{price:-10}})).toThrow();
  let i=step(reviewed(),{type:'edit',patch:{channels:['Etsy']}});i=step(i,{type:'edit',patch:{reviewed:true}});
  expect(demoMissing(i)).toContain('Confirm Etsy eligibility before selecting Etsy.');
  i=step(i,{type:'edit',patch:{eligibleEtsy:true}});expect(i.reviewed).toBe(false);
 });
 it('invalidates review after any listing changes',()=>{
  expect(step(reviewed(),{type:'edit',patch:{description:'Changed'}}).reviewed).toBe(false);
 });
 it('retries publishing without duplicate listings, and rejects publishing after a sale',()=>{
  let i=step(reviewed(),{type:'publish',failChannel:'Facebook Marketplace'});
  expect(i.listings.map(l=>l.state)).toEqual(['active','failed']);
  i=step(i,{type:'retryListing',channel:'Facebook Marketplace'});expect(i.listings).toHaveLength(2);
  expect(()=>step(i,{type:'retryListing',channel:'Facebook Marketplace'})).toThrow();
  i=step(i,{type:'sale',channel:'eBay',eventId:'sale-1'});
  expect(()=>step(i,{type:'retryListing',channel:'Facebook Marketplace'})).toThrow();
 });
 it('retains a failed notification and processes retry exactly once',()=>{
  let i=step(listed(),{type:'sale',channel:'eBay',eventId:'sale-1',fail:true});
  expect(i.stage).toBe('listed');expect(i.event?.state).toBe('pending');expect(i.tasks).toEqual({});
  expect(()=>step(i,{type:'sale',channel:'Facebook Marketplace',eventId:'sale-2'})).toThrow();
  i=step(i,{type:'retrySale'});expect(i.stage).toBe('sold');expect(i.event?.id).toBe('sale-1');
  expect(i.listings.map(l=>l.state)).toEqual(['sold','removal_needed']);
  i=step(i,{type:'task',id:'found',checked:true});i=step(i,{type:'replaySale'});
  expect(i.event?.deliveries).toBe(2);expect(i.tasks.found).toBe(true);expect(i.listings).toHaveLength(2);
  expect(()=>step(i,{type:'sale',channel:'Facebook Marketplace',eventId:'sale-2'})).toThrow();
 });
 it('does not sell failed listings or mutate a draft from an early event',()=>{
  const i=step(reviewed(),{type:'publish',failChannel:'eBay'});
  expect(()=>step(i,{type:'sale',channel:'eBay',eventId:'sale-1'})).toThrow();
  expect(()=>step(reviewed(),{type:'sale',channel:'eBay',eventId:'sale-1'})).toThrow();
 });
 for(const method of ['shipping','pickup'] as const)it(`completes ${method} only after checklist, notes and removal`,()=>{
  let i=step(step(reviewed(method),{type:'publish'}),{type:'sale',channel:'eBay',eventId:'sale-1'});
  expect(()=>step(i,{type:'complete'})).toThrow();
  for(const t of demoTasks(method))i=step(i,{type:'task',id:t.id,checked:true});
  i=step(i,{type:'arrangement',value:method==='shipping'?'Practice box: 10x10x12 in, 2 lb':'Practice pickup: Saturday 10 am'});
  i=step(i,{type:'remove',channel:'Facebook Marketplace',fail:true});
  expect(i.listings[1].state).toBe('removal_needed');expect(()=>step(i,{type:'complete'})).toThrow();
  i=step(i,{type:'remove',channel:'Facebook Marketplace'});i=step(i,{type:'complete'});
  expect(i.stage).toBe('complete');expect(step(i,{type:'replaySale'}).stage).toBe('complete');
  expect(()=>step(i,{type:'edit',patch:{price:30}})).toThrow();
 });
 it('round-trips progress and rejects corrupted storage without silently replacing it',()=>{
  const s={...emptyDemo(),revision:4,nextLabel:2,items:[sold()]};expect(readDemo(JSON.stringify(s))).toEqual(s);
  expect(readDemo(null)).toEqual(emptyDemo());expect(()=>readDemo('{bad')).toThrow();expect(()=>readDemo('{"version":9}')).toThrow();
 });
 it('caps diagnostic history while preserving sale and task state',()=>{
  let i=sold();for(let n=0;n<110;n++)i=step(i,{type:'replaySale'});
  expect(i.history).toHaveLength(100);expect(i.event?.deliveries).toBe(111);expect(i.stage).toBe('sold');
 });
});
