'use strict';
// Exercise the mounted shared field with authoritative target replacements.
// No live requests, browser account, game resources or persistent saves are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {setup} = require('./helpers/dom-model.cjs');
const StableDOM = require('../stable-dom.js');
const source = fs.readFileSync(require.resolve('../field.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const rules = {targetCastles:true, specialBaseBattles:true, branchBattles:true};
const names = {kiyosu:'清洲城', odawara:'小田原城', sunpu:'駿府城', inuyama:'犬山城', kyoto_gosho:'京都御所', osaka:'大坂城'};
const home = (playerId, castleId = 'kiyosu', extra = {}) => ({
  playerId, name:'領主' + playerId, clan:'織田家', homeCastleId:castleId,
  homeCastleName:names[castleId] || castleId, targetCastleId:castleId,
  targetCastleName:names[castleId] || castleId, level:3, keepLevel:4,
  defenseTroops:1200, defensePower:4200, online:true, attackable:true,
  battleMode:'raid', capturable:false, ...extra
});
const territory = (playerId, castleId, extra = {}) => ({
  ...home(playerId, playerId === 'me' ? 'kiyosu' : 'odawara'),
  targetCastleId:castleId, targetCastleName:names[castleId] || castleId,
  level:12, holdingKind:'territory', displayOnly:true,
  defenseTroops:undefined, defensePower:undefined, armySummary:undefined,
  ...extra
});
const court = (playerId, extra = {}) => territory(playerId, 'kyoto_gosho', {
  holdingKind:'court-estate', canDevelopCourtEstate:true, level:24, ...extra
});

function fixture(initialTargets, {identity = {id:'me'}} = {}) {
  const {doc, host} = setup();
  doc.hidden = false;
  doc.addEventListener = doc.removeEventListener = () => {};
  const listeners = new Map();
  const add = host.addEventListener.bind(host);
  host.addEventListener = (type, handler) => { listeners.set(type, handler); add(type, handler); };
  const maps = [], posts = [], opened = [], messages = [];
  let targets = copy(initialTargets), updates = 0, detailRefreshes = 0, adviceCalls = 0;
  const local = {home:'kiyosu', troops:5000, command:3, resources:{rice:9000, gold:1000}, army:[], tech:{}, morale:80};
  const castleIds = [...new Set(['kiyosu', 'odawara', 'sunpu', 'kyoto_gosho', ...initialTargets.flatMap(p => [p.homeCastleId, p.targetCastleId])])];
  const geography = {castles:Object.fromEntries(castleIds.map((id, i) => [id, {lon:130 + i % 12, lat:30 + Math.floor(i / 12) % 10}]))};
  const scope = {
    document:doc, setTimeout:() => 1, clearTimeout() {},
    SENGOKU_DATA:{staffBaseId:'kyoto_gosho', deputyBaseId:'kagoshima', castles:castleIds.map(id => ({id, name:names[id] || id}))},
    SengokuStableDOM:StableDOM,
    SengokuWorldMap:{mount(_container, options) {
      maps.push(options);
      return {update(next) { updates++; maps.push(next); }, destroy() {}};
    }},
    SengokuCourtEstate:{async open(options) { opened.push(copy(options)); }},
    SengokuOfficerHealthUI:{refresh() { detailRefreshes++; }, armyMarkup:() => ''},
    SengokuBattleAdvisor:{
      compare(_candidates, options) { adviceCalls++; return {ok:false, message:options.emptyMessage}; },
      markup:() => ''
    }
  };
  scope.window = scope;
  vm.runInNewContext(source, scope);
  const controller = scope.SengokuField.mount(host, {
    stateKey:'territory-fixture', identity, geography,
    getSyncStatus:() => ({writable:true}), getState:() => local,
    onMessage:(message, error) => messages.push({message, error}),
    request:async (route, options) => {
      if (options.method === 'POST') { posts.push({route, data:copy(options.data)}); return {ok:false, error:{message:'Unexpected test mutation'}}; }
      if (route.startsWith('/field/me')) return {
        rules, relationships:[], battles:[], self:{homeCastleId:'kiyosu'},
        attack:{ready:true, availableTroops:5000, minTroops:300, maxTroops:100000, command:3, rice:9000}
      };
      return {targets:copy(targets), players:[], total:new Set(targets.map(p => p.playerId)).size, rules};
    }
  });
  async function send(action, data = {}, {force = false} = {}) {
    let button = host.querySelectorAll('[data-field-action="' + action + '"]').find(node => Object.entries(data).every(([key, value]) => node.dataset[key] === String(value)));
    let synthetic = false;
    if (!button && force) {
      button = doc.createElement('button');
      button.dataset.fieldAction = action;
      for (const [key, value] of Object.entries(data)) button.dataset[key] = String(value);
      host.append(button); synthetic = true;
    }
    assert(button, 'Missing field action ' + action + ' ' + JSON.stringify(data));
    try { return await listeners.get('click')({target:button, stopPropagation() {}, preventDefault() {}}); }
    finally { if (synthetic) button.remove(); }
  }
  function input(kind, value) {
    const target = host.querySelector('[data-field-input="' + kind + '"]');
    assert(target, 'Missing field input ' + kind); target.value = value;
    listeners.get(target.tagName === 'SELECT' ? 'change' : 'input')({target});
  }
  return {
    doc, host, local, scope, controller, maps, posts, opened, messages, input, send,
    select:targetId => send('select-player', {targetId}, {force:true}),
    replace:next => { targets = copy(next); }, latest:() => maps.at(-1),
    updates:() => updates, details:() => detailRefreshes, advice:() => adviceCalls,
    detail:() => host.querySelector('[data-field-detail]'),
    rows:() => host.querySelectorAll('[data-field-players] [data-field-action="select-player"]'),
    shortcut:() => host.querySelector('[data-field-action="own-court"]')
  };
}

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('display-only holdings override erroneous battle capabilities and drop branch targets', async () => {
  const raw = territory('other', 'osaka', {
    attackable:true, capturable:true, battleMode:'capture',
    branches:[{id:'osaka_north', parentCastleId:'osaka', direction:'north', level:12, attackable:true}]
  });
  const f = fixture([home('me'), raw]);
  try {
    await f.controller.refresh();
    const normalized = f.scope.SengokuField.normalizePlayers({targets:[raw]})[0];
    assert.equal(normalized.displayOnly, true);
    assert.equal(normalized.holdingKind, 'territory');
    assert.equal(normalized.attackable, false); assert.equal(normalized.capturable, false);
    assert.equal(normalized.battleMode, null); assert.equal(normalized.branches.length, 0);
    assert.equal(f.scope.SengokuField.battlePolicy(raw, rules).mode, 'protected', 'The policy also rejects raw rows before normalization.');
    await f.select('other:osaka');
    const html = f.detail().innerHTML;
    assert.match(html, /占領領地/);
    assert(!html.includes('field-base-stats'), 'Missing defense data is not rendered as a zero-strength force.');
    assert(!html.includes('data-field-input="troops"'));
    assert(!html.includes('data-field-action="confirm-attack"'));
    assert(!f.rows().find(row => row.dataset.targetId === 'other:osaka').textContent.includes('0兵'));
    assert.equal(f.advice(), 0, 'Read-only holdings do not run combat recommendations.');
    await f.send('confirm-attack', {}, {force:true});
    await f.send('attack', {}, {force:true});
    assert.equal(f.posts.length, 0, 'A stale or injected attack button cannot submit a display-only holding.');
  } finally { f.controller.destroy(); }
});

test('the same castle keeps each owner selectable and uses that owner in the map and detail', async () => {
  const f = fixture([home('me'), territory('first', 'inuyama', {name:'一人目', level:8}), territory('second', 'inuyama', {name:'二人目', level:19})]);
  try {
    await f.controller.refresh();
    const rows = f.rows().filter(row => row.dataset.targetId.endsWith(':inuyama'));
    assert.deepEqual(rows.map(row => row.dataset.targetId), ['first:inuyama', 'second:inuyama']);
    const grouped = () => f.latest().castles.find(c => c.id === 'inuyama');
    assert.equal(f.latest().castles.filter(c => c.id === 'inuyama').length, 1);
    assert.equal(grouped().players.length, 2);
    for (const [id, name, level] of [['first', '一人目', 8], ['second', '二人目', 19]]) {
      await f.select(id + ':inuyama');
      assert.equal(grouped().displayTargetId, id + ':inuyama');
      assert(grouped().ownerLabel.includes(name));
      assert.equal(grouped().ownerRelation, 'shared');
      assert(f.detail().textContent.includes(name + 'の領地'));
      assert(f.detail().textContent.includes('城郭 Lv.' + level));
      assert(f.rows().find(row => row.dataset.targetId === id + ':inuyama').getAttribute('aria-pressed') === 'true');
    }
  } finally { f.controller.destroy(); }
});

test('authorized lords with an ordinary home can open their own shared Kyoto estate', async () => {
  const f = fixture([home('me'), court('me'), court('other')]);
  const original = JSON.stringify(f.local);
  try {
    await f.controller.refresh();
    assert.equal(f.shortcut().hidden, false);
    await f.send('own-court');
    assert.equal(f.latest().selectedId, 'kyoto_gosho');
    assert.equal(f.latest().homeId, 'kiyosu', 'The shortcut does not relocate the real home.');
    assert(f.rows().some(row => row.dataset.targetId === 'me:kyoto_gosho' && row.getAttribute('aria-pressed') === 'true'));
    assert.match(f.detail().textContent, /共同領地/);
    assert.match(f.detail().textContent, /領主の本拠：清洲城/);
    assert(f.detail().querySelector('[data-field-action="court-estate"]'));
    assert(!f.detail().querySelector('.field-base-stats'));
    await f.send('court-estate');
    assert.deepEqual(f.opened, [{tab:'castle'}]);
    assert.equal(JSON.stringify(f.local), original);
    assert.equal(f.posts.length, 0);
  } finally { f.controller.destroy(); }
});

test('other lords, absent permission and unrelated castles cannot open the estate controls', async () => {
  const cases = [
    {identity:{id:'me'}, row:court('other'), key:'other:kyoto_gosho'},
    {identity:{id:'me'}, row:court('me', {canDevelopCourtEstate:false}), key:'me:kyoto_gosho'},
    {identity:{id:'me'}, row:territory('me', 'inuyama', {holdingKind:'court-estate', canDevelopCourtEstate:true}), key:'me:inuyama'},
    {identity:null, row:court('other'), key:'other:kyoto_gosho'}
  ];
  for (const {identity, row, key} of cases) {
    const f = fixture([home('me'), row], {identity});
    try {
      await f.controller.refresh(); await f.select(key);
      assert(!f.detail().querySelector('[data-field-action="court-estate"]'), key);
      assert.equal(f.shortcut().hidden, true, key);
      await f.send('court-estate', {}, {force:true});
      await f.send('own-court', {}, {force:true});
      assert.equal(f.opened.length, 0, key);
      assert.equal(f.posts.length, 0, key);
    } finally { f.controller.destroy(); }
  }
});

test('fresh revocation removes the Kyoto shortcut and selection without losing the home', async () => {
  const f = fixture([home('me'), court('me'), territory('me', 'inuyama')]);
  try {
    await f.controller.refresh(); await f.send('own-court');
    assert(f.detail().querySelector('[data-field-action="court-estate"]'));
    // First, revoke permission while a read-only projection is still present.
    f.replace([home('me'), court('me', {canDevelopCourtEstate:false}), territory('me', 'inuyama')]);
    await f.controller.refresh({background:true});
    assert.equal(f.shortcut().hidden, true);
    assert(!f.detail().querySelector('[data-field-action="court-estate"]'));
    await f.send('court-estate', {}, {force:true});
    assert.equal(f.opened.length, 0);
    // The next authoritative snapshot no longer includes this role's holding.
    f.replace([home('me'), territory('me', 'inuyama')]);
    await f.controller.refresh({background:true});
    assert.equal(f.latest().selectedId, 'kiyosu');
    assert.equal(f.latest().homeId, 'kiyosu');
    assert(!f.latest().castles.some(c => c.id === 'kyoto_gosho'));
    assert(!f.rows().some(row => row.dataset.targetId === 'me:kyoto_gosho'));
    assert.equal(f.shortcut().hidden, true);
    await f.send('court-estate', {}, {force:true}); await f.send('own-court', {}, {force:true});
    assert.equal(f.opened.length, 0);
    assert.equal(f.latest().selectedId, 'kiyosu');
    await f.send('clear-castle');
    assert(f.rows().some(row => row.dataset.targetId === 'me:kiyosu'));
  } finally { f.controller.destroy(); }
});

test('search, filters and four-row pagination avoid map and detail recomputation with 128 holdings', async () => {
  const holdings = Array.from({length:128}, (_, i) => territory('me', 'territory-' + i, {targetCastleName:'占領城' + i}));
  const targets = [home('me'), home('rival', 'odawara'), ...holdings, court('me')];
  const f = fixture(targets);
  try {
    await f.controller.refresh(); await f.select('rival:odawara');
    const mapUpdates = f.updates(), details = f.details(), advice = f.advice(), selected = f.detail().innerHTML;
    assert(advice > 0, 'The selected real enemy exercises the combat detail path.');
    assert.equal(f.rows().length, 4);
    f.input('search', '占領城127');
    assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].dataset.targetId, 'me:territory-127');
    f.input('search', '');
    f.input('filter', 'territories');
    assert.equal(f.rows().length, 4); assert(f.rows().every(row => row.textContent.includes('占領領地')));
    await f.send('page', {delta:1});
    assert.equal(f.rows()[0].dataset.targetId, 'me:territory-4');
    f.input('filter', 'court-estate');
    assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].dataset.targetId, 'me:kyoto_gosho');
    f.input('filter', 'own');
    assert(f.rows().every(row => row.dataset.playerId === 'me'));
    f.input('filter', 'all');
    assert.equal(f.updates(), mapUpdates, 'List-only operations must not regroup and update the map.');
    assert.equal(f.details(), details, 'List-only operations keep the current detail intact.');
    assert.equal(f.advice(), advice, 'Typing and paging do not rerun battle advice.');
    assert.equal(f.detail().innerHTML, selected);
    // Selection and authoritative data changes still update both surfaces.
    await f.select('me:territory-0');
    assert(f.updates() > mapUpdates); assert(f.details() > details);
    const beforeRefresh = f.updates();
    f.replace(targets.map(p => p.targetCastleId === 'territory-0' ? {...p, level:31, targetCastleName:'改名された城'} : p));
    await f.controller.refresh({background:true});
    assert(f.updates() > beforeRefresh);
    assert.equal(f.latest().castles.find(c => c.id === 'territory-0').level, 31);
    assert.match(f.detail().textContent, /改名された城/);
    assert.match(f.detail().textContent, /城郭 Lv\.31/);
  } finally { f.controller.destroy(); }
});

(async () => {
  for (const [name, run] of tests) { await run(); console.log('PASS ' + name); }
  console.log(tests.length + ' field territory, shared Kyoto and bounded rendering scenarios passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
