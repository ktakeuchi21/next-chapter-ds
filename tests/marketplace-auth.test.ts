import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {marketplaceOAuth,seal,unseal,type Tokens} from '../server/marketplace-oauth';
import {getMarketplaceToken} from '../server/marketplace-tokens';
import type {Env} from '../server/types';

// Actual SQLite executes the same conditional state-consumption and lease SQL
// as D1; only the network provider is mocked.
function fixture(){const db=new DatabaseSync(':memory:');for(const name of ['0001_initial.sql','0002_visits.sql','0009_photo_edits.sql','0003_marketplace_drafts.sql','0004_marketplace_refresh.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 const adapter={prepare(sql:string){const stmt=db.prepare(sql);let values:any[]=[];const query={bind(...args:any[]){values=args;return query;},async first(){return stmt.get(...values)??null;},async all(){return {results:stmt.all(...values)};},async run(){const r=stmt.run(...values);return {meta:{changes:Number(r.changes)}};}};return query;},async batch(queries:any[]){return Promise.all(queries.map(q=>q.run()));}};
 const env={DB:adapter,LOCAL_DEV:'true',MARKETPLACE_CONNECTIONS_ENABLED:'true',MARKETPLACE_APP_URL:'https://localhost',MARKETPLACE_TOKEN_KEY:'test-secret-key-'.repeat(3),EBAY_CLIENT_ID:'test-client',EBAY_CLIENT_SECRET:'test-secret',EBAY_RUNAME:'test-runame',ETSY_CLIENT_ID:'etsy-client',ETSY_CLIENT_SECRET:'etsy-secret'} as unknown as Env;
 return {db,env};
}
afterEach(()=>vi.unstubAllGlobals());
describe('OAuth state and token lifecycle',()=>{
 it('rejects missing/wrong browser cookies, consumes state once, and stores only encrypted tokens',async()=>{const {db,env}=fixture();try{
  const connect=await marketplaceOAuth.request('https://localhost/api/marketplaces/etsy/connect',{method:'POST'},env);expect(connect.status).toBe(200);const payload:any=await connect.json(),state=new URL(payload.url).searchParams.get('state')!,cookie=connect.headers.get('set-cookie')!.split(';')[0];expect(connect.headers.get('set-cookie')).toMatch(/HttpOnly/i);expect(connect.headers.get('set-cookie')).toMatch(/Secure/);
  const callback=`https://localhost/api/marketplaces/etsy/callback?state=${state}&code=sample-code`;
  expect((await marketplaceOAuth.request(callback,{},env)).status).toBe(400);
  expect((await marketplaceOAuth.request(callback,{headers:{cookie:'nc-oauth-etsy=wrong'}},env)).status).toBe(400);
  const network=vi.fn(async()=>Response.json({access_token:'private-access',refresh_token:'private-refresh',expires_in:3600}));vi.stubGlobal('fetch',network);
  const result=await marketplaceOAuth.request(callback,{headers:{cookie}},env);expect(result.status).toBe(302);expect(result.headers.get('location')).toBe('/#settings');
  const row:any=db.prepare('SELECT * FROM marketplace_connections').get();expect(row.encrypted_tokens).not.toContain('private');expect(await unseal<Tokens>(row.encrypted_tokens,env.MARKETPLACE_TOKEN_KEY!,'etsy:production')).toMatchObject({access_token:'private-access'});
  expect((await marketplaceOAuth.request(callback,{headers:{cookie}},env)).status).toBe(400);expect(network).toHaveBeenCalledTimes(1);
  const status=await marketplaceOAuth.request('https://localhost/api/marketplaces/connections',{},env);expect(await status.text()).not.toMatch(/private-access|private-refresh|encrypted_tokens/);
 }finally{db.close();}});
 it('returns safe exchange diagnostics and stores nothing when Etsy rejects credentials',async()=>{const {db,env}=fixture();try{
  const start=await marketplaceOAuth.request('https://localhost/api/marketplaces/etsy/connect',{method:'POST'},env),payload:any=await start.json(),state=new URL(payload.url).searchParams.get('state'),cookie=start.headers.get('set-cookie')!.split(';')[0];
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'invalid_client',error_description:'SECRET_PROVIDER_TEXT'},{status:401})));
  const result=await marketplaceOAuth.request(`https://localhost/api/marketplaces/etsy/callback?state=${state}&code=SECRET_CODE`,{headers:{cookie}},env);
  expect(result.status).toBe(502);const body=await result.text();expect(body).not.toMatch(/SECRET/);expect(JSON.parse(body)).toMatchObject({stage:'exchange_token',reason:'invalid_client',providerStatus:401});
  expect(db.prepare('SELECT * FROM marketplace_connections').all()).toEqual([]);expect(db.prepare('SELECT * FROM marketplace_oauth_states').all()).toEqual([]);
 }finally{db.close();}});
 it('expires state before exchanging a code and rejects cross-provider state',async()=>{const {db,env}=fixture();try{const response=await marketplaceOAuth.request('https://localhost/api/marketplaces/etsy/connect',{method:'POST'},env),payload:any=await response.json(),state=new URL(payload.url).searchParams.get('state'),cookie=response.headers.get('set-cookie')!.split(';')[0];const network=vi.fn();vi.stubGlobal('fetch',network);expect((await marketplaceOAuth.request(`https://localhost/api/marketplaces/ebay/callback?state=${state}&code=x`,{headers:{cookie:cookie.replace('etsy','ebay')}},env)).status).toBe(400);db.exec('UPDATE marketplace_oauth_states SET expires_at=0');expect((await marketplaceOAuth.request(`https://localhost/api/marketplaces/etsy/callback?state=${state}&code=x`,{headers:{cookie}},env)).status).toBe(400);expect(network).not.toHaveBeenCalled();}finally{db.close();}});
 it('refreshes an expired token once, caches it, and never stores plaintext',async()=>{const {db,env}=fixture();try{db.prepare('INSERT INTO marketplace_connections(id,channel,environment,encrypted_tokens,expires_at,updated_at) VALUES(?,?,?,?,?,?)').run('ebay:sandbox','ebay','sandbox',await seal({access_token:'old',refresh_token:'refresh'},env.MARKETPLACE_TOKEN_KEY!,'ebay:sandbox'),0,'now');const network=vi.fn(async()=>Response.json({access_token:'new',refresh_token:'rotated',expires_in:3600}));expect(await getMarketplaceToken(env,'ebay',network as any)).toBe('new');expect(await getMarketplaceToken(env,'ebay',network as any)).toBe('new');expect(network).toHaveBeenCalledTimes(1);const row:any=db.prepare('SELECT * FROM marketplace_connections').get();expect(row.refresh_owner).toBeNull();expect(row.encrypted_tokens).not.toContain('rotated');}finally{db.close();}});
 it('rejects a competing refresh and protects a connection replaced during refresh',async()=>{const {db,env}=fixture();try{db.prepare('INSERT INTO marketplace_connections(id,channel,environment,encrypted_tokens,expires_at,updated_at,refresh_until) VALUES(?,?,?,?,?,?,?)').run('ebay:sandbox','ebay','sandbox',await seal({access_token:'old',refresh_token:'refresh'},env.MARKETPLACE_TOKEN_KEY!,'ebay:sandbox'),0,'now',Date.now()+60000);const unused=vi.fn();await expect(getMarketplaceToken(env,'ebay',unused as any)).rejects.toThrow('being refreshed');expect(unused).not.toHaveBeenCalled();db.exec('UPDATE marketplace_connections SET refresh_until=0');const reconnect=async()=>{db.exec("UPDATE marketplace_connections SET version=version+1,encrypted_tokens='replacement',refresh_owner=NULL,refresh_until=0");return Response.json({access_token:'stale-result',refresh_token:'stale-refresh',expires_in:3600});};await expect(getMarketplaceToken(env,'ebay',reconnect)).rejects.toThrow('connection changed');expect((db.prepare('SELECT encrypted_tokens FROM marketplace_connections').get() as any).encrypted_tokens).toBe('replacement');}finally{db.close();}});
});
