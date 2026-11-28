'use strict';
// Operator review fixtures only. No real payment, entitlement, account or network is used.
const assert = require('node:assert/strict');
const { createController, createUI, cleanHold, cleanMetrics, holdMarkup, confirmationMarkup, metricsMarkup } = require('../premium-admin.js');
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

function metricFixture(extra = {}) {
  const totals = { shopViews: 10, checkoutStarts: 4, fulfilledPasses: 2, paidSupporterPeriods: 1, loginClaimAccounts: 7, loginClaims: 20, uniqueShopAccounts: 8, uniqueCheckoutAccounts: 3, uniquePaidAccounts: 3, matchedPaidShopAccounts: 2 };
  return { ok: true, days: 60, fromDay: '2026-09-23', toDay: '2026-11-21', daily: [{ day: '2026-11-20', ...totals }], totals, conversion: { definition: '集計期間中にショップ閲覧後、支払いが確認できた接続アカウント', viewedAccounts: 8, paidAfterViewAccounts: 2, rate: .25 }, retention: { definition: '初回ログイン報酬受取者の翌日再受取', cohortAccounts: 5, returnedNextDay: 2, rate: .4, throughDay: '2026-11-19' }, ...extra };
}

// Artificial aggregate data for both automated checks and a clearly labelled UI preview.
function extendedMetricFixture(extra = {}) {
  const byProduct = ['gold-banner', 'moonlit-castle', 'supporter', 'reroll-pass-30d', 'vermilion-banner', 'silver-banner', 'phoenix-medallion', 'sakura-town', 'snow-town', 'castle-heritage'].map(productId => ({ productId, validAmount: productId === 'supporter' ? 780 : productId === 'reroll-pass-30d' ? 480 : productId === 'castle-heritage' ? 980 : 0, validPayments: ['supporter', 'reroll-pass-30d', 'castle-heritage'].includes(productId) ? 1 : 0, excludedAmount: productId === 'moonlit-castle' ? 980 : 0, excludedPayments: productId === 'moonlit-castle' ? 1 : 0 }));
  return metricFixture({
    revenue: { currency: 'JPY', taxIncluded: true, definition: '全商品の確認済み支払いから、返金・取消・保留等の決済全額を除いた合計', dateBasis: 'Stripeチャージ作成日・JST05:00区切り', validAmount: 2240, validPayments: 3, excludedAmount: 980, excludedPayments: 1, unclassifiedExcludedAmount: 0, unclassifiedExcludedPayments: 0, byProduct },
    supporterRenewal: { definition: '終了後7日までの観測を終えた有効支払期間のうち、同一契約の次の連続期間を期限内に支払った割合', graceDays: 7, observedSince: '2026-09-23T01:00:00.000Z', eligiblePeriods: 4, renewedPeriods: 3, rate: .75, throughDay: '2026-11-14' },
    playerRetention: { definition: '集計期間内に初めて接続を観測した登録領主の、翌日・30日後のゲーム接続', observedSince: '2026-09-23T01:00:00.000Z', dayBoundary: 'Asia/Tokyo 05:00', cohortBasis: '初回の認証済みゲームAPI成功', segments: [
      { segment: 'free', label: '無料', observedAccounts: 8, d1: { eligibleAccounts: 6, returnedAccounts: 3, rate: .5, throughDay: '2026-11-19' }, d30: { eligibleAccounts: 2, returnedAccounts: 0, rate: 0, throughDay: '2026-10-21' } },
      { segment: 'paid', label: '課金', observedAccounts: 4, d1: { eligibleAccounts: 3, returnedAccounts: 2, rate: 2 / 3, throughDay: '2026-11-19' }, d30: { eligibleAccounts: 1, returnedAccounts: 1, rate: 1, throughDay: '2026-10-21' } }
    ] }, ...extra
  });
}

