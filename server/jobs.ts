import type {Env,JobParams} from './types';
import {now} from './db';
export interface ActiveJob {id:string;item_id:string;kind:JobParams['kind'];media_id:string|null;state:string;created_at:string;}
// Keep retry delivery inside explicit Workflow retention. Never restart a paid step.
const deliveryWindow=24*60*60*1000;
export async function deliverJob(env:Env,job:ActiveJob){
 if(job.state!=='queued'||!env.OPENAI_API_KEY||Date.now()-Date.parse(job.created_at)>deliveryWindow)return false;
 await env.ITEM_WORKFLOW.createBatch([{id:job.id,params:{jobId:job.id,itemId:job.item_id,kind:job.kind,...(job.media_id?{mediaId:job.media_id}:{})},retention:{successRetention:'3 days',errorRetention:'3 days'}}]);
 return true;
}
export async function reconcileJob(env:Env,job:ActiveJob){
 // createBatch skips an existing ID; an ambiguous response therefore cannot start a second instance.
 if(job.state==='queued')try{await deliverJob(env,job);}catch{return 'unavailable';}
 let state:InstanceStatus;
 try{state=await (await env.ITEM_WORKFLOW.get(job.id)).status();}catch{return 'unavailable';}
 if(['errored','terminated','complete'].includes(state.status)){
  // A successful Workflow already saved its result. Only repair an inconsistent active DB row.
  const error=state.status==='complete'?'The task ended without a saved result. Review this item before starting another task.':'The background task stopped. Your files are saved; you can start another task.';
  await env.DB.prepare("UPDATE jobs SET state='failed',error=?,updated_at=? WHERE id=? AND state IN ('queued','running')").bind(error,now(),job.id).run();
 }
 return state.status;
}
export async function reconcileJobs(env:Env){
 const rows=await env.DB.prepare("SELECT * FROM jobs WHERE state IN ('queued','running') AND updated_at<? ORDER BY updated_at LIMIT 50").bind(new Date(Date.now()-60000).toISOString()).all<ActiveJob>();
 for(const job of rows.results)await reconcileJob(env,job);
}
