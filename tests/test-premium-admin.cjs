'use strict';
// Operator review fixtures only. No real payment, entitlement, account or network is used.
const assert = require('node:assert/strict');
const { createController, createUI, cleanHold, holdMarkup, confirmationMarkup } = require('../premium-admin.js');
const clone = value => JSON.parse(JSON.stringify(value));
const tests = [], test = (name, run) => tests.push([name, run]);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const ADMIN = { id: 'u_' + '1'.repeat(32), name: '運営', isAdmin: true, isStaff: false };
const REASON = 'Stripeで支払いと異議申し立ての終了を確認しました。';
const key = hold => hold.scope + ':' + hold.objectId;
function hold(extra = {}) {
  return { scope: 'session', objectId: 'cs_fixture', revision: 1, eventId: 'evt_fixture', reason: 'dispute_review', createdAt: '2026-11-21T01:00:00Z', updatedAt: '2026-11-21T02:00:00Z', canRelease: true, players: [{ id: 'u_' + '2'.repeat(32), name: '甲斐の領主' }], ...extra };
}
function setup({ user = ADMIN, context = { epoch: 1, privilegeEpoch: 1 }, rows = [hold()] } = {}) {
  let actor = clone(user), access = clone(context), handler, nextRequest = 0, releases = 0;
  const calls = [], changes = [], receipts = new Map(), server = { rows: clone(rows), nextCursor: null };
  const base = async (route, settings) => {
    if (settings.method !== 'POST') return { ok: true, holds: clone(server.rows), nextCursor: server.nextCursor, serverNow: '2026-11-21T03:00:00Z' };
    const body = settings.body;
    if (receipts.has(body.requestId)) return { ...clone(receipts.get(body.requestId)), idempotent: true };
    const current = server.rows.find(row => row.scope === body.scope && row.objectId === body.objectId);
    if (!current || current.revision !== body.expectedRevision || current.eventId !== body.expectedEventId) throw Object.assign(Error('hold changed'), { status: 409 });
    assert.equal(current.canRelease, true); assert(['refund_review', 'dispute_review', 'fraud_review'].includes(current.reason));
    const result = { ok: true, idempotent: false, review: { id: 'prv_' + String(++releases).padStart(32, '0'), scope: body.scope, objectId: body.objectId, revision: body.expectedRevision, eventId: body.expectedEventId, reason: body.reason.normalize('NFC').trim(), createdAt: '2026-11-21T03:00:00Z' } };
    receipts.set(body.requestId, result); server.rows = server.rows.filter(row => row !== current); return clone(result);
  };
  const options = {
    getUser: () => clone(actor), getContext: () => clone(access), uuid: () => 'review_request_' + ++nextRequest,
    request(route, settings = { method: 'GET' }) { calls.push({ route, settings: clone(settings) }); return handler ? handler(route, settings, base) : base(route, settings); },
    onChange: state => changes.push(state)
  };
  const controller = createController(options);
  function prepare(reason = REASON, selected = server.rows[0]) {
    assert(controller.select(key(selected))); controller.setReason(reason); return controller.prepare();
  }
  return { controller, options, calls, changes, server, receipts, prepare, releases: () => releases, posts: () => calls.filter(call => call.settings.method === 'POST'), setHandler(value) { handler = value; }, setUser(value) { actor = clone(value); }, setContext(value) { access = clone(value); } };
}

test('only an unbanned primary operator with current context can open or request private reviews', async () => {
  for (const user of [null, { ...ADMIN, isAdmin: false }, { ...ADMIN, isAdmin: false, isStaff: true }, { ...ADMIN, isBanned: true }]) {
    const s = setup({ user }); assert.equal(await s.controller.open(), false); assert.equal(s.controller.getState().authorized, false);
    assert.equal(s.controller.select(key(hold())), false); assert.equal(s.controller.prepare(), false); assert.equal(await s.controller.confirm(), false); assert.equal(await s.controller.retry(), false);
    assert.equal(s.calls.length, 0); s.controller.dispose();
  }
  const s = setup({ context: null }); assert.equal(await s.controller.open(), false); assert.equal(s.calls.length, 0); s.controller.dispose();
});

