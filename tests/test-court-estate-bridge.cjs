'use strict';
// Exercise the shipped save bridge and facade, with no live account or network.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const field = source.slice(source.indexOf('  async function requestField('), source.indexOf('  async function departCampaign('));
const expansion = source.slice(source.indexOf('  function requestExpansion('), source.indexOf('  function configureProgress('));
const socialSource = fs.readFileSync(require.resolve('../social.js'), 'utf8');
const socialExpansion = socialSource.slice(socialSource.indexOf('async function expansionRequest('), socialSource.indexOf('function getCourtContext('));
const ROUTE = '/court/estate/upgrade', copy = v => JSON.parse(JSON.stringify(v));
function harness() {
  const calls = [], storage = new Map(), ctx = { console, crypto: webcrypto, Date, JSON, URLSearchParams, fieldActionPending: false, roleEpoch: 1 };
  let revision = 7, remoteRevision = 7, writable = true, campaign = 'campaign-one', owner = 'player-one', transport = null, flushed = true, refreshable = true, refreshHook = null, flushHook = null;
  let local = { home: 'kiyosu', clan: '織田家', resources: { gold: 10000, rice: 10000, wood: 10000, stone: 10000 }, buildings: { keep: 4, farm: 3 } }, remote = copy(local);
  const receipts = new Map();
  const status = () => ({ linked: true, writable, revision });
  const base = async (route, options = {}) => {
    if (options.method !== 'POST') return { ok: true };
    if (!receipts.has(options.data.requestId)) { remoteRevision++; remote.resources.gold -= 1000; receipts.set(options.data.requestId, remoteRevision); }
    return { ok: true, revision: remoteRevision, receipt: { requestId: options.data.requestId } };
  };
  const social = { getUser: () => ({ id: owner }), expansionRequest: async (route, options = {}) => { calls.push({ type: 'send', route, options: copy(options) }); return transport ? transport(route, options, base) : base(route, options); } };
  const sync = { getDevice: () => ({ id: 'device-one' }), getStatus: status, flush: async () => { calls.push({ type: 'flush' }); if (flushHook) await flushHook(); return { ok: flushed }; }, refresh: async () => { calls.push({ type: 'refresh' }); if (refreshHook) await refreshHook(); if (!refreshable) return { ok: false }; revision = remoteRevision; local = copy(remote); return { ok: true }; } };
  Object.assign(ctx, { window: { SengokuSocial: social, SengokuCloudSync: sync, SengokuWorldClock: { refresh: async () => calls.push({ type: 'clock' }), accept: () => {} } }, localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k), key: i => [...storage.keys()][i] ?? null, get length() { return storage.size; } }, state: () => ({ walking: { campaignId: campaign }, ...copy(local) }), requireWritable: () => writable, canMutate: () => writable, save: () => { calls.push({ type: 'save' }); return true; }, processWorldClock() {}, refreshLiveControls() {}, queueWorldProgress() {} });
  vm.createContext(ctx); vm.runInContext(field + '\n' + expansion + '\nthis.api = requestExpansion;', ctx);
  return { ctx, api: ctx.api, calls, storage, local: () => copy(local), remote: () => copy(remote), commits: () => receipts.size, setTransport: fn => transport = fn, setWritable: v => writable = v, setFlush: v => flushed = v, setRefreshable: v => refreshable = v, setRefresh: fn => refreshHook = fn, setFlushHook: fn => flushHook = fn, setCampaign: v => campaign = v, setOwner: v => owner = v };
}
const body = () => ({ kind: 'castle', id: 'kyoto_gosho', baseRevision: 4, accessStamp: 'current-regent-appointment', requestId: 'estate-request-one' });
const tests = [], test = (name, fn) => tests.push([name, fn]);
test('read-only estate discovery goes through the facade without entering the save mutation path', async () => { const h = harness(); await h.api('/court/estate'); assert.deepEqual(h.calls.map(x => x.type), ['send']); });
test('construction flushes first, includes device and revision, and reconciles authoritative assets while preserving home', async () => {
  const h = harness(), before = h.local(), payload = body(), result = await h.api(ROUTE, { method: 'POST', data: payload });
  assert.equal(result.revision, 8); assert.equal(result.effectiveRequestId, payload.requestId); assert.deepEqual(h.calls.map(x => x.type), ['clock', 'save', 'flush', 'send', 'refresh']);
  assert.deepEqual(h.calls.find(x => x.type === 'send').options.data, { ...payload, deviceId: 'device-one', expectedRevision: 7 });
  assert.equal(h.local().resources.gold, before.resources.gold - 1000); assert.equal(h.local().home, before.home); assert.equal(h.local().clan, before.clan); assert.deepEqual(h.local().buildings, before.buildings); assert.equal(h.storage.size, 0); assert.equal(h.ctx.fieldActionPending, false);
});
test('read-only, failed flush, and identity change during flush cannot reach the spending endpoint', async () => {
  for (const block of ['readonly', 'flush', 'identity']) { const h = harness(); if (block === 'readonly') h.setWritable(false); if (block === 'flush') h.setFlush(false); if (block === 'identity') h.setFlushHook(() => h.setOwner('other-player')); await assert.rejects(h.api(ROUTE, { method: 'POST', data: body() })); assert.equal(h.calls.filter(x => x.type === 'send').length, 0); assert.equal(h.ctx.fieldActionPending, false); }
});
test('a lost committed response retries its original request, base revision and role proof without a second debit', async () => {
  const h = harness(); let lost = false; h.setTransport(async (route, opts, base) => { const result = await base(route, opts); if (!lost) { lost = true; throw Error('Response lost after commit'); } return { ...result, idempotent: true }; });
  await assert.rejects(h.api(ROUTE, { method: 'POST', data: body() })); assert.equal(h.storage.size, 1); assert([...h.storage.keys()][0].startsWith('sengoku-expansion-pending-v1:'));
  const result = await h.api(ROUTE, { method: 'POST', data: { ...body(), requestId: 'different-caller-id' } }); const sends = h.calls.filter(x => x.type === 'send');
  assert(result.idempotent); assert.equal(result.effectiveRequestId, body().requestId); assert.equal(sends[1].options.data.requestId, sends[0].options.data.requestId); assert.equal(sends[1].options.data.baseRevision, 4); assert.equal(sends[1].options.data.accessStamp, body().accessStamp); assert.equal(sends[1].options.data.expectedRevision, 8); assert.equal(h.commits(), 1); assert.equal(h.local().resources.gold, 9000); assert.equal(h.storage.size, 0);
});
test('a response cannot report success before the authoritative save is reconciled', async () => {
  const h = harness(); h.setRefreshable(false); await assert.rejects(h.api(ROUTE, { method: 'POST', data: body() }), e => e.code === 'COURT_ESTATE_RECONCILE_PENDING'); assert.equal(h.local().resources.gold, 10000); assert.equal(h.remote().resources.gold, 9000); assert.equal(h.commits(), 1); assert.equal(h.storage.size, 1);
  h.setRefreshable(true); await h.api(ROUTE, { method: 'POST', data: body() }); assert.equal(h.local().resources.gold, 9000); assert.equal(h.commits(), 1); assert.equal(h.storage.size, 0);
});
test('account, role or campaign changes after response or reconciliation discard the stale completion', async () => {
  for (const stage of ['response', 'reconcile']) for (const invalidation of ['role', 'campaign', 'owner']) {
    const h = harness(), invalidate = () => { if (invalidation === 'role') h.ctx.roleEpoch++; else if (invalidation === 'campaign') h.setCampaign('new-campaign'); else h.setOwner('other-player'); };
    if (stage === 'response') h.setTransport(async (route, opts, base) => { const result = await base(route, opts); invalidate(); return result; }); else h.setRefresh(invalidate);
    await assert.rejects(h.api(ROUTE, { method: 'POST', data: body() }), e => e.code === 'STALE_IDENTITY'); assert.equal(h.ctx.fieldActionPending, false); assert.equal(h.storage.size, 1);
  }
});
test('definitive role denial clears an uncommitted bridge request and never charges resources', async () => {
  for (const [status, code] of [[403, 'COURT_ESTATE_REQUIRED'], [409, 'COURT_ESTATE_ACCESS_CHANGED'], [409, 'STAFF_BASE_CHANGED']]) { const h = harness(); h.setTransport(async () => { throw Object.assign(Error('Access changed'), { status, code }); }); await assert.rejects(h.api(ROUTE, { method: 'POST', data: body() })); assert.equal(h.storage.size, 0); assert.equal(h.commits(), 0); assert.equal(h.local().resources.gold, 10000); }
});
test('the actual social facade admits only exact estate routes and rejects late responses after privilege changes', async () => {
  const calls = []; let identity = { epoch: 1, accountEpoch: 1, privilegeEpoch: 1, playerId: 'player-one', user: { id: 'player-one' } }, mutate = false;
  const scope = { getExpansionContext: () => copy(identity), staleIdentity: () => Object.assign(Error('Identity changed'), { code: 'STALE_IDENTITY' }), api: async (route, options) => { calls.push({ route, options: copy(options) }); if (mutate) identity.privilegeEpoch++; return { ok: true }; } };
  vm.createContext(scope); vm.runInContext(socialExpansion + '\nthis.request = expansionRequest;', scope);
  await scope.request('/court/estate'); await scope.request(ROUTE, { method: 'POST', data: body() }); assert.equal(calls.length, 2);
  for (const route of ['/court/estate/upgrade?x=1', '/court/estate/upgrade#x', '/court/estate/upgrade/other', '/staff/base/upgrade']) await assert.rejects(scope.request(route, { method: 'POST', data: body() }));
  assert.equal(calls.length, 2); mutate = true; await assert.rejects(scope.request('/court/estate'), e => e.code === 'STALE_IDENTITY');
});
(async () => { for (const [name, fn] of tests) { await fn(); console.log('PASS ' + name); } console.log(tests.length + ' Kyoto estate bridge scenarios passed.'); })().catch(error => { console.error(error); process.exitCode = 1; });
