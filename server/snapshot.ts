import tables from '../shared/backup-tables.json';
import type {Env} from './types';
export {tables};
export async function inventorySnapshot(env:Env){
 // One D1 batch is a transaction: every table comes from the same database state.
 const results=await env.DB.batch(tables.map(t=>env.DB.prepare(`SELECT * FROM ${t} ORDER BY id`)));
 return {version:8,exportedAt:new Date().toISOString(),...Object.fromEntries(tables.map((t,i)=>[t,results[i].results]))} as {version:number;exportedAt:string;[key:string]:any};
}
export async function sha256(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
