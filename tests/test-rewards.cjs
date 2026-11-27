'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'rewards.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const socialSource = fs.readFileSync(path.join(root, 'social.js'), 'utf8');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const tests = [];
const test = (name, run) => tests.push({ name, run });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const failure = (code, status = 409) => Object.assign(Error('fixture ' + code), { code, status });
const actor = (id = 'player-a', epoch = 1) => ({ user: { id, name: '領主', email: 'private@example.test', token: 'private-token' }, playerId: id, epoch, accountEpoch: epoch, writable: true, gameWritable: true, pending: false, banned: false });

function storage(initial = []) {
  const records = new Map(initial);
  return { records, get length() { return records.size; }, key: i => [...records.keys()][i] ?? null, getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, String(value)), removeItem: key => records.delete(key) };
}
function rewards({ window = 'morning', claimed = false, amount = 30, active = true, remaining = 3, pending = null } = {}) {
  return { serverNow: '2026-11-27T01:00:00.000Z', login: { day: '2026-11-27', window, label: { morning: '朝', noon: '昼', night: '夜' }[window], claimed, amount: 30, windows: ['morning', 'noon', 'night'].map(value => ({ window: value, claimed: value === window && claimed, amount: 30, creditedAmount: value === window && claimed ? amount : 0 })) }, rerollPass: { active, remainingToday: remaining, usedToday: 3 - remaining, expiresAt: '2026-12-27T01:00:00.000Z', nextResetAt: '2026-11-27T20:00:00.000Z' }, pending };
}
function drawPending({ rerolled = null, available = true } = {}) {
  return { id: 'draw-fixture-a', original: { officerId: 'officer-original', rank: 'C' }, rerolled, rerolledAvailable: available, canReroll: !rerolled, cost: 300 };
}
function response(value, receipt = {}, extra = {}) { return { ok: true, revision: 8, rewards: value, receipt, ...extra }; }

