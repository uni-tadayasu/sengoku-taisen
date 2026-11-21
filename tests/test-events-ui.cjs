'use strict';
// In-memory event fixtures only. No real API, account, save, battle or mail is changed.
const assert = require('node:assert/strict');
const { createController, createUI, cleanEvent, cleanProgress, cleanLeaderboard, detailMarkup, leaderboardMarkup } = require('../events.js');
const clone = value => JSON.parse(JSON.stringify(value));
const tests = [], test = (name, run) => tests.push([name, run]);
const NOW = Date.parse('2026-11-22T03:00:00Z'), OWNER = 'u_' + '1'.repeat(32), OTHER = 'u_' + '2'.repeat(32);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const drain = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };
function eventFixture(extra = {}) {
  const name = extra.name || '川中島・霧の決戦', durationDays = extra.durationDays || 3;
  const tactics = [
    { id: 'balanced', name: '正攻法', description: '攻守の均衡を保ちながら進む。' },
    { id: 'charge', name: '突撃', description: '勢いを集めて敵の陣を崩す。' },
    { id: 'defend', name: '堅守', description: '守りを固め、反撃の機を待つ。' },
    { id: 'ambush', name: '奇襲', description: '霧に紛れて敵の側面を突く。' },
    { id: 'feint', name: '陽動', description: '敵の注意を引き、本隊に道を開く。' }
  ];
  const plan = { schemaVersion: 1, generator: 'game-ai-v1', name, durationDays, theme: { id: 'mist', label: '霧中の戦場', description: '川霧に包まれた平野で、敵の動きを読み切る。' }, synopsis: '霧が覆う川辺に、敵の軍勢が布陣した。三つの戦場で采配を振るい、戦功を重ねよう。', rules: ['1日3回、保存済みの軍団で出陣できます。', '城や兵は失いません。', '達成した褒賞はシステム便に届きます。'], dailyAttempts: 3, tactics, stages: ['先陣の渡河', '濃霧の攻防', '決戦・八幡原'].map((stage, index) => ({ id: 'stage_' + (index + 1), name: stage, description: ['川岸に構える前衛を突破する。', '視界の利かない戦場で敵本隊に迫る。', '精強な本陣を崩して勝機を掴む。'][index], enemyName: ['川辺の先鋒隊', '霧中の騎馬隊', '八幡原の精鋭'][index], enemyPower: 1000 + index * 600, basePoints: 100 + index * 50, recommendedTactic: ['balanced', 'ambush', 'feint'][index], tacticHint: ['均衡を保って前進しよう。', '霧を利用した奇襲が好機。', '本陣の守りを陽動で崩そう。'][index], tacticMultipliers: { balanced: 1, charge: .9, defend: 1.05, ambush: 1.2, feint: 1.1 } })), milestones: [100, 300, 600].map((points, index) => ({ id: 'honour_' + index, title: ['初陣の功', '歴戦の証', '八幡原の誉れ'][index], points, gift: { gold: 500 * (index + 1), rice: 500, wood: 100, stone: 100, magatama: 10 * (index + 1) } })) };
  return { id: 'ev_' + 'a'.repeat(32), name, durationDays, status: 'active', startsAt: '2026-11-22T00:00:00Z', endsAt: new Date(Date.parse('2026-11-22T00:00:00Z') + durationDays * 86400000).toISOString(), endedAt: null, createdAt: '2026-11-21T12:00:00Z', plan, ...extra };
}
const draftFixture = (extra = {}) => eventFixture({ status: 'draft', startsAt: null, endsAt: null, ...extra });
const progressFixture = (extra = {}) => ({ points: 0, wins: 0, battles: 0, attemptsToday: 0, attemptsLeft: 3, dayIndex: 1, nextResetAt: '2026-11-23T00:00:00Z', rewards: [], ...extra });
const evaluationFixture = { version: 1, score: 32000, maxScore: 100000, rankIndex: 6, rankId: 'court-6', rankName: '従五位下' };
const rankFixture = () => [{ rank: 1, playerId: OTHER, name: '甲斐の領主', avatarVersion: 'c'.repeat(64), evaluation: evaluationFixture, points: 350, wins: 3, battles: 3, isAdmin: true, isStaff: true }];
const contextFixture = (admin = false) => ({ epoch: 1, privilegeEpoch: 1, accountEpoch: 1, playerId: OWNER, user: { id: OWNER, name: '越後の領主', isAdmin: admin, isStaff: false }, isAdmin: admin, connected: true, pending: false, banned: false });
function storageFixture() { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values }; }
function setup({ admin = false, context = contextFixture(admin), events = [eventFixture()], progress = progressFixture(), storage = storageFixture() } = {}) {
  let access = clone(context), clock = NOW, handler, sequence = 0, committed = 0;
  const calls = [], changes = [], receipts = new Map(), server = { events: clone(events), progress: clone(progress), leaderboard: rankFixture() };
  const base = async (route, settings) => {
    if (settings.method !== 'POST') {
      if (route === '/events' || route === '/admin/events') return { ok: true, serverNow: new Date(clock).toISOString(), events: clone(server.events.filter(event => event.status !== 'discarded' && (route === '/admin/events' || event.status !== 'draft'))) };
      const event = server.events.find(event => '/events/' + event.id === route); assert(event, 'Unknown fixture read: ' + route);
      return { ok: true, serverNow: new Date(clock).toISOString(), event: clone(event), progress: access.user ? clone(server.progress) : null, leaderboard: clone(server.leaderboard) };
    }
    const data = settings.data;
    if (receipts.has(data.requestId)) return { ...clone(receipts.get(data.requestId)), idempotent: true };
    let event, result;
    if (route === '/admin/events/generate') { event = draftFixture({ id: 'ev_' + String(++committed).padStart(32, '0'), name: data.name, durationDays: data.durationDays }); server.events.unshift(event); }
    else {
      event = server.events.find(event => route.includes('/' + event.id + '/')); assert(event, 'Unknown fixture mutation: ' + route);
      if (route.endsWith('/publish')) { assert.equal(event.status, 'draft'); event.status = 'active'; event.startsAt = new Date(clock).toISOString(); event.endsAt = new Date(clock + event.durationDays * 86400000).toISOString(); }
      else if (route.endsWith('/end')) { assert.equal(event.status, 'active'); event.status = 'ended'; event.endedAt = new Date(clock).toISOString(); }
      else if (route.endsWith('/discard')) { assert.equal(event.status, 'draft'); event.status = 'discarded'; }
      else if (route.endsWith('/battle')) {
        if (server.progress.attemptsLeft < 1) throw Object.assign(Error('今日の出陣は終了です。'), { status: 409 });
        const stage = event.plan.stages.find(stage => stage.id === data.stageId), tactic = event.plan.tactics.find(tactic => tactic.id === data.tactic);
        assert(stage && tactic); server.progress.battles++; server.progress.wins++; server.progress.points += stage.basePoints; server.progress.attemptsToday++; server.progress.attemptsLeft--;
        const mailId = 'm_' + String(server.progress.battles).padStart(32, '0'); server.progress.rewards = [{ milestoneId: 'honour_0', mailId, awardedAt: new Date(clock).toISOString() }];
        result = { progress: clone(server.progress), battle: { won: true, points: stage.basePoints, stageId: stage.id, stageName: stage.name, tactic: tactic.id, tacticName: tactic.name, enemyName: stage.enemyName, playerPower: 1450, enemyPower: stage.enemyPower, winChance: 67, summary: '敵陣を突破し、戦功を挙げました。', log: ['保存した軍団を編成。', tactic.name + 'を採用し、前進。', '敵の守りを崩し、勝利。'] }, rewardMailIds: [mailId] };
      } else assert.fail('Unknown fixture mutation: ' + route);
      committed++;
    }
    result = { ok: true, serverNow: new Date(clock).toISOString(), event: clone(event), ...result, idempotent: false }; receipts.set(data.requestId, clone(result)); return result;
  };
  const options = { now: () => clock, uuid: () => 'event_request_' + ++sequence, storage, getContext: () => clone(access), request: (route, settings = { method: 'GET' }) => { calls.push({ route, settings: clone(settings) }); return handler ? handler(route, settings, base) : base(route, settings); }, onChange: state => changes.push(state) };
  const controller = createController(options);
  return { controller, options, calls, changes, server, storage, receipts, base, posts: () => calls.filter(call => call.settings.method === 'POST'), commits: () => committed, setContext(value) { access = clone(value); }, context: () => clone(access), setHandler(value) { handler = value; }, advance(ms) { clock += ms; } };
}