test('operator metrics retain real counts, distinct-account totals and correctly defined mature retention', () => {
  const clean = cleanMetrics(metricFixture()); assert(clean); assert.equal(clean.totals.loginClaimAccounts, 7);
  const html = metricsMarkup({ metrics: clean });
  assert.match(html, /40\.0％/); assert.match(html, /イベント件数の比率/); assert.match(html, /人数ベースの購入率ではありません/);
  assert.match(html, /同じ領主の複数商品/); assert.match(html, /初回受取者 5 アカウント/); assert.match(html, /翌日も受け取った領主 2 アカウント/);
  assert.match(html, /通常のゲーム利用全体の継続率ではありません/); assert.match(html, /更新支払いも含みます/);
  assert.equal(clean.totals.uniqueShopAccounts, 8); assert.equal(clean.totals.uniqueCheckoutAccounts, 3); assert.equal(clean.totals.uniquePaidAccounts, 3); assert.equal(clean.totals.matchedPaidShopAccounts, 2);
  assert.match(html, /25\.0％/); assert.match(html, /閲覧した 8 アカウントのうち、閲覧後に支払いを確認した領主 2 アカウント/); assert.match(html, /同じ領主の複数回の閲覧・購入はそれぞれ1アカウント/);
  assert.match(html, /サポーターの初回・更新支払いを含みます/);
  const zero = Object.fromEntries(Object.keys(metricFixture().totals).map(key => [key, 0]));
  const empty = cleanMetrics(metricFixture({ daily: [], totals: zero, conversion: { definition: '集計期間中にショップ閲覧後、支払いが確認できた接続アカウント', viewedAccounts: 0, paidAfterViewAccounts: 0, rate: null }, retention: { definition: '初回ログイン報酬受取者の翌日再受取', cohortAccounts: 0, returnedNextDay: 0, rate: null, throughDay: '2026-11-19' } }));
  assert(empty); assert.match(metricsMarkup({ metrics: empty }), /閲覧記録なし/); assert.match(metricsMarkup({ metrics: empty }), /翌日まで観測を終えた対象者がまだいません/);
  assert.match(metricsMarkup({ metrics: empty }), /閲覧した領主の記録なし/); assert.doesNotMatch(metricsMarkup({ metrics: empty }), /0\.0％/);
  assert.match(metricsMarkup({ metrics: null }), /まだ取得していません/); assert(!metricsMarkup({ metrics: null }).includes('<strong>0</strong>'));
  assert.match(metricsMarkup({ metrics: null, metricsError: '記録を取得できません' }), /role="alert"/);
  for (const change of [value => { delete value.totals.fulfilledPasses; }, value => { value.totals.shopViews = -1; }, value => { value.retention.returnedNextDay = 6; }, value => { value.retention.rate = .9; }, value => { value.daily[0].day = '2026-13-01'; }]) {
    const value = metricFixture(); change(value); assert.equal(cleanMetrics(value), null);
  }
});

test('conversion validation distinguishes missing evidence, an empty denominator and an observed zero rate', () => {
  const absent = metricFixture(); delete absent.conversion;
  for (const key of ['uniqueShopAccounts', 'uniqueCheckoutAccounts', 'uniquePaidAccounts', 'matchedPaidShopAccounts']) delete absent.totals[key];
  const legacy = cleanMetrics(absent); assert(legacy); assert.equal(legacy.conversion, null);
  assert.match(metricsMarkup({ metrics: legacy }), /支払い確認率のデータが含まれていません/);
  for (const change of [value => { value.conversion = null; }, value => { delete value.totals.uniquePaidAccounts; }, value => { value.conversion.viewedAccounts = 9; }, value => { value.conversion.paidAfterViewAccounts = 9; }, value => { value.conversion.rate = .5; }, value => { value.totals.uniquePaidAccounts = 1; }, value => { value.totals.uniqueCheckoutAccounts = 5; }]) {
    const value = metricFixture(); change(value); assert.equal(cleanMetrics(value), null);
  }
  const zero = metricFixture(); zero.totals.matchedPaidShopAccounts = 0; zero.conversion.paidAfterViewAccounts = 0; zero.conversion.rate = 0;
  const observed = cleanMetrics(zero); assert(observed); assert.match(metricsMarkup({ metrics: observed }), /0\.0％/); assert.match(metricsMarkup({ metrics: observed }), /閲覧した 8 アカウントのうち、閲覧後に支払いを確認した領主 0 アカウント/);
});

