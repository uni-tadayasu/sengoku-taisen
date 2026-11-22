import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

const checks=[];let calls=0;
const resources=['gold','rice','wood','stone'],zeros={gold:0,rice:0,wood:0,stone:0};
const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const save=(h,p)=>JSON.parse(row(h,p).save_json);
const backup=(h,p)=>h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(p.user.id);
const baseRow=h=>h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get();
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const job=(kind,id,targetLevel,remainingSeconds=47)=>({kind,id,targetLevel,total:1,remaining:1,totalSeconds:60,remainingSeconds});
async function scope(name,run){const h=harness();try{await run(h);checks.push(name);console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function fixture(h,name,{home='kiyosu',holdings=[],admin=false,mutate=()=>{}}={}){
  const p=await h.session(name);p.deviceId='device-'+p.user.id;
  if(admin)await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));
  const leased=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
  const value=h.fresh(),s=value.state;s.castles[s.home].owner='在地衆';s.home=home;s.castles[home].owner=s.clan;s.castles[home].level=12;s.castles[home].troops=2000;
  s.resources={gold:50000,rice:50000,wood:50000,stone:50000};s.troops=20000;s.buildings.keep=20;s.buildings.wall=7;s.buildings.gold_mine=3;
  s.army=[s.officers[2],s.officers[0],s.officers[1]];s.governors={farm:s.officers[3]};
  s.worldClock={id:leased.clock.id,elapsedMs:leased.clock.elapsedMs};s.turn=Math.floor(leased.clock.elapsedMs/60000);s.realtime.elapsed=leased.clock.elapsedMs%60000/1000;
  for(const id of holdings){s.castles[id]={owner:s.clan,troops:1600,wall:6,level:9};if(!s.captureRewards.includes(id))s.captureRewards.push(id);}
  mutate(s);
  const written=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:leased.revision,save:value}})).data;
  p.revision=written.revision;return p;
}
async function appoint(h,operator,p){await h.api('/admin/staff',post(operator,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));return (await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;}
const body=(h,a,d,castleId,extra={})=>({targetPlayerId:d.user.id,...(castleId===undefined?{}:{targetCastleId:castleId}),troops:3000,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:a.deviceId,expectedRevision:Number(row(h,a).revision),...extra});
const attack=async(h,p,request,expected=200)=>(await h.api('/field/attack',post(p,request,expected))).data;
async function outcome(won,run){const original=crypto.getRandomValues;crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(won?0:0xffffffff):original.call(crypto,array);};try{return await run();}finally{crypto.getRandomValues=original;}}
function unchangedDevelopment(before,after){for(const key of ['army','governors','buildings','officers','officerVariants','tech','claimedQuests','gachaHistory','magatama'])assert.deepEqual(after.state[key],before.state[key],key+' is retained');}
function beforeFieldCommit(h,hook){h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO field_requests'))return;h.beforeBatch=null;return hook(statements);};}
function barrier(h){let entered=0,release;const wait=new Promise(r=>release=r);h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO field_requests'))return;if(++entered===2){h.beforeBatch=null;release();}await wait;};return()=>entered;}

await scope('public target identities contain homes and owned major outposts only',async h=>{
  const a=await fixture(h,'一覧の領主'),b=await fixture(h,'所領の領主',{holdings:['nijo','osaka','nagoya','azuchi']});
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
  const a=await fixture(h,'占領する領主'),b=await fixture(h,'守る領主',{holdings:['nijo']});
  const beforeA=save(h,a),beforeB=save(h,b),revisionB=row(h,b).revision,request=body(h,a,b,'nijo');
  const result=await outcome(true,()=>attack(h,a,request)),afterA=save(h,a),afterB=save(h,b),battle=result.battle;
  assert.equal(battle.battleMode,'capture');assert.equal(battle.capture.captured,true);assert.equal(battle.capture.newlyOwned,true);assert.equal(battle.capture.castleId,'nijo');assert.equal(battle.capture.defenderHomeCastleId,'kiyosu');
  assert.equal(afterA.state.home,beforeA.state.home);assert.equal(afterB.state.home,beforeB.state.home);assert.equal(afterA.state.castles.nijo.owner,afterA.state.clan);assert.notEqual(afterB.state.castles.nijo.owner,afterB.state.clan,'same clan names do not prevent loss');
  assert.equal(afterA.state.castles.nijo.level,9);assert.equal(afterA.state.castles.nijo.troops,battle.capture.garrison);assert.equal(afterA.state.troops,beforeA.state.troops-battle.attackerLost-battle.capture.garrison);
  unchangedDevelopment(beforeA,afterA);unchangedDevelopment(beforeB,afterB);assert.deepEqual(battle.rewards,zeros);
  for(const key of resources)assert.equal(afterA.state.resources[key]+afterB.state.resources[key],beforeA.state.resources[key]+beforeB.state.resources[key]-(key==='rice'?battle.foodCost:0));
  assert.equal((await h.api('/sync',{method:'PUT',token:b.token,body:{deviceId:b.deviceId,revision:revisionB,save:beforeB},expected:409})).data.error.code,'REVISION_CONFLICT');
  assert.deepEqual(save(h,b),afterB);
  const replay=await attack(h,a,request);assert.equal(replay.idempotent,true);assert.deepEqual(replay.battle,battle);assert.deepEqual(save(h,a),afterA);assert.deepEqual(save(h,b),afterB);assert.equal(count(h,'field_battles'),1);
  assert.equal((await attack(h,a,{...request,targetCastleId:'osaka'},409)).error.code,'REQUEST_ID_REUSED');
  const targets=(await h.api('/field?limit=100',{token:b.token})).data.targets;assert(targets.some(t=>t.playerId===a.user.id&&t.targetCastleId==='nijo'));assert(!targets.some(t=>t.playerId===b.user.id&&t.targetCastleId==='nijo'));
  const c=await fixture(h,'次の攻撃領主');const recapture=await outcome(true,()=>attack(h,c,body(h,c,a,'nijo')));assert.equal(recapture.battle.capture.captured,true);assert.equal(save(h,c).state.castles.nijo.owner,save(h,c).state.clan);assert.notEqual(save(h,a).state.castles.nijo.owner,save(h,a).state.clan);
});

for(const id of ['nijo','osaka','nagoya'])await scope(id+' home capture retreats safely and changes the durable cycle home',async h=>{
  const a=await fixture(h,'本拠を攻める領主'),b=await fixture(h,'大都市の領主',{home:id,mutate:s=>{s.castles[id].level=20;s.jobs=[job('castle',id,21),job('building','gold_mine',4)];}}),before=save(h,b);
  const result=await outcome(true,()=>attack(h,a,body(h,a,b,id))),after=save(h,b);
  assert.equal(result.battle.capture.captured,true);assert.equal(after.state.home,'kiyosu');assert.equal(after.state.cycle.home,'kiyosu');assert.equal(row(h,b).cycle_home,'kiyosu');assert.equal(after.state.castles.kiyosu.owner,after.state.clan);assert.equal(after.state.castles.kiyosu.level,20);assert.equal(after.state.castles.kiyosu.troops,before.state.castles[id].troops-result.battle.defenderLost.garrison);assert.notEqual(after.state.castles[id].owner,after.state.clan);
  unchangedDevelopment(before,after);assert.deepEqual(after.state.jobs.find(j=>j.kind==='building'),before.state.jobs.find(j=>j.kind==='building'));assert.deepEqual(after.state.jobs.find(j=>j.kind==='castle'),{...before.state.jobs.find(j=>j.kind==='castle'),id:'kiyosu'});
  const written=(await h.api('/sync',{method:'PUT',token:b.token,body:{deviceId:b.deviceId,revision:row(h,b).revision,save:after}})).data;assert.equal(written.save.state.home,'kiyosu');assert.equal(written.save.state.cycle.home,'kiyosu');
  h.now+=31000;h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=? WHERE id=?').run(672*60000,h.now,'world-v1');
  const next=(await h.api('/sync',{token:b.token})).data;assert.equal(next.save.state.cycle.index,1);assert.equal(next.save.state.home,'kiyosu');assert.equal(next.save.state.castles[id].owner===next.save.state.clan,false,'settlement cannot recreate the captured major home');assert.deepEqual(next.save.state.army,before.state.army);assert.deepEqual(next.save.state.governors,before.state.governors);
});

await scope('legacy attack without targetCastleId remains a noncapturing raid on a major home',async h=>{
  const a=await fixture(h,'旧画面の領主'),b=await fixture(h,'旧画面の守備',{home:'osaka'}),before=save(h,b),request=body(h,a,b,undefined);
  const result=await outcome(true,()=>attack(h,a,request));assert.equal(result.battle.battleMode,'raid');assert.equal(result.battle.capture.captured,false);assert.equal(save(h,b).state.home,'osaka');assert.equal(save(h,b).state.castles.osaka.owner,before.state.clan);
  const replay=await attack(h,a,request);assert.equal(replay.idempotent,true);assert.deepEqual(replay.battle,result.battle);
});

await scope('capture defeat cannot change ownership or move a defender home',async h=>{
  const a=await fixture(h,'敗れる領主'),b=await fixture(h,'勝ち守る領主',{home:'nagoya'}),before=save(h,b);
  const result=await outcome(false,()=>attack(h,a,body(h,a,b,'nagoya')));assert.equal(result.battle.won,false);assert.equal(result.battle.capture.captured,false);assert.equal(result.battle.capture.garrison,0);assert.equal(save(h,b).state.home,'nagoya');assert.equal(save(h,b).state.castles.nagoya.owner,before.state.clan);assert.deepEqual(result.battle.loot,zeros);assert.deepEqual(result.battle.rewards,zeros);
});

await scope('a victor already owning the same historical city keeps its level, garrison and pending job',async h=>{
  const a=await fixture(h,'既存所領の領主',{holdings:['nijo'],mutate:s=>{s.castles.nijo.level=40;s.jobs=[job('castle','nijo',41)];}}),b=await fixture(h,'高城郭の守備',{holdings:['nijo'],mutate:s=>s.castles.nijo.level=48}),before=save(h,a);
  const result=await outcome(true,()=>attack(h,a,body(h,a,b,'nijo'))),after=save(h,a);assert.equal(result.battle.capture.captured,true);assert.equal(result.battle.capture.newlyOwned,false);assert.equal(result.battle.capture.garrison,0);assert.deepEqual(after.state.castles.nijo,before.state.castles.nijo);assert.deepEqual(after.state.jobs,before.state.jobs);assert.notEqual(save(h,b).state.castles.nijo.owner,save(h,b).state.clan);
});

for(const role of ['admin','staff'])await scope(role+' attacker captures an outpost without moving its fixed base',async h=>{
  const operator=await fixture(h,'役職戦の運営',{admin:true}),actor=role==='admin'?operator:await fixture(h,'役職戦のスタッフ');if(role==='staff')await appoint(h,operator,actor);
  const defender=await fixture(h,'役職戦の守備',{holdings:['osaka']}),before=save(h,actor),home=role==='admin'?'edo':'kyoto_gosho';
  const result=await outcome(true,()=>attack(h,actor,body(h,actor,defender,'osaka'))),after=save(h,actor);assert.equal(result.battle.capture.captured,true);assert.equal(after.state.home,home);assert.equal(after.state.cycle.home,home);assert.equal(row(h,actor).cycle_home,home);assert.equal(after.state.castles.osaka.owner,after.state.clan);unchangedDevelopment(before,after);
  const loaded=(await h.api('/sync?deviceId='+actor.deviceId,{token:actor.token})).data;assert.equal(loaded.save.state.home,home);assert.equal(loaded.save.state.castles.osaka.owner,loaded.save.state.clan);
});

for(const role of ['admin','staff'])await scope(role+' owned major outpost can be captured while its role base remains',async h=>{
  const operator=await fixture(h,'所領守備の運営',{admin:true,holdings:role==='admin'?['nagoya']:[]}),defender=role==='admin'?operator:await fixture(h,'所領守備のスタッフ',{holdings:['nagoya']});if(role==='staff')await appoint(h,operator,defender);
  const actor=await fixture(h,'所領を攻める領主'),before=save(h,defender),shared=baseRow(h),home=role==='admin'?'edo':'kyoto_gosho';
  const result=await outcome(true,()=>attack(h,actor,body(h,actor,defender,'nagoya'))),after=save(h,defender);assert.equal(result.battle.battleMode,'capture');assert.equal(result.battle.capture.captured,true);assert.equal(after.state.home,home);assert.equal(after.state.cycle.home,home);assert.equal(row(h,defender).cycle_home,home);assert.notEqual(after.state.castles.nagoya.owner,after.state.clan);unchangedDevelopment(before,after);assert.deepEqual(baseRow(h),shared);
});

await scope('capturing a staff original home updates its backup atomically and dismissal cannot restore it',async h=>{
  const operator=await fixture(h,'原本を守る運営',{admin:true}),defender=await fixture(h,'元大都市のスタッフ',{home:'osaka',mutate:s=>s.castles.osaka.level=24});await appoint(h,operator,defender);
  assert.equal(JSON.parse(backup(h,defender).save_json).state.home,'osaka');const actor=await fixture(h,'スタッフ所領の攻撃者'),before=save(h,defender),request=body(h,actor,defender,'osaka'),beforeActor=row(h,actor),beforeDefender=row(h,defender),beforeBackup=backup(h,defender);
  h.sql.exec("CREATE TRIGGER reject_capture BEFORE INSERT ON field_battles BEGIN SELECT RAISE(ABORT,'test capture rollback'); END");
  await outcome(true,()=>attack(h,actor,request,500));assert.deepEqual(row(h,actor),beforeActor);assert.deepEqual(row(h,defender),beforeDefender);assert.deepEqual(backup(h,defender),beforeBackup);assert.equal(count(h,'field_requests'),0);h.sql.exec('DROP TRIGGER reject_capture');
  const result=await outcome(true,()=>attack(h,actor,request));assert.equal(result.battle.capture.captured,true);const personal=JSON.parse(backup(h,defender).save_json).state;assert.equal(personal.home,'kiyosu');assert.equal(personal.cycle.home,'kiyosu');assert.equal(personal.castles.kiyosu.troops,before.state.castles.osaka.troops-result.battle.defenderLost.garrison,'staff backup retains the actual surviving garrison');assert.notEqual(personal.castles.osaka.owner,personal.clan);assert.equal(row(h,defender).cycle_home,'kyoto_gosho');assert.equal(save(h,defender).state.home,'kyoto_gosho');
  await h.api('/admin/staff',post(operator,{targetPlayerId:defender.user.id,action:'dismiss',requestId:crypto.randomUUID()}));const restored=(await h.api('/sync?deviceId='+defender.deviceId,{token:defender.token})).data;
  assert.equal(restored.save.state.home,'kiyosu');assert.equal(restored.save.state.cycle.home,'kiyosu');assert.equal(row(h,defender).cycle_home,'kiyosu');assert.notEqual(restored.save.state.castles.osaka.owner,restored.save.state.clan);assert.equal(restored.save.state.castles.kiyosu.troops,before.state.castles.osaka.troops-result.battle.defenderLost.garrison,'dismissal does not resurrect the lost garrison');unchangedDevelopment(before,restored.save);
});

await scope('server reward amounts respect caps and do not borrow defender resources',async h=>{
  const operator=await fixture(h,'報酬の運営',{admin:true}),actor=await fixture(h,'上限報酬の領主',{mutate:s=>s.resources={gold:99999951,rice:100000000,wood:100000000,stone:99999999}}),before=row(h,operator),beforeActor=save(h,actor);
  const result=await outcome(true,()=>attack(h,actor,body(h,actor,operator,'edo')));assert.equal(result.battle.battleMode,'reward');assert.deepEqual(result.battle.rewards,{gold:49,rice:500,wood:0,stone:1});assert.deepEqual(result.battle.loot,zeros);assert.deepEqual(result.battle.defenderLost,{troops:0,garrison:0});assert.deepEqual(row(h,operator),before);assert.equal(result.battle.defenderRevision,before.revision);
  for(const key of resources)assert.equal(save(h,actor).state.resources[key],beforeActor.state.resources[key]+result.battle.rewards[key]-(key==='rice'?result.battle.foodCost:0));
});

await scope('Kyoto palace defense projects completed shared jobs without changing defender or shared data',async h=>{
  const operator=await fixture(h,'共通防御の運営',{admin:true}),defender=await fixture(h,'共通防御のスタッフ');await appoint(h,operator,defender);const actor=await fixture(h,'共通防御への攻撃者');
  const publicBase=(await h.api('/field?limit=100',{token:actor.token})).data.players.find(p=>p.playerId===defender.user.id),shared=JSON.parse(baseRow(h).state_json);
  shared.castleLevel=63;shared.buildings.wall=31;shared.jobs=[{kind:'castle',id:'kyoto_gosho',targetLevel:64,completesElapsedMs:0},{kind:'building',id:'wall',targetLevel:32,completesElapsedMs:0}];h.sql.prepare("UPDATE staff_base SET state_json=?,revision=revision+1 WHERE id='kyoto_gosho'").run(JSON.stringify(shared));
  const beforeBase=baseRow(h),before=row(h,defender),beforeBackup=backup(h,defender),privateState=save(h,defender).state;
  const result=await outcome(true,()=>attack(h,actor,body(h,actor,defender,'kyoto_gosho')));
  const expected=Math.round((publicBase.defenseTroops+200)*(1+32*.11)*(1+privateState.tech.discipline*.06)*(1+63*.04)*publicBase.armySummary.rankPower);
  assert.equal(result.battle.defensePower,expected);assert.deepEqual(baseRow(h),beforeBase);assert.deepEqual(row(h,defender),before);assert.deepEqual(backup(h,defender),beforeBackup);
});

await scope('shared defense revision changes cancel the whole reward operation',async h=>{
  const operator=await fixture(h,'競合防御の運営',{admin:true}),defender=await fixture(h,'競合防御のスタッフ');await appoint(h,operator,defender);const actor=await fixture(h,'競合防御の攻撃者'),before=row(h,actor),other=row(h,defender);let invoked=false;
  beforeFieldCommit(h,()=>{invoked=true;h.sql.prepare("UPDATE staff_base SET revision=revision+1 WHERE id='kyoto_gosho'").run();});
  const result=await outcome(true,()=>attack(h,actor,body(h,actor,defender,'kyoto_gosho'),409));assert(invoked);assert.equal(result.error.code,'FIELD_CHANGED');assert.deepEqual(row(h,actor),before);assert.deepEqual(row(h,defender),other);assert.equal(count(h,'field_requests'),0);assert.equal(count(h,'field_battles'),0);
});

await scope('a staff term change at commit cancels a major outpost capture',async h=>{
  const operator=await fixture(h,'任期競合の運営',{admin:true}),defender=await fixture(h,'任期競合のスタッフ',{holdings:['nijo']});await appoint(h,operator,defender);const actor=await fixture(h,'任期競合の攻撃者'),before=row(h,actor),other=row(h,defender),originalBackup=backup(h,defender);let invoked=false;
  beforeFieldCommit(h,()=>{invoked=true;h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run('new-staff-term',defender.user.id);});
  const result=await outcome(true,()=>attack(h,actor,body(h,actor,defender,'nijo'),409));assert(invoked);assert.equal(result.error.code,'FIELD_CHANGED');assert.deepEqual(row(h,actor),before);assert.deepEqual(row(h,defender),other);assert.deepEqual(backup(h,defender),originalBackup);assert.equal(count(h,'field_battles'),0);
});

await scope('competing captures commit exactly one new owner and one defender revision',async h=>{
  const a=await fixture(h,'競合占領甲'),b=await fixture(h,'競合占領乙'),d=await fixture(h,'競合占領守備',{home:'nijo'}),beforeD=row(h,d),before=[row(h,a),row(h,b)],entered=barrier(h),requests=[body(h,a,d,'nijo'),body(h,b,d,'nijo')];
  const results=await outcome(true,()=>Promise.all([h.api('/field/attack',post(a,requests[0],null)),h.api('/field/attack',post(b,requests[1],null))]));assert.equal(entered(),2);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);assert.equal(row(h,d).revision,beforeD.revision+1);assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'field_requests'),1);
  const winner=results.findIndex(r=>r.response.status===200),loser=1-winner;assert.deepEqual(row(h,[a,b][loser]),before[loser]);assert.equal(save(h,[a,b][winner]).state.castles.nijo.owner,save(h,[a,b][winner]).state.clan);assert.equal(save(h,d).state.home,'kiyosu');
});

await scope('concurrent duplicate capture retries return one receipt and one reward',async h=>{
  const a=await fixture(h,'同時再送の領主'),d=await fixture(h,'同時再送の守備',{holdings:['osaka']}),request=body(h,a,d,'osaka'),entered=barrier(h),before=row(h,a);
  const results=await outcome(true,()=>Promise.all([attack(h,a,request),attack(h,a,request)]));assert.equal(entered(),2);assert.deepEqual(results.map(r=>r.idempotent).sort(),[false,true]);assert.deepEqual(results[0].battle,results[1].battle);assert.equal(row(h,a).revision,before.revision+1);assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'field_requests'),1);
});

console.log(JSON.stringify({ok:true,calls,checks:checks.length},null,2));