test('plans and progress accept the agreed bounded format and exclude private role/creator metadata', () => {
  const raw = eventFixture({ creatorId: OWNER, createdBy: { name: '秘密の運営', isAdmin: true }, internalPrompt: 'PRIVATE' });
  const event = cleanEvent(raw); assert(event); assert(!JSON.stringify(event).includes('PRIVATE')); assert(!JSON.stringify(event).includes('creator'));
  assert.equal(cleanEvent(draftFixture()), null); assert(cleanEvent(draftFixture(), true)); assert.equal(cleanEvent(draftFixture({ status: 'discarded' })), null); assert(cleanEvent(draftFixture({ status: 'discarded' }), true));
  for (const change of [{ durationDays: 8 }, { id: 'bad/id' }, { endsAt: 'invalid' }, { status: 'other' }]) assert.equal(cleanEvent(eventFixture(change)), null);
  const plan = clone(raw.plan); plan.stages[0].tacticMultipliers.charge = Infinity; assert.equal(cleanEvent({ ...raw, plan }), null);
  assert.equal(cleanProgress(progressFixture({ attemptsLeft: 4 })), undefined); assert.equal(cleanProgress(progressFixture({ dayIndex: 0 })), undefined);
  const ranks = cleanLeaderboard(rankFixture()); assert(ranks); assert(!('isAdmin' in ranks[0])); assert(!('isStaff' in ranks[0]));
});

