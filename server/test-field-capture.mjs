import assert from 'node:assert/strict';
import {harness,settleFieldMarch} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const checks=[];let calls=0;
const resources=['gold','rice','wood','stone'],zeros={gold:0,rice:0,wood:0,stone:0};
const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const save=(h,p)=>JSON.parse(row(h,p).save_json);
const backup=(h,p)=>h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(p.user.id);
const baseRow=h=>h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get();
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const job=(kind,id,targetLevel)=>({kind,id,targetLevel,total:1,remaining:1,totalSeconds:60,remainingSeconds:47});
async function scope(name,run){const h=harness();try{await run(h);checks.push(name);console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function fixture(h,name,{home='kiyosu',holdings=[],admin=false,mutate=()=>{}}={}){
  const p=await h.session(name);p.deviceId='device-'+p.user.id;
  if(admin)await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));
  const leased=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
  const value=h.fresh(home),s=value.state;s.castles[home].level=12;s.castles[home].troops=2000;
  s.resources={gold:50000,rice:50000,wood:50000,stone:50000};s.troops=20000;s.buildings.keep=20;s.buildings.wall=7;s.buildings.gold_mine=3;
  s.army=[s.officers[2],s.officers[0],s.officers[1]];s.governors={farm:s.officers[3]};
  s.worldClock={id:leased.clock.id,elapsedMs:leased.clock.elapsedMs};s.turn=Math.floor(leased.clock.elapsedMs/60000);s.realtime.elapsed=leased.clock.elapsedMs%60000/1000;
  for(const id of holdings){s.castles[id]={owner:s.clan,troops:1600,wall:6,level:9};if(!s.captureRewards.includes(id))s.captureRewards.push(id);}
  mutate(s);
  const written=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:leased.revision,save:value}})).data;
  p.revision=written.revision;(h.fieldPlayers??=new Map()).set(p.user.id,p);return p;
}
async function appoint(h,operator,p){await h.api('/admin/staff',post(operator,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));return (await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;}
const body=(h,a,d,castleId,extra={})=>({targetPlayerId:d.user.id,...(castleId===undefined?{}:{targetCastleId:castleId}),troops:3000,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:a.deviceId,expectedRevision:Number(row(h,a).revision),...extra});
const attack=async(h,p,request,expected=200)=>(await h.api('/field/attack',post(p,request,expected))).data;
async function advanceControl(h,p){
  const snapshot=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
  const game=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isAdmin:snapshot.user.isAdmin,isStaff:snapshot.user.isStaff,staffBase:snapshot.staffBase,maintenanceAuthority:snapshot.maintenanceAuthority,branchAuthority:{resolvedElapsedMs:snapshot.branchResolvedElapsedMs}});
  const advanced=game.applyWorldClock(snapshot.clock,{maxSeconds:86400,deferCycleSettlement:true});assert(advanced.ok&&!advanced.pending&&!advanced.settlementRequired);
  return JSON.parse(game.exportSave()).state;
}
async function fight(h,actor,request){
  const departure=await attack(h,actor,request);
  h.now+=departure.march.remainingMs;
  // The control engines only advance time, independently of the battle route.
  // Read metadata at the real arrival time so their maintenance seal and staff
  // projection cover that interval; neither control writes a player save.
  const transit=await advanceControl(h,actor),defender=h.fieldPlayers.get(request.targetPlayerId),targetCastle=request.targetCastleId||save(h,defender).state.home;
  const defenderTransit=await advanceControl(h,defender);
  const arrived=await status(h,actor),receipt=arrived.history.find(entry=>entry.id===departure.march.id);assert.equal(receipt?.status,'resolved');assert(receipt.battle);
  return {battle:receipt.battle,transit,defenderTransit};
}

async function outcome(won,run){const original=crypto.getRandomValues;crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(won?0:0xffffffff):original.call(crypto,array);};try{return await run();}finally{crypto.getRandomValues=original;}}
function unchangedDevelopment(before,after){for(const key of ['army','governors','buildings','officers','officerVariants','tech','claimedQuests','gachaHistory','magatama'])assert.deepEqual(after.state[key],before.state[key],key+' is retained');}
function beforeFieldCommit(h,hook){h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO field_requests'))return;h.beforeBatch=null;return hook(statements);};}
const status=async(h,p)=>(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;
function barrier(h,sql='INSERT INTO field_requests'){let entered=0,release;const wait=new Promise(r=>release=r);h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes(sql))return;if(++entered===2){h.beforeBatch=null;release();}await wait;};return()=>entered;}

