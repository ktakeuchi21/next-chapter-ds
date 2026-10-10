import {Hono} from 'hono';
import {getCookie,setCookie,deleteCookie} from 'hono/cookie';
import {z} from 'zod';
import {authenticate} from './auth';
import type {Env} from './types';
import {type Channel,channels} from '../shared/marketplaces';

export const ebayScopes=['https://api.ebay.com/oauth/api_scope','https://api.ebay.com/oauth/api_scope/sell.inventory','https://api.ebay.com/oauth/api_scope/sell.account.readonly','https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly'];
export const etsyScopes=['listings_r','listings_w','shops_r','transactions_r'];
const encoder=new TextEncoder();
export function b64(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
function unb64(s:string){return Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
export function randomSecret(){return b64(crypto.getRandomValues(new Uint8Array(32)));}
export async function digest(s:string){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s))));}
async function key(secret:string){if(secret.length<32)throw Error('Encryption key is not configured.');return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode(secret)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function seal(value:unknown,secret:string,context:string){const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},await key(secret),encoder.encode(JSON.stringify(value)));return `${b64(iv)}.${b64(new Uint8Array(encrypted))}`;}
export async function unseal<T>(value:string,secret:string,context:string):Promise<T>{const [iv,data]=value.split('.');return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:encoder.encode(context)},await key(secret),unb64(data))));}
export interface OAuthConfig {channel:Channel;environment:'sandbox'|'production';clientId:string;clientSecret:string;redirect:string;callback:string;}
export function oauthConfig(env:Env,channel:Channel):OAuthConfig|null {
 if(env.MARKETPLACE_CONNECTIONS_ENABLED!=='true'||!env.MARKETPLACE_TOKEN_KEY||env.MARKETPLACE_TOKEN_KEY.length<32||!env.MARKETPLACE_APP_URL)return null;
 const origin=new URL(env.MARKETPLACE_APP_URL);if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)return null;
 const callback=`${origin.origin}/api/marketplaces/${channel}/callback`;
 if(channel==='ebay')return env.EBAY_CLIENT_ID&&env.EBAY_CLIENT_SECRET&&env.EBAY_RUNAME?{channel,environment:env.EBAY_ENVIRONMENT==='production'?'production':'sandbox',clientId:env.EBAY_CLIENT_ID,clientSecret:env.EBAY_CLIENT_SECRET,redirect:env.EBAY_RUNAME,callback}:null;
 return env.ETSY_CLIENT_ID&&env.ETSY_CLIENT_SECRET?{channel,environment:'production',clientId:env.ETSY_CLIENT_ID,clientSecret:env.ETSY_CLIENT_SECRET,redirect:callback,callback}:null;
}
export async function authorizeUrl(config:OAuthConfig,state:string,verifier:string){
 const url=new URL(config.channel==='etsy'?'https://www.etsy.com/oauth/connect':config.environment==='sandbox'?'https://auth.sandbox.ebay.com/oauth2/authorize':'https://auth.ebay.com/oauth2/authorize');
 url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:config.redirect,scope:(config.channel==='etsy'?etsyScopes:ebayScopes).join(' '),state}).toString();
 if(config.channel==='etsy'){url.searchParams.set('code_challenge',await digest(verifier));url.searchParams.set('code_challenge_method','S256');}
 return url.toString();
}
const tokensSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().min(1).optional(),expires_in:z.number().positive(),scope:z.string().optional()});
export type Tokens=z.infer<typeof tokensSchema>;
export class OAuthExchangeError extends Error {
 constructor(public reason:string,public providerStatus?:number){super(`Account authorization failed${providerStatus?` (${providerStatus})`:''}: ${reason}. Start a fresh connection attempt.`);}
}

