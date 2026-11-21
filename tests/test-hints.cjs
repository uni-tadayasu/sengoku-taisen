/* Check recommendations against real engine rules; no saves, requests or actions. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {SengokuEngine: Engine, SENGOKU_DATA: data} = require('../engine.js');
const hints = require('../hints.js');

const officerScope = {window: {}};
vm.createContext(officerScope);
vm.runInContext(fs.readFileSync(require.resolve('../officers-data.js'), 'utf8'), officerScope);
const officers = JSON.parse(JSON.stringify(officerScope.window.SENGOKU_OFFICERS));
const ready = Object.freeze({started: true, writable: true, banned: false, rolePending: false,
  syncLinked: false, syncReady: true, staffReady: true, clockReady: true, saveEnabled: true});
const tests = [];
const test = (name, run) => tests.push([name, run]);
const make = (options = {}) => new Engine({officers, seed: 24681, ...options});
const rich = game => {for (const key of data.resources) game.state.resources[key] = 9000000; return game;};
const build = (game, context = {}) => hints.build(game, {...ready, ...context});
const find = (result, id) => result.items.find(item => item.id === id);
const has = (result, id) => Boolean(find(result, id));
const ids = result => result.items.map(item => item.id);
const text = value => JSON.stringify(value);
const paid = item => /^(building:|castle:|research:|battle:|training$|recruit-troops$)/.test(item.id)
  || item.id === 'officers' && item.action.kind !== 'gacha';
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
function claimed(game) {game.state.claimedQuests = data.quests.map(quest => quest.id); return game;}
function developed(game = make()) {
  rich(claimed(game));
  for (const building of data.buildings) game.state.buildings[building.id] = 32;
  for (const tech of data.techs) game.state.tech[tech.id] = tech.max;
  game.state.castles[game.state.home].level = game.castleLevelLimit(game.state.home);
  game.state.magatama = 0;
  game.state.morale = 100;
  game.state.command = game.commandMax();
  game.state.governors = {...game.planGovernorAssignments().governors};
  return game;
}
function staff({keep = 2, castleLevel = 1, jobs = []} = {}) {
  const game = rich(make({isStaff: true}));
  const buildings = {...game.state.buildings, keep};
  assert.equal(game.applyStaffBase({id: 'sunpu', revision: 1, castleLevel,
    buildings, initial: {buildings: {...buildings}, castleLevel}, history: [], jobs,
    createdElapsedMs: 0, updatedElapsedMs: 0, accessSinceElapsedMs: 0, clanSinceElapsedMs: 0}).ok, true);
  return game;
}
function assertShape(result) {
  assert(['ready', 'blocked', 'not-started', 'game-over'].includes(result.status));
  assert.equal(typeof result.title, 'string');
  assert.equal(typeof result.summary, 'string');
  assert(Array.isArray(result.items));
  assert(result.items.length > 0 && result.items.length <= 10);
  assert.equal(new Set(ids(result)).size, result.items.length, 'hint IDs must be unique');
  for (const [index, item] of result.items.entries()) {
    assert.equal(typeof item.id, 'string');
    assert(Number.isFinite(item.priority));
    if (index) assert(result.items[index - 1].priority >= item.priority);
    assert(['urgent', 'advice', 'success', 'muted'].includes(item.tone));
    for (const key of ['category', 'title', 'reason']) assert.equal(typeof item[key], 'string', key);
    assert(['view', 'building', 'castle', 'level-guide', 'sync', 'new', 'settings', 'gacha', 'army-slot'].includes(item.action?.kind), item.id);
    assert.equal(typeof item.action.label, 'string');
    if (item.cost) for (const amount of Object.values(item.cost)) assert(Number.isFinite(amount) && amount >= 0);
    if (item.missing) for (const amount of Object.values(item.missing)) assert(Number.isFinite(amount) && amount >= 0);
    if (item.waitSeconds !== undefined) assert(Number.isFinite(item.waitSeconds) && item.waitSeconds >= 0);
  }
}
function forbidMutations(game) {
  const mutations = ['upgrade', 'upgradeCastle', 'research', 'recruitTroops', 'recruitOfficer',
    'train', 'assignArmy', 'assignGovernor', 'autoAssignGovernors', 'claimQuest', 'attack',
    'diplomacy', 'scout', 'drawOfficers', 'applyGift', 'applyWorldClock', 'tick', 'nextTurn',
    'executeStrategy', 'setRoleAccess', 'setAdminAccess', 'applyStaffBase', 'restoreAdminAssets',
    'beginLocalWalkingSession', 'applyLocalWalkingProgress', 'endLocalWalkingSession',
    '_pay', '_gain', '_action', '_advanceRealtime', 'log', 'random', 'exportSave'];
  for (const name of mutations) game[name] = () => assert.fail('hint generation called ' + name);
}

test('real clans, staff and operator produce stable navigation-only hints without changing state or RNG', () => {
  assert.equal(hints.version, 1);
  for (const game of [...data.clans.map(clan => make({clan: clan.name})), make({isAdmin: true}), staff()]) {
    const before = text(game.state), shared = text(game.getStaffBase());
    const context = freeze({...ready});
    forbidMutations(game);
    freeze(game.state);
    const result = hints.build(game, context);
    assertShape(result);
    assert.deepEqual(hints.build(game, context), result);
    assert.equal(text(game.state), before);
    assert.equal(text(game.getStaffBase()), shared);
  }
});

test('BAN, followers and unverified access return only the relevant blocked guidance', () => {
  const cases = [
    [{banned: true}, 'account-banned'],
    [{rolePending: true}, 'role-pending'],
    [{syncLinked: true, syncReady: false, writable: false}, 'sync-pending'],
    [{syncLinked: true, writable: false}, 'read-only'],
    [{clockReady: false}, 'clock-pending']
  ];
  for (const [context, expected] of cases) {
    const game = rich(make());
    game.state.stats.upgrades = 1;
    const before = text(game.state), result = build(game, context);
    assertShape(result);
    assert.equal(result.status, 'blocked', expected);
    assert.deepEqual(ids(result), [expected]);
    assert.equal(result.items.some(paid), false);
    assert.equal(text(game.state), before);
  }
  assert.equal(build(make(), {saveEnabled: false}).status, 'blocked');
});

test('not-started and lost-home campaigns do not offer gameplay actions', () => {
  const game = make();
  const start = build(game, {started: false});
  assert.equal(start.status, 'not-started');
  assert.deepEqual(ids(start), ['start']);
  game.state.gameOver = true;
  const lost = build(game);
  assert.equal(lost.status, 'game-over');
  assert.deepEqual(ids(lost), ['game-over']);
  assert.equal(lost.items[0].action.kind, 'new');
});

test('staff guidance requires both runtime base verification and the current bridge readiness flag', () => {
  const pending = rich(make({isStaff: true}));
  pending.state.buildings.keep = 29;
  const unverified = build(pending, {staffReady: true});
  assert.equal(unverified.status, 'blocked');
  assert.deepEqual(ids(unverified), ['staff-pending']);
  assert(!text(unverified).includes('Lv.29'), 'personal levels must not be shown as the shared base');
  const verified = staff();
  assert.equal(build(verified).status, 'ready');
  assert.deepEqual(ids(build(verified, {staffReady: false})), ['staff-pending']);
});

test('zero commands preserve free quest and formation guidance while suppressing paid actions', () => {
  const game = rich(make());
  game.state.command = 0;
  game.state.realtime.commandProgress = 12.5;
  game.state.stats.upgrades = 1;
  game.state.army = [];
  const result = build(game);
  assert(has(result, 'command-wait'));
  assert(has(result, 'quest-rewards'));
  assert(has(result, 'army-slots'));
  assert(has(result, 'governors'));
  assert.equal(result.items.some(paid), false);
  const wait = find(result, 'command-wait');
  if (wait.waitSeconds !== undefined) assert(Math.abs(wait.waitSeconds - 7.5) <= .5);
  const before = text(game.state);
  build(game);
  assert.equal(text(game.state), before);
});

test('quest rewards disappear after receipt and incomplete goals never masquerade as ready rewards', () => {
  const game = make();
  assert.equal(has(build(game), 'quest-rewards'), false);
  game.state.stats.upgrades = 1;
  assert.equal(game.questStatus('first_upgrade').complete, true);
  assert(has(build(game), 'quest-rewards'));
  assert.equal(game.claimQuest('first_upgrade').ok, true);
  assert.equal(has(build(game), 'quest-rewards'), false);
  claimed(game);
  game.state.stats.researches = 1;
  assert.equal(has(build(game), 'quest-rewards'), false);
});

test('negative rice production and low reserves take precedence over recruitment and battle', () => {
  for (const scenario of ['deficit', 'reserve']) {
    const game = rich(make());
    if (scenario === 'deficit') {
      game.state.buildings.barracks = 10;
      game.state.troops = 15000;
      assert(game.income().rice < 0);
    } else {
      game.state.resources.rice = game.income().upkeep * 2 - 1;
      assert(game.income().rice > 0);
    }
    const result = build(game);
    assert.equal(result.items[0].id, 'rice-balance', scenario);
    assert.equal(has(result, 'recruit-troops'), false);
    assert.equal(result.items.some(item => item.id.startsWith('battle:')), false);
    assert.equal(result.items[0].tone, scenario === 'deficit' ? 'urgent' : 'advice');
  }
});

test('recruitment quotes use real costs and leave capacity, nonnegative production and two months of food', () => {
  for (const clan of data.clans) {
    const game = developed(make({clan: clan.name}));
    game.state.troops = 1000;
    const proposal = find(build(game), 'recruit-troops');
    assert(proposal, clan.name);
    assert(Number.isSafeInteger(proposal.amount));
    assert(proposal.amount >= 100 && proposal.amount <= 1000);
    assert(game.state.troops + proposal.amount <= game.troopCapacity());
    const actual = game.recruitTroopCost(proposal.amount);
    for (const key of data.resources) assert.equal(proposal.cost[key] || 0, actual[key] || 0, clan.name + ' ' + key);
    const upkeep = Math.ceil((game.state.troops + proposal.amount) * .12 + game.ownedCastles().length * 60);
    assert(game.income().grossRice - upkeep >= 0);
    assert(game.state.resources.rice - actual.rice >= Math.max(500, upkeep * 2));
    assert(game.state.resources.gold >= actual.gold);
    const before = game.state.troops;
    assert.equal(game.recruitTroops(proposal.amount).ok, true, 'the engine must accept the proposed quantity');
    assert.equal(game.state.troops, before + proposal.amount);
  }
});

test('barely positive rice income cannot justify even the minimum additional army', () => {
  const game = rich(make());
  game.state.buildings.barracks = 10;
  game.state.troops = Math.floor((game.income().grossRice - game.ownedCastles().length * 60 - 1) / .12);
  assert(game.income().rice > 0);
  assert(game.troopCapacity() - game.state.troops > 1000);
  assert(game.income().grossRice - Math.ceil((game.state.troops + 100) * .12 + 60) < 0);
  const result = build(game);
  assert(has(result, 'rice-balance'));
  assert.equal(has(result, 'recruit-troops'), false);
});

test('recruitment finds the real integer boundary for rounded costs and post-payment food reserves', () => {
  for (const clan of ['織田家', '伊達家']) for (const constrained of ['gold', 'rice']) {
    const game = developed(make({clan}));
    game.state.troops = 1000;
    const upkeep = amount => Math.ceil((game.state.troops + amount) * .12 + game.ownedCastles().length * 60);
    const target = 347, quote = game.recruitTroopCost(target);
    if (constrained === 'gold') game.state.resources.gold = quote.gold;
    else game.state.resources.rice = quote.rice + Math.max(500, upkeep(target) * 2);
    const feasible = Array.from({length: 901}, (_, index) => index + 100).filter(amount => {
      const cost = game.recruitTroopCost(amount);
      return data.resources.every(key => game.state.resources[key] >= (cost[key] || 0))
        && game.income().grossRice >= upkeep(amount)
        && game.state.resources.rice - cost.rice >= Math.max(500, upkeep(amount) * 2);
    });
    const maximum = feasible.at(-1);
    assert(maximum >= 100 && maximum < 1000, clan + ' ' + constrained);
    const proposal = find(build(game), 'recruit-troops');
    assert(proposal);
    assert.equal(proposal.amount, maximum, clan + ' ' + constrained);
    assert.equal(proposal.missing, undefined);
    assert.equal(game.recruitTroops(proposal.amount).ok, true);
  }
});

test('unaffordable recruitment is labelled as preparation, and fewer than 100 capacity places stop it', () => {
  const poor = developed();
  poor.state.troops = 1000;
  poor.state.resources.gold = 0;
  const preparation = find(build(poor), 'recruit-troops');
  assert(preparation);
  assert.equal(preparation.amount, 100);
  assert.equal(preparation.missing.gold, poor.recruitTroopCost(100).gold);
  assert.match(preparation.title, /準備|備える/);
  assert.match(preparation.reason, /不足/);
  for (const free of [0, 99]) {
    const game = developed();
    game.state.troops = game.troopCapacity() - free;
    assert.equal(has(build(game), 'recruit-troops'), false, String(free));
  }
});

test('full construction slots stop new chains but preserve a valid existing facility reservation', () => {
  for (const existingFarm of [false, true]) {
    const game = rich(make());
    assert.equal(game.upgrade(existingFarm ? 'farm' : 'market').ok, true);
    assert.equal(game.upgradeCastle(game.state.home).ok, true);
    game.state.command = 3;
    game.state.resources.rice = 1;
    assert.equal(game.constructionChains(), game.constructionSlots());
    const result = build(game);
    assert(has(result, 'construction-wait'));
    assert.equal(has(result, 'castle:' + game.state.home), false);
    const food = find(result, 'rice-balance');
    assert(food);
    assert.equal(food.action.kind === 'building' && food.action.id === 'farm', existingFarm);
    for (const item of result.items.filter(item => item.id.startsWith('building:'))) {
      const id = item.id.slice('building:'.length);
      assert(game.state.jobs.some(job => job.kind === 'building' && job.id === id), id);
      assert.equal(game.buildingUnlock(id).ok, true);
    }
  }
});

test('facility quotes use the reserved tail level and never exceed level 32 or keep unlocks', () => {
  const game = rich(make());
  assert.equal(game.upgrade('farm').ok, true);
  assert.equal(game.upgrade('farm').ok, true);
  assert.equal(game.upgradeCastle(game.state.home).ok, true);
  game.state.command = 3;
  game.state.resources.rice = 1;
  const proposal = find(build(game), 'rice-balance');
  assert(proposal);
  assert.equal(proposal.action.kind, 'building');
  assert.equal(proposal.action.id, 'farm');
  const expected = game.costs('farm');
  for (const key of data.resources) assert.equal(proposal.cost[key] || 0, expected[key] || 0);
  for (const item of build(game).items.filter(item => item.id.startsWith('building:')))
    assert.equal(game.buildingUnlock(item.action.id).ok, true);

  const last = rich(make());
  last.state.buildings.farm = 31;
  assert.equal(last.upgrade('farm').ok, true);
  last.state.resources.rice = 1;
  assert.equal(build(last).items.some(item => item.action.kind === 'building' && item.action.id === 'farm'), false,
    'a reservation for level 32 already exhausts the facility');
  const maximum = developed();
  assert.equal(build(maximum).items.some(item => item.id.startsWith('building:')), false);
});

test('research uses its own single slot even when every construction chain is occupied', () => {
  const game = developed();
  game.state.buildings.academy = 1;
  game.state.tech.commerce = 0;
  for (const id of ['farm', 'market', 'lumber', 'quarry', 'barracks', 'wall']) {
    game.state.buildings[id] = 31;
    assert.equal(game.upgrade(id).ok, true);
  }
  assert.equal(game.constructionChains(), game.constructionSlots());
  assert(game.state.command > 0);
  const proposal = find(build(game), 'research:commerce');
  assert(proposal);
  const actual = game.researchCost('commerce');
  for (const key of data.resources) assert.equal(proposal.cost[key] || 0, actual[key] || 0);
  assert.equal(game.research('commerce').ok, true);
  game.state.command = 3;
  const busy = build(game);
  assert(has(busy, 'research-wait'));
  assert.equal(busy.items.some(item => item.id.startsWith('research:')), false);
});

test('maxed technology and academy gates suppress starts; unavailable funds produce explicit preparation', () => {
  const maximum = developed();
  assert.equal(build(maximum).items.some(item => item.id.startsWith('research:')), false);
  const gated = developed();
  gated.state.buildings.academy = 1;
  gated.state.tech.commerce = 1;
  assert.equal(has(build(gated), 'research:commerce'), false);
  const poor = developed();
  poor.state.tech.commerce = 0;
  poor.state.resources.gold = 0;
  const preparation = find(build(poor), 'research:commerce');
  assert(preparation);
  assert.equal(preparation.missing.gold, poor.researchCost('commerce').gold);
  assert.match(preparation.title, /準備|備える/);
  assert.match(preparation.reason, /不足/);
});

test('home-castle recommendations stop at the real ordinary, metropolitan and operator level caps', () => {
  for (const [game, id, maximum] of [[developed(), 'kiyosu', 32],
    [developed(), 'nijo', 48], [developed(make({isAdmin: true})), 'edo', 64]]) {
    game.state.home = id;
    game.state.cycle.home = id;
    game.state.castles[id].owner = game.state.clan;
    game.state.castles[id].level = maximum - 1;
    assert.equal(game.castleLevelLimit(id), maximum);
    assert(has(build(game), 'castle:' + id), id);
    assert.equal(game.upgradeCastle(id).ok, true);
    assert.equal(has(build(game), 'castle:' + id), false, 'a castle has no second reservation');
    game.state.jobs = [];
    game.state.castles[id].level = maximum;
    assert.equal(has(build(game), 'castle:' + id), false, id);
  }
});

test('staff Sunpu guidance counts shared construction slots separately and caps its castle at 64', () => {
  const game = staff({castleLevel: 63});
  game.state.jobs = ['farm', 'market'].map(id => ({kind: 'building', id, targetLevel: 3,
    remaining: 1, total: 1, remainingSeconds: 60, totalSeconds: 60}));
  assert(has(build(game), 'castle:sunpu'), 'personal pre-appointment jobs do not fill shared slots');
  const jobs = ['farm', 'market'].map((id, i) => ({jobId: 'shared-' + i, kind: 'building', id,
    targetLevel: 3, totalSeconds: 60, startedElapsedMs: 0, completesElapsedMs: 60000}));
  const full = staff({castleLevel: 63, jobs});
  assert.equal(has(build(full), 'castle:sunpu'), false);
  assert.equal(has(build(staff({castleLevel: 64})), 'castle:sunpu'), false);
});

test('training respects morale and reserves, and an optimized governor plan stops prompting reassignment', () => {
  const game = developed();
  game.state.morale = 50;
  const training = find(build(game), 'training');
  assert(training);
  const cost = game.trainingCost();
  for (const key of data.resources) assert.equal(training.cost[key] || 0, cost[key] || 0);
  assert.equal(game.train().ok, true);
  game.state.morale = 100;
  assert.equal(has(build(game), 'training'), false);
  game.state.morale = 50;
  game.state.resources.rice = cost.rice;
  assert.equal(has(build(game), 'training'), false);

  const governors = make();
  assert(has(build(governors), 'governors'));
  assert.equal(governors.autoAssignGovernors().ok, true);
  assert.equal(governors.planGovernorAssignments().changed, false);
  assert.equal(has(build(governors), 'governors'), false);
});

test('battle advice is an affordable adjacent preview with reserves, a real probability and a loss warning', () => {
  const game = developed();
  game.state.troops = 8000;
  const result = build(game), battle = result.items.find(item => item.id.startsWith('battle:'));
  assert(battle);
  assert(game.adjacentTargets().some(castle => castle.id === battle.action.id));
  assert(!['edo', 'sunpu'].includes(battle.action.id));
  assert(Number.isSafeInteger(battle.troops) && battle.troops >= 300);
  assert(game.state.troops - battle.troops >= Math.max(300, Math.ceil(game.state.troops * .2)));
  const preview = game.previewBattle(battle.action.id, 'balanced', battle.troops);
  assert.equal(preview.ok, true);
  assert.equal(battle.winChance, preview.winChance);
  assert(battle.winChance >= 80 && battle.winChance <= 99);
  assert.equal(battle.cost.rice, preview.foodCost);
  assert(game.state.resources.rice - preview.foodCost >= Math.max(500, game.income().upkeep * 2));
  assert.match(battle.reason, /推定|目安|予測/);
  assert.match(battle.detail, /損耗|消耗|損失/);
  assert.doesNotMatch(battle.title + battle.reason, /必ず勝|確実に勝|確勝|勝利確定|100[%％]/);
});

test('allied, overwhelming, unaffordable and already unified targets never receive sortie advice', () => {
  for (const scenario of ['allied', 'overwhelming', 'food', 'small-army', 'unified']) {
    const game = developed();
    game.state.troops = 8000;
    if (scenario === 'allied') for (const target of game.adjacentTargets()) game.state.treaties[target.owner] = game.state.turn + 6;
    if (scenario === 'overwhelming') for (const target of game.adjacentTargets()) {
      game.state.castles[target.id].troops = 1000000;
      game.state.castles[target.id].wall = 32;
      game.state.castles[target.id].level = game.castleLevelLimit(target.id);
    }
    if (scenario === 'food') game.state.resources.rice = 200;
    if (scenario === 'small-army') game.state.troops = 299;
    if (scenario === 'unified') {
      for (const castle of data.castles) if (game.canOwnCastle(castle.id)) game.state.castles[castle.id].owner = game.state.clan;
      game.state.won = true;
      assert.equal(game.adjacentTargets().length, 0);
    }
    assert.equal(build(game).items.some(item => item.id.startsWith('battle:')), false, scenario);
  }
});

test('paused progress is not promised a wall-clock completion or command recovery deadline', () => {
  const game = rich(make());
  assert.equal(game.upgrade('farm').ok, true);
  assert.equal(game.research('commerce').ok, true);
  game.state.command = 0;
  game.state.realtime.running = false;
  const result = build(game);
  for (const id of ['command-wait', 'construction-wait', 'research-wait']) {
    const item = find(result, id);
    assert(item, id);
    assert.equal(item.waitSeconds, undefined);
    assert.match(item.reason + item.detail, /止ま|再開|待機/);
  }
});

test('completion hints include month-boundary jobs and exclude logs older than the previous month', () => {
  const game = rich(make());
  assert.equal(game.upgrade('farm').ok, true);
  assert.equal(has(build(game), 'recent-completion'), false);
  game._advanceRealtime(60);
  assert.equal(game.state.buildings.farm, 3);
  const completed = find(build(game), 'recent-completion');
  assert(completed);
  assert.match(completed.reason, /田畑.*Lv\.3/);
  game._advanceRealtime(60);
  assert.equal(has(build(game), 'recent-completion'), false);
});

test('the browser module builds the same hints without DOM, storage, network or timers', () => {
  const forbidden = name => () => assert.fail('hint module accessed ' + name);
  const scope = {fetch: forbidden('fetch'), setTimeout: forbidden('setTimeout'),
    localStorage: {getItem: forbidden('storage read'), setItem: forbidden('storage write')},
    document: new Proxy({}, {get: forbidden('document')})};
  scope.window = scope;
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(require.resolve('../hints.js'), 'utf8'), scope);
  assert.equal(typeof scope.SengokuHints?.build, 'function');
  const game = make(), before = text(game.state);
  assert.deepEqual(JSON.parse(JSON.stringify(scope.SengokuHints.build(game, ready))), build(game));
  assert.equal(text(game.state), before);
});

for (const [name, run] of tests) {
  run();
  console.log('PASS ' + name);
}
console.log(tests.length + ' contextual hint checks passed.');
