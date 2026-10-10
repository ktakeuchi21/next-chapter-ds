const CACHE='next-chapter-shell-v3';
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const r=await fetch('/',{cache:'reload'});if(!r.ok||new URL(r.url).origin!==location.origin||!r.headers.get('content-type')?.includes('text/html'))return;
 const text=await r.clone().text();if(!text.includes('id="root"'))return;const cache=await caches.open(CACHE);await cache.put('/',r);
 const assets=[...text.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m=>m[1]);await cache.addAll(assets);self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('next-chapter-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin!==location.origin||event.request.method!=='GET'||url.pathname.startsWith('/api/')||url.pathname.startsWith('/cdn-cgi/'))return;
 if(event.request.mode==='navigate'){event.respondWith((async()=>{try{const r=await fetch(event.request);if(r.ok&&new URL(r.url).origin===location.origin&&r.headers.get('content-type')?.includes('text/html')){const copy=r.clone();event.waitUntil((async()=>{const text=await copy.clone().text();if(!text.includes('id="root"'))return;const cache=await caches.open(CACHE);const assets=[...text.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(m=>m[1]);await cache.addAll(assets);await cache.put('/',copy);})());}return r;}catch{return await caches.match('/')||Response.error();}})());return;}
 if(url.pathname.startsWith('/assets/'))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