await scope('public target identities contain homes and owned major outposts only',async h=>{
  const a=await fixture(h,'一覧の領主',{home:'inuyama'}),b=await fixture(h,'所領の領主',{holdings:['nijo','osaka','nagoya','azuchi']});
  const list=(await h.api('/field?limit=100',{token:a.token})).data,targets=list.targets.filter(t=>t.playerId===b.user.id);
  assert.equal(list.total,2);assert.equal(list.players.length,2);assert.equal(list.rules.targetCastles,true);assert.equal(list.rules.specialBaseBattles,true);
  assert.deepEqual(targets.map(t=>t.targetCastleId),['kiyosu','nijo','osaka','nagoya']);
  assert.equal(targets[0].battleMode,'raid');for(const t of targets.slice(1)){assert.equal(t.homeCastleId,'kiyosu');assert.equal(t.isHome,false);assert.equal(t.battleMode,'capture');assert.equal(t.capturable,true);assert.equal(t.keepLevel,9);assert.equal(t.level,9);}
  assert.equal(new Set(list.targets.map(t=>t.playerId+':'+t.targetCastleId)).size,list.targets.length);
  const page=(await h.api('/field?limit=1',{token:a.token})).data;assert(page.targets.every(t=>t.playerId===page.players[0].playerId));assert.equal(page.total,2);
  for(const id of ['azuchi','odani','edo','kyoto_gosho'])assert.equal((await attack(h,a,body(h,a,b,id),409)).error.code,'FIELD_TARGET_CHANGED');
  await attack(h,a,body(h,a,b,'unknown'),400);assert.equal(count(h,'field_battles'),0);
});

await scope('major outpost capture preserves homes and development, survives stale sync and replays once',async h=>{
  const a=await fixture(h,'占領する領主',{home:'inuyama'}),b=await fixture(h,'守る領主',{holdings:['nijo']});
  const beforeA=save(h,a),beforeB=save(h,b),revisionB=row(h,b).revision,request=body(h,a,b,'nijo');
  const result=await outcome(true,()=>fight(h,a,request)),afterA=save(h,a),afterB=save(h,b),battle=result.battle;
  assert.equal(battle.battleMode,'capture');assert.equal(battle.capture.captured,true);assert.equal(battle.capture.newlyOwned,true);assert.equal(battle.capture.castleId,'nijo');assert.equal(battle.capture.defenderHomeCastleId,'kiyosu');
  assert.equal(afterA.state.home,beforeA.state.home);assert.equal(afterB.state.home,beforeB.state.home);assert.equal(afterA.state.castles.nijo.owner,afterA.state.clan);assert.notEqual(afterB.state.castles.nijo.owner,afterB.state.clan,'same clan names do not prevent loss');
  assert.equal(afterA.state.castles.nijo.level,9);assert.equal(afterA.state.castles.nijo.troops,battle.capture.garrison);assert.equal(afterA.state.troops,result.transit.troops+request.troops-battle.attackerLost-battle.capture.garrison);
  unchangedDevelopment({state:result.transit},afterA);unchangedDevelopment({state:result.defenderTransit},afterB);assert.deepEqual(battle.rewards,zeros);
  for(const key of resources)assert.equal(afterA.state.resources[key]+afterB.state.resources[key],result.transit.resources[key]+result.defenderTransit.resources[key]);
  await h.api('/sync/lease',post(b,{deviceId:b.deviceId}));
  assert.equal((await h.api('/sync',{method:'PUT',token:b.token,body:{deviceId:b.deviceId,revision:revisionB,save:beforeB},expected:409})).data.error.code,'REVISION_CONFLICT');
  assert.deepEqual(save(h,b),afterB);
  const replay=await attack(h,a,request);assert.equal(replay.idempotent,true);assert.partialDeepStrictEqual(replay.battle,battle);assert.deepEqual(save(h,a),afterA);assert.deepEqual(save(h,b),afterB);assert.equal(count(h,'field_battles'),1);
  assert.equal((await attack(h,a,{...request,targetCastleId:'osaka'},409)).error.code,'REQUEST_ID_REUSED');
  const targets=(await h.api('/field?limit=100',{token:b.token})).data.targets;assert(targets.some(t=>t.playerId===a.user.id&&t.targetCastleId==='nijo'));assert(!targets.some(t=>t.playerId===b.user.id&&t.targetCastleId==='nijo'));
  const c=await fixture(h,'次の攻撃領主',{home:'okazaki'});const recapture=await outcome(true,()=>fight(h,c,body(h,c,a,'nijo')));assert.equal(recapture.battle.capture.captured,true);assert.equal(save(h,c).state.castles.nijo.owner,save(h,c).state.clan);assert.notEqual(save(h,a).state.castles.nijo.owner,save(h,a).state.clan);
});