test('all ten products including castle heritage reconcile to valid payments while excluded amounts are not labelled as refunds or net sales', () => {
  const value = cleanMetrics(extendedMetricFixture()); assert(value); assert.equal(value.revenue.byProduct.length, 10);
  assert.equal(value.revenue.validAmount, 2240); assert.equal(value.revenue.validPayments, 3); assert.equal(value.revenue.excludedAmount, 980); assert.equal(value.revenue.excludedPayments, 1);
  assert.deepEqual(value.revenue.byProduct.find(row => row.productId === 'castle-heritage'), { productId: 'castle-heritage', validAmount: 980, validPayments: 1, excludedAmount: 0, excludedPayments: 0 });
  const html = metricsMarkup({ metrics: value });
  for (const text of ['確認済み有効支払い合計', '2,240円', '全商品・税込・手数料控除前', '全商品の内訳', '1件・980円', '除外額は実際の返金額ではありません', '金彩の旗印', '月影の城下', '戦国VSサポーター', '武将再抽選パス・30日', '紅蓮の旗印', '白銀の旗印', '鳳凰の勲章', '桜雲の城下', '雪華の城下', '名城絵巻・全城対応']) assert(html.includes(text), text);
  assert.match(html, /名城絵巻・全城対応<\/dt><dd><strong>980円<\/strong><span>有効 1件/);
  assert.doesNotMatch(html, /純売上|総売上|入金額|全\d+商品/);
  const unknown = extendedMetricFixture(); Object.assign(unknown.revenue, { unclassifiedExcludedAmount: 480, unclassifiedExcludedPayments: 1, excludedAmount: 1460, excludedPayments: 2 });
  const withUnknown = cleanMetrics(unknown); assert(withUnknown); const unknownHTML = metricsMarkup({ metrics: withUnknown });
  assert.match(unknownHTML, /2件・1,460円/); assert.match(unknownHTML, /商品を特定できない除外分：1件・480円/); assert.match(unknownHTML, /商品別には割り当てていません/);
  const legacy = cleanMetrics(metricFixture()); assert(legacy); assert.equal(legacy.revenue, null); assert.equal(legacy.supporterRenewal, null); assert.equal(legacy.playerRetention, null);
  const oldHTML = metricsMarkup({ metrics: legacy }); assert.match(oldHTML, /支払額の集計が含まれていません/); assert.match(oldHTML, /更新率の集計が含まれていません/); assert.match(oldHTML, /ゲーム接続の再訪率が含まれていません/);
});

test('renewals and free versus paid return cohorts show real denominators and distinguish zero returns from immature cohorts', () => {
  const fixture = extendedMetricFixture(), value = cleanMetrics(fixture); assert(value);
  const html = metricsMarkup({ metrics: value });
  for (const text of ['75.0％', '翌期間の支払い確認（分子）', '判定済みの有効支払期間（分母）', '3期間', '4期間', '無料・翌日', '課金・30日後', '50.0％', '66.7％', '100.0％', '再訪（分子）', '判定済み（分母）', '未登録・未接続・オフライン', '新規登録日の集計ではありません', 'その後の課金・返金で区分を変更しません']) assert(html.includes(text), text);
  assert.match(html, /無料・30日後<\/h4><p[^>]*>0\.0％/);
  assert.match(html, /期間内の初回観測 8アカウント · 経過日数待ち 6アカウント/);
  fixture.supporterRenewal.eligiblePeriods = fixture.supporterRenewal.renewedPeriods = 0; fixture.supporterRenewal.rate = null;
  for (const segment of fixture.playerRetention.segments) for (const key of ['d1', 'd30']) Object.assign(segment[key], { eligibleAccounts: 0, returnedAccounts: 0, rate: null });
  const immature = cleanMetrics(fixture); assert(immature); const waiting = metricsMarkup({ metrics: immature });
  assert.match(waiting, /未観測（終了後7日の判定を終えた対象期間なし）/); assert.match(waiting, /未観測（経過日数の判定待ち）/); assert.doesNotMatch(waiting, /無料・30日後<\/h4><p[^>]*>0\.0％/);
  fixture.supporterRenewal.observedSince = null; fixture.playerRetention.observedSince = null; for (const segment of fixture.playerRetention.segments) segment.observedAccounts = 0;
  const empty = cleanMetrics(fixture); assert(empty); assert.match(metricsMarkup({ metrics: empty }), /まだ接続の記録がありません/); assert.match(metricsMarkup({ metrics: empty }), /対象の初回接続記録なし/);
  assert.match(metricsMarkup({ metrics: empty }), /まだ支払い確認の記録がありません/);
});