function fixture({ sharedStorage = storage(), identity = actor(), initial = null } = {}) {
  let who = clone(identity), wall = Date.parse('2026-11-27T01:00:00.000Z'), sequence = 0;
  const calls = [], notices = [], effects = [];
  const game = { state: { magatama: 3000, officers: ['existing-officer'], walking: { campaignId: 'campaign-a' } } };
  const sandbox = { module: { exports: {} }, console, Intl, Date, document: { hidden: false }, localStorage: sharedStorage, crypto: { randomUUID: () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0') } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'rewards.js' });
  const options = { getContext: () => who, getGame: () => game, storage: sharedStorage, now: () => wall, api(route, options = {}) { const wait = deferred(); calls.push({ route, options: clone(options), actor: clone(who), ...wait }); return wait.promise; }, notify: text => notices.push(text), onReward: value => effects.push(clone(value)) };
  let controller = sandbox.module.exports.create(options);
  if (initial) controller.accept(initial);
  return { get controller() { return controller; }, sandbox, calls, notices, effects, game, storage: sharedStorage,
    getIdentity: () => clone(who), setIdentity: value => { who = clone(value); }, advance: ms => { wall += ms; },
    reload() { controller = sandbox.module.exports.create(options); return controller; },
    async load(value = rewards()) { const request = controller.refresh({ force: true }); calls.at(-1).resolve(value); await request; }
  };
}

function extract(text, name, indent = '  ') {
  const match = new RegExp('^' + indent + '(?:async )?function ' + name + '\\(', 'm').exec(text);
  assert(match, 'Function available for behavior fixture: ' + name);
  const start = match.index, lineEnd = text.indexOf('\n', start);
  return text.slice(start, text.slice(start, lineEnd).trimEnd().endsWith('}') ? lineEnd : text.indexOf('\n' + indent + '}', start) + indent.length + 2);
}

test('flat GET snapshots and nested mutation responses do not grant local jade or officers', async () => {
  const f = fixture(), before = clone(f.game.state), loading = f.controller.refresh();
  assert.equal(f.calls.at(-1).route, '/rewards');
  assert.equal(f.controller.getState().loaded, false);
  f.calls.at(-1).resolve(rewards()); await loading;
  const request = f.controller.draw(1), call = f.calls.at(-1);
  assert.equal(call.route, '/gacha/draw'); assert.equal(call.options.method, 'POST'); assert.equal(call.options.data.count, 1);
  assert.equal(f.controller.getState().busy, true);
  assert.deepEqual(f.game.state, before);
  assert.equal(f.controller.getState().rewards.rerollPass.remainingToday, 3);
  call.resolve(response(rewards({ pending: drawPending() }), { kind: 'draw', cost: 300, pending: true, results: [] })); await request;
  assert.equal(f.controller.getState().rewards.pending.id, 'draw-fixture-a');
  assert.deepEqual(f.game.state, before); assert.equal(f.controller.getState().pendingOperation, null);
  const exposed = f.controller.getState(); exposed.rewards.pending.original.rank = 'U';
  assert.equal(f.controller.getState().rewards.pending.original.rank, 'C');
});

test('a lost POST keeps one UUID through refresh, reload and relogin, and blocks a second purchase', async () => {
  const f = fixture({ initial: rewards() });
  const request = f.controller.draw(1), first = f.calls.at(-1), rejected = assert.rejects(request, /offline/);
  first.reject(Error('offline after server commit')); await rejected;
  const uuid = first.options.data.requestId;
  await assert.rejects(() => f.controller.draw(10), /前の操作/); assert.equal(f.calls.length, 1);
  await f.load(rewards({ pending: drawPending() }));
  assert.equal(f.controller.getState().pendingOperation.payload.requestId, uuid, 'GET cannot resolve an uncertain transaction receipt');
  f.setIdentity(actor('player-a', 7)); f.reload();
  assert.equal(f.controller.getState().pendingOperation.payload.requestId, uuid);
  const retry = f.controller.retry(), repeated = f.calls.at(-1);
  assert.deepEqual(repeated.options.data, first.options.data);
  repeated.resolve(response(rewards({ pending: drawPending() }), { kind: 'draw', cost: 300, pending: true }, { idempotent: true })); await retry;
  assert.equal(f.storage.records.size, 0); assert.equal(f.controller.getState().pendingOperation, null);
  assert.equal(f.game.state.magatama, 3000);
  assert(!JSON.stringify([...f.storage.records]).includes('private-token'));
});

test('uncertain operations are isolated by player and campaign without losing the original retry', async () => {
  const f = fixture({ initial: rewards() }), request = f.controller.draw(1), rejected = assert.rejects(request);
  f.calls.at(-1).reject(Error('offline')); await rejected;
  const uuid = f.controller.getState().pendingOperation.payload.requestId;
  f.setIdentity(actor('player-b', 2)); assert.equal(f.controller.getState().pendingOperation, null);
  f.setIdentity(actor('player-a', 3)); f.game.state.walking.campaignId = 'campaign-b'; assert.equal(f.controller.getState().pendingOperation, null);
  f.game.state.walking.campaignId = 'campaign-a'; assert.equal(f.controller.getState().pendingOperation.payload.requestId, uuid);
});

test('failure to persist the retry record prevents a network write', async () => {
  const f = fixture(); f.storage.setItem = () => { throw Error('storage full'); };
  await assert.rejects(() => f.controller.draw(1), /storage full/);
  assert.equal(f.calls.length, 0); assert.equal(f.game.state.magatama, 3000); assert.equal(f.controller.getState().busy, false);
});

test('a delayed GET from a previous player cannot overwrite the current reward state', async () => {
  const f = fixture(), old = f.controller.refresh(), oldCall = f.calls.at(-1);
  f.setIdentity(actor('player-b', 2)); const current = f.controller.refresh(), currentCall = f.calls.at(-1);
  currentCall.resolve(rewards({ remaining: 1, claimed: true })); await current;
  oldCall.resolve(rewards({ remaining: 3, pending: drawPending() })); await old;
  assert.equal(f.controller.getState().rewards.rerollPass.remainingToday, 1);
  assert.equal(f.controller.getState().rewards.pending, null);
});

test('an old POST success cannot clear a new player’s in-flight operation', async () => {
  const f = fixture({ initial: rewards() }), old = f.controller.draw(1), oldCall = f.calls.at(-1), rejected = assert.rejects(old, error => error.code === 'STALE_IDENTITY');
  f.setIdentity(actor('player-b', 2)); const current = f.controller.draw(10), currentCall = f.calls.at(-1), uuid = currentCall.options.data.requestId;
  oldCall.resolve(response(rewards({ pending: drawPending() }))); await rejected;
  assert.equal(f.controller.getState().pendingOperation.payload.requestId, uuid); assert.equal(f.controller.getState().busy, true);
  currentCall.resolve(response(rewards({ active: false }), { kind: 'draw', count: 10, cost: 2700, results: [] })); await current;
  assert.equal(f.controller.getState().pendingOperation, null); assert.equal(f.controller.getState().rewards.pending, null);
});

test('a read begun before a successful mutation cannot restore a stale pending choice or allowance', async () => {
  const f = fixture({ initial: rewards({ pending: drawPending() }) }), oldRead = f.controller.refresh({ force: true }), oldCall = f.calls.at(-1);
  const choose = f.controller.choose('draw-fixture-a', 'original');
  f.calls.at(-1).resolve(response(rewards({ pending: null, remaining: 2 }), { kind: 'choose', cost: 0, results: [{ officerId: 'officer-original', rank: 'C' }] })); await choose;
  oldCall.resolve(rewards({ pending: drawPending(), remaining: 3 })); await oldRead;
  assert.equal(f.controller.getState().rewards.pending, null, 'A completed choice must stay completed');
  assert.equal(f.controller.getState().rewards.rerollPass.remainingToday, 2);
  assert.equal(f.controller.getState().loading, false, 'Discarding a stale GET must release the loading state');
  const count = f.calls.length, freshRead = f.controller.refresh({ force: true });
  assert.equal(f.calls.length, count + 1, 'A fresh read remains possible after discarding an old response');
  f.calls.at(-1).resolve(rewards({ remaining: 2 })); await freshRead;
});

test('automatic login claims once per server window and announces the actual credited amount', async () => {
  const f = fixture({ initial: rewards() }), first = f.controller.prime(); await tick();
  assert.equal(f.calls.at(-1).route, '/rewards/login');
  f.calls.at(-1).resolve(response(rewards({ claimed: true, amount: 7 }), { kind: 'login', amount: 7 })); assert.equal(await first, true);
  assert.equal(await f.controller.prime(), false); assert.equal(f.calls.length, 1);
  assert.equal(f.notices.length, 1); assert(f.notices[0].includes('勾玉7')); assert(!f.notices[0].includes('勾玉30'));
  f.advance(3 * 60 * 60 * 1000);
  const noon = f.controller.prime(); assert.equal(f.calls.at(-1).route, '/rewards');
  f.calls.at(-1).resolve(rewards({ window: 'noon' })); await tick();
  assert.equal(f.calls.at(-1).route, '/rewards/login');
  f.calls.at(-1).resolve(response(rewards({ window: 'noon', claimed: true }), { kind: 'login', amount: 30 })); await noon;
  assert.equal(f.notices.length, 2); assert(f.notices[1].includes('昼')); assert.equal(f.effects.length, 2);
});

test('idempotent login receipts do not replay the reward notification', async () => {
  const f = fixture({ initial: rewards() }), prime = f.controller.prime(); await tick();
  f.calls.at(-1).resolve(response(rewards({ claimed: true }), { kind: 'login', amount: 30 }, { idempotent: true })); await prime;
  assert.equal(f.notices.length, 0); assert.equal(f.effects.length, 0);
});

test('automatic claims pause at the title, while hidden, without a writer, or without a linked identity', async () => {
  for (const mode of ['title', 'hidden', 'writer', 'game-writer', 'unlinked', 'banned']) {
    const f = fixture({ initial: rewards() });
    if (mode === 'title') f.sandbox.SENGOKU_AT_TITLE = true;
    if (mode === 'hidden') f.sandbox.document.hidden = true;
    if (mode === 'writer') f.setIdentity({ ...actor(), writable: false });
    if (mode === 'game-writer') f.setIdentity({ ...actor(), gameWritable: false });
    if (mode === 'unlinked') f.setIdentity({ ...actor(), user: null, playerId: '' });
    if (mode === 'banned') f.setIdentity({ ...actor(), banned: true });
    assert.equal(await f.controller.prime(), false, mode); assert.equal(f.calls.length, 0, mode);
  }
});

for (const [code, route, status] of [
  ['MAGATAMA_CAP', 'login', 409], ['LOGIN_BONUS_CLAIMED', 'login', 409],
  ['GACHA_PENDING', 'draw', 409], ['GACHA_UNAVAILABLE', 'draw', 409],
  ['GACHA_PENDING_CHANGED', 'choose', 409], ['GACHA_ALREADY_REROLLED', 'reroll', 409],
  ['REROLL_PASS_REQUIRED', 'reroll', 403], ['REROLL_DAILY_LIMIT', 'reroll', 409],
  ['REROLL_PAYMENT_REVERSED', 'choose', 403], ['REWARDS_STATE_CHANGED', 'choose', 409]
]) test(`${code} is a definite rejection and does not leave an unrecoverable pending operation`, async () => {
  const f = fixture({ initial: rewards({ pending: route === 'choose' || route === 'reroll' ? drawPending() : null }) });
  const action = route === 'login' ? f.controller.claimLogin() : route === 'draw' ? f.controller.draw(1) : route === 'choose' ? f.controller.choose('draw-fixture-a', 'original') : f.controller.reroll('draw-fixture-a');
  const rejected = assert.rejects(action, error => error.code === code); f.calls.at(-1).reject(failure(code, status)); await rejected;
  assert.equal(f.controller.getState().pendingOperation, null, code + ' must let the user return to the remaining valid actions');
  assert.equal(f.controller.getState().busy, false); assert.equal(f.game.state.magatama, 3000);
  if (code === 'MAGATAMA_CAP') assert.equal(f.controller.getState().rewards.login.claimed, false, 'Capacity rejection does not spend the claim slot');
});

test('a terminal already-claimed response does not create an automatic retry loop in the same window', async () => {
  const f = fixture({ initial: rewards() }), first = f.controller.prime(); await tick();
  f.calls.at(-1).reject(failure('LOGIN_BONUS_CLAIMED')); await tick();
  if (f.calls.at(-1).route === '/rewards') f.calls.at(-1).resolve(rewards({ claimed: true }));
  await first;
  const count = f.calls.length, second = f.controller.prime(); await tick();
  if (f.calls.length > count) {
    if (f.calls.at(-1).route === '/rewards') f.calls.at(-1).resolve(rewards({ claimed: true }));
    else { f.calls.at(-1).reject(failure('LOGIN_BONUS_CLAIMED')); await tick(); if (f.calls.at(-1).route === '/rewards') f.calls.at(-1).resolve(rewards({ claimed: true })); }
  }
  await second;
  assert.equal(f.calls.filter(call => call.route === '/rewards/login').length, 1, 'Wait for a fresh window/state instead of repeatedly posting a new UUID');
  assert.equal(f.controller.getState().pendingOperation, null);
});

test('uncertain server and reconciliation failures preserve their receipt key for an explicit retry', async () => {
  for (const error of [failure('INTERNAL_ERROR', 500), failure('REWARDS_RECONCILE_PENDING', 503), failure('AUTH_REQUIRED', 401)]) {
    const f = fixture({ initial: rewards() }), request = f.controller.draw(1), call = f.calls.at(-1), rejected = assert.rejects(request);
    call.reject(error); await rejected;
    assert.equal(f.controller.getState().pendingOperation.payload.requestId, call.options.data.requestId);
    await assert.rejects(() => f.controller.draw(1)); assert.equal(f.calls.length, 1);
  }
});

test('choosing a pending result sends only a choice and never another 300-jade purchase', async () => {
  const f = fixture({ initial: rewards({ pending: drawPending({ rerolled: { officerId: 'officer-new', rank: 'D' } }), remaining: 2 }) });
  const request = f.controller.choose('draw-fixture-a', 'original'), call = f.calls.at(-1);
  assert.equal(call.route, '/gacha/choose'); assert.deepEqual(Object.keys(call.options.data).sort(), ['choice', 'drawId', 'requestId']);
  call.resolve(response(rewards({ remaining: 2 }), { kind: 'choose', cost: 0, results: [{ officerId: 'officer-original', rank: 'C' }] })); await request;
  assert.equal(f.game.state.magatama, 3000); assert.equal(f.controller.getState().rewards.pending, null);
});

function fieldBridge(f) {
  let revision = 7, reconcile = false, refreshes = 0;
  const calls = [], scope = { console, URLSearchParams, localStorage: f.storage, crypto: f.sandbox.crypto, game: f.game, roleEpoch: 1, fieldActionPending: false, state: () => f.game.state,
    processWorldClock() {}, canMutate: () => true, requireWritable: () => true, save: () => true, refreshLiveControls() {}, queueWorldProgress() {},
    window: { SengokuWorldClock: { refresh: async () => {} }, SengokuSocial: { getUser: () => f.getIdentity().user,
      expansionRequest(route, options) { const wait = deferred(); calls.push({ route, options: clone(options), ...wait }); return wait.promise; }
    }, SengokuCloudSync: { getStatus: () => ({ linked: true, writable: true, revision }), getDevice: () => ({ id: 'device-a' }), flush: async () => ({ ok: true }),
      async refresh() { refreshes++; if (reconcile) { revision = 8; f.game.state.magatama = 2700; } return { ok: reconcile }; }
    } }
  };
  vm.createContext(scope);
  vm.runInContext(extract(appSource, 'requestField') + '\n' + extract(appSource, 'requestExpansion'), scope);
  f.controller.configure({ api: scope.requestExpansion });
  return { scope, calls, allowReconcile: () => { reconcile = true; }, get refreshes() { return refreshes; } };
}

test('the real requestField adapter retains one UUID until the paid result is reconciled to cloud state', async () => {
  const f = fixture({ initial: rewards() }), bridge = fieldBridge(f), request = f.controller.draw(1), rejected = assert.rejects(request, error => error.code === 'REWARDS_RECONCILE_PENDING');
  await tick(); const first = bridge.calls.at(-1); assert(first, 'Authenticated reward mutation reached the transport');
  assert.equal(first.route, '/gacha/draw'); assert.equal(first.options.data.deviceId, 'device-a'); assert.equal(first.options.data.expectedRevision, 7);
  const uuid = first.options.data.requestId;
  first.resolve(response(rewards({ pending: drawPending() }), { kind: 'draw', cost: 300, pending: true })); await rejected;
  assert.equal(f.game.state.magatama, 3000, 'An accepted receipt is not an optimistic local grant/spend');
  assert.equal(f.controller.getState().pendingOperation.payload.requestId, uuid);
  f.setIdentity(actor('player-a', 2)); bridge.scope.roleEpoch = 2; f.reload(); f.controller.configure({ api: bridge.scope.requestExpansion }); bridge.allowReconcile();
  const retry = f.controller.retry(); await tick(); const replay = bridge.calls.at(-1);
  assert.equal(replay.options.data.requestId, uuid); assert.equal(replay.options.data.count, 1);
  replay.resolve(response(rewards({ pending: drawPending() }), { kind: 'draw', cost: 300, pending: true }, { idempotent: true })); await retry;
  assert.equal(f.game.state.magatama, 2700); assert.equal(f.controller.getState().pendingOperation, null); assert.equal(f.storage.records.size, 0);
});

test('requestField rejects a previous identity’s late receipt before refreshing another player’s save', async () => {
  const f = fixture({ initial: rewards() }), bridge = fieldBridge(f), request = f.controller.draw(1), rejected = assert.rejects(request, error => error.code === 'STALE_IDENTITY');
  await tick(); const sent = bridge.calls.at(-1);
  f.setIdentity(actor('player-b', 2)); bridge.scope.roleEpoch = 2; bridge.allowReconcile();
  sent.resolve(response(rewards({ pending: drawPending() }), { kind: 'draw', cost: 300, pending: true })); await rejected;
  assert.equal(bridge.refreshes, 0); assert.equal(f.game.state.magatama, 3000); assert.equal(f.controller.getState().rewards, null);
});

function uiFixture(snapshot) {
  const modals = [], sounds = [], notices = [], presentations = [];
  const context = { console, snapshot: clone(snapshot), getExpansionAccess: () => ({ writable: true }), game: { officer: (id, rank) => ({ id, rank, name: id }) }, officerCard: officer => `<article data-officer="${officer.id}" data-rank="${officer.rank}"></article>`, num: String, esc: text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])), gachaScope: () => 'player-a:campaign-a', modal: (...args) => modals.push(args), toast: text => notices.push(text), playNote: value => sounds.push(value), beginGachaPresentation: value => presentations.push(clone(value)), window: {} };
  context.window.SengokuRewards = { getState: () => context.snapshot };
  vm.createContext(context);
  vm.runInContext(extract(appSource, 'showPendingGacha') + '\n' + extract(appSource, 'handleRewardResult'), context);
  return { context, modals, sounds, notices, presentations };
}
function actionButtons(html, action) { return [...html.matchAll(new RegExp('<button\\b[^>]*data-action="' + action + '"[^>]*>', 'g'))].map(match => match[0]); }