test('holds and cursor pages are validated and only the three releasable soft reasons allow selection', async () => {
  for (const reason of ['refund_review', 'dispute_review', 'fraud_review']) assert.equal(cleanHold(hold({ reason })).canRelease, true);
  for (const reason of ['refund', 'charge_refunded', 'dispute_lost', 'conflicting_snapshot', 'new_unknown_reason']) assert.equal(cleanHold(hold({ reason })).canRelease, false);
  for (const change of [{ revision: 0 }, { revision: -1 }, { revision: 1.1 }, { objectId: 'pi_wrong_scope' }, { eventId: 'not_an_event' }, { scope: 'unknown' }, { players: [{ id: 'bad<id>', name: '対象' }] }]) assert.equal(cleanHold(hold(change)), null);
  const first = hold(), hard = hold({ scope: 'charge', objectId: 'ch_fixture', reason: 'refund', canRelease: false });
  const s = setup({ rows: [first, hard] }); s.server.nextCursor = 'next page+&'; await s.controller.open();
  assert.equal(s.controller.select(key(hard)), false); assert.equal(s.controller.getState().holds.length, 2);
  s.setHandler(async (route, settings, base) => {
    assert.equal(route, '/admin/premium/reviews?limit=20&cursor=next%20page%2B%26');
    return { ok: true, holds: [first, hold({ scope: 'invoice', objectId: 'in_second' })], nextCursor: null, serverNow: '2026-11-21T03:00:00Z' };
  });
  assert(await s.controller.loadMore()); assert.equal(s.controller.getState().holds.length, 3); assert.equal(s.controller.getState().nextCursor, null); s.controller.dispose();
});

test('an explicit confirmation follows a valid normalized reason and posts the exact reviewed revision and event', async () => {
  const s = setup(); await s.controller.open(); assert(s.controller.select(key(hold())));
  for (const reason of ['', '短い理由', ' '.repeat(20), 'あ'.repeat(501)]) { s.controller.setReason(reason); assert.equal(s.controller.prepare(), false); assert.equal(s.posts().length, 0); }
  s.controller.setReason('  Stripeで決済状況と解除理由を確認しました。  '); assert(s.controller.prepare());
  const confirmation = s.controller.getState().confirmation;
  assert.equal(confirmation.body.reason, 'Stripeで決済状況と解除理由を確認しました。'); assert.equal(s.posts().length, 0);
  s.controller.setReason('確認後には変更しない'); assert.deepEqual(s.controller.getState().confirmation, confirmation);
  assert(await s.controller.confirm()); assert.equal(s.posts().length, 1);
  assert.deepEqual(s.posts()[0], { route: '/admin/premium/reviews', settings: { method: 'POST', body: confirmation.body } });
  assert.equal(s.releases(), 1); assert.equal(s.controller.getState().pending, null); assert.equal(s.controller.getState().holds.length, 0); assert.match(s.controller.getState().status, /解除結果を確認/); s.controller.dispose();
});

test('double clicks cannot send a second operation and an uncertain result retries the identical request after reopening', async () => {
  const s = setup(), wait = deferred(); await s.controller.open(); assert(s.prepare());
  s.setHandler(async (route, settings, base) => { const result = await base(route, settings); return settings.method === 'POST' ? wait.promise : result; });
  const sending = s.controller.confirm(); assert.equal(await s.controller.confirm(), false); await drain(); assert.equal(s.posts().length, 1); assert.equal(s.releases(), 1);
  wait.reject(Error('reply lost')); assert.equal(await sending, false); const pending = s.controller.getState().pending;
  assert(pending); s.controller.close(); await s.controller.open(); assert.deepEqual(s.controller.getState().pending, pending);
  assert.equal(s.controller.select(key(hold())), false); assert.equal(s.controller.prepare(), false);
  s.setHandler(null); assert(await s.controller.retry()); assert.equal(s.posts().length, 2); assert.deepEqual(s.posts()[0].settings.body, s.posts()[1].settings.body); assert.equal(s.releases(), 1); assert.equal(s.controller.getState().pending, null); s.controller.dispose();
});

