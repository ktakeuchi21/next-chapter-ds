import {afterEach,describe,it,expect,vi} from 'vitest';
import {research} from '../server/ai';
import {researchContext} from '../shared/research-input';
import {itemFields,type Item} from '../shared/domain';
import type {Env} from '../server/types';
const id='11111111-1111-4111-8111-111111111111';
const evidence={observations:['A handled glass dish'],candidate:'Possible glass serving dish; maker unknown',identificationEvidence:'The shape is visible but no maker mark can be read.',unknowns:['Maker','Size'],nextPhotos:['Underside mark with scale'],comparables:[],estimateAssessment:null,channelSuggestion:'Consider local pickup if fragile or difficult to pack.'};
function fixture({title='Item DEMO-001',images=1,missingFile=false,batch=false}={}){
 const item={...itemFields.parse({title}),id,code:'DEMO-001',owner:'Private owner',location:'Private address',notes:'Private family notes',recordType:batch?'batch':'item'} as Item;
 const row={...item,record_type:item.recordType,data:JSON.stringify(item)};
 const db={prepare:(sql:string)=>({bind:()=>({first:async()=>row,all:async()=>({results:Array.from({length:images},(_,i)=>({object_key:`photo-${i}`,mime:'image/jpeg'}))})})})};
 const media={get:async()=>missingFile?null:({size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})};
 return {item,env:{DB:db,MEDIA:media,OPENAI_API_KEY:'test-only',RESEARCH_MODEL:'gpt-4.1'} as unknown as Env};
}
function provider(){const request=vi.fn(async()=>Response.json({status:'completed',output:[{type:'web_search_call',status:'completed',action:{sources:[]}},{type:'message',content:[{type:'output_text',text:JSON.stringify(evidence)}]}]}));vi.stubGlobal('fetch',request);return request;}
afterEach(()=>vi.unstubAllGlobals());
describe('photo-first identification',()=>{
 it('sends a photo without any name or notes and preserves an uncertain legacy identification report',async()=>{
  const {env}=fixture();const request=provider();const result=await research(env,id);
  const body=JSON.parse((request.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
  const content=body.input[0].content;expect(content).toHaveLength(2);expect(content[1].type).toBe('input_image');expect(content[1].detail).toBe('high');expect(content[1].image_url).toBe('data:image/jpeg;base64,AQID');
  expect(JSON.parse(content[0].text)).toMatchObject({title:null,researchNotes:'',condition:'',measurements:'',valueEstimate:''});
  expect(body.instructions).toContain('Start with the photos even when title is null');expect(body.instructions).toContain('unverified clue');expect(body.tools[0].type).toBe('web_search');expect(body.tool_choice).toBe('required');
  expect(JSON.stringify(body)).not.toMatch(/Private owner|Private address|Private family notes|DEMO-001/);
  expect(result.text).toContain(evidence.candidate);expect(result.text).toContain('Underside mark with scale');expect(result.text).toContain('Not enough matching');
 });
 it('does not save a research report when the provider skipped web search',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(evidence)}]}]})));
  await expect(research(fixture().env,id)).rejects.toThrow('web search did not finish');
 });
 it('treats a supplied name as an optional clue and uses multiple photos together',async()=>{
  const {env,item}=fixture({title:'Possibly a vase',images:2});const request=provider();await research(env,id);
  const body=JSON.parse((request.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
  expect(body.input[0].content.filter((c:any)=>c.type==='input_image')).toHaveLength(2);expect(researchContext(item).title).toBe('Possibly a vase');
 });
 it.each([{images:0},{missingFile:true}])('does not make a paid request when no usable photo is available (%j)',async options=>{
  const request=provider();await expect(research(fixture(options).env,id)).rejects.toThrow('Add a supported photo');expect(request).not.toHaveBeenCalled();
 });
 it('asks for bulk grouping before researching multiple items as one',async()=>{
  const request=provider();await expect(research(fixture({batch:true}).env,id)).rejects.toThrow('Group this bulk capture');expect(request).not.toHaveBeenCalled();
 });
});
