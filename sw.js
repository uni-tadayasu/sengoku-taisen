/* 本体は先に保存。大きな絵巻は、実際に開いたものから保存します。 */
const RELEASE='4.9.0-20261123';
const CACHE='sengoku-taisen-v'+RELEASE;
const CORE=['./voice.js','./voice.css','./branches.js','./branches.css','./court.js','./court.css','./stable-dom.js','./roaming-management.js','./roaming-management.css','./covert.js','./covert.css','./responsive-polish.css','./roaming.js','./roaming.css','./button-artwork.css','./events.js','./events.css','./hints.js','./hints-ui.js','./hints.css','./scroll-top.js','./scroll-top.css','./player-evaluation.js','./player-evaluation.css','./selection-lock.css','./selection-lock.js','./social-mobile.css','./social-viewport.js','./touch-header.css','./viewport-lock.js','./viewport-lock.css','./strategy.js','./strategy.css','./letters.js','./letters.css','./trade.js','./trade.css','./moderation.js','./moderation.css','./walking.js','./walking.css','./governors.css','./town-fit.js','./town-fit.css','./officer-icons.css','./image-protect.js','./image-protect.css','./avatar.js','./alliance-icon.js','./avatar.css','./start-castle.css','./interaction-motion.js','./interaction-motion.css','./title-fit.css','./layout-controls.js','./layout-controls.css','./world-clock.js','./world-map.js','./world-map.css','./map-data.js','./kamon.js','./kamon.css','./desktop-fit.js','./desktop-fit.css','./responsive-layout.css','./vivid-theme.css','./domain-recovery.css','./domain-recovery.js','./guide.css','./guide/','./guide/data-recovery/','./about/','./field.js','./field.css','./assets/operator-ieyasu-u.webp','./','./index.html','./styles.css','./readability.css','./gacha.css','./artwork.css','./boot.css','./officers-data.js','./engine.js','./music.js','./artwork.js','./app.js','./boot.js','./config.js','./social.js','./social.css','./cloud-sync.js','./cloud-sync.css','./assets/castle-town.webp','./assets/emblem.webp','./assets/crest.svg','./assets/favicon-32.png','./assets/icon-192.png','./assets/icon-512.png','./assets/apple-touch-icon.png','./manifest.webmanifest',...['D','C','B','A','S','SS','SSS','U'].map(rank=>'./assets/frames/rank-'+rank+'.svg')];
CORE.push(...["./assets/map/japan-hillshade-gsi-z8.webp", "./assets/map/japan-terrain-gsi-z8.webp", "./assets/kamon/akamatsu.svg", "./assets/kamon/akechi.svg", "./assets/kamon/akizuki.svg", "./assets/kamon/amago.svg", "./assets/kamon/ando.svg", "./assets/kamon/asahina.svg", "./assets/kamon/asakura.svg", "./assets/kamon/asano.svg", "./assets/kamon/ashikaga.svg", "./assets/kamon/ashina.svg", "./assets/kamon/awaya.svg", "./assets/kamon/azai.svg", "./assets/kamon/chiba.svg", "./assets/kamon/chosokabe.svg", "./assets/kamon/chugoku-group.svg", "./assets/kamon/date.svg", "./assets/kamon/endo.svg", "./assets/kamon/fukushima.svg", "./assets/kamon/gamo.svg", "./assets/kamon/hachisuka.svg", "./assets/kamon/hatakeyama.svg", "./assets/kamon/hojo.svg", "./assets/kamon/hokuriku-group.svg", "./assets/kamon/honda.svg", "./assets/kamon/hongwanji.svg", "./assets/kamon/honjo.svg", "./assets/kamon/horio.svg", "./assets/kamon/hosokawa.svg", "./assets/kamon/ii.svg", "./assets/kamon/iio.svg", "./assets/kamon/ikeda.svg", "./assets/kamon/ikoma.svg", "./assets/kamon/imagawa.svg", "./assets/kamon/ito.svg", "./assets/kamon/jinbo.svg", "./assets/kamon/jo.svg", "./assets/kamon/kanamori.svg", "./assets/kamon/kanto-group.svg", "./assets/kamon/kato.svg", "./assets/kamon/kikkawa.svg", "./assets/kamon/kinki-group.svg", "./assets/kamon/kobayakawa.svg", "./assets/kamon/koide.svg", "./assets/kamon/kono.svg", "./assets/kamon/kunohe.svg", "./assets/kamon/kuroda.svg", "./assets/kamon/kyushu-group.svg", "./assets/kamon/local-group.svg", "./assets/kamon/maeda.svg", "./assets/kamon/matsukura.svg", "./assets/kamon/matsunaga.svg", "./assets/kamon/matsuura.svg", "./assets/kamon/mimura.svg", "./assets/kamon/miyoshi.svg", "./assets/kamon/mogami.svg", "./assets/kamon/mori-ranmaru.svg", "./assets/kamon/mori.svg", "./assets/kamon/murakami.svg", "./assets/kamon/nabeshima.svg", "./assets/kamon/nagano.svg", "./assets/kamon/nakagawa.svg", "./assets/kamon/nakamura.svg", "./assets/kamon/nanbu.svg", "./assets/kamon/narita.svg", "./assets/kamon/nishina.svg", "./assets/kamon/oda.svg", "./assets/kamon/ogasawara.svg", "./assets/kamon/okudaira.svg", "./assets/kamon/ota.svg", "./assets/kamon/otomo.svg", "./assets/kamon/ouchi.svg", "./assets/kamon/rokkaku.svg", "./assets/kamon/ryuzoji.svg", "./assets/kamon/sagara.svg", "./assets/kamon/saito.svg", "./assets/kamon/sanada.svg", "./assets/kamon/satake.svg", "./assets/kamon/satomi.svg", "./assets/kamon/sengoku.svg", "./assets/kamon/shibata-katsuie.svg", "./assets/kamon/shibata.svg", "./assets/kamon/shimazu.svg", "./assets/kamon/shimizu.svg", "./assets/kamon/sogo.svg", "./assets/kamon/soma.svg", "./assets/kamon/suzuki.svg", "./assets/kamon/tachibana.svg", "./assets/kamon/takeda.svg", "./assets/kamon/tamura.svg", "./assets/kamon/todo.svg", "./assets/kamon/tohoku-group.svg", "./assets/kamon/tokugawa.svg", "./assets/kamon/toyama.svg", "./assets/kamon/toyotomi.svg", "./assets/kamon/tozawa.svg", "./assets/kamon/tsugaru.svg", "./assets/kamon/tsutsui.svg", "./assets/kamon/uesugi.svg", "./assets/kamon/ujiie.svg", "./assets/kamon/ukita.svg", "./assets/kamon/unaffiliated.svg", "./assets/kamon/utsunomiya.svg", "./assets/kamon/wakisaka.svg", "./assets/kamon/yamana.svg", "./assets/kamon/yamauchi.svg", "./assets/kamon/yoshimi.svg", "./assets/kamon/yuki.svg", "./assets/kamon/yura.svg"]);
CORE.push('./sengoku-vs/','./share.css');
CORE.push('./premium/','./premium-catalog.js','./premium.js','./premium.css','./premium-runtime.js','./premium-appearance.css','./premium-admin.js','./premium-admin.css','./assets/premium/gold-banner-v1.webp','./assets/premium/moonlit-castle-v1.webp','./assets/premium/supporter-badge-v1.webp');
// Brand artwork has its own stable revision path, shared by HTML and the PWA.
CORE.push('./favicon.ico','./apple-touch-icon.png','./assets/branding/sengoku-vs-favicon-32-20261122.png','./assets/branding/sengoku-vs-icon-192-20261122.png','./assets/branding/sengoku-vs-icon-512-20261122.png','./assets/branding/sengoku-vs-apple-touch-icon-180-20261122.png');
CORE.push('./progress.js','./progress.css','./alliance.js','./alliance.css','./conquest.js','./conquest.css','./notifications.js','./notifications.css','./public-court.js','./public-court.css','./assets/kamon/court-group.svg');
CORE.push('./battle-catalog.js','./battle-advisor.js','./battle-advisor.css','./shogunate.js','./shogunate.css');
CORE.push('./navigation-ui.js','./navigation-ui.css','./gameplay.css','./chronicle-game.css','./tools/music-audition.html','./tools/music-audition.js');
CORE.push(...['cover','cover-small','town','war','court','archive','music'].map(scene=>'./assets/chronicle/'+scene+'.webp'));
CORE.push('./travel.js','./travel-ui.js','./travel-ui.css');
CORE.push('./residency.js','./residency.css');
CORE.push('./palace-theme.css','./page-collections.css','./presentation.js','./presentation.css','./public-luxury.css','./public-luxury.js','./assets/palace-pattern.svg');
// Versioned entry URLs prevent browser HTTP caches from mixing old and new engines.
const portraitRevision='ieyasu-sokutai-20261123';
for(let i=0;i<CORE.length;i++){
  const asset=CORE[i];
  if(/\.(?:js|css)$/.test(asset))CORE[i]=asset+'?v='+RELEASE+(asset==='./artwork.js'?'&portrait='+portraitRevision:'');
}
CORE.push('./assets/operator-ieyasu-u.webp?v='+portraitRevision);
for(const asset of ['manifest.webmanifest','assets/favicon-32.png','assets/icon-192.png','assets/icon-512.png','assets/sengoku-taisen-favicon-32.png','assets/sengoku-taisen-icon-192.png','assets/sengoku-taisen-icon-512.png','assets/apple-touch-icon.png','assets/emblem.webp','assets/castle-town.webp'])CORE.push('./'+asset+'?v='+RELEASE);
for(const rank of ['D','C','B','A','S','SS','SSS','U'])CORE.push('./assets/frames/rank-'+rank+'.svg?v='+RELEASE);
// Only this release may answer a request. Older games used this same origin;
// CacheStorage.match across every cache could otherwise return their icons or HTML.
const currentMatch=request=>caches.open(CACHE).then(cache=>cache.match(request));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>/^(sengoku-tento-|sengoku-taisen-|pachi-)/.test(key)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
const publicFiles = new Set(CORE);
const musicFiles = new Set([
  'town-dawn','castle-evening','fields-green','market-breeze','world-march','mountain-road','officers-oath','council-lantern',
  'army-banner','research-stars','battle-storm','battle-siege','victory-horizon','defeat-moon','winter-silence','unification'
].map(id => './assets/music/' + id + '.mp3'));
const loadingMusic = new Map();
function mayStore(response) {
  return response.status === 200 && response.type === 'basic' && !response.redirected &&
    !/\b(?:no-store|private|no-cache)\b/i.test(response.headers?.get('Cache-Control') || '');
}
async function completeMusic(request) {
  const cached = await currentMatch(request.url).catch(() => null);
  if (cached && cached.status === 200) return cached;
  if (!loadingMusic.has(request.url)) {
    const headers = new Headers(request.headers);
    headers.delete('Range');
    headers.delete('If-Range');
    const pending = (async () => {
      const response = await fetch(new Request(request, {headers}));
      if (mayStore(response) && /^audio\/mpeg(?:;|$)|^application\/octet-stream(?:;|$)/i.test(response.headers.get('Content-Type') || '')) {
        try { await (await caches.open(CACHE)).put(request.url, response.clone()); } catch (_) { /* Storage may be full. */ }
      }
      return response;
    })();
    loadingMusic.set(request.url, pending);
    try { return (await pending).clone(); } finally { loadingMusic.delete(request.url); }
  }
  return (await loadingMusic.get(request.url)).clone();
}
async function musicResponse(request, range) {
  const response = await completeMusic(request);
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
      /\bno-store\b/i.test(request.headers?.get?.('Cache-Control') || '') || request.headers?.has('Authorization') || /\/api\//.test(url.pathname)) return;

  const scope = new URL(self.registration?.scope || self.location.origin + '/').pathname;
  if (!url.pathname.startsWith(scope)) return;
  const relative = './' + url.pathname.slice(scope.length);
  const rangeHeader = request.headers?.get?.('Range');
  if (musicFiles.has(relative) && (!url.search || url.search === '?v=' + RELEASE)) {
    // Unsupported or conditional ranges remain under the origin server's control.
    const range = rangeHeader && /^bytes=(\d{0,12})-(\d{0,12})$/i.exec(rangeHeader);
    if (request.headers?.has('If-Range') || (rangeHeader && (!range || (!range[1] && !range[2])))) return;
    event.respondWith(musicResponse(request, range));
    return;
  }
  if (request.headers?.has('Range')) return;
  const artwork = /^\.\/assets\/.+\.(?:webp|png|svg|jpe?g|avif|woff2?)$/i.test(relative) &&
    (!url.search || /^\?v=[A-Za-z0-9._-]{1,64}$/.test(url.search));
  const pagePath = relative.endsWith('/index.html') ? relative.slice(0, -10) :
    relative.endsWith('/') ? relative : relative + '/';
  const page = request.mode === 'navigate' && publicFiles.has(pagePath);
  if (!page && !artwork && !publicFiles.has(relative + url.search)) return;

  // Parameterized navigations (including payment returns) can use the offline
  // public document, but their full URLs must never become CacheStorage keys.
  const store = response => {
    if (mayStore(response) && !(page && url.search)) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {}));
    }
    return response;
  };
  if (artwork) {
    event.respondWith(currentMatch(request).then(cached => cached || fetch(request).then(store)));
    return;
  }
  const offlineKey = page ? pagePath : request;
  event.respondWith(fetch(request).then(store).catch(async () =>
    (await currentMatch(offlineKey)) || (page && await currentMatch('./index.html')) || Response.error()));
});
// The browser decrypts the authenticated Web Push payload before this event.
self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{};}catch(_){}
 const title=typeof payload.title==='string'?payload.title.slice(0,100):'戦国VSのお知らせ';
 event.waitUntil(self.registration.showNotification(title,{body:typeof payload.body==='string'?payload.body.slice(0,240):'領国の報告を確認してください。',icon:'./assets/branding/sengoku-vs-icon-192-20261122.png',badge:'./assets/branding/sengoku-vs-favicon-32-20261122.png',tag:'sengoku-update',renotify:false,data:{url:'/?notice=1'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of clients){if(new URL(client.url).origin===self.location.origin){await client.focus();client.postMessage({type:'sengoku-open-recap'});return;}}await self.clients.openWindow('./?notice=1');})());
});
