/* 本体は先に保存。大きな絵巻は、実際に開いたものから保存します。 */
const RELEASE='5.14.0-20261128';
const CACHE='sengoku-taisen-v'+RELEASE;
const scopeURL=()=>self.registration?.scope||self.location.origin+'/';
const currentMatch=(request,name=CACHE)=>caches.open(name).then(cache=>cache.match(request));
const pages=new Set(['./','./guide/','./guide/data-recovery/','./about/','./premium/','./sengoku-vs/','./en/','./press/','./news/','./tools/music-audition.html']);
const optionalCode=new Set([
  './public-theme.bundle.css','./public-reading.bundle.css',
  './operator-message-templates.js','./operator-template-picker.js','./operator-template-picker.css',
  './promotion.css','./promotion-share.js','./public-growth.js','./english-introduction.css','./guide.css','./share.css','./brand-discovery.css','./public-luxury.js','./public-luxury.css','./public-search.js','./variant-text.js','./premium-catalog.js','./premium.js','./premium.css',
  './interaction-motion.js','./interaction-motion.css','./selection-lock.js','./selection-lock.css','./image-protect.js','./image-protect.css','./button-artwork.css',
  './premium-runtime.js','./premium-appearance.css','./music-broadcast.js','./music-broadcast.css','./music.js','./tools/music-audition.js','./map-data.js'
]);
const compactArtwork={'neon-command':480,war:240,town:240,archive:240,brand:48,emblem:96};
// Cache one small panorama per appearance and time of day. Offline players
// can cross a clock boundary without having visited that scene online.
const compactTownStems=new Set([
  'castle-town-raden','castle-town-raden-morning','castle-town-raden-day',
  'moonlit-castle','moonlit-castle-morning','moonlit-castle-day',
  'sakura-town','sakura-town-morning','sakura-town-night',
  'snow-town','snow-town-day','snow-town-night',
  'kagoshima-town-morning','kagoshima-town-day','kagoshima-town-night'
]);
const compactTownURL=stem=>'./assets/responsive/'+stem+'-400.webp';
const brandEdition='20261127-jade';
const installedStems={'neon-command':'neon-command-raden',war:'war-jade',town:'town-jade',archive:'archive-jade',brand:'brand-'+brandEdition,emblem:'emblem-'+brandEdition};
const compactURL=(family,stem)=>'./assets/responsive/'+(stem||installedStems[family]||family)+'-'+compactArtwork[family]+'.webp';

// A staged tab can read a different edition while this worker still controls
// both tabs. Derive the compact filename from the requested artwork first.
function compactAlternatives(relative){
  const town=/^\.\/assets\/responsive\/([a-z-]+)-\d+\.webp$/.exec(relative)
    || /^\.\/assets\/premium\/(moonlit-castle|sakura-town|snow-town)-v1\.webp$/.exec(relative);
  if(town&&compactTownStems.has(town[1]))return [compactTownURL(town[1])];
  const responsive=relative.replace(/-panel-(?=\d+\.webp$)/,'-');
  const match=/^\.\/assets\/responsive\/(neon-command|war|town|archive|brand|emblem)((?:-[a-z]+|-\d{8}(?:-[a-z]+)?)?)-\d+\.webp$/.exec(responsive)
    || /^\.\/assets\/chronicle\/(war|town|archive)((?:-[a-z]+)?)\.webp$/.exec(relative);
  if(!match)return [];
  const [,family,edition]=match;
  const requested=compactURL(family,family+edition),installed=compactURL(family);
  return requested===installed?[requested]:[requested,installed];
}