test('anonymous visitors can read public events but cannot create, battle or see personal progress', async () => {
  const s = setup({ context: { epoch: 1, privilegeEpoch: 1, accountEpoch: 1, playerId: '', user: null, isAdmin: false } });
  assert(await s.controller.open()); assert.equal(s.controller.getState().progress, null); assert.equal(await s.controller.battle(), false); assert.equal(await s.controller.generate(), false); assert.equal(await s.controller.open({ admin: true }), false); assert.equal(s.posts().length, 0);
  assert(s.calls.every(call => !call.route.startsWith('/admin/'))); s.controller.dispose();
});

test('staff, banned users and unverified self identity cannot open the admin screen', async () => {
  for (const change of [{ isAdmin: false, user: { id: OWNER, isAdmin: false, isStaff: true } }, { banned: true }, { pending: true }, { playerId: OTHER }]) {
    const s = setup({ context: { ...contextFixture(true), ...change } }); assert.equal(await s.controller.open({ admin: true }), false); assert.equal(await s.controller.generate(), false); assert.equal(s.calls.length, 0); s.controller.dispose();
  }
});

test('name and duration validation precede generation, and an accepted draft remains unpublished', async () => {
  const s = setup({ admin: true, events: [] }); await s.controller.open({ admin: true });
  for (const [name, days] of [['', 3], ['あ'.repeat(61), 1], ['合戦', 0], ['合戦', 8], ['合戦', 1.5], ['合\n戦', 3]]) { s.controller.setDraft(name, days); assert.equal(await s.controller.generate(), false); }
  assert.equal(s.posts().length, 0); s.controller.setDraft('  川中島・霧の決戦  ', 7); assert(await s.controller.generate());
  assert.equal(s.posts()[0].route, '/admin/events/generate'); assert.equal(s.posts()[0].settings.data.name, '川中島・霧の決戦'); assert.equal(s.posts()[0].settings.data.durationDays, 7); assert.equal(s.controller.getState().event.status, 'draft'); assert(!s.posts().some(call => call.route.endsWith('/publish'))); s.controller.dispose();
});

