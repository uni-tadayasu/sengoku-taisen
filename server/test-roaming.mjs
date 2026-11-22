import assert from 'node:assert/strict';
import {harness,settleFieldMarch as settleMarch} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const row=(h,p)=>({...h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id)});
const state=(h,p)=>JSON.parse(row(h,p).save_json).state;
const receiptCount=h=>h.sql.prepare('SELECT COUNT(*) AS n FROM roaming_battles').get().n;
let checks=0,calls=0;
async function scope(name,fn){const h=harness();try{await fn(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function player(h,name='野良兵検証',change=()=>{}){
 const p=await h.session(name);p.deviceId='roaming-device-'+p.user.id;
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,deployment=GameEngine.roamingDeploymentDefaults(),home=GameEngine.roamingDeploymentSummary(deployment).castles.find(c=>GameEngine.roamingDeploymentUnits(deployment,c.castleId).some(unit=>unit.encounterId==='road_scouts')).castleId,save=h.fresh(home);
 change(save.state);save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save}});return p;
}
function input(h,p,extra={}){const r=row(h,p),s=JSON.parse(r.save_json).state,d=GameEngine.roamingDeploymentDefaults(),desired=extra.encounterId||'road_scouts',available=GameEngine.roamingDeploymentSummary(d).castles.flatMap(c=>GameEngine.roamingDeploymentUnits(d,c.castleId)).filter(u=>!h.sql.prepare('SELECT 1 FROM roaming_unit_cooldowns WHERE deployment_revision=? AND unit_id=? AND respawn_at>?').get(d.revision,u.unitId,h.now)),unit=available.find(u=>u.encounterId===desired)||available[0];return{deviceId:p.deviceId,expectedRevision:r.revision,campaignId:s.walking.campaignId,sequence:s.roaming.sequence,requestId:crypto.randomUUID(),encounterId:unit.encounterId,unitId:unit.unitId,castleId:unit.castleId,deploymentRevision:d.revision,tactic:'balanced',troops:1000,...extra};}
const battle=(h,p,body=input(h,p),expected=200)=>h.api('/roaming/battle',post(p,body,expected));
const status=async(h,p)=>(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;
const lease=async(h,p)=>h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
async function fight(h,p,body=input(h,p)){
  const departure=(await battle(h,p,body)).data;
  const transit=GameEngine.fromSave(departure.save,GAME_OFFICERS,{isStaff:!!departure.user.isStaff,staffBase:departure.staffBase});
  transit.applyWorldClock({...departure.clock,elapsedMs:departure.march.arrivesAtMs},{maxSeconds:86400,deferCycleSettlement:true});
  const receipt=await settleMarch(h,p,departure);
  const settled=await status(h,p);
  return {...settled,battle:receipt,transit:transit.state,departure};
}
function alignImport(save,clock){
  save.state.worldClock={id:clock.id,elapsedMs:clock.elapsedMs};
  save.state.turn=Math.floor(clock.elapsedMs/60000);
  save.state.realtime.elapsed=clock.elapsedMs%60000/1000;
}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('CPU battle tests must never use a real network');};
try{
 await scope('authenticated victory commits campaign costs/rewards and a receipt atomically, with durable replay',async h=>{
  const p=await player(h),before=structuredClone(state(h,p)),body=input(h,p),first=await fight(h,p,body),after=state(h,p);
  assert(first.battle.won);assert.equal(first.departure.save.state.command,before.command-1);assert.equal(after.troops,first.transit.troops+body.troops-first.battle.ourLost);assert.equal(after.resources.rice,first.transit.resources.rice+first.battle.rewards.rice);assert.equal(after.resources.gold,first.transit.resources.gold+first.battle.rewards.gold);assert.deepEqual(after.castles,first.transit.castles);assert.deepEqual(after.stats,first.transit.stats);assert.equal(after.roaming.sequence,1);assert.equal(receiptCount(h),1);assert.equal(first.revision,body.expectedRevision+2);
  assert.doesNotThrow(()=>GameEngine.fromSave(first.save,GAME_OFFICERS));
  const stored=row(h,p).save_json,replay=(await battle(h,p,body)).data;assert.equal(replay.idempotent,true);assert.deepEqual(replay.battle,first.battle);assert.equal(row(h,p).save_json,stored);assert.equal(receiptCount(h),1);
  await battle(h,p,{...body,troops:1200},409);assert.equal(row(h,p).save_json,stored);
  const history=(await h.api('/roaming/history',{token:p.token})).data;assert.equal(history.battles.length,1);assert.equal(history.battles[0].requestId,body.requestId);
 });
 await scope('defeat costs real troops and food without rewards or castle changes',async h=>{
  const p=await player(h),before=structuredClone(state(h,p)),r=await fight(h,p,input(h,p,{encounterId:'ronin_vanguard',troops:300})),b=r.battle,after=state(h,p);
  assert.equal(b.won,false);assert(b.ourLost>0);assert.equal(r.departure.save.state.resources.rice,before.resources.rice-b.foodCost);assert.equal(after.resources.rice,r.transit.resources.rice);assert.equal(after.resources.gold,r.transit.resources.gold);assert.equal(after.magatama,r.transit.magatama);assert.equal(r.departure.save.state.command,before.command-1);assert.deepEqual(after.castles,r.transit.castles);assert.equal(after.roaming.wins,0);
 });
 await scope('strict input, actual troop capacity and missing resource/army gates reject before writes',async h=>{
  const p=await player(h),before=row(h,p).save_json,base=input(h,p);
  await h.api('/roaming/battle',{method:'POST',body:base,expected:401});
  for(const troops of [0,299,1000.5,'1000',1000001])await battle(h,p,{...base,troops},400);
  await battle(h,p,{...base,rewards:{gold:999999}},400);await battle(h,p,{...base,encounterId:'missing'},409);await battle(h,p,{...base,campaignId:'another'},409);await battle(h,p,{...base,troops:100000},409);
  assert.equal(row(h,p).save_json,before);assert.equal(receiptCount(h),0);
  for(const mutation of [s=>s.command=0,s=>s.resources.rice=0,s=>s.army=[]]){const copy=JSON.parse(before);mutation(copy.state);h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(copy),p.user.id);const stored=row(h,p).save_json;await battle(h,p,input(h,p),409);assert.equal(row(h,p).save_json,stored);}
  assert.equal(receiptCount(h),0);
 });
 await scope('competing requests at one sequence and revision allow exactly one battle',async h=>{
  const p=await player(h),before=state(h,p),one=input(h,p),two={...one,requestId:crypto.randomUUID()};
  const results=await Promise.all([battle(h,p,one,null),battle(h,p,two,null)]);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);assert.equal(receiptCount(h),0);assert.equal(state(h,p).command,before.command-1);
  const winner=await settleMarch(h,p,results.find(r=>r.response.status===200).data);assert.equal(state(h,p).roaming.sequence,1);assert.equal(receiptCount(h),1);const redo=winner.requestId===one.requestId?one:two;assert.equal((await battle(h,p,redo)).data.idempotent,true);
  await battle(h,p,{...input(h,p),sequence:0},409);assert.equal(receiptCount(h),1);
 });
 await scope('old revision, expired lease and another player cannot mutate or read the receipt',async h=>{
  const p=await player(h),other=await player(h,'別の検証領主'),body=input(h,p);await battle(h,p,{...body,expectedRevision:body.expectedRevision-1},409);await battle(h,p,{...body,deviceId:'wrong-device'},409);
  await fight(h,p,body);const own=state(h,p);assert.deepEqual((await h.api('/roaming/history',{token:other.token})).data.battles,[]);await h.api('/roaming/history',{expected:401});
  h.sql.prepare('UPDATE player_saves SET lease_expires_at=? WHERE user_id=?').run(h.now-1,p.user.id);await battle(h,p,input(h,p),409);assert.deepEqual(state(h,p),own);
  assert.equal((await battle(h,p,body)).data.idempotent,true);assert.equal(receiptCount(h),1);
 });
 await scope('world-clock and writer changes at commit reject all resource and receipt writes',async h=>{
  const p=await player(h),before=row(h,p).save_json;let changed=false;
  h.beforeBatch=statements=>{if(!changed&&statements.some(s=>s.sql.includes('INSERT INTO battle_marches'))){changed=true;h.sql.exec('UPDATE world_clock SET revision=revision+1');}};
  const r=await battle(h,p,input(h,p),409);assert(changed);assert.equal(r.data.error.code,'ROAMING_STATE_CHANGED');assert.equal(receiptCount(h),0);assert.equal(row(h,p).save_json,before);
  h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO battle_marches')))h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run('different-writer',p.user.id);};
  await battle(h,p,input(h,p),409);assert.equal(receiptCount(h),0);assert.equal(row(h,p).save_json,before);
 });
 await scope('database error rolls the receipt and costs back together; same request remains retryable',async h=>{
  const p=await player(h),body=input(h,p),departure=(await battle(h,p,body)).data,escrow=row(h,p).save_json;h.now+=departure.march.remainingMs;let fault=true;
  h.beforeBatch=statements=>{if(fault&&statements.some(s=>s.sql.includes('INSERT INTO roaming_battles'))){fault=false;statements.push(h.db.prepare('UPDATE no_such_cpu_fixture_table SET missing=1'));}};
  const failed=await status(h,p);assert.equal(failed.active[0].id,departure.march.id);assert.equal(fault,false);assert.equal(receiptCount(h),0);assert.equal(row(h,p).save_json,escrow);h.beforeBatch=null;const retried=await status(h,p);assert.equal(retried.history[0].status,'resolved');assert.equal((await battle(h,p,body)).data.idempotent,true);assert.equal(receiptCount(h),1);
 });
 await scope('staff CPU battles use the current shared-base capacity and still retain history through sync',async h=>{
  const op=await h.session('検証管理者');await h.api('/admin/claim',post(op,{key:h.env.SENGOKU_ADMIN_KEY}));
  const p=await player(h,'共有拠点の検証');await h.api('/admin/staff',post(op,{targetPlayerId:p.user.id,action:'appoint',requestId:'cpu-staff-appoint'}));
  await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
  const r=await fight(h,p,input(h,p));assert.equal(r.battle.won,true);assert(r.staffBase);assert.equal(r.save.state.roaming.sequence,1);assert.doesNotThrow(()=>GameEngine.fromSave(r.save,GAME_OFFICERS,{isStaff:true,staffBase:r.staffBase}));
  const sync=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.equal(sync.save.state.roaming.history[0].requestId,r.battle.requestId);
 });
 await scope('same-campaign imports and old clients restore durable progress without re-crediting any battle',async h=>{
  const p=await player(h),original=JSON.parse(row(h,p).save_json),firstBody=input(h,p),first=(await fight(h,p,firstBody)).battle;
  await lease(h,p);const second=(await fight(h,p,input(h,p))).battle;
  for(const legacy of [false,true]){
   await lease(h,p);const imported=structuredClone(original);alignImport(imported,(await h.api('/world-clock')).data.clock);if(legacy)delete imported.state.roaming;
   imported.state.resources={gold:123,rice:4321,wood:345,stone:456};imported.state.troops=2100;imported.state.command=2;imported.state.magatama=11;
   const sent=structuredClone(imported.state),updated=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:imported}})).data;
   assert.equal(updated.save.state.roaming.sequence,2);assert.equal(updated.save.state.roaming.wins,2);assert.deepEqual(updated.save.state.roaming.history.map(b=>b.requestId),[second.requestId,first.requestId]);
   for(const key of ['resources','troops','command','magatama','castles'])assert.deepEqual(updated.save.state[key],sent[key],key+' must retain imported values, without re-credit or re-debit');
   const beforeReplay=row(h,p).save_json;assert.equal((await battle(h,p,firstBody)).data.idempotent,true);assert.equal(row(h,p).save_json,beforeReplay);
  }
  const next=await fight(h,p,input(h,p));assert.equal(next.battle.sequence,2);assert.equal(next.save.state.roaming.sequence,3);assert.equal(receiptCount(h),3);
 });
 await scope('new campaign progress is isolated while returning to an older campaign restores only its receipts',async h=>{
  const p=await player(h),oldSave=JSON.parse(row(h,p).save_json),old=(await fight(h,p,input(h,p))).battle;
  const fresh=structuredClone(oldSave);fresh.state.walking.campaignId='another-roaming-campaign';delete fresh.state.roaming;
  await lease(h,p);alignImport(fresh,(await h.api('/world-clock')).data.clock);const started=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:fresh}})).data;
  assert.equal(started.save.state.roaming.sequence,0);assert.equal(started.save.state.roaming.wins,0);assert.deepEqual(started.save.state.roaming.history,[]);
  const next=(await fight(h,p,input(h,p))).battle;assert.equal(next.sequence,0);assert.equal(next.campaignId,fresh.state.walking.campaignId);
  await lease(h,p);alignImport(oldSave,(await h.api('/world-clock')).data.clock);const returned=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:oldSave}})).data;
  assert.equal(returned.save.state.roaming.sequence,1);assert.deepEqual(returned.save.state.roaming.history.map(b=>b.requestId),[old.requestId]);assert(!returned.save.state.roaming.history.some(b=>b.requestId===next.requestId));assert.equal(receiptCount(h),2);
 });
 console.log(`${checks} CPU battle transaction scenarios passed (${calls} local API requests).`);
}finally{globalThis.fetch=originalFetch;}
