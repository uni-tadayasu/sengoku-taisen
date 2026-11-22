'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../sw.js'), 'utf8');
const release = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../site-metadata.json'), 'utf8')).release;
const current = 'sengoku-taisen-v' + release;
const origin = 'https://www.kasai-solutions-inc.com';

function fixture({offline = false, failInstall = false, updating = false, cacheControl = ''} = {}) {
  const listeners = {}, deleted = [], calls = [], records = new Map();
  const key = request => typeof request === 'string' ? new URL(request, origin + '/').href : request.url;
  for (const name of ['pachi-shell-v1', 'pachi-art-v1', 'pachi-fonts-v1', 'sengoku-taisen-v-old', 'unrelated-records', current]) records.set(name, new Map());
  records.get('pachi-art-v1').set(origin + '/assets/icon-192.png', {brand: 'retired'});
  records.get('pachi-shell-v1').set(origin + '/index.html', {brand: 'retired'});
  records.get(current).set(origin + '/assets/icon-192.png', {brand: 'sengoku'});
  records.get(current).set(origin + '/index.html', {brand: 'sengoku'});
  const caches = {
    async keys() { return [...records.keys()]; },
    async delete(name) { deleted.push(name); return records.delete(name); },
    async open(name) {
      if (!records.has(name)) records.set(name, new Map());
      return {
        async match(request) { calls.push(['match', name]); return records.get(name).get(key(request)); },
        async put(request, response) { records.get(name).set(key(request), response); calls.push(['put',key(request)]); }
      };
    },
    match() { throw new Error('Cross-game cache lookup is forbidden'); }
  };
  const self = {registration:{scope:origin+'/',active:updating?{}:null},location: {origin}, clients: {async claim() { calls.push(['claim']); }}, async skipWaiting() { calls.push(['skip']); }, addEventListener(name, callback) { listeners[name] = callback; }};
  const html='<link rel="manifest" href="manifest.webmanifest?v='+release+'"><script src="mini.bundle.js?v=1234567890ab"></script>';
  vm.runInNewContext(source, {self, caches, URL, Promise, Response, fetch: async request => {
    if(offline)throw new Error('offline');
    const url=key(request);calls.push(['fetch',url]);
    if(failInstall&&url.includes('mini.bundle.js'))throw new Error('precache failed');
    const document=url.endsWith('index.html'),type=document?'text/html':url.includes('.js?')?'text/javascript':url.includes('.webmanifest?')?'application/manifest+json':url.includes('.webp')?'image/webp':'text/plain';
    return {ok: true,status:200,type:'basic',brand:'network',headers:new Headers({'Cache-Control':cacheControl,'Content-Type':type}),clone(){return {...this};},text:async()=>document?html:''};
  }});
  async function dispatch(name, request) {
    let response; const pending = [];
    listeners[name]({request, waitUntil(promise) { pending.push(promise); }, respondWith(promise) { response = promise; }});
    const result = response && await response;
    await Promise.all(pending); return result;
  }
  return {dispatch, records, deleted, calls};
}
(async () => {
  const online = fixture();
  assert.equal((await online.dispatch('fetch', {method: 'GET', url: origin + '/assets/icon-192.png'})).brand, 'sengoku');
  online.records.get(current).delete(origin + '/assets/icon-192.png');
  assert.equal((await online.dispatch('fetch', {method: 'GET', url: origin + '/assets/icon-192.png'})).brand, 'network');
  assert.equal(await online.dispatch('fetch', {method: 'GET', url: origin + '/api/v1/premium'}), undefined);
  for (const request of [
    {url: origin + '/private/document'},
    {url: origin + '/assets/icon-192.png', headers: new Headers({Authorization: 'Bearer fixture'})},
    {url: origin + '/assets/icon-192.png', headers: new Headers({Cookie:'fixture=private'})},
    {url: origin + '/assets/icon-192.png', headers: new Headers({Range: 'bytes=0-10'})},
    {url: origin + '/assets/icon-192.png', cache: 'no-store'}
  ]) assert.equal(await online.dispatch('fetch', {method: 'GET', ...request}), undefined);
  const returnURL = origin + '/?notice=1';
  assert.equal((await online.dispatch('fetch', {method: 'GET', url: returnURL, mode: 'navigate'})).brand, 'network');
  assert(!online.records.get(current).has(returnURL));
  const uncached = origin + '/assets/new-scene.webp';
  for (const policy of ['private, max-age=300', 'no-store', 'no-cache']) {
    const controlled = fixture({cacheControl: policy});
    await controlled.dispatch('fetch', {method: 'GET', url: uncached});
    assert(!controlled.records.get(current).has(uncached));
  }
  const offline = fixture({offline: true});
  assert.equal((await offline.dispatch('fetch', {method: 'GET', url: returnURL, mode: 'navigate'})).brand, 'sengoku');
  assert.equal((await offline.dispatch('fetch', {method: 'GET', url: origin + '/', mode: 'navigate'})).brand, 'sengoku');
  await online.dispatch('activate');
  assert.deepEqual(online.deleted.sort(), ['pachi-art-v1', 'pachi-fonts-v1', 'pachi-shell-v1', 'sengoku-taisen-v-old'].sort());
  assert(online.records.has(current)); assert(online.records.has('unrelated-records'));
  await online.dispatch('install');
  assert(online.calls.findIndex(c => c[0] === 'put'&&c[1].endsWith('index.html')) < online.calls.findIndex(c => c[0] === 'skip'));
  assert(!online.calls.some(c=>c[0]==='fetch'&&/assets\/kamon|assets\/music|assets\/map/.test(c[1])));
  const repeat=online.calls.filter(c=>c[0]==='fetch').length;
  const fetchReq=url=>({method:'GET',url:origin+'/'+url});
  await online.dispatch('fetch',{...fetchReq(''),mode:'navigate'});
  await online.dispatch('fetch',fetchReq('mini.bundle.js?v=1234567890ab'));
  assert.equal(online.calls.filter(c=>c[0]==='fetch').length,repeat,'Warm page and fingerprinted scripts require zero transfers');
  const upgraded=fixture({updating:true});await upgraded.dispatch('install');assert(!upgraded.calls.some(c=>c[0]==='skip'),'A new worker must wait while an older client is playing');
  const failed = fixture({failInstall: true}); await assert.rejects(failed.dispatch('install'), /precache failed/);
  assert(!failed.calls.some(c => c[0] === 'skip'));
  console.log('PASS current-brand asset/offline responses, retired-cache cleanup, unrelated-cache retention, API bypass and safe activation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
