import {describe,it,expect} from 'vitest';
import {itemFields,makeDraft,combinedValueEstimate} from '../shared/domain';
import {extractedNotes,preserveEstimateQuote,canonicalNoteField} from '../shared/intake';
import {itemFrom} from '../server/db';
describe('one Seller / client estimate',()=>{
 it('keeps the starting estimate separate from asking price and listing drafts',()=>{
  const fields=itemFields.parse({title:'Vase',price:45,valueEstimate:'USD 40–60, from a similar sale'});
  expect(fields.price).toBe(45);expect(JSON.stringify(makeDraft(fields))).not.toContain('40–60');
 });
 it('reads older items with a blank estimate',()=>{expect(itemFrom({data:'{}',id:'old'}).valueEstimate).toBe('');});
 it('preserves both legacy entries in one editable field',()=>{
  const legacy={sellerValueEstimate:'USD 50',clientValueEstimate:'USD 100'};
  expect(combinedValueEstimate(legacy)).toBe('Seller: USD 50\nClient: USD 100');
  const converted=itemFields.parse(itemFrom({id:'old',data:JSON.stringify(legacy)}));
  expect(converted.valueEstimate).toContain('USD 50');expect(converted.valueEstimate).toContain('USD 100');expect(converted).not.toHaveProperty('sellerValueEstimate');
 });
 it('respects an explicitly cleared or edited combined value',()=>{
  expect(combinedValueEstimate({valueEstimate:'',sellerValueEstimate:'USD 50'})).toBe('');
  expect(combinedValueEstimate({valueEstimate:'USD 70',clientValueEstimate:'USD 100'})).toBe('USD 70');
 });
 it('maps pending legacy suggestions to the combined field',()=>{expect(canonicalNoteField('sellerValueEstimate')).toBe('valueEstimate');expect(canonicalNoteField('clientValueEstimate')).toBe('valueEstimate');});
 it('accepts an unnamed first-person estimate without guessing who said it',()=>{
  const quote='I think it might be worth 90 dollars.';
  const n=extractedNotes.parse({notes:[{itemId:'item',field:'valueEstimate',value:'Client thinks USD 90',quote,confidence:'clear'}]}).notes[0];
  expect(preserveEstimateQuote(n)).toMatchObject({field:'valueEstimate',value:quote});
  expect(()=>extractedNotes.parse({notes:[{...n,field:'price'}]})).toThrow();
 });
 it('retains a reason alongside the estimate',()=>{
  const transcript='I think 50 dollars based on a similar sale.';
  const result=preserveEstimateQuote({itemId:'item',field:'valueEstimate',value:'50 dollars',quote:'I think 50 dollars',confidence:'clear'},transcript);
  expect(result.value).toBe(transcript);expect(result.quote).toBe(transcript);
 });
});