for(const id of ['nijo','osaka','nagoya'])await scope(id+' home capture retreats safely and changes the durable cycle home',async h=>{
  const a=await fixture(h,'本拠を攻める領主',{home:'inuyama'}),b=await fixture(h,'大都市の領主',{home:id,mutate:s=>{s.castles[id].level=20;s.jobs=[job('castle',id,21),job('building','gold_mine',4)];}}),before=save(h,b);
  const result=await outcome(true,()=>fight(h,a,body(h,a,b,id))),after=save(h,b);
  const control=result.defenderTransit,castleJob=control.jobs.find(j=>j.kind==='castle');
  assert.equal(result.battle.capture.captured,true);assert.equal(after.state.home,'kiyosu');assert.equal(after.state.cycle.home,'kiyosu');assert.equal(row(h,b).cycle_home,'kiyosu');assert.equal(after.state.castles.kiyosu.owner,after.state.clan);assert.equal(after.state.castles.kiyosu.level,control.castles[id].level);assert.equal(after.state.castles.kiyosu.troops,control.castles[id].troops-result.battle.defenderLost.garrison);assert.notEqual(after.state.castles[id].owner,after.state.clan);
  unchangedDevelopment({state:control},after);assert.deepEqual(after.state.jobs.find(j=>j.kind==='building'),control.jobs.find(j=>j.kind==='building'));assert.deepEqual(after.state.jobs.find(j=>j.kind==='castle'),castleJob?{...castleJob,id:'kiyosu'}:undefined);
  await h.api('/sync/lease',post(b,{deviceId:b.deviceId}));
  const written=(await h.api('/sync',{method:'PUT',token:b.token,body:{deviceId:b.deviceId,revision:row(h,b).revision,save:after}})).data;assert.equal(written.save.state.home,'kiyosu');assert.equal(written.save.state.cycle.home,'kiyosu');
  h.now+=31000;h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=? WHERE id=?').run(672*60000,h.now,'world-v1');
  const next=(await h.api('/sync',{token:b.token})).data;assert.equal(next.save.state.cycle.index,1);assert.equal(next.save.state.home,'kiyosu');assert.equal(next.save.state.castles[id].owner===next.save.state.clan,false,'settlement cannot recreate the captured major home');assert.deepEqual(next.save.state.army,before.state.army);assert.deepEqual(next.save.state.governors,before.state.governors);
});

await scope('legacy attack without targetCastleId remains a noncapturing raid on a major home',async h=>{
  const a=await fixture(h,'旧画面の領主'),b=await fixture(h,'旧画面の守備',{home:'osaka'}),before=save(h,b),request=body(h,a,b,undefined);
  const result=await outcome(true,()=>fight(h,a,request));assert.equal(result.battle.battleMode,'raid');assert.equal(result.battle.capture.captured,false);assert.equal(save(h,b).state.home,'osaka');assert.equal(save(h,b).state.castles.osaka.owner,before.state.clan);
  const replay=await attack(h,a,request);assert.equal(replay.idempotent,true);assert.partialDeepStrictEqual(replay.battle,result.battle);
});

await scope('capture defeat cannot change ownership or move a defender home',async h=>{
  const a=await fixture(h,'敗れる領主'),b=await fixture(h,'勝ち守る領主',{home:'nagoya'}),before=save(h,b);
  const result=await outcome(false,()=>fight(h,a,body(h,a,b,'nagoya')));assert.equal(result.battle.won,false);assert.equal(result.battle.capture.captured,false);assert.equal(result.battle.capture.garrison,0);assert.equal(save(h,b).state.home,'nagoya');assert.equal(save(h,b).state.castles.nagoya.owner,before.state.clan);assert.deepEqual(result.battle.loot,zeros);assert.deepEqual(result.battle.rewards,zeros);
});

