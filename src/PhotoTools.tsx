import {RotateCcw,RotateCw,ArrowLeft,ArrowRight} from 'lucide-react';
import type {Detail} from '../shared/domain';
import {saveRotation} from './photo-edit';
import {send} from './api';
export function PhotoTools({detail,selectedId,disabled,onAction}:{detail:Detail;selectedId:string;disabled:boolean;onAction:(fn:()=>Promise<unknown>,message:string)=>Promise<void>}){
 const photos=detail.media.filter(m=>m.kind==='photo'),index=photos.findIndex(m=>m.id===selectedId),photo=photos[index];
 if(!photo)return null;
 const working=detail.jobs.some(j=>['queued','running'].includes(j.state));
 const rotate=(by:number)=>void onAction(()=>saveRotation(detail.item.id,detail.item.version,photo,((photo.rotation||0)+by+360)%360),'Photo rotation saved. Listing downloads and new uploads use this version.');
 const move=(to:number)=>void onAction(async()=>{const ids=photos.map(p=>p.id);ids.splice(to,0,...ids.splice(index,1));await send(`/items/${detail.item.id}/photos/order`,{version:detail.item.version,photoIds:ids},'PUT');},'Photo order saved. The first photo is the cover.');
 return <section className="photo-tools" aria-label="Edit photos"><strong>Photo {index+1} of {photos.length}{index===0?' · Cover photo':''}</strong><fieldset disabled={disabled||working}><div className="photo-tool-row"><button type="button" onClick={()=>rotate(-90)}><RotateCcw size={18} aria-hidden="true"/>Rotate left</button><button type="button" onClick={()=>rotate(90)}><RotateCw size={18} aria-hidden="true"/>Rotate right</button></div>{photos.length>1&&<div className="photo-tool-row"><button type="button" disabled={index===0} onClick={()=>move(index-1)}><ArrowLeft size={18} aria-hidden="true"/>Move earlier</button><button type="button" disabled={index===photos.length-1} onClick={()=>move(index+1)}>Move later<ArrowRight size={18} aria-hidden="true"/></button>{index>0&&<button type="button" onClick={()=>move(0)}>Make cover</button>}</div>}</fieldset><small>{working?'Finish the current task before changing photos.':'Changes save automatically and carry into listing photos. Live listings are not updated automatically.'}</small></section>;
}
