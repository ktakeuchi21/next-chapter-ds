import type {Env} from './types';
import type {Channel} from '../shared/marketplaces';
import {oauthConfig,unseal,seal,exchangeTokens,type Tokens} from './marketplace-oauth';

// A D1 lease prevents concurrent workers from rotating the same refresh token.
// A reconnect increments version, so an in-flight refresh cannot overwrite it.
export async function getMarketplaceToken(env:Env,channel:Channel,transport:typeof fetch=fetch){
 const config=oauthConfig(env,channel);if(!config)throw Error('Marketplace connection is not configured.');
 const id=`${channel}:${config.environment}`,row=await env.DB.prepare('SELECT * FROM marketplace_connections WHERE id=?').bind(id).first<any>();
 if(!row)throw Error('Connect the seller account first.');
 const tokens=await unseal<Tokens>(row.encrypted_tokens,env.MARKETPLACE_TOKEN_KEY!,id);
 if(row.expires_at>Date.now()+60000)return tokens.access_token;
 const lease=crypto.randomUUID(),time=Date.now();
 const acquired=await env.DB.prepare('UPDATE marketplace_connections SET refresh_owner=?,refresh_until=? WHERE id=? AND version=? AND refresh_until<?').bind(lease,time+60000,id,row.version,time).run();
 if(!acquired.meta.changes)throw Error('This account is being refreshed. Retry shortly.');
 try{
  if(!tokens.refresh_token)throw Error('Reconnect the seller account.');
  const next=await exchangeTokens(config,{refreshToken:tokens.refresh_token},transport);
  const result=await env.DB.prepare('UPDATE marketplace_connections SET encrypted_tokens=?,expires_at=?,version=version+1,updated_at=?,refresh_owner=NULL,refresh_until=0 WHERE id=? AND version=? AND refresh_owner=?').bind(await seal(next,env.MARKETPLACE_TOKEN_KEY!,id),Date.now()+next.expires_in*1000,new Date().toISOString(),id,row.version,lease).run();
  if(!result.meta.changes)throw Error('The account connection changed. Retry with the new connection.');
  return next.access_token;
 }finally{await env.DB.prepare('UPDATE marketplace_connections SET refresh_owner=NULL,refresh_until=0 WHERE id=? AND refresh_owner=?').bind(id,lease).run();}
}
