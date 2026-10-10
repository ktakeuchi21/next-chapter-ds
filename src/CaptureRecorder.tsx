import {useEffect,useRef,useState} from 'react';
import {Mic,Square} from 'lucide-react';
type SaveRecording=(file:File)=>Promise<void>;
type Phase='idle'|'starting'|'recording'|'saving'|'recovery';
export function CaptureRecorder({onFile,onPrepareRecording,onRecording,maxSeconds=600,disabled=false}:{onFile:SaveRecording;onPrepareRecording?:()=>Promise<SaveRecording>;onRecording?:(recording:boolean)=>void;maxSeconds?:number;disabled?:boolean}){
 const [phase,setPhase]=useState<Phase>('idle'),[seconds,setSeconds]=useState(0),[error,setError]=useState(''),[failed,setFailed]=useState<File|null>(null),[failedUrl,setFailedUrl]=useState('');
 const rec=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setInterval>|null>(null),mounted=useRef(true),locked=useRef(false),saveHandler=useRef<SaveRecording>(onFile),statusHandler=useRef(onRecording);statusHandler.current=onRecording;
 function change(next:Phase){locked.current=next!=='idle';if(mounted.current)setPhase(next);statusHandler.current?.(next!=='idle');}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(rec.current?.state==='recording')rec.current.stop();stream.current?.getTracks().forEach(t=>t.stop());if(timer.current)clearInterval(timer.current);};},[]);
 useEffect(()=>{if(!failed){setFailedUrl('');return;}const u=URL.createObjectURL(failed);setFailedUrl(u);return()=>URL.revokeObjectURL(u);},[failed]);
 async function save(f:File){change('saving');if(mounted.current)setError('');try{await saveHandler.current(f);if(mounted.current)setFailed(null);change('idle');}catch(e){if(mounted.current){setFailed(f);setError((e as Error).message);}change('recovery');}}
 function stop(){if(timer.current)clearInterval(timer.current);if(rec.current?.state==='recording'){change('saving');rec.current.stop();}stream.current?.getTracks().forEach(t=>t.stop());}
 useEffect(()=>{if(phase==='recording'&&seconds>=maxSeconds)stop();},[seconds,phase,maxSeconds]);
 useEffect(()=>{if(phase==='idle')return;const before=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};const guard=(e:MouseEvent)=>{if((e.target as Element).closest('a[href^="#"]')){if(phase==='recovery'&&confirm('This recording is not saved in the app. Leave only if you have downloaded a copy. Leave this page?'))return;e.preventDefault();e.stopPropagation();setError(phase==='recovery'?'Save or download this recording before leaving.':'Finish keeping this recording before leaving this page.');}};window.addEventListener('beforeunload',before);document.addEventListener('click',guard,true);return()=>{window.removeEventListener('beforeunload',before);document.removeEventListener('click',guard,true);};},[phase]);
 async function start(){
  if(locked.current||disabled)return;change('starting');setError('');saveHandler.current=onFile;
  try{
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('This browser cannot record audio. Upload an existing recording instead.');
   stream.current=await navigator.mediaDevices.getUserMedia({audio:true});
   if(!mounted.current){stream.current.getTracks().forEach(t=>t.stop());return;}
   // Pin the destination before recording. A delayed save must never attach
   // this note to the next item or visit selected by the user.
   if(onPrepareRecording)saveHandler.current=await onPrepareRecording();
   if(!mounted.current){stream.current.getTracks().forEach(t=>t.stop());return;}
   const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t)),r=new MediaRecorder(stream.current,mime?{mimeType:mime}:undefined);rec.current=r;const chunks:BlobPart[]=[];let bytes=0;
   r.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);bytes+=e.data.size;if(bytes>18*1024*1024)stop();}};
   r.onstop=()=>{const blob=new Blob(chunks,{type:r.mimeType});if(blob.size)void save(new File([blob],`Voice note ${new Date().toISOString().slice(0,19).replaceAll(':','-')}.${r.mimeType.includes('mp4')?'mp4':'webm'}`,{type:r.mimeType}));else{if(mounted.current)setError('No audio was captured. Please try recording again.');change('idle');}};
   r.onerror=()=>{if(mounted.current)setError('Recording stopped unexpectedly. Keeping any captured audio…');stop();};r.start(1000);change('recording');setSeconds(0);timer.current=setInterval(()=>setSeconds(s=>s+1),1000);
  }catch(e){stream.current?.getTracks().forEach(t=>t.stop());if(mounted.current)setError((e as Error).name==='NotAllowedError'?'Microphone access was blocked. Allow it in your browser settings, or upload an existing recording.':(e as Error).message);change('idle');}
 }
 const recording=phase==='recording';
 return <div className="capture-recorder">{error&&<p role="alert" className="error">{error}</p>}<button type="button" className={recording?'recording':'capture-action'} disabled={!recording&&(disabled||phase!=='idle')} onClick={recording?stop:start}>{recording?<Square size={22}/>:<Mic size={22}/>} {recording?`Stop & keep note · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:phase==='starting'?'Opening microphone…':phase==='saving'?'Keeping your recording…':'Record a note'}</button>{failed&&<><audio controls src={failedUrl||undefined}/><div className="button-row"><button disabled={phase==='saving'} onClick={()=>save(failed)}>Retry saving recording</button><a className="button" href={failedUrl} download={failed.name}>Download recording</a><button disabled={phase==='saving'} onClick={()=>{if(confirm('Discard this recording from this tab? Keep a downloaded copy if you need it.')){setFailed(null);setError('');change('idle');}}}>Discard this recording</button></div><small>Keep this page open until Retry succeeds. Download a copy if device storage is full.</small></>}<small>{recording?'Stop to save. Keep this page open while recording.':`Up to ${maxSeconds/60} minutes. Saved automatically when you stop.`}</small></div>;
}
