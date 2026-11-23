'use strict';
// In-memory event fixtures only. No real API, account, save, battle or mail is changed.
const assert = require('node:assert/strict');
const { createController, createUI, cleanEvent, cleanProgress, cleanLeaderboard, cleanCatalog, selectedAdvice, adviserMarkup, defenseAdviserMarkup, outcomeMarkup, catalogOptionsMarkup, catalogSelectionMarkup, detailMarkup, battleMarkup, leaderboardMarkup } = require('../events.js');
const clone = value => JSON.parse(JSON.stringify(value));
const tests = [], test = (name, run) => tests.push([name, run]);
const NOW = Date.parse('2026-11-22T03:00:00Z'), OWNER = 'u_' + '1'.repeat(32), OTHER = 'u_' + '2'.repeat(32);
const BATTLE_ID = 'history:kawanakajima';
const catalogFixture = () => [
  { id: BATTLE_ID, name: '川中島の戦い', category: 'historical', themeId: 'river', unificationEligible: false, description: '川辺で三つの戦場に挑む合戦。' },
  { id: 'history:sekigahara', name: '関ヶ原の戦い', category: 'historical', themeId: 'plain', unificationEligible: true, description: '全戦場の勝利と最終戦功で天下統一。' },
  { id: 'castle:edo', name: '江戸城の戦い', category: 'castle', themeId: 'castle', unificationEligible: false, description: '江戸城を舞台にした城攻め。' },
  { id: 'roaming:bandits', name: '街道の野盗', category: 'roaming', themeId: 'forest', unificationEligible: false, description: '街道に現れた野良兵。' }
];
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
  const plan = { schemaVersion: 1, generator: 'game-ai-v1', name, durationDays, theme: { id: 'mist', label: '霧中の戦場', description: '川霧に包まれた平野で、敵の動きを読み切る。' }, synopsis: '霧が覆う川辺に、敵の軍勢が布陣した。三つの戦場で采配を振るい、戦功を重ねよう。', rules: ['出陣には通常の指令を1消費します。', '城や兵は失いません。', '達成した褒賞はシステム便に届きます。'], commandCost: 1, tactics, stages: ['先陣の渡河', '濃霧の攻防', '決戦・八幡原'].map((stage, index) => ({ id: 'stage_' + (index + 1), name: stage, description: ['川岸に構える前衛を突破する。', '視界の利かない戦場で敵本隊に迫る。', '精強な本陣を崩して勝機を掴む。'][index], enemyName: ['川辺の先鋒隊', '霧中の騎馬隊', '八幡原の精鋭'][index], enemyPower: 1000 + index * 600, basePoints: 100 + index * 50, recommendedTactic: ['balanced', 'ambush', 'feint'][index], tacticHint: ['均衡を保って前進しよう。', '霧を利用した奇襲が好機。', '本陣の守りを陽動で崩そう。'][index], tacticMultipliers: { balanced: 1, charge: .9, defend: 1.05, ambush: 1.2, feint: 1.1 } })), milestones: [100, 300, 600].map((points, index) => ({ id: 'honour_' + index, title: ['初陣の功', '歴戦の証', '八幡原の誉れ'][index], points, gift: { gold: 500 * (index + 1), rice: 500, wood: 100, stone: 100, magatama: 10 * (index + 1) } })) };
  return { id: 'ev_' + 'a'.repeat(32), name, durationDays, status: 'active', startsAt: '2026-11-22T00:00:00Z', endsAt: new Date(Date.parse('2026-11-22T00:00:00Z') + durationDays * 86400000).toISOString(), endedAt: null, createdAt: '2026-11-21T12:00:00Z', plan, ...extra };
}
const draftFixture = (extra = {}) => eventFixture({ status: 'draft', startsAt: null, endsAt: null, ...extra });
const progressFixture = (extra = {}) => ({ points: 0, wins: 0, battles: 0, command: { available: 3, max: 3, cost: 1 }, rewards: [], battleEligibility: { canAttack: true, reason: null }, ...extra });
function catalogEventFixture(battleId = BATTLE_ID, extra = {}) {
  const battle = catalogFixture().find(item => item.id === battleId), event = eventFixture({ name: battle.name, ...extra });
  event.plan.battleId = battle.id; event.plan.battle = clone(battle);
  event.plan.ending = { kind: battle.unificationEligible ? 'unification' : 'victory', requiredStageIds: event.plan.stages.map(stage => stage.id), requiredPoints: 600, reward: battle.unificationEligible ? 'shogunate_right' : null };
  event.plan.battleRewards = { victory: event.plan.stages.map((_, i) => ({ gold: 100 * (i + 1), rice: 100, wood: 30, stone: 20, magatama: 0 })), defeat: event.plan.stages.map(() => ({ gold: 20, rice: 30, wood: 0, stone: 0, magatama: 0 })) };
  return event;
}
function advisedProgressFixture(event = catalogEventFixture(), extra = {}) {
  return progressFixture({ advisers: event.plan.stages.map(stage => {
    const options = event.plan.tactics.map(tactic => ({ tactic: tactic.id, tacticName: tactic.name, winChance: tactic.id === 'charge' ? 80 : 52, playerPower: tactic.id === 'charge' ? 1900 : 1200, enemyPower: stage.enemyPower }));
    return { stageId: stage.id, ...options.find(item => item.tactic === 'charge'), reason: '現在の軍団では武勇を生かした突撃が有利です。', options };
  }), unification: { eligible: event.plan.ending.kind === 'unification', clearedStageIds: [], requiredStageIds: event.plan.stages.map(stage => stage.id), points: 0, requiredPoints: 600, achieved: false, earnedAt: null }, ...extra });
}
function defenseAdviserFixture(event = catalogEventFixture('castle:edo')) {
  return { castleId:'edo', castleName:'江戸城', defenseTroops:2400, defensePower:9600, reinforcementTroops:400,
    headline:'城壁を整え、守備隊を支える', summary:'守備隊と駐留中の援軍をもとに、今の城に合う備えをまとめました。',
    measures:[{id:'alliance',priority:2,title:'同盟の援軍を確保する',detail:'駐留している400人の援軍は期限を確認しましょう。'},
      {id:'wall',priority:1,title:'城壁の強化を進める',detail:'通常の城下町で城壁を強化し、守りを厚くしましょう。'},
      {id:'readiness',priority:3,title:'兵の配置を継続して確認する',detail:'ほかの出陣の後は、城に残る兵数を見直しましょう。'}],
    stages:event.plan.stages.map(stage=>({stageId:stage.id,stageName:stage.name,attackTactic:stage.recommendedTactic,attackTacticName:event.plan.tactics.find(t=>t.id===stage.recommendedTactic).name,defensePlan:'要所を守り、予備兵を残す',reason:'この戦場の地形に適した攻撃に備えて、城門と側面の守りを分担します。'})) };
}
const evaluationFixture = { version: 1, score: 32000, maxScore: 100000, rankIndex: 6, rankId: 'court-6', rankName: '従五位下' };
const rankFixture = () => [{ rank: 1, playerId: OTHER, name: '甲斐の領主', avatarVersion: 'c'.repeat(64), evaluation: evaluationFixture, points: 350, wins: 3, battles: 3, isAdmin: true, isStaff: true }];
const contextFixture = (admin = false) => ({ epoch: 1, privilegeEpoch: 1, accountEpoch: 1, playerId: OWNER, user: { id: OWNER, name: '越後の領主', isAdmin: admin, isStaff: false }, isAdmin: admin, connected: true, pending: false, banned: false });
function storageFixture() { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values }; }
function setup({ admin = false, context = contextFixture(admin), events = [eventFixture()], progress = progressFixture(), storage = storageFixture(), catalog = catalogFixture() } = {}) {
  let access = clone(context), clock = NOW, handler, sequence = 0, committed = 0;
  const calls = [], changes = [], receipts = new Map(), server = { events: clone(events), progress: clone(progress), leaderboard: rankFixture(), catalog: clone(catalog) };
  const base = async (route, settings) => {
    if (settings.method !== 'POST') {
      if (route === '/events/catalog') return { ok: true, version: 1, battles: clone(server.catalog) };
      if (route === '/events' || route === '/admin/events') return { ok: true, serverNow: new Date(clock).toISOString(), events: clone(server.events.filter(event => event.status !== 'discarded' && (route === '/admin/events' || event.status !== 'draft'))) };
      const event = server.events.find(event => '/events/' + event.id === route); assert(event, 'Unknown fixture read: ' + route);
      return { ok: true, serverNow: new Date(clock).toISOString(), event: clone(event), progress: access.user ? clone(server.progress) : null, leaderboard: clone(server.leaderboard) };
    }
    const data = settings.data;
    if (receipts.has(data.requestId)) return { ...clone(receipts.get(data.requestId)), idempotent: true };
    let event, result;
    if (route === '/admin/events/generate') { assert(server.catalog.some(item => item.id === data.battleId)); event = catalogEventFixture(data.battleId, { status: 'draft', startsAt: null, endsAt: null, id: 'ev_' + String(++committed).padStart(32, '0'), durationDays: data.durationDays }); server.events.unshift(event); }
    else {
      event = server.events.find(event => route.includes('/' + event.id + '/')); assert(event, 'Unknown fixture mutation: ' + route);
      if (route.endsWith('/publish')) { assert.equal(event.status, 'draft'); event.status = 'active'; event.startsAt = new Date(clock).toISOString(); event.endsAt = new Date(clock + event.durationDays * 86400000).toISOString(); }
      else if (route.endsWith('/end')) { assert.equal(event.status, 'active'); event.status = 'ended'; event.endedAt = new Date(clock).toISOString(); }
      else if (route.endsWith('/discard')) { assert.equal(event.status, 'draft'); event.status = 'discarded'; }
      else if (route.endsWith('/battle')) {
        if (server.progress.command.available < 1) throw Object.assign(Error('指令不足です。'), { status: 409, code: 'INSUFFICIENT_COMMAND' });
        const stage = event.plan.stages.find(stage => stage.id === data.stageId), tactic = event.plan.tactics.find(tactic => tactic.id === data.tactic);
        assert(stage && tactic); server.progress.battles++; server.progress.wins++; server.progress.points += stage.basePoints; server.progress.command.available--;
        const mailId = 'm_' + String(server.progress.battles).padStart(32, '0'); server.progress.rewards = [{ milestoneId: 'honour_0', mailId, awardedAt: new Date(clock).toISOString() }];
        result = { progress: clone(server.progress), battle: { won: true, points: stage.basePoints, stageId: stage.id, stageName: stage.name, tactic: tactic.id, tacticName: tactic.name, enemyName: stage.enemyName, playerPower: 1450, enemyPower: stage.enemyPower, winChance: 67, summary: '敵陣を突破し、戦功を挙げました。', log: ['保存した軍団を編成。', tactic.name + 'を採用し、前進。', '敵の守りを崩し、勝利。'] }, rewardMailIds: [mailId] };
      } else assert.fail('Unknown fixture mutation: ' + route);
      committed++;
    }
    result = { ok: true, serverNow: new Date(clock).toISOString(), event: clone(event), ...result, idempotent: false }; receipts.set(data.requestId, clone(result)); return result;
  };
  const options = { now: () => clock, uuid: () => 'event_request_' + ++sequence, storage, catalog: clone(catalog), getContext: () => clone(access), request: (route, settings = { method: 'GET' }) => { calls.push({ route, settings: clone(settings) }); return handler ? handler(route, settings, base) : base(route, settings); }, onChange: state => changes.push(state) };
  const controller = createController(options);
  return { controller, options, calls, changes, server, storage, receipts, base, posts: () => calls.filter(call => call.settings.method === 'POST'), commits: () => committed, setContext(value) { access = clone(value); }, context: () => clone(access), setHandler(value) { handler = value; }, advance(ms) { clock += ms; } };
}