test('publishing, ending and discarding require their own reviewed confirmation', async () => {
  const s = setup({ admin: true, events: [draftFixture()] }); await s.controller.open({ admin: true });
  assert.equal(await s.controller.confirm(), false); assert.equal(s.controller.prepare('end'), false); assert(s.controller.prepare('publish')); assert.equal(s.posts().length, 0); s.controller.back(); assert.equal(await s.controller.confirm(), false);
  assert(s.controller.prepare('publish')); assert(await s.controller.confirm()); assert.equal(s.controller.getState().event.status, 'active'); assert.equal(s.controller.prepare('discard'), false);
  assert(s.controller.prepare('end')); assert.equal(s.posts().length, 1); assert(await s.controller.confirm()); assert.equal(s.controller.getState().event.status, 'ended');
  const other = draftFixture({ id: 'ev_' + 'd'.repeat(32) }); s.server.events.unshift(other); await s.controller.refresh(); await s.controller.select(other.id); assert(s.controller.prepare('discard')); assert(await s.controller.confirm()); assert(!s.controller.getState().events.some(event => event.id === other.id)); assert(s.controller.getState().message.includes('破棄')); s.controller.dispose();
});

test('NPC battle sends only stage/tactic and its identity, then exposes automatic mail rewards', async () => {
  const s = setup(); await s.controller.open(); assert(s.controller.chooseStage('stage_2')); assert.equal(s.controller.getState().tactic, 'ambush'); assert(s.controller.chooseTactic('defend')); assert(await s.controller.battle());
  assert.deepEqual(Object.keys(s.posts()[0].settings.data).sort(), ['requestId', 'stageId', 'tactic']); assert.equal(s.posts()[0].settings.data.stageId, 'stage_2'); assert.equal(s.posts()[0].settings.data.tactic, 'defend');
  const state = s.controller.getState(); assert.equal(state.progress.attemptsLeft, 2); assert.equal(state.progress.points, 150); assert.equal(state.battle.won, true); assert.equal(state.rewardMailIds.length, 1); assert(state.message.includes('システム便')); assert.equal(state.pending, null); s.controller.dispose();
});

test('double clicks and uncertain retries never allocate a second battle request', async () => {
  const s = setup(), wait = deferred(); await s.controller.open();
  s.setHandler(async (route, settings, base) => settings.method === 'POST' ? wait.promise : base(route, settings));
  const sending = s.controller.battle(), repeat = s.controller.battle(); await drain(); assert.equal(s.posts().length, 1); assert.equal(await repeat, false);
  wait.reject(new TypeError('Network lost')); assert.equal(await sending, false); const requestId = s.controller.getState().pending.data.requestId;
  assert.equal(s.controller.chooseTactic('charge'), false); s.controller.close(); s.setHandler(null); await s.controller.open(); assert(await s.controller.retry());
  assert.equal(s.posts().length, 2); assert.equal(s.posts()[1].settings.data.requestId, requestId); assert.equal(s.commits(), 1); s.controller.dispose();
});

test('a committed response lost in transit is recovered after reload from the persisted same request', async () => {
  const s = setup(); await s.controller.open(); let lost = false;
  s.setHandler(async (route, settings, base) => { const result = await base(route, settings); if (settings.method === 'POST' && !lost) { lost = true; throw new TypeError('Response lost'); } return result; });
  assert.equal(await s.controller.battle(), false); const first = clone(s.posts()[0]); assert.equal(s.commits(), 1); s.controller.dispose();
  const restored = createController(s.options); await restored.open(); assert(restored.getState().pending); assert(await restored.retry()); assert.deepEqual(s.posts()[1], first); assert.equal(s.commits(), 1); assert.equal(restored.getState().pending, null); assert.equal(restored.getState().progress.battles, 1); restored.dispose();
});

