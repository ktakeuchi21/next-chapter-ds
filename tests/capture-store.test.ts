import 'fake-indexeddb/auto';
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('../src/api',async importOriginal=>({...await importOriginal<typeof import('../src/api')>(),api:vi.fn(),send:vi.fn()}));
import {api,send,ApiError} from '../src/api';
import {remember,prepareVisit,newDraft,appendFile,patchDraft,stored,syncCaptures,type CaptureDraft} from '../src/capture-store';
const visit={id:'visit-offline',client_id:'client',clientName:'Test client',clientCode:'TCL',location:'Client house',state:'active',created_at:''};
const file=()=>({id:crypto.randomUUID(),name:'photo.jpg',mime:'image/jpeg',kind:'photo' as const,blob:new Blob(['fixture'],{type:'image/jpeg'}),sent:false});
beforeEach(()=>vi.clearAllMocks());
it('concurrent capture and label replenishment never reuse a handwritten code',async()=>{
 const labels=Array.from({length:8},(_,i)=>({id:crypto.randomUUID(),code:`TCL-${i}`,visit_id:visit.id}));await remember('labels:'+visit.id,labels);vi.mocked(send).mockResolvedValue(labels);
 const [a,b]=await Promise.all([newDraft(visit,'item','Dining room'),newDraft(visit,'item','Kitchen'),prepareVisit(visit)]);
 const rest=await stored<any[]>('labels:'+visit.id);expect(a.id).not.toBe(b.id);expect(rest?.some(l=>l.id===a.id||l.id===b.id)).toBe(false);expect((await stored<CaptureDraft>('draft:'+a.id))?.location).toBe('Dining room');
});
it('saving sync state cannot overwrite files added at the same time',async()=>{
 const d=await newDraft(visit,'item','Shelf A'),a=file(),b=file();await Promise.all([appendFile(d.id,a),patchDraft(d.id,{synced:true}),appendFile(d.id,b)]);const kept=await stored<CaptureDraft>('draft:'+d.id);expect(kept?.files.map(f=>f.id)).toEqual([a.id,b.id]);expect(kept?.synced).toBe(true);
});
it('failed uploads retain device originals and retry with the same upload identifier',async()=>{
 const d=await newDraft(visit,'item','Shelf B'),f=file();await appendFile(d.id,f);vi.mocked(send).mockResolvedValue({id:d.id});vi.mocked(api).mockRejectedValue(Error('Offline'));
 await syncCaptures();expect((await stored<CaptureDraft>('draft:'+d.id))?.files[0].sent).toBe(false);
 vi.mocked(api).mockResolvedValue({id:f.id});await syncCaptures();const kept=await stored<CaptureDraft>('draft:'+d.id);expect(kept?.files[0].sent).toBe(true);expect(kept?.files[0].blob.size).toBe(f.blob.size);expect(vi.mocked(api).mock.calls.some(([path,opts])=>path===`/items/${d.id}/media`&&(opts?.body as FormData).get('requestId')===f.id)).toBe(true);
});

it('one rejected capture does not prevent independent files from reaching the cloud',async()=>{
 await remember('labels:'+visit.id,Array.from({length:2},(_,i)=>({id:crypto.randomUUID(),code:`TCL-BLOCK-${i}`,visit_id:visit.id})));
 const blocked=await newDraft(visit,'item','Shelf C'),next=await newDraft(visit,'item','Shelf D');await appendFile(blocked.id,file());await appendFile(next.id,file());vi.mocked(send).mockResolvedValue({});
 vi.mocked(api).mockImplementation(async path=>{if(path===`/items/${blocked.id}/media`)throw new ApiError('File rejected; try another format.',415);return {};});
 await syncCaptures();expect((await stored<CaptureDraft>('draft:'+blocked.id))?.files[0].sent).toBe(false);expect((await stored<CaptureDraft>('draft:'+next.id))?.files[0].sent).toBe(true);
});
