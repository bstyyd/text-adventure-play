/* Generated after production build. Cache only the public shell and immutable assets. */
/* global __VERSION__, __PRECACHE__ */
const version=__VERSION__,precache=__PRECACHE__,cacheName='dayao-shell-'+version;
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(cacheName).then(async cache=>{
    for(const url of precache){const res=await fetch(new Request(url,{cache:'reload',credentials:'omit'}));if(!res.ok)throw new Error('Shell download incomplete');await cache.put(url,res);}
  }));
  // Do not skipWaiting: installation waits for an explicit user action or closed tabs.
});
self.addEventListener('activate',event=>{
  // IndexedDB and story copies are untouched; retain the preceding shell for open tabs.
  event.waitUntil((async()=>{const keys=(await caches.keys()).filter(k=>k.startsWith('dayao-shell-'));for(const key of keys.slice(0,-2))if(key!==cacheName)await caches.delete(key);await self.clients.claim();})());
});
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  // No API cache, no POST replay, no background sync, no cross-origin requests.
  if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).catch(async()=>{const cache=await caches.open(cacheName);return await cache.match('/')||new Response('请联网完成首次资源下载。',{status:503});}));return;
  }
  if(precache.includes(url.pathname))event.respondWith((async()=>{const cache=await caches.open(cacheName);return await cache.match(url.pathname)||fetch(req);})());
  else if(url.pathname.startsWith('/_next/static/'))event.respondWith((async()=>{
    // An open tab can still request an immutable chunk from the preceding build.
    // Search only our shell caches; never look up story/API responses here.
    for(const name of (await caches.keys()).filter(k=>k.startsWith('dayao-shell-')).reverse()){
      const hit=await(await caches.open(name)).match(url.pathname);if(hit)return hit;
    }
    return fetch(req);
  })());
});
