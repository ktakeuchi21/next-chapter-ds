import {afterEach,describe,expect,it,vi} from 'vitest';
import {research,transcribe} from '../server/ai';
import type {Env} from '../server/types';
function environment(){
 const row={id:'item-1',code:'NC-1',data:JSON.stringify({title:'Angel ornament',condition:'Unconfirmed',measurements:'',observations:['Wire wings'],identification:'Unconfirmed',researchNotes:'Owner recalls a gift from 1999',valueEstimate:'USD 50–75 based on past sales',owner:'Private owner',location:'Private address',notes:'Private note'}),status:'intake',version:1};
 const db={prepare:vi.fn((sql:string)=>({bind:()=>({first:async()=>sql.includes('FROM items')?row:{object_key:'audio-1',mime:'audio/wav',name:'note.wav'},all:async()=>({results:[{object_key:'photo-1',mime:'image/jpeg'}]})})}))};
 return {DB:db,MEDIA:{get:async()=>({size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})},OPENAI_API_KEY:'test-fixture-only',RESEARCH_MODEL:'gpt-4.1',TRANSCRIPTION_MODEL:'gpt-4o-mini-transcribe'} as unknown as Env;
}
afterEach(()=>vi.unstubAllGlobals());
describe('provider boundaries',()=>{
 it('sends selected item evidence, excludes private text and preserves safe cited sources',async()=>{
  const request=vi.fn(async()=>Response.json({status:'completed',output:[{type:'web_search_call',status:'completed',action:{sources:[]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({observations:['Wire wings'],candidate:'Unknown angel ornament',identificationEvidence:'Identification remains uncertain.',unknowns:['Maker'],nextPhotos:['Base mark'],comparables:[],estimateAssessment:null,channelSuggestion:'Consider local pickup if fragile.'}),annotations:[{type:'url_citation',url:'https://example.com/evidence',title:'Evidence'},{type:'url_citation',url:'https://example.com/evidence',title:'Evidence'},{type:'url_citation',url:'javascript:alert(1)',title:'Unsafe'}]}]}]}));vi.stubGlobal('fetch',request);
  const result=await research(environment(),'item-1');
  const body=JSON.parse((request.mock.calls[0] as unknown as [string,RequestInit])[1].body as string);
  expect(body.input[0].content[0].text).toContain('Wire wings');expect(body.input[0].content[0].text).not.toMatch(/Private owner|Private address|Private note/);
  expect(body.input[0].content[0].text).toContain('Owner recalls a gift from 1999');expect(body.input[0].content[0].text).toContain('USD 50–75');expect(body.instructions).toContain('without using their target prices');expect(body.instructions).toContain('Do not include these private estimates in public web search queries');expect(body.store).toBe(false);expect(body.input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/);
  expect(result.sources).toEqual([{url:'https://example.com/evidence',title:'Evidence'}]);expect(result.text).toContain('Identification remains uncertain.');
 });
 it('retains cited price evidence from search before separately formatting the recommendation',async()=>{
  const url='https://example.com/used-cooker';
  const note='A used Duo listing asks USD 50; capacity is not readable on the item.';
  const formatted={observations:['IP-DUO on panel'],displayName:'Instant Pot Duo · capacity unknown',identificationConfidence:'medium',candidate:'Instant Pot Duo',identificationEvidence:'Panel marking',unknowns:['Capacity'],nextPhotos:['Bottom label'],comparables:[{title:'Used Duo',url,kind:'asking',amount:50,currency:'USD',saleDate:null,match:'similar',evidence:'Used listing asks USD 50.',differences:'Capacity unconfirmed.'}],estimateAssessment:null,channelSuggestion:'Local pickup',pricingUnavailableReason:'',pricing:{currency:'USD',low:25,high:50,suggested:40,quickSale:30,confidence:'medium',basis:'asking_prices',reason:'Similar used asking price, with room to negotiate.',assumptions:['Working, complete; capacity unknown.'],sourceUrls:[url],channel:'local_pickup'}};
  const request=vi.fn().mockResolvedValueOnce(Response.json({status:'completed',output:[{type:'web_search_call',status:'completed',action:{}},{type:'message',content:[{type:'output_text',text:note,annotations:[{type:'url_citation',url:url+'?utm_source=openai',title:'Used Duo'}]}]}]})).mockResolvedValueOnce(Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(formatted)}]}]}));
  vi.stubGlobal('fetch',request);const result=await research(environment(),'item-1');
  expect(request).toHaveBeenCalledTimes(2);
  const first=JSON.parse(request.mock.calls[0][1].body),second=JSON.parse(request.mock.calls[1][1].body);
  expect(first.text).toBeUndefined();expect(first.tool_choice).toBe('required');expect(first.input[0].content[1].detail).toBe('high');
  expect(second.tools).toBeUndefined();expect(second.text.format.strict).toBe(true);expect(second.input[0].content[1]).toEqual(first.input[0].content[1]);
  expect(JSON.parse(second.input[0].content[0].text)).toMatchObject({researchNotes:note,trustedSources:[{url:url+'?utm_source=openai',title:'Used Duo'}]});
  expect(JSON.stringify(second)).not.toMatch(/Private owner|Private address|Private note/);
  expect(result.pricing).toMatchObject({suggested:40,basis:'asking_prices',confidence:'low',sourceUrls:[url]});
 });
 it('does not save search notes as a successful price when formatting fails',async()=>{
  const request=vi.fn().mockResolvedValueOnce(Response.json({status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'An unidentified dish.'}]}]})).mockResolvedValueOnce(Response.json({status:'incomplete',output:[]}));vi.stubGlobal('fetch',request);
  await expect(research(environment(),'item-1')).rejects.toThrow('price summary did not finish');
 });
 it('does not save incomplete output as successful research',async()=>{vi.stubGlobal('fetch',async()=>Response.json({status:'incomplete',output:[]}));await expect(research(environment(),'item-1')).rejects.toThrow('did not complete');});
 it('keeps provider error bodies and secrets out of user-facing errors',async()=>{vi.stubGlobal('fetch',async()=>new Response('private provider diagnostics',{status:401}));await expect(research(environment(),'item-1')).rejects.toThrow('OpenAI rejected access');});
 it('uploads audio using multipart and returns only actual transcription text',async()=>{
  const request=vi.fn(async()=>Response.json({text:'Small chip on the base.'}));vi.stubGlobal('fetch',request);
  expect(await transcribe(environment(),'item-1','audio-1')).toBe('Small chip on the base.');
  const init=(request.mock.calls[0] as unknown as [string,RequestInit])[1];const form=init.body as FormData;
  expect(form.get('model')).toBe('gpt-4o-mini-transcribe');expect((form.get('file') as File).type).toBe('audio/wav');expect(init.headers).not.toHaveProperty('Content-Type');
 });
 it('does not invent a transcript when the response is empty',async()=>{vi.stubGlobal('fetch',async()=>Response.json({text:' '}));await expect(transcribe(environment(),'item-1','audio-1')).rejects.toThrow('No speech was transcribed');});
});
