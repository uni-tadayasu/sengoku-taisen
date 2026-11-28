import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

const h = harness();
const target = 'himeji';
const attackStage = 'stage-2';
const saveRow = player => h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(player.user.id);
const post = async (path, player, body) => (await h.api(path, {method:'POST', token:player.token, body})).data;
const get = async (path, player) => (await h.api(path, {token:player?.token})).data;

async function joinCastle(name, castleId, mode='lord') {
  const player = await h.session(name);
  player.deviceId = 'event-test-' + player.user.id;
  const lease = await post('/sync/lease', player, {deviceId:player.deviceId});
  const result = await post('/castles/residency/start', player, {
    deviceId:player.deviceId, revision:lease.revision, requestId:crypto.randomUUID(),
    castleId, mode, clan:'織田家', difficulty:'normal'
  });
  assert.equal(result.residency.role, mode);
  return player;
}

async function relocate(player, castleId) {
  return post('/castles/residency/relocate', player, {
    deviceId:player.deviceId, revision:saveRow(player).revision,
    requestId:crypto.randomUUID(), castleId
  });
}

async function reinforceCastle(player, troops) {
  const row = saveRow(player);
  const save = JSON.parse(row.save_json);
  save.state.castles[target].troops = troops;
  return h.api('/sync', {method:'PUT', token:player.token, body:{
    deviceId:player.deviceId, revision:row.revision, save
  }});
}

async function expectedDefender(observer, resident) {
  const field = await get('/field?limit=100', observer);
  const defender = field.targets.find(t=>t.playerId===resident.user.id && t.targetCastleId===target);
  assert(defender, 'the current castle resident must also appear on the shared field');
  // The castle's verified owner and public appearance select its scenery for
  // every viewer (v5.16.0), so the event opponent carries both.
  assert.deepEqual(defender.appearance, {nameplate:null,town:null,badge:null,ownedProducts:[]});
  return {
    castleId:target, castleName:'姫路城', castleOwnerId:resident.user.id, lordName:resident.user.name,
    defenseTroops:defender.defenseTroops, defensePower:defender.defensePower, castleAppearance:defender.appearance
  };
}

function checkDetail(detail, approvedPlan, opponent) {
  assert.deepEqual(detail.event.plan, approvedPlan, 'the approved scenario remains reusable');
  assert.deepEqual(detail.event.opponent, opponent);
  assert.equal(detail.progress.advisers.length, approvedPlan.stages.length);
  for (const stage of approvedPlan.stages) {
    const advice = detail.progress.advisers.find(row=>row.stageId===stage.id);
    assert(advice, stage.id);
    const power = opponent?.defensePower ?? stage.enemyPower;
    assert.equal(advice.enemyPower, power);
    assert(advice.options.length>0);
    for (const option of advice.options) assert.equal(option.enemyPower, power);
  }
}

async function attack(detail, actor, opponent) {
  const advice = detail.progress.advisers.find(a=>a.stageId===attackStage);
  const body = {deviceId:actor.deviceId, expectedRevision:saveRow(actor).revision,
    requestId:crypto.randomUUID(), stageId:attackStage, tactic:advice.tactic};
  const path = '/events/' + detail.event.id + '/battle';
  const response = await post(path, actor, body);
  assert.deepEqual(response.battle.opponent, opponent);
  assert.equal(response.battle.enemyPower, advice.enemyPower);
  assert.equal(response.battle.playerPower, advice.playerPower);
  assert.equal(response.battle.winChance, advice.winChance);
  assert.equal(response.battle.commandBefore-response.battle.commandAfter, 1);
  return {path, body, response};
}

async function replay(original, actor, currentOpponent) {
  const before = saveRow(actor);
  const receipt = await post(original.path, actor, original.body);
  assert.equal(receipt.idempotent, true);
  assert.deepEqual(receipt.battle, original.response.battle, 'a retry retains the defense at the instant of battle');
  checkDetail(receipt, original.response.event.plan, currentOpponent);
  assert.deepEqual(saveRow(actor), before, 'the replay must not consume another command or grant another reward');
}

try {
  const admin = await h.session('催事主催者');
  await post('/admin/claim', admin, {key:h.env.SENGOKU_ADMIN_KEY});
  const actor = await joinCastle('合戦に挑む領主', 'kiyosu');
  const draft = await post('/admin/events/generate', admin,
    {battleId:'castle:'+target, durationDays:2, requestId:crypto.randomUUID()});
  await post('/admin/events/'+draft.event.id+'/publish', admin, {requestId:crypto.randomUUID()});
  const path = '/events/' + draft.event.id;
  const plan = draft.event.plan;

  let current = await get(path, actor);
  checkDetail(current, plan, null);
  assert.equal((await get(path)).event.opponent, null);
  const emptyBattle = await attack(current, actor, null);

  const lord = await joinCastle('姫路の初代城主', target);
  const successor = await joinCastle('姫路の先任家臣', target, 'retainer');
  await reinforceCastle(successor, 17000);
  const beforeTraining = await expectedDefender(actor, lord);
  current = await get(path, actor);
  checkDetail(current, plan, beforeTraining);
  assert.deepEqual((await get(path)).event.opponent, beforeTraining);
  await replay(emptyBattle, actor, beforeTraining);

  await reinforceCastle(lord, 8500);
  const trained = await expectedDefender(actor, lord);
  assert(trained.defenseTroops>beforeTraining.defenseTroops);
  assert(trained.defensePower>beforeTraining.defensePower);
  const lordSave = saveRow(lord), retainerSave = saveRow(successor);
  current = await get(path, actor);
  checkDetail(current, plan, trained);
  const occupiedBattle = await attack(current, actor, trained);
  assert.deepEqual(saveRow(lord), lordSave);
  assert.deepEqual(saveRow(successor), retainerSave);

  await relocate(lord, 'inuyama');
  const promoted = await expectedDefender(actor, successor);
  assert.notEqual(promoted.defensePower, trained.defensePower);
  current = await get(path, actor);
  checkDetail(current, plan, promoted);
  await replay(occupiedBattle, actor, promoted);
  const promotedSave = saveRow(successor);
  const finalBattle = await attack(current, actor, promoted);
  assert.deepEqual(saveRow(successor), promotedSave);

  await relocate(successor, 'sunpu');
  current = await get(path, actor);
  checkDetail(current, plan, null);
  assert.equal(current.progress.battles, 3);
  await replay(finalBattle, actor, null);
  assert.equal((await get(path, actor)).progress.battles, 3);
  console.log('PASS empty castle, resident and retainer, changed garrison, lord succession, vacant seat and frozen battle receipts ('+h.calls+' local HTTP requests)');
} finally {
  h.close();
}
