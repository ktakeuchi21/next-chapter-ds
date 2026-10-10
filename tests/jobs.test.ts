import {describe,it,expect,vi} from 'vitest';
import {deliverJob,reconcileJob,type ActiveJob} from '../server/jobs';
import type {Env} from '../server/types';
const job=():ActiveJob=>({id:'job-1',item_id:'item-1',kind:'research',media_id:null,state:'queued',created_at:new Date().toISOString()});
function env(status='running'){
 const run=vi.fn(async()=>({meta:{changes:1}}));
 const prepare=vi.fn(()=>({bind:vi.fn(()=>({run}))}));
 const createBatch=vi.fn(async()=>[]);
 const get=vi.fn(async()=>({status:async()=>({status})}));
 return {value:{DB:{prepare},ITEM_WORKFLOW:{createBatch,get},OPENAI_API_KEY:'fixture-only'} as unknown as Env,prepare,run,createBatch,get};
}
describe('durable task recovery',()=>{
 it('redelivers with the original ID, without restarting an existing workflow',async()=>{const e=env();await reconcileJob(e.value,job());await reconcileJob(e.value,job());expect(e.createBatch.mock.calls).toHaveLength(2);expect((e.createBatch.mock.calls[0] as any)[0][0].id).toBe('job-1');expect(e.run).not.toHaveBeenCalled();});
 it('does not start a fresh instance for a running job',async()=>{const e=env();expect(await reconcileJob(e.value,{...job(),state:'running'})).toBe('running');expect(e.createBatch).not.toHaveBeenCalled();expect(e.run).not.toHaveBeenCalled();});
 it('keeps queued jobs intact after an ambiguous delivery failure',async()=>{const e=env();e.createBatch.mockRejectedValue(new Error('connection interrupted'));expect(await reconcileJob(e.value,job())).toBe('unavailable');expect(e.run).not.toHaveBeenCalled();});
 it('does not convert a status outage into failure',async()=>{const e=env();e.get.mockRejectedValue(new Error('temporarily unavailable'));expect(await reconcileJob(e.value,{...job(),state:'running'})).toBe('unavailable');expect(e.run).not.toHaveBeenCalled();});
 it('unblocks the DB row only after authoritative terminal state',async()=>{const e=env('errored');expect(await reconcileJob(e.value,{...job(),state:'running'})).toBe('errored');expect(e.run).toHaveBeenCalledOnce();expect(e.prepare.mock.calls[0][0]).toContain("state IN ('queued','running')");});
 it('does not redeliver jobs outside the retention-safe window or without a key',async()=>{const e=env();expect(await deliverJob(e.value,{...job(),created_at:new Date(Date.now()-86400001).toISOString()})).toBe(false);expect(await deliverJob({...e.value,OPENAI_API_KEY:undefined},job())).toBe(false);expect(e.createBatch).not.toHaveBeenCalled();});
});
