'use strict';
// Real engine, cloud coordinator and application authority boundary; no external calls.
const assert = require('node:assert/strict');
const { SengokuEngine: E } = require('../engine.js');
const { harness, deferred, until } = require('./test-court-protection-sync.cjs');
const copy = v => JSON.parse(JSON.stringify(v));
function projection(campaignId, extra = {}) {
  return { version: 1, campaignId, revision: 1, proof: 'estate-proof-one', asOfElapsedMs: 120000, accessWindows: [{ fromElapsedMs: 0, toElapsedMs: null }], base: { id: 'kyoto_gosho', revision: 1, createdElapsedMs: 0, initial: { castleLevel: 3 }, history: [], jobs: [] }, ...extra };
}
const at = (h, elapsedMs) => h.c.game.applyWorldClock({ id: 'court-protection-clock', elapsedMs, running: true, speed: 1, revision: 1 }, { maxSeconds: 10000 });
const tests = [], test = (name, fn) => tests.push([name, fn]);
test('private projection reaches the engine before clock delivery and never replaces the personal home or facilities', async () => {
  const h = harness({ protectedOffice: true, courtProjection: projection }); try {
    const before = copy(h.server.save.state); assert((await h.start()).ok); const g = h.c.game, effects = g.courtEstateEffects(); assert(effects.active); assert.equal(effects.castleLevel, 3); assert.equal(effects.baseIncome.gold, 130); assert.equal(effects.baseTroopCapacity, 500);
    assert(h.clockReads.length && h.clockReads.every(row => row.estate?.proof === 'estate-proof-one' && row.estateActive)); assert.equal(h.applied[0].courtEstateCampaignId, before.walking.campaignId); assert.equal(h.applied[0].courtEstateProjection.proof, 'estate-proof-one');
    assert.equal(g.state.home, before.home); assert.equal(g.state.clan, before.clan); assert.deepEqual(g.state.buildings, before.buildings); assert.equal(g.state.castles.kyoto_gosho.owner, before.castles.kyoto_gosho.owner); assert.equal(g.isStaff, false); assert.equal(g.isAdmin, false);
    const saved = JSON.parse(g.exportSave()); assert.equal(saved.courtEstateProjection, undefined); assert.equal(saved.state.courtEstateProjection, undefined); assert.equal(E.fromSave(saved, g.roster).getCourtEstateProjection(), null);
  } finally { h.sync.stop(); }
});
test('same-save appointment and dismissal update transient economics while retaining closed historical windows', async () => {
  const h = harness(); try {
    await h.start(); const g = h.c.game, applied = h.applied.length; g.state.resources.gold += 137; h.sync.notifySave(); const before = copy(g.state);
    h.server.protectedOffice = true; h.server.courtProjection = projection(g.state.walking.campaignId); await h.sync.refresh(); assert.strictEqual(h.c.game, g); assert(g.courtEstateEffects().active); assert.deepEqual(g.state, before);
    h.server.protectedOffice = false; h.server.courtProjection = projection(g.state.walking.campaignId, { revision: 2, proof: 'estate-proof-dismissed', accessWindows: [{ fromElapsedMs: 0, toElapsedMs: 0 }] }); await h.sync.refresh();
    assert.strictEqual(h.c.game, g); assert.equal(g.courtEstateEffects().active, false); assert.equal(g.isCourtProtected, false); assert.equal(g.getCourtEstateProjection().accessWindows[0].toElapsedMs, 0); assert.deepEqual(g.state, before); assert.equal(h.applied.length, applied);
  } finally { h.sync.stop(); }
});
test('disconnection, account revalidation and BAN clear the complete economic projection immediately', async () => {
  for (const mode of ['stop', 'pending', 'ban']) { const h = harness({ protectedOffice: true, courtProjection: projection }); try {
    await h.start(); assert(h.c.game.getCourtEstateProjection()); if (mode === 'stop') h.sync.stop(); else if (mode === 'pending') h.sync.invalidateAccountAccess({ playerId: 'court-player-a' }); else h.sync.suspendAccount({ playerId: 'court-player-a' });
    assert.equal(h.c.game.getCourtEstateProjection(), null); assert.equal(h.c.game.courtEstateEffects().active, false);
    const meta = { source: 'cloud', playerId: 'court-player-a', courtEstateCampaignId: h.c.game.state.walking.campaignId, courtEstateProjection: projection(h.c.game.state.walking.campaignId) }; assert.equal(h.c.applyCourtEstateProjection(meta).ok, false); assert.equal(h.c.game.getCourtEstateProjection(), null);
  } finally { h.sync.stop(); } }
});
test('file fields, wrong-player metadata and wrong campaigns cannot manufacture an estate effect', async () => {
  const h = harness(); try {
    await h.start(); const save = h.bridge.getSave(), dto = projection(save.state.walking.campaignId), meta = { source: 'cloud', playerId: 'court-player-a', courtEstateCampaignId: dto.campaignId, courtEstateProjection: dto };
    save.courtEstateProjection = dto; save.state.courtEstateProjection = dto;
    for (const value of [{}, { courtEstateProjection: dto }, { ...meta, source: 'file' }, { ...meta, playerId: 'other-player' }, { ...meta, courtEstateCampaignId: 'another-campaign' }]) { const result = h.c.applyCloudSave(save, value); assert(result.ok); assert.equal(h.c.game.getCourtEstateProjection(), null); }
    assert.equal(E.fromSave(save, h.c.game.roster).getCourtEstateProjection(), null); assert.equal(h.c.applyCourtEstateProjection({ ...meta, playerId: 'other-player' }).ok, false);
  } finally { h.sync.stop(); }
});
test('a delayed older projection cannot undo a newer same-save appointment proof', async () => {
  const h = harness({ protectedOffice: true, courtProjection: projection }); try {
    await h.start(); const wait = deferred(); let reached = false; h.server.hook = async (call, result) => { if (call.route.startsWith('/sync?') && !reached) { reached = true; await wait.promise; } return result; };
    const poll = h.sync.refresh(); await until(() => reached); h.server.courtProjection = projection(h.c.game.state.walking.campaignId, { revision: 2, proof: 'estate-proof-two' }); assert(h.sync.observeBranchSnapshot(h.snapshot()).ok); assert.equal(h.c.game.getCourtEstateProjection().proof, 'estate-proof-two');
    wait.resolve(); await poll; assert.equal(h.c.game.getCourtEstateProjection().proof, 'estate-proof-two'); assert.equal(h.c.game.courtEstateEffects().active, true);
  } finally { h.sync.stop(); }
});
test('a newly discovered past grant restores the canonical checkpoint and backs up locally advanced progress', async () => {
  const h = harness(); try {
    await h.start(); at(h, 0); assert(at(h, 60000).ok); const advanced = h.c.game; advanced.state.resources.gold += 137; const local = copy(advanced.state); h.sync.notifySave(); h.storage.setItem('sengoku-court-estate-pending-v1:court-player-a', 'receipt-kept');
    h.server.protectedOffice = true; h.server.courtProjection = projection(advanced.state.walking.campaignId, { accessWindows: [{ fromElapsedMs: 30000, toElapsedMs: null }] }); assert((await h.sync.refresh()).ok);
    assert.notStrictEqual(h.c.game, advanced); assert.equal(h.c.game.state.resources.gold, h.server.save.state.resources.gold); assert.equal(h.applied.at(-1).reason, 'court-estate-authority'); assert.equal(h.applied.at(-1).backupRuntime, true);
    const backups = JSON.parse(h.storage.getItem('backups')); assert.deepEqual(JSON.parse(backups[0].save).state.resources, local.resources); assert.equal(h.storage.getItem('sengoku-court-estate-pending-v1:court-player-a'), 'receipt-kept'); assert.equal(h.c.game.getCourtEstateProjection().accessWindows[0].fromElapsedMs, 30000);
  } finally { h.sync.stop(); }
});
test('future castle jobs and facility-only shared revisions preserve already-valid local progression', async () => {
  const h = harness({ protectedOffice: true, courtProjection: projection }); try {
    await h.start(); at(h, 0); assert(at(h, 60000).ok); const g = h.c.game, before = copy(g.state), applied = h.applied.length;
    h.server.courtProjection = projection(g.state.walking.campaignId); h.server.courtProjection.proof = 'future-castle-proof'; h.server.courtProjection.base.revision = 2; h.server.courtProjection.base.jobs = [{ kind: 'castle', id: 'kyoto_gosho', targetLevel: 4, completesElapsedMs: 180000 }];
    assert((await h.sync.refresh()).ok); assert.strictEqual(h.c.game, g); assert.deepEqual(g.state, before); assert.equal(h.applied.length, applied); assert.equal(g.getCourtEstateProjection().base.jobs.length, 1);
    h.server.courtProjection.proof = 'facility-only-proof'; h.server.courtProjection.base.revision = 3; await h.sync.refresh(); assert.strictEqual(h.c.game, g); assert.deepEqual(g.state, before); assert.equal(h.applied.length, applied);
  } finally { h.sync.stop(); }
});
test('saves include the private proof and a rejected old proof forces complete canonical recovery', async () => {
  const h = harness({ protectedOffice: true, writer: true, courtProjection: projection }); try {
    await h.start(); h.c.game.state.resources.gold += 137; h.sync.notifySave(); let rejected = false;
    h.server.beforeRequest = call => { if (call.method === 'PUT' && !rejected) { rejected = true; assert.equal(call.data.courtEstateProof, 'estate-proof-one'); h.server.courtProjection = projection(h.c.game.state.walking.campaignId, { revision: 2, proof: 'estate-proof-dismissed', accessWindows: [{ fromElapsedMs: 0, toElapsedMs: 0 }] }); h.server.protectedOffice = false; throw Object.assign(Error('領地効果を同期してください。'), { status: 409, code: 'COURT_ESTATE_REFRESH_REQUIRED' }); } };
    const result = await h.sync.flush(); assert.equal(result.conflict, true); assert.equal(h.applied.at(-1).reason, 'conflict'); assert.equal(h.c.game.state.resources.gold, h.server.save.state.resources.gold); assert.equal(h.c.game.courtEstateEffects().active, false); assert.equal(h.c.game.getCourtEstateProjection().proof, 'estate-proof-dismissed'); assert.equal(h.requests.filter(row => row.method === 'PUT').length, 1);
  } finally { h.sync.stop(); }
});
test('campaign replacement proves the previous accepted save then adopts the returned new-campaign projection', async () => {
  const h = harness({ protectedOffice: true, writer: true, courtProjection: projection }); try {
    await h.start(); const original = h.c.game, next = new E({ seed: 97, officers: original.roster, startCastle: original.state.home }); h.c.game = next; assert.equal(next.getCourtEstateProjection(), null); h.sync.notifySave();
    h.server.beforeRequest = call => { if (call.method === 'PUT') { assert.equal(call.data.courtEstateProof, 'estate-proof-one'); h.server.courtProjection = projection(call.data.save.state.walking.campaignId, { proof: 'replacement-campaign-proof' }); } };
    assert((await h.sync.flush()).ok); assert.equal(h.c.game.state.walking.campaignId, next.state.walking.campaignId); assert.equal(h.c.game.getCourtEstateProjection().proof, 'replacement-campaign-proof'); assert.equal(h.c.game.state.home, original.state.home);
  } finally { h.sync.stop(); }
});
test('the presentation clock is capped to the verified estate horizon until another private snapshot arrives', async () => {
  const h = harness({ protectedOffice: true, courtProjection: projection }); try {
    await h.start(); h.c.SengokuWorldClock.accept({ id: 'court-protection-clock', elapsedMs: 180000, running: true, speed: 1, revision: 2 }); assert.equal(h.c.confirmedWorldClock().elapsedMs, 120000);
    h.server.courtProjection.asOfElapsedMs = 180000; h.sync.observeBranchSnapshot(h.snapshot()); assert.equal(h.c.confirmedWorldClock().elapsedMs, 180000); assert.equal(h.c.game.getCourtEstateStatus().asOfElapsedMs, 180000);
  } finally { h.sync.stop(); }
});
(async () => { for (const [name, fn] of tests) { await fn(); console.log('PASS ' + name); } console.log(tests.length + ' real Kyoto estate economics / authority sync scenarios passed.'); })().catch(error => { console.error(error); process.exitCode = 1; });