test('expanded metrics reject inconsistent money, duplicate products, impossible cohorts and mismatched rates', () => {
  const changes = [
    v => { v.revenue.currency = 'USD'; }, v => { v.revenue.taxIncluded = false; }, v => { v.revenue.validAmount++; }, v => { v.revenue.byProduct.pop(); v.revenue.validAmount -= 980; v.revenue.validPayments--; }, v => { v.revenue.byProduct[0].productId = 'unknown'; }, v => { v.revenue.byProduct[0].productId = v.revenue.byProduct[1].productId; }, v => { v.revenue.byProduct[0].productId = 'castle-heritage'; }, v => { v.revenue.byProduct.find(row => row.productId === 'castle-heritage').validAmount = -1; v.revenue.validAmount -= 981; }, v => { v.revenue.byProduct[0].validPayments = -1; }, v => { v.revenue.unclassifiedExcludedAmount = 480; }, v => { v.revenue.unclassifiedExcludedPayments = -1; },
    v => { v.supporterRenewal.renewedPeriods = 5; }, v => { v.supporterRenewal.rate = .9; }, v => { v.supporterRenewal.graceDays = 0; }, v => { v.supporterRenewal.throughDay = '2026-12-01'; }, v => { v.supporterRenewal.observedSince = null; }, v => { v.supporterRenewal.observedSince = '2026-02-30T00:00:00.000Z'; },
    v => { v.playerRetention.segments.pop(); }, v => { v.playerRetention.segments[0].segment = 'paid'; }, v => { v.playerRetention.segments[0].d1.eligibleAccounts = 9; }, v => { v.playerRetention.segments[0].d30.returnedAccounts = 3; }, v => { v.playerRetention.segments[0].d1.rate = 0; }, v => { v.playerRetention.segments[0].d1 = { eligibleAccounts: 0, returnedAccounts: 0, rate: 0, throughDay: '2026-11-19' }; }, v => { v.playerRetention.segments[0].d30 = { eligibleAccounts: 7, returnedAccounts: 0, rate: 0, throughDay: '2026-10-21' }; }, v => { v.playerRetention.observedSince = null; }, v => { v.playerRetention.observedSince = 'unknown'; }, v => { v.playerRetention.dayBoundary = 'UTC midnight'; }
  ];
  for (const change of changes) { const value = extendedMetricFixture(); change(value); assert.equal(cleanMetrics(value), null, change.toString()); }
  const injected = extendedMetricFixture(); injected.revenue.definition = '<script>bad()</script>'; injected.supporterRenewal.definition = '<img src=x onerror=bad()>'; injected.playerRetention.segments[0].label = '<svg onload=bad()>';
  const html = metricsMarkup({ metrics: cleanMetrics(injected) }); assert.doesNotMatch(html, /<script>|<img|<svg/); assert.match(html, /&lt;script&gt;/); assert.match(html, /&lt;svg/);
});

