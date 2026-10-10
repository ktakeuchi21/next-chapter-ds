import {z} from 'zod';
export const groupSchema=z.object({title:z.string().trim().min(1).max(160),mediaIds:z.array(z.string().uuid()).min(1).max(60),uncertain:z.boolean().default(true),reason:z.string().max(500).default('')});
export const groupingSchema=z.object({groups:z.array(groupSchema).max(60)});
export type Group=z.infer<typeof groupSchema>;
export const noteFields=['condition','location','measurements','researchNotes','valueEstimate','pickupArea','loadingNotes','clearBy'] as const;
export const extractedNotes=z.object({notes:z.array(z.object({itemId:z.string().nullable(),field:z.enum(noteFields),value:z.string().max(2000),quote:z.string().min(1).max(2000),confidence:z.enum(['clear','uncertain'])})).max(80)});
export function validateGroups(groups:Group[],available:string[]){
 const ids=groups.flatMap(g=>g.mediaIds);
 if(new Set(ids).size!==ids.length)throw Error('A file can belong to only one group. Move it rather than copying it.');
 if(ids.some(id=>!available.includes(id))||ids.length!==available.length)throw Error('Include every photo and video exactly once. New uploads may need grouping.');
 return groups;
}
export function clientCode(name:string){const words=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().match(/[A-Z]+/g)||['CLIENT'];return (words.length>1?words[0][0]+words.at(-1)!.slice(0,2):words[0].slice(0,3)).padEnd(3,'X');}
export interface Client {id:string;name:string;code:string;default_location:string;}
export interface Visit {id:string;client_id:string;location:string;state:string;created_at:string;clientName:string;clientCode:string;}
export interface Label {id:string;code:string;visit_id:string;}
export interface NoteSuggestion {id:string;source_id:string;media_id:string;item_id:string|null;field:typeof noteFields[number];value:string;quote:string;confidence:string;state:string;previous_value:string|null;applied_version:number|null;}

// Keep the speaker's exact estimate, uncertainty and reason. The single input
// does not require deciding whether the speaker is Seller or the client.
export function preserveEstimateQuote(note:z.infer<typeof extractedNotes>['notes'][number],transcript=''){
 if(note.field!=='valueEstimate')return note;
 const start=transcript.indexOf(note.quote);
 const reason=start>=0?transcript.slice(start+note.quote.length).match(/^\s+(?:based on|because|since|from)\b[^.!?\n]*(?:[.!?]|$)/i)?.[0]:'';
 const quote=note.quote+(reason||'');return {...note,quote,value:quote};
}
export function canonicalNoteField(field:string){return ['sellerValueEstimate','clientValueEstimate'].includes(field)?'valueEstimate':field;}