test('a conflict clears the old reason and confirmation, reloads the newest hold, and requires a new review', async () => {
  const s = setup(); await s.controller.open(); assert(s.prepare()); const old = s.controller.getState().confirmation;
  s.server.rows[0].revision = 2; s.server.rows[0].eventId = 'evt_new_risk';
  assert.equal(await s.controller.confirm(), false); const state = s.controller.getState();
  assert.equal(state.pending, null); assert.equal(state.confirmation, null); assert.equal(state.selected, null); assert.equal(state.reason, ''); assert.equal(state.holds[0].revision, 2); assert.match(state.status, /やり直してください/);
  assert.equal(await s.controller.confirm(), false); assert.equal(await s.controller.retry(), false); assert.equal(s.posts().length, 1); assert.equal(s.releases(), 0);
  assert(s.prepare('新しいイベントとStripeの最新状態を確認しました。')); const fresh = s.controller.getState().confirmation;
  assert.notEqual(fresh.body.requestId, old.body.requestId); assert.equal(fresh.body.expectedRevision, 2); assert.equal(fresh.body.expectedEventId, 'evt_new_risk'); assert(await s.controller.confirm()); assert.equal(s.releases(), 1); s.controller.dispose();
});

test('unrelated review receipts remain uncertain and definite rejection cannot reuse the old reason', async () => {
  for (const change of [r => { r.review.eventId = 'evt_other'; }, r => { r.review.objectId = 'cs_other'; }, r => { r.review.revision++; }, r => { r.review.reason = '別の確認理由が記録されています。'; }, r => { r.review.id = 'not_a_review'; }]) {
    const s = setup(); await s.controller.open(); assert(s.prepare());
    s.setHandler(async (route, settings, base) => { const result = await base(route, settings); if (settings.method === 'POST') change(result); return result; });
    assert.equal(await s.controller.confirm(), false); assert(s.controller.getState().pending); assert.match(s.controller.getState().error, /解除結果を確認/); s.controller.dispose();
  }
  const s = setup(); await s.controller.open(); assert(s.prepare()); s.setHandler(async () => { throw Object.assign(Error('解除対象ではありません'), { status: 400 }); });
  assert.equal(await s.controller.confirm(), false); assert.equal(s.controller.getState().pending, null); assert.equal(s.controller.getState().confirmation, null); assert.equal(s.controller.getState().reason, ''); assert.equal(await s.controller.retry(), false); s.controller.dispose();
});

test('role, BAN, account and privilege changes discard private reads and close the view', async () => {
  for (const change of [s => s.setUser({ ...ADMIN, isAdmin: false, isStaff: true }), s => s.setUser({ ...ADMIN, isBanned: true }), s => s.setUser({ ...ADMIN, id: 'u_another_admin' }), s => s.setContext({ epoch: 2, privilegeEpoch: 1 }), s => s.setContext({ epoch: 1, privilegeEpoch: 2 })]) {
    const s = setup(), wait = deferred(); s.setHandler(() => wait.promise); const loading = s.controller.open(); change(s);
    wait.resolve({ ok: true, holds: [hold()], nextCursor: null }); await loading;
    const state = s.controller.getState(); assert.equal(state.open, false); assert.deepEqual(state.holds, []); assert.equal(state.pending, null); assert.equal(state.error, ''); assert.equal(state.status, ''); s.controller.dispose();
  }
});

