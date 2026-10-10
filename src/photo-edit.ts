import type {Media} from '../shared/domain';
import {api} from './api';
function blob(canvas:HTMLCanvasElement,mime:string,quality?:number){return new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('This browser could not rotate the photo.')),mime,quality));}
export async function rotatedPhoto(photo:Media,rotation:number){
 const response=await fetch(`/api/media/${photo.id}?original=1`,{cache:'no-store'});if(!response.ok)throw Error('The original photo could not be loaded. Try again.');
 const original=await response.blob(),url=URL.createObjectURL(original);
 try{
  const image=new Image();image.src=url;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=rotation%180?image.naturalHeight:image.naturalWidth;canvas.height=rotation%180?image.naturalWidth:image.naturalHeight;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Photo editing is unavailable in this browser.');
  ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(rotation*Math.PI/180);ctx.drawImage(image,-image.naturalWidth/2,-image.naturalHeight/2);
  const file=await blob(canvas,original.type==='image/jpeg'?'image/jpeg':'image/png',.95);
  if(file.size>20*1024*1024)throw Error('The rotated photo is larger than 20 MB. Use a smaller copy of this photo.');
  const preview=document.createElement('canvas'),scale=Math.min(1,768/Math.max(canvas.width,canvas.height));preview.width=Math.max(1,Math.round(canvas.width*scale));preview.height=Math.max(1,Math.round(canvas.height*scale));const p=preview.getContext('2d')!;p.fillStyle='white';p.fillRect(0,0,preview.width,preview.height);p.drawImage(canvas,0,0,preview.width,preview.height);
  return {file,preview:await blob(preview,'image/jpeg',.8)};
 }finally{URL.revokeObjectURL(url);}
}
export async function saveRotation(itemId:string,version:number,photo:Media,rotation:number){const data=new FormData();data.set('version',String(version));data.set('rotation',String(rotation));if(rotation){const files=await rotatedPhoto(photo,rotation);data.set('file',files.file,'rotated.'+(files.file.type==='image/png'?'png':'jpg'));data.set('preview',files.preview,'preview.jpg');}return api(`/items/${itemId}/photos/${photo.id}/rotation`,{method:'POST',body:data});}
