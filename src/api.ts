export class ApiError extends Error{constructor(message:string,public status:number){super(message);this.name='ApiError';}}
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
 const response=await fetch(`/api${path}`,{...options,headers:{...(options.body&&!(options.body instanceof FormData)?{'Content-Type':'application/json'}:{}),...options.headers}});
 if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Your connection or sign-in needs attention. Reconnect and sign in, then retry. Device captures are kept.');
 const data:any=await response.json().catch(()=>({error:'The server could not be reached.'}));if(!response.ok||data?.error)throw new ApiError(data?.error||'Something went wrong. Please try again.',response.status);return data;
}
export const send=(path:string,body:unknown,method='POST')=>api(path,{method,body:JSON.stringify(body)});
export async function upload(itemId:string,file:File){const data=new FormData();data.append('file',file);data.append('requestId',crypto.randomUUID());if(file.type.startsWith('audio/'))data.append('kind','audio');return api<{id:string;kind:string}>(`/items/${itemId}/media`,{method:'POST',body:data});}
