/* Private in-memory UI contracts; never contacts or modifies live players. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { documentFixture, storageFixture } = require('./test-events-ui.cjs');
const source = fs.readFileSync(require.resolve('../shogunate-governance.js'), 'utf8');
const copy = v => JSON.parse(JSON.stringify(v));
const OWNER = 'u_' + '1'.repeat(32), OTHER = 'u_' + '2'.repeat(32), RIGHT = 'sg_' + 'a'.repeat(32);
const NOW = Date.parse('2026-11-28T04:00:00Z'), RESET = Date.parse('2026-11-28T20:00:00Z');
const reward = () => ({ gold: 600, rice: 600, wood: 300, stone: 300, magatama: 20 });
const access = (id = OWNER) => ({ playerId: id, epoch: 1, accountEpoch: 1, privilegeEpoch: 1, user: { id, name: '試験将軍' }, pending: false, banned: false, connected: true, writable: true, gameWritable: true });
function view() {
  return { version: 1, available: true, reason: null, government: { id: RIGHT, name: '試験幕府', rank: '征夷大将軍', openedAt: NOW - 1000 }, serverNow: NOW, calendar: { day: '2026-11-28', nextResetAt: RESET, resetHour: 5, timeZone: 'Asia/Tokyo' }, revision: 0, policyId: 'balanced', policyChangedToday: false, resources: { gold: 50000, rice: 50000, wood: 50000, stone: 50000, magatama: 500 }, renown: { points: 0, level: 1, name: '開府', levelStart: 0, nextLevelAt: 100, totalLevels: 5, cap: 1500 }, dailyReward: reward(),
    policies: ['balanced', 'agriculture', 'commerce', 'construction'].map((id, i) => ({ id, name: ['均衡政策', '農政', '商業', '普請'][i], description: '日次褒賞を配分します。', selected: i === 0, canSelect: i !== 0, reason: i === 0 ? '現在の国策です。' : null, reward: reward() })),
    projects: ['granary', 'roads', 'academy'].map((id, i) => ({ id, name: ['蔵と治水', '街道整備', '学問所'][i], description: '領内を発展させます。', level: 0, maxLevel: 5, cost: { gold: 3000, rice: 1000, wood: 1500, stone: 1000 }, renownReward: 20, effect: '日次政務の兵糧が1レベルにつき120増えます。', canUpgrade: true, reason: null })),
    duties: ['audience', 'relief', 'inspection'].map((id, i) => ({ id, name: ['日次政務', '兵糧救済', '領内巡察'][i], description: '本日の政務を執り行います。', cost: i === 1 ? { rice: 2000 } : i === 2 ? { gold: 2000 } : {}, reward: i === 0 ? reward() : {}, renownReward: i === 0 ? 10 : 15, claimed: false, canComplete: true, reason: null })),
    milestones: [{ id: 'first-work', name: '初めての公共事業', description: '公共事業を一度発展させる。', progress: 0, target: 1, eligible: false, claimed: false, reward: { magatama: 30 }, canClaim: false, reason: '公共事業を発展させてください。' }], history: [] };
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function setup({ context = access(), snapshot = view(), storage = storageFixture(), server = null } = {}) {
  let who = copy(context), handler = null, flushHandler = null, sequence = 0, elapsed = 0, tick = null;
  server ||= { snapshot: copy(snapshot), receipts: new Map(), commits: 0 };
  const { doc, entry } = documentFixture(), calls = [], toasts = [], sounds = [];
  doc.body.appendChild = node => doc.body.append(node);
  const base = async (route, opts = {}) => {
    if (opts.method !== 'POST') return { ok: true, governance: copy(server.snapshot) };
    assert.equal(route, '/shogunate/governance/action');
    assert.deepEqual(Object.keys(opts.data).sort(), ['day', 'governanceRevision', 'kind', 'requestId', 'targetId']);
    const p = opts.data, stored = server.receipts.get(p.requestId);
    if (stored) return { ok: true, governance: copy(server.snapshot), receipt: copy(stored), idempotent: true };
    const group = { policy: 'policies', project: 'projects', duty: 'duties', milestone: 'milestones' }[p.kind], item = server.snapshot[group].find(i => i.id === p.targetId);
    assert(item);
    const receipt = { id: p.requestId, kind: p.kind, targetId: p.targetId, name: item.name, at: NOW, day: p.day, cost: copy(item.cost || {}), reward: copy(p.kind === 'policy' ? {} : item.reward || {}), renownGained: item.renownReward || 0, offeredReward: copy(p.kind === 'policy' ? {} : item.reward || {}), governmentId: RIGHT };
    if (p.kind === 'duty') { item.claimed = true; item.canComplete = false; item.reason = '本日は完了しています。'; }
    if (p.kind === 'project') item.level++;
    if (p.kind === 'policy') { server.snapshot.policyId = item.id; server.snapshot.policyChangedToday = true; for (const policy of server.snapshot.policies) { policy.selected = policy.id === item.id; policy.canSelect = false; } }
    server.snapshot.revision++; server.snapshot.history.unshift(copy(receipt)); server.receipts.set(p.requestId, copy(receipt)); server.commits++;
    return { ok: true, governance: copy(server.snapshot), receipt, idempotent: false };
  };
  const scope = { console, Date, Intl, JSON, Math, Promise, Object, Set, document: doc, localStorage: storage, performance: { now: () => elapsed }, crypto: { randomUUID: () => 'gov_request_' + ++sequence }, setInterval: cb => { tick = cb; return 1; }, clearInterval: () => { tick = null; },
    SengokuCloudSync: { flush: async () => flushHandler ? flushHandler() : { ok: true } },
    SengokuBridge: { getExpansionAccess: () => copy(who), requestExpansion: (route, opts) => { calls.push({ route, opts: copy(opts), owner: who.playerId }); return handler ? handler(route, opts, base) : base(route, opts); }, toast: (...args) => toasts.push(args), playInterfaceSound: type => sounds.push(type) }, SengokuShogunate: { open: () => {} } };
  scope.window = scope; vm.createContext(scope); vm.runInContext(source, scope);
  const api = scope.SengokuShogunateGovernance, get = selector => doc.querySelector(selector);
  const click = (action, target) => { const nodes = doc.querySelectorAll('[data-gov="' + action + '"]'), node = target ? nodes.find(n => n.getAttribute('data-target') === target || n.getAttribute('data-tab') === target) : nodes[0]; assert(node, 'Missing action ' + action + ' ' + target); get('.gov-dialog').dispatch('click', node); };
  return { api, scope, doc, get, click, entry, storage, server, calls, toasts, sounds, base, posts: () => calls.filter(c => c.opts.method === 'POST'), setHandler: fn => { handler = fn; }, setFlush: fn => { flushHandler = fn; }, setContext: c => { who = copy(c); }, context: () => copy(who), advance: ms => { elapsed += ms; tick?.(); }, hasTimer: () => Boolean(tick) };
}
const tests = [], test = (name, fn) => tests.push([name, fn]);
test('valid DTO is bounded and strips private role metadata', () => {
  const s = setup(), raw = view(); raw.secret = 'PRIVATE'; raw.government.isAdmin = true; raw.policies[0].secret = 'PRIVATE';
  assert(s.api.cleanData(raw)); assert(!JSON.stringify(s.api.cleanData(raw)).includes('PRIVATE')); assert(!('isAdmin' in s.api.cleanData(raw).government));
  for (const mutate of [v => v.calendar.resetHour = 0, v => v.projects[0].cost.gold = -1, v => v.policies[0].reward.gold = Infinity, v => v.renown.level = 6, v => v.resources.secret = 1, v => v.history = Array(51).fill({}), v => v.policies[1].selected = true]) { const bad = view(); mutate(bad); assert.equal(s.api.cleanData(bad), null); }
});
test('opening and choosing a costly project require explicit cost confirmation before a synced POST', async () => {
  const s = setup(); assert(await s.api.open()); assert.equal(s.posts().length, 0); s.click('tab', 'projects'); s.click('prepare', 'granary');
  const text = s.get('.gov-confirm').textContent; assert(text.includes('3,000')); assert(text.includes('1,500')); assert.equal(s.posts().length, 0);
  s.click('cancel'); assert(!s.api.getState().hasConfirmation); s.click('prepare', 'granary'); s.click('confirm'); await drain(); assert.equal(s.posts().length, 1); assert.equal(s.server.commits, 1); assert(!s.api.getState().hasPending); assert(s.api.getState().message.includes('威信 +20'));
  s.click('close'); assert.equal(s.get('.gov-dialog'), null); assert.equal(s.doc.activeElement, s.entry); assert(!s.hasTimer());
});
test('guest, banned, pending and mismatched identities cannot read the private government', async () => {
  for (const change of [{ user: null }, { banned: true }, { pending: true }, { user: { id: OTHER } }]) { const s = setup({ context: { ...access(), ...change } }); assert.equal(await s.api.open(), false); assert.equal(s.calls.length, 0); assert.equal(s.get('.gov-dialog'), null); }
});
test('read-only and not-yet-opened governments never offer actionable controls', async () => {
  const readonly = setup({ context: { ...access(), writable: false, gameWritable: false } }); await readonly.api.open(); assert(readonly.get('.gov-readonly')); assert.equal(readonly.api.prepare('duty', 'audience'), false); assert.equal(await readonly.api.confirm(), false); assert.equal(readonly.posts().length, 0); readonly.api.close();
  const locked = view(); Object.assign(locked, { available: false, government: null, reason: '幕府開設後に利用できます。', policies: [], projects: [], duties: [], milestones: [] });
  const s = setup({ snapshot: locked }); assert(await s.api.open()); assert(s.get('.gov-empty')); assert.equal(s.get('[data-gov="prepare"]'), null); assert.equal(s.api.prepare('duty', 'audience'), false); s.api.close();
});
test('lost committed response survives reload and retries the same operation without a second award', async () => {
  const s = setup(); await s.api.open(); let lost = false;
  s.setHandler(async (route, opts, base) => { const result = await base(route, opts); if (opts.method === 'POST' && !lost) { lost = true; throw Error('Response lost'); } return result; });
  s.click('prepare', 'audience'); s.click('confirm'); await drain(); assert.equal(s.server.commits, 1); assert(s.api.getState().hasPending); const original = copy(s.posts()[0].opts.data); s.api.close();
  const restored = setup({ server: s.server, storage: s.storage }); await restored.api.open(); assert(restored.api.getState().hasPending); restored.click('retry'); await drain();
  assert.deepEqual(restored.posts()[0].opts.data, original); assert.equal(s.server.commits, 1); assert(!restored.api.getState().hasPending); assert(restored.api.getState().message.includes('実行済み記録')); restored.api.close();
});
test('the trusted save bridge can recover its retained request ID while semantic receipt bindings remain strict', async () => {
  for (const invalid of [false, true]) {
    const s = setup(); await s.api.open(); s.setHandler(async (route, opts, base) => {
      if (opts.method !== 'POST') return base(route, opts);
      const result = await base(route, { ...opts, data: { ...opts.data, requestId: 'retained_bridge_request' } });
      if (invalid) result.receipt.targetId = 'different-duty';
      return { ...result, effectiveRequestId: 'retained_bridge_request' };
    });
    s.api.prepare('duty', 'audience'); assert.equal(await s.api.confirm(), !invalid); assert.equal(s.api.getState().hasPending, invalid);
    assert.equal(s.server.commits, 1); if (!invalid) assert.equal(s.storage.getItem('sengoku-governance-pending-v1:' + OWNER), null); s.api.close();
  }
});
test('double confirmation and pending state cannot create an additional request', async () => {
  const s = setup(), wait = deferred(); await s.api.open(); s.setHandler((route, opts, base) => opts.method === 'POST' ? wait.promise : base(route, opts));
  s.api.prepare('duty', 'audience'); const first = s.api.confirm(); assert.equal(await s.api.confirm(), false); assert.equal(s.api.prepare('duty', 'relief'), false); assert.equal(s.posts().length, 1);
  wait.resolve(await s.base('/shogunate/governance/action', s.posts()[0].opts)); assert(await first); assert.equal(s.server.commits, 1); s.api.close();
});
test('durable storage failure and silently discarded writes prevent any expenditure', async () => {
  for (const silent of [false, true]) { const storage = storageFixture(); storage.setItem = () => { if (!silent) throw Error('Storage disabled'); }; const s = setup({ storage }); await s.api.open(); s.api.prepare('duty', 'relief'); assert.equal(await s.api.confirm(), false); assert.equal(s.posts().length, 0); assert(s.api.getState().error); s.api.close(); }
});
test('malformed receipts remain pending but semantic rejections clear pending and refresh', async () => {
  for (const mode of ['malformed', 'shortage', 'retryable']) {
    const s = setup(); await s.api.open(); s.setHandler(async (route, opts, base) => { if (opts.method !== 'POST') return base(route, opts); if (mode === 'malformed') { const result = await base(route, opts); result.receipt.targetId = 'wrong'; return result; } throw Object.assign(Error('資源を確認してください。'), { status: 409, code: 'GOVERNANCE_SHORTAGE', retryable: mode === 'retryable' }); });
    s.api.prepare('duty', 'relief'); assert.equal(await s.api.confirm(), false); assert.equal(s.api.getState().hasPending, mode !== 'shortage'); assert(s.api.getState().error); assert.equal(s.api.getState().message, ''); s.api.close();
  }
});
test('identity changes during reads or writes close the dialog and cannot expose stale results', async () => {
  const s = setup(), read = deferred(); s.setHandler(() => read.promise); const opening = s.api.open(); await drain(); s.setContext(access(OTHER)); read.resolve({ ok: true, governance: view() }); assert.equal(await opening, false); assert.equal(s.get('.gov-dialog'), null); assert.equal(s.api.getState().data, null);
  const t = setup(), post = deferred(); await t.api.open(); t.setHandler((route, opts, base) => opts.method === 'POST' ? post.promise : base(route, opts)); t.api.prepare('duty', 'audience'); const writing = t.api.confirm(); const record = copy(t.posts()[0].opts); t.setContext(access(OTHER)); post.resolve(await t.base('/shogunate/governance/action', record)); assert.equal(await writing, false); assert.equal(t.api.getState().data, null); assert.equal(t.api.getState().message, ''); assert(t.storage.getItem('sengoku-governance-pending-v1:' + OWNER));
});
test('identity change while flushing does not send a private read', async () => {
  const s = setup(), wait = deferred(); s.setFlush(() => wait.promise); const opening = s.api.open(); await drain(); s.setContext(access(OTHER)); wait.resolve({ ok: true }); assert.equal(await opening, false); assert.equal(s.calls.length, 0); assert.equal(s.get('.gov-dialog'), null);
});
test('server-day rollover invalidates a reviewed action and refreshes instead of spending against the old day', async () => {
  const s = setup(); await s.api.open(); assert(s.api.prepare('duty', 'relief')); s.server.snapshot.calendar = { day: '2026-11-29', nextResetAt: RESET + 86400000, resetHour: 5, timeZone: 'Asia/Tokyo' }; s.server.snapshot.serverNow = RESET;
  s.advance(RESET - NOW + 1); await drain(); assert(!s.api.getState().hasConfirmation); assert.equal(s.api.getState().data.calendar.day, '2026-11-29'); assert.equal(s.posts().length, 0); assert.equal(await s.api.confirm(), false); s.api.close();
});
test('an outage at the daily rollover backs off read retries instead of polling every second', async () => {
  const s = setup(); await s.api.open(); s.setHandler(() => { throw Error('Temporary outage'); });
  const initial = s.calls.length; s.advance(RESET - NOW + 1); await drain(); assert.equal(s.calls.length, initial + 1);
  for (let i = 0; i < 29; i++) { s.advance(1000); await drain(); }
  assert.equal(s.calls.length, initial + 1); s.advance(1000); await drain(); assert.equal(s.calls.length, initial + 2); assert.equal(s.posts().length, 0); s.api.close();
});
test('cap-limited resource awards show actual credited amounts and keep renown explicit', async () => {
  const snapshot = view(); for (const key of Object.keys(snapshot.resources)) snapshot.resources[key] = 100000000;
  const s = setup({ snapshot }); await s.api.open(); s.api.prepare('duty', 'audience'); assert(s.get('.gov-confirm').textContent.includes('資源の加算なし'));
  s.setHandler(async (route, opts, base) => { const result = await base(route, opts); if (opts.method === 'POST') result.receipt.reward = {}; return result; });
  assert(await s.api.confirm()); assert(s.api.getState().message.includes('資源は所持上限')); assert(s.api.getState().message.includes('威信 +10')); s.api.close();
});
test('untrusted names are escaped and malformed response cannot replace the verified data', async () => {
  const snapshot = view(); snapshot.government.name = '<img src=x onerror=evil()>'; snapshot.duties[0].name = '<script>evil()</script>';
  const s = setup({ snapshot }); await s.api.open(); assert.equal(s.get('img'), null); assert.equal(s.get('script'), null); assert(s.get('.gov-content').textContent.includes('<img'));
  s.setHandler(() => ({ ok: true, governance: { ...view(), revision: -1 } })); assert.equal(await s.api.refresh(), false); assert.equal(s.api.getState().data.revision, 0); assert(s.api.getState().error); s.api.close();
});
test('escape closes the dialog and restores focus without losing uncertain operation state', async () => {
  const s = setup(); await s.api.open(); s.get('.gov-dialog').dispatch('cancel'); assert.equal(s.get('.gov-dialog'), null); assert.equal(s.doc.activeElement, s.entry); assert(!s.hasTimer());
});
(async () => { for (const [name, run] of tests) { await run(); console.log('PASS ' + name); } console.log(tests.length + ' governance UI scenarios passed.'); })().catch(error => { console.error(error); process.exitCode = 1; });
