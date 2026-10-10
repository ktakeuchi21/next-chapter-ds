import {describe,it,expect} from 'vitest';
import {buildResearch} from '../server/research-evidence';
const source={url:'https://example.com/lot',title:'Auction result'};
const evidence={observations:['Plaid dress'],candidate:'Doll maker unknown',identificationEvidence:'Box alone does not establish the doll model.',unknowns:['Height'],nextPhotos:['Maker mark'],comparables:[],estimateAssessment:null,channelSuggestion:'Consider a collector marketplace after identification.'};
const comp={title:'Comparison doll',url:source.url,kind:'reported_sold',amount:100,currency:'USD',saleDate:'2025-01-01',match:'same_model',evidence:'The auction result records a completed sale.',differences:'Condition requires comparison.'};
describe('research pricing evidence',()=>{
 it('keeps appraisals and asking prices out of the sale range',()=>{const r=buildResearch(JSON.stringify({...evidence,comparables:[{...comp,kind:'appraisal',amount:999},{...comp,kind:'asking',amount:888,url:'https://example.com/asking'}]}),[source,{url:'https://example.com/asking',title:'Asking listing'}]);expect(r.text).toContain('Appraisal estimate — not a sale');expect(r.text).toContain('Asking price — not a sale');expect(r.text).toContain('Not enough matching');expect(r.text).not.toContain('Reported same-model sale prices:');});
 it('does not count one source twice',()=>{const r=buildResearch(JSON.stringify({...evidence,comparables:[comp,{...comp,amount:120}]}),[source]);expect(r.text).toContain('Not enough matching');});
 it('requires a past date and known sale amount for reported sold status',()=>{const r=buildResearch(JSON.stringify({...evidence,comparables:[{...comp,saleDate:null},{...comp,saleDate:'2999-01-01'},{...comp,amount:null}]}),[source]);expect(r.text).not.toContain('Reported sold —');expect(r.text).toContain('Sale status unconfirmed');});
 it('does not use invented sources or mismatched models for a sale range',()=>{const r=buildResearch(JSON.stringify({...evidence,comparables:[{...comp,url:'https://invented.example/result',amount:999},{...comp,match:'different'}]}),[source]);expect(r.text).not.toContain('999');expect(r.text).toContain('Not enough matching');});
 it('separates a same-model sale comparison from the item valuation',()=>{const r=buildResearch(JSON.stringify({...evidence,comparables:[comp,{...comp,amount:120,url:'https://example.com/second'}]}),[source,{url:'https://example.com/second',title:'Second sale'}]);expect(r.text).toContain('USD 100–120');expect(r.text).toContain('not a valuation of this item');});
});

describe('attributed value estimates',()=>{
 const estimates='USD 300, based on purchase price';
 it('keeps opinions separate and does not validate them without matching sold evidence',()=>{
  const report=buildResearch(JSON.stringify({...evidence,estimateAssessment:{assessment:'supported',reason:'Unsupported claim',sourceUrls:[source.url]},comparables:[{...comp,kind:'asking',amount:300}]}),[source],estimates);
  expect(report.text).toContain('Seller / client’s estimate (unverified): USD 300');expect(report.text).toContain('has not been validated');expect(report.text).not.toContain('Unsupported claim');expect(report.text).not.toContain('Matching sale evidence supports');
 });
 it('uses source-backed comparisons without letting estimates alter the sale range',()=>{
  const second={...comp,url:'https://example.com/second',amount:120};
  const report=buildResearch(JSON.stringify({...evidence,comparables:[comp,second],estimateAssessment:{assessment:'not_supported',reason:'The matching realized sales are lower; condition still needs checking.',sourceUrls:[source.url,second.url]}}),[source,{url:second.url,title:'Second sale'}],estimates);
  expect(report.text).toContain('USD 100–120');expect(report.text).toContain('does not support this estimate');expect(report.text).not.toContain('USD 80–300');
 });
 it('does not show an AI-invented estimate when none was supplied',()=>{
  const report=buildResearch(JSON.stringify({...evidence,estimateAssessment:{assessment:'supported',reason:'Invented estimate',sourceUrls:[]}}),[]);
  expect(report.text).not.toContain('STARTING ESTIMATE');expect(report.text).not.toContain('Invented estimate');
 });
 it('does not count invented or duplicate citations as support for an estimate',()=>{
  const report=buildResearch(JSON.stringify({...evidence,comparables:[comp],estimateAssessment:{assessment:'supported',reason:'Unverified conclusion',sourceUrls:[source.url,source.url,'https://invented.example/lot']}}),[source],estimates);
  expect(report.text).not.toContain('Unverified conclusion');expect(report.text).not.toContain('invented.example');
 });
});