test('generation with an uncertain outcome is resumed in the authorized admin mode', async () => {
  const s = setup({ admin: true, events: [] }); await s.controller.open({ admin: true }); s.controller.setDraft('七日間の決戦', 7);
  let lost = false; s.setHandler(async (route, settings, base) => { const result = await base(route, settings); if (settings.method === 'POST' && !lost) { lost = true; throw Error('Response lost'); } return result; });
  assert.equal(await s.controller.generate(), false); const id = s.posts()[0].settings.data.requestId; s.controller.close(); await s.controller.open(); assert.equal(s.controller.getState().admin, true); assert(await s.controller.retry()); assert.equal(s.posts()[1].settings.data.requestId, id); assert.equal(s.server.events.length, 1); s.controller.dispose();
});

test('a confirmed rejection clears pending while temporary and malformed responses retain it', async () => {
  for (const status of [403, 409, 429, 503]) {
    const s = setup(); await s.controller.open(); s.setHandler(async (route, settings, base) => { if (settings.method === 'POST') throw Object.assign(Error('Rejected'), { status }); return base(route, settings); });
    assert.equal(await s.controller.battle(), false); assert.equal(Boolean(s.controller.getState().pending), status >= 429); s.controller.dispose();
  }
  const s = setup(); await s.controller.open(); s.setHandler(async (route, settings, base) => { const result = await base(route, settings); if (settings.method === 'POST') result.battle.stageId = 'another_stage'; return result; });
  assert.equal(await s.controller.battle(), false); assert(s.controller.getState().pending); assert.equal(s.controller.getState().battle, null); s.controller.dispose();
});

test('failure to durably retain the request prevents sending a battle', async () => {
  const storage = storageFixture(); storage.setItem = () => { throw Error('Storage disabled'); }; const s = setup({ storage }); await s.controller.open(); assert.equal(await s.controller.battle(), false); assert.equal(s.posts().length, 0); assert(s.controller.getState().error); s.controller.dispose();
});

test('late personal results cannot cross an account or privilege epoch change', async () => {
  for (const switchContext of [value => ({ ...value, epoch: 2, playerId: OTHER, user: { id: OTHER, isAdmin: false } }), value => ({ ...value, privilegeEpoch: 2 }), value => ({ ...value, accountEpoch: 2, banned: true })]) {
    const s = setup(), wait = deferred(); await s.controller.open(); s.setHandler(async (route, settings, base) => { if (settings.method === 'POST') { const result = await base(route, settings); await wait.promise; return result; } return base(route, settings); });
    const sending = s.controller.battle(); await drain(); s.setContext(switchContext(s.context())); s.controller.getState(); wait.resolve(); assert.equal(await sending, false); assert.equal(s.controller.getState().battle, null); assert.equal(s.controller.getState().message, ''); s.controller.dispose();
  }
});

test('operator removal immediately drops the private view and refuses its in-flight draft', async () => {
  const s = setup({ admin: true }), wait = deferred(); await s.controller.open({ admin: true }); s.controller.setDraft('秘密の下書き', 3);
  s.setHandler(async (route, settings, base) => { if (settings.method === 'POST') { const result = await base(route, settings); await wait.promise; return result; } return base(route, settings); });
  const sending = s.controller.generate(); await drain(); s.setContext({ ...contextFixture(false), privilegeEpoch: 2 }); await s.controller.refreshAccess(); wait.resolve(); assert.equal(await sending, false); const state = s.controller.getState(); assert.equal(state.open, false); assert.equal(state.authorized, false); assert.equal(state.name, ''); assert.equal(state.event, null); assert.equal(state.pending, null); s.controller.dispose();
});