test('plans and progress accept the agreed bounded format and exclude private role/creator metadata', () => {
  const raw = eventFixture({ creatorId: OWNER, createdBy: { name: '秘密の運営', isAdmin: true }, internalPrompt: 'PRIVATE' });
  const event = cleanEvent(raw); assert(event); assert(!JSON.stringify(event).includes('PRIVATE')); assert(!JSON.stringify(event).includes('creator'));
  assert.equal(cleanEvent(draftFixture()), null); assert(cleanEvent(draftFixture(), true)); assert.equal(cleanEvent(draftFixture({ status: 'discarded' })), null); assert(cleanEvent(draftFixture({ status: 'discarded' }), true));
  for (const change of [{ durationDays: 8 }, { id: 'bad/id' }, { endsAt: 'invalid' }, { status: 'other' }]) assert.equal(cleanEvent(eventFixture(change)), null);
  const plan = clone(raw.plan); plan.stages[0].tacticMultipliers.charge = Infinity; assert.equal(cleanEvent({ ...raw, plan }), null);
  assert.equal(cleanProgress(progressFixture({ command: { available: 4, max: 3, cost: 1 } })), undefined); assert.equal(cleanProgress(progressFixture({ command: { available: 0, max: 0, cost: 1 } })), undefined); assert(cleanProgress(progressFixture({ command: null })));
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

test('catalog selection and duration validation precede generation, and an accepted draft remains unpublished', async () => {
  const s = setup({ admin: true, events: [] }); await s.controller.open({ admin: true });
  for (const [id, days] of [['', 3], ['自由に付けた合戦名', 1], [BATTLE_ID, 0], [BATTLE_ID, 8], [BATTLE_ID, 1.5], ['history:unknown', 3]]) { s.controller.setDraft(id, days); assert.equal(await s.controller.generate(), false); }
  assert.equal(s.posts().length, 0); s.controller.setDraft(BATTLE_ID, 7); assert(await s.controller.generate());
  assert.equal(s.posts()[0].route, '/admin/events/generate'); assert.deepEqual(Object.keys(s.posts()[0].settings.data).sort(), ['battleId', 'durationDays', 'requestId']); assert.equal(s.posts()[0].settings.data.battleId, BATTLE_ID); assert.equal(s.posts()[0].settings.data.durationDays, 7); assert.equal(s.controller.getState().event.status, 'draft'); assert.equal(s.controller.getState().event.name, '川中島の戦い'); assert(!s.posts().some(call => call.route.endsWith('/publish'))); s.controller.dispose();
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
  const state = s.controller.getState(); assert.equal(state.progress.command.available, 2); assert.equal(state.commands.current, 2); assert.equal(state.progress.points, 150); assert.equal(state.battle.won, true); assert.equal(state.rewardMailIds.length, 1); assert(state.message.includes('システム便')); assert.equal(state.pending, null); s.controller.dispose();
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
  const s = setup({ admin: true, events: [] }); await s.controller.open({ admin: true }); s.controller.setDraft(BATTLE_ID, 7);
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
  const s = setup({ admin: true }), wait = deferred(); await s.controller.open({ admin: true }); s.controller.setDraft(BATTLE_ID, 3);
  s.setHandler(async (route, settings, base) => { if (settings.method === 'POST') { const result = await base(route, settings); await wait.promise; return result; } return base(route, settings); });
  const sending = s.controller.generate(); await drain(); s.setContext({ ...contextFixture(false), privilegeEpoch: 2 }); await s.controller.refreshAccess(); wait.resolve(); assert.equal(await sending, false); const state = s.controller.getState(); assert.equal(state.open, false); assert.equal(state.authorized, false); assert.equal(state.name, ''); assert.equal(state.event, null); assert.equal(state.pending, null); s.controller.dispose();
});

test('public poll keeps selected stage/tactic and previous result while updating personal counters', async () => {
  const s = setup(); await s.controller.open(); s.controller.chooseStage('stage_3'); s.controller.chooseTactic('defend'); await s.controller.battle(); const before = s.controller.getState().battle;
  s.server.progress.points += 50; await s.controller.refresh({ quiet: true }); const state = s.controller.getState(); assert.equal(state.stageId, 'stage_3'); assert.equal(state.tactic, 'defend'); assert.deepEqual(state.battle, before); assert.equal(state.progress.points, 250); s.controller.dispose();
});

test('server-adjusted expiry and depleted commands block a new battle without a daily quota', async () => {
  const s = setup(); await s.controller.open(); s.advance(3 * 86400000); assert.equal(await s.controller.battle(), false); assert.equal(s.posts().length, 0); s.controller.dispose();
  const exhausted = setup({ progress: progressFixture({ command: { available: 0, max: 3, cost: 1 }, battles: 3 }) }); await exhausted.controller.open(); assert.equal(await exhausted.controller.battle(), false);
  exhausted.server.progress.command.available = 1; await exhausted.controller.refresh(); assert(await exhausted.controller.battle()); assert.equal(exhausted.controller.getState().progress.battles, 4); exhausted.controller.dispose();
});

test('command budget permits a fourth and later battle on the same event day', async () => {
  const s = setup({ progress: progressFixture({ command: { available: 7, max: 7, cost: 1 } }) }); await s.controller.open();
  for (let index = 0; index < 5; index++) assert(await s.controller.battle());
  assert.equal(s.controller.getState().progress.battles, 5); assert.equal(s.controller.getState().commands.current, 2); assert.equal(s.posts().length, 5); s.controller.dispose();
});

test('live command availability always overrides stale progress and requires the current writer', async () => {
  const s = setup(); await s.controller.open(); const access = s.context();
  for (const commands of [
    { current: 0, max: 3, cost: 1, ready: true, writable: true, message: '' },
    { current: 3, max: 3, cost: 1, ready: false, writable: true, message: '本人の保存を確認中' },
    { current: 3, max: 3, cost: 1, ready: true, writable: false, message: '別の端末が操作中' }
  ]) { s.setContext({ ...access, commands }); assert.equal(await s.controller.battle(), false); }
  assert.equal(s.posts().length, 0); s.setContext({ ...access, commands: { current: 1, max: 5, cost: 1, ready: true, writable: true, message: '' } });
  assert.equal(s.controller.getState().commands.current, 1); assert.equal(s.controller.getState().commands.max, 5); assert(await s.controller.battle()); s.controller.dispose();
});

test('a real bridge without verified live commands cannot use server DTO values as write authority', async () => {
  const previous = global.SengokuBridge; global.SengokuBridge = {};
  try { const s = setup(); await s.controller.open(); assert.equal(s.controller.getState().commands.ready, false); assert.equal(await s.controller.battle(), false); assert.equal(s.posts().length, 0); s.controller.dispose(); }
  finally { global.SengokuBridge = previous; }
});

test('the default battle path delegates to the game bridge while reads use the social facade', async () => {
  const previous = [global.SengokuBridge, global.SengokuSocial], s = setup(), bridgeCalls = [], socialCalls = [];
  const live = { ...contextFixture(), commands: { current: 3, max: 3, cost: 1, ready: true, writable: true, message: '' } };
  global.SengokuBridge = { eventBattle: async (route, settings) => { bridgeCalls.push(route); const result = await s.base(route, settings); live.commands.current = result.progress.command.available; return result; } };
  global.SengokuSocial = { eventRequest: (route, settings) => { socialCalls.push(route); return s.base(route, settings); }, getEventContext: () => clone(live) };
  try { const controller = createController({ storage: storageFixture(), now: () => NOW, uuid: () => 'bridge_request' }); await controller.open(); assert(await controller.battle()); assert.equal(bridgeCalls.length, 1); assert(socialCalls.every(route => !route.endsWith('/battle'))); assert.equal(controller.getState().commands.current, 2); controller.dispose(); }
  finally { [global.SengokuBridge, global.SengokuSocial] = previous; s.controller.dispose(); }
});

test('older saved plans retain their enemies and rewards while dropping obsolete daily limits', () => {
  const old = eventFixture(); delete old.plan.commandCost; old.plan.dailyAttempts = 3; old.plan.rules.unshift('開催開始から24時間ごとに、3回まで挑戦できます。未使用の回数は繰り越されません。');
  const event = cleanEvent(old); assert(event); assert.equal(event.plan.commandCost, 1); assert(!('dailyAttempts' in event.plan)); assert.deepEqual(event.plan.stages, old.plan.stages); assert.deepEqual(event.plan.milestones, old.plan.milestones);
  const html = detailMarkup(event, false); assert(!/24時間ごと|1日3回|今日の残り|次の回復/.test(html)); assert(html.includes('指令の回復・上限は通常の行動と共通'));
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

test('the full canonical catalog retains all castle and roaming battles and rejects invalid duplicate IDs', () => {
  const { SENGOKU_DATA } = require('../engine.js'), source = require('../battle-catalog.js').list(SENGOKU_DATA), catalog = cleanCatalog(source);
  assert(catalog); assert.equal(catalog.filter(item => item.category === 'castle').length, SENGOKU_DATA.castles.length); assert.equal(catalog.filter(item => item.category === 'roaming').length, SENGOKU_DATA.roaming.encounters.length);
  assert(catalog.some(item => item.id === 'history:sekigahara' && item.unificationEligible));
  assert.equal(cleanCatalog([...source, source[0]]), null); assert.equal(cleanCatalog([{ ...source[0], id: 'history:../other' }]), null);
});

test('catalog plans validate rewards and all unification requirements while old plans remain accepted', () => {
  const raw = catalogEventFixture('history:sekigahara'), event = cleanEvent(raw); assert(event); assert.equal(event.plan.battleId, 'history:sekigahara'); assert.equal(event.plan.ending.reward, 'shogunate_right');
  for (const mutate of [plan => plan.battle.id = BATTLE_ID, plan => plan.ending.requiredStageIds[1] = plan.ending.requiredStageIds[0], plan => plan.battleRewards.victory[0].gold = -1, plan => plan.battle.unificationEligible = false]) { const value = clone(raw); mutate(value.plan); assert.equal(cleanEvent(value), null); }
  const ordinary = cleanEvent(catalogEventFixture()); assert(ordinary); assert(!outcomeMarkup(ordinary, null).includes('幕府を開く')); assert(cleanEvent(eventFixture()));
});

test('adviser and unification progress is bounded and earned status requires every server condition', () => {
  const event = catalogEventFixture('history:sekigahara'), progress = advisedProgressFixture(event); assert(cleanProgress(progress));
  for (const mutate of [value => value.advisers[0].winChance = 101, value => value.advisers[0].options = [], value => value.advisers[1].stageId = value.advisers[0].stageId, value => value.unification.achieved = true]) { const value = clone(progress); mutate(value); assert.equal(cleanProgress(value), undefined); }
  progress.points = 600; Object.assign(progress.unification, { achieved: true, points: 600, clearedStageIds: [...progress.unification.requiredStageIds], earnedAt: new Date(NOW).toISOString() });
  const clean = cleanProgress(progress); assert(clean); assert.equal(clean.unification.achieved, true); assert(outcomeMarkup(cleanEvent(event), clean).includes('data-events="shogunate"'));
});

test('old saved generation requests can recover their original receipt without permitting new free names', async () => {
  const s = setup({ admin: true, events: [] }), event = draftFixture({ name: '以前の自由名の合戦' }), requestId = 'old-generation-request';
  const pending = { ownerId: OWNER, kind: 'generate', route: '/admin/events/generate', eventId: '', data: { name: event.name, durationDays: 3, requestId } };
  s.storage.setItem('sengoku-events-pending-v1:' + OWNER, JSON.stringify(pending)); s.receipts.set(requestId, { ok: true, event, serverNow: new Date(NOW).toISOString() }); s.controller.dispose();
  const restored = createController(s.options); await restored.open(); assert.equal(restored.getState().admin, true); assert(await restored.retry()); assert.deepEqual(s.posts()[0].settings.data, pending.data); assert.equal(restored.getState().pending, null);
  restored.setDraft(event.name, 3); assert.equal(await restored.generate(), false); assert.equal(s.posts().length, 1); restored.dispose();
});

test('a mismatched generated catalog response stays recoverable and never publishes another selection', async () => {
  const s = setup({ admin: true, events: [] }); await s.controller.open({ admin: true }); s.controller.setDraft('history:sekigahara', 3);
  s.setHandler(async (route, settings, base) => { const result = await base(route, settings); if (route === '/admin/events/generate') result.event = catalogEventFixture(BATTLE_ID, { status: 'draft', startsAt: null, endsAt: null }); return result; });
  assert.equal(await s.controller.generate(), false); assert(s.controller.getState().pending); assert.equal(s.controller.getState().event, null); assert.equal(s.posts().length, 1); s.controller.dispose();
});

test('cached catalog choices remain usable during a catalog refresh failure', async () => {
  const s = setup({ admin: true, events: [] }); s.setHandler((route, settings, base) => { if (route === '/events/catalog') throw Error('Offline catalog'); return base(route, settings); });
  assert(await s.controller.open({ admin: true })); assert.equal(s.controller.getState().catalog.length, catalogFixture().length); assert(s.controller.getState().catalogMessage.includes('登録済み'));
  s.controller.setDraft(BATTLE_ID, 3); assert(await s.controller.generate()); s.controller.dispose();
});

test('adviser application changes only the chosen tactic and the existing battle route spends the command', async () => {
  const event = catalogEventFixture(), s = setup({ events: [event], progress: advisedProgressFixture(event) }); await s.controller.open();
  const before = clone(s.controller.getState().progress); assert.equal(selectedAdvice(s.controller.getState()).tactic, 'charge'); assert(s.controller.applyAdvice());
  assert.equal(s.controller.getState().tactic, 'charge'); assert.equal(s.posts().length, 0); assert.deepEqual(s.controller.getState().progress, before); assert(adviserMarkup(s.controller.getState()).includes('80'));
  assert(await s.controller.battle()); assert.equal(s.posts()[0].settings.data.tactic, 'charge'); assert.equal(s.controller.getState().progress.command.available, before.command.available - 1); s.controller.dispose();
});

test('battle rewards show actual grants and caps separately from milestone mail and legacy battles', async () => {
  const s = setup(); await s.controller.open();
  s.setHandler(async (route, settings, base) => { const result = await base(route, settings); if (route.endsWith('/battle')) { result.battle.rewards = { gold: 30, rice: 0, wood: 0, stone: 0, magatama: 0 }; result.battle.offeredRewards = { gold: 100, rice: 100, wood: 0, stone: 0, magatama: 0 }; } return result; });
  assert(await s.controller.battle()); const state = s.controller.getState(), html = battleMarkup(state.battle, state.rewardMailIds);
  assert.equal(state.battle.rewards.gold, 30); assert(html.includes('今回の合戦報酬')); assert(html.includes('所持上限')); assert(html.includes('システム便')); assert(!battleMarkup({ ...state.battle, rewards: undefined }, []).includes('今回の合戦報酬')); s.controller.dispose();
});

test('catalog and adviser text is escaped and a legacy adviser does not invent a win rate', () => {
  const catalog = catalogFixture(); catalog[0].name = '<img src=x onerror=alert(1)>'; catalog[0].description = '<script>alert(1)</script>';
  const state = { catalog, catalogQuery: '', catalogCategory: '', battleId: BATTLE_ID, event: cleanEvent(eventFixture()), progress:progressFixture(), stageId: 'stage_1', tactic: 'balanced', signedIn: true };
  for (const html of [catalogOptionsMarkup(state), catalogSelectionMarkup(state)]) { assert(!html.includes('<img src=x')); assert(!html.includes('<script>')); }
  const html = adviserMarkup(state); assert(html.includes('戦場の地形から提案')); assert(!html.includes('<dt>勝利予測</dt>')); assert.equal(selectedAdvice(state).exact, false);
});

// Small DOM fixture used by the existing UI tests, extended with form/class state.
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[entity]));
class Element {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.parentElement = null; this.attributes = {}; this.events = {}; this.id = ''; this.className = ''; this._text = ''; this._html = ''; this._disabled = false; this.open = false; this.value = ''; this.hidden = false; this.scrollTop = 0; this.classList = { toggle: (name, on) => { const names = new Set(this.className.split(/\s+/).filter(Boolean)); if (on) names.add(name); else names.delete(name); this.className = [...names].join(' '); } }; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); if (name === 'class') this.className = String(value); if (name === 'disabled') this._disabled = true; if (name === 'hidden') this.hidden = true; if (name === 'value') this.value = String(value); }
  removeAttribute(name) { delete this.attributes[name]; if (name === 'disabled') this._disabled = false; if (name === 'hidden') this.hidden = false; }
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


test('public castle defenders are bounded, escape lord names and exclude private player fields', () => {
  const opponent = { castleId:'edo', castleName:'江戸城', lordName:'<刀>', defenseTroops:2100, defensePower:8700, playerId:'private-id', isAdmin:true, token:'secret' };
  const raw = catalogEventFixture('castle:edo', {opponent}), event = cleanEvent(raw);
  assert.deepEqual(Object.keys(event.opponent).sort(), ['castleId','castleName','defensePower','defenseTroops','lordName']);
  const html = detailMarkup(event,false);
  assert(html.includes('&lt;刀&gt;') && !html.includes('<刀>') && !html.includes('private-id') && !html.includes('secret'));
  for(const invalid of [{defensePower:0},{defenseTroops:-1},{castleId:'../edo'},{lordName:''}])assert.equal(cleanEvent({...raw,opponent:{...opponent,...invalid}}),null);
  assert.equal(cleanEvent({...raw,opponent:null}).opponent,null);
  delete raw.opponent;assert(!Object.hasOwn(cleanEvent(raw),'opponent'));
});

test('the live garrison, chosen tactic and original battle report stay distinct when the next engagement changes', async () => {
  const event = catalogEventFixture('castle:edo'), s = uiSetup({events:[event], progress:advisedProgressFixture(event)});
  const first = {castleId:'edo',castleName:'江戸城',lordName:'先の城主',defenseTroops:2000,defensePower:7500};
  const second = {...first,lordName:'次の城主',defenseTroops:3100,defensePower:13500};
  let live = first;
  function forecasts(result,defender) {
    for(const advice of result.progress?.advisers||[]){
      for(const option of advice.options){
        option.enemyPower=defender?.defensePower||event.plan.stages.find(stage=>stage.id===advice.stageId).enemyPower;
        option.winChance=option.tactic==='charge'?62:defender===first?41:29;
      }
      Object.assign(advice,advice.options.find(option=>option.tactic===advice.tactic));
    }
  }
  s.setHandler(async(route,settings,base)=>{
    const result=await base(route,settings);
    if(route==='/events/'+event.id){result.event.opponent=live;forecasts(result,live);}
    if(route.endsWith('/battle')){
      result.battle.opponent=first;result.battle.enemyPower=first.defensePower;result.battle.winChance=41;
      live=second;result.event.opponent=live;forecasts(result,live);
    }
    return result;
  });
  await s.ui.open();
  const select=s.get('#events-tactic'),main=s.get('[data-events-main]'),stats=()=>s.get('.events-adviser-stats').textContent;
  for(const stage of event.plan.stages)assert.equal(s.get('[data-event-stage-power="'+stage.id+'"]').textContent,'7,500');
  assert(s.get('[data-event-opponent]').textContent.includes('先の城主'));assert.match(stats(),/41%/);
  s.controller.chooseTactic('charge');assert.match(stats(),/62%/);
  s.controller.chooseStage('stage_2');s.controller.chooseTactic('balanced');await s.controller.battle();
  const report=s.get('[data-event-battle-result]').textContent;
  assert(report.includes('先の城主')&&report.includes('7,500')&&!report.includes('次の城主'));
  assert(s.get('[data-event-opponent]').textContent.includes('次の城主'));
  assert.match(stats(),/29%/);assert(s.get('[data-event-stage-power="stage_2"]').textContent==='13,500');
  select.focus();main.scrollTop=335;live=null;await s.ui.refresh();
  assert.equal(s.get('#events-tactic'),select);assert.equal(s.doc.activeElement,select);assert.equal(main.scrollTop,335);
  assert.equal(s.get('[data-event-stage-power="stage_2"]').textContent,event.plan.stages[1].enemyPower.toLocaleString('ja-JP'));
  assert(!s.get('[data-event-opponent]').textContent.includes('次の城主'));
  assert.equal(s.get('[data-event-battle-result]').textContent,report);s.ui.dispose();
});

test('a visitor can see a resident castle’s force without personal battle forecasts or controls to dispatch',async()=>{
  const event=catalogEventFixture('castle:edo',{opponent:{castleId:'edo',castleName:'江戸城',lordName:'守城の主',defenseTroops:700,defensePower:3080}});
  const guest={...contextFixture(),user:null,playerId:''},s=uiSetup({context:guest,events:[event]});
  await s.ui.open();assert(s.get('[data-event-opponent]').textContent.includes('守城の主'));
  assert.equal(s.get('[data-event-stage-power="stage_1"]').textContent,'3,080');
  assert.equal(s.get('.events-adviser-stats'),null);assert.equal(s.get('[data-events-battle-submit]').disabled,true);s.ui.dispose();
});

test('defensive advice has a bounded private contract and escapes every displayed recommendation',()=>{
  const event=catalogEventFixture('castle:edo'),raw=defenseAdviserFixture(event);
  Object.assign(raw,{headline:'<軍議>',summary:'<方針>',playerId:OWNER,isAdmin:true,token:'SECRET'});
  Object.assign(raw.measures[0],{title:'<援軍>',detail:'<備え>',privateNotes:'SECRET'});
  Object.assign(raw.stages[0],{stageName:'<戦場>',attackTacticName:'<奇襲>',defensePlan:'<守り>',reason:'<根拠>',attackerId:OTHER});
  const progress=cleanProgress(progressFixture({defenseAdviser:raw}));assert(progress);
  const advice=progress.defenseAdviser;
  assert.deepEqual(Object.keys(advice).sort(),['castleId','castleName','defenseTroops','defensePower','reinforcementTroops','headline','summary','measures','stages'].sort());
  assert(!JSON.stringify(advice).includes('SECRET')&&!JSON.stringify(advice).includes(OWNER)&&!JSON.stringify(advice).includes(OTHER));
  event.opponent={castleId:advice.castleId,castleName:advice.castleName,lordName:'越後の領主',defenseTroops:advice.defenseTroops,defensePower:advice.defensePower};
  const html=defenseAdviserMarkup({event,progress,signedIn:true});
  for(const label of ['軍議','方針','援軍','備え','戦場','奇襲','守り','根拠'])assert(html.includes('&lt;'+label+'&gt;')&&!html.includes('<'+label+'>'));
  assert(!html.includes('<button')&&!html.includes('<input')&&!html.includes('<select')&&!html.includes('勝利予測'));
  for(const invalid of [{castleId:'../edo'},{defensePower:0},{defenseTroops:-1},{reinforcementTroops:2401},{headline:''},{summary:'x'.repeat(1501)},
    {measures:[]},{measures:[{...raw.measures[0],priority:0}]},{measures:[raw.measures[0],raw.measures[0]]},
    {stages:[]},{stages:[raw.stages[0],raw.stages[0]]},{stages:[{...raw.stages[0],attackTactic:'../charge'}]}])assert.equal(cleanProgress(progressFixture({defenseAdviser:{...raw,...invalid}})),undefined);
  assert.equal(cleanProgress(progressFixture({defenseAdviser:null})).defenseAdviser,null);
  assert(!Object.hasOwn(cleanProgress(progressFixture()),'defenseAdviser'));
});

test('an authenticated defender gets a defense-only briefing and cannot create or apply an attack',async()=>{
  const event=catalogEventFixture('castle:edo'),defense=defenseAdviserFixture(event);
  event.opponent={castleId:'edo',castleName:'江戸城',lordName:'越後の領主',defenseTroops:defense.defenseTroops,defensePower:defense.defensePower};
  const progress=advisedProgressFixture(event,{defenseAdviser:defense,battleEligibility:{canAttack:false,reason:'own_castle'}});
  for(const advice of progress.advisers){advice.enemyPower=defense.defensePower;for(const option of advice.options)option.enemyPower=defense.defensePower;}
  const s=uiSetup({events:[event],progress});await s.ui.open();
  const panel=s.get('.events-defense-adviser');assert(panel);assert(panel.textContent.includes('防衛軍議 · あなたの拠点'));
  assert(panel.textContent.includes('2,400')&&panel.textContent.includes('9,600')&&panel.textContent.includes('400'));
  const priorities=panel.querySelectorAll('.events-defense-priority');assert.deepEqual(priorities.map(node=>node.getAttribute('data-priority')),['1','2','3']);
  assert.equal(panel.querySelector('.events-defense-stages').querySelectorAll('article').length,3);
  assert.equal(panel.querySelectorAll('button,input,select').length,0);assert(panel.textContent.includes('催事用の模擬合戦'));
  assert.equal(s.get('[data-event-adviser]').textContent,'');assert.equal(s.get('[data-events="advice"]'),null);
  assert(s.get('[data-event-participation]').textContent.includes('防衛専用'));assert.equal(s.get('[data-events-battle-form]').hidden,true);
  const stages=s.get('[data-event-stages]');assert.equal(s.get('[data-event-stages-heading]').textContent,'防衛する戦場');assert.equal(stages.querySelectorAll('article').length,3);assert.equal(stages.querySelectorAll('button').length,0);assert.equal(stages.getAttribute('role'),null);assert.equal(stages.querySelectorAll('.is-selected').length,0);assert.equal(s.get('[data-event-power-label="stage_1"]').textContent,'守備戦力');assert(!s.get('[data-event-stages-note]').textContent.includes('軍団で挑む'));
  assert.equal(s.get('#events-tactic').disabled,true);assert.equal(s.get('[data-events-battle-submit]').disabled,true);
  const before=clone(s.server.progress),tactic=s.controller.getState().tactic,stage=s.controller.getState().stageId;
  assert.equal(s.controller.chooseStage('stage_2'),false);assert.equal(s.controller.getState().stageId,stage);assert.equal(s.controller.applyAdvice(),false);assert.equal(s.controller.chooseTactic('charge'),false);assert.equal(await s.controller.battle(),false);assert.equal(s.controller.getState().tactic,tactic);
  assert.equal(s.posts().length,0);assert.deepEqual(s.server.progress,before);assert(s.get('.events-defense-adviser'));
  s.server.progress.defenseAdviser=null;await s.ui.refresh();
  assert.equal(s.get('.events-defense-adviser'),null);assert.equal(s.get('[data-events-battle-submit]').disabled,true);assert.equal(await s.controller.battle(),false);
  assert(s.get('[data-event-participation]').textContent.includes('防衛専用'));
  assert.equal(s.get('[data-event-stages-heading]').textContent,'防衛する戦場');assert.equal(s.get('[data-events="stage"]'),null);assert.equal(s.controller.chooseStage('stage_2'),false);
  s.server.progress.battleEligibility={canAttack:true,reason:null};await s.ui.refresh();
  assert.equal(s.get('[data-events-battle-form]').hidden,false);assert.equal(s.get('[data-events-battle-submit]').disabled,false);
  assert.equal(s.get('[data-event-stages-heading]').textContent,'戦場を選ぶ');assert.equal(s.get('[data-event-stages]').getAttribute('role'),'radiogroup');assert.equal(s.get('[data-event-stages]').querySelectorAll('button').length,3);assert.equal(s.controller.chooseStage('stage_2'),true);assert.equal(s.controller.getState().stageId,'stage_2');
  // The current player and the public castle lord still have the same display
  // name; only the private server authorization makes a defense briefing.
  assert.equal(s.context().user.name,s.server.events[0].opponent.lordName);s.ui.dispose();
  const state={event,progress:cleanProgress(progress),signedIn:false};assert.equal(defenseAdviserMarkup(state),'');
  for(const mutation of [{castleId:'sunpu'},{defensePower:defense.defensePower+1},{defenseTroops:defense.defenseTroops+1},
    {stages:[{...defense.stages[0],stageId:'other_stage'}]},{stages:[{...defense.stages[0],attackTactic:'other_tactic'}]}]){
    assert.equal(defenseAdviserMarkup({...state,signedIn:true,progress:cleanProgress(progressFixture({defenseAdviser:{...defense,...mutation}}))}), '');
  }
});

test('lord succession and account switching remove private defensive advice without disturbing the chosen attack tactic',async()=>{
  const event=catalogEventFixture('castle:edo'),defense=defenseAdviserFixture(event);
  event.opponent={castleId:'edo',castleName:'江戸城',lordName:'先代城主',defenseTroops:defense.defenseTroops,defensePower:defense.defensePower};
  const s=uiSetup({events:[event],progress:advisedProgressFixture(event)});await s.ui.open();
  s.controller.chooseStage('stage_2');s.controller.chooseTactic('defend');const select=s.get('#events-tactic'),main=s.get('[data-events-main]');select.focus();main.scrollTop=390;
  const attackChoice=s.get('[data-event-stages]').querySelectorAll('button')[1];assert.equal(attackChoice.getAttribute('aria-checked'),'true');
  s.server.progress.defenseAdviser=defense;s.server.progress.battleEligibility={canAttack:false,reason:'own_castle'};await s.ui.refresh();
  assert(s.get('.events-defense-adviser'));assert.equal(s.get('[data-events-battle-form]').hidden,true);assert.equal(s.controller.getState().tactic,'defend');
  assert.equal(attackChoice.isConnected,false);assert.equal(s.get('[data-event-stages-heading]').textContent,'防衛する戦場');assert.equal(s.get('[data-event-stages]').querySelectorAll('button').length,0);assert.equal(s.get('[data-event-stages]').querySelectorAll('.is-selected').length,0);assert.equal(s.controller.chooseStage('stage_3'),false);
  s.server.events[0].opponent.lordName='次代城主';s.server.progress.defenseAdviser=null;s.server.progress.battleEligibility={canAttack:true,reason:null};await s.ui.refresh();
  assert.equal(s.get('.events-defense-adviser'),null);assert.equal(s.get('#events-tactic'),select);assert.equal(select.value,'defend');assert.equal(s.doc.activeElement,select);assert.equal(main.scrollTop,390);
  assert.equal(s.get('[data-event-stages-heading]').textContent,'戦場を選ぶ');assert.equal(s.get('[data-event-stages]').querySelectorAll('button')[1].getAttribute('aria-checked'),'true');
  s.server.progress.defenseAdviser=defense;s.server.progress.battleEligibility={canAttack:false,reason:'own_castle'};await s.ui.refresh();assert(s.get('.events-defense-adviser'));
  const gate=deferred();s.setHandler((route,settings,base)=>route==='/events'?gate.promise:base(route,settings));
  const next={...s.context(),playerId:OTHER,user:{id:OTHER,name:'先代城主'},epoch:2};s.setContext(next);const changing=s.ui.refreshAccess();
  assert.equal(s.get('.events-defense-adviser'),null);assert.equal(s.controller.getState().progress,null);
  s.server.progress.defenseAdviser=null;s.server.progress.battleEligibility={canAttack:true,reason:null};gate.resolve(await s.base('/events',{method:'GET'}));await changing;
  assert.equal(s.get('.events-defense-adviser'),null);assert.equal(s.posts().length,0);s.ui.dispose();
});

test('reopening a defender event keeps read-only stages without requiring private advice or guessing from a lord name',async()=>{
  const event=catalogEventFixture('castle:edo');event.opponent={castleId:'edo',castleName:'江戸城',lordName:'同名の領主',defenseTroops:1200,defensePower:4800};
  const context=contextFixture();context.user.name='同名の領主';const s=uiSetup({context,events:[event],progress:progressFixture({battleEligibility:{canAttack:false,reason:'own_castle'},defenseAdviser:null})});
  for(let attempt=0;attempt<2;attempt++){await s.ui.open();assert.equal(s.get('[data-event-stages-heading]').textContent,'防衛する戦場');assert.equal(s.get('[data-events="stage"]'),null);assert.equal(s.get('[data-event-stages]').querySelectorAll('article').length,3);assert.equal(s.controller.chooseStage('stage_3'),false);assert.equal(await s.controller.battle(),false);s.ui.close();}
  s.server.progress.battleEligibility={canAttack:true,reason:null};await s.ui.open();assert.equal(s.context().user.name,event.opponent.lordName);assert.equal(s.get('[data-event-stages-heading]').textContent,'戦場を選ぶ');assert.equal(s.controller.chooseStage('stage_3'),true);assert.equal(s.get('[data-events-battle-submit]').disabled,false);assert.equal(s.posts().length,0);s.ui.dispose();
});

test('private attack eligibility is bounded, defaults closed while missing or stale, and never blocks receipt recovery',async()=>{
  for(const battleEligibility of [null,{canAttack:'yes',reason:null},{canAttack:true,reason:'own_castle'},{canAttack:false,reason:null},{canAttack:false,reason:'other'}])assert.equal(cleanProgress(progressFixture({battleEligibility})),undefined);
  const cleaned=cleanProgress(progressFixture({battleEligibility:{canAttack:false,reason:'own_castle',ownerId:OWNER,isAdmin:true}}));
  assert.deepEqual(cleaned.battleEligibility,{canAttack:false,reason:'own_castle'});
  const s=uiSetup({progress:progressFixture({battleEligibility:{canAttack:false,reason:'refresh_required'}})});await s.ui.open();
  assert.equal(s.get('[data-events-battle-form]').hidden,false);assert.equal(s.get('[data-events-battle-submit]').disabled,true);assert.equal(await s.controller.battle(),false);
  assert(s.get('[data-event-participation]').textContent.includes('最新の領主情報'));assert.equal(s.controller.applyAdvice(),false);
  delete s.server.progress.battleEligibility;await s.ui.refresh();assert.equal(await s.controller.battle(),false);assert.equal(s.posts().length,0);
  s.server.progress.battleEligibility={canAttack:true,reason:null};await s.ui.refresh();
  s.setHandler(async(route,settings,base)=>{const result=await base(route,settings);if(route.endsWith('/battle')){s.server.progress.battleEligibility={canAttack:false,reason:'own_castle'};throw Error('応答を受け取れませんでした。');}return result;});
  assert.equal(await s.controller.battle(),false);const pending=clone(s.controller.getState().pending);assert(pending);assert.equal(s.commits(),1);
  s.setHandler(async(route,settings,base)=>{const result=await base(route,settings);if(route.endsWith('/battle'))result.progress.battleEligibility={canAttack:false,reason:'own_castle'};return result;});
  assert.equal(await s.controller.retry(),true);assert.equal(s.commits(),1);assert.equal(s.posts().length,2);
  assert.equal(s.posts()[0].settings.data.requestId,pending.data.requestId);assert.equal(s.posts()[1].settings.data.requestId,pending.data.requestId);
  assert(s.get('[data-event-battle-result]').textContent.includes('勝利'));assert.equal(s.get('[data-events-battle-submit]').disabled,true);s.ui.dispose();
});

test('the one-second UI tick reflects command recovery without a fetch, form replacement or focus loss', async () => {
  const live = { ...contextFixture(), commands: { current: 0, max: 5, cost: 1, ready: true, writable: true, message: '' } };
  const s = setup({ context: live }), { doc } = documentFixture(), timers = new Map(); let nextTimer = 0; s.controller.dispose();
  const ui = createUI({ ...s.options, document: doc, setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } });
  await ui.open(); await drain(); const get = selector => doc.querySelector(selector), select = get('#events-tactic'), main = get('[data-events-main]');
  ui.controller.chooseStage('stage_2'); ui.controller.chooseTactic('defend'); select.focus(); main.scrollTop = 420;
  assert.equal(get('[data-event-command-current]').textContent, '0'); assert.equal(get('[data-event-command-max]').textContent, '5'); assert.equal(get('[data-events-battle-submit]').disabled, true); assert(get('[data-event-battle-access]').textContent.includes('指令不足'));
  const requests = s.calls.length; s.setContext({ ...live, commands: { ...live.commands, current: 1 } });
  const [timerId, timer] = [...timers].find(([, timer]) => timer.delay === 1000); timers.delete(timerId); timer.fn();
  assert.equal(get('[data-event-command-current]').textContent, '1'); assert.equal(get('[data-events-battle-submit]').disabled, false); assert.equal(s.calls.length, requests); assert.equal(get('#events-tactic'), select); assert.equal(doc.activeElement, select); assert.equal(select.value, 'defend'); assert.equal(main.scrollTop, 420);
  assert(!/今日の残り|次の回復|各日3回|24時間ごと/.test(get('[data-events-detail]').textContent)); ui.dispose(); assert.equal(timers.size, 0);
});

