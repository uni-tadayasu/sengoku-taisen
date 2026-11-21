'use strict';
// Authenticated runtime contracts only: all responses and clocks are fixtures.
// No real Stripe checkout, network request, browser storage or game save.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const sources = ['premium-catalog.js', 'premium-runtime.js'].map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]);
const tests = [];
const test = (name, run) => tests.push([name, run]);
const clone = value => JSON.parse(JSON.stringify(value));
const baseTime = Date.parse('2026-11-21T12:00:00.000Z');
const ids = ['gold-banner', 'moonlit-castle', 'supporter'];
const slots = { 'gold-banner': 'nameplate', 'moonlit-castle': 'town', supporter: 'badge' };
const destinations = {
  'gold-banner': 'https://buy.stripe.com/fZu6oI3Iwdcd5kn4Um9MY04',
  'moonlit-castle': 'https://buy.stripe.com/dRmdRa6UI2xz6or1Ia9MY05',
  supporter: 'https://buy.stripe.com/7sY8wQdj6dcdbILaeG9MY06'
};
const reference = 'fixture_order_0123456789abcdef';
const noAppearance = { nameplate: null, town: null, badge: null, ownedProducts: [] };
function identity(id = 'player-a', epoch = 1) {
  return { epoch, playerId: id, user: id ? { id, name: id === 'player-a' ? '甲斐の領主' : '越後の領主' } : null, connected: Boolean(id), pending: false, banned: false };
}
function response(id = 'player-a', { owned = [], equipped = [], expiresAt = baseTime + 2000, ready = true } = {}) {
  return {
    ok: true, player: { id, name: '認証済みの領主' }, ready,
    products: ids.map(productId => ({ id: productId, owned: owned.includes(productId), equipped: equipped.includes(productId), canPurchase: !owned.includes(productId), expiresAt: productId === 'supporter' && owned.includes(productId) ? new Date(expiresAt).toISOString() : null, reason: '' })),
    appearance: Object.fromEntries(ids.map(productId => [slots[productId], equipped.includes(productId) ? productId : null])),
    portalUrl: '', serverNow: new Date(baseTime).toISOString()
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture({ user = identity(), timers = false } = {}) {
  let who = clone(user), monotonic = 10000, wall = baseTime, nextTimer = 0;
  const calls = [], effects = [], reads = [], notifications = [], scheduled = new Map();
  const game = { state: { premium: ids.slice(), supporter: true, resources: { gold: 1234 } }, speed: 1, turn: 10 };
  class WallDate extends Date {
    constructor(...args) { super(...(args.length ? args : [wall])); }
    static now() { return wall; }
  }
  const storage = {
    getItem(key) { reads.push(['storage', key]); return JSON.stringify({ paid: true, purchased: ids, supporter: true }); },
    setItem(...args) { effects.push(['storage-set', ...args]); },
    removeItem(...args) { effects.push(['storage-remove', ...args]); },
    clear() { effects.push(['storage-clear']); }
  };
  const blocked = name => (...args) => { effects.push([name, ...args]); throw Error('Unexpected effect: ' + name); };
  const social = {
    getPremiumContext: () => clone(who),
    premiumRequest(route, options = {}) {
      const wait = deferred();
      calls.push({ route, options: clone(options), actor: clone(who), ...wait });
      return wait.promise;
    },
    open: blocked('social-open')
  };
  const location = {};
  const forged = new URL('https://fixture.example.test/?success=true&payment_status=paid&productId=supporter&session_id=cs_forged#purchased');
  for (const key of ['href', 'search', 'hash']) Object.defineProperty(location, key, { get() { reads.push(['location', key]); return forged[key]; } });
  const sandbox = {
    module: { exports: {} }, URL, URLSearchParams, Date: WallDate, console, location, game,
    localStorage: storage, sessionStorage: storage, performance: { now: () => monotonic },
    fetch: blocked('fetch'), open: blocked('window-open'), navigator: { sendBeacon: blocked('beacon') },
    SengokuBridge: { state: () => game.state, save: blocked('save'), grantPremium: blocked('grant-premium') },
    setTimeout(callback, delay) { const id = ++nextTimer; scheduled.set(id, { callback, at: monotonic + delay }); return id; },
    clearTimeout(id) { scheduled.delete(id); }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const [file, source] of sources) vm.runInContext(source, sandbox, { filename: file });
  const runtime = sandbox.module.exports.createRuntime({ social, now: () => monotonic, noTimers: !timers, onChange: value => notifications.push(clone(value)) });
  async function load(value = response(who.user?.id || 'player-a')) {
    const count = calls.length, pending = runtime.refresh();
    assert.equal(calls.length, count + 1, 'Expected one fixture GET');
    assert.equal(calls.at(-1).route, '/premium');
    calls.at(-1).resolve(value);
    return pending;
  }
  return {
    runtime, calls, effects, reads, notifications, game, sandbox, scheduled, load,
    setIdentity(value) { who = clone(value); },
    advance(ms) { monotonic += ms; },
    setWall(value) { wall = value; },
    fireDue() { for (const [id, timer] of [...scheduled]) if (timer.at <= monotonic) { scheduled.delete(id); timer.callback(); } }
  };
}
function closed(runtime, message = '') {
  const value = runtime.getContext();
  assert.notEqual(value.status, 'ready', message);
  assert.equal(value.ready, false, message);
  assert.deepEqual(clone(value.appearance), noAppearance, message);
  assert(value.products.every(p => !p.owned && !p.equipped && !p.canPurchase), message);
}
async function noMutation(f, action) {
  const count = f.calls.length;
  await assert.rejects(action);
  assert.equal(f.calls.length, count, 'Rejected local actions must not call the service');
}

test('only a verified account and ready product response enable purchase or equipment', async () => {
  for (const user of [identity(''), { ...identity(''), playerId: 'player-a', pending: true }, { ...identity(), banned: true }]) {
    const f = fixture({ user });
    await f.runtime.refresh(); closed(f.runtime);
    await noMutation(f, () => f.runtime.checkout('gold-banner'));
    await noMutation(f, () => f.runtime.equip('gold-banner'));
    assert.equal(f.calls.length, 0); f.runtime.dispose();
  }
  const f = fixture();
  await f.load(response('player-a', { ready: false }));
  assert.equal(f.runtime.getContext().ready, false);
  await noMutation(f, () => f.runtime.checkout('gold-banner'));
  await f.load();
  assert.equal(f.runtime.getContext().ready, true);
  assert(f.runtime.getContext().products.every(p => !p.owned && p.canPurchase));
  await noMutation(f, () => f.runtime.checkout('unknown-product'));
  await noMutation(f, () => f.runtime.equip('gold-banner'));
  f.runtime.dispose();
});

test('a delayed GET for a previous identity cannot overwrite the current account', async () => {
  const f = fixture(), old = f.runtime.refresh(), oldCall = f.calls.at(-1);
  f.setIdentity(identity('player-b', 2));
  const current = f.runtime.refreshIdentity(), currentCall = f.calls.at(-1);
  currentCall.resolve(response('player-b', { owned: ['moonlit-castle'], equipped: ['moonlit-castle'] }));
  await current;
  oldCall.resolve(response('player-a', { owned: ids, equipped: ids }));
  await old;
  assert.equal(f.runtime.getContext().user.id, 'player-b');
  assert.deepEqual(clone(f.runtime.getAppearance()), { ...noAppearance, town: 'moonlit-castle', ownedProducts: ['moonlit-castle'] });
  assert.equal(f.runtime.getContext().products.find(p => p.id === 'gold-banner').owned, false);
  f.runtime.dispose();
});

test('an old GET cannot undo confirmed equipment or checkout mutations', async () => {
  const f = fixture();
  await f.load(response('player-a', { owned: ['gold-banner'] }));
  const old = f.runtime.refresh(), oldCall = f.calls.at(-1);
  const equip = f.runtime.equip('gold-banner');
  assert.deepEqual(f.calls.at(-1).options, { method: 'PUT', data: { slot: 'nameplate', productId: 'gold-banner' } });
  f.calls.at(-1).resolve(response('player-a', { owned: ['gold-banner'], equipped: ['gold-banner'] }));
  await equip;
  oldCall.resolve(response()); await old;
  assert.equal(f.runtime.getAppearance().nameplate, 'gold-banner');
  const older = f.runtime.refresh(), olderCall = f.calls.at(-1);
  const purchase = f.runtime.checkout('moonlit-castle'), purchaseCall = f.calls.at(-1);
  const callsBeforeRefresh = f.calls.length;
  await f.runtime.refresh();
  assert.equal(f.calls.length, callsBeforeRefresh, 'No GET should race an active mutation');
  olderCall.resolve(response()); await older;
  purchaseCall.resolve({ ok: true, productId: 'moonlit-castle', url: destinations['moonlit-castle'] + '?client_reference_id=' + reference });
  const destination = await purchase;
  assert.equal(destination.playerId, 'player-a');
  assert.equal(f.runtime.getAppearance().nameplate, 'gold-banner');
  f.runtime.dispose();
});

test('logout and BAN immediately clear rights and discard late GET and mutation successes', async () => {
  for (const next of [identity('', 2), { ...identity('player-a', 1), banned: true }]) {
    const f = fixture(); await f.load(response('player-a', { owned: ids, equipped: ids }));
    const old = f.runtime.refresh(), call = f.calls.at(-1);
    f.setIdentity(next); const clearing = f.runtime.refreshIdentity();
    closed(f.runtime); await clearing;
    call.resolve(response('player-a', { owned: ids, equipped: ids })); await old;
    closed(f.runtime); f.runtime.dispose();
  }
  for (const action of ['checkout', 'equip']) {
    const f = fixture(); await f.load(response('player-a', { owned: ['gold-banner'] }));
    const pending = action === 'checkout' ? f.runtime.checkout('moonlit-castle') : f.runtime.equip('gold-banner');
    const call = f.calls.at(-1), rejected = assert.rejects(pending);
    f.setIdentity(identity('player-b', 2));
    const refresh = f.runtime.refreshIdentity();
    f.calls.at(-1).resolve(response('player-b')); await refresh;
    call.resolve(action === 'checkout' ? { ok: true, productId: 'moonlit-castle', url: destinations['moonlit-castle'] + '?client_reference_id=' + reference } : response('player-a', { owned: ['gold-banner'], equipped: ['gold-banner'] }));
    await rejected;
    assert.equal(f.runtime.getContext().user.id, 'player-b');
    assert.deepEqual(clone(f.runtime.getAppearance()), noAppearance); f.runtime.dispose();
  }
});

test('missing, malformed or wrong-owner server snapshots fail closed', async () => {
  const cases = [
    ['missing response', () => null], ['failed response', p => ({ ...p, ok: false })],
    ['wrong owner', p => ({ ...p, player: { id: 'player-b' } })],
    ['missing timestamp', p => { delete p.serverNow; return p; }],
    ['invalid timestamp', p => ({ ...p, serverNow: 'not-a-time' })],
    ['numeric timestamp', p => ({ ...p, serverNow: 0 })],
    ['ambiguous timestamp', p => ({ ...p, serverNow: '1' })],
    ['missing products', p => { delete p.products; return p; }],
    ['non-array products', p => ({ ...p, products: { supporter: { owned: true } } })],
    ['missing known product', p => ({ ...p, products: p.products.slice(0, 2) })],
    ['unknown instead of known product', p => { p.products[2].id = 'forged-supporter'; return p; }]
  ];
  for (const [name, change] of cases) {
    const f = fixture(); await f.load(response('player-a', { owned: ids, equipped: ids }));
    await f.load(change(response('player-a', { owned: ids, equipped: ids })));
    closed(f.runtime, name); await noMutation(f, () => f.runtime.checkout('gold-banner')); f.runtime.dispose();
  }
  const f = fixture(), malformed = response('player-a', { owned: ids, equipped: ids });
  malformed.products[0].owned = 'true'; malformed.products[2].expiresAt = 'invalid';
  await f.load(malformed);
  assert.equal(f.runtime.getContext().products[0].owned, false);
  assert.equal(f.runtime.getContext().products[2].owned, false);
  assert.deepEqual(clone(f.runtime.getAppearance()), { ...noAppearance, town: 'moonlit-castle', ownedProducts: ['moonlit-castle'] });
  f.runtime.dispose();
});

test('supporter expires at the server deadline using monotonic time, independent of game and device clocks', async () => {
  const f = fixture(); await f.load(response('player-a', { owned: ['supporter'], equipped: ['supporter'] }));
  f.game.speed = 1000000; f.game.turn += 100000; f.setWall(baseTime + 100 * 365 * 86400000);
  f.advance(1999);
  assert.equal(f.runtime.getAppearance().badge, 'supporter');
  f.setWall(baseTime - 100 * 365 * 86400000); f.advance(1);
  const expired = f.runtime.getContext().products.find(p => p.id === 'supporter');
  assert.equal(expired.owned, false); assert.equal(expired.equipped, false); assert.equal(expired.canPurchase, false);
  assert.equal(f.runtime.getAppearance().badge, null);
  await noMutation(f, () => f.runtime.equip('supporter'));
  await noMutation(f, () => f.runtime.checkout('supporter'));
  f.runtime.dispose();
});

test('the expiry timer notifies open views before rechecking the service', async () => {
  const f = fixture({ timers: true });
  await f.load(response('player-a', { owned: ['supporter'], equipped: ['supporter'] }));
  f.advance(2010); f.fireDue();
  assert.equal(f.notifications.at(-1).appearance.badge, null);
  assert.equal(f.notifications.at(-1).products.find(p => p.id === 'supporter').canPurchase, false);
  assert.equal(f.calls.length, 2);
  const recheck = f.runtime.refresh();
  assert.equal(f.calls.length, 2, 'Manual refresh shares the timer refresh');
  f.calls.at(-1).reject(Error('fixture offline after expiry'));
  await recheck;
  closed(f.runtime); f.runtime.dispose(); assert.equal(f.scheduled.size, 0);
});

test('checkout accepts only the configured product URL, one opaque reference and the unchanged authenticated user', async () => {
  const good = destinations['gold-banner'] + '?client_reference_id=' + reference;
  const badUrls = [
    'https://other.example.test/pay?client_reference_id=' + reference,
    'https://buy.stripe.com.other.example.test/pay?client_reference_id=' + reference,
    destinations['moonlit-castle'] + '?client_reference_id=' + reference,
    good.replace('https:', 'http:'), good.replace('https:', ''),
    good.replace('https://', 'https://name:password@'),
    good + '&redirect=https://other.example.test/', good + '&client_reference_id=' + reference + '_second',
    good + '#success', destinations['gold-banner'], destinations['gold-banner'] + '?client_reference_id=short',
    destinations['gold-banner'] + '?client_reference_id=' + 'a'.repeat(201),
    destinations['gold-banner'] + '?client_reference_id=' + reference + '%2Fother',
    ' ' + good, good.replace('buy.stripe', 'buy.\nstripe'), good.replace('/fZu', '\\fZu'), null, { href: good }
  ];
  for (const url of badUrls) {
    const f = fixture(); await f.load();
    const pending = f.runtime.checkout('gold-banner'), rejected = assert.rejects(pending, undefined, String(url));
    assert.equal(f.calls.at(-1).route, '/premium/checkout');
    f.calls.at(-1).resolve({ ok: true, productId: 'gold-banner', url }); await rejected;
    assert.deepEqual(f.effects, []); f.runtime.dispose();
  }
  for (const result of [{ ok: false, productId: 'gold-banner', url: good }, { ok: true, productId: 'supporter', url: good }]) {
    const f = fixture(); await f.load();
    const pending = f.runtime.checkout('gold-banner'), rejected = assert.rejects(pending);
    f.calls.at(-1).resolve(result); await rejected; f.runtime.dispose();
  }
  for (const id of ids) {
    const f = fixture(); await f.load();
    const pending = f.runtime.checkout(id);
    assert.deepEqual(f.calls.at(-1).options, { method: 'POST', data: { productId: id } });
    const url = destinations[id] + '?client_reference_id=' + reference;
    f.calls.at(-1).resolve({ ok: true, productId: id, url });
    assert.deepEqual(clone(await pending), { url, productId: id, playerId: 'player-a' });
    assert(f.runtime.getContext().products.every(p => !p.owned), 'Opening checkout does not grant ownership');
    assert.deepEqual(f.effects, []); f.runtime.dispose();
  }
});

test('equipment is restricted to owned products and matching slots, including unequip', async () => {
  const f = fixture(); await f.load(response('player-a', { owned: ['gold-banner'] }));
  for (const [id, slot] of [['moonlit-castle', 'town'], ['supporter', 'badge'], ['gold-banner', 'town'], ['unknown', 'nameplate'], ['gold-banner', 'resources']]) await noMutation(f, () => f.runtime.equip(id, slot));
  const equip = f.runtime.equip('gold-banner', 'nameplate');
  f.calls.at(-1).resolve(response('player-a', { owned: ['gold-banner'], equipped: ['gold-banner'] })); await equip;
  assert.equal(f.runtime.getAppearance().nameplate, 'gold-banner');
  const copied = f.runtime.getContext(); copied.products[1].owned = true; copied.appearance.town = 'moonlit-castle'; copied.user.id = 'player-b';
  assert.equal(f.runtime.getAppearance().town, null); assert.equal(f.runtime.getContext().user.id, 'player-a');
  await noMutation(f, () => f.runtime.equip('moonlit-castle'));
  const clear = f.runtime.equip(null, 'nameplate');
  assert.deepEqual(f.calls.at(-1).options, { method: 'PUT', data: { slot: 'nameplate', productId: null } });
  f.calls.at(-1).resolve(response('player-a', { owned: ['gold-banner'] })); await clear;
  assert.equal(f.runtime.getAppearance().nameplate, null); f.runtime.dispose();
});

test('current network failures clear appearance and purchasing, while an old account failure cannot clear the new one', async () => {
  for (const action of ['refresh', 'checkout', 'equip']) {
    const f = fixture(); await f.load(response('player-a', { owned: ['gold-banner'], equipped: ['gold-banner'] }));
    const pending = action === 'refresh' ? f.runtime.refresh() : action === 'checkout' ? f.runtime.checkout('moonlit-castle') : f.runtime.equip('gold-banner');
    const settled = action === 'refresh' ? pending : assert.rejects(pending);
    f.calls.at(-1).reject(Error('fixture network failure')); await settled;
    closed(f.runtime, action); await noMutation(f, () => f.runtime.checkout('moonlit-castle')); f.runtime.dispose();
  }
  const f = fixture(); await f.load(response('player-a', { owned: ['gold-banner'] }));
  const old = f.runtime.equip('gold-banner'), oldCall = f.calls.at(-1), rejected = assert.rejects(old);
  f.setIdentity(identity('player-b', 2));
  const next = f.runtime.refreshIdentity(); f.calls.at(-1).resolve(response('player-b', { owned: ['moonlit-castle'], equipped: ['moonlit-castle'] })); await next;
  oldCall.reject(Error('old owner network failure')); await rejected;
  assert.equal(f.runtime.getContext().status, 'ready'); assert.equal(f.runtime.getAppearance().town, 'moonlit-castle'); f.runtime.dispose();
});

test('losing the current connection immediately blocks a previously ready account', async () => {
  const f = fixture();
  await f.load(response('player-a', { owned: ['gold-banner', 'supporter'], equipped: ['gold-banner', 'supporter'] }));
  assert.equal(f.runtime.getContext().ready, true);
  assert.equal(f.runtime.getContext().products.find(p => p.id === 'moonlit-castle').canPurchase, true);
  assert.equal(f.runtime.getAppearance().nameplate, 'gold-banner');
  f.setIdentity({ ...identity(), connected: false });
  await noMutation(f, () => f.runtime.checkout('moonlit-castle'));
  closed(f.runtime);
  assert.equal(f.runtime.getContext().status, 'offline');
  assert.equal(f.runtime.getContext().user.id, 'player-a', 'A lost connection does not change the recipient account');
  assert.deepEqual(clone(f.runtime.getAppearance()), noAppearance);
  assert.equal(f.notifications.at(-1).status, 'offline');
  assert.deepEqual(f.notifications.at(-1).appearance, noAppearance);
  await noMutation(f, () => f.runtime.equip('gold-banner'));
  await noMutation(f, () => f.runtime.equip(null, 'nameplate'));
  f.setIdentity(identity());
  closed(f.runtime, 'Reconnect alone must not restore cached entitlements');
  f.runtime.dispose();
});

test('disconnect discards an in-flight GET and requires a fresh verified response to restore rights', async () => {
  const f = fixture();
  await f.load(response('player-a', { owned: ['gold-banner'], equipped: ['gold-banner'] }));
  const old = f.runtime.refresh(), oldCall = f.calls.at(-1);
  f.runtime.disconnect();
  closed(f.runtime);
  assert.equal(f.runtime.getContext().status, 'offline');
  const notificationsAfterDisconnect = f.notifications.length;
  oldCall.resolve(response('player-a', { owned: ids, equipped: ids }));
  assert.equal((await old).status, 'offline');
  closed(f.runtime, 'The delayed successful GET must not restore any rights');
  assert.equal(f.notifications.length, notificationsAfterDisconnect, 'The stale GET must not publish a ready state');
  assert.equal(f.notifications.at(-1).status, 'offline');
  await noMutation(f, () => f.runtime.checkout('moonlit-castle'));
  await noMutation(f, () => f.runtime.equip('gold-banner'));
  await f.load(response('player-a', { owned: ['gold-banner'], equipped: ['gold-banner'] }));
  assert.equal(f.runtime.getContext().ready, true);
  assert.equal(f.runtime.getAppearance().nameplate, 'gold-banner');
  assert.equal(f.runtime.getContext().products.find(p => p.id === 'supporter').owned, false);
  f.runtime.dispose();
});

test('forged success query, saved premium flags and caller changes never grant rights or access storage', async () => {
  const f = fixture(), gameBefore = JSON.stringify(f.game);
  await f.load();
  assert(f.game.state.premium.includes('supporter'), 'The fixture actually contains forged imported ownership');
  assert(f.runtime.getContext().products.every(p => !p.owned));
  assert.deepEqual(clone(f.runtime.getAppearance()), noAppearance);
  await noMutation(f, () => f.runtime.equip('supporter'));
  assert.equal(JSON.stringify(f.game), gameBefore);
  assert.deepEqual(f.reads, []); assert.deepEqual(f.effects, []); f.runtime.dispose();
});

test('verified owned products remain visible without equipment and disappear on revocation or expiry', async () => {
  const f = fixture(); await f.load(response('player-a', { owned: ids }));
  assert.deepEqual(clone(f.runtime.getAppearance()), { ...noAppearance, ownedProducts: ids });
  const copy = f.runtime.getAppearance(); copy.ownedProducts.length = 0;
  assert.deepEqual(clone(f.runtime.getAppearance().ownedProducts), ids, 'Callers cannot erase or add cached ownership');
  f.advance(2000);
  assert.deepEqual(clone(f.runtime.getAppearance().ownedProducts), ['gold-banner', 'moonlit-castle']);
  const revoked = response('player-a', { owned: ['moonlit-castle'] }); revoked.appearance.ownedProducts = ids;
  await f.load(revoked);
  assert.deepEqual(clone(f.runtime.getAppearance().ownedProducts), ['moonlit-castle'], 'Authenticated products override a contradictory appearance array');
  f.runtime.dispose();
});

test('public ownership icons are ordered, accessible and independent from staff roles or local flags', () => {
  const f = fixture(), { cleanAppearance, nameMarkup, ownershipLabel } = f.sandbox.module.exports;
  const look = { ownedProducts: ['supporter', 'gold-banner', 'moonlit-castle', 'gold-banner', 'unknown'], isAdmin: true, isStaff: true };
  assert.deepEqual(clone(cleanAppearance(look).ownedProducts), ids);
  const html = nameMarkup('<img src=x onerror="bad()">', look);
  assert.equal((html.match(/data-premium-product=/g) || []).length, 3);
  assert(!html.includes('<button')); assert(!html.includes('<img src=x')); assert(html.includes('&lt;img'));
  for (const label of ['金彩の旗印を所有', '月影の城下を所有', '戦国VSサポーター（有効）']) assert(html.includes('aria-label="' + label + '"'));
  assert(!/運営|スタッフ/.test(html)); assert.equal(ownershipLabel(look), '金彩の旗印を所有・月影の城下を所有・戦国VSサポーター（有効）');
  for (const invalid of [null, { isAdmin: true, isStaff: true }, { owned: true, purchased: ids }, { ownedProducts: 'supporter' }]) assert(!nameMarkup('領主', invalid).includes('data-premium-product='));
  f.runtime.dispose();
});

(async () => {
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed++; console.error('FAIL ' + name); console.error(error); }
  }
  console.log(JSON.stringify({ passed: tests.length - failed, failed, realPayments: 0, externalRequests: 0, gameSaves: 0, fixtureOnly: true }));
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