export async function exchangeTokens(config:OAuthConfig,grant:{code:string;verifier:string}|{refreshToken:string},transport:typeof fetch=fetch):Promise<Tokens>{
 const etsy=config.channel==='etsy',refresh='refreshToken' in grant;
 const body=new URLSearchParams(refresh?{grant_type:'refresh_token',refresh_token:grant.refreshToken}:{grant_type:'authorization_code',code:grant.code,redirect_uri:config.redirect});
 const headers:Record<string,string>={'Content-Type':'application/x-www-form-urlencoded'};
 if(etsy){headers['x-api-key']=`${config.clientId}:${config.clientSecret}`;body.set('client_id',config.clientId);if(!refresh)body.set('code_verifier',grant.verifier);}else{headers.Authorization=`Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`;if(refresh)body.set('scope',ebayScopes.join(' '));}
 const url=etsy?'https://api.etsy.com/v3/public/oauth/token':`https://api${config.environment==='sandbox'?'.sandbox':''}.ebay.com/identity/v1/oauth2/token`;
 let response:Response;
 try{response=await transport(url,{method:'POST',headers,body,redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw new OAuthExchangeError('provider_unreachable');}
 if(response.status>=300&&response.status<400)throw new OAuthExchangeError('unexpected_redirect',response.status);
 // Never include token endpoint bodies (which can contain credentials) in logs/errors.
 if(!response.ok){
  // Allowlist OAuth error codes only; never expose descriptions, bodies, codes or tokens.
  let reason='provider_rejected';
  try{const result:any=await response.json();if(['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope','access_denied','temporarily_unavailable'].includes(result.error))reason=result.error;}catch{}
  throw new OAuthExchangeError(reason,response.status);
 }
 let result:unknown;try{result=await response.json();}catch{throw new OAuthExchangeError('invalid_token_response');}
 const validated=tokensSchema.safeParse(result);if(!validated.success)throw new OAuthExchangeError('invalid_token_response');
 const parsed=validated.data;
 if(!parsed.refresh_token&&refresh)parsed.refresh_token=grant.refreshToken;
 if(!parsed.refresh_token)throw new OAuthExchangeError('missing_refresh_token');
 return parsed;
}
export const marketplaceOAuth=new Hono<{Bindings:Env}>();
marketplaceOAuth.get('/api/marketplaces/connections',async c=>{
 const rows=await c.env.DB.prepare('SELECT channel,environment,updated_at FROM marketplace_connections').all<any>();
 return c.json(channels.map(channel=>{const config=oauthConfig(c.env,channel),environment=config?.environment||(channel==='ebay'?'sandbox':'production'),record=rows.results.find(r=>r.channel===channel&&r.environment===environment);return {channel,environment,configured:!!config,linked:!!record,updatedAt:record?.updated_at??null,remoteWritesEnabled:channel==='etsy'&&!!config&&!!record,draftOnly:channel==='etsy'};}));
});
marketplaceOAuth.post('/api/marketplaces/:channel/connect',async c=>{
 const channel=z.enum(channels).parse(c.req.param('channel')),config=oauthConfig(c.env,channel);
 if(!config)return c.json({error:'Developer access and connection credentials are not configured yet. Saved drafts are ready to work on.'},503);
 if(new URL(c.req.url).origin!==new URL(config.callback).origin)return c.json({error:'Connect from the configured published workspace.'},400);
 const owner=await authenticate(c.req.raw,c.env),state=randomSecret(),browser=randomSecret(),verifier=randomSecret(),expires=Date.now()+10*60*1000;
 await c.env.DB.batch([c.env.DB.prepare('DELETE FROM marketplace_oauth_states WHERE expires_at<?').bind(Date.now()),c.env.DB.prepare('INSERT INTO marketplace_oauth_states(id,channel,environment,owner,browser_hash,encrypted_verifier,expires_at) VALUES(?,?,?,?,?,?,?)').bind(state,channel,config.environment,owner,await digest(browser),await seal(verifier,c.env.MARKETPLACE_TOKEN_KEY!,state),expires)]);
 setCookie(c,`nc-oauth-${channel}`,browser,{httpOnly:true,secure:true,sameSite:'Lax',path:'/api/marketplaces',maxAge:600});
 return c.json({url:await authorizeUrl(config,state,verifier)});
});
marketplaceOAuth.get('/api/marketplaces/:channel/callback',async c=>{
 c.header('Referrer-Policy','no-referrer');
 const channel=z.enum(channels).parse(c.req.param('channel')),config=oauthConfig(c.env,channel),state=c.req.query('state')||'',cookie=getCookie(c,`nc-oauth-${channel}`);
 if(!config||!cookie||!state)return c.json({error:'This connection attempt expired. Start again from Connections.'},400);
 const owner=await authenticate(c.req.raw,c.env);
 const record=await c.env.DB.prepare('DELETE FROM marketplace_oauth_states WHERE id=? AND channel=? AND environment=? AND owner=? AND browser_hash=? AND expires_at>? RETURNING encrypted_verifier').bind(state,channel,config.environment,owner,await digest(cookie),Date.now()).first<{encrypted_verifier:string}>();
 deleteCookie(c,`nc-oauth-${channel}`,{path:'/api/marketplaces'});
 if(!record)return c.json({error:'This connection attempt expired or was already used. Start again from Connections.'},400);
 const code=c.req.query('code');if(!code||c.req.query('error'))return c.redirect('/#settings');
 let stage='decrypt_verifier';
 try{
  const verifier=await unseal<string>(record.encrypted_verifier,c.env.MARKETPLACE_TOKEN_KEY!,state);
  stage='exchange_token';
  const tokens=await exchangeTokens(config,{code,verifier}),id=`${channel}:${config.environment}`;
  stage='store_connection';
  await c.env.DB.prepare('INSERT INTO marketplace_connections(id,channel,environment,encrypted_tokens,expires_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_tokens=excluded.encrypted_tokens,expires_at=excluded.expires_at,version=marketplace_connections.version+1,updated_at=excluded.updated_at,refresh_owner=NULL,refresh_until=0').bind(id,channel,config.environment,await seal(tokens,c.env.MARKETPLACE_TOKEN_KEY!,id),Date.now()+tokens.expires_in*1000,new Date().toISOString()).run();
 }catch(error){
  const reason=error instanceof OAuthExchangeError?error.reason:'internal_failure';
  const providerStatus=error instanceof OAuthExchangeError?error.providerStatus:undefined;
  return c.json({error:'Account linking failed. Start again from Connections. If it fails again, share the diagnostic fields below.',stage,reason,...(providerStatus?{providerStatus}:{})},502);
 }
 return c.redirect('/#settings');
});
