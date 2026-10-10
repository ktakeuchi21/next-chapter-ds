import {afterEach,describe,it,expect,vi} from 'vitest';
import {parseNotes} from '../server/intake-ai';
import type {Env} from '../server/types';
const id='11111111-1111-4111-8111-111111111111';
function env(key='test-only'):Env{
 const row={id,code:'DEMO-001',record_type:'item',data:JSON.stringify({title:'Wooden stool',observations:[]})};
 return {DB:{prepare:()=>({bind:()=>({first:async()=>row})})},OPENAI_API_KEY:key,RESEARCH_MODEL:'gpt-4.1'} as unknown as Env;
}
afterEach(()=>vi.unstubAllGlobals());
describe('voice estimate extraction',()=>{
 it('accepts attributed estimates and filters unsupported quotes',async()=>{
  const transcript='Seller thinks fifty dollars. The client estimates seventy five to one hundred dollars.';
  const notes=[{itemId:id,field:'valueEstimate',value:'Seller estimates fifty dollars',quote:'Seller thinks fifty dollars.',confidence:'clear'},{itemId:id,field:'valueEstimate',value:'Client estimates seventy five to one hundred dollars',quote:'The client estimates seventy five to one hundred dollars.',confidence:'clear'},{itemId:id,field:'valueEstimate',value:'999',quote:'not in the transcript',confidence:'clear'}];
  const request=vi.fn(async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({notes})}]}]}));vi.stubGlobal('fetch',request);
  const result=await parseNotes(env(),id,transcript);expect(result.notes).toHaveLength(2);
  const body=JSON.parse((request.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);expect(body.instructions).toContain('Do not invent who is speaking');expect(body.instructions).toContain('not an asking price');
 });
 it.skipIf(process.env.RUN_LIVE_ESTIMATE_CHECK!=='1')('live model maps named and unnamed estimates to the same field',async()=>{
  const {readFileSync,writeFileSync}=await import('node:fs');
  const secret=process.env.OPENAI_API_KEY;if(!secret)throw Error('Set OPENAI_API_KEY in the local environment.');
  const cases=[
   {transcript:'The client thinks the wooden stool is worth 50 to 75 US dollars based on a similar stool they sold.',fields:['valueEstimate']},
   {transcript:'I think this wooden stool might be worth 90 dollars.',fields:['valueEstimate']}
  ];const results=[];
  for(const c of cases){const result=await parseNotes(env(secret),id,c.transcript);expect(result.notes.map(n=>n.field).sort()).toEqual([...c.fields].sort());expect(result.notes.every(n=>c.transcript.includes(n.quote))).toBe(true);results.push({transcript:c.transcript,...result});}
  expect(results[0].notes[0].value).toMatch(/50/);expect(results[0].notes[0].value).toMatch(/75/);expect(results[0].notes[0].value).toContain('similar stool');expect(results[1].notes[0].value).toContain('90');expect(results[1].notes[0].value).not.toMatch(/Seller|client/i);
  writeFileSync('work/value-estimate-ai-check.json',JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));
 },120000);
});