await scope('a victor already owning the same historical city keeps its level, garrison and pending job',async h=>{
  const a=await fixture(h,'既存所領の領主',{home:'sakamoto',holdings:['nijo'],mutate:s=>{s.castles.nijo.level=40;s.jobs=[job('castle','nijo',41)];}}),b=await fixture(h,'高城郭の守備',{holdings:['nijo'],mutate:s=>s.castles.nijo.level=48});
  const result=await outcome(true,()=>fight(h,a,body(h,a,b,'nijo'))),after=save(h,a);assert.equal(result.battle.capture.captured,true);assert.equal(result.battle.capture.newlyOwned,false);assert.equal(result.battle.capture.garrison,0);assert.deepEqual(after.state.castles.nijo,result.transit.castles.nijo);assert(result.transit.jobs.some(j=>j.id==='nijo'&&j.targetLevel===41));assert.deepEqual(after.state.jobs,result.transit.jobs);assert.notEqual(save(h,b).state.castles.nijo.owner,save(h,b).state.clan);
});

for(const role of ['admin','staff'])await scope(role+' attacker captures an outpost without moving its fixed base',async h=>{
  const operator=await fixture(h,'役職戦の運営',{admin:true}),actor=role==='admin'?operator:await fixture(h,'役職戦のスタッフ');if(role==='staff')await appoint(h,operator,actor);
  const defender=await fixture(h,'役職戦の守備',{holdings:['osaka']}),home=role==='admin'?'edo':'kyoto_gosho';
  const result=await outcome(true,()=>fight(h,actor,body(h,actor,defender,'osaka'))),after=save(h,actor);assert.equal(result.battle.capture.captured,true);assert.equal(after.state.home,home);assert.equal(after.state.cycle.home,home);assert.equal(row(h,actor).cycle_home,home);assert.equal(after.state.castles.osaka.owner,after.state.clan);unchangedDevelopment({state:result.transit},after);
  const loaded=(await h.api('/sync?deviceId='+actor.deviceId,{token:actor.token})).data;assert.equal(loaded.save.state.home,home);assert.equal(loaded.save.state.castles.osaka.owner,loaded.save.state.clan);
});

for(const role of ['admin','staff'])await scope(role+' owned major outpost can be captured while its role base remains',async h=>{
  const operator=await fixture(h,'所領守備の運営',{admin:true,holdings:role==='admin'?['nagoya']:[]}),defender=role==='admin'?operator:await fixture(h,'所領守備のスタッフ',{holdings:['nagoya']});if(role==='staff')await appoint(h,operator,defender);
  const actor=await fixture(h,'所領を攻める領主'),before=save(h,defender),shared=baseRow(h),home=role==='admin'?'edo':'kyoto_gosho';
  const result=await outcome(true,()=>fight(h,actor,body(h,actor,defender,'nagoya'))),after=save(h,defender);assert.equal(result.battle.battleMode,'capture');assert.equal(result.battle.capture.captured,true);assert.equal(after.state.home,home);assert.equal(after.state.cycle.home,home);assert.equal(row(h,defender).cycle_home,home);assert.notEqual(after.state.castles.nagoya.owner,after.state.clan);unchangedDevelopment({state:result.defenderTransit},after);assert.deepEqual(baseRow(h),shared);
});

