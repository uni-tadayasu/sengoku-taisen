'use strict';
// Mounted operator controls with isolated request fixtures; no live broadcast.
const assert = require('node:assert/strict');
const { clean, markup, create } = require('../music-broadcast.js');
const { setup: dom } = require('./helpers/dom-model.cjs');
const clone = value => JSON.parse(JSON.stringify(value));
const NOW = '2026-11-27T07:00:00.000Z';
const OFF = { enabled: false, mode: 'loop', revision: 0, startedAt: null, updatedAt: null };
const ADMIN = { user: { id: 'operator', isAdmin: true, isBanned: false }, identity: { id: 'operator', token: 'test-only-original-token' }, epoch: 1, privilegeEpoch: 1, accountEpoch: 1, pending: false, banned: false };
const cases = [], test = (name, run) => cases.push([name, run]);
const drain = async () => { for (let n = 0; n < 16; n++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const on = (revision = 1, mode = 'loop') => ({ enabled: true, mode, revision, startedAt: NOW, updatedAt: NOW });
function setup({ actor = ADMIN, broadcast = OFF } = {}) {
  let context = clone(actor), handler = null, ids = 0, writes = 0;
  const calls = [], updates = [], receipts = new Map(), server = { music: clone(broadcast) };
  const base = async (route, options) => {
    assert.equal(route, '/admin/music');
    if (options.method === 'POST') {
      const body = options.body;
      if (!receipts.has(body.requestId)) {
        if (body.expectedRevision !== server.music.revision) throw Object.assign(Error('another operator tab changed the broadcast'), { status: 409, code: 'MUSIC_REVISION_CONFLICT' });
        writes++;
        server.music = { enabled: body.enabled, mode: body.mode, revision: server.music.revision + 1, startedAt: body.enabled ? NOW : null, updatedAt: NOW };
        receipts.set(body.requestId, true);
      }
    }
    return { ok: true, musicBroadcast: clone(server.music), serverNow: NOW };
  };
  const view = dom();
  const controller = create({
    getContext: () => clone(context),
    uuid: () => '00000000-0000-4000-8000-' + String(++ids).padStart(12, '0'),
    request: async (route, options) => { calls.push({ route, options: clone(options) }); return handler ? handler(route, options, base) : base(route, options); },
    onUpdate: (value, serverNow) => updates.push({ value: clone(value), serverNow })
  });
  const click = (command, mode) => {
    const selector = '[data-bgm-command="' + command + '"]' + (mode ? '[data-bgm-mode="' + mode + '"]' : '');
    const button = view.$(selector); assert(button, 'Missing control: ' + selector);
    button.dispatchEvent({ type: 'click', stopPropagation() {} }); return button;
  };
  return { controller, view, click, calls, updates, server, receipts, writes: () => writes, posts: () => calls.filter(x => x.options.method === 'POST'), setHandler: value => { handler = value; }, setContext: value => { context = clone(value); } };
}

test('broadcast data is typed, bounded and independent from arbitrary extra fields', () => {
  assert.deepEqual(clean(OFF), OFF); assert.deepEqual(clean(on()), on());
  assert.deepEqual(clean({ ...on(), untrusted: '<script>bad()</script>' }), on());
  for (const change of [{ enabled: 'true' }, { mode: 'random' }, { revision: -1 }, { revision: .5 }, { revision: Number.MAX_SAFE_INTEGER + 1 }, { startedAt: null }, { updatedAt: null }, { startedAt: '2026-02-30T07:00:00.000Z' }, { startedAt: '2026-11-28T07:00:00.000Z' }, { updatedAt: 'bad' }]) assert.equal(clean({ ...on(), ...change }), null);
  assert.equal(clean({ ...OFF, startedAt: NOW }), null);
  assert.equal(clean({ ...OFF, revision: 1 }), null);
});

test('unverified, suspended and non-operational accounts cannot make private requests or see role labels', async () => {
  for (const actor of [null, { ...ADMIN, user: null }, { ...ADMIN, identity: null }, { ...ADMIN, user: { ...ADMIN.user, isAdmin: false, isStaff: true } }, { ...ADMIN, user: { ...ADMIN.user, isBanned: true } }, { ...ADMIN, identity: { ...ADMIN.identity, id: 'other' } }, { ...ADMIN, pending: true }, { ...ADMIN, banned: true }]) {
    const s = setup({ actor }); assert.equal(await s.controller.mount(s.view.host), false);
    assert.equal(await s.controller.setEnabled(true), false); assert.equal(await s.controller.setMode('continuous'), false); assert.equal(await s.controller.retry(), false);
    assert.equal(s.calls.length, 0); assert.equal(s.view.$('[role="switch"]'), null); assert.match(s.view.host.textContent, /この領主では設定を変更できません/); assert.doesNotMatch(s.view.host.textContent, /運営|サブ運営/);
    s.controller.dispose();
  }
});

test('mount waits for confirmed state and renders an accessible OFF switch with two modes', async () => {
  const s = setup(), pending = deferred(); s.setHandler(() => pending.promise);
  const loading = s.controller.mount(s.view.host);
  assert.equal(s.view.$('[role="switch"]').disabled, true); assert.equal(await s.controller.setEnabled(true), false);
  pending.resolve({ ok: true, musicBroadcast: OFF, serverNow: NOW }); assert(await loading);
  const switchNode = s.view.$('[role="switch"]'); assert.equal(switchNode.getAttribute('aria-checked'), 'false'); assert.equal(switchNode.disabled, false);
  assert.equal(s.view.$('[data-bgm-mode="loop"]').getAttribute('aria-pressed'), 'true'); assert.equal(s.view.$('[data-bgm-mode="continuous"]').getAttribute('aria-pressed'), 'false');
  assert.match(s.view.host.textContent, /ミュート・音量/); assert.match(s.view.host.textContent, /00004・支度・朝活・昼活・夜活/); assert.equal(s.updates.length, 1);
  s.controller.dispose();
});

test('the mounted ON control writes exactly one known revision and waits before displaying ON', async () => {
  const s = setup(); await s.controller.mount(s.view.host);
  const pending = deferred(); s.setHandler(async (route, options, base) => { const result = await base(route, options); await pending.promise; return result; });
  s.click('toggle'); await drain();
  assert.equal(s.posts().length, 1); assert.equal(s.writes(), 1); assert.equal(s.view.$('[role="switch"]').getAttribute('aria-checked'), 'false'); assert.equal(s.view.$('[role="switch"]').disabled, true);
  assert.deepEqual(s.posts()[0].options, { method: 'POST', body: { enabled: true, mode: 'loop', expectedRevision: 0, requestId: '00000000-0000-4000-8000-000000000001' } });
  assert.equal(await s.controller.setEnabled(true), false); assert.equal(await s.controller.setMode('continuous'), false);
  pending.resolve(); await drain(); assert.equal(s.view.$('[role="switch"]').getAttribute('aria-checked'), 'true'); assert.equal(s.view.$('[role="switch"]').disabled, false); assert.match(s.view.host.textContent, /配信中/);
  s.controller.dispose();
});

test('mode and OFF controls preserve the other setting, with no requests for unchanged values', async () => {
  const s = setup({ broadcast: on(3) }); await s.controller.mount(s.view.host);
  s.click('mode', 'continuous'); await drain();
  assert.equal(s.posts()[0].options.body.enabled, true); assert.equal(s.posts()[0].options.body.mode, 'continuous'); assert.equal(s.posts()[0].options.body.expectedRevision, 3);
  assert.equal(s.view.$('[data-bgm-mode="continuous"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await s.controller.setMode('continuous'), false); assert.equal(await s.controller.setEnabled(true), false);
  assert.equal(await s.controller.setEnabled('false'), false); assert.equal(await s.controller.setMode('random'), false);
  s.click('toggle'); await drain();
  assert.equal(s.posts()[1].options.body.enabled, false); assert.equal(s.posts()[1].options.body.mode, 'continuous'); assert.equal(s.posts()[1].options.body.expectedRevision, 4);
  assert.equal(s.controller.getState().musicBroadcast.startedAt, null); assert.match(s.view.host.textContent, /通常のBGMを再生中/); s.controller.dispose();
});

test('lost responses retain one operation through remount and retry its identical receipt', async () => {
  const s = setup(); await s.controller.mount(s.view.host);
  s.setHandler(async (route, options, base) => { await base(route, options); throw Error('network reply lost'); });
  assert.equal(await s.controller.setEnabled(true), false); const original = clone(s.posts()[0]);
  assert(s.controller.getState().pending); assert.equal(s.view.$('[role="switch"]').disabled, true); assert(s.view.$('[data-bgm-command="retry"]'));
  s.controller.unmount(); await s.controller.mount(s.view.host); assert.equal(s.posts().length, 1); assert.equal(s.calls.length, 2);
  s.setHandler(null); s.click('retry'); await drain();
  assert.equal(s.posts().length, 2); assert.deepEqual(s.posts()[1], original); assert.equal(s.writes(), 1); assert.equal(s.controller.getState().pending, null); assert.equal(s.controller.getState().musicBroadcast.enabled, true);
  s.controller.dispose();
});

test('a conflict reloads the current state and needs a new deliberate selection', async () => {
  const s = setup(); await s.controller.mount(s.view.host);
  s.server.music = on(7, 'continuous'); assert.equal(await s.controller.setEnabled(true), false);
  assert.equal(s.posts().length, 1); assert.equal(s.controller.getState().musicBroadcast.revision, 7); assert.equal(s.controller.getState().pending, null); assert.match(s.view.host.textContent, /別の端末/);
  assert.equal(await s.controller.setEnabled(false), true);
  assert.equal(s.posts()[1].options.body.expectedRevision, 7); assert.notEqual(s.posts()[0].options.body.requestId, s.posts()[1].options.body.requestId); s.controller.dispose();
});

test('public receives never notify the parent and identical polls retain focused controls', async () => {
  const s = setup(); await s.controller.mount(s.view.host); const updates = s.updates.length;
  const button = s.view.$('[role="switch"]'); button.focus();
  assert(s.controller.receive(OFF, NOW)); assert.equal(s.updates.length, updates); assert.equal(s.view.$('[role="switch"]'), button); assert.equal(s.view.doc.activeElement, button);
  assert(s.controller.receive(on(9), NOW)); assert.equal(s.updates.length, updates); assert.equal(s.controller.receive(on(8, 'continuous'), NOW), false);
  assert.equal(s.controller.receive(on(9, 'continuous'), NOW), false); assert.equal(s.controller.receive(on(10), 'bad-clock'), false); assert.equal(s.controller.getState().musicBroadcast.revision, 9);
  assert.equal(s.view.doc.activeElement.getAttribute('data-bgm-command'), 'toggle'); s.controller.dispose();
});

test('repeated mounts on the same host preserve a pending pointer target and focus', async () => {
  const s = setup(); await s.controller.mount(s.view.host);
  const heldTarget = s.view.$('[role="switch"]'); heldTarget.focus(); const calls = s.calls.length;
  for (let i = 0; i < 5; i++) { assert(await s.controller.mount(s.view.host)); assert(s.controller.receive(OFF, NOW)); }
  assert.equal(s.view.$('[role="switch"]'), heldTarget); assert.equal(s.view.doc.activeElement, heldTarget);
  assert.equal(s.calls.length, calls); assert.equal(s.view.host._events.get('click').size, 1);
  heldTarget.dispatchEvent({ type: 'click', stopPropagation() {} }); await drain();
  assert.equal(s.posts().length, 1); assert.equal(s.controller.getState().musicBroadcast.enabled, true); s.controller.dispose();
});

test('an older GET cannot roll back a newer public broadcast', async () => {
  const s = setup(); await s.controller.mount(s.view.host); const pending = deferred(); s.setHandler(() => pending.promise);
  const loading = s.controller.refresh(); assert(s.controller.receive(on(11, 'continuous'), NOW));
  pending.resolve({ ok: true, musicBroadcast: OFF, serverNow: NOW }); assert(await loading);
  assert.equal(s.controller.getState().musicBroadcast.revision, 11); assert.equal(s.updates.at(-1).value.revision, 11); assert.equal(s.updates.at(-1).value.mode, 'continuous'); s.controller.dispose();
});

test('an older write response confirms the operation without reverting a later broadcast', async () => {
  const s = setup(); await s.controller.mount(s.view.host); const pending = deferred(); s.setHandler(() => pending.promise);
  const saving = s.controller.setEnabled(true); assert(s.controller.receive(on(12, 'continuous'), NOW));
  pending.resolve({ ok: true, musicBroadcast: on(1), serverNow: NOW }); assert(await saving);
  assert.equal(s.controller.getState().musicBroadcast.revision, 12); assert.equal(s.controller.getState().pending, null); assert.equal(s.updates.at(-1).value.revision, 12); s.controller.dispose();
});

test('failed reads cannot enable writes, and malformed mutations keep their retry receipt', async () => {
  const s = setup(); s.setHandler(() => Promise.reject(Error('offline'))); assert.equal(await s.controller.mount(s.view.host), false); assert.equal(await s.controller.setEnabled(true), false); assert.equal(s.posts().length, 0);
  s.setHandler(null); assert(await s.controller.refresh()); s.setHandler(() => ({ ok: true, musicBroadcast: { ...on(1), mode: 'invalid' }, serverNow: NOW }));
  assert.equal(await s.controller.setEnabled(true), false); assert(s.controller.getState().pending); assert.equal(s.controller.getState().musicBroadcast.enabled, false);
  s.setHandler(null); assert(await s.controller.retry()); assert.equal(s.posts()[1].options.body.requestId, s.posts()[0].options.body.requestId); s.controller.dispose();
});

test('a server permission denial cannot be undone by a public config poll', async () => {
  const s = setup(); await s.controller.mount(s.view.host); s.setHandler(() => Promise.reject(Object.assign(Error('revoked'), { status: 403 })));
  assert.equal(await s.controller.setEnabled(true), false); assert.equal(s.controller.getState().pending, null); assert.equal(s.controller.getState().denied, true);
  assert(s.controller.receive(on(1), NOW)); assert.equal(await s.controller.setEnabled(false), false); assert.equal(s.view.$('[role="switch"]').disabled, true);
  s.server.music = on(1); s.setHandler(null); assert(await s.controller.refresh()); assert.equal(s.controller.getState().denied, false); assert(await s.controller.setEnabled(false)); s.controller.dispose();
});

test('identity, token, role and account changes discard delayed private responses', async () => {
  for (const replacement of [{ ...ADMIN, identity: { ...ADMIN.identity, token: 'test-only-replaced-token' } }, { ...ADMIN, privilegeEpoch: 2 }, { ...ADMIN, accountEpoch: 2 }, { ...ADMIN, user: { ...ADMIN.user, isAdmin: false } }, { ...ADMIN, pending: true }, { user: { id: 'another', isAdmin: true }, identity: { id: 'another', token: 'another' } }]) {
    const s = setup(); await s.controller.mount(s.view.host); const updates = s.updates.length, pending = deferred(); s.setHandler(() => pending.promise);
    const saving = s.controller.setEnabled(true); s.setContext(replacement); pending.resolve({ ok: true, musicBroadcast: on(), serverNow: NOW }); assert.equal(await saving, false);
    assert.equal(s.updates.length, updates); assert.equal(s.controller.getState().pending, null); assert.equal(s.controller.getState().musicBroadcast.enabled, false); s.controller.dispose();
  }
  const s = setup(), pending = deferred(); s.setHandler(() => pending.promise); const loading = s.controller.mount(s.view.host); s.setContext(null); pending.resolve({ ok: true, musicBroadcast: on(), serverNow: NOW }); assert.equal(await loading, false); assert.equal(s.updates.length, 0); assert.equal(s.controller.getState().authorized, false); s.controller.dispose();
});

test('clear and disposal invalidate in-flight requests and detach mounted events', async () => {
  for (const action of ['clear', 'dispose']) {
    const s = setup(); await s.controller.mount(s.view.host); const pending = deferred(); s.setHandler(() => pending.promise); const updates = s.updates.length;
    const saving = s.controller.setEnabled(true); s.controller[action](); pending.resolve({ ok: true, musicBroadcast: on(), serverNow: NOW }); assert.equal(await saving, false); assert.equal(s.updates.length, updates); assert.equal(s.controller.getState().musicBroadcast.enabled, false);
    if (action === 'dispose') { const count = s.calls.length; s.click('toggle'); await drain(); assert.equal(s.calls.length, count); assert.equal(await s.controller.mount(s.view.host), false); }
    s.controller.dispose();
  }
});

test('feedback is escaped and public snapshots never contain an authentication token', async () => {
  assert(!markup({ authorized: true, loaded: true, musicBroadcast: on(), error: '<img src=x onerror=alert(1)>' }).includes('<img'));
  const s = setup(); await s.controller.mount(s.view.host); assert(!JSON.stringify(s.controller.getState()).includes(ADMIN.identity.token));
  assert(!JSON.stringify(s.calls).includes(ADMIN.identity.token)); s.controller.dispose();
});

(async () => {
  let passed = 0;
  for (const [name, run] of cases) { await run(); passed++; console.log('PASS ' + name); }
  console.log(`Music broadcast UI: ${passed}/${cases.length} passed. No production requests or audio playback.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
