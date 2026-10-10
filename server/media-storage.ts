
// Retries may arrive after an upload response was lost. Never replace original
// bytes under the same label, including two simultaneous attempts.
async function digest(bytes:ArrayBuffer){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
export async function verifyOriginal(bucket:R2Bucket,key:string,bytes:ArrayBuffer,mime:string){
 const existing=await bucket.head(key);if(!existing||existing.size!==bytes.byteLength||existing.httpMetadata?.contentType!==mime)return false;
 const expected=await digest(bytes);let actual=existing.customMetadata?.sha256;
 // Older originals and isolated restores have no custom digest metadata.
 if(!actual){const original=await bucket.get(key);if(!original)return false;actual=await digest(await original.arrayBuffer());}
 return actual===expected;
}
export async function putOriginal(bucket:R2Bucket,key:string,bytes:ArrayBuffer,mime:string){
 const hash=await digest(bytes);
 const saved=await bucket.put(key,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),sha256:hash,httpMetadata:{contentType:mime},customMetadata:{sha256:hash}});
 if(saved)return;
 if(!await verifyOriginal(bucket,key,bytes,mime))throw Error('Upload identifier is already used by another file.');
}

export function byteRange(header:string|null,size:number):R2Range|null|'invalid'{
 if(!header)return null;
 // Multi-range and unknown units may be ignored and served as a full response.
 if(!header.startsWith('bytes=')||header.includes(','))return null;
 const match=/^bytes=(\d*)-(\d*)$/.exec(header);
 if(!match||(!match[1]&&!match[2])||!size)return 'invalid';
 if(!match[1]){const suffix=Number(match[2]);return Number.isSafeInteger(suffix)&&suffix>0?{offset:Math.max(0,size-suffix),length:Math.min(size,suffix)}:'invalid';}
 const start=Number(match[1]),end=match[2]?Number(match[2]):size-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return 'invalid';
 return {offset:start,length:Math.min(end,size-1)-start+1};
}

export async function mediaResponse(bucket:R2Bucket,key:string,mime:string,request:Request){
 const meta=await bucket.head(key);if(!meta)return new Response(null,{status:404});
 const headers=new Headers({'Content-Type':mime,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'",'Accept-Ranges':'bytes','ETag':meta.httpEtag});
 const range=byteRange(request.headers.has('If-Range')&&request.headers.get('If-Range')!==meta.httpEtag?null:request.headers.get('Range'),meta.size);
 if(range==='invalid'){headers.set('Content-Range',`bytes */${meta.size}`);return new Response(null,{status:416,headers});}
 const object=await bucket.get(key,range?{range}:undefined);if(!object)return new Response(null,{status:404});
 if(range&&'offset' in range){headers.set('Content-Range',`bytes ${range.offset}-${range.offset!+range.length!-1}/${meta.size}`);headers.set('Content-Length',String(range.length));}
 else headers.set('Content-Length',String(meta.size));
 return new Response(request.method==='HEAD'?null:object.body,{status:range?206:200,headers});
}