await scope('capturing a staff original home updates its backup atomically and dismissal cannot restore it',async h=>{
  const operator=await fixture(h,'原本を守る運営',{admin:true}),defender=await fixture(h,'元大都市のスタッフ',{home:'osaka',mutate:s=>{s.castles.osaka.level=24;s.castles.kiyosu.level=29;s.castles.kiyosu.wall=11;}});await appoint(h,operator,defender);
  assert.equal(JSON.parse(backup(h,defender).save_json).state.home,'osaka');const actor=await fixture(h,'スタッフ所領の攻撃者',{home:'akutagawa'}),before=save(h,defender),request=body(h,actor,defender,'osaka');
  const departure=await outcome(true,()=>attack(h,actor,request)),escrow=row(h,actor),beforeDefender=row(h,defender),beforeBackup=backup(h,defender);
  h.now+=departure.march.remainingMs;const defenderTransit=await advanceControl(h,defender);
  h.sql.exec("CREATE TRIGGER reject_capture BEFORE INSERT ON field_battles BEGIN SELECT RAISE(ABORT,'test capture rollback'); END");
  const failed=await status(h,actor);assert.equal(failed.active[0].id,departure.march.id);assert.deepEqual(row(h,actor),escrow);assert.deepEqual(row(h,defender),beforeDefender);assert.deepEqual(backup(h,defender),beforeBackup);assert.equal(count(h,'field_requests'),0);h.sql.exec('DROP TRIGGER reject_capture');
  const result=(await status(h,actor)).history[0];assert.equal(result.battle.capture.captured,true);const personal=JSON.parse(backup(h,defender).save_json).state;assert.equal(personal.home,'kiyosu');assert.equal(personal.cycle.home,'kiyosu');assert.equal(personal.castles.kiyosu.troops,defenderTransit.castles.osaka.troops-result.battle.defenderLost.garrison,'staff backup retains the actual surviving garrison');assert.notEqual(personal.castles.osaka.owner,personal.clan);assert.equal(row(h,defender).cycle_home,'kyoto_gosho');assert.equal(save(h,defender).state.home,'kyoto_gosho');
  await h.api('/admin/staff',post(operator,{targetPlayerId:defender.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
  const visible=(await h.api('/field/me?deviceId='+defender.deviceId,{token:defender.token})).data.self;
  assert.equal(visible.level,personal.castles.kiyosu.level);
  assert.equal(visible.defenseTroops,personal.castles.kiyosu.troops+Math.floor(save(h,defender).state.troops*.45));
  const restored=(await h.api('/sync?deviceId='+defender.deviceId,{token:defender.token})).data;
  assert.equal(restored.save.state.home,'kiyosu');assert.equal(restored.save.state.cycle.home,'kiyosu');assert.equal(row(h,defender).cycle_home,'kiyosu');assert.notEqual(restored.save.state.castles.osaka.owner,restored.save.state.clan);assert.deepEqual(restored.save.state.castles.kiyosu,personal.castles.kiyosu);assert.equal(restored.save.state.castles.kiyosu.troops,defenderTransit.castles.osaka.troops-result.battle.defenderLost.garrison,'dismissal does not resurrect the lost garrison');unchangedDevelopment({state:defenderTransit},restored.save);
});

await scope('failed sieges persist staff personal-home durability through its separate backup and dismissal',async h=>{
  const operator=await fixture(h,'耐久を守る運営',{admin:true}),defender=await fixture(h,'旧大都市を守る担当',{home:'osaka'});await appoint(h,operator,defender);
  const actor=await fixture(h,'旧大都市の攻撃者',{home:'akutagawa'}),departure=await outcome(false,()=>attack(h,actor,body(h,actor,defender,'osaka'))),battle=await settleFieldMarch(h,actor,departure);
  assert(!battle.won);assert(battle.durability.damage>0);assert.deepEqual(save(h,defender).state.castles.osaka.durability,battle.durability.record);
  assert.deepEqual(JSON.parse(backup(h,defender).save_json).state.castles.osaka.durability,battle.durability.record);
  const publicHome=(await h.api('/field',{token:actor.token})).data.targets.find(target=>target.playerId===defender.user.id&&target.targetCastleId==='kyoto_gosho');assert.equal(publicHome.durability.current,publicHome.durability.max);
  await h.api('/admin/staff',post(operator,{targetPlayerId:defender.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
  const restored=(await h.api('/sync?deviceId='+defender.deviceId,{token:defender.token})).data.save.state;assert.equal(restored.home,'osaka');assert.deepEqual(restored.castles.osaka.durability,battle.durability.record);
});

await scope('dismissal keeps legitimate personal-home growth while an older backup is active',async h=>{
  const operator=await fixture(h,'成長を見届ける運営',{admin:true}),defender=await fixture(h,'任期中に守備を固めた領主',{home:'osaka'});
  const appointed=await appoint(h,operator,defender),oldBackup=backup(h,defender),castle=appointed.save.state.castles.osaka;
  Object.assign(castle,{troops:6200,level:26,wall:12});
  await h.api('/sync',{method:'PUT',token:defender.token,body:{deviceId:defender.deviceId,revision:appointed.revision,save:appointed.save}});
  // A legacy appointment backup may predate development in the live campaign.
  h.sql.prepare('UPDATE staff_campaign_backups SET save_json=? WHERE user_id=?').run(oldBackup.save_json,defender.user.id);
  await h.api('/admin/staff',post(operator,{targetPlayerId:defender.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
  const visible=(await h.api('/field')).data.players.find(p=>p.playerId===defender.user.id);
  assert.equal(visible.level,26);assert.equal(visible.defenseTroops,6200+Math.floor(appointed.save.state.troops*.45));
  const restored=(await h.api('/sync?deviceId='+defender.deviceId,{token:defender.token})).data.save.state;
  assert.deepEqual(restored.castles.osaka,{owner:restored.clan,troops:6200,level:26,wall:12});assert.equal(restored.home,'osaka');
});

await scope('special-base loot respects capacity and leaves overflow with the defender',async h=>{
  const operator=await fixture(h,'報酬の運営',{admin:true}),actor=await fixture(h,'上限報酬の領主',{home:'kawagoe',mutate:s=>s.resources={gold:99999000,rice:100000000,wood:100000000,stone:99999700}}),before=row(h,operator);
  const result=await outcome(true,()=>fight(h,actor,body(h,actor,operator,'edo')));assert.equal(result.battle.battleMode,'reward');assert.deepEqual(result.battle.rewards,zeros);
  assert.deepEqual(result.battle.loot,Object.fromEntries(resources.map(key=>[key,Math.min(Math.floor(result.defenderTransit.resources[key]/2),100000000-result.transit.resources[key])])));
  assert(result.battle.lootCapacityLimited);assert.equal(result.battle.loot.wood,0);assert.deepEqual(result.battle.defenderLost,{troops:0,garrison:0});assert.equal(result.battle.defenderRevision,before.revision+1);
  for(const key of resources){assert.equal(save(h,actor).state.resources[key],result.transit.resources[key]+result.battle.loot[key]);assert.equal(save(h,operator).state.resources[key],result.defenderTransit.resources[key]-result.battle.loot[key]);}
});

await scope('Kyoto defense uses shared development while debiting only the attacked member resources',async h=>{
  const operator=await fixture(h,'共通防御の運営',{admin:true}),defender=await fixture(h,'共通防御のスタッフ');await appoint(h,operator,defender);const actor=await fixture(h,'共通防御への攻撃者');
  const publicBase=(await h.api('/field?limit=100',{token:actor.token})).data.players.find(p=>p.playerId===defender.user.id),shared=JSON.parse(baseRow(h).state_json);
  shared.castleLevel=63;shared.buildings.wall=31;shared.jobs=[{jobId:'fixture-palace-castle',startedBy:{id:defender.user.id,name:'共同普請'},kind:'castle',id:'kyoto_gosho',targetLevel:64,completesElapsedMs:0},{jobId:'fixture-palace-wall',startedBy:{id:defender.user.id,name:'共同普請'},kind:'building',id:'wall',targetLevel:32,completesElapsedMs:0}];h.sql.prepare("UPDATE staff_base SET state_json=?,revision=revision+1 WHERE id='kyoto_gosho'").run(JSON.stringify(shared));
  const beforeBase=baseRow(h),before=row(h,defender),beforeBackup=backup(h,defender),privateState=save(h,defender).state;
  const result=await outcome(true,()=>fight(h,actor,body(h,actor,defender,'kyoto_gosho')));
  const defenseTroops=result.defenderTransit.castles.kyoto_gosho.troops+Math.floor(result.defenderTransit.troops*.45);
  const expected=Math.round((defenseTroops+200)*(1+32*.11)*(1+privateState.tech.discipline*.06)*(1+63*.04)*publicBase.armySummary.rankPower);
  assert.equal(result.battle.defensePower,expected);assert.equal(row(h,defender).revision,before.revision+1);assert.deepEqual(save(h,defender).state.buildings,result.defenderTransit.buildings);for(const key of resources)assert.equal(save(h,defender).state.resources[key],result.defenderTransit.resources[key]-result.battle.loot[key]);const settledBase=JSON.parse(baseRow(h).state_json);assert.equal(settledBase.castleLevel,64);assert.equal(settledBase.buildings.wall,32);assert.deepEqual(settledBase.jobs,[]);
});

await scope('shared defense revision changes leave the entire reward pending for retry',async h=>{
  const operator=await fixture(h,'競合防御の運営',{admin:true}),defender=await fixture(h,'競合防御のスタッフ');await appoint(h,operator,defender);const actor=await fixture(h,'競合防御の攻撃者'),departure=await outcome(true,()=>attack(h,actor,body(h,actor,defender,'kyoto_gosho'))),before=row(h,actor),other=row(h,defender);h.now+=departure.march.remainingMs;let invoked=false;
  beforeFieldCommit(h,()=>{invoked=true;h.sql.prepare("UPDATE staff_base SET revision=revision+1 WHERE id='kyoto_gosho'").run();});
  const result=await status(h,actor);assert(invoked);assert.equal(result.active[0].id,departure.march.id);assert.deepEqual(row(h,actor),before);assert.deepEqual(row(h,defender),other);assert.equal(count(h,'field_requests'),0);assert.equal(count(h,'field_battles'),0);
});

await scope('a staff term change at arrival invalidates the original capture transaction',async h=>{
  const operator=await fixture(h,'任期競合の運営',{admin:true}),defender=await fixture(h,'任期競合のスタッフ',{holdings:['nijo']});await appoint(h,operator,defender);const actor=await fixture(h,'任期競合の攻撃者'),departure=await outcome(true,()=>attack(h,actor,body(h,actor,defender,'nijo'))),before=row(h,actor),other=row(h,defender),originalBackup=backup(h,defender);h.now+=departure.march.remainingMs;let invoked=false;
  beforeFieldCommit(h,()=>{invoked=true;h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run('new-staff-term',defender.user.id);});
  const result=await status(h,actor);assert(invoked);assert.equal(result.active[0].id,departure.march.id);assert.deepEqual(row(h,actor),before);assert.deepEqual(row(h,defender),other);assert.deepEqual(backup(h,defender),originalBackup);assert.equal(count(h,'field_battles'),0);
});

await scope('competing captures commit exactly one new owner and one defender revision',async h=>{
  const a=await fixture(h,'競合占領甲'),b=await fixture(h,'競合占領乙',{home:'inuyama'}),d=await fixture(h,'競合占領守備',{home:'nijo'}),defender=row(h,d);
  const actors=[a,b],departures=await outcome(true,()=>Promise.all(actors.map(actor=>attack(h,actor,body(h,actor,d,'nijo')))));
  assert(departures.every(r=>r.marching));assert.equal(count(h,'field_battles'),0);
  h.now+=Math.max(...departures.map(r=>r.march.remainingMs));const entered=barrier(h);
  await Promise.all(actors.map(actor=>status(h,actor)));assert.equal(entered(),2);
  const results=await Promise.all(actors.map(actor=>status(h,actor)));
  assert.deepEqual(results.map(r=>r.history[0].status).sort(),['cancelled','resolved']);
  assert.equal(row(h,d).revision,defender.revision+1);assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'field_requests'),1);
  const winner=results.findIndex(r=>r.history[0].status==='resolved'),loser=1-winner;assert.equal(save(h,actors[winner]).state.castles.nijo.owner,save(h,actors[winner]).state.clan);assert.notEqual(save(h,actors[loser]).state.castles.nijo.owner,save(h,actors[loser]).state.clan);assert.equal(save(h,d).state.home,'kiyosu');
});

await scope('concurrent duplicate capture retries return one receipt and one reward',async h=>{
  const a=await fixture(h,'同時再送の領主',{home:'inuyama'}),d=await fixture(h,'同時再送の守備',{holdings:['osaka']}),request=body(h,a,d,'osaka'),before=row(h,a);
  const entered=barrier(h,'INSERT INTO battle_marches'),departures=await outcome(true,()=>Promise.all([attack(h,a,request),attack(h,a,request)]));
  assert.equal(entered(),2);assert.deepEqual(departures.map(r=>r.idempotent).sort(),[false,true]);assert.equal(departures[0].march.id,departures[1].march.id);assert.equal(row(h,a).revision,before.revision+1);assert.equal(count(h,'field_battles'),0);
  const battle=await settleFieldMarch(h,a,departures[0]),settled=row(h,a);
  const results=await Promise.all([attack(h,a,request),attack(h,a,request)]);
  assert(results.every(r=>r.idempotent));assert.deepEqual(results[0].battle,results[1].battle);assert.equal(results[0].battle.id,battle.id);assert.equal(row(h,a).revision,before.revision+2);assert.deepEqual(row(h,a),settled);assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'field_requests'),1);
});

console.log(JSON.stringify({ok:true,calls,checks:checks.length},null,2));