test('admin input survives refresh and the UI confirms publication without losing the draft review', async () => {
  const s = uiSetup({ admin: true, events: [draftFixture()] }); await s.ui.open({ admin: true }); const input = s.get('#events-battle'), main = s.get('[data-events-main]');
  input.value = 'history:sekigahara'; input.focus(); s.get('#events-dialog').dispatch('change', input); main.scrollTop = 310; await s.ui.refresh(); assert.equal(s.get('#events-battle'), input); assert.equal(input.value, 'history:sekigahara'); assert.equal(s.doc.activeElement, input); assert.equal(main.scrollTop, 310);
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
  s.controller.setDraft('history:sekigahara', 7); assert.equal(s.get('#events-battle').value, 'history:sekigahara');
  s.setContext({ ...contextFixture(false), privilegeEpoch: 2 }); await s.ui.refreshAccess(); assert.equal(s.get('#events-dialog').open, false); assert.equal(s.get('[data-events-detail]').textContent, ''); assert.equal(s.get('[data-events-list]').textContent, ''); assert.equal(s.get('#events-battle').value, '');
  await s.ui.open(); assert.equal(s.get('[data-events-generator]').hidden, true); assert.equal(s.get('[data-events="publish"]'), null); assert(s.get('[data-events-list]').textContent.includes('現在、催事・合戦はありません')); s.ui.dispose();
});

