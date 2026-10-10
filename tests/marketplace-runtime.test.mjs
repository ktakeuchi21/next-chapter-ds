import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

// Run the actual request builders in workerd. Node's fetch accepts redirect:error,
// while Workers rejects it before any network request, which mocks cannot catch.
test('marketplace requests use Worker-compatible redirect handling without forwarding credentials',async()=>{
 const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`
 import {exchangeTokens} from './server/marketplace-oauth.ts';
 import {providerRequest} from './server/marketplace-providers.ts';
 export default {async fetch(){
  const requests=[];
  const transport=async(url,init)=>{
   const request=new Request(url,init);
   requests.push({redirect:request.redirect,key:request.headers.get('x-api-key')});
   return Response.json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600});
  };
  const config={channel:'etsy',environment:'production',clientId:'fixture-id',clientSecret:'fixture-secret',redirect:'https://example.test/callback',callback:'https://example.test/callback'};
  await exchangeTokens(config,{code:'fixture-code',verifier:'fixture-verifier'},transport);
  await exchangeTokens(config,{refreshToken:'fixture-refresh'},transport);
  await providerRequest('https://api.etsy.com/v3/application/shops/1',{headers:{'x-api-key':'fixture-id:fixture-secret'}},transport);
  let redirects=0;const reasons=[];
  const redirectTransport=async(url,init)=>{new Request(url,init);redirects++;return new Response(null,{status:302,headers:{location:'https://untrusted.example/'}});};
  try{await exchangeTokens(config,{code:'fixture-code',verifier:'fixture-verifier'},redirectTransport);}catch(e){reasons.push(e.reason);}
  try{await providerRequest('https://api.etsy.com/v3/application/shops/1',{},redirectTransport);}catch(e){reasons.push(e.status);}
  return Response.json({requests,redirects,reasons});
 }};`},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-09-01',script:bundle.outputFiles[0].text}));
 try{
  const response=await mf.dispatchFetch('https://example.test/');
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.requests.length,3);
  assert.ok(result.requests.every(r=>r.redirect==='manual'&&r.key==='fixture-id:fixture-secret'));
  assert.equal(result.redirects,2);
  assert.deepEqual(result.reasons,['unexpected_redirect',302]);
 }finally{await mf.dispose();}
});
