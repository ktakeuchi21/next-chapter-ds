import {z} from 'zod';
import {safeExternalUrl,type Job,type Research} from './domain';
export interface ResearchRun {id:string;state:Job['state'];createdAt:string;updatedAt:string;hasReport:boolean;}
export interface ResearchHistoryPage {runs:ResearchRun[];nextCursor:string|null;}
export type SavedResearch=Pick<Research,'text'|'sources'|'researchedAt'>;
const savedReport=z.object({text:z.string().min(1),sources:z.array(z.object({title:z.string(),url:z.string()})),researchedAt:z.string()});
export function parseSavedResearch(raw:string|null):SavedResearch|null{
 if(!raw)return null;
 try{const result=savedReport.safeParse(JSON.parse(raw));return result.success?{...result.data,sources:result.data.sources.filter(s=>safeExternalUrl(s.url))}:null;}catch{return null;}
}
