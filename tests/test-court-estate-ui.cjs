/* Canonical shared-estate UI contracts. All players, resources and requests are in memory. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { documentFixture, storageFixture } = require('./test-events-ui.cjs');
const { SENGOKU_DATA: catalog } = require('../engine.js');
const source = fs.readFileSync(require.resolve('../court-estate.js'), 'utf8');
const copy = v => JSON.parse(JSON.stringify(v));
const OWNER = 'u_' + '1'.repeat(32), OTHER = 'u_' + '2'.repeat(32), NOW = '2026-11-28T04:00:00.000Z';
const access = (id = OWNER) => ({ playerId: id, epoch: 1, accountEpoch: 1, privilegeEpoch: 1, user: { id, name: '試験摂政', isStaff: false }, pending: false, banned: false, connected: true, writable: true, gameWritable: true });
const clock = () => ({ elapsedMs: 120000, running: true, speed: 1 });
function view() {
  const buildings = Object.fromEntries(catalog.buildings.map(b => [b.id, b.id === 'keep' ? 8 : 2]));
  return { version: 1, eligible: true, canDevelop: true, accessStamp: 'role-proof-one', role: { id: 'regent', title: '摂政' }, holding: { id: 'kyoto_gosho', name: '京都御所', shared: true, ownership: 'shared', homePreserved: true }, home: { id: 'kiyosu', name: '清洲城' }, base: { revision: 4, castleLevel: 12, maxCastleLevel: 128, buildings, jobs: [], updatedElapsedMs: 120000 }, resources: { gold: 50000, rice: 50000, wood: 50000, stone: 50000 }, command: 5, slots: { used: 0, max: 3 }, actions: [
    { kind: 'castle', id: 'kyoto_gosho', name: '京都御所の城郭', category: 'castle', level: 12, maxLevel: 128, targetLevel: 13, cost: { gold: 3000, rice: 1000, wood: 1500, stone: 2000 }, seconds: 180, queued: false, enabled: true, reason: null, code: null },
    ...catalog.buildings.map(b => ({ kind: 'building', id: b.id, name: b.name, category: b.category, level: buildings[b.id], maxLevel: 32, targetLevel: buildings[b.id] + 1, cost: { gold: 1200, rice: 0, wood: 800, stone: 600 }, seconds: 120, queued: false, enabled: true, reason: null, code: null }))
  ], effects: { active: true, castleId: 'kyoto_gosho', castleLevel: 12, holdingCount: 1, baseIncome: { gold: 265, rice: 390, wood: 95, stone: 85 }, baseTroopCapacity: 500, facilityUpkeep: { gold: 24, rice: 72, wood: 12, stone: 12 } }, serverNow: NOW };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function setup({ context = access(), snapshot = view(), storage = storageFixture(), server = null } = {}) {
  let who = copy(context), handler = null, flushHandler = null, sequence = 0, elapsed = 0, tick = null, surfaceUpdates = 0;
  server ||= { snapshot: copy(snapshot), clock: clock(), receipts: new Map(), commits: 0 };
  const { doc, entry } = documentFixture(), calls = [], toasts = [], sounds = [];
  doc.body.appendChild = node => doc.body.append(node);
  const base = async (route, opts = {}) => {
    if (opts.method !== 'POST') { assert.equal(route, '/court/estate'); return { ok: true, courtEstate: copy(server.snapshot), clock: copy(server.clock) }; }
    assert.equal(route, '/court/estate/upgrade');
    assert.deepEqual(Object.keys(opts.data).sort(), ['accessStamp', 'baseRevision', 'id', 'kind', 'requestId']);
    const p = opts.data, stored = server.receipts.get(p.requestId);
    if (stored) return { ok: true, courtEstate: copy(server.snapshot), clock: copy(server.clock), receipt: copy(stored), idempotent: true };
    assert.equal(p.accessStamp, server.snapshot.accessStamp); assert.equal(p.baseRevision, server.snapshot.base.revision);
    const item = server.snapshot.actions.find(a => a.kind === p.kind && a.id === p.id); assert(item?.enabled);
    const job = { jobId: 'job_' + (server.commits + 1), kind: p.kind, id: p.id, targetLevel: item.targetLevel, startedElapsedMs: server.clock.elapsedMs, completesElapsedMs: server.clock.elapsedMs + item.seconds * 1000, startedBy: { id: OWNER, name: '試験摂政' } };
    const receipt = { requestId: p.requestId, jobId: job.jobId, kind: p.kind, id: p.id, targetLevel: item.targetLevel, cost: copy(item.cost), baseRevision: server.snapshot.base.revision + 1, playerRevision: 10 + server.commits, queued: item.queued, startedElapsedMs: job.startedElapsedMs, completesElapsedMs: job.completesElapsedMs };
    for (const k of Object.keys(item.cost)) server.snapshot.resources[k] -= item.cost[k];
    server.snapshot.command--; server.snapshot.slots.used++; server.snapshot.base.jobs.push(job); server.snapshot.base.revision++;
    item.queued = true; item.targetLevel++; server.receipts.set(p.requestId, copy(receipt)); server.commits++;
    return { ok: true, courtEstate: copy(server.snapshot), clock: copy(server.clock), receipt, idempotent: false };
  };
  const scope = { console, Date, Intl, JSON, Math, Promise, Object, Set, document: doc, localStorage: storage, performance: { now: () => elapsed }, crypto: { randomUUID: () => 'estate_request_' + ++sequence }, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => { tick = null; }, SENGOKU_DATA: catalog,
    SengokuCloudSync: { flush: async () => flushHandler ? flushHandler() : { ok: true } },
    SengokuBridge: { getExpansionAccess: () => copy(who), requestExpansion: (route, opts) => { calls.push({ route, opts: copy(opts), owner: who.playerId }); return handler ? handler(route, opts, base) : base(route, opts); }, refreshCourtEstateSurfaces: () => surfaceUpdates++, toast: (...args) => toasts.push(args), playInterfaceSound: type => sounds.push(type) } };
  scope.window = scope; vm.createContext(scope); vm.runInContext(source, scope);
  const api = scope.SengokuCourtEstate, get = selector => doc.querySelector(selector);
  const click = (action, target) => { const nodes = doc.querySelectorAll('[data-estate="' + action + '"]'), node = target != null ? nodes.find(n => n.getAttribute('data-target') === target || n.getAttribute('data-tab') === target || n.getAttribute('data-filter') === target) : nodes[0]; assert(node, 'Missing action ' + action + ' ' + target); get('.estate-dialog').dispatch('click', node); };
  return { api, scope, doc, get, click, entry, storage, server, calls, toasts, sounds, base, posts: () => calls.filter(c => c.opts.method === 'POST'), surfaceUpdates: () => surfaceUpdates, setHandler: fn => { handler = fn; }, setFlush: fn => { flushHandler = fn; }, setContext: c => { who = copy(c); }, context: () => copy(who), advance: ms => { elapsed += ms; if (server.clock.running) server.clock.elapsedMs += ms * server.clock.speed; tick?.(); }, hasTimer: () => Boolean(tick) };
}
const tests = [], test = (name, fn) => tests.push([name, fn]);
test('DTO accepts all 64 facilities while stripping private role fields and rejecting malformed quotes', () => {
  const s = setup(), raw = view(); raw.secret = 'PRIVATE'; raw.role.isStaff = true; raw.base.secret = 'PRIVATE'; raw.actions[0].secret = 'PRIVATE';
  const clean = s.api.cleanData(raw); assert(clean); assert.equal(clean.actions.length, 65); assert.equal(Object.keys(clean.base.buildings).length, 64); assert(!JSON.stringify(clean).includes('PRIVATE')); assert(!('isStaff' in clean.role));
  for (const mutate of [v => v.base.revision = -1, v => v.actions[0].cost.gold = -1, v => v.resources.secret = 1, v => v.base.castleLevel = 129, v => v.base.buildings.keep = 33, v => v.actions[0].targetLevel = 129, v => v.actions.push(v.actions[0]), v => v.actions[1].id = 'unknown', v => v.holding.homePreserved = false, v => v.base.jobs = Array(2501).fill({}), v => v.effects.baseIncome.gold = -1, v => v.effects.holdingCount = 2]) { const bad = view(); mutate(bad); assert.equal(s.api.cleanData(bad), null); }
});
test('standard castle effects show authoritative base income, capacity and upkeep without inventing a discount', async () => {
  const s = setup(); await s.api.open(); const panel = s.get('.estate-effects'); assert(panel); assert(panel.textContent.includes('一般拠点と同じ領地効果')); assert(panel.textContent.includes('+265')); assert(panel.textContent.includes('+390')); assert(panel.textContent.includes('+500人')); assert(panel.textContent.includes('補正前')); assert(panel.textContent.includes('拠点維持費')); assert(panel.textContent.includes('金銭 24')); assert(!panel.textContent.includes('10％')); assert(!panel.textContent.includes('軽減'));
  s.server.snapshot.effects = { active: false, castleId: 'kyoto_gosho', castleLevel: 0, holdingCount: 0, baseIncome: { gold: 0, rice: 0, wood: 0, stone: 0 }, baseTroopCapacity: 0, facilityUpkeep: { gold: 0, rice: 0, wood: 0, stone: 0 } }; await s.api.refresh({ silent: true }); assert.equal(s.get('.estate-effects'), null); s.api.close();
});
test('authoritative role dismissal removes the standard holding effects display immediately', async () => { const s = setup(); await s.api.open(); assert(s.get('.estate-effects')); s.api.updateAccess(false); assert.equal(s.get('.estate-effects'), null); assert.equal(s.api.holding(), null); s.api.close(); });
test('ordinary regent keeps their home, reviews exact cost, and posts only after explicit confirmation', async () => {
  const s = setup(); assert(await s.api.open()); assert.equal(s.posts().length, 0); assert(s.get('.estate-holdings').textContent.includes('清洲城')); assert(s.get('.estate-holdings').textContent.includes('京都御所'));
  assert.equal(s.context().user.isStaff, false); assert(s.api.prepare('castle', 'kyoto_gosho')); const text = s.get('.estate-confirm').textContent; assert(text.includes('3,000')); assert(text.includes('1,500')); assert(text.includes('指令1回')); assert.equal(s.posts().length, 0);
  s.click('cancel'); assert(!s.api.getState().hasConfirmation); s.api.prepare('castle', 'kyoto_gosho'); s.click('confirm'); await drain();
  assert.equal(s.server.commits, 1); assert.equal(s.api.getState().pending, null); assert(s.api.getState().message.includes('開始しました')); assert.equal(s.api.holding().home.id, 'kiyosu'); assert.equal(s.api.holding().castleLevel, 12, 'Queued levels must not be presented as completed');
  s.click('close'); assert.equal(s.get('.estate-dialog'), null); assert.equal(s.doc.activeElement, s.entry); assert(!s.hasTimer());
});
test('all facilities expose their limits, live jobs and filters without substituting home buildings', async () => {
  const snapshot = view(); snapshot.base.buildings.farm = 32; const farm = snapshot.actions.find(a => a.id === 'farm'); Object.assign(farm, { level: 32, targetLevel: null, cost: null, seconds: 0, enabled: false, reason: '最高段階です。', code: 'BUILDING_MAX' });
  const s = setup({ snapshot }); await s.api.open({ tab: 'facilities' }); assert.equal(s.doc.querySelectorAll('.estate-card').length, 64); assert(s.get('.estate-filters').textContent.includes('すべて 64')); assert.equal(s.api.prepare('building', 'farm'), false);
  s.click('filter', 'diplomacy'); assert.equal(s.doc.querySelectorAll('.estate-card').length, catalog.buildings.filter(b => b.category === 'diplomacy').length); assert(s.api.prepare('building', 'keep')); assert(await s.api.confirm()); s.click('tab', 'jobs');
  assert(s.get('.estate-jobs').textContent.includes('天守 Lv.9')); assert(s.get('.estate-jobs').textContent.includes('試験摂政')); assert.equal(s.api.getState().data.base.buildings.keep, 8); s.advance(30000); await drain(); assert(Number(s.get('progress').value) >= 25); s.api.close();
});
test('guests, banned, pending and mismatched identities cannot request private estate data', async () => {
  for (const change of [{ user: null }, { banned: true }, { pending: true }, { user: { id: OTHER } }]) { const s = setup({ context: { ...access(), ...change } }); assert.equal(await s.api.open(), false); s.api.ensure(); assert.equal(s.calls.length, 0); assert.equal(s.get('.estate-dialog'), null); }
});
test('read-only devices can inspect the holding but cannot prepare or spend resources', async () => {
  const s = setup({ context: { ...access(), writable: false, gameWritable: false } }); await s.api.open(); assert(s.get('.estate-readonly')); assert(s.api.holding()); assert.equal(s.api.prepare('building', 'keep'), false); assert.equal(await s.api.confirm(), false); assert.equal(s.posts().length, 0); s.api.close();
});
test('direct map discovery works without opening court and bounded probes recover later appointments', async () => {
  const s = setup(); s.api.ensure(); await drain(); assert.equal(s.calls.length, 1); assert(s.api.holding()); assert.equal(s.get('.estate-dialog'), null); s.api.ensure(); await drain(); assert.equal(s.calls.length, 1);
  s.setHandler(() => { throw Object.assign(Error('役職が必要です。'), { status: 403, code: 'COURT_ESTATE_REQUIRED' }); }); s.advance(30000); s.api.ensure(); await drain(); assert.equal(s.api.holding(), null); const afterDenied = s.calls.length;
  s.setHandler(null); s.api.ensure(); await drain(); assert.equal(s.calls.length, afterDenied); s.advance(30000); s.api.ensure(); await drain(); assert(s.api.holding());
  s.api.updateAccess(false); assert.equal(s.api.holding(), null); s.api.updateAccess(true); s.api.ensure(); await drain(); assert(s.api.holding()); assert(s.surfaceUpdates() >= 4);
});
test('a newer authoritative denial invalidates an in-flight successful read and clears reviewed action', async () => {
  const s = setup(); await s.api.open(); s.api.prepare('castle', 'kyoto_gosho'); const wait = deferred(); s.setHandler(() => wait.promise); const loading = s.api.refresh({ silent: true });
  s.api.updateAccess(false); assert.equal(s.api.holding(), null); assert.equal(s.api.getState().busy, false); assert(!s.api.getState().hasConfirmation);
  wait.resolve({ ok: true, courtEstate: view(), clock: clock() }); assert.equal(await loading, false); assert.equal(s.api.holding(), null); assert.equal(s.api.getState().data, null); assert.equal(await s.api.confirm(), false); assert.equal(s.posts().length, 0); s.api.close();
});
test('changed role proof or shared revision invalidates a quote before another expenditure', async () => {
  for (const change of [v => v.accessStamp = 'new-appointment', v => v.base.revision++]) { const s = setup(); await s.api.open(); s.api.prepare('castle', 'kyoto_gosho'); change(s.server.snapshot); await s.api.refresh({ silent: true }); assert(!s.api.getState().hasConfirmation); assert.equal(await s.api.confirm(), false); assert.equal(s.posts().length, 0); s.api.close(); }
});
test('lost committed response survives reload and retries exactly once using the stored role proof', async () => {
  const s = setup(); await s.api.open(); let lost = false; s.setHandler(async (route, opts, base) => { const result = await base(route, opts); if (opts.method === 'POST' && !lost) { lost = true; throw Error('Response lost'); } return result; });
  s.api.prepare('building', 'keep'); assert.equal(await s.api.confirm(), false); assert.equal(s.server.commits, 1); assert(s.api.getState().pending); const original = copy(s.posts()[0].opts.data), remaining = copy(s.server.snapshot.resources); s.api.close();
  const restored = setup({ server: s.server, storage: s.storage }); await restored.api.open(); assert(restored.api.getState().pending); assert(await restored.api.retry()); assert.deepEqual(restored.posts()[0].opts.data, original); assert.deepEqual(s.server.snapshot.resources, remaining); assert.equal(s.server.commits, 1); assert.equal(restored.api.getState().pending, null); assert(restored.api.getState().message.includes('受付済み記録')); restored.api.close();
});
test('trusted bridge recovery accepts its effective request ID while rejecting mismatched receipt semantics', async () => {
  for (const invalid of [false, true]) { const s = setup(); await s.api.open(); s.setHandler(async (route, opts, base) => { if (opts.method !== 'POST') return base(route, opts); const result = await base(route, { ...opts, data: { ...opts.data, requestId: 'bridge_retained_request' } }); if (invalid) result.receipt.id = 'farm'; return { ...result, effectiveRequestId: 'bridge_retained_request' }; }); s.api.prepare('building', 'keep'); assert.equal(await s.api.confirm(), !invalid); assert.equal(Boolean(s.api.getState().pending), invalid); assert.equal(s.server.commits, 1); s.api.close(); }
});
test('double confirmation and uncertain state cannot issue an additional construction request', async () => {
  const s = setup(), wait = deferred(); await s.api.open(); s.setHandler((route, opts, base) => opts.method === 'POST' ? wait.promise : base(route, opts)); s.api.prepare('castle', 'kyoto_gosho'); const first = s.api.confirm(); assert.equal(await s.api.confirm(), false); assert.equal(s.api.prepare('building', 'keep'), false); assert.equal(s.posts().length, 1);
  wait.resolve(await s.base('/court/estate/upgrade', s.posts()[0].opts)); assert(await first); assert.equal(s.server.commits, 1); s.api.close();
});
test('storage failure or silently discarded storage writes prevents any expenditure', async () => {
  for (const silent of [false, true]) { const storage = storageFixture(); storage.setItem = () => { if (!silent) throw Error('Storage disabled'); }; const s = setup({ storage }); await s.api.open(); s.api.prepare('castle', 'kyoto_gosho'); assert.equal(await s.api.confirm(), false); assert.equal(s.posts().length, 0); assert(s.api.getState().error); s.api.close(); }
});
test('role loss during a write is rejected, removes access and leaves no optimistic success', async () => {
  const s = setup(); await s.api.open(); s.setHandler((route, opts) => { throw Object.assign(Error('役職が変わりました。'), { status: opts.method === 'POST' ? 409 : 403, code: opts.method === 'POST' ? 'COURT_ESTATE_ACCESS_CHANGED' : 'COURT_ESTATE_REQUIRED' }); }); s.api.prepare('castle', 'kyoto_gosho'); assert.equal(await s.api.confirm(), false); assert.equal(s.api.holding(), null); assert.equal(s.api.getState().pending, null); assert.equal(s.api.getState().message, ''); assert.equal(s.server.commits, 0); s.api.close();
});
test('malformed results stay recoverable while definitive shortages clear pending and refresh the quote', async () => {
  for (const mode of ['malformed', 'shortage', 'retryable']) { const s = setup(); await s.api.open(); s.setHandler(async (route, opts, base) => { if (opts.method !== 'POST') return base(route, opts); if (mode === 'malformed') { const r = await base(route, opts); r.receipt.id = 'wrong'; return r; } throw Object.assign(Error('資源を確認してください。'), { status: 409, code: 'INSUFFICIENT_ASSETS', retryable: mode === 'retryable' }); }); s.api.prepare('castle', 'kyoto_gosho'); assert.equal(await s.api.confirm(), false); assert.equal(Boolean(s.api.getState().pending), mode !== 'shortage'); assert(s.api.getState().error); assert.equal(s.api.getState().message, ''); s.api.close(); }
});
test('account or privilege changes during reads and writes discard stale results without exposing the old holding', async () => {
  for (const mode of ['account', 'privilege']) {
    const s = setup(), read = deferred(); s.setHandler(() => read.promise); const opening = s.api.open(); await drain(); s.setContext(mode === 'account' ? access(OTHER) : { ...access(), privilegeEpoch: 2 }); read.resolve({ ok: true, courtEstate: view(), clock: clock() }); assert.equal(await opening, false); assert.equal(s.get('.estate-dialog'), null); assert.equal(s.api.holding(), null);
    const t = setup(), post = deferred(); await t.api.open(); t.setHandler((route, opts, base) => opts.method === 'POST' ? post.promise : base(route, opts)); t.api.prepare('castle', 'kyoto_gosho'); const writing = t.api.confirm(), record = copy(t.posts()[0].opts); t.setContext(mode === 'account' ? access(OTHER) : { ...access(), privilegeEpoch: 2 }); post.resolve(await t.base('/court/estate/upgrade', record)); assert.equal(await writing, false); assert.equal(t.api.getState().data, null); assert.equal(t.api.getState().message, ''); assert(t.storage.getItem('sengoku-court-estate-pending-v1:' + OWNER));
  }
});
test('identity changes while flushing block the subsequent private read', async () => {
  const s = setup(), wait = deferred(); s.setFlush(() => wait.promise); const opening = s.api.open(); await drain(); s.setContext(access(OTHER)); wait.resolve({ ok: true }); assert.equal(await opening, false); assert.equal(s.calls.length, 0); assert.equal(s.get('.estate-dialog'), null);
});
test('silent shared refresh preserves tab, scroll and focused construction choice', async () => {
  const s = setup(); await s.api.open({ tab: 'facilities' }); const body = s.get('.estate-content'); body.scrollTop = 420; const keep = s.doc.querySelectorAll('[data-estate="prepare"]').find(n => n.getAttribute('data-target') === 'keep'); keep.focus(); s.server.snapshot.resources.gold = 12345; await s.api.refresh({ silent: true });
  assert.equal(s.api.getState().tab, 'facilities'); assert.equal(body.scrollTop, 420); assert.equal(s.doc.activeElement.getAttribute('data-target'), 'keep'); assert.equal(s.api.getState().data.resources.gold, 12345); s.api.close();
});
test('untrusted names are escaped and malformed refreshes do not replace verified shared data', async () => {
  const snapshot = view(); snapshot.home.name = '<img src=x onerror=evil()>'; snapshot.role.title = '<script>evil()</script>'; const s = setup({ snapshot }); await s.api.open(); assert.equal(s.get('img'), null); assert.equal(s.get('script'), null); assert(s.get('.estate-content').textContent.includes('<img'));
  s.setHandler(() => ({ ok: true, courtEstate: { ...view(), resources: {} }, clock: clock() })); assert.equal(await s.api.refresh(), false); assert.equal(s.api.getState().data.base.revision, 4); assert(s.api.getState().error); s.api.close();
});
test('escape restores keyboard focus and stops live polling', async () => { const s = setup(); await s.api.open(); s.get('.estate-dialog').dispatch('cancel'); assert.equal(s.get('.estate-dialog'), null); assert.equal(s.doc.activeElement, s.entry); assert(!s.hasTimer()); });
async function run() { for (const [name, fn] of tests) { await fn(); console.log('PASS ' + name); } console.log(tests.length + ' shared Kyoto estate UI scenarios passed.'); }
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { view, clock, access, setup, drain, deferred, OWNER };
