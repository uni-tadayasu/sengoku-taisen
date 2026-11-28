import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';
import {GameEngine} from './game-runtime.js';

const preview=async(h,p)=>(await h.api('/court/membership',{token:p.token})).data.membership;
const request=async(h,p)=>{const current=await preview(h,p);return{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:current.expectedRevision,expectedHomeCastleId:current.homeCastleId,expectedJoinMode:current.joinMode,expectedOfficeToken:current.officeAppointmentToken,confirmed:true,houseId:'kujo'};};
const join=(h,p,body,expected=200,query='')=>h.api('/court/membership'+query,post(p,body,expected));
const owned=state=>Object.entries(state.castles).filter(([,castle])=>castle.owner===state.clan).map(([id])=>id).sort();
const branchRow=(h,p,campaign=save(h,p).state.walking.campaignId)=>h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,campaign);
const branchState=(h,p,campaign)=>JSON.parse(branchRow(h,p,campaign).state_json);
function seedBranch(h,p,parent='nagoya'){
 const current=save(h,p),at=current.state.worldClock.elapsedMs,cost=GameEngine.branchFacilityCost(parent,'market',1),branch={id:parent+'_north',parentCastleId:parent,direction:'north',level:3,fallen:false,stationedTroops:123,facilities:{market:1},facilityCompletedAt:{market:[at]},durability:{version:1,current:6000,max:8000,updatedElapsedMs:at,repairPendingHP:0,repairRemainder:0}},
 job={kind:'branch',id:branch.id,facilityId:'market',targetLevel:2,total:cost.turns,totalSeconds:cost.seconds,completesElapsedMs:at+cost.seconds*1000};
 updateSave(h,p,s=>{s.branches=[branch];s.jobs.push({...job,remainingSeconds:cost.seconds,remaining:cost.turns});});
 h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,resolved_elapsed_ms,updated_at) VALUES(?,?,1,?,?,?)').run(p.user.id,current.state.walking.campaignId,JSON.stringify({branches:[branch],jobs:[job]}),at,h.now);
 return{branch,job};
}
const stable=h=>Object.fromEntries(['court_membership_requests','court_retained_memberships','court_lineages','staff_members','staff_campaign_backups','branch_states','player_saves','castle_residents','castle_seats'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all()]));
let checks=0,calls=0,maxBindings=0;
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100,'D1 binding limit');}return batch(statements);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Retention tests must not contact a real service');};
try{
 await scope('retained major cities and branch ledgers cross admission once with garrisons, damage, facilities and construction intact',async h=>{
  await fixture(h,'大都市保持の責任者',{admin:true});const p=await fixture(h,'大都市を携える加入者',{score:35000,holdings:['nagoya','nijo','osaka']});
  updateSave(h,p,s=>{Object.assign(s.castles.nagoya,{level:8,wall:6,troops:4321,durability:{version:1,current:30000,max:36500,updatedElapsedMs:s.worldClock.elapsedMs,repairPendingHP:0,repairRemainder:0}});s.jobs.push({kind:'castle',id:'nagoya',targetLevel:9,total:1,totalSeconds:60,remaining:1,remainingSeconds:50});});
  const {branch,job}=seedBranch(h,p),before=save(h,p),oldCampaign=before.state.walking.campaignId,oldLedger=branchRow(h,p),details=await preview(h,p),body=await request(h,p);
  assert.deepEqual(details.retainedCastles.map(c=>c.id).sort(),['nagoya','nijo','osaka']);assert.deepEqual(details.releasedCastles.map(c=>c.id),['kiyosu']);assert.equal(details.destinationHomeCastleId,'kyoto_gosho');
  const result=(await join(h,p,body)).data,next=result.save.state;assert.deepEqual(owned(next),['kyoto_gosho','nagoya','nijo','osaka']);assert.notEqual(next.walking.campaignId,oldCampaign);assert.equal(next.troops,before.state.troops);
  for(const id of ['nagoya','nijo','osaka'])assert.deepEqual({...next.castles[id],owner:before.state.clan},before.state.castles[id],id);
  assert.deepEqual(next.branches,[branch]);assert.equal(next.jobs.find(j=>j.kind==='castle'&&j.id==='nagoya').remainingSeconds,50);assert.deepEqual(branchState(h,p),{branches:[branch],jobs:[job]});assert.deepEqual(branchRow(h,p,oldCampaign),oldLedger);
  assert.equal(result.admission.retainedCastleCount,3);assert.equal(result.admission.releasedCastleCount,1);assert.equal(result.admission.joinMode,'kyoto');assert.deepEqual(next.cycle.protectedRegions,[]);
  const committed=stable(h),replayed=(await join(h,p,body,200,'?receipt=1')).data;assert.equal(replayed.admission.idempotent,true);assert.deepEqual(stable(h),committed);
  const listed=(await h.api('/branches?deviceId='+p.deviceId,{token:p.token})).data;assert.deepEqual(listed.branchState.branches,[branch]);assert.equal(listed.branchState.jobs[0].completesElapsedMs,job.completesElapsedMs);
  await h.api('/branches/transfer-troops',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:oldCampaign,sequence:oldLedger.sequence,from:'branch:nagoya_north',to:'army',troops:1},409));
  assert.equal(branchState(h,p).branches[0].stationedTroops,123);assert.equal(save(h,p).state.troops,before.state.troops);
 });
 await scope('a campaign with only retained cities can enroll with zero released castles and an immutable receipt',async h=>{
  await fixture(h,'大都市のみの責任者',{admin:true});const p=await fixture(h,'大都市のみの加入者',{score:36000,holdings:['nagoya']});
  updateSave(h,p,s=>{s.castles.kiyosu.owner='在地衆';s.home='nagoya';s.cycle.home='nagoya';s.castles.nagoya.level=8;s.castles.nagoya.troops=987;});
  const details=await preview(h,p);assert.equal(details.releasedCastleCount,0);assert.equal(details.retainedCastleCount,1);const body=await request(h,p),result=(await join(h,p,body)).data;
  assert.equal(result.admission.releasedCastleCount,0);assert.equal(result.admission.retainedCastleCount,1);assert.equal(result.save.state.castles.nagoya.level,8);assert.equal(result.save.state.castles.nagoya.troops,987);assert.deepEqual(result.save.state.cycle.protectedRegions,[]);
  assert.equal((await join(h,p,body)).data.admission.idempotent,true);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_membership_requests WHERE actor_id=?').get(p.user.id).n,1);
 });
 await scope('the primary operator keeps Edo and its authority while recording formal family membership',async h=>{
  const p=await fixture(h,'江戸を保つ正式加入者',{admin:true,score:35000});updateSave(h,p,s=>{s.castles.nagoya.owner=s.clan;s.castles.inabayama.owner=s.clan;Object.assign(s.castles.edo,{level:12,wall:8,troops:1234});});
  const before=save(h,p),details=await preview(h,p),body=await request(h,p);assert.equal(details.canJoin,true);assert.equal(details.joinMode,'retained-base');assert.equal(details.destinationHomeCastleId,'edo');assert(details.retainedCastles.some(c=>c.id==='edo'));
  const result=(await join(h,p,body)).data,next=result.save.state;assert.equal(result.user.isAdmin,true);assert.equal(result.user.isStaff,false);assert.equal(next.home,'edo');assert.equal(next.cycle.home,'edo');assert.deepEqual(next.castles.edo,before.state.castles.edo);assert.notEqual(next.castles.inabayama.owner,next.clan);assert.equal(result.membership.isMember,true);
  assert.equal(result.admission.joinMode,'retained-base');assert.equal(result.admission.castleId,'edo');assert.equal(result.admission.destinationHomeCastleId,'edo');assert.equal(result.user.courtLineage.houseId,'kujo');assert.equal(result.user.courtLineage.originalClan,before.state.clan);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM staff_members WHERE user_id=?').get(p.user.id).n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM staff_campaign_backups WHERE user_id=?').get(p.user.id).n,0);assert.equal(h.sql.prepare('SELECT base_id FROM court_retained_memberships WHERE user_id=?').get(p.user.id).base_id,'edo');
  await h.api('/admin/moderation/bans',{token:p.token});const court=(await h.api('/court',{token:p.token})).data;assert.equal(court.self.title,'太政大臣');assert.equal(court.self.isCourtEmperor,false);assert.equal(court.lineage.canCreateImperialHouse,false);
  const committed=stable(h);assert.equal((await join(h,p,body)).data.admission.idempotent,true);assert.deepEqual(stable(h),committed);await join(h,p,{...body,requestId:crypto.randomUUID()},409);
 });
 await scope('the deputy keeps Kagoshima and its term, returns ordinary regions, and retains family identity after dismissal',async h=>{
  const admin=await fixture(h,'鹿児島加入の責任者',{admin:true}),p=await fixture(h,'鹿児島を保つ加入者',{score:35000,startCastle:'uchijo'}),tokai=globalThis.SENGOKU_DATA.regionConquest.regions.find(r=>r.region==='東海').castleIds;
  updateSave(h,p,s=>{for(const id of tokai)s.castles[id].owner=s.clan;s.cycle.protectedRegions=['東海'];s.cycle.retainedRegions=['東海'];});
  const directory=(await h.api('/admin/deputy',{token:admin.token})).data;await h.api('/admin/deputy',post(admin,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID(),expectedRevision:directory.revision}));await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
  const roleBefore=h.sql.prepare('SELECT * FROM deputy_operator_state').get(),before=save(h,p),details=await preview(h,p),body=await request(h,p);assert.equal(details.joinMode,'retained-base');assert.equal(details.destinationHomeCastleId,'kagoshima');
  const result=(await join(h,p,body)).data,next=result.save.state;assert.equal(result.user.isDeputy,true);assert.equal(result.user.isAdmin,false);assert.equal(result.user.isStaff,false);assert.equal(next.home,'kagoshima');assert.deepEqual(next.castles.kagoshima,before.state.castles.kagoshima);assert.deepEqual(h.sql.prepare('SELECT * FROM deputy_operator_state').get(),roleBefore);
  assert.deepEqual(owned(next),['kagoshima','nagoya']);assert.deepEqual(next.cycle.protectedRegions,[]);assert.deepEqual(next.cycle.retainedRegions,[]);assert.equal(result.membership.isMember,true);assert.equal(result.user.courtLineage.originalClan,before.state.clan);assert.notEqual(result.user.courtLineage.originalClan,'島津家','The origin follows the real lord rather than the new base');
  assert.equal(result.admission.destinationHomeCastleId,'kagoshima');assert.equal(result.admission.retainedCastleCount,2);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM staff_members WHERE user_id=?').get(p.user.id).n,0);
  const court=(await h.api('/court',{token:p.token})).data;assert.equal(court.lineage.canCreateImperialHouse,false);assert.equal(court.self.isCourtEmperor,false);assert.equal(court.self.canActForEmperor,false);
  const committed=stable(h);assert.equal((await join(h,p,body)).data.admission.idempotent,true);assert.deepEqual(stable(h),committed);
  await h.api('/admin/deputy',post(admin,{targetPlayerId:p.user.id,action:'dismiss',requestId:crypto.randomUUID(),expectedRevision:roleBefore.revision}));
  const after=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.equal(after.user.isDeputy,false);assert.equal(after.user.isStaff,false);assert.equal(after.user.canOperate,false);assert.equal(after.user.courtLineage.houseId,'kujo');assert.deepEqual(after.save.state.cycle.protectedRegions,[]);assert.equal((await preview(h,p)).isMember,true);
 });
 await scope('source branch changes and transaction failures cannot half-transfer retained cities or ledgers',async h=>{
  await fixture(h,'保持原子性の責任者',{admin:true});const p=await fixture(h,'保持競合の加入者',{score:35000,holdings:['nagoya']});seedBranch(h,p);const body=await request(h,p),before=save(h,p);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_membership_requests')))return;h.beforeBatch=null;h.sql.prepare('UPDATE branch_states SET sequence=sequence+1 WHERE actor_id=?').run(p.user.id);};
  await join(h,p,body,409);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_membership_requests').get().n,0);assert.equal(save(h,p).state.walking.campaignId,before.state.walking.campaignId);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM branch_states WHERE actor_id=?').get(p.user.id).n,1);
  const retry=await request(h,p),committed=stable(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_membership_requests')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_retention_table SET value=1'));};
  await join(h,p,retry,500);assert.deepEqual(stable(h),committed);
 });
 await scope('appointed officials retain ordinary homes, their offices and both lord and retainer household relationships',async h=>{
  const admin=await fixture(h,'任命官職加入の責任者',{admin:true}),lord=await fixture(h,'本拠の任命城主',{score:35000,holdings:['nagoya','inabayama']}),retainer=await fixture(h,'本拠の任命家臣',{score:35000,holdings:['osaka','sunpu']});
  for(const [p,officeId]of [[lord,'sangi'],[retainer,'chunagon']]){
   const directory=(await h.api('/admin/court/offices',{token:admin.token})).data;await h.api('/admin/court/offices',post(admin,{requestId:crypto.randomUUID(),action:'appoint',officeId,targetPlayerId:p.user.id,expectedRevision:directory.revision}));
   const detail=await preview(h,p),body=await request(h,p),before=save(h,p),residents=h.sql.prepare("SELECT * FROM castle_residents WHERE castle_id='kiyosu' ORDER BY user_id").all(),seat=h.sql.prepare("SELECT * FROM castle_seats WHERE castle_id='kiyosu'").get(),office=h.sql.prepare('SELECT * FROM court_external_offices WHERE user_id=?').get(p.user.id);
   assert.equal(detail.joinMode,'retained-base');assert.equal(detail.destinationHomeCastleId,'kiyosu');assert.equal(detail.officeAppointmentToken,office.appointment_token);assert(detail.retainedCastles.some(c=>c.id==='kiyosu'));
   const result=(await join(h,p,body)).data;assert.equal(result.save.state.home,'kiyosu');assert.deepEqual(result.save.state.castles.kiyosu,before.state.castles.kiyosu);assert.equal(result.user.isStaff,false);assert.equal(result.user.isAdmin,false);assert.equal(result.user.canOperate,false);assert.equal(result.admission.joinMode,'retained-base');assert.equal(result.admission.destinationHomeCastleId,'kiyosu');
   assert.deepEqual(h.sql.prepare("SELECT * FROM castle_residents WHERE castle_id='kiyosu' ORDER BY user_id").all(),residents);assert.deepEqual(h.sql.prepare("SELECT * FROM castle_seats WHERE castle_id='kiyosu'").get(),seat);assert.deepEqual(h.sql.prepare('SELECT * FROM court_external_offices WHERE user_id=?').get(p.user.id),office);
   assert.notEqual(result.save.state.castles[p===lord?'inabayama':'sunpu'].owner,result.save.state.clan);assert.equal(result.save.state.castles[p===lord?'nagoya':'osaka'].owner,result.save.state.clan);assert.equal(result.membership.isMember,true);
  }
 });
 await scope('office loss after preview or at commit rejects the old confirmation without surrendering a home',async h=>{
  const admin=await fixture(h,'任命失効の責任者',{admin:true});
  for(const phase of ['preview','commit']){
   const p=await fixture(h,'任命失効'+phase,{score:35000,startCastle:phase==='preview'?'kiyosu':'inuyama'}),directory=(await h.api('/admin/court/offices',{token:admin.token})).data;
   await h.api('/admin/court/offices',post(admin,{requestId:crypto.randomUUID(),action:'appoint',officeId:'sangi',targetPlayerId:p.user.id,expectedRevision:directory.revision}));
   const body=await request(h,p),before=save(h,p),residents=h.sql.prepare('SELECT * FROM castle_residents WHERE user_id=?').get(p.user.id);
   const revoke=()=>h.sql.prepare('DELETE FROM court_office_appointments WHERE user_id=?').run(p.user.id);
   if(phase==='preview')revoke();else h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_membership_requests')))return;h.beforeBatch=null;revoke();};
   assert.equal((await join(h,p,body,409)).data.error.code,'COURT_MEMBERSHIP_CHANGED');assert.deepEqual(save(h,p),before);assert.deepEqual(h.sql.prepare('SELECT * FROM castle_residents WHERE user_id=?').get(p.user.id),residents);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_membership_requests WHERE actor_id=?').get(p.user.id).n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_retained_memberships WHERE user_id=?').get(p.user.id).n,0);
  }
 });
 console.log(JSON.stringify({ok:true,checks,calls,maxBindings}));
}finally{globalThis.fetch=originalFetch;}
