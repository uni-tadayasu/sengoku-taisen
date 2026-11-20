/* 本体は先に保存。大きな絵巻は、実際に開いたものから保存します。 */
const CACHE='sengoku-taisen-v3-20261121';
const CORE=['./','./index.html','./styles.css','./readability.css','./gacha.css','./artwork.css','./boot.css','./officers-data.js','./engine.js','./music.js','./artwork.js','./app.js','./boot.js','./config.js','./social.js','./social.css','./assets/castle-town.webp','./assets/title-keyvisual.webp','./assets/emblem.webp','./assets/crest.svg','./assets/favicon-32.png','./assets/icon-192.png','./assets/icon-512.png','./assets/apple-touch-icon.png','./manifest.webmanifest',...['D','C','B','A','S','SS','SSS','U'].map(rank=>'./assets/frames/rank-'+rank+'.svg')];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>/^(sengoku-tento-|sengoku-taisen-)/.test(key)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const store=response=>{if(response.ok&&response.type==='basic'){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));}return response;};
  if(/\/assets\/.+\.(webp|png|svg)$/.test(url.pathname)){
    event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(store)));
    return;
  }
  event.respondWith(fetch(event.request).then(store).catch(()=>caches.match(event.request).then(cached=>cached||(event.request.mode==='navigate'?caches.match('./index.html'):Response.error()))));
});
