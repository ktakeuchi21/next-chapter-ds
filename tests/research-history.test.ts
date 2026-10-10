import {describe,it,expect} from 'vitest';
import {parseSavedResearch} from '../shared/research-history';
describe('saved research reports',()=>{
 it('reads historical reports without requiring the newest structured format',()=>{
  const report={text:'Earlier research recommended $25.',sources:[{title:'Earlier comparison',url:'https://example.com/old'}],researchedAt:'2026-09-21T12:00:00.000Z'};
  expect(parseSavedResearch(JSON.stringify(report))).toEqual(report);
 });
 it('handles unavailable or damaged reports without inventing replacement results',()=>{
  for(const raw of [null,'','{broken','null','{}',JSON.stringify({text:42,sources:[],researchedAt:'today'})])expect(parseSavedResearch(raw)).toBeNull();
 });
 it('preserves research text while excluding unsafe source links',()=>{
  const result=parseSavedResearch(JSON.stringify({text:'An old report',researchedAt:'2026-09-21',sources:[{title:'Unsafe',url:'javascript:alert(1)'},{title:'Safe',url:'https://example.com/item'}]}));
  expect(result?.text).toBe('An old report');expect(result?.sources).toEqual([{title:'Safe',url:'https://example.com/item'}]);
 });
});
