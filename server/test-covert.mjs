import assert from 'node:assert/strict';
import {harness,settleFieldMarch} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const save=(h,p)=>JSON.parse(row(h,p).save_json);
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
let checks=0,calls=0;
async function scope(name,fn){const h=harness();try{await fn(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function fixture(h,name,{admin=false,home='kiyosu',holdings=[],mutate=()=>{}}={}){
 const p=await h.session(name);p.deviceId='covert-device-'+p.user.id;
 if(admin)await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 const g=new GameEngine({officers:GAME_OFFICERS,seed:17,isAdmin:admin,startCastle:home}),value=JSON.parse(g.exportSave()),s=value.state;
 s.resources={gold:100000,rice:100000,wood:100000,stone:100000};s.troops=10000;s.buildings.keep=16;s.command=5;
 for(const id of holdings)s.castles[id].owner=s.clan;
 s.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};s.turn=Math.floor(lease.clock.elapsedMs/60000);s.realtime.elapsed=lease.clock.elapsedMs%60000/1000;mutate(s);
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save:value}});return p;
}
function body(h,p,extra={}){const r=row(h,p),s=JSON.parse(r.save_json).state;return{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:r.revision,campaignId:s.walking.campaignId,sequence:s.covert.sequence,...extra};}
async function align(h,p){
 const leased=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 if(leased.save.state.worldClock.elapsedMs===leased.clock.elapsedMs)return;
 const game=GameEngine.fromSave(leased.save,GAME_OFFICERS,{isAdmin:leased.user.isAdmin,isStaff:leased.user.isStaff,staffBase:leased.staffBase,maintenanceAuthority:leased.maintenanceAuthority});
 const advanced=game.applyWorldClock(leased.clock,{maxSeconds:86400,deferCycleSettlement:true});assert(advanced.ok&&!advanced.pending);
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:leased.revision,save:JSON.parse(game.exportSave())}});
}
// Independently advance a defender with the same trusted timing metadata;
// counterattack assertions compare the battle against this unchanged force.
async function advanceControl(h,p){
 const snapshot=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
 const g=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isAdmin:snapshot.user.isAdmin,isStaff:snapshot.user.isStaff,staffBase:snapshot.staffBase,maintenanceAuthority:snapshot.maintenanceAuthority,branchAuthority:{resolvedElapsedMs:snapshot.branchResolvedElapsedMs}});
 const result=g.applyWorldClock(snapshot.clock,{maxSeconds:86400,deferCycleSettlement:true});assert(result.ok&&!result.pending&&!result.settlementRequired);return JSON.parse(g.exportSave());
}
// Old clocks must fail without writes. Then test that even an inventory forged
// at the current confirmed clock cannot restore casualties or spent incidents.
async function importAtCurrentClock(h,p,imported){
 const current=save(h,p),before=row(h,p);
 if(imported.state.worldClock.elapsedMs<current.state.worldClock.elapsedMs){
  const denied=await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:before.revision,save:imported},expected:409});
  assert.equal(denied.data.error.code,'CLOCK_REWIND');assert.deepEqual(row(h,p),before);
 }
 const value=structuredClone(imported);value.state.worldClock=structuredClone(current.state.worldClock);value.state.turn=current.state.turn;value.state.realtime.elapsed=current.state.realtime.elapsed;
 return(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value}})).data;
}
async function finishDispatch(h,p,request,departure){
 assert.equal(departure.march.status,'marching');let current=departure;
 for(let leg=0;leg<2;leg++){
  h.now+=current.march.remainingMs;
  const settled=(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;
  await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
  const replay=(await h.api('/covert/dispatch',post(p,request))).data;assert(replay.idempotent);
  if(replay.march.status==='resolved'){assert.equal(settled.history.find(m=>m.id===departure.march.id)?.status,'resolved');return replay;}
  assert.equal(replay.march.phase,'returning');assert.equal(replay.march.status,'marching');current=replay;
 }
 assert.fail('The dispatched party did not finish its outward and return journey');
}
async function op(h,p,action,extra={},expected=200){
 const request=body(h,p,extra),response=(await h.api('/covert/'+action,post(p,request,expected))).data;
 return action==='dispatch'&&expected===200?finishDispatch(h,p,request,response):response;
}
async function incoming(h,attacker,defender,castleId='edo',{syncDefender=true}={}){
 await align(h,attacker);
 const departure=(await h.api('/field/attack',post(attacker,{targetPlayerId:defender.user.id,targetCastleId:castleId,troops:1000,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:attacker.deviceId,expectedRevision:row(h,attacker).revision}))).data;
 const battle=await settleFieldMarch(h,attacker,departure);if(syncDefender)await align(h,defender);return battle;
}
async function armed(h,source,target={kind:'castle',castleId:'uchijo'}){
 await op(h,source,'hire',{sourceCastleId:'edo',count:400});
 return(await op(h,source,'dispatch',{sourceCastleId:'edo',target,count:300,mode:'station'})).result.stationId;
}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Covert tests must not use a real network');};
try{
 await scope('hire pays exact costs once, validates rights/capacity and returns all129 NPC plus shared bases',async h=>{
  const p=await fixture(h,'派遣元',{admin:true}),other=await fixture(h,'共有の領主',{holdings:['nijo','osaka','nagoya']}),before=save(h,p),request=body(h,p,{sourceCastleId:'edo',count:400});
  const r=(await h.api('/covert/hire',post(p,request))).data,after=save(h,p);
  assert.equal(r.result.goldCost,1200);assert.equal(r.result.foodCost,800);assert.equal(after.state.command,before.state.command-1);assert.equal(after.state.resources.gold,before.state.resources.gold-1200);assert.equal(after.state.resources.rice,before.state.resources.rice-800);assert.equal(after.state.covert.reserves.edo,400);assert.equal(r.covert.sources[0].unitType,'ninja');assert.equal(r.covert.targets.filter(t=>t.kind==='castle').length,129);assert.equal(r.covert.targets.filter(t=>t.kind==='player'&&t.playerId===other.user.id).length,4);assert.equal(count(h,'covert_requests'),1);
  const stored=row(h,p).save_json,again=(await h.api('/covert/hire',post(p,request))).data;assert(again.idempotent);assert.deepEqual(again.result,r.result);assert.equal(row(h,p).save_json,stored);
  await h.api('/covert/hire',post(p,{...request,count:401},409));assert.equal(count(h,'covert_requests'),1);
  await op(h,other,'hire',{sourceCastleId:'edo',count:1},409);const ordinary=await op(h,other,'hire',{sourceCastleId:'nijo',count:100});assert.equal(ordinary.result.goldCost,100);assert.equal(ordinary.covert.sources.find(s=>s.castleId==='nijo').unitType,'ashigaru');
  await op(h,p,'hire',{sourceCastleId:'edo',count:20000},409);
  for(const bad of [0,1.5,'1',20001])await op(h,p,'hire',{sourceCastleId:'edo',count:bad},400);
  await h.api('/covert',{expected:401});await h.api('/covert/hire',{method:'POST',body:request,expected:401});
 });
 await scope('spying is private read-only game intelligence with no adjacency or target notifications',async h=>{
  const p=await fixture(h,'偵察元',{admin:true}),d=await fixture(h,'偵察先');await op(h,p,'hire',{sourceCastleId:'edo',count:200});
  const targetSave=row(h,d).save_json,targetRevision=row(h,d).revision,mailCount=count(h,'mail_campaigns');
  const r=await op(h,p,'dispatch',{sourceCastleId:'edo',count:20,mode:'scout',target:{kind:'player',playerId:d.user.id,castleId:'kiyosu'}});
  assert.equal(r.result.foodCost,24);assert.equal(r.covert.reports.length,1);assert.equal(r.covert.sources[0].reserve,200);assert.deepEqual(r.result.report.snapshot.resources,save(h,d).state.resources);assert.equal(r.result.report.snapshot.army.count,3);
  const text=JSON.stringify(r.covert);for(const key of ['token_hash','is_admin','isAdmin','isStaff','staff_term','deviceId','writerDeviceId'])assert(!text.includes(key),key);assert.equal(row(h,d).save_json,targetSave);assert.equal(row(h,d).revision,targetRevision);assert.equal(count(h,'mail_campaigns'),mailCount);
  assert.equal((await h.api('/covert',{token:d.token})).data.covert.reports.length,0);
  const distant=await op(h,p,'dispatch',{sourceCastleId:'edo',count:1,mode:'scout',target:{kind:'castle',castleId:'uchijo'}});assert.equal(distant.result.report.target.castleId,'uchijo');const scoutedUntil=Math.floor(distant.result.report.observedElapsedMs/60000)+3;assert.equal(distant.save.state.scouted.uchijo,scoutedUntil>distant.save.state.turn?scoutedUntil:undefined);
  await op(h,p,'dispatch',{sourceCastleId:'edo',count:1,mode:'scout',target:{kind:'player',playerId:p.user.id,castleId:'edo'}},400);
  await op(h,p,'dispatch',{sourceCastleId:'edo',count:1,mode:'scout',target:{kind:'player',playerId:d.user.id,castleId:'kiyosu',isAdmin:true}},400);
 });
 await scope('station and recall persist survivor inventory with free recall and durable replay',async h=>{
  const p=await fixture(h,'常駐元',{admin:true}),id=await armed(h,p),station=save(h,p).state.covert.stations[0];assert.equal(station.id,id);assert.equal(station.count,300);assert.equal(save(h,p).state.covert.reserves.edo,100);
  const before=save(h,p),request=body(h,p,{stationId:id}),r=(await h.api('/covert/recall',post(p,request))).data;
  assert.equal(r.result.count,300);assert.equal(r.save.state.command,before.state.command);assert.deepEqual(r.save.state.resources,before.state.resources);assert(r.accepted&&r.marching);assert.equal(r.march.phase,'returning');assert.equal(r.save.state.covert.reserves.edo,100);assert.equal(r.save.state.covert.stations.length,0);
  const stored=row(h,p).save_json;assert.equal((await h.api('/covert/recall',post(p,request))).data.idempotent,true);assert.equal(row(h,p).save_json,stored);await op(h,p,'recall',{stationId:id},409);h.now+=r.march.remainingMs;const arrived=(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;assert.equal(arrived.save.state.covert.reserves.edo,400);assert.equal(arrived.save.state.covert.dispatches.length,0);const done=(await h.api('/covert/recall',post(p,request))).data;assert(done.idempotent);assert.equal(done.march.status,'resolved');
 });
 await scope('real incoming attack enables one stationed NPC retaliation without capturing or minting rewards',async h=>{
  const p=await fixture(h,'被攻撃元',{admin:true}),a=await fixture(h,'襲撃元',{home:'kawagoe'}),stationId=await armed(h,p);let status=(await h.api('/covert',{token:p.token})).data;assert.equal(status.covert.incidents.length,0);
  await op(h,p,'retaliate',{stationId,incidentId:'fake-attack'},409);
  const hit=await incoming(h,a,p);status=(await h.api('/covert',{token:p.token})).data;assert.equal(status.covert.incidents.length,1);assert.equal(status.covert.incidents[0].id,hit.id);assert(status.covert.incidents[0].available);assert.deepEqual(status.covert.incidents[0].stationIds,[stationId]);
  const before=save(h,p),request=body(h,p,{stationId,incidentId:hit.id}),r=(await h.api('/covert/retaliate',post(p,request))).data,b=r.result.battle,after=save(h,p);
  assert.equal(b.captured,false);assert(b.ourLost>0);assert.equal(after.state.covert.stations[0].count,300-b.ourLost);assert.equal(after.state.castles.uchijo.owner,before.state.castles.uchijo.owner);assert.equal(after.state.castles.uchijo.troops,before.state.castles.uchijo.troops-b.defenderLost.garrison);assert.equal(after.state.resources.gold,before.state.resources.gold);assert.equal(after.state.resources.rice,before.state.resources.rice-r.result.foodCost);assert.equal(after.state.command,before.state.command-1);assert.equal(r.covert.incidents.length,0);
  const stored=row(h,p).save_json;assert.equal((await h.api('/covert/retaliate',post(p,request))).data.idempotent,true);assert.equal(row(h,p).save_json,stored);await op(h,p,'retaliate',{stationId,incidentId:hit.id},409);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM covert_requests WHERE incident_id=?').get(hit.id).n,1);
 });
 await scope('preexisting attacks, mismatched sources and forged imported incidents never authorize a counter',async h=>{
  const p=await fixture(h,'常駐前の領主',{admin:true}),a=await fixture(h,'早い襲撃元'),hit=await incoming(h,a,p),stationId=await armed(h,p);
  assert.equal((await h.api('/covert',{token:p.token})).data.covert.incidents.length,0);await op(h,p,'retaliate',{stationId,incidentId:hit.id},409);
  const imported=save(h,p);imported.state.covert={version:999,reserves:{edo:999999999},incidents:[{id:'fake'}],reports:[{token:'private'}]};
  const r=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:imported}})).data;
  assert.equal(r.save.state.covert.reserves.edo,100);assert.equal(r.save.state.covert.stations[0].id,stationId);assert(!JSON.stringify(r.save.state.covert).includes('private'));await op(h,p,'retaliate',{stationId,incidentId:'fake'},409);
 });
 await scope('player counter atomically applies bounded casualties and one generic private notification',async h=>{
  const p=await fixture(h,'反撃元',{admin:true}),a=await fixture(h,'実襲撃元',{home:'kawagoe'}),d=await fixture(h,'常駐先');const stationId=await armed(h,p,{kind:'player',playerId:d.user.id,castleId:'kiyosu'}),hit=await incoming(h,a,p),beforeD=await advanceControl(h,d),beforeP=save(h,p),mailBefore=count(h,'mail_campaigns');
  const request=body(h,p,{stationId,incidentId:hit.id}),r=(await h.api('/covert/retaliate',post(p,request))).data,b=r.result.battle,afterD=save(h,d);
  assert(b.durability.damage>0);assert.deepEqual(afterD.state.castles.kiyosu.durability,b.durability.record);assert.deepEqual(save(h,p).state.covert.history.find(entry=>entry.requestId===request.requestId).battle.durability,b.durability);assert.deepEqual(r.covert.history.find(entry=>entry.requestId===request.requestId).battle.durability,b.durability);
  assert.equal(afterD.state.worldClock.elapsedMs,beforeD.state.worldClock.elapsedMs);assert.equal(afterD.state.troops,beforeD.state.troops-b.defenderLost.troops);assert.equal(afterD.state.castles.kiyosu.troops,beforeD.state.castles.kiyosu.troops-b.defenderLost.garrison);assert(b.defenderLost.troops<=Math.floor(beforeD.state.troops*.1));assert(b.defenderLost.garrison<=Math.floor(beforeD.state.castles.kiyosu.troops*.1));for(const key of ['gold','rice','wood','stone'])assert.equal(afterD.state.resources[key],beforeD.state.resources[key]-b.loot[key]);assert.equal(b.lootPolicy,'half-resources-v1');assert.deepEqual(r.covert.history.find(entry=>entry.requestId===request.requestId).battle.loot,b.loot);assert.equal(afterD.state.castles.kiyosu.owner,beforeD.state.castles.kiyosu.owner);assert.equal(count(h,'mail_campaigns'),mailBefore+1);assert.equal(count(h,'covert_battles'),1);
  const mail=h.sql.prepare('SELECT * FROM mail_campaigns WHERE target_user_id=? ORDER BY rowid DESC LIMIT 1').get(d.user.id);for(const term of ['運営','忍者','スタッフ','偵察','常駐','反撃','incident'])assert(!mail.body.includes(term));assert.equal(mail.gift_json,null);
  const delivered=(await h.api('/mail',{token:d.token})).data.mail.find(v=>v.id===mail.id);assert.equal(delivered.source,'system');assert.equal(delivered.event.kind,'field-battle');assert.deepEqual(delivered.participants,[]);
  assert.doesNotMatch(delivered.body,/領有|占領/);
  const legacyBody=mail.body+'拠点の領有は継続しています。';h.sql.prepare('UPDATE mail_campaigns SET body=? WHERE id=?').run(legacyBody,mail.id);
  const legacyNotice=(await h.api('/mail',{token:d.token})).data.mail.find(v=>v.id===mail.id);assert.equal(legacyNotice.body,mail.body);assert.deepEqual(legacyNotice.participants,[]);assert.equal(legacyNotice.gift,null);assert.equal(h.sql.prepare('SELECT body FROM mail_campaigns WHERE id=?').get(mail.id).body,legacyBody);

  const stored=row(h,d).save_json;await h.api('/covert/retaliate',post(p,request));assert.equal(row(h,d).save_json,stored);assert.equal(count(h,'covert_battles'),1);assert.equal(count(h,'mail_campaigns'),mailBefore+1);
  assert.equal(save(h,p).state.covert.stations[0].count,beforeP.state.covert.stations[0].count-b.ourLost);
  const third=await fixture(h,'保護検証',{home:'inuyama'});const denied=await h.api('/field/attack',post(third,{targetPlayerId:d.user.id,targetCastleId:'kiyosu',troops:1000,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:third.deviceId,expectedRevision:row(h,third).revision},409));assert.equal(denied.data.error.code,'TARGET_PROTECTED');
 });
 await scope('Edo and Kyoto retain ownership and troops while actual counterattack loot is debited',async h=>{
  const opPlayer=await fixture(h,'江戸防衛',{admin:true}),staff=await fixture(h,'京都御所防衛'),attacker=await fixture(h,'反撃側',{home:'akutagawa',holdings:['nijo']}),raider=await fixture(h,'機会作成',{home:'kawagoe'});
  await h.api('/admin/staff',post(opPlayer,{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}));await h.api('/sync?deviceId='+staff.deviceId,{token:staff.token});
  await op(h,attacker,'hire',{sourceCastleId:'nijo',count:300});
  const station=(await op(h,attacker,'dispatch',{sourceCastleId:'nijo',target:{kind:'player',playerId:opPlayer.user.id,castleId:'edo'},count:100,mode:'station'})).result.stationId;
  // Force a defender victory so the ordinary source stays owned.
  const original=crypto.getRandomValues;crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(0xffffffff):original.call(crypto,array);};let hit;try{hit=await incoming(h,raider,attacker,'nijo');}finally{crypto.getRandomValues=original;}
  const before=await advanceControl(h,opPlayer),revision=row(h,opPlayer).revision,r=await op(h,attacker,'retaliate',{stationId:station,incidentId:hit.id});assert.deepEqual(r.result.battle.defenderLost,{troops:0,garrison:0});assert.equal(r.result.battle.durability,undefined);assert.deepEqual(save(h,opPlayer).state.castles,before.state.castles);for(const key of ['gold','rice','wood','stone'])assert.equal(save(h,opPlayer).state.resources[key],before.state.resources[key]-r.result.battle.loot[key]);assert.equal(row(h,opPlayer).revision,revision+1);
  // The same invariant is exercised directly against the current staff source.
  const remaining=save(h,attacker);remaining.state.command=5;h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(remaining),attacker.user.id);
  const other=(await op(h,attacker,'dispatch',{sourceCastleId:'nijo',target:{kind:'player',playerId:staff.user.id,castleId:'kyoto_gosho'},count:100,mode:'station'})).result.stationId;
  const clock=h.sql.prepare('SELECT * FROM world_clock').get();h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=base_elapsed_ms+60000,revision=revision+1').run();
  for(const p of [attacker,raider]){const v=save(h,p);v.state.turn++;v.state.worldClock.elapsedMs+=60000;v.state.command=5;h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(v),p.user.id);}
  crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(0xffffffff):original.call(crypto,array);};try{hit=await incoming(h,raider,attacker,'nijo');}finally{crypto.getRandomValues=original;}
  const staffBefore=await advanceControl(h,staff),staffRevision=row(h,staff).revision,sharedBefore=h.sql.prepare("SELECT state_json FROM staff_base WHERE id='kyoto_gosho'").get().state_json;
  const counter=await op(h,attacker,'retaliate',{stationId:other,incidentId:hit.id});assert.deepEqual(counter.result.battle.defenderLost,{troops:0,garrison:0});assert.equal(counter.result.battle.durability,undefined);assert.deepEqual(save(h,staff).state.castles,staffBefore.state.castles);for(const key of ['gold','rice','wood','stone'])assert.equal(save(h,staff).state.resources[key],staffBefore.state.resources[key]-counter.result.battle.loot[key]);assert.equal(row(h,staff).revision,staffRevision+1);assert.equal(h.sql.prepare("SELECT state_json FROM staff_base WHERE id='kyoto_gosho'").get().state_json,sharedBefore);
 });
 await scope('concurrent requests spend one inventory sequence and one incoming opportunity only',async h=>{
  const p=await fixture(h,'同時指示',{admin:true}),a=await fixture(h,'同時襲撃',{home:'kawagoe'}),d=await fixture(h,'同時反撃先'),stationId=await armed(h,p,{kind:'player',playerId:d.user.id,castleId:'kiyosu'}),hit=await incoming(h,a,p),one=body(h,p,{stationId,incidentId:hit.id}),two={...one,requestId:crypto.randomUUID()};
  let entered=0,release;const barrier=new Promise(r=>release=r);h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO covert_requests'))return;if(++entered===2){h.beforeBatch=null;release();}await barrier;};
  const results=await Promise.all([h.api('/covert/retaliate',post(p,one,null)),h.api('/covert/retaliate',post(p,two,null))]);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);assert.equal(count(h,'covert_battles'),1);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM covert_requests WHERE incident_id=?').get(hit.id).n,1);
 });
 await scope('role, target revision, world clock and writer races reject all mission effects',async h=>{
  const p=await fixture(h,'権限競合',{admin:true}),d=await fixture(h,'読み取り対象');await op(h,p,'hire',{sourceCastleId:'edo',count:100});
  for(const kind of ['target','clock','writer','role']){
   const before=row(h,p).save_json,receipts=count(h,'covert_requests');h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO covert_requests'))return;h.beforeBatch=null;if(kind==='target')h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(d.user.id);if(kind==='clock')h.sql.exec('UPDATE world_clock SET revision=revision+1');if(kind==='writer')h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run('changed',p.user.id);if(kind==='role')h.sql.exec("DELETE FROM settings WHERE key='adminUserId'");};
   await op(h,p,'dispatch',{sourceCastleId:'edo',count:1,mode:'scout',target:{kind:'player',playerId:d.user.id,castleId:'kiyosu'}},409);assert.equal(count(h,'covert_requests'),receipts);assert.equal(row(h,p).save_json,before);
   if(kind==='writer')h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run(p.deviceId,p.user.id);
  }
 });
 await scope('database failure rolls back actor inventory, defender casualties, mail and receipt together',async h=>{
  const p=await fixture(h,'原子性',{admin:true}),a=await fixture(h,'契機',{home:'kawagoe'}),d=await fixture(h,'防衛先'),stationId=await armed(h,p,{kind:'player',playerId:d.user.id,castleId:'kiyosu'}),hit=await incoming(h,a,p),request=body(h,p,{stationId,incidentId:hit.id}),beforeP=row(h,p).save_json,beforeD=row(h,d).save_json,mails=count(h,'mail_campaigns'),receipts=count(h,'covert_requests');
  h.beforeBatch=statements=>{if(statements[0]?.sql.includes('INSERT INTO covert_requests')){h.beforeBatch=null;statements.push(h.db.prepare('UPDATE nonexistent_covert_fixture SET value=1'));}};
  await h.api('/covert/retaliate',post(p,request,500));assert.equal(row(h,p).save_json,beforeP);assert.equal(row(h,d).save_json,beforeD);assert.equal(count(h,'mail_campaigns'),mails);assert.equal(count(h,'covert_requests'),receipts);assert.equal(count(h,'covert_battles'),0);
  assert.equal((await h.api('/covert/retaliate',post(p,request))).data.idempotent,false);
 });
 await scope('stale same-campaign imports preserve canonical casualties/reports and fresh campaigns cannot clone units',async h=>{
  const p=await fixture(h,'保存保護',{admin:true}),old=save(h,p),a=await fixture(h,'保存襲撃',{home:'kawagoe'}),stationId=await armed(h,p),hit=await incoming(h,a,p);await op(h,p,'retaliate',{stationId,incidentId:hit.id});const canonical=structuredClone(save(h,p).state.covert);
  for(const imported of [old,{...old,state:{...old.state,covert:{reserves:{edo:999999},sequence:0}}}]){
   const r=await importAtCurrentClock(h,p,imported);assert.deepEqual(r.save.state.covert,canonical);await op(h,p,'retaliate',{stationId,incidentId:hit.id},409);
  }
  const fresh=save(h,p);fresh.state.walking.campaignId='fresh-covert-campaign';delete fresh.state.roaming;const r=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:fresh}})).data;assert.equal(r.save.state.covert.sequence,0);assert.equal(r.save.state.covert.reserves.edo,0);assert.deepEqual(r.save.state.covert.stations,[]);assert.deepEqual(r.save.state.covert.reports,[]);
  const returned=await importAtCurrentClock(h,p,old);assert.deepEqual(returned.save.state.covert,canonical);
 });
 await scope('paginated targets expose every registered base and no public role or private reports',async h=>{
  const p=await fixture(h,'頁の主',{admin:true}),one=await fixture(h,'頁一'),two=await fixture(h,'頁二',{home:'inuyama',holdings:['nijo']});
  const all=[];let cursor=null;do{const r=(await h.api('/covert?limit=1'+(cursor?'&cursor='+cursor:''),{token:p.token})).data;all.push(...r.covert.targets.filter(t=>t.kind==='player'));cursor=r.covert.targetCursor;}while(cursor);
  assert(all.some(t=>t.playerId===one.user.id));assert(all.some(t=>t.playerId===two.user.id&&t.castleId==='nijo'));assert(all.every(t=>!('isAdmin'in t)&&!('isStaff'in t)&&!('resources'in t)));
 });
 await scope('an incoming attack committed during station preparation cannot authorize that new station',async h=>{
  const p=await fixture(h,'順序検証',{admin:true}),a=await fixture(h,'割込み襲撃',{home:'kawagoe'});await op(h,p,'hire',{sourceCastleId:'edo',count:100});const request=body(h,p,{sourceCastleId:'edo',count:50,mode:'station',target:{kind:'castle',castleId:'uchijo'}});let hit,afterIncoming;
  h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO covert_requests'))return;h.beforeBatch=null;hit=await incoming(h,a,p,'edo',{syncDefender:false});afterIncoming=row(h,p);};
  await h.api('/covert/dispatch',post(p,request,409));assert.deepEqual(row(h,p),afterIncoming,'rejected station cannot overwrite the concurrent battle transfer');assert.equal(count(h,'covert_requests'),1);assert.equal(save(h,p).state.covert.stations.length,0);
  await align(h,p);const retried={...request,expectedRevision:row(h,p).revision};const done=await finishDispatch(h,p,retried,(await h.api('/covert/dispatch',post(p,retried))).data);assert.equal(done.covert.incidents.length,0);await op(h,p,'retaliate',{stationId:done.result.stationId,incidentId:hit.id},409);
 });
 await scope('an attack on a different active campaign cannot unlock an older imported campaign station',async h=>{
  const p=await fixture(h,'物語の境界',{admin:true}),a=await fixture(h,'境界襲撃',{home:'kawagoe'}),stationId=await armed(h,p),original=save(h,p),fresh=structuredClone(original);fresh.state.walking.campaignId='campaign-during-attack';delete fresh.state.roaming;
  await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:fresh}});const hit=await incoming(h,a,p);
  assert.equal(h.sql.prepare('SELECT defender_campaign_id FROM field_battles WHERE id=?').get(hit.id).defender_campaign_id,'campaign-during-attack');
  await importAtCurrentClock(h,p,original);assert.equal((await h.api('/covert',{token:p.token})).data.covert.incidents.length,0);await op(h,p,'retaliate',{stationId,incidentId:hit.id},409);
 });
 await scope('real server-advanced CPU invasions issue immutable opportunities; late stations and old saves cannot reuse them',async h=>{
  const p=await fixture(h,'確定CPU侵攻',{admin:true}),stationId=await armed(h,p);let initial=save(h,p);for(const [id,c]of Object.entries(initial.state.castles))if(id!=='edo')c.owner='在地衆';initial.state.difficulty='hard';
  h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(initial),p.user.id);
  h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(672*60000,h.now);
  const settled=(await h.api('/sync/settle',post(p,{deviceId:p.deviceId,revision:row(h,p).revision}))).data;
  assert.equal(settled.save.state.cycle.index,1);assert(count(h,'covert_incidents')>0);
  const current=(await h.api('/covert',{token:p.token})).data,incident=current.covert.incidents.find(v=>v.kind==='cpu');assert(incident?.available);assert(incident.stationIds.includes(stationId));assert.equal(incident.sourceCastleId,'edo');
  const historical=save(h,p),later=(await op(h,p,'dispatch',{sourceCastleId:'edo',count:50,mode:'station',target:{kind:'castle',castleId:'uchijo'}})).result.stationId;
  await op(h,p,'retaliate',{stationId:later,incidentId:incident.id},409);const r=await op(h,p,'retaliate',{stationId,incidentId:incident.id});assert(r.result.battle);const canonical=structuredClone(save(h,p).state.covert);
  await importAtCurrentClock(h,p,historical);assert.deepEqual(save(h,p).state.covert,canonical);await op(h,p,'retaliate',{stationId,incidentId:incident.id},409);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM covert_requests WHERE incident_id=?').get(incident.id).n,1);
  // Copying the real-looking incident to a new campaign still cannot authorize it.
  const different=save(h,p);different.state.walking.campaignId='cpu-other-campaign';delete different.state.roaming;await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:different}});assert.equal((await h.api('/covert',{token:p.token})).data.covert.incidents.length,0);
 });
 await scope('failed authoritative CPU advance rolls every generated incident back with the save',async h=>{
  const p=await fixture(h,'CPU原子性',{admin:true});await armed(h,p);let initial=save(h,p);for(const [id,c]of Object.entries(initial.state.castles))if(id!=='edo')c.owner='在地衆';initial.state.difficulty='hard';h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(initial),p.user.id);
  h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(672*60000,h.now);const before=row(h,p).save_json;
  h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO covert_incidents'))){h.beforeBatch=null;statements.push(h.db.prepare('UPDATE invalid_cpu_commit_fixture SET value=1'));}};
  await h.api('/sync/settle',post(p,{deviceId:p.deviceId,revision:row(h,p).revision},500));assert.equal(row(h,p).save_json,before);assert.equal(count(h,'covert_incidents'),0);assert.equal(count(h,'cycle_receipts'),0);
  await h.api('/sync/settle',post(p,{deviceId:p.deviceId,revision:row(h,p).revision}));assert(count(h,'covert_incidents')>0);
 });
 console.log(checks+' covert transaction scenarios passed ('+calls+' local API requests).');
}finally{globalThis.fetch=originalFetch;}
