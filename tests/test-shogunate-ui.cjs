/* Real shogunate UI with an in-memory DOM and server. No live writes. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { documentFixture, storageFixture } = require('./test-events-ui.cjs');
const source = fs.readFileSync(require.resolve('../shogunate.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const OWNER = 'u_' + '1'.repeat(32), OTHER = 'u_' + '2'.repeat(32), RIGHT = 'sg_' + 'a'.repeat(32), OTHER_RIGHT = 'sg_' + 'b'.repeat(32), NOW = Date.parse('2026-11-22T03:00:00Z');
const key = id => 'sengoku-shogunate-pending-v1:' + id;
const access = (id = OWNER) => ({ epoch: 1, accountEpoch: 1, privilegeEpoch: 1, playerId: id, user: { id, name: '試験領主', isAdmin: false, isStaff: false }, pending: false, banned: false });
const right = (id = RIGHT, title = '関ヶ原の戦い・天下統一') => ({ id, sourceType: 'event', sourceId: 'ev_' + 'a'.repeat(32), title, battleId: 'history:sekigahara', earnedAt: NOW - 1000, openedAt: null, governmentName: null, rank: null });
const view = (rights = [right()]) => ({ rights, current: rights.find(item => item.openedAt !== null) || null, campaign: { owned: 1, target: 127, achieved: false, cycle: 0 } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const tests = [], test = (name, run) => tests.push([name, run]);
function setup({ context = access(), storage = storageFixture(), server = { views: new Map([[OWNER, view()], [OTHER, view([right(OTHER_RIGHT, '別の領主の功績')])]]), receipts: new Map(), commits: 0 } } = {}) {
  let who = copy(context), handler = null, flushHandler = null, uuidCalls = 0, flushes = 0;
  const { doc, entry } = documentFixture(), calls = [], toasts = [];
  doc.body.appendChild = node => doc.body.append(node);
  const base = async (route, options = {}) => {
    const current = server.views.get(who.playerId) || view([]);
    if ((options.method || 'GET') === 'GET') return { ok: true, shogunate: copy(current) };
    assert.equal(route, '/shogunate/open'); assert.deepEqual(Object.keys(options.data).sort(), ['requestId', 'rightId']);
    const id = who.playerId + ':' + options.data.requestId;
    if (server.receipts.has(id)) return { ok: true, idempotent: true, receipt: copy(server.receipts.get(id)), shogunate: copy(current) };
    const earned = current.rights.find(item => item.id === options.data.rightId); assert(earned); assert.equal(earned.openedAt, null);
    Object.assign(earned, { openedAt: NOW, governmentName: '試験幕府', rank: '征夷大将軍' }); current.current = copy(earned);
    const receipt = { rightId: earned.id, governmentName: earned.governmentName, openedAt: earned.openedAt, rank: earned.rank, title: earned.title };
    server.receipts.set(id, copy(receipt)); server.commits++; return { ok: true, receipt, shogunate: copy(current) };
  };
  const scope = { console, Date, Intl, JSON, Math, Promise, document: doc, localStorage: storage, crypto: { randomUUID: () => 'shogunate_request_' + ++uuidCalls },
    SengokuSocial: { getExpansionContext: () => copy(who), expansionRequest: (route, options = {}) => { const call = { route, options: copy(options), owner: who.playerId }; calls.push(call); return handler ? handler(route, options, base) : base(route, options); } },
    SengokuCloudSync: { flush: async () => { flushes++; return flushHandler ? flushHandler() : { ok: true }; } },
    SengokuBridge: { toast: (...args) => toasts.push(args) }
  };
  scope.window = scope; vm.createContext(scope); vm.runInContext(source, scope);
  const api = scope.SengokuShogunate, get = selector => doc.querySelector(selector), click = action => { const node = get('[data-shogunate="' + action + '"]'); assert(node, 'Missing control ' + action); get('.shogunate-dialog').dispatch('click', node); };
  return { api, scope, doc, entry, get, click, calls, server, storage, toasts, base, posts: () => calls.filter(call => call.options.method === 'POST'), uuidCalls: () => uuidCalls, flushes: () => flushes, setContext: value => { who = copy(value); }, context: () => copy(who), setHandler: value => { handler = value; }, setFlush: value => { flushHandler = value; } };
}

test('opening and reviewing a right make no POST until the explicit final confirmation', async () => {
  const s = setup(); assert(await s.api.open()); assert.equal(s.flushes(), 1); assert.equal(s.posts().length, 0); assert(s.get('.shogunate-content').textContent.includes('関ヶ原'));
  s.click('prepare'); assert.equal(s.api.getState().hasConfirmation, true); assert.equal(s.posts().length, 0); s.click('cancel'); assert.equal(s.api.getState().hasConfirmation, false); assert.equal(s.posts().length, 0);
  s.click('prepare'); s.click('confirm'); await drain(); assert.equal(s.posts().length, 1); assert.equal(s.server.commits, 1); assert.equal(s.api.getState().hasPending, false); assert.equal(s.storage.getItem(key(OWNER)), null); assert(s.get('.shogunate-current').textContent.includes('試験幕府'));
  s.click('close'); assert.equal(s.get('.shogunate-dialog'), null); assert.equal(s.doc.activeElement, s.entry);
});

test('guest, blocked, pending and mismatched identities cannot open or load the private record', async () => {
  for (const context of [{ ...access(), user: null }, { ...access(), banned: true }, { ...access(), pending: true }, { ...access(), user: { id: OTHER } }]) {
    const s = setup({ context }); assert.equal(await s.api.open(), false); assert.equal(s.calls.length, 0); assert.equal(s.get('.shogunate-dialog'), null); assert.equal(s.toasts.length, 1);
  }
});

test('no earned right provides no opening action and malformed response data is not rendered', async () => {
  const s = setup(); s.server.views.set(OWNER, view([])); await s.api.open(); assert.equal(s.get('[data-shogunate="prepare"]'), null); assert.equal(s.posts().length, 0);
  s.setHandler(async () => ({ ok: true, shogunate: view([{ ...right(), earnedAt: 'invalid' }]) })); s.click('reload'); await drain(); assert(s.api.getState().error); assert.equal(s.get('[data-shogunate="prepare"]'), null); s.api.close();
});

test('double confirmation clicks share one request and pending operations lock other rights', async () => {
  const s = setup(), wait = deferred(); await s.api.open(); s.setHandler((route, options, base) => options.method === 'POST' ? wait.promise : base(route, options));
  s.click('prepare'); const button = s.get('[data-shogunate="confirm"]'), dialog = s.get('.shogunate-dialog'); dialog.dispatch('click', button); dialog.dispatch('click', button); await drain();
  assert.equal(s.posts().length, 1); assert.equal(s.uuidCalls(), 1); assert.equal(s.api.getState().busy, true); assert.equal(s.get('[data-shogunate="prepare"]').disabled, true);
  wait.resolve(await s.base('/shogunate/open', s.posts()[0].options)); await drain(); assert.equal(s.server.commits, 1); assert.equal(s.api.getState().hasPending, false); s.api.close();
});

test('a committed response lost in transit is recovered after reload using the original request ID', async () => {
  const s = setup(); await s.api.open(); let lost = false;
  s.setHandler(async (route, options, base) => { const result = await base(route, options); if (options.method === 'POST' && !lost) { lost = true; throw Error('Response lost'); } return result; });
  s.click('prepare'); s.click('confirm'); await drain(); assert.equal(s.server.commits, 1); assert(s.api.getState().hasPending); const first = copy(s.posts()[0].options.data); s.api.close();
  const restored = setup({ storage: s.storage, server: s.server }); await restored.api.open(); assert(restored.api.getState().hasPending); assert.equal(restored.posts().length, 0); restored.click('retry'); await drain();
  assert.deepEqual(restored.posts()[0].options.data, first); assert.equal(restored.uuidCalls(), 0); assert.equal(restored.server.commits, 1); assert.equal(restored.api.getState().hasPending, false); assert(restored.api.getState().message.includes('記録を確認')); restored.api.close();
});

test('failed or silently unavailable durable storage prevents opening a shogunate', async () => {
  for (const silent of [false, true]) {
    const storage = storageFixture(); storage.setItem = () => { if (!silent) throw Error('Storage disabled'); };
    const s = setup({ storage }); await s.api.open(); s.click('prepare'); s.click('confirm'); await drain(); assert.equal(s.posts().length, 0); assert.equal(s.api.getState().hasPending, false); assert(s.api.getState().error); s.api.close();
  }
});

test('malformed replies and temporary failures keep pending while definitive right rejection clears it', async () => {
  for (const mode of ['temporary', 'malformed', 'rejected']) {
    const s = setup(); await s.api.open(); s.setHandler(async (route, options, base) => { if (options.method !== 'POST') return base(route, options); if (mode === 'malformed') { const result = await base(route, options); result.receipt.rightId = OTHER_RIGHT; return result; } throw Object.assign(Error(mode), { code: mode === 'rejected' ? 'SHOGUNATE_RIGHT_REQUIRED' : 'BUSY', status: mode === 'rejected' ? 409 : 503 }); });
    s.click('prepare'); s.click('confirm'); await drain(); assert.equal(s.api.getState().hasPending, mode !== 'rejected'); assert.equal(Boolean(s.storage.getItem(key(OWNER))), mode !== 'rejected'); assert.equal(s.api.getState().message, ''); s.api.close();
  }
});

test('persisted pending records are bounded, owner-scoped and stripped to the original two fields', async () => {
  for (const record of [{ rightId: RIGHT, requestId: '' }, { rightId: RIGHT, requestId: '../escape' }, { rightId: 'bad', requestId: 'valid' }]) {
    const storage = storageFixture(); storage.setItem(key(OWNER), JSON.stringify(record)); const s = setup({ storage }); await s.api.open(); assert.equal(s.api.getState().hasPending, false); assert.equal(s.posts().length, 0); s.api.close();
  }
  const storage = storageFixture(); storage.setItem(key(OWNER), JSON.stringify({ rightId: RIGHT, requestId: 'restore-one', extra: 'DROP' })); storage.setItem(key(OTHER), JSON.stringify({ rightId: OTHER_RIGHT, requestId: 'other-pending' }));
  const s = setup({ storage }); await s.api.open(); s.click('retry'); await drain(); assert.deepEqual(s.posts()[0].options.data, { rightId: RIGHT, requestId: 'restore-one' }); assert(storage.getItem(key(OTHER))); s.api.close();
});

test('an identity change during the pre-read flush prevents sending the old read', async () => {
  const s = setup(), wait = deferred(); s.setFlush(() => wait.promise); const opening = s.api.open(); await drain();
  s.setContext(access(OTHER)); s.api.refreshAccess(); assert.equal(s.get('.shogunate-dialog'), null); wait.resolve({ ok: true }); assert.equal(await opening, false); assert.equal(s.calls.length, 0);
  s.setFlush(null); assert(await s.api.open()); assert.equal(s.calls[0].owner, OTHER); assert(s.get('.shogunate-content').textContent.includes('別の領主')); s.api.close();
});

test('a late read cannot replace the newly opened record of another identity', async () => {
  const s = setup(), wait = deferred(); let first = true; s.setHandler((route, options, base) => { if (first) { first = false; return wait.promise; } return base(route, options); });
  const old = s.api.open(); await drain(); s.setContext(access(OTHER)); s.api.refreshAccess(); await s.api.open(); const dialog = s.get('.shogunate-dialog');
  wait.resolve({ ok: true, shogunate: view() }); assert.equal(await old, false); assert.equal(s.get('.shogunate-dialog'), dialog); assert.equal(s.api.getState().owner, OTHER); assert(s.get('.shogunate-content').textContent.includes('別の領主')); assert(!s.get('.shogunate-content').textContent.includes('関ヶ原')); s.api.close();
});

test('same-player account, privilege and identity epochs invalidate an in-flight opening result', async () => {
  for (const field of ['epoch', 'accountEpoch', 'privilegeEpoch']) {
    const s = setup(), wait = deferred(); await s.api.open(); s.setHandler((route, options, base) => options.method === 'POST' ? wait.promise : base(route, options));
    s.click('prepare'); s.click('confirm'); await drain(); const result = await s.base('/shogunate/open', s.posts()[0].options);
    s.setContext({ ...s.context(), [field]: 2 }); s.api.refreshAccess(); assert.equal(s.get('.shogunate-dialog'), null); wait.resolve(result); await drain();
    assert.equal(s.api.getState().loaded, false); assert.equal(s.api.getState().message, ''); assert(s.api.getState().hasPending); assert(s.storage.getItem(key(OWNER))); s.api.close();
  }
});

test('blocked-account changes suppress late writes and preserve the original recovery record', async () => {
  const s = setup(), wait = deferred(); await s.api.open(); s.setHandler((route, options, base) => options.method === 'POST' ? wait.promise : base(route, options));
  s.click('prepare'); s.click('confirm'); await drain(); const result = await s.base('/shogunate/open', s.posts()[0].options);
  s.setContext({ ...s.context(), accountEpoch: 2, pending: true }); s.api.refreshAccess(); wait.resolve(result); await drain(); assert.equal(s.api.getState().loaded, false); assert.equal(s.api.getState().hasPending, false); assert.equal(s.api.getState().message, ''); assert(s.storage.getItem(key(OWNER))); assert.equal(await s.api.open(), false); assert.equal(s.posts().length, 1);
});

test('rights and government names are escaped before being rendered into the modal', async () => {
  const s = setup(); s.server.views.get(OWNER).rights[0].title = '<img src=x onerror=alert(1)>'; await s.api.open(); assert(!s.get('.shogunate-content').innerHTML.includes('<img src=x')); assert(s.get('.shogunate-content').innerHTML.includes('&lt;img')); s.click('prepare'); assert(!s.get('.shogunate-content').innerHTML.includes('<img src=x')); s.api.close();
});

(async () => { for (const [name, run] of tests) { await run(); console.log('PASS ' + name); } console.log(tests.length + ' shogunate UI checks passed; no live requests.'); })().catch(error => { console.error(error); process.exitCode = 1; });
