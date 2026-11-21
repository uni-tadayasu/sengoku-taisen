'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../sw.js'), 'utf8');
const release = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../site-metadata.json'), 'utf8')).release;
const current = 'sengoku-taisen-v' + release;
const origin = 'https://www.kasai-solutions-inc.com';

function fixture({offline = false, failInstall = false} = {}) {
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
        async put(request, response) { records.get(name).set(key(request), response); },
        async addAll(urls) { assert(urls.includes('./index.html')); if (failInstall) throw new Error('precache failed'); calls.push(['precache']); }
      };
    },
    match() { throw new Error('Cross-game cache lookup is forbidden'); }
  };
  const self = {location: {origin}, clients: {async claim() { calls.push(['claim']); }}, async skipWaiting() { calls.push(['skip']); }, addEventListener(name, callback) { listeners[name] = callback; }};
  vm.runInNewContext(source, {self, caches, URL, Promise, Response: {error: () => ({error: true})}, fetch: async () => { if (offline) throw new Error('offline'); return {ok: true, type: 'basic', brand: 'network', clone() { return {...this}; }}; }});
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
  const offline = fixture({offline: true});
  assert.equal((await offline.dispatch('fetch', {method: 'GET', url: origin + '/', mode: 'navigate'})).brand, 'sengoku');
  await online.dispatch('activate');
  assert.deepEqual(online.deleted.sort(), ['pachi-art-v1', 'pachi-fonts-v1', 'pachi-shell-v1', 'sengoku-taisen-v-old'].sort());
  assert(online.records.has(current)); assert(online.records.has('unrelated-records'));
  await online.dispatch('install');
  assert(online.calls.findIndex(c => c[0] === 'precache') < online.calls.findIndex(c => c[0] === 'skip'));
  const failed = fixture({failInstall: true}); await assert.rejects(failed.dispatch('install'), /precache failed/);
  assert(!failed.calls.some(c => c[0] === 'skip'));
  console.log('PASS current-brand asset/offline responses, retired-cache cleanup, unrelated-cache retention, API bypass and safe activation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