test('pending-choice markup protects uncertain operations and permits only one valid final choice', () => {
  const base = { linked: true, busy: false, pendingOperation: null, rewards: rewards({ pending: drawPending() }), error: '' };
  const f = uiFixture(base); f.context.showPendingGacha();
  let markup = f.modals.at(-1); assert.equal(actionButtons(markup[2], 'gacha-choose').length, 1); assert(!actionButtons(markup[2], 'gacha-reroll')[0].includes('disabled'));
  assert(markup[1].includes('勾玉300')); assert(markup[2].includes('選んだ1枚だけ')); assert(markup[3].includes('あとで選ぶ'));
  f.context.snapshot.pendingOperation = { route: '/gacha/reroll', payload: { requestId: 'uncertain' } }; f.context.showPendingGacha(); markup = f.modals.at(-1);
  assert(actionButtons(markup[2], 'gacha-choose').every(tag => tag.includes('disabled'))); assert(actionButtons(markup[2], 'gacha-reroll').every(tag => tag.includes('disabled'))); assert(markup[3].includes('rewards-retry'));
  f.context.snapshot.pendingOperation = null; f.context.snapshot.rewards.pending = drawPending({ rerolled: { officerId: 'officer-new', rank: 'D' }, available: false }); f.context.showPendingGacha(); markup = f.modals.at(-1);
  const choices = actionButtons(markup[2], 'gacha-choose'); assert.equal(choices.length, 2); assert(!choices.find(tag => tag.includes('data-choice="original"')).includes('disabled')); assert(choices.find(tag => tag.includes('data-choice="rerolled"')).includes('disabled')); assert.equal(actionButtons(markup[2], 'gacha-reroll').length, 0);
});

