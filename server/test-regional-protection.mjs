import assert from 'node:assert/strict';
import {harness,settleFieldMarch} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const REGIONS=globalThis.SENGOKU_DATA.regionConquest.regions,CYCLE=672*60000;
const ids=region=>REGIONS.find(row=>row.region===region).castleIds;
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const save=(h,p)=>JSON.parse(row(h,p).save_json);
const put=(h,p,value,expected=200)=>h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected});
async function fixture(h,name,{home='ishikawa',regions=[],holdings=[],prepare}={}){
 const p=await h.session(name);p.deviceId='regional-'+p.user.id;const leased=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 const value=h.fresh(home),s=value.state;s.resources={gold:900000,rice:900000,wood:900000,stone:900000};s.troops=100000;s.buildings.keep=32;s.buildings.barracks=32;s.seed=1;
 for(const key of ['farm','market','lumber','quarry'])s.buildings[key]=32;
 s.worldClock={id:leased.clock.id,elapsedMs:leased.clock.elapsedMs};s.turn=Math.floor(leased.clock.elapsedMs/60000);s.realtime.elapsed=leased.clock.elapsedMs%60000/1000;
 for(const id of [...regions.flatMap(ids),...holdings]){s.castles[id].owner=s.clan;if(!s.captureRewards.includes(id))s.captureRewards.push(id);}
 prepare?.(s);p.initial=(await put(h,p,value)).data;return p;
}
const attackBody=(h,a,d,targetCastleId)=>({targetPlayerId:d.user.id,targetCastleId,troops:50000,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:a.deviceId,expectedRevision:row(h,a).revision});
async function win(run){const original=crypto.getRandomValues;crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(0):original.call(crypto,array);};try{return await run();}finally{crypto.getRandomValues=original;}}
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Regional tests must not contact production');};
try{
 await scope('protection is computed from admitted holdings and forged additions or ownership losses cannot commit',async h=>{
  const p=await fixture(h,'九州を保護する領主',{regions:['九州']});assert.deepEqual(p.initial.save.state.cycle.protectedRegions,['九州']);const original=row(h,p).save_json;
  for(const mutate of [s=>s.cycle.protectedRegions.push('東海'),s=>s.cycle.protectedRegions=[],s=>delete s.cycle.protectedRegions,s=>s.castles.funai.owner='在地衆']){
   const incoming=save(h,p);mutate(incoming.state);const result=await put(h,p,incoming,null);assert.equal(result.response.status,409,String(mutate));assert.equal(result.data.error.code,'REGION_INHERITANCE_REQUIRED');assert.equal(row(h,p).save_json,original);
  }
  const ordinary=await fixture(h,'未制覇の領主'),forged=save(h,ordinary);forged.state.cycle.protectedRegions=['東海'];assert.equal((await put(h,ordinary,forged,409)).data.error.code,'REGION_INHERITANCE_REQUIRED');assert.deepEqual(save(h,ordinary).state.cycle.protectedRegions,[]);
  const freshPlayer=await h.session('保護名だけの持込');freshPlayer.deviceId='fresh-regional';await h.api('/sync/lease',post(freshPlayer,{deviceId:freshPlayer.deviceId}));
  const fake=h.fresh();fake.state.cycle={index:0,home:fake.state.home,latestReward:null,retainedRegions:[],protectedRegions:['九州']};await put(h,freshPlayer,fake,409);assert.equal(row(h,freshPlayer).save_json,null);
 });
 await scope('legacy stored holdings gain protection on read without trusting stale boundary history or mutating the row',async h=>{
  const p=await fixture(h,'旧形式の東海領主',{regions:['東海']}),legacy=save(h,p);delete legacy.state.cycle.protectedRegions;legacy.state.cycle.retainedRegions=['九州'];
  h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(legacy),p.user.id);const before=row(h,p).save_json;
  const list=(await h.api('/field?limit=100',{token:p.token})).data,nagoya=list.targets.find(target=>target.playerId===p.user.id&&target.targetCastleId==='nagoya');
  assert.equal(nagoya.regionProtected,true);assert.equal(nagoya.protectedRegion,'東海');assert.equal(nagoya.battleMode,'reward');assert.equal(nagoya.capturable,false);assert.equal(row(h,p).save_json,before);
  const snapshot=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.deepEqual(snapshot.save.state.cycle.protectedRegions,['東海']);assert.equal(row(h,p).save_json,before);
 });
 await scope('a won PvP siege retains every protected holding and uses the existing protected-base reward rules',async h=>win(async()=>{
  const a=await fixture(h,'制覇地域への攻め手'),d=await fixture(h,'東海の守り手',{home:'kiyosu',regions:['東海']});
  const body=attackBody(h,a,d,'nagoya'),departure=(await h.api('/field/attack',post(a,body))).data,battle=await settleFieldMarch(h,a,departure);
  assert.equal(battle.won,true);assert.equal(battle.battleMode,'reward');assert.equal(battle.capture.captured,false);assert.deepEqual(battle.defenderLost,{troops:0,garrison:0});assert.equal(battle.durability,undefined);assert(battle.loot.gold>0);
  const defended=save(h,d).state;for(const id of ids('東海'))assert.equal(defended.castles[id].owner,defended.clan,id);assert.equal(defended.home,'kiyosu');assert.deepEqual(defended.cycle.protectedRegions,['東海']);
  for(const key of ['gold','rice','wood','stone'])assert.equal(battle.loot[key],Math.floor((defended.resources[key]+battle.loot[key])/2),key+' is transferred from the defender');
  const attackerReceipt=row(h,a).save_json,defenderReceipt=row(h,d).save_json;
  for(let i=0;i<2;i++){
   const retry=(await h.api('/field/attack',post(a,body))).data;assert.equal(retry.idempotent,true);assert.equal(retry.battle.id,battle.id);assert.deepEqual(retry.battle.loot,battle.loot);
   await h.api('/marches?deviceId='+a.deviceId,{token:a.token});assert.equal(row(h,a).save_json,attackerReceipt,'retry cannot return surviving troops or credit loot again');assert.equal(row(h,d).save_json,defenderReceipt,'retry cannot debit protected-owner resources again');
  }
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM field_requests WHERE actor_id=? AND request_id=?').get(a.user.id,body.requestId).n,1);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM field_battles WHERE id=?').get(battle.id).n,1);
  h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=? WHERE id='world-v1'").run(CYCLE,h.now);
  await h.api('/sync/lease',post(d,{deviceId:d.deviceId}));const settled=(await h.api('/sync/settle',post(d,{deviceId:d.deviceId,revision:row(h,d).revision}))).data;
  assert.deepEqual(settled.save.state.cycle.protectedRegions,['東海']);for(const id of ids('東海'))assert.equal(settled.save.state.castles[id].owner,settled.save.state.clan,id);
 }));
 await scope('the final PvP capture establishes protection before another player can take the same castle',async h=>win(async()=>{
  const a=await fixture(h,'東海完成の攻め手',{holdings:ids('東海').filter(id=>id!=='nagoya')}),d=await fixture(h,'未制覇の名古屋領主',{home:'kiyosu',holdings:['nagoya']});assert.deepEqual(a.initial.save.state.cycle.protectedRegions,[]);
  const departure=(await h.api('/field/attack',post(a,attackBody(h,a,d,'nagoya')))).data,battle=await settleFieldMarch(h,a,departure);assert.equal(battle.won,true);assert.equal(battle.capture.captured,true);
  assert.deepEqual(save(h,a).state.cycle.protectedRegions,['東海']);
  const list=(await h.api('/field?limit=100',{token:d.token})).data,nagoya=list.targets.find(target=>target.playerId===a.user.id&&target.targetCastleId==='nagoya');assert.equal(nagoya.regionProtected,true);assert.equal(nagoya.battleMode,'reward');assert.equal(nagoya.capturable,false);
 }));
 await scope('a server-resolved campaign march records its final regional capture in the same save',async h=>{
  const p=await fixture(h,'九州最後の城へ進む領主',{home:'saga',holdings:ids('九州').filter(id=>id!=='shimabara'),prepare:s=>{s.castles.shimabara={owner:'在地衆',troops:10,wall:1,level:1};s.seed=1;}});
  const body={kind:'castle',targetId:'shimabara',troops:50000,tactic:'balanced',requestId:crypto.randomUUID(),campaignId:save(h,p).state.walking.campaignId,deviceId:p.deviceId,expectedRevision:row(h,p).revision};
  const departure=(await h.api('/marches/campaign',post(p,body))).data,battle=await settleFieldMarch(h,p,departure);assert.equal(battle.won,true);assert.deepEqual(save(h,p).state.cycle.protectedRegions,['九州']);
  const before=row(h,p).save_json,retry=(await h.api('/marches/campaign',post(p,body))).data;assert.equal(retry.idempotent,true);assert.deepEqual(retry.save.state.cycle.protectedRegions,['九州']);assert.equal(row(h,p).save_json,before);
 });
 await scope('arrival rechecks a conquest completed while the attacking army was travelling',async h=>win(async()=>{
  const a=await fixture(h,'到着時に確認する攻め手'),d=await fixture(h,'進軍中に東海制覇',{home:'kiyosu',holdings:ids('東海').filter(id=>id!=='sunpu')});
  const departure=(await h.api('/field/attack',post(a,attackBody(h,a,d,'nagoya')))).data;
  const canonical=save(h,d),game=GameEngine.fromSave(canonical,GAME_OFFICERS);game.state.castles.sunpu.owner=game.state.clan;game.recordRegionConquests();
  h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(game.exportSave({compact:true}),d.user.id);
  const battle=await settleFieldMarch(h,a,departure);assert.equal(battle.won,true);assert.equal(battle.battleMode,'reward');assert.equal(battle.capture.captured,false);assert.equal(save(h,d).state.castles.nagoya.owner,save(h,d).state.clan);
 }));
 await scope('deputy appointment, repeated role reconciliation and dismissal retain a protected former home exactly once',async h=>{
  const admin=await h.session('保護地域の任免担当');await h.api('/admin/claim',post(admin,{key:h.env.SENGOKU_ADMIN_KEY}));
  const p=await fixture(h,'保護地域のサブ運営',{home:'kiyosu',regions:['東海'],prepare:s=>{Object.assign(s.castles.kiyosu,{troops:321,wall:7,level:8});s.jobs=[{kind:'castle',id:'kiyosu',targetLevel:9,total:1,totalSeconds:60,remaining:1,remainingSeconds:50}];}}),campaign=save(h,p).state.walking.campaignId;
  const role=async action=>({targetPlayerId:p.user.id,action,requestId:crypto.randomUUID(),expectedRevision:(await h.api('/admin/deputy',{token:admin.token})).data.revision});
  const appointment=await role('appoint');await h.api('/admin/deputy',post(admin,appointment));const appointed=save(h,p).state;
  assert.equal(appointed.home,'kagoshima');assert.equal(appointed.walking.campaignId,campaign);assert.deepEqual(appointed.cycle.protectedRegions,['東海']);for(const id of ids('東海'))assert.equal(appointed.castles[id].owner,appointed.clan,id);
  assert.equal(appointed.castles.kiyosu.troops,0);assert.equal(appointed.castles.kagoshima.troops,321);assert.equal(appointed.castles.kiyosu.level,8);assert.deepEqual(appointed.jobs.map(job=>[job.id,job.targetLevel]),[['kiyosu',9]]);
  const appointedJson=row(h,p).save_json;assert.equal((await h.api('/admin/deputy',post(admin,appointment))).data.idempotent,true);
  for(let i=0;i<2;i++){const synced=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.deepEqual(synced.save.state.castles,appointed.castles);assert.equal(row(h,p).save_json,appointedJson);}
  const progress=save(h,p);Object.assign(progress.state.castles.kiyosu,{troops:123,level:9,wall:8});progress.state.jobs[0].targetLevel=10;Object.assign(progress.state.castles.kagoshima,{troops:300,level:10,wall:6});h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(progress),p.user.id);
  const dismissal=await role('dismiss');await h.api('/admin/deputy',post(admin,dismissal));const returned=save(h,p).state;assert.equal(returned.home,'kiyosu');assert.equal(returned.walking.campaignId,campaign);assert.deepEqual(returned.cycle.protectedRegions,['東海']);
  for(const id of ids('東海'))assert.equal(returned.castles[id].owner,returned.clan,id);assert.equal(returned.castles.kiyosu.troops,423);assert.equal(returned.castles.kiyosu.level,10);assert.equal(returned.castles.kiyosu.wall,8);assert.equal(returned.jobs.length,1);assert.equal(returned.jobs[0].id,'kiyosu');assert.equal(returned.jobs[0].targetLevel,11);
  const returnedJson=row(h,p).save_json;assert.equal((await h.api('/admin/deputy',post(admin,dismissal))).data.idempotent,true);
  for(let i=0;i<2;i++){const synced=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.deepEqual(synced.save.state.castles,returned.castles);assert.equal(row(h,p).save_json,returnedJson);}
 });
 await scope('released ownership and first-capture history cannot be restored or removed by a same-campaign save',async h=>{
  const p=await fixture(h,'返還記録を守る領主',{regions:['九州']}),body={requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,castleId:'funai',confirmed:true};
  await h.api('/field/release',post(p,body));const canonical=row(h,p).save_json;
  for(const mutate of [s=>delete s.cycle.releasedCastles,s=>s.cycle.releasedCastles=[],s=>s.cycle.releasedCastles.push('nijo'),s=>s.castles.funai.owner=s.clan,s=>s.captureRewards=s.captureRewards.filter(id=>id!=='funai')]){
   const incoming=save(h,p);mutate(incoming.state);const response=await put(h,p,incoming,409);assert.equal(response.data.error.code,'REGION_INHERITANCE_REQUIRED');assert.equal(row(h,p).save_json,canonical);
  }
  for(const invalid of [['__proto__'],['edo'],['funai','funai']]){const incoming=save(h,p);incoming.state.cycle.releasedCastles=invalid;await put(h,p,incoming,400);assert.equal(row(h,p).save_json,canonical);}
 });
 await scope('an actual PvP recapture clears only that released castle and restores its regional protection',async h=>win(async()=>{
  const a=await fixture(h,'返還城を再攻略する領主',{regions:['東海']}),d=await fixture(h,'返還城の相手領主',{home:'kiyosu',holdings:['nagoya']});
  for(const castleId of ['nagoya','sunpu'])await h.api('/field/release',post(a,{requestId:crypto.randomUUID(),deviceId:a.deviceId,expectedRevision:row(h,a).revision,castleId,confirmed:true}));
  const departure=(await h.api('/field/attack',post(a,attackBody(h,a,d,'nagoya')))).data,battle=await settleFieldMarch(h,a,departure);assert.equal(battle.won,true);assert.equal(battle.capture.captured,true);
  const state=save(h,a).state;assert.deepEqual(state.cycle.releasedCastles,['sunpu']);assert.deepEqual(state.cycle.protectedRegions,['東海']);assert.equal(state.castles.nagoya.owner,state.clan);assert.notEqual(state.castles.sunpu.owner,state.clan);
  const entry=(await h.api('/field?limit=100',{token:d.token})).data.targets.find(target=>target.playerId===a.user.id&&target.targetCastleId==='nagoya');assert.equal(entry.regionProtected,true);assert.equal(entry.battleMode,'reward');assert.equal(entry.capturable,false);
 }));
 console.log(JSON.stringify({ok:true,checks,calls}));
}finally{globalThis.fetch=originalFetch;}