test('catalog search and categories filter selectable battles while preserving the reviewed choice', async () => {
  const s = uiSetup({ admin: true, events: [] }); await s.ui.open({ admin: true }); assert.equal(s.get('#events-name'), null);
  const search = s.get('#events-search'), category = s.get('#events-category'), battles = s.get('#events-battle');
  search.value = '関ケ原'; search.focus(); s.get('#events-dialog').dispatch('input', search); assert(s.get('[data-events-catalog-count]').textContent.startsWith('1件')); assert(battles.innerHTML.includes('関ヶ原')); assert(!battles.innerHTML.includes('江戸城'));
  battles.value = 'history:sekigahara'; s.get('#events-dialog').dispatch('change', battles); assert(s.get('[data-events-selection]').textContent.includes('幕府開設権')); assert.equal(s.get('[data-events-generate-submit]').disabled, false);
  search.value = ''; s.get('#events-dialog').dispatch('input', search); category.value = 'castle'; s.get('#events-dialog').dispatch('change', category);
  assert(s.get('[data-events-catalog-count]').textContent.startsWith('1件')); assert(battles.innerHTML.includes('江戸城')); assert.equal(battles.value, 'history:sekigahara'); assert(battles.innerHTML.includes('選択中'));
  await s.ui.refresh(); assert.equal(s.get('#events-search'), search); assert.equal(category.value, 'castle'); assert.equal(s.controller.getState().battleId, 'history:sekigahara'); s.ui.dispose();
});