test('result presentation retains the original purchase cost while login notices use actual receipts', () => {
  const f = uiFixture({ rewards: rewards() });
  f.context.handleRewardResult(response(rewards(), { kind: 'choose', cost: 0, results: [{ officerId: 'officer-original', rank: 'C', isNew: true }], refund: 0 }), { cost: 300 });
  assert.equal(f.presentations[0].cost, 300); assert.equal(f.presentations[0].results.length, 1);
  f.context.handleRewardResult(response(rewards({ claimed: true, amount: 4 }), { kind: 'login', amount: 4 }));
  assert(f.notices.at(-1).includes('勾玉4'));
  const count = f.notices.length; f.context.handleRewardResult(response(rewards({ claimed: true }), { kind: 'login', amount: 30 }, { idempotent: true })); assert.equal(f.notices.length, count);
});

test('public reward markup uses Japanese time and escapes failures without exposing account details', () => {
  const f = fixture({ initial: rewards({ window: 'noon', claimed: true }) }), value = f.controller.getState();
  value.error = '<img src=x onerror=alert(1)>'; value.account = actor().user;
  const login = f.sandbox.SengokuRewards.loginMarkup(value), pass = f.sandbox.SengokuRewards.passMarkup(value);
  assert(login.includes('5:00–12:00')); assert(login.includes('12:00–18:00')); assert(login.includes('18:00–翌5:00')); assert(login.includes('日本時間')); assert(login.includes('持ち越しはありません'));
  assert(login.includes('is-current is-claimed')); assert(login.includes('&lt;img')); assert(!login.includes('<img src=x'));
  assert(pass.includes('日本時間')); assert(pass.includes('10連は対象外')); assert(pass.includes('高ランクの確約はありません'));
  assert(!/private@example|private-token|player-a/.test(login + pass));
});