// The current HTML names the real hashed bundles. Require the matching release
// before adopting it, even if a CDN serves the previous HTML during a rollout.
function shellEntries(html){
  const entries=new Set();
  for(const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)){
    const attr=name=>new RegExp('\\s'+name+'=["\']([^"\']+)["\']','i').exec(tag)?.[1]?.replaceAll('&amp;','&');
    const script=/^<script\b/i.test(tag),rel=attr('rel');
    if(!script&&rel!=='stylesheet'&&rel!=='manifest')continue;
    const path=script?attr('src'):attr('href');
    if(!path)continue;
    // Only the app's same-scope, root code and manifest are installable assets.
    if(!/^(?:\.\/)?[a-z0-9][a-z0-9.-]*\.(?:js|css|webmanifest)\?v=[a-z0-9._-]+(?:&portrait=[a-z0-9._-]+)?$/i.test(path))throw Error('Invalid offline entry');
    entries.add('./'+path.replace(/^\.\//,''));
  }
  if(!entries.has('./manifest.webmanifest?v='+RELEASE)||![...entries].some(url=>/\.js\?/.test(url)))throw Error('Release entry is unavailable');
  return [...entries,...Object.keys(compactArtwork).map(name=>compactURL(name)),...Array.from(compactTownStems,compactTownURL)];
}
function entryMime(url,response){
  const type=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase(),path=new URL(url).pathname;
  if(path.endsWith('.js'))return ['text/javascript','application/javascript','application/x-javascript'].includes(type);
  if(path.endsWith('.css'))return type==='text/css';
  if(path.endsWith('/public-search-index.json'))return type==='application/json';
  if(path.endsWith('.webmanifest'))return ['application/manifest+json','application/json','application/octet-stream'].includes(type);
  return type==='image/webp';
}
async function installShell(){
  const root=scopeURL(),indexURL=new URL('index.html',root).href;
  const document=await fetch(indexURL,{credentials:'omit',cache:'no-cache'});
  if(!mayStore(document)||!/^text\/html\b/i.test(document.headers.get('Content-Type')||''))throw Error('Offline document is unavailable');
  const paths=shellEntries(await document.clone().text()),cache=await caches.open(CACHE);
  // Fetch through the HTTP cache so resources the first page already loaded
  // can be reused. A failed installation leaves the previous worker in control.
  await Promise.all(paths.map(async path=>{
    const url=new URL(path,root).href,response=await fetch(url,{credentials:'omit'});
    if(!mayStore(response)||!entryMime(url,response))throw Error('Offline resource is unavailable');
    await cache.put(url,response);
  }));
  await cache.put(indexURL,document);
  if(!self.registration?.active)await self.skipWaiting();
}
self.addEventListener('install',event=>event.waitUntil(installShell()));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>/^(sengoku-tento-|sengoku-taisen-|pachi-)/.test(key)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{
  if(event.data?.type==='sengoku-release')event.ports?.[0]?.postMessage({release:RELEASE});
});
const stagedClients=new Map();
function chosenRelease(raw){
  if(!raw)return null;
  const url=new URL(raw),scope=scopeURL();
  if(url.origin+url.pathname!==scope&&url.origin+url.pathname!==new URL('index.html',scope).href)return null;
  const version=url.searchParams.get('sengoku-version');
  return /^\d+\.\d+\.\d+-\d{8}$/.test(version)?version:null;
}
async function clientCache(event){
  if(!self.registration?.waiting)return CACHE;
  const navigation=event.request.mode==='navigate';
  if(!navigation&&stagedClients.has(event.clientId))return stagedClients.get(event.clientId);
  let selected=navigation?chosenRelease(event.request.url):null;
  // Workers can stop between fetches. The visible tab's URL survives that
  // restart even with the site's no-referrer policy.
  if(!selected&&!navigation&&event.clientId)selected=chosenRelease((await self.clients.get(event.clientId))?.url);
  if(!selected||selected===RELEASE)return CACHE;
  const name='sengoku-taisen-v'+selected;
  if(!await caches.has(name))return CACHE;
  const index=new URL('index.html',scopeURL()).href;
  if(!await currentMatch(index,name))return CACHE; // The install commits HTML last.
  const id=navigation?event.resultingClientId:event.clientId;
  if(id){if(stagedClients.size>=64)stagedClients.delete(stagedClients.keys().next().value);stagedClients.set(id,name);}
  return name;
}
const musicFiles = new Set([
  'town-dawn','castle-evening','fields-green','market-breeze','world-march','mountain-road','officers-oath','council-lantern',
  'army-banner','research-stars','battle-storm','battle-siege','victory-horizon','defeat-moon','winter-silence','unification',
  'shitaku','asakatsu','hirukatsu','yorukatsu','operation-broadcast'
].map(id => './assets/music/' + id + '.mp3'));
const loadingMusic = new Map();
function mayStore(response) {
  return response.status === 200 && response.type === 'basic' && !response.redirected &&
    !/\b(?:no-store|private|no-cache)\b/i.test(response.headers?.get('Cache-Control') || '');
}
async function completeMusic(request, cacheName) {
  const cached = await currentMatch(request.url,cacheName).catch(() => null);
  if (cached && cached.status === 200) return cached;
  const key=cacheName+' '+request.url;
  if (!loadingMusic.has(key)) {
    const headers = new Headers(request.headers);
    headers.delete('Range');
    headers.delete('If-Range');
    const pending = (async () => {
      const response = await fetch(new Request(request, {headers,credentials:'omit'}));
      if (mayStore(response) && /^audio\/mpeg(?:;|$)|^application\/octet-stream(?:;|$)/i.test(response.headers.get('Content-Type') || '')) {
        try { await (await caches.open(cacheName)).put(request.url, response.clone()); } catch (_) { /* Storage may be full. */ }
      }
      return response;
    })();
    loadingMusic.set(key, pending);
    try { return (await pending).clone(); } finally { loadingMusic.delete(key); }
  }
  return (await loadingMusic.get(key)).clone();
}
async function musicResponse(request, range, cacheName) {
  const response = await completeMusic(request,cacheName);
  if (!range || response.status !== 200) return response;
  const blob = await response.blob(), size = blob.size;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || end < start) return new Response(null, {status:416, headers:{'Content-Range':'bytes */' + size}});
  const headers = new Headers(response.headers);
  headers.delete('Content-Encoding'); headers.delete('Transfer-Encoding');
  headers.set('Content-Length', String(end - start + 1)); headers.set('Accept-Ranges','bytes');
  headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
  return new Response(blob.slice(start, end + 1), {status:206, headers});
}
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.cache === 'no-store' ||
      /\bno-store\b/i.test(request.headers?.get?.('Cache-Control') || '') || request.headers?.has('Authorization') || request.headers?.has('Cookie') || /\/api\//.test(url.pathname)) return;

  const scope = new URL(self.registration?.scope || self.location.origin + '/').pathname;
  if (!url.pathname.startsWith(scope)) return;
  const relative = './' + url.pathname.slice(scope.length);
  const rangeHeader = request.headers?.get?.('Range');
  if (musicFiles.has(relative) && (!url.search || url.search === '?v=' + RELEASE || self.registration?.waiting&&/^\?v=\d+\.\d+\.\d+-\d{8}$/.test(url.search))) {
    // Unsupported or conditional ranges remain under the origin server's control.
    const range = rangeHeader && /^bytes=(\d{0,12})-(\d{0,12})$/i.exec(rangeHeader);
    if (request.headers?.has('If-Range') || (rangeHeader && (!range || (!range[1] && !range[2])))) return;
    event.respondWith(clientCache(event).then(name=>
      !url.search||name==='sengoku-taisen-v'+url.searchParams.get('v')?musicResponse(request,range,name):fetch(request)));
    return;
  }
  if (request.headers?.has('Range')) return;
  const versionQuery=!url.search||/^\?v=[A-Za-z0-9._-]{1,64}(?:&portrait=[A-Za-z0-9._-]{1,64})?$/.test(url.search);
  const artwork=versionQuery&&/^\.\/assets\/.+\.(?:webp|png|svg|jpe?g|avif|woff2?)$/i.test(relative);
  const code=versionQuery&&/^\.\/(?:[a-z0-9][a-z0-9.-]*\.(?:js|css|webmanifest)|tools\/music-audition\.js)$/i.test(relative);
  // Only the generated public guide index is eligible. Saves, player JSON and
  // API responses remain outside offline storage; the index loads on demand.
  const publicSearch=versionQuery&&relative==='./public-search-index.json';
  const pageKey=relative.endsWith('/index.html')?relative.slice(0,-10):relative;
  const page=request.mode==='navigate'&&pages.has(pageKey);
  if(!page&&!artwork&&!code&&!publicSearch)return;

  const indexURL=new URL('index.html',scopeURL()).href;
  const cacheKey=page?(pageKey==='./'?indexURL:new URL(pageKey,scopeURL()).href):request.url;
  const updateVisit=pageKey==='./'&&!!chosenRelease(url.href);
  // The release archive is useful offline, but each connected news visit
  // should see the latest public announcement, even with an older game tab.
  const refresh=page&&!updateVisit&&(pageKey==='./news/'||url.search||request.cache==='reload'||request.cache==='no-cache');
  const offline=async (cached,cacheName)=>{
    if(cached)return cached;
    if(page&&pageKey!=='./')return Response.redirect(scopeURL(),302);
    if(artwork){
      for(const path of compactAlternatives(relative)){
        const image=await currentMatch(new URL(path,scopeURL()).href,cacheName);
        if(image)return image;
      }
    }
    return Response.error();
  };
  event.respondWith((async()=>{
    const cacheName=await clientCache(event),cached=await currentMatch(cacheKey,cacheName).catch(()=>null);
    if(cached&&!refresh)return cached;
    try{
      const remember=artwork||publicSearch||code&&optionalCode.has(relative)||page&&pageKey!=='./'&&!url.search;
      // Cached resources are public. Never fill them using session cookies.
      const response=await fetch(request,remember?{credentials:'omit'}:undefined);
      // Only an install can replace the game's document. A manual reload may
      // show newer HTML while the tab still has an older worker, without
      // overwriting that worker's coherent offline entry.
      if(remember&&mayStore(response)&&(!(code||publicSearch)||entryMime(request.url,response))){
        const copy=response.clone();
        event.waitUntil(caches.open(cacheName).then(cache=>cache.put(cacheKey,copy)).catch(()=>{}));
      }
      return response;
    }catch{return offline(cached,cacheName);}
  })());

});
// The browser decrypts the authenticated Web Push payload before this event.
self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{};}catch(_){}
 const title=typeof payload.title==='string'?payload.title.slice(0,100):'戦国VSのお知らせ';
 event.waitUntil(self.registration.showNotification(title,{body:typeof payload.body==='string'?payload.body.slice(0,240):'領国の報告を確認してください。',icon:'./assets/branding/sengoku-vs-icon-192-'+brandEdition+'.png',badge:'./assets/branding/sengoku-vs-badge-96-'+brandEdition+'.png',tag:'sengoku-update',renotify:false,data:{url:'/?notice=1'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of clients){if(new URL(client.url).origin===self.location.origin){await client.focus();client.postMessage({type:'sengoku-open-recap'});return;}}await self.clients.openWindow('./?notice=1');})());
});
