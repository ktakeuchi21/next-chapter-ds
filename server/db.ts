import type {Env} from './types';
import {combinedValueEstimate,type Item} from '../shared/domain';
export const now=()=>new Date().toISOString();
export const uuid=()=>crypto.randomUUID();
export function itemFrom(row:any):Item{return {researchNotes:'',...JSON.parse(row.data),valueEstimate:combinedValueEstimate(JSON.parse(row.data)),id:row.id,code:row.code,clientId:row.client_id??null,visitId:row.visit_id??null,recordType:row.record_type??'item',sampleId:row.sample_id,status:row.status,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,cover:row.cover??null,photoCount:row.photo_count??0};}
export async function getItem(env:Env,id:string){const row=await env.DB.prepare("SELECT i.*, (SELECT id FROM media WHERE item_id=i.id AND kind='photo' ORDER BY sort_order,created_at,id LIMIT 1) cover,(SELECT COUNT(*) FROM media WHERE item_id=i.id AND kind='photo') photo_count FROM items i WHERE i.id=?").bind(id).first<any>();return row?itemFrom(row):null;}
export function audit(env:Env,id:string,message:string){return env.DB.prepare('INSERT INTO activity(id,item_id,message,created_at) VALUES(?,?,?,?)').bind(uuid(),id,message,now());}