test('clear invalidates queued operations and delayed successful posts cannot cross to another owner', async () => {
  const early = setup(); await early.controller.open(); assert(early.prepare()); const queued = early.controller.confirm(); early.controller.clear();
  assert.equal(await queued, false); assert.equal(early.posts().length, 0); assert.equal(early.controller.getState().open, false); early.controller.dispose();
  const s = setup(), wait = deferred(); await s.controller.open(); assert(s.prepare()); let receipt;
  s.setHandler(async (route, settings, base) => { const result = await base(route, settings); if (settings.method === 'POST') { receipt = result; return wait.promise; } return result; });
  const sending = s.controller.confirm(); await drain(); assert.equal(s.releases(), 1);
  s.setUser({ id: 'u_another_admin', name: '別の運営', isAdmin: true }); s.controller.clear(); wait.resolve(receipt); assert.equal(await sending, false);
  const state = s.controller.getState(); assert.equal(state.pending, null); assert.deepEqual(state.holds, []); assert.equal(state.status, ''); assert.equal(state.error, ''); s.controller.dispose();
});

test('an older list response cannot replace a fresh list after closing and reopening', async () => {
  const s = setup(), wait = deferred(); s.setHandler(() => wait.promise); const older = s.controller.open(); s.controller.close();
  s.server.rows = [hold({ objectId: 'cs_new_list' })]; s.setHandler(null); await s.controller.open();
  wait.resolve({ ok: true, holds: [hold({ objectId: 'cs_old_list' })], nextCursor: 'old', serverNow: '' }); await older;
  assert.equal(s.controller.getState().holds[0].objectId, 'cs_new_list'); assert.equal(s.controller.getState().nextCursor, null); s.controller.dispose();
});

test('names, machine reasons and operator notes are escaped while payment identifiers remain visible', () => {
  const item = cleanHold(hold({ players: [{ id: 'u_fixture', name: '<img src=x onerror="bad()">' }], reason: '<script>bad()</script>', canRelease: true }));
  const html = holdMarkup(item);
  assert(!html.includes('<img')); assert(!html.includes('<script>')); assert(html.includes('&lt;img')); assert(html.includes('cs_fixture')); assert(html.includes('evt_fixture')); assert(html.includes('閲覧のみ')); assert(!html.includes('data-premium-admin="select"'));
  const confirmation = confirmationMarkup({ hold: hold(), body: { reason: '<script>危険な文字列も本文として扱います</script>', requestId: 'review_fixture' } });
  assert(!confirmation.includes('<script>')); assert(confirmation.includes('&lt;script&gt;')); assert(confirmation.includes('cs_fixture')); assert(confirmation.includes('evt_fixture')); assert(confirmation.includes('返金の実行は行いません'));
});

