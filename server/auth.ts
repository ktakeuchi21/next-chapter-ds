import {createRemoteJWKSet,jwtVerify} from 'jose';
import type {Env} from './types';
export function localMode(request:Request,env:Env){return env.LOCAL_DEV==='true'&&['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname);}
export async function authenticate(request:Request,env:Env){
 if(localMode(request,env))return 'local-developer';
 if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD||!env.ALLOWED_EMAILS)throw new Error('Sign-in is not configured.');
 const token=request.headers.get('Cf-Access-Jwt-Assertion');if(!token)throw new Error('Sign in to continue.');
 const issuer=`https://${env.ACCESS_TEAM_DOMAIN}`;
 const {payload}=await jwtVerify(token,createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)),{issuer,audience:env.ACCESS_AUD,algorithms:['RS256']});
 const email=String(payload.email||'').toLowerCase();
 if(!env.ALLOWED_EMAILS.split(',').map(x=>x.trim().toLowerCase()).includes(email))throw new Error('This account does not have access.');
 return email;
}
export function sameOrigin(request:Request){
 const origin=request.headers.get('Origin');if(!origin)return true;
 try{const target=new URL(request.url),from=new URL(origin);return from.origin===target.origin || (['localhost','127.0.0.1'].includes(target.hostname)&&['localhost','127.0.0.1'].includes(from.hostname)&&from.protocol==='http:'&&['5173','8787'].includes(from.port));}catch{return false;}
}