test('the adviser UI applies the authoritative tactic without sending or replacing the battle form', async () => {
  const event = catalogEventFixture(), s = uiSetup({ events: [event], progress: advisedProgressFixture(event) }); await s.ui.open(); const tactic = s.get('#events-tactic');
  assert(s.get('[data-event-adviser]').textContent.includes('軍師AI')); assert(s.get('[data-event-adviser]').textContent.includes('80')); assert.equal(s.get('[data-events="advice"]').disabled, false);
  s.click('[data-events="advice"]'); assert.equal(tactic.value, 'charge'); assert.equal(s.get('#events-tactic'), tactic); assert.equal(s.doc.activeElement, tactic); assert.equal(s.posts().length, 0); assert.equal(s.get('[data-events="advice"]').disabled, true); s.ui.dispose();
});

test('the shogunate entry appears only after earned event unification and opens the existing destination', async () => {
  const event = catalogEventFixture('history:sekigahara'), progress = advisedProgressFixture(event), s = uiSetup({ events: [event], progress });
  const previous = global.SengokuShogunate; let opened = 0; global.SengokuShogunate = { open: () => opened++ };
  try {
    await s.ui.open(); assert.equal(s.get('[data-events="shogunate"]'), null); assert(s.get('[data-event-outcome]').textContent.includes('本領の城の所有は変わりません'));
    s.server.progress.points = 600; Object.assign(s.server.progress.unification, { points: 600, achieved: true, earnedAt: new Date(NOW).toISOString(), clearedStageIds: [...event.plan.ending.requiredStageIds] });
    await s.ui.refresh(); assert(s.get('[data-events="shogunate"]')); assert.equal(opened, 0); s.click('[data-events="shogunate"]'); assert.equal(opened, 1); assert.equal(s.get('#events-dialog').open, false);
  } finally { global.SengokuShogunate = previous; s.ui.dispose(); }
});

async function run() { let failed = 0; for (const [name, body] of tests) { try { await body(); console.log('PASS', name); } catch (error) { failed++; console.error('FAIL', name, error.stack || error); } } console.log(`${tests.length - failed}/${tests.length} events UI checks passed`); if (failed) process.exitCode = 1; }
if (require.main === module) run();
module.exports = { eventFixture, draftFixture, progressFixture, catalogFixture, catalogEventFixture, advisedProgressFixture, rankFixture, contextFixture, storageFixture, setup, documentFixture };