test('public poll keeps selected stage/tactic and previous result while updating personal counters', async () => {
  const s = setup(); await s.controller.open(); s.controller.chooseStage('stage_3'); s.controller.chooseTactic('defend'); await s.controller.battle(); const before = s.controller.getState().battle;
  s.server.progress.points += 50; await s.controller.refresh({ quiet: true }); const state = s.controller.getState(); assert.equal(state.stageId, 'stage_3'); assert.equal(state.tactic, 'defend'); assert.deepEqual(state.battle, before); assert.equal(state.progress.points, 250); s.controller.dispose();
});

test('server-adjusted expiry and daily quota block a new battle without trusting the device calendar', async () => {
  const s = setup(); await s.controller.open(); s.advance(3 * 86400000); assert.equal(await s.controller.battle(), false); assert.equal(s.posts().length, 0); s.controller.dispose();
  const exhausted = setup({ progress: progressFixture({ attemptsToday: 3, attemptsLeft: 0, battles: 3 }) }); await exhausted.controller.open(); assert.equal(await exhausted.controller.battle(), false);
  exhausted.server.progress = progressFixture({ dayIndex: 2 }); await exhausted.controller.refresh(); assert.equal(exhausted.controller.getState().progress.dayIndex, 2); assert(await exhausted.controller.battle()); exhausted.controller.dispose();
});

test('out-of-order detail reads cannot overwrite a newly selected event', async () => {
  const a = eventFixture(), b = eventFixture({ id: 'ev_' + 'b'.repeat(32), name: '第二の決戦' }), s = setup({ events: [a, b] }), wait = deferred(); await s.controller.open();
  s.setHandler(async (route, settings, base) => { if (route === '/events/' + a.id) { const result = await base(route, settings); await wait.promise; return result; } return base(route, settings); });
  const first = s.controller.select(a.id); await drain(); await s.controller.select(b.id); wait.resolve(); await first; assert.equal(s.controller.getState().selectedId, b.id); assert.equal(s.controller.getState().event.name, b.name); s.controller.dispose();
});

test('rendering escapes supplied text and keeps avatar, premium name and rank in the correct order', () => {
  const malicious = eventFixture({ name: '<img src=x onerror=alert(1)>' }); malicious.plan.stages[0].description = '<script>PRIVATE</script>';
  const html = detailMarkup(cleanEvent(malicious), false); assert(!html.includes('<img src=x')); assert(!html.includes('<script>')); assert(html.includes('&lt;img')); assert(html.includes('&lt;script&gt;'));
  const prior = [global.SengokuAvatar, global.SengokuEvaluationUI, global.SengokuPremiumRuntime];
  global.SengokuAvatar = { markup: player => '<span class="avatar-fixture" data-player-avatar="' + player.id + '"></span>' }; global.SengokuEvaluationUI = { badge: () => '<span class="rank-fixture">位階</span>' }; global.SengokuPremiumRuntime = { nameMarkup: name => name };
  const ranks = leaderboardMarkup(cleanLeaderboard(rankFixture()), eventFixture()); assert(ranks.indexOf('avatar-fixture') < ranks.indexOf('data-premium-player=')); assert(ranks.indexOf('data-premium-player=') < ranks.indexOf('rank-fixture')); assert(!ranks.includes('isAdmin')); assert(!ranks.includes('isStaff'));
  [global.SengokuAvatar, global.SengokuEvaluationUI, global.SengokuPremiumRuntime] = prior;
});