const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[entity]));
class Element {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.parentElement = null; this.attributes = {}; this.events = {}; this.id = ''; this.className = ''; this._text = ''; this._html = ''; this.value = ''; this.open = false; this.disabled = false; this.hidden = false; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); if (name === 'class') this.className = String(value); if (name === 'disabled') this.disabled = true; if (name === 'hidden') this.hidden = true; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  get isConnected() { return this === this.document.body || this.document.body.contains(this); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); for (const child of [...this.children]) child.remove(); }
  get innerHTML() { return this._html; }
  set innerHTML(value) {
    this._html = String(value); this._text = ''; for (const child of [...this.children]) child.remove(); const stack = [this];
    for (const part of this._html.match(/<[^>]*>|[^<]+/g) || []) {
      if (part.startsWith('</')) { stack.pop(); continue; }
      if (!part.startsWith('<')) { stack.at(-1)._text += decode(part); continue; }
      const match = /^<([a-zA-Z0-9-]+)([\s\S]*?)\/?\s*>$/.exec(part); if (!match) continue;
      const node = new Element(match[1], this.document);
      for (const attr of match[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1], decode(attr[2] || ''));
      stack.at(-1).append(node); if (!['IMG', 'INPUT', 'BR', 'HR', 'META', 'LINK'].includes(node.tagName)) stack.push(node);
    }
  }
  append(node) { node.remove(); node.parentElement = this; this.children.push(node); return node; }
  remove() { if (!this.parentElement) return; if (this.contains(this.document.activeElement)) this.document.activeElement = this.document.body; const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) { if (selector === '*') return true; if (selector.startsWith('#')) return this.id === selector.slice(1); if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1)); const match = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector); if (match) return this.hasAttribute(match[1]) && (match[2] === undefined || this.getAttribute(match[1]) === match[2]); return this.tagName === selector.toUpperCase(); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) { return this.children.flatMap(node => [node, ...node.querySelectorAll('*')]).filter(node => node.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
  dispatch(type, target = this, extra = {}) { const event = { target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; for (const handler of this.events[type] || []) handler(event); return event; }
  focus() { this.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; if (!this.deferCloseEvent) this.dispatch('close'); }
}
function uiSetup(options) {
  const s = setup(options), doc = { createElement: tag => new Element(tag, doc) }; doc.body = doc.createElement('body'); doc.activeElement = doc.body;
  const opener = doc.createElement('button'); doc.body.append(opener); opener.focus();
  const ui = createUI({ ...s.options, document: doc }), get = selector => doc.body.querySelector(selector);
  const click = action => { const node = get('[data-premium-admin="' + action + '"]'); assert(node, 'Missing ' + action); return get('#premium-admin-modal').dispatch('click', node); };
  const type = value => { const node = get('#premium-admin-reason'); node.value = value; get('#premium-admin-modal').dispatch('input', node); };
  return { ...s, ui, doc, opener, get, click, type };
}

test('the native dialog preserves input focus, requires review, and closes only itself on Escape', async () => {
  const s = uiSetup(); await s.ui.open(); const dialog = s.get('#premium-admin-modal'); assert(dialog.open);
  s.click('select'); const input = s.get('#premium-admin-reason'); assert.equal(s.doc.activeElement, input); s.type(REASON); assert.equal(s.get('#premium-admin-reason'), input); assert.equal(s.doc.activeElement, input);
  dialog.dispatch('submit', s.get('[data-admin-form]')); assert.equal(s.posts().length, 0); assert.equal(s.doc.activeElement, s.get('#premium-admin-confirm-title')); assert(s.get('[data-admin-confirm]').textContent.includes('cs_fixture'));
  s.click('back'); assert.equal(s.get('#premium-admin-reason').value, REASON); assert.equal(s.doc.activeElement, input);
  const event = dialog.dispatch('keydown', input, { key: 'Escape' }); assert(event.prevented && event.stopped); assert.equal(s.ui.isOpen(), false); assert.equal(s.doc.activeElement, s.opener); assert.equal(s.get('[data-admin-holds]').textContent, ''); assert.equal(s.get('[data-admin-editor]').textContent, ''); s.ui.dispose();
});

test('queued close events cannot clear a reopened dialog and clear/dispose remove private DOM', async () => {
  const s = uiSetup(); await s.ui.open(); const dialog = s.get('#premium-admin-modal'); dialog.deferCloseEvent = true; s.ui.close(); await s.ui.open();
  const list = s.get('[data-admin-holds]'); assert(list.textContent.includes('cs_fixture')); dialog.dispatch('close'); assert.equal(s.ui.isOpen(), true); assert(list.textContent.includes('cs_fixture'));
  s.click('select'); s.type(REASON); s.setUser({ ...ADMIN, isAdmin: false, isStaff: true }); s.ui.clear();
  assert.equal(s.ui.isOpen(), false); assert.equal(s.doc.activeElement, s.opener); assert.equal(s.get('[data-admin-editor]').textContent, ''); assert.equal(s.get('[data-admin-holds]').textContent, ''); assert.equal(await s.ui.open(), false);
  s.ui.dispose(); assert.equal(s.get('#premium-admin-modal'), null); s.controller.dispose();
  const denied = uiSetup({ user: { ...ADMIN, isAdmin: false } }); assert.equal(await denied.ui.open(), false); assert.equal(denied.get('#premium-admin-modal'), null); assert.equal(denied.calls.length, 0); denied.ui.dispose(); denied.controller.dispose();
});

(async () => {
  let failed = 0;
  for (const [name, run] of tests) { try { await run(); console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name); console.error(error); } }
  console.log(JSON.stringify({ passed: tests.length - failed, failed, externalRequests: 0, realPayments: 0, entitlementGrants: 0, fixtureOnly: true })); if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