test('period changes clear old counts, validate the selected range and discard an older range after reopening', async () => {
  const s = setup(); await s.controller.open(); assert.equal(s.controller.getState().metricsDays, 60);
  s.setHandler(async route => { const days = Number(new URL(route, 'https://fixture.invalid').searchParams.get('days')); return extendedMetricFixture({ days }); });
  assert(await s.controller.loadMetrics()); assert.equal(s.controller.getState().metrics.days, 60);
  const wait = deferred(); s.setHandler(() => wait.promise); const loading = s.controller.loadMetrics(14);
  assert.equal(s.controller.getState().metrics, null); assert.equal(s.controller.getState().metricsDays, 14); assert.equal(await s.controller.loadMetrics(90), false);
  s.controller.close(); s.setHandler(null); await s.controller.open();
  s.setHandler(async route => { assert.equal(route, '/admin/premium/metrics?days=90'); return extendedMetricFixture({ days: 90 }); });
  assert(await s.controller.loadMetrics(90)); wait.resolve(extendedMetricFixture({ days: 14 })); assert.equal(await loading, false);
  assert.equal(s.controller.getState().metricsDays, 90); assert.equal(s.controller.getState().metrics.days, 90);
  const calls = s.calls.length; assert.equal(await s.controller.loadMetrics(31), false); assert.equal(s.calls.length, calls);
  s.setHandler(async () => extendedMetricFixture({ days: 14 })); assert.equal(await s.controller.loadMetrics(60), false); assert.equal(s.controller.getState().metrics, null); assert.match(s.controller.getState().metricsError, /形式を確認/); s.controller.dispose();
});

test('native period selector requests the chosen window and keeps every financial metric read only', async () => {
  const s = uiSetup(); await s.ui.open(); const period = s.get('#premium-admin-metrics-period'); assert.equal(period.value, '60');
  s.setHandler(async route => { assert.equal(route, '/admin/premium/metrics?days=30'); return extendedMetricFixture({ days: 30 }); });
  period.value = '30'; s.get('#premium-admin-modal').dispatch('change', period); await drain();
  assert.equal(s.ui.getState().metricsDays, 30); assert.match(s.get('[data-admin-metrics]').textContent, /直近60日/); assert.match(s.get('[data-admin-metrics]').textContent, /確認済み有効支払い合計/); assert.match(s.get('[data-admin-metrics]').textContent, /名城絵巻・全城対応/); assert.match(s.get('[data-admin-metrics]').textContent, /2,240円/); assert.equal(s.posts().length, 0); s.ui.dispose();
});

test('metrics reads require current primary operator access and late results are removed on role or account changes', async () => {
  const s = setup(); await s.controller.open();
  s.setHandler(async route => { assert.equal(route, '/admin/premium/metrics?days=60'); return metricFixture(); });
  assert(await s.controller.loadMetrics()); assert.equal(s.controller.getState().metrics.totals.fulfilledPasses, 2); assert.equal(s.posts().length, 0);
  const wait = deferred(); s.setHandler(() => wait.promise); const loading = s.controller.loadMetrics();
  assert.equal(s.controller.getState().metrics, null); assert.equal(await s.controller.loadMetrics(), false);
  s.setUser({ ...ADMIN, isAdmin: false, isStaff: true }); s.controller.refreshIdentity();
  wait.resolve(metricFixture()); assert.equal(await loading, false); assert.equal(s.controller.getState().metrics, null); assert.equal(s.controller.getState().open, false);
  const count = s.calls.length; assert.equal(await s.controller.loadMetrics(), false); assert.equal(s.calls.length, count); s.controller.dispose();
});

test('native operator metric pane loads on request and presents failure separately from purchase holds', async () => {
  const s = uiSetup(); await s.ui.open(); assert.match(s.get('[data-admin-metrics]').textContent, /まだ取得していません/);
  s.setHandler(async route => { assert.equal(route, '/admin/premium/metrics?days=60'); return metricFixture(); });
  s.click('metrics'); await drain(); assert.match(s.get('[data-admin-metrics]').textContent, /再抽選パスの購入確認/); assert.match(s.get('[data-admin-metrics]').textContent, /40\.0％/);
  s.setHandler(async () => { throw Error('metrics unavailable'); }); s.click('metrics'); await drain();
  assert.match(s.get('[data-admin-metrics]').textContent, /metrics unavailable/); assert(s.get('[data-admin-holds]').textContent.includes('cs_fixture'));
  s.ui.close(); assert.equal(s.get('[data-admin-metrics]').textContent, ''); s.ui.dispose();
});

module.exports = { metricFixture, extendedMetricFixture };
if (require.main === module) (async () => {
  let failed = 0;
  for (const [name, run] of tests) { try { await run(); console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name); console.error(error); } }
  console.log(JSON.stringify({ passed: tests.length - failed, failed, externalRequests: 0, realPayments: 0, entitlementGrants: 0, fixtureOnly: true })); if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
