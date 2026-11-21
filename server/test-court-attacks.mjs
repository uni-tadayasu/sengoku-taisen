import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,count,appoint,updateSave} from './test-court-support.mjs';

const attackBody=(h,actor,target,castleId='edo')=>({requestId:crypto.randomUUID(),targetPlayerId:target.user.id,targetCastleId:castleId,troops:1000,tactic:'balanced',deviceId:actor.deviceId,expectedRevision:row(h,actor).revision});
const attack=(h,actor,body,expected=200)=>h.api('/field/attack',post(actor,body,expected));
const covertBody=(h,actor,extra)=>({requestId:crypto.randomUUID(),deviceId:actor.deviceId,expectedRevision:row(h,actor).revision,campaignId:save(h,actor).state.walking.campaignId,sequence:save(h,actor).state.covert.sequence,...extra});
const covert=(h,actor,action,extra,expected=200)=>h.api('/covert/'+action,post(actor,covertBody(h,actor,extra),expected));
const effectTables=['player_saves','staff_base','field_requests','field_battles','mail_campaigns','covert_requests','covert_states','covert_battles'];
const effects=h=>Object.fromEntries(effectTables.map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all()]));
async function force(won,run){const old=crypto.getRandomValues;crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(won?0:0xffffffff):old.call(crypto,value);};try{return await run();}finally{crypto.getRandomValues=old;}}
async function provision(h,{source='kyoto_gosho',targetKind='player'}={}){
 const admin=await fixture(h,'江戸城の領主',{admin:true}),staff=await fixture(h,'京都御所の担当',{staff:true,holdings:source==='nijo'?['nijo']:[]}),raider=await fixture(h,'契機を作る領主');
 await covert(h,staff,'hire',{sourceCastleId:source,count:400});const target=targetKind==='player'?{kind:'player',playerId:admin.user.id,castleId:'edo'}:{kind:'castle',castleId:'edo'};
 const stationed=(await covert(h,staff,'dispatch',{sourceCastleId:source,target,count:200,mode:'station'})).data;
 const incoming=(await force(false,()=>attack(h,raider,attackBody(h,raider,staff,source)))).data;
 return{admin,staff,raider,stationId:stationed.result.stationId,incidentId:incoming.battle.id};
}
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Attack tests must not contact a real service');};
try{
 await scope('Kyoto field departures need current Emperor authority and expose only the actor capability',async h=>{
  const admin=await fixture(h,'江戸の運営',{admin:true}),staff=await fixture(h,'通常の御所担当',{staff:true}),ordinary=await fixture(h,'通常の本拠');
  const own=(await h.api('/field/me?deviceId='+staff.deviceId,{token:staff.token})).data;assert.equal(own.self.homeCastleId,'kyoto_gosho');assert.equal(own.attack.canAttackEdoFromKyoto,false);
  const field=(await h.api('/field',{token:staff.token})).data,edo=field.targets.find(target=>target.playerId===admin.user.id&&target.targetCastleId==='edo');assert.equal(edo.attackable,false);assert.match(edo.attackReason,/天皇/);
  for(const target of field.targets)for(const key of ['isAdmin','isStaff','isCourtEmperor','leaderId'])assert.equal(Object.hasOwn(target,key),false);
  const before=effects(h),blocked=await attack(h,staff,attackBody(h,staff,admin),403);assert.equal(blocked.data.error.code,'COURT_EDO_ATTACK_REQUIRED');assert.deepEqual(effects(h),before);
  await attack(h,staff,{...attackBody(h,staff,admin),sourceCastleId:'nijo',isCourtEmperor:true},400);assert.deepEqual(effects(h),before);
  const ordinaryResult=(await attack(h,ordinary,attackBody(h,ordinary,admin))).data;assert.equal(ordinaryResult.battle.battleMode,'reward');assert.equal(ordinaryResult.battle.capture.captured,false);
 });
 await scope('an appointed Emperor can duel Edo without changing its owner or assets and replay cannot attack twice',async h=>{
  const admin=await fixture(h,'決闘の江戸',{admin:true}),staff=await fixture(h,'任命済みの天皇',{staff:true});await appoint(h,staff);
  const capability=(await h.api('/field/me?deviceId='+staff.deviceId,{token:staff.token})).data;assert.equal(capability.attack.canAttackEdoFromKyoto,true);const target=(await h.api('/field',{token:staff.token})).data.targets.find(t=>t.playerId===admin.user.id&&t.targetCastleId==='edo');assert.equal(target.attackable,true);
  const before=row(h,admin),palace=h.sql.prepare('SELECT * FROM staff_base').get(),body=attackBody(h,staff,admin),result=(await force(true,()=>attack(h,staff,body))).data;
  assert.equal(result.battle.won,true);assert.equal(result.battle.battleMode,'reward');assert.equal(result.battle.capture.captured,false);assert.deepEqual(result.battle.defenderLost,{troops:0,garrison:0});assert.deepEqual(row(h,admin),before);assert.deepEqual(h.sql.prepare('SELECT * FROM staff_base').get(),palace);assert.equal(save(h,staff).state.home,'kyoto_gosho');assert.notEqual(save(h,staff).state.castles.edo.owner,save(h,staff).state.clan);
  await appoint(h,null);const committed=effects(h),replay=(await attack(h,staff,body)).data;assert.equal(replay.idempotent,true);assert.equal(replay.battle.id,result.battle.id);assert.deepEqual(effects(h),committed);assert.equal(count(h,'field_battles'),1);
 });
 await scope('field commit rejects revoke, replacement appointment, new staff term, and ban epoch without spending assets',async h=>{
  const admin=await fixture(h,'競合時の江戸',{admin:true}),staff=await fixture(h,'競合する天皇',{staff:true});
  const changes=[
   ()=>h.sql.exec('DELETE FROM court_leader'),
   ()=>h.sql.prepare('UPDATE court_leader SET appointment_token=?').run(crypto.randomUUID()),
   ()=>h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run(crypto.randomUUID(),staff.user.id),
   ()=>h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,0,1,?,?)').run(staff.user.id,admin.user.id,h.now),
  ];
  for(const change of changes){await appoint(h,staff);await h.api('/sync?deviceId='+staff.deviceId,{token:staff.token});const before=effects(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO field_requests')))return;h.beforeBatch=null;change();};const response=await attack(h,staff,attackBody(h,staff,admin),null);assert.equal(response.response.status,409);assert.deepEqual(effects(h),before);}
  assert.equal(count(h,'field_battles'),0);assert.equal(count(h,'field_requests'),0);
 });
 await scope('Kyoto scouts and stationed units remain available while only the current Emperor can retaliate at Edo',async h=>{
  const{admin,staff,stationId,incidentId}=await provision(h);const status=(await h.api('/covert',{token:staff.token})).data;assert.equal(status.covert.rules.canAttackEdoFromKyoto,false);assert(status.covert.incidents.some(v=>v.id===incidentId));
  const before=effects(h),blocked=await covert(h,staff,'retaliate',{stationId,incidentId},403);assert.equal(blocked.data.error.code,'COURT_EDO_ATTACK_REQUIRED');assert.deepEqual(effects(h),before);
  const spy=await covert(h,staff,'dispatch',{sourceCastleId:'kyoto_gosho',target:{kind:'player',playerId:admin.user.id,castleId:'edo'},count:1,mode:'scout'});assert.equal(spy.data.result.report.target.castleId,'edo');
  updateSave(h,staff,s=>{s.command=3;});await appoint(h,staff);assert.equal((await h.api('/covert',{token:staff.token})).data.covert.rules.canAttackEdoFromKyoto,true);
  const targetBefore=row(h,admin),body=covertBody(h,staff,{stationId,incidentId}),result=(await h.api('/covert/retaliate',post(staff,body))).data;assert(result.result.battle);assert.deepEqual(result.result.battle.defenderLost,{troops:0,garrison:0});assert.deepEqual(row(h,admin),targetBefore);assert.equal(count(h,'covert_battles'),1);
  await appoint(h,null);const after=effects(h),replay=(await h.api('/covert/retaliate',post(staff,body))).data;assert.equal(replay.idempotent,true);assert.deepEqual(effects(h),after);
 });
 await scope('a delayed stationed retaliation rechecks the latest appointment and binds it again at commit',async h=>{
  const{staff,stationId,incidentId}=await provision(h);await appoint(h,staff);await appoint(h,null);
  await covert(h,staff,'retaliate',{stationId,incidentId},403);assert.equal(count(h,'covert_battles'),0);
  for(const remove of [()=>h.sql.exec('DELETE FROM court_leader'),()=>h.sql.prepare('UPDATE court_leader SET appointment_token=?').run(crypto.randomUUID())]){
   await appoint(h,staff);const before=effects(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO covert_requests')))return;h.beforeBatch=null;remove();};await covert(h,staff,'retaliate',{stationId,incidentId},409);assert.deepEqual(effects(h),before);
  }
  await appoint(h,staff);const result=await covert(h,staff,'retaliate',{stationId,incidentId});assert(result.data.result.battle);assert.equal(count(h,'covert_battles'),1);
 });
 await scope('NPC Edo uses the same Kyoto origin gate while another owned source remains unaffected',async h=>{
  const{staff,stationId,incidentId}=await provision(h,{targetKind:'castle'});const before=effects(h);await covert(h,staff,'retaliate',{stationId,incidentId},403);assert.deepEqual(effects(h),before);await appoint(h,staff);const result=await covert(h,staff,'retaliate',{stationId,incidentId});assert.equal(result.data.result.battle.captured,false);
 });
 await scope('staff dispatch from Nijo can retaliate at Edo without an Emperor appointment',async h=>{
  const{admin,staff,stationId,incidentId}=await provision(h,{source:'nijo'});assert.equal(count(h,'court_leader'),0);const before=row(h,admin),result=(await covert(h,staff,'retaliate',{stationId,incidentId})).data;assert(result.result.battle);assert.deepEqual(result.result.battle.defenderLost,{troops:0,garrison:0});assert.deepEqual(row(h,admin),before);assert.equal(result.covert.rules.canAttackEdoFromKyoto,false);
 });
 await scope('a revoked capability is rejected after asynchronous response decoration',async h=>{
  await fixture(h,'表示検証の江戸',{admin:true});const staff=await fixture(h,'表示検証の天皇',{staff:true});await appoint(h,staff);
  h.beforeStatement=(query)=>{if(!query.startsWith('SELECT 1 AS allowed WHERE ')||!query.includes('court_leader'))return;h.beforeStatement=null;h.sql.exec('DELETE FROM court_leader');};await h.api('/field/me?deviceId='+staff.deviceId,{token:staff.token,expected:409});
  await appoint(h,staff);h.beforeStatement=(query)=>{if(!query.startsWith('SELECT 1 AS allowed WHERE ')||!query.includes('court_leader'))return;h.beforeStatement=null;h.sql.exec('DELETE FROM court_leader');};await h.api('/covert',{token:staff.token,expected:409});
 });
}finally{globalThis.fetch=network;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
