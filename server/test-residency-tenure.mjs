import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const post=(p,body)=>({method:'POST',token:p.token,body});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const state=(h,p)=>JSON.parse(row(h,p).save_json).state;
const status=async(h,p)=>(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;

async function player(h,name,castleId,mode='lord'){
 const p=await h.session(name);p.deviceId='tenure-'+p.user.id;
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 await h.api('/castles/residency/start',post(p,{deviceId:p.deviceId,revision:lease.revision,requestId:crypto.randomUUID(),castleId,mode,clan:'織田家',difficulty:'normal'}));
 return p;
}
async function checkpoint(h,p,clock,change){
 await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
 const game=GameEngine.fromSave(row(h,p).save_json,GAME_OFFICERS),s=game.state;
 s.turn=8;s.realtime.elapsed=59;s.worldClock={id:clock.id,elapsedMs:539000};
 s.seed=1;s.command=3;s.resources.rice=100000;change(s);
 h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(game.exportSave(),p.user.id);
}

let scenarios=0,calls=0;
async function scenario(racingAppointment){
 const h=harness(),batch=h.db.batch.bind(h.db);
 h.db.batch=statements=>{for(const s of statements)assert(s.params.length<=100,'D1 binding limit: '+s.params.length);return batch(statements);};
 try{
  const lord=await player(h,'継承前の領主','kiyosu'),heir=await player(h,'進軍中の家臣','kiyosu','retainer'),attacker=await player(h,'隣城の攻撃主','inuyama');
  h.now+=539000;const clock=(await h.api('/world-clock')).data.clock;
  // Only the heir's private campaign should fall to the CPU at this month boundary.
  const quietNeighbors=s=>{for(const castle of Object.values(s.castles))if(castle.owner!==s.clan)castle.troops=0;};
  await checkpoint(h,lord,clock,s=>{quietNeighbors(s);s.troops=10;s.castles.kiyosu.troops=10;});
  await checkpoint(h,attacker,clock,s=>{quietNeighbors(s);s.troops=5000;});
  await checkpoint(h,heir,clock,s=>{
   s.troops=1000;
   for(const castle of Object.values(s.castles))Object.assign(castle,{owner:'在地衆',troops:100000,wall:1,level:1});
   s.castles.kiyosu.owner=s.clan;s.castles.kiyosu.troops=100;
  });
  const cpu=(await h.api('/marches/campaign',post(heir,{kind:'castle',targetId:'inabayama',tactic:'balanced',troops:1000,campaignId:state(h,heir).walking.campaignId,requestId:'tenure-cpu',deviceId:heir.deviceId,expectedRevision:row(h,heir).revision}))).data;
  const preview=GameEngine.fromSave(cpu.save,GAME_OFFICERS);
  preview.applyWorldClock({...clock,elapsedMs:cpu.march.arrivesAtMs},{maxSeconds:86400,deferCycleSettlement:true});
  const losses=preview.takeHomeDefenseLosses();
  assert.equal(losses[0]?.occurredElapsedMs,540000,'the private defeat predates appointment');

  const originalRandom=crypto.getRandomValues;let field;
  crypto.getRandomValues=value=>value instanceof Uint32Array&&value.length===1?value.fill(0):originalRandom.call(crypto,value);
  try{field=(await h.api('/field/attack',post(attacker,{targetPlayerId:lord.user.id,targetCastleId:'kiyosu',troops:1000,tactic:'balanced',requestId:'tenure-field',deviceId:attacker.deviceId,expectedRevision:row(h,attacker).revision}))).data;}
  finally{crypto.getRandomValues=originalRandom;}
  assert.equal(field.march.arrivesAtMs,565000);assert.equal(cpu.march.arrivesAtMs,567000);
  let appointment;
  if(racingAppointment){
   h.now+=cpu.march.remainingMs;
   h.beforeBatch=async statements=>{
    if(!statements[0]?.sql.includes('UPDATE battle_marches SET status=')||!statements[0].params.includes(cpu.march.id))return;
    h.beforeBatch=null;appointment=await status(h,attacker);
   };
   const pending=await status(h,heir);
   assert(appointment,'the competing appointment committed before the CPU save');
   assert.equal(pending.active[0]?.id,cpu.march.id,'the old household term cannot commit a dead successor');
   assert.equal(state(h,heir).gameOver,false);assert.equal(state(h,heir).troops,0,'escrow remains pending until retry');
  }else{
   h.now+=field.march.remainingMs;appointment=await status(h,attacker);
   h.now+=cpu.march.arrivesAtMs-appointment.clock.elapsedMs;
  }
  assert.equal(appointment.history[0].battle.succession.lordPlayerId,heir.user.id);
  const settled=await status(h,heir),seat=h.sql.prepare('SELECT * FROM castle_seats WHERE castle_id=?').get('kiyosu');
  assert.equal(seat.lord_user_id,heir.user.id);assert(seat.lord_since_elapsed_ms>losses[0].occurredElapsedMs);
  assert.equal(settled.residency.role,'lord');assert.equal(settled.save.state.home,'kiyosu');
  assert.equal(settled.save.state.gameOver,false);assert.equal(settled.save.state.castles.kiyosu.owner,settled.save.state.clan);
  assert.equal(settled.history[0].status,'cancelled');assert.equal(settled.save.state.troops,1000,'the old march refunds its escrow once');
  assert.equal(count(h,'castle_successions'),1);assert.equal(count(h,'field_battles'),1);
  const fieldView=(await h.api('/field')).data;assert(fieldView.players.some(p=>p.playerId===heir.user.id&&p.homeCastleId==='kiyosu'));
  const saved=row(h,heir).save_json;await status(h,heir);
  assert.equal(row(h,heir).save_json,saved,'replaying settlement cannot refund again or hide the current lord');
  scenarios++;console.log('PASS '+(racingAppointment?'concurrent appointment rejects the stale retainer CPU commit and retries safely':'a promoted offline heir keeps their public home after a pre-appointment CPU defeat'));
 }finally{calls+=h.calls;h.close();}
}

const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Residency tenure tests must never access the network');};
try{await scenario(false);await scenario(true);}
finally{globalThis.fetch=originalFetch;}
console.log(`${scenarios} residency tenure scenarios passed (${calls} isolated HTTP requests).`);