test('partial login credit is shown accurately in the claimed time slot', () => {
  const f = fixture({ initial: rewards({ claimed: true, amount: 7 }) }), html = f.sandbox.SengokuRewards.loginMarkup(f.controller.getState());
  const claimed = /<div class="login-bonus-slot[^\"]*is-claimed[\s\S]*?<\/div>/.exec(html)?.[0];
  assert(claimed, 'Claimed slot is visible'); assert(claimed.includes('+7'), 'A seven-jade receipt must not be presented as thirty received');
});

test('social transport permits the five reward routes and rejects unrelated writes', async () => {
  const calls = [], who = actor();
  const scope = { getExpansionContext: () => who, api: async (route, options) => { calls.push({ route, options: clone(options) }); return { ok: true }; }, staleIdentity: () => failure('STALE_IDENTITY', 409), refresh: async () => {} };
  vm.createContext(scope); vm.runInContext(extract(socialSource, 'expansionRequest', ''), scope);
  await scope.expansionRequest('/rewards');
  for (const route of ['/rewards/login', '/gacha/draw', '/gacha/reroll', '/gacha/choose']) await scope.expansionRequest(route, { method: 'POST', data: { requestId: 'fixture' } });
  assert.equal(calls.length, 5);
  await assert.rejects(() => scope.expansionRequest('/gacha/admin', { method: 'POST' }));
  await assert.rejects(() => scope.expansionRequest('/gacha/draw?other=1', { method: 'POST' }));
  assert.equal(calls.length, 5);
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    let timer;
    try { await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Behavior fixture did not complete within 3 seconds')), 3000); })]); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name + '\n' + (error.stack || error)); }
    finally { clearTimeout(timer); }
  }
  console.log(`${tests.length - failed}/${tests.length} reward controller and interaction checks passed.`);
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
