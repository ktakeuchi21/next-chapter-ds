import type {CaptureFile} from './capture-store';
export async function prepareFile(file:File,kindOverride?:'audio'):Promise<CaptureFile>{
 const kind=kindOverride||(file.type.startsWith('image/')?'photo':file.type.startsWith('video/')?'video':'audio');
 const allowed=kind==='photo'?['image/jpeg','image/png','image/webp']:kind==='video'?['video/mp4','video/webm','video/quicktime']:['audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/ogg','video/webm'];
 if(!allowed.includes(file.type.split(';')[0]))throw Error(`${file.name}: unsupported format. Use JPG, PNG or WebP for photos, MP4/MOV/WebM for video.`);
 if(!file.size||file.size>(kind==='video'?50:20)*1024*1024)throw Error(`${file.name}: maximum ${kind==='video'?50:20} MB.`);
 let preview:Blob|undefined;
 if(kind!=='audio'){
 const url=URL.createObjectURL(file);try{
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
 if(kind==='photo'){const image=new Image();image.src=url;await image.decode();const scale=Math.min(1,768/Math.max(image.width,image.height));canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);ctx.drawImage(image,0,0,canvas.width,canvas.height);}
 else {const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.src=url;
 const ready=(event:string)=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('Video preview could not be read.'));},15000);function cleanup(){clearTimeout(timer);video.removeEventListener(event,ok);video.removeEventListener('error',fail);}function ok(){cleanup();resolve();}function fail(){cleanup();reject(Error('Video cannot play in this browser.'));}video.addEventListener(event,ok,{once:true});video.addEventListener('error',fail,{once:true});});
 await ready('loadeddata');if(!Number.isFinite(video.duration)||!video.videoWidth)throw Error('Video duration is unavailable.');canvas.width=1152;canvas.height=384;ctx.fillStyle='#eee';ctx.fillRect(0,0,1152,384);
 for(let i=0;i<3;i++){const pending=ready('seeked');video.currentTime=Math.max(.001,video.duration*[.1,.5,.9][i]);await pending;const scale=Math.min(384/video.videoWidth,384/video.videoHeight),w=video.videoWidth*scale,h=video.videoHeight*scale;ctx.drawImage(video,i*384+(384-w)/2,(384-h)/2,w,h);}video.removeAttribute('src');video.load();}
 preview=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Preview could not be saved.')),'image/jpeg',.75));
 }catch(e){if(kind==='photo')throw e;/* Preserve the original video even when its codec cannot be previewed. */}finally{URL.revokeObjectURL(url);}}
 return {id:crypto.randomUUID(),name:file.name,mime:file.type,kind,blob:file,preview,sent:false};
}
