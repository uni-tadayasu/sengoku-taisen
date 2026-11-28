'use strict';
// Real campaign/map callbacks project a shared holding without altering the engine save.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { SengokuEngine: E, SENGOKU_DATA: D } = require('../engine.js'), M = require('../world-map.js'), Court = require('../court.js');
const { view, access } = require('./test-court-estate-ui.cjs');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8'), copy = v => JSON.parse(JSON.stringify(v));
function fn(name) { const start = source.indexOf(`  function ${name}(`), lineEnd = source.indexOf('\n', start), end = source.slice(start, lineEnd).endsWith('}') ? lineEnd : source.indexOf('\n  }', start) + 4; assert(start >= 0 && end > start, name); return source.slice(start, end); }
function fixture() {
  const game = new E({ seed: 83 }), raw = view(); let estate = { ...raw.holding, home: raw.home, role: raw.role, castleLevel: raw.base.castleLevel, buildings: raw.base.buildings, jobs: 0, revision: raw.base.revision, effects: raw.effects }, latest = null, probes = 0, renders = 0;
  const c = { game, data: D, staffBaseId: D.staffBaseId, state: () => game.state, currentView: 'map', selectedCastle: 'kyoto_gosho', mapRegion: 'all', mapQuery: '', territoryState: 'own', territoryPage: 1, worldMapController: null, worldMapElement: null, strategyRun: null,
    esc: v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])), num: String, icon: () => '', heading: title => '<h1>' + title + '</h1>', clanCrest: () => '', pageControls: () => '', catalogChips: () => '', durabilityMarkup: () => '', catalogMatches: (text, query) => text.includes(query),
    staffConstructionReady: () => false, preserveInteraction: (_node, render) => render(), render: () => renders++, $: () => map,
    window: { SengokuCourtEstate: { holding: () => estate ? copy(estate) : null, ensure: () => probes++ }, SengokuWorldMap: { mount: (_node, options) => { latest = options; return { update: options => latest = options, destroy() {} }; } } }
  }, map = {};
  c.castleReleaseAction=()=>'';c.castleReleasePending=false;vm.createContext(c); vm.runInContext(['campaignOwnerInfo','campaignCastleOwnership','campaignOwnerMarkup','territoryOwnerGuide','courtEstateHolding', 'courtEstateInheritanceMarkup', 'courtEstateCastle', 'courtEstateMapNotice', 'courtEstateDetail', 'refreshCourtEstateSurfaces', 'homeCastleAppearance', 'campaignCastleOwnerAppearance', 'campaignCastleGrowth', 'campaignCastleAppearance', 'campaignCastleTooltip', 'syncWorldMap', 'territoryRows', 'territoryResults', 'castleDetail', 'renderMap'].map(fn).join('\n'), c);
  return { c, game, latest: () => latest, probes: () => probes, renders: () => renders, estate: () => copy(estate), setEstate: value => estate = value };
}
const tests = [], test = (name, run) => tests.push([name, run]);
test('map and holding details explain inheritance only when private effects include the verified enhancement', () => {
  const h = fixture(), original = JSON.stringify(h.game.state), estate = h.estate(); estate.role = { id: 'cloistered-emperor', title: '法皇' }; h.setEstate(estate);
  assert(!h.c.courtEstateMapNotice().includes('京都御所の強化を継承')); assert(!h.c.courtEstateDetail().includes('京都御所の強化を継承'));
  estate.effects.enhancements = { active: true, mode: 'maximum', castleLevel: estate.castleLevel, buildings: copy(estate.buildings) }; h.setEstate(estate);
  for (const html of [h.c.courtEstateMapNotice(), h.c.courtEstateDetail()]) { assert(html.includes('京都御所の強化を継承')); assert(html.includes('高い方の城郭・施設レベル')); }
  h.setEstate(null); assert.equal(h.c.courtEstateMapNotice(), ''); assert.equal(h.c.courtEstateDetail(), ''); assert.equal(JSON.stringify(h.game.state), original);
});
test('public lords remain independent of personal campaign ownership and are searchable by their real names', () => {
  const h=fixture(),id=h.game.state.home,before=JSON.stringify(h.game.state);
  h.c.window.SengokuTerritoryOwners={ensure(){},describe:castleId=>castleId===id?{status:'known',label:'領主 現在の城主',relation:'other',owners:[{playerId:'u_current_lord',name:'現在の城主'}],detail:'公開領主'}:{status:'unknown',label:'領主情報を確認中',relation:'unknown',owners:[],detail:''}};
  h.c.syncWorldMap();const marker=h.latest().castles.find(c=>c.id===id);
  assert.equal(marker.owner,h.game.state.clan);assert.equal(marker.ownerLabel,'領主 現在の城主');assert.equal(marker.ownerRelation,'other');
  const rows=h.c.territoryRows('現在の城主',new Set(),h.game.state);assert.equal(rows.length,1);assert.equal(rows[0].id,id);
  h.c.mapQuery='現在の城主';const html=h.c.territoryResults();assert(html.includes('公開領主'));assert(html.includes('現在の城主'));assert(html.includes('戦役勢力'));assert(html.includes('他の領主'));
  assert.equal(JSON.stringify(h.game.state),before);
});
test('public owner markup escapes names and shows every shared-city owner in the detail', () => {
  const h=fixture(),names=['城主<svg/onload=alert(1)>','別の城主'],info={status:'shared',label:'領主 '+names[0]+' ほか1名',relation:'shared',owners:names.map((name,i)=>({playerId:'u_owner_'+i,name})),detail:'同じ城に2名の領主'};
  h.c.window.SengokuTerritoryOwners={describe:()=>info};
  const compact=h.c.campaignOwnerMarkup({id:'osaka'},true),detail=h.c.campaignOwnerMarkup({id:'osaka'});
  assert(compact.includes('ほか1名'));assert(detail.includes('別の城主'));assert(detail.includes('&lt;svg/onload=alert(1)&gt;'));assert(!detail.includes('<svg/onload='));
  const unknown=h.c.campaignOwnerMarkup({id:'kyoto_gosho'});assert(!unknown.includes('class="territory-owner-person"'),'Kyoto does not turn the first resident into its exclusive owner');
});
test('own territory rows and count include Kyoto while the real home, ownership and resources remain unchanged', () => {
  const h = fixture(), before = JSON.stringify(h.game.state), owned = h.game.ownedCastles().length;
  const rows = h.c.territoryRows('', new Set(), h.game.state), shared = rows.find(c => c.id === D.staffBaseId); assert(shared?.courtShared); assert.equal(rows.length, owned + 1); assert.equal(shared.level, 12); assert.equal(shared.sharedKeepLevel, 8);
  const html = h.c.renderMap(); assert(html.includes(`自領 ${owned + 1}城（京都御所の共同領地を含む）`)); assert(html.includes('清洲城')); assert(html.includes('京都御所 · あなたの共同領地')); assert(html.includes('data-action="court-estate"'));
  assert.equal(JSON.stringify(h.game.state), before); assert.equal(h.game.isStaff, false); assert.equal(h.game.canOwnCastle(D.staffBaseId), false); assert(!h.game.ownedCastles().some(c => c.id === D.staffBaseId));
});
test('shared Kyoto row/detail uses canonical levels and construction instead of personal battle or income controls', () => {
  const h = fixture(); h.c.mapQuery = '京都御所'; const list = h.c.territoryResults(), detail = h.c.castleDetail(D.staffBaseId);
  assert(list.includes('自領 · 共同領地')); assert(!list.includes('disabled title="選択不可"')); assert(list.includes('天守 Lv.8 · 城郭 Lv.12')); assert(detail.includes('Lv.12 / 128')); assert(detail.includes('Lv.8 / 32')); assert(detail.includes('城郭・施設を強化')); assert(detail.includes('一般拠点と同じ領地効果')); assert(detail.includes('金銭 265'));
  for (const forbidden of ['prepare-battle', 'upgrade-castle', 'recruit-troops', '領地の基礎収入']) assert(!detail.includes(forbidden));
  h.c.territoryState = 'damaged'; assert(!h.c.territoryRows('', new Set(), h.game.state).some(c => c.id === D.staffBaseId));
});
test('map starts role discovery directly, allows the authorized Kyoto selection, and keeps Edo restricted', () => {
  const h = fixture(), before = JSON.stringify(h.game.state); h.c.syncWorldMap(); assert.equal(h.probes(), 1); const options = h.latest(); assert.equal(options.canAccessCourtEstate, true); assert.equal(options.isStaff, false);
  const projection = options.castles.find(c => c.id === D.staffBaseId), coords = { kyoto_gosho: { lon: 135.76, lat: 35.02 }, edo: { lon: 139.75, lat: 35.68 } }, points = M.castlePoints(options.castles, coords, options);
  assert.equal(projection.courtShared, true); assert.equal(points.find(c => c.id === D.staffBaseId).disabled, false); assert.equal(points.find(c => c.id === D.staffBaseId).restrictedLabel, '共同領地'); assert.equal(points.find(c => c.id === 'edo').disabled, true);
  h.c.selectedCastle = h.game.state.home; options.onSelect(D.staffBaseId); assert.equal(h.c.selectedCastle, D.staffBaseId); assert.equal(h.renders(), 1); options.onSelect('edo'); assert.equal(h.c.selectedCastle, D.staffBaseId); assert.equal(JSON.stringify(h.game.state), before);
});
test('revocation removes Kyoto from own territory, restores selection to home and disables the marker', () => {
  const h = fixture(); h.c.syncWorldMap(); h.setEstate(null); h.c.refreshCourtEstateSurfaces(); assert.equal(h.c.selectedCastle, h.game.state.home); assert.equal(h.renders(), 1);
  const own = h.c.territoryRows('', new Set(), h.game.state); assert(!own.some(c => c.id === D.staffBaseId)); assert.equal(own.length, h.game.ownedCastles().length); assert.equal(h.c.courtEstateMapNotice(), '');
  h.c.syncWorldMap(); const options = h.latest(), marker = M.castlePoints(options.castles, { kyoto_gosho: [135.76, 35.02] }, options)[0]; assert.equal(marker.disabled, true); assert.equal(options.canAccessCourtEstate, false); options.onSelect(D.staffBaseId); assert.equal(h.c.selectedCastle, h.game.state.home);
});
test('the map requires both verified access and the explicit shared projection before relaxing Kyoto selection', () => {
  const castle = { id: D.staffBaseId, name: '京都御所', owner: '朝廷' }, coords = { kyoto_gosho: [135.76, 35.02] }, point = (c, o) => M.castlePoints([c], coords, o)[0];
  assert(point(castle, { canAccessCourtEstate: true }).disabled); assert(point({ ...castle, courtShared: true }, {}).disabled); assert.equal(point({ ...castle, courtShared: true }, { canAccessCourtEstate: true }).disabled, false); assert(point(castle, { isAdmin: true }).disabled);
});
test('authenticated sync entitlement hints affect only the matching current player and cloud source', () => {
  const hints = [], c = { roleEpoch: 1, trustedCourtProtection: () => null, game: { setCourtProtection: () => ({ ok: true, changed: false }) }, window: { SengokuSocial: { getUser: () => ({ id: 'current-player' }) }, SengokuCourtEstate: { updateAccess: value => hints.push(value) } } };
  c.castleReleaseAction=()=>'';c.castleReleasePending=false;vm.createContext(c); vm.runInContext(fn('applyCourtProtection'), c);
  for (const meta of [{ source: 'local', playerId: 'current-player', entitlements: { courtEstate: true } }, { source: 'cloud', playerId: 'other-player', entitlements: { courtEstate: true } }, { source: 'cloud', playerId: 'current-player', entitlements: { courtEstate: 'true' } }]) c.applyCourtProtection(meta);
  assert.equal(hints.length, 0); c.applyCourtProtection({ source: 'cloud', playerId: 'current-player', entitlements: { courtEstate: true } }); c.applyCourtProtection({ source: 'cloud', playerId: 'current-player', entitlements: { courtEstate: false } }); assert.deepEqual(hints, [true, false]);
});
test('a low-rank external appointee reaches estate management without receiving other court duties', async () => {
  const context = access(), raw = { ok: true, eligible: false, requirement: { rankId: 'court-7', rankName: '従五位', minScore: 35000 }, evaluation: { score: 1000, rankName: '正八位' }, accessStamp: 'appointed-low-rank', self: { id: context.playerId, name: '試験領主', title: '参議', officeJurisdiction: 'external', canDevelopEstate: true, canRespond: false, canAppoint: false, canActForEmperor: false, canApproveShogunate: false }, palace: { level: 12, buildings: { keep: 8 }, jobCount: 0 }, features: { estate: true, conversation: false, audience: false, roster: false, eventRoom: false }, thresholds: [] };
  const controller = Court.createController({ getContext: () => context, request: async route => { assert.equal(route, '/court'); return copy(raw); } }); await controller.load(); const s = controller.snapshot(), html = Court.markup(s);
  assert.equal(s.info.eligible, false); assert.equal(s.info.self.canDevelopEstate, true); assert(html.includes('data-court-action="estate"')); for (const forbidden of ['data-court-form', 'data-court-section="management"', 'data-court-action="event-room"']) assert(!html.includes(forbidden)); assert.equal(controller.selectSection('chat'), false); assert.equal(controller.selectSection('management'), false);
  raw.self.canDevelopEstate = false; raw.features.estate = false; await controller.load(); assert(!Court.markup(controller.snapshot()).includes('data-court-action="estate"')); controller.dispose();
});
(async () => { for (const [name, run] of tests) { await run(); console.log('PASS ' + name); } console.log(tests.length + ' shared Kyoto map and admission scenarios passed.'); })().catch(error => { console.error(error); process.exitCode = 1; });
