import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {fixture,post,row,save,count,appoint,updateSave} from './test-court-support.mjs';

let checks=0,calls=0;
const journal=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url))).entries;
function migrate(sql,entries){for(const entry of entries)for(const statement of readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))sql.exec(statement);}
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Migration tests must not contact a real service');};
try{
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');migrate(sql,journal.filter(e=>e.idx<19));
 try{
  for(const id of ['u_operator','u_staff','u_retired'])sql.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run(id,id,id,'織田家','hash-'+id,100,200);
  sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,?)').run('u_staff','u_operator',100,'old-term',1000);
  const personal=JSON.parse(new GameEngine({officers:GAME_OFFICERS}).exportSave());delete personal.state.castles.kyoto_gosho;personal.state.resources.gold=123456;
  sql.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at,writer_device_id,lease_expires_at) VALUES(?,?,?,?,?,?)').run('u_staff',JSON.stringify(personal),8,400,'old-device',9999999);
  sql.prepare('INSERT INTO staff_campaign_backups VALUES(?,?,?,?,?,?,?,?)').run('u_staff','old-term',JSON.stringify(personal),1000,null,1,'old-transition',400);
  const baseGame=new GameEngine({officers:GAME_OFFICERS,isStaff:true}),buildings=structuredClone(baseGame.state.buildings),history=[
   {jobId:'proved-castle',kind:'castle',id:'sunpu',level:22,effectiveElapsedMs:1000},
   {jobId:'proved-farm',kind:'building',id:'farm',level:3,effectiveElapsedMs:2000},
   {jobId:'mismatch',kind:'building',id:'farm',level:4,effectiveElapsedMs:3000},
   {jobId:'orphan-history',kind:'building',id:'farm',level:5,effectiveElapsedMs:4000},
   {kind:'castle',id:'sunpu',level:23,effectiveElapsedMs:5000,legacyMetadata:'preserve'},
  ],jobs=[{jobId:'still-queued',kind:'castle',id:'sunpu',targetLevel:24,totalSeconds:600,startedElapsedMs:5000,completesElapsedMs:605000,startedBy:{id:'u_staff',name:'保持する名'}}],state={initial:{castleLevel:1,buildings},castleLevel:23,buildings:{...buildings,farm:5},history,jobs,createdElapsedMs:0,updatedElapsedMs:5000};
  sql.prepare('INSERT INTO staff_base VALUES(?,?,?,?,?)').run('sunpu',JSON.stringify(state),77,'old-commit',8888);
  const accepted=[['proved-castle','u_staff','castle','sunpu',22,1000],['proved-farm','u_retired','building','farm',3,2000],['mismatch','u_staff','building','farm',5,3000],['still-queued','u_staff','castle','sunpu',24,605000]];
  for(const [jobId,actor,kind,id,targetLevel,completesElapsedMs] of accepted)sql.prepare('INSERT INTO staff_base_requests VALUES(?,?,?,?,?,?)').run(actor,jobId,'original-hash-'+jobId,'receipt-token-'+jobId,JSON.stringify({jobId,kind,id,targetLevel,completesElapsedMs,cost:{gold:100},metadata:'preserve'}),500);
  sql.prepare('INSERT INTO covert_incidents VALUES(?,?,?,?,?,?,?,?)').run('u_staff','old-campaign','cpu-opportunity','sunpu',5000,7,JSON.stringify({id:'cpu-opportunity',sourceCastleId:'sunpu',stationSequence:7,kind:'cpu',used:false}),9000);
  const beforeSave=sql.prepare('SELECT * FROM player_saves').all(),beforeBackup=sql.prepare('SELECT * FROM staff_campaign_backups').all(),beforeReceipts=sql.prepare('SELECT actor_id,request_id,request_hash,commit_token,created_at FROM staff_base_requests').all();
  migrate(sql,journal.filter(e=>e.idx===19));
  const migrated=sql.prepare('SELECT * FROM staff_base').get(),expected=structuredClone(state);for(const value of [...expected.jobs,...expected.history])if(value.kind==='castle'&&value.id==='sunpu')value.id='kyoto_gosho';
  assert.equal(migrated.id,'kyoto_gosho');assert.equal(migrated.revision,77);assert.equal(migrated.commit_token,'old-commit');assert.equal(migrated.updated_at,8888);assert.deepEqual(JSON.parse(migrated.state_json),expected);
  assert.deepEqual(sql.prepare('SELECT * FROM player_saves').all(),beforeSave);assert.deepEqual(sql.prepare('SELECT * FROM staff_campaign_backups').all(),beforeBackup);assert.deepEqual(sql.prepare('SELECT actor_id,request_id,request_hash,commit_token,created_at FROM staff_base_requests').all(),beforeReceipts);
  assert.equal(JSON.parse(sql.prepare("SELECT result_json FROM staff_base_requests WHERE request_id='proved-castle'").get().result_json).id,'kyoto_gosho');
  const merit=sql.prepare('SELECT job_id,actor_id,points FROM court_contributions ORDER BY job_id').all().map(r=>({...r}));assert.deepEqual(merit,[{job_id:'proved-castle',actor_id:'u_staff',points:22},{job_id:'proved-farm',actor_id:'u_retired',points:3}]);
  const incident=sql.prepare('SELECT * FROM covert_incidents').get();assert.equal(incident.source_castle_id,'kyoto_gosho');assert.equal(JSON.parse(incident.result_json).sourceCastleId,'kyoto_gosho');assert.equal(incident.station_sequence,7);
  assert.throws(()=>sql.prepare('INSERT INTO staff_base(id,state_json,updated_at) VALUES(?,?,?)').run('sunpu','{}',0));checks++;console.log('PASS SQL migration preserves all shared progress, queues, personal resources and request hashes; only proven completions earn merit');
 }finally{sql.close();}

 await scope('legacy staff 128-castle cloud saves and private dispatch sources project to Kyoto without rewriting a read',async h=>{
  await fixture(h,'移転の運営',{admin:true});const staff=await fixture(h,'移転する担当',{staff:true}),canonical=save(h,staff),old=structuredClone(canonical);
  old.state.home='sunpu';old.state.cycle.home='sunpu';old.state.staffService={baseId:'sunpu'};old.state.castles.sunpu={owner:old.state.clan,level:63,wall:17,troops:6789};delete old.state.castles.kyoto_gosho;
  old.state.jobs=[{kind:'castle',id:'sunpu',targetLevel:64,total:1,remaining:1,totalSeconds:60,remainingSeconds:40}];old.state.captureRewards=[...old.state.captureRewards.filter(id=>id!=='kyoto_gosho'),'sunpu'];
  const legacyCovert=structuredClone(old.state.covert);legacyCovert.reserves.sunpu=123;delete legacyCovert.reserves.kyoto_gosho;
  h.sql.prepare('UPDATE player_saves SET save_json=?,cycle_home=? WHERE user_id=?').run(JSON.stringify(old),'sunpu',staff.user.id);
  h.sql.prepare('INSERT INTO covert_states VALUES(?,?,?,?,?)').run(staff.user.id,old.state.walking.campaignId,legacyCovert.sequence,JSON.stringify(legacyCovert),h.now);
  const durable=row(h,staff),backup=h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(staff.user.id);
  const field=(await h.api('/field',{token:staff.token})).data.players.find(p=>p.playerId===staff.user.id);assert.equal(field.homeCastleId,'kyoto_gosho');assert(Number.isFinite(field.defensePower));
  const result=(await h.api('/sync?deviceId='+staff.deviceId,{token:staff.token})).data,s=result.save.state;
  assert.equal(Object.keys(s.castles).length,129);assert.equal(s.home,'kyoto_gosho');assert.equal(s.cycle.home,'kyoto_gosho');assert.equal(s.staffService.baseId,'kyoto_gosho');assert.equal(s.castles.kyoto_gosho.level,63);assert.equal(s.castles.kyoto_gosho.troops,6789);assert.equal(s.jobs[0].id,'kyoto_gosho');assert.equal(s.jobs[0].targetLevel,64);assert.equal(s.covert.reserves.kyoto_gosho,123);assert.equal(s.covert.reserves.sunpu,undefined);assert(!s.captureRewards.includes('sunpu'));assert(s.captureRewards.includes('kyoto_gosho'));
  assert.deepEqual(s.resources,old.state.resources);assert.equal(s.castles.sunpu.level,1);assert.notEqual(s.castles.sunpu.owner,s.clan);assert.deepEqual(row(h,staff),durable);assert.deepEqual(h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(staff.user.id),backup);
  assert(result.staffBase.personalBaseCastle);assert.equal(result.staffBase.personalSunpu,undefined);
  const put=(await h.api('/sync',{method:'PUT',token:staff.token,body:{deviceId:staff.deviceId,revision:durable.revision,save:result.save}})).data;assert.equal(put.save.state.home,'kyoto_gosho');assert.equal(put.save.state.covert.reserves.kyoto_gosho,123);
  // A role may end before this player next synchronizes the old map. Public
  // projection must use the backed-up home, not advertise ordinary Sunpu as
  // the departed member's still-active palace identity.
  h.sql.prepare('UPDATE player_saves SET save_json=?,cycle_home=? WHERE user_id=?').run(JSON.stringify(old),'sunpu',staff.user.id);
  await h.api('/admin/staff',post(h.operator,{requestId:crypto.randomUUID(),targetPlayerId:staff.user.id,action:'dismiss'}));
  const departed=(await h.api('/field')).data.players.find(p=>p.playerId===staff.user.id);assert.equal(departed.homeCastleId,JSON.parse(backup.save_json).state.home);
  const restored=(await h.api('/sync?deviceId='+staff.deviceId,{token:staff.token})).data;assert.equal(restored.save.state.home,JSON.parse(backup.save_json).state.home);assert.equal(restored.staffBase,null);
 });
 await scope('ordinary Sunpu is playable at32 while historical64 and over-cap work safely normalize',async h=>{
  const player=await fixture(h,'駿府の一般領主'),old=save(h,player);delete old.state.castles.kyoto_gosho;old.state.home='sunpu';old.state.cycle.home='sunpu';old.state.castles.sunpu={owner:old.state.clan,level:64,troops:4567,wall:19};old.state.jobs=[{kind:'castle',id:'sunpu',targetLevel:64,total:1,remaining:1,totalSeconds:60,remainingSeconds:30}];old.state.castles.sunpu.level=63;
  h.sql.prepare('UPDATE player_saves SET save_json=?,cycle_home=? WHERE user_id=?').run(JSON.stringify(old),'sunpu',player.user.id);
  const prior=row(h,player),loaded=(await h.api('/sync?deviceId='+player.deviceId,{token:player.token})).data;assert.equal(loaded.save.state.home,'sunpu');assert.equal(loaded.save.state.castles.sunpu.level,32);assert.equal(loaded.save.state.castles.sunpu.troops,4567);assert.equal(loaded.save.state.jobs.length,0);assert.deepEqual(loaded.save.state.resources,old.state.resources);assert.deepEqual(row(h,player),prior);
  const field=(await h.api('/field')).data.players.find(p=>p.playerId===player.user.id);assert.equal(field.homeCastleId,'sunpu');assert.equal(field.level,32);assert.equal(field.majorCity,false);assert.equal(field.battleMode,'raid');
  const stable=(await h.api('/sync',{method:'PUT',token:player.token,body:{deviceId:player.deviceId,revision:prior.revision,save:loaded.save}})).data;assert.equal(stable.save.state.home,'sunpu');
  for(const value of [33,64,128]){const bad=structuredClone(stable.save);bad.state.castles.sunpu.level=value;await h.api('/sync',{method:'PUT',token:player.token,body:{deviceId:player.deviceId,revision:stable.revision,save:bad},expected:400});}
  const fake=structuredClone(stable.save);fake.state.home='kyoto_gosho';fake.state.castles.kyoto_gosho.owner=fake.state.clan;fake.state.isStaff=true;fake.state.isCourtEmperor=true;await h.api('/sync',{method:'PUT',token:player.token,body:{deviceId:player.deviceId,revision:stable.revision,save:fake},expected:403});
 });
 await scope('completed shared upgrades credit their initiator exactly once and never count queued work or Court activity',async h=>{
  const admin=await fixture(h,'功績管理の運営',{admin:true}),staff=await fixture(h,'普請する担当',{staff:true});
  const base=()=>h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get(),upgrade={requestId:crypto.randomUUID(),kind:'building',id:'farm',deviceId:staff.deviceId,expectedRevision:row(h,staff).revision,baseRevision:base().revision};
  const accepted=(await h.api('/staff/base/upgrade',post(staff,upgrade))).data,target=accepted.receipt.targetLevel;assert.equal(count(h,'court_contributions'),0);assert.equal((await h.api('/court',{token:staff.token})).data.self.merit,0);
  await h.api('/court/chat',post(staff,{requestId:crypto.randomUUID(),text:'普請を予約しました。'}));await h.api('/court/audiences',post(staff,{requestId:crypto.randomUUID(),title:'功績にならない参内',text:'この操作は功績を増やしません。'}));assert.equal(count(h,'court_contributions'),0);
  h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(accepted.receipt.completesElapsedMs,h.now);
  const completed=(await h.api('/court',{token:staff.token})).data;assert.equal(completed.self.merit,target);assert.equal(count(h,'court_contributions'),1);
  const stored=h.sql.prepare('SELECT * FROM court_contributions').get();assert.equal(stored.actor_id,staff.user.id);assert.equal(stored.job_id,accepted.receipt.jobId);assert.equal(stored.staff_term,accepted.receipt.staffTerm);assert.equal(stored.points,target);
  await h.api('/court',{token:staff.token});await h.api('/staff/base',{token:admin.token});assert.equal(count(h,'court_contributions'),1);
  const result=(await h.api('/staff/base/upgrade',post(staff,upgrade))).data;assert.equal(result.idempotent,true);assert.equal(count(h,'court_contributions'),1);
 });
 await scope('merit thresholds use verified ledger totals while operator and current Emperor offices take precedence',async h=>{
  const admin=await fixture(h,'官職の運営',{admin:true}),staff=await fixture(h,'功績の担当',{staff:true}),term=h.sql.prepare('SELECT term_id FROM staff_members WHERE user_id=?').get(staff.user.id).term_id;
  let seq=0,total=0;const add=amount=>{while(amount){const points=Math.min(128,amount);h.sql.prepare("INSERT INTO court_contributions VALUES(?,?,?,'castle','kyoto_gosho',?,?,?,?)").run('threshold-'+seq++,staff.user.id,term,points,points,seq,h.now);amount-=points;total+=points;}};
  for(const [merit,title] of [[0,'参議'],[49,'参議'],[50,'中納言'],[199,'中納言'],[200,'大納言'],[500,'内大臣'],[1000,'右大臣'],[2000,'左大臣']]){add(merit-total);const info=(await h.api('/court',{token:staff.token})).data;assert.equal(info.self.title,title);assert.equal(info.self.merit,merit);}
  await appoint(h,staff);assert.equal((await h.api('/court',{token:staff.token})).data.self.title,'天皇');assert.equal((await h.api('/court',{token:admin.token})).data.self.title,'太政大臣');await appoint(h,null);assert.equal((await h.api('/court',{token:staff.token})).data.self.title,'左大臣');
 });
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