// Small DOM fixture used by the existing UI tests, extended with form/class state.
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[entity]));
class Element {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.parentElement = null; this.attributes = {}; this.events = {}; this.id = ''; this.className = ''; this._text = ''; this._html = ''; this._disabled = false; this.open = false; this.value = ''; this.hidden = false; this.scrollTop = 0; this.classList = { toggle: (name, on) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); if (on) names.add(name); else names.delete(name); this.className = [...names].join(' '); } }; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); if (name === 'class') this.className = String(value); if (name === 'disabled') this._disabled = true; if (name === 'hidden') this.hidden = true; if (name === 'value') this.value = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  get disabled() { return this._disabled; }
  set disabled(value) { this._disabled = Boolean(value); if (this._disabled) this.attributes.disabled = ''; else delete this.attributes.disabled; }
  get isConnected() { return this === this.document.body || this.document.body.contains(this); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = String(value); for (const node of [...this.children]) node.remove(); }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    this._html = String(html); this._text = ''; for (const node of [...this.children]) node.remove(); const stack = [this];
    for (const part of String(html).match(/<[^>]*>|[^<]+/g) || []) {
      if (part.startsWith('</')) { stack.pop(); continue; } if (!part.startsWith('<')) { stack.at(-1)._text += decode(part); continue; }
      const match = /^<([a-zA-Z0-9-]+)([\s\S]*?)\/?\s*>$/.exec(part); if (!match) continue; const node = new Element(match[1], this.document);
      for (const attr of match[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1], decode(attr[2] || '')); stack.at(-1).append(node);
      if (!part.endsWith('/>') && !['IMG', 'INPUT', 'BR', 'HR', 'META', 'LINK'].includes(node.tagName)) stack.push(node);
    }
  }
  append(node) { node.remove(); node.parentElement = this; this.children.push(node); return node; }
  remove() { if (!this.parentElement) return; if (this.contains(this.document.activeElement)) this.document.activeElement = this.document.body; const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) { if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim())); if (selector === '*') return true; if (selector.startsWith('#')) return this.id === selector.slice(1); if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1)); const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector); if (attr) return this.hasAttribute(attr[1]) && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]); return this.tagName === selector.toUpperCase(); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) { return this.children.flatMap(node => [node, ...node.querySelectorAll('*')]).filter(node => node.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
  removeEventListener(type, handler) { this.events[type] = (this.events[type] || []).filter(item => item !== handler); }
  dispatch(type, target = this, extra = {}) { const event = { target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; for (const handler of this.events[type] || []) handler(event); return event; }
  focus() { this.document.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  scrollIntoView() {}
}
function documentFixture() {
  const doc = { readyState: 'complete', hidden: false, events: {}, createElement: tag => new Element(tag, doc), addEventListener: Element.prototype.addEventListener, removeEventListener: Element.prototype.removeEventListener, dispatch: Element.prototype.dispatch };
  doc.body = doc.createElement('body'); doc.activeElement = doc.body; doc.querySelector = selector => doc.body.querySelector(selector); doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  const entry = doc.createElement('button'); doc.body.append(entry); entry.focus(); const badge = doc.createElement('span'); badge.setAttribute('data-events-status', ''); doc.body.append(badge); return { doc, entry, badge };
}
function uiSetup(settings = {}) {
  const s = setup(settings), { doc, entry, badge } = documentFixture(), routes = [];
  s.controller.dispose(); const ui = createUI({ ...s.options, document: doc, autoPoll: false, openSocial: tab => routes.push(tab) });
  const get = selector => doc.querySelector(selector), click = selector => { const node = get(selector); assert(node, 'Missing UI control ' + selector); get('#events-dialog').dispatch('click', node); };
  return { ...s, controller: ui.controller, ui, doc, entry, badge, routes, get, click };
}

test('live UI updates preserve focused tactic, selected battlefield and scroll position', async () => {
  const s = uiSetup(); await s.ui.open(); const select = s.get('#events-tactic'), main = s.get('[data-events-main]');
  s.controller.chooseStage('stage_2'); s.controller.chooseTactic('defend'); select.focus(); main.scrollTop = 420; s.server.progress.points = 75; await s.ui.refresh();
  assert.equal(s.get('#events-tactic'), select); assert.equal(select.value, 'defend'); assert.equal(s.doc.activeElement, select); assert.equal(main.scrollTop, 420); assert.equal(s.controller.getState().stageId, 'stage_2'); assert(s.get('[data-event-progress]').textContent.includes('75'));
  assert.equal(s.get('[data-events-generator]').hidden, true); assert.equal(s.get('[data-events-battle-submit]').disabled, false); assert.equal(s.badge.textContent, '開催中'); s.ui.close(); assert.equal(s.doc.activeElement, s.entry); s.ui.dispose();
});

test('admin input survives refresh and the UI confirms publication without losing the draft review', async () => {
  const s = uiSetup({ admin: true, events: [draftFixture()] }); await s.ui.open({ admin: true }); const input = s.get('#events-name'), main = s.get('[data-events-main]');
  input.value = '次の新しい決戦'; input.focus(); s.get('#events-dialog').dispatch('input', input); main.scrollTop = 310; await s.ui.refresh(); assert.equal(s.get('#events-name'), input); assert.equal(input.value, '次の新しい決戦'); assert.equal(s.doc.activeElement, input); assert.equal(main.scrollTop, 310);
  assert.equal(s.get('[data-events-generator]').hidden, false); assert(s.get('[data-events-detail]').textContent.includes('5つの戦術')); assert(s.get('[data-events="discard"]'));
  s.click('[data-events="publish"]'); assert.equal(s.get('[data-events-confirm]').hidden, false); assert(s.get('[data-events-confirm]').textContent.includes('3日間')); assert.equal(s.posts().length, 0); s.click('[data-events="confirm"]'); await drain(); assert.equal(s.posts().length, 1); assert.equal(s.controller.getState().event.status, 'active'); s.ui.dispose();
});

test('the native tactic control has five choices, keyboard stage selection works, and mail opens the existing inbox', async () => {
  const s = uiSetup(); await s.ui.open(); assert.equal(s.get('#events-tactic').querySelectorAll('option').length, 5); assert.equal(s.doc.querySelectorAll('[data-events="stage"]').length, 3);
  const first = s.doc.querySelectorAll('[data-events="stage"]')[0]; first.focus(); const key = s.get('#events-dialog').dispatch('keydown', first, { key: 'ArrowRight' }); assert.equal(key.prevented, true); assert.equal(s.controller.getState().stageId, 'stage_2'); assert.equal(s.doc.activeElement.getAttribute('data-stage-id'), 'stage_2');
  s.click('[data-events="mail"]'); assert.deepEqual(s.routes, ['mail']); assert.equal(s.get('#events-dialog').open, false); s.ui.dispose();
});

test('admin identity loss clears the private modal DOM and a public view has no management controls', async () => {
  const s = uiSetup({ admin: true, events: [draftFixture({ name: '公開しない計画' })] }); await s.ui.open({ admin: true }); assert(s.get('[data-events-detail]').textContent.includes('公開しない計画'));
  s.controller.setDraft('入力中の非公開名', 7); assert.equal(s.get('#events-name').value, '入力中の非公開名');
  s.setContext({ ...contextFixture(false), privilegeEpoch: 2 }); await s.ui.refreshAccess(); assert.equal(s.get('#events-dialog').open, false); assert.equal(s.get('[data-events-detail]').textContent, ''); assert.equal(s.get('[data-events-list]').textContent, ''); assert.equal(s.get('#events-name').value, '');
  await s.ui.open(); assert.equal(s.get('[data-events-generator]').hidden, true); assert.equal(s.get('[data-events="publish"]'), null); assert(s.get('[data-events-list]').textContent.includes('現在、催事・合戦はありません')); s.ui.dispose();
});

async function run() { let failed = 0; for (const [name, body] of tests) { try { await body(); console.log('PASS', name); } catch (error) { failed++; console.error('FAIL', name, error.stack || error); } } console.log(`${tests.length - failed}/${tests.length} events UI checks passed`); if (failed) process.exitCode = 1; }
if (require.main === module) run();
module.exports = { eventFixture, draftFixture, progressFixture, rankFixture, contextFixture, storageFixture, setup, documentFixture };
