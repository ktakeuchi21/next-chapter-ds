import {WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep} from 'cloudflare:workers';
import type {Env,JobParams} from './types';
import {research,transcribe} from './ai';
import {organize,parseNotes} from './intake-ai';
import {audit,now} from './db';
export class ItemWorkflow extends WorkflowEntrypoint<Env,JobParams>{
 async run(event:WorkflowEvent<JobParams>,step:WorkflowStep){const p=event.payload;
  try{
   await step.do('mark-running',async()=>{await this.env.DB.prepare("UPDATE jobs SET state='running',updated_at=? WHERE id=?").bind(now(),p.jobId).run();});
   // A paid provider call is deliberately not retried automatically after an ambiguous timeout.
   if(p.kind==='organize'||p.kind==='notes'){
    let transcript='';
    if(p.kind==='notes'){transcript=await step.do('transcribe-note',{retries:{limit:0,delay:'1 second'},timeout:'4 minutes'},async()=>{const existing=await this.env.DB.prepare('SELECT transcript FROM media WHERE id=? AND item_id=?').bind(p.mediaId!,p.itemId).first<any>();return existing?.transcript||await transcribe(this.env,p.itemId,p.mediaId!);});await step.do('save-transcript',async()=>{await this.env.DB.prepare('UPDATE media SET transcript=? WHERE id=?').bind(transcript,p.mediaId!).run();});}
    const result:any=await step.do('organize-capture',{retries:{limit:0,delay:'1 second'},timeout:'4 minutes'},async()=>p.kind==='organize'?await organize(this.env,p.itemId):await parseNotes(this.env,p.itemId,transcript));
    await step.do('save-intake-result',async()=>{const statements=[this.env.DB.prepare("UPDATE jobs SET state='completed',result=?,updated_at=? WHERE id=?").bind(JSON.stringify(result),now(),p.jobId)];if(p.kind==='organize')statements.push(this.env.DB.prepare('UPDATE items SET intake_report=? WHERE id=?').bind(JSON.stringify(result),p.itemId));else if(result.notes.length)statements.push(this.env.DB.prepare("INSERT OR IGNORE INTO note_suggestions(id,source_id,media_id,item_id,field,value,quote,confidence,created_at) SELECT ?||'-'||key,?,?,json_extract(value,'$.itemId'),json_extract(value,'$.field'),json_extract(value,'$.value'),json_extract(value,'$.quote'),json_extract(value,'$.confidence'),? FROM json_each(?)").bind(p.jobId,p.itemId,p.mediaId!,now(),JSON.stringify(result.notes)));await this.env.DB.batch(statements);});return {completed:true};
   }
   const result=await step.do('provider-request',{retries:{limit:0,delay:'1 second'},timeout:'4 minutes'},async()=>p.kind==='research'?JSON.stringify(await research(this.env,p.itemId)):await transcribe(this.env,p.itemId,p.mediaId!));
   await step.do('save-result',async()=>{const date=now();await this.env.DB.batch([
    p.kind==='research'?this.env.DB.prepare('UPDATE items SET research=?,updated_at=?,version=version+1 WHERE id=?').bind(result,date,p.itemId):this.env.DB.prepare('UPDATE media SET transcript=? WHERE id=? AND item_id=?').bind(result,p.mediaId!,p.itemId),
    this.env.DB.prepare("UPDATE jobs SET state='completed',result=?,error=NULL,updated_at=? WHERE id=?").bind(result,date,p.jobId),audit(this.env,p.itemId,p.kind==='research'?'Research report saved for review.':'Voice note transcribed for review.')
   ]);});return {completed:true};
  }catch(error){await step.do('save-failure',async()=>{await this.env.DB.prepare("UPDATE jobs SET state='failed',error=?,updated_at=? WHERE id=?").bind(error instanceof Error?error.message.slice(0,500):'Task failed. Retry from this item.',now(),p.jobId).run();});return {completed:false};}
 }
}
