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
const rules = {targetCastles:true, specialBaseBattles:true, occupiedTerritoryBattles:true, branchBattles:true};
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

function fixture(initialTargets, {identity = {id:'me'}, paginate = false} = {}) {
  const {doc, host} = setup();
  doc.hidden = false;
  doc.addEventListener = doc.removeEventListener = () => {};
  const listeners = new Map();
  const add = host.addEventListener.bind(host);
  host.addEventListener = (type, handler) => { listeners.set(type, handler); add(type, handler); };
  const maps = [], posts = [], opened = [], messages = [], requests = [];
  let targets = copy(initialTargets), updates = 0, detailRefreshes = 0, adviceCalls = 0, failureCursor = null, mapMounts = 0;
  const local = {home:'kiyosu', troops:5000, command:3, resources:{rice:9000, gold:1000}, army:[], tech:{}, morale:80};
  const castleIds = [...new Set(['kiyosu', 'odawara', 'sunpu', 'kyoto_gosho', ...initialTargets.flatMap(p => [p.homeCastleId, p.targetCastleId])])];
  const geography = {castles:Object.fromEntries(castleIds.map((id, i) => [id, {lon:130 + i % 12, lat:30 + Math.floor(i / 12) % 10}]))};
  const scope = {
    document:doc, setTimeout:() => 1, clearTimeout() {},
    SENGOKU_DATA:{staffBaseId:'kyoto_gosho', deputyBaseId:'kagoshima', castles:castleIds.map(id => ({id, name:names[id] || id}))},
    SengokuStableDOM:StableDOM,
    SengokuWorldMap:{mount(_container, options) {
      mapMounts++;
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
  const mountOptions = {
    stateKey:'territory-fixture', identity, geography,
    getSyncStatus:() => ({writable:true}), getState:() => local,
    onMessage:(message, error) => messages.push({message, error}),
    request:async (route, options) => {
      if (options.method === 'POST') { posts.push({route, data:copy(options.data)}); return {ok:false, error:{message:'Unexpected test mutation'}}; }
      if (route.startsWith('/field/me')) return {
        rules, relationships:[], battles:[], self:{homeCastleId:'kiyosu'},
        attack:{ready:true, availableTroops:5000, minTroops:300, maxTroops:100000, command:3, rice:9000}
      };
      requests.push(route);
      if (paginate) {
        const params = new URLSearchParams(route.split('?')[1]), cursor = params.get('cursor') || '', limit = Number(params.get('limit')) || 25;
        if (cursor === failureCursor) throw Error('続きの本拠を取得できませんでした。');
        // The real API pages owners; one owner can contribute many holdings.
        const owners = [...new Set(targets.map(p => p.playerId))].sort(), available = owners.filter(id => id > cursor), page = new Set(available.slice(0, limit));
        return {targets:copy(targets.filter(p => page.has(p.playerId))), players:[], total:owners.length, nextCursor:available.length > limit ? available[limit - 1] : null, rules};
      }
      return {targets:copy(targets), players:[], total:new Set(targets.map(p => p.playerId)).size, rules};
    }
  };
  let controller = scope.SengokuField.mount(host, mountOptions);
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
    doc, host, local, scope, get controller() { return controller; }, maps, posts, opened, messages, requests, input, send,
    select:targetId => send('select-player', {targetId}, {force:true}),
    replace:next => { targets = copy(next); }, latest:() => maps.at(-1),
    failPage:cursor => { failureCursor = cursor; },
    mounts:() => mapMounts,
    reopen:() => { controller.destroy(); controller = scope.SengokuField.mount(host, mountOptions); },
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

test('an attackable occupied territory opens the battle controls and sends its exact owner and castle after confirmation', async () => {
  const target = territory('other', 'inuyama', {displayOnly:false, defenseTroops:900, defensePower:3500, battleMode:'raid', capturable:false});
  const f = fixture([home('me'), target]);
  try {
    await f.controller.refresh(); await f.select('other:inuyama');
    assert.match(f.detail().textContent, /この城は占領領地です/);
    assert(f.detail().querySelector('[data-field-input="troops"]'));
    assert(f.detail().querySelector('[data-field-action="confirm-attack"]'));
    await f.send('attack', {}, {force:true});
    assert.equal(f.posts.length, 0, 'Departure requires the confirmation step');
    await f.send('confirm-attack');
    assert.match(f.detail().textContent, /犬山城へ出陣しますか/);
    await f.send('attack');
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].route, '/field/attack');
    assert.equal(f.posts[0].data.targetPlayerId, 'other');
    assert.equal(f.posts[0].data.targetCastleId, 'inuyama');
    assert.equal(f.posts[0].data.tactic, 'balanced');
    assert.equal(f.posts[0].data.troops, 1000);
  } finally { f.controller.destroy(); }
});

test('regional protection labels the exact holding and allows an explicit noncapturing battle after confirmation', async () => {
  for (const target of [
    home('other', 'sunpu', {regionProtected:true, protectedRegion:'東海', battleMode:'reward', capturable:false}),
    territory('other', 'osaka', {displayOnly:false, defenseTroops:900, defensePower:3500, regionProtected:true, protectedRegion:'近畿', battleMode:'reward', capturable:false})
  ]) {
    const f = fixture([home('me'), target]);
    try {
      await f.controller.refresh(); await f.select(target.playerId + ':' + target.targetCastleId);
      assert.match(f.detail().querySelector('[data-field-region-protected]').textContent, /地域保護.*占領は移りません/);
      assert.equal(f.detail().querySelector('[data-field-battle-mode]').dataset.fieldBattleMode, 'reward');
      assert(f.rows().find(row => row.dataset.targetId === 'other:' + target.targetCastleId).textContent.includes(target.protectedRegion + 'の地域保護'));
      assert(f.detail().querySelector('[data-field-action="confirm-attack"]'));
      await f.send('attack', {}, {force:true}); assert.equal(f.posts.length, 0);
      await f.send('confirm-attack'); assert.match(f.detail().querySelector('.field-confirm').textContent, /占領は移りません/);
      await f.send('attack'); assert.equal(f.posts.length, 1);
      assert.equal(f.posts[0].data.targetPlayerId, 'other'); assert.equal(f.posts[0].data.targetCastleId, target.targetCastleId);
    } finally { f.controller.destroy(); }
  }
});

test('a changed or unverified regional protection status invalidates an existing attack confirmation', async () => {
  const target = territory('other', 'osaka', {displayOnly:false, defenseTroops:900, defensePower:3500, regionProtected:true, protectedRegion:'近畿', battleMode:'reward', capturable:false});
  const f = fixture([home('me'), target]);
  try {
    await f.controller.refresh(); await f.select('other:osaka'); await f.send('confirm-attack');
    f.replace([home('me'), {...target, regionProtected:false, protectedRegion:null, battleMode:'capture', capturable:true}]);
    await f.controller.refresh({background:true}); await f.send('attack', {}, {force:true}); assert.equal(f.posts.length, 0);
    assert.equal(f.detail().querySelector('[data-field-region-protected]'), null);
    assert.equal(f.detail().querySelector('[data-field-battle-mode]').dataset.fieldBattleMode, 'capture');
    await f.send('confirm-attack');
    f.replace([home('me'), {...target, regionProtected:'true'}]); await f.controller.refresh({background:true});
    assert.equal(f.detail().querySelector('[data-field-action="confirm-attack"]'), null);
    await f.send('attack', {}, {force:true}); assert.equal(f.posts.length, 0);
  } finally { f.controller.destroy(); }
});

test('switching occupied-territory owners invalidates confirmation and self or protected territories cannot submit', async () => {
  const active = (id, extra = {}) => territory(id, 'inuyama', {displayOnly:false, defenseTroops:900, defensePower:3500, battleMode:'raid', capturable:false, ...extra});
  const f = fixture([home('me'), active('first'), active('second'), active('me')]);
  try {
    await f.controller.refresh(); await f.select('first:inuyama'); await f.send('confirm-attack');
    await f.select('second:inuyama'); await f.send('attack', {}, {force:true});
    assert.equal(f.posts.length, 0, 'A new defender needs a new confirmation');
    await f.select('me:inuyama');
    assert(!f.detail().querySelector('[data-field-action="confirm-attack"]'));
    await f.send('confirm-attack', {}, {force:true}); await f.send('attack', {}, {force:true});
    assert.equal(f.posts.length, 0, 'A player cannot attack their own occupied territory');
    f.replace([home('me'), active('first', {attackable:false, attackReason:'復興保護中です。'})]);
    await f.controller.refresh(); await f.select('first:inuyama');
    await f.send('confirm-attack', {}, {force:true}); await f.send('attack', {}, {force:true});
    assert.equal(f.posts.length, 0, 'The authoritative protection status must be respected');
  } finally { f.controller.destroy(); }
});

test('a server-authorized noncapturing major-city battle remains selectable without revealing internal office protection', async () => {
  const target = {...home('other', 'odawara'), targetCastleId:'osaka', targetCastleName:'大坂城', battleMode:'raid', capturable:false, isStaff:true};
  const f = fixture([home('me'), target]);
  try {
    await f.controller.refresh(); await f.select('other:osaka');
    assert(f.detail().querySelector('[data-field-action="confirm-attack"]'));
    assert.doesNotMatch(f.detail().textContent, /占領できない|占領不可|運営|スタッフ/);
    await f.send('confirm-attack'); await f.send('attack');
    assert.equal(f.posts[0].data.targetCastleId, 'osaka');
    assert.equal(f.posts[0].data.targetPlayerId, 'other');
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

const pagedOwners = () => Array.from({length:60}, (_, i) => home('p' + String(i + 1).padStart(3, '0'), i === 28 ? 'odawara' : 'kiyosu'));

test('each field entry starts at home while mounted updates retain a selected rival', async () => {
  const f = fixture([home('me'), home('other', 'odawara')]);
  try {
    await f.controller.refresh();
    assert.equal(f.latest().initialView, 'home'); assert.equal(f.latest().restoreView, false);
    assert.equal(f.latest().homeId, 'kiyosu'); assert.equal(f.latest().selectedId, 'kiyosu');
    await f.select('other:odawara');
    await f.send('tab', {tab:'diplomacy'});
    const mounts = f.mounts();
    f.controller.update({identity:{id:'me'}});
    await f.controller.refresh({background:true});
    assert.equal(f.latest().selectedId, 'odawara');
    assert.equal(f.host.querySelector('[data-tab="diplomacy"]').getAttribute('aria-selected'), 'true');
    assert.equal(f.mounts(), mounts, 'Sync updates the existing map without replaying its entry camera.');
    f.reopen();
    assert.equal(f.mounts(), mounts + 1);
    assert.equal(f.latest().homeId, 'kiyosu'); assert.equal(f.latest().selectedId, 'kiyosu');
    assert.equal(f.latest().initialView, 'home'); assert.equal(f.latest().restoreView, false);
    assert.equal(f.host.querySelector('[data-tab="base"]').getAttribute('aria-selected'), 'true');
  } finally { f.controller.destroy(); }
});

test('the local home is available before the public owner page and late self data does not steal selection', async () => {
  const f = fixture([home('other', 'odawara')]);
  try {
    assert.equal(f.maps[0].homeId, 'kiyosu', 'The initial map can center on static home coordinates before list loading.');
    assert.equal(f.maps[0].initialView, 'home'); assert.equal(f.maps[0].restoreView, false);
    await f.controller.refresh();
    assert.equal(f.latest().selectedId, 'kiyosu');
    assert(!f.latest().castles.some(c => c.players.some(p => p.playerId === 'me')), 'Do not fabricate a public home row.');
    await f.select('other:odawara');
    f.replace([home('me'), home('other', 'odawara')]);
    await f.controller.refresh({background:true});
    assert.equal(f.latest().selectedId, 'odawara', 'A deliberate selection wins over a later arrival of self metadata.');
    f.local.home = 'sunpu';
    f.reopen();
    assert.equal(f.latest().homeId, 'sunpu', 'Reentry uses the current personal home rather than an older cached list location.');
    assert.equal(f.latest().selectedId, 'sunpu', 'An older cached home must not override the current home selection.');
  } finally { f.controller.destroy(); }
});

test('background refresh retains loaded owner pages, the selected lord and list controls', async () => {
  const targets = [...pagedOwners(), territory('p002', 'sunpu'), territory('p002', 'inuyama')];
  const f = fixture(targets, {identity:{id:'p001'}, paginate:true});
  const all = () => f.latest().castles.flatMap(c => c.players);
  try {
    await f.controller.refresh();
    assert.equal(new Set(all().map(p => p.playerId)).size, 25);
    await f.send('load-more');
    assert.equal(new Set(all().map(p => p.playerId)).size, 50);
    f.input('search', '領主p'); f.input('filter', 'online');
    for (let i = 0; i < 7; i++) await f.send('page', {delta:1});
    await f.select('p029:odawara');
    const rows = f.rows(), search = f.host.querySelector('[data-field-input="search"]');
    const pagination = f.host.querySelector('[data-field-pagination]').textContent;
    f.replace(targets.map(p => p.playerId === 'p029' ? {...p, keepLevel:17} : p));
    const calls = f.requests.length;
    await f.controller.refresh({background:true});
    assert.deepEqual(f.requests.slice(calls), ['/field?limit=25', '/field?limit=25&cursor=p025']);
    assert.equal(new Set(all().map(p => p.playerId)).size, 50);
    assert.equal(f.latest().selectedId, 'odawara');
    assert.match(f.detail().textContent, /領主p029の領地/);
    assert.match(f.detail().textContent, /天守 Lv\.17/);
    assert.equal(f.host.querySelector('[data-field-input="search"]'), search);
    assert.equal(search.value, '領主p');
    assert.equal(f.host.querySelector('[data-field-input="filter"]').value, 'online');
    assert.equal(f.host.querySelector('[data-field-pagination]').textContent, pagination);
    assert.deepEqual(f.rows(), rows, 'The visible rows remain mounted on the same page.');
    await f.send('load-more');
    assert.equal(f.requests.at(-1), '/field?limit=25&cursor=p050');
    assert.equal(new Set(all().map(p => p.playerId)).size, 60);
  } finally { f.controller.destroy(); }
});

test('loaded-range refresh removes departed owners and lost holdings instead of keeping stale rows', async () => {
  const targets = [...pagedOwners(), territory('p029', 'sunpu')];
  const f = fixture(targets, {identity:{id:'p001'}, paginate:true});
  try {
    await f.controller.refresh(); await f.send('load-more'); await f.select('p029:sunpu');
    f.replace(targets.filter(p => p.playerId !== 'p028' && !(p.playerId === 'p029' && p.targetCastleId === 'sunpu')));
    await f.controller.refresh({background:true});
    const players = f.latest().castles.flatMap(c => c.players);
    assert(!players.some(p => p.playerId === 'p028'));
    assert(!players.some(p => p.playerId === 'p029' && p.targetCastleId === 'sunpu'));
    assert(players.some(p => p.playerId === 'p029' && p.targetCastleId === 'odawara'));
    assert.equal(f.latest().selectedId, 'kiyosu', 'An actually removed selected holding may fall back to the home.');
    assert.equal(f.latest().castles.find(c => c.id === 'kiyosu').displayPlayerId, 'p001');
    await f.send('load-more');
    assert.equal(f.requests.at(-1), '/field?limit=25&cursor=p051', 'Use the refreshed continuation after an owner leaves.');
    assert.equal(new Set(f.latest().castles.flatMap(c => c.players.map(p => p.playerId))).size, 59);
  } finally { f.controller.destroy(); }
});

test('a later-page failure keeps the current selection until a complete loaded-range refresh succeeds', async () => {
  const targets = pagedOwners(), f = fixture(targets, {identity:{id:'p001'}, paginate:true});
  const all = () => f.latest().castles.flatMap(c => c.players);
  try {
    await f.controller.refresh(); await f.send('load-more'); await f.select('p029:odawara');
    const previous = f.detail().innerHTML;
    f.replace(targets.filter(p => p.playerId !== 'p029').map(p => p.playerId === 'p001' ? {...p, name:'更新された領主'} : p));
    f.failPage('p025');
    await f.controller.refresh({background:true});
    assert.equal(new Set(all().map(p => p.playerId)).size, 50);
    assert.equal(f.latest().selectedId, 'odawara');
    assert.equal(f.detail().innerHTML, previous);
    assert.equal(all().find(p => p.playerId === 'p001').name, '領主p001', 'Do not expose a partially refreshed prefix.');
    assert.match(f.host.querySelector('[data-field-feedback]').textContent, /続きの本拠を取得できませんでした/);
    f.failPage(null);
    await f.controller.refresh({background:true});
    assert.equal(new Set(all().map(p => p.playerId)).size, 50);
    assert(!all().some(p => p.playerId === 'p029'));
    assert.equal(all().find(p => p.playerId === 'p001').name, '更新された領主');
    assert.equal(f.latest().selectedId, 'kiyosu');
    assert.equal(f.host.querySelector('[data-field-feedback]').hidden, true);
  } finally { f.controller.destroy(); }
});

(async () => {
  for (const [name, run] of tests) { await run(); console.log('PASS ' + name); }
  console.log(tests.length + ' field territory, shared Kyoto and bounded rendering scenarios passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
