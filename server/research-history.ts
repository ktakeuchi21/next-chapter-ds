import {Hono} from 'hono';
import {z} from 'zod';
import type {Env} from './types';
import {parseSavedResearch} from '../shared/research-history';
const cursorSchema=z.object({date:z.string().datetime(),id:z.string().min(1).max(100)});
export const researchHistory=new Hono<{Bindings:Env}>();
researchHistory.get('/items/:id/research-history',async c=>{
 const id=c.req.param('id');
 if(!await c.env.DB.prepare('SELECT id FROM items WHERE id=?').bind(id).first())return c.json({error:'Item not found.'},404);
 let cursor:z.infer<typeof cursorSchema>|null=null;
 const encoded=c.req.query('before');
 if(encoded){try{if(encoded.length>1000)throw Error();cursor=cursorSchema.parse(JSON.parse(atob(encoded)));}catch{return c.json({error:'The history position is invalid. Reload the history.'},400);}}
 const rows=await c.env.DB.prepare(`SELECT id,state,created_at createdAt,updated_at updatedAt,CASE WHEN state='completed' AND result IS NOT NULL AND length(result)>0 THEN 1 ELSE 0 END hasReport FROM jobs WHERE item_id=? AND kind='research' ${cursor?'AND (created_at<? OR (created_at=? AND id<?))':''} ORDER BY created_at DESC,id DESC LIMIT 11`).bind(...(cursor?[id,cursor.date,cursor.date,cursor.id]:[id])).all<any>();
 const runs=rows.results.slice(0,10).map(r=>({...r,hasReport:!!r.hasReport})),last=runs.at(-1);
 return c.json({runs,nextCursor:rows.results.length>10&&last?btoa(JSON.stringify({date:last.createdAt,id:last.id})):null});
});
researchHistory.get('/items/:id/research-history/:jobId',async c=>{
 const row=await c.env.DB.prepare("SELECT id,state,error,result,created_at createdAt,updated_at updatedAt FROM jobs WHERE id=? AND item_id=? AND kind='research'").bind(c.req.param('jobId'),c.req.param('id')).first<any>();
 if(!row)return c.json({error:'That search was not found for this item.'},404);
 const report=row.state==='completed'?parseSavedResearch(row.result):null;
 return c.json({run:{id:row.id,state:row.state,createdAt:row.createdAt,updatedAt:row.updatedAt,hasReport:!!report},report,message:row.state==='failed'?(row.error||'This search did not finish.'):row.state==='completed'&&!report?'The results for this older search are unavailable.':null});
});
