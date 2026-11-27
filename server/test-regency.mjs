import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {harness} from './test-support.mjs';
import {fixture,post,save,row,appoint,nominateSuccessor,certifySuccessor} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const {cleanRegent}=createRequire(import.meta.url)(process.argv[2]?resolve(process.argv[2]):'../court.js');
function validateDirectory(value){assert.doesNotThrow(()=>cleanRegent(value),'The actual court UI must accept the regent directory');return value;}

let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function setup(h){const admin=await fixture(h,'摂政制度の太政大臣',{admin:true}),ordinary=await fixture(h,'一般拠点の候補',{startCastle:'inuyama'}),staff=await fixture(h,'京都御所の候補',{staff:true});return{admin,ordinary,staff};}
const directory=async(h,admin,query='')=>validateDirectory((await h.api('/admin/court/regent'+query,{token:admin.token})).data);
async function appointRegent(h,admin,target,extra={}){const view=await directory(h,admin),body={action:'appoint',targetPlayerId:target.user.id,expectedRevision:view.revision,requestId:crypto.randomUUID(),...extra};return{...validateDirectory((await h.api('/admin/court/regent',post(admin,body))).data),body};}
async function dismissRegent(h,admin,target){const view=await directory(h,admin),body={action:'dismiss',targetPlayerId:target.user.id,expectedRevision:view.revision,requestId:crypto.randomUUID()};return{...validateDirectory((await h.api('/admin/court/regent',post(admin,body))).data),body};}
const state=h=>Object.fromEntries(['court_regency_state','court_regent','court_regency_requests'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all()]));
async function application(h,name='幕府を願う領主'){
 const p=await h.session(name),rightId='sg_'+crypto.randomUUID().replaceAll('-','');
 h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at) VALUES(?,?,'event',?,'天下統一',?)").run(rightId,p.user.id,crypto.randomUUID(),h.now);
 const result=(await h.api('/shogunate/open',post(p,{rightId,requestId:crypto.randomUUID()}))).data;return{...p,rightId,result};
}
const approve=async(h,p,rightId,expected=200)=>(await h.api('/shogunate/approve',post(p,{rightId,requestId:crypto.randomUUID()},expected))).data;
async function force(won,run){const original=crypto.getRandomValues;crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(won?0:0xffffffff):original.call(crypto,value);};try{return await run();}finally{crypto.getRandomValues=original;}}
async function progress(h,player){
 const snapshot=(await h.api('/sync?deviceId='+player.deviceId,{token:player.token})).data;
 const game=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isAdmin:snapshot.user.isAdmin,isStaff:snapshot.user.isStaff,staffBase:snapshot.staffBase,maintenanceAuthority:snapshot.maintenanceAuthority,branchAuthority:{resolvedElapsedMs:snapshot.branchResolvedElapsedMs}});
 const advanced=game.applyWorldClock(snapshot.clock,{maxSeconds:86400,deferCycleSettlement:true});assert(advanced.ok&&!advanced.pending&&!advanced.settlementRequired);
 return JSON.parse(game.exportSave()).state;
}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Regency tests must not contact a real service');};
try{
 await scope('only the current Chancellor can manage one Regent and candidate search preserves ordinary/staff distinction',async h=>{
  const{admin,ordinary,staff}=await setup(h);await h.api('/admin/court/regent',{expected:401});
  for(const p of [ordinary,staff]){await h.api('/admin/court/regent',{token:p.token,expected:403});await h.api('/admin/court/regent',post(p,{action:'appoint',targetPlayerId:p.user.id,expectedRevision:0,requestId:crypto.randomUUID()},403));}
  const view=await directory(h,admin);assert.equal(view.canManage,true);assert.equal(view.revision,0);assert.equal(view.holder,null);
  assert(view.candidates.some(p=>p.id===ordinary.user.id&&p.isStaff===false&&p.homeCastleId==='inuyama'));assert(view.candidates.some(p=>p.id===staff.user.id&&p.isStaff===true&&p.homeCastleId==='kyoto_gosho'));assert(!view.candidates.some(p=>p.id===admin.user.id));
  const searched=await directory(h,admin,'?q='+encodeURIComponent('京都')+'&limit=1');assert.equal(searched.candidates.length,1);assert.equal(searched.candidates[0].id,staff.user.id);assert.equal(searched.query,'京都');
  for(const query of ['?limit=51','?limit=0','?q=a&q=b','?unknown=1'])await h.api('/admin/court/regent'+query,{token:admin.token,expected:400});
 });
 await scope('an ordinary Regent keeps their base and save while gaining court duties and shogunate approval only',async h=>{
  const{admin,ordinary}=await setup(h),before=row(h,ordinary),staffBefore=h.sql.prepare('SELECT * FROM staff_members ORDER BY user_id').all(),appointed=await appointRegent(h,admin,ordinary);
  assert.equal(appointed.revision,1);assert.equal(appointed.receipt.revision,1);assert.equal(appointed.holder.id,ordinary.user.id);assert.equal(appointed.holder.isStaff,false);assert.equal(appointed.holder.homeCastleId,'inuyama');assert.deepEqual(row(h,ordinary),before);assert.deepEqual(h.sql.prepare('SELECT * FROM staff_members ORDER BY user_id').all(),staffBefore);
  const court=(await h.api('/court',{token:ordinary.token})).data;assert.equal(court.self.title,'摂政');assert.equal(court.self.isCourtRegent,true);assert.equal(court.self.isCourtEmperor,false);assert.equal(court.self.canApproveShogunate,true);assert.equal(court.self.canRespond,true);assert.equal(court.self.canAppoint,false);assert.equal(court.eligible,true);await h.api('/staff/court',{token:ordinary.token});
  const message=(await h.api('/court/chat',post(ordinary,{requestId:crypto.randomUUID(),text:'朝廷の応対を行います。'}))).data.message;assert.equal(message.author.kind,'court');assert.equal(message.author.id,null);
  const applicant=await application(h),view=(await h.api('/shogunate',{token:ordinary.token})).data.shogunate;assert.equal(view.canApprove,true);assert(view.approvals.some(r=>r.id===applicant.rightId));await approve(h,ordinary,applicant.rightId);assert.equal(h.sql.prepare('SELECT status FROM shogunate_approvals WHERE right_id=?').get(applicant.rightId).status,'approved');
  await h.api('/court/succession',{token:ordinary.token,expected:403});await h.api('/court/succession',post(ordinary,{requestId:crypto.randomUUID(),targetPlayerId:admin.user.id,targetTermId:'forged-staff-term',sourceAppointmentToken:crypto.randomUUID()},403));await h.api('/admin/court/regent',{token:ordinary.token,expected:403});assert.deepEqual(row(h,ordinary),before);
 });
 await scope('a Kyoto Regent keeps the same staff term, home, assets and crown-only succession boundary',async h=>{
  const{admin,staff}=await setup(h),before=row(h,staff),term=h.sql.prepare('SELECT * FROM staff_members WHERE user_id=?').get(staff.user.id);await appointRegent(h,admin,staff);
  assert.deepEqual(row(h,staff),before);assert.deepEqual(h.sql.prepare('SELECT * FROM staff_members WHERE user_id=?').get(staff.user.id),term);assert.equal(save(h,staff).state.home,'kyoto_gosho');
  const info=(await h.api('/court',{token:staff.token})).data;assert.equal(info.self.title,'摂政');assert.equal(info.self.isCourtEmperor,false);assert.equal(info.self.canActForEmperor,true);
  const field=(await h.api('/field/me?deviceId='+staff.deviceId,{token:staff.token})).data;assert.equal(field.attack.canAttackEdoFromKyoto,true);
  await h.api('/court/succession',{token:staff.token,expected:403});const p=await application(h);await approve(h,staff,p.rightId);assert.equal(h.sql.prepare('SELECT user_id FROM court_leader').get(),undefined);
 });
 for(const won of [false,true])await scope('an appointed Kyoto Regent resolves an Edo '+(won?'victory with half-resource loot':'defeat without resource loot')+' while preserving both court roles and protected assets',async h=>{
  const{admin,staff}=await setup(h);await appointRegent(h,admin,staff);const palace=h.sql.prepare('SELECT * FROM staff_base').get(),body={requestId:crypto.randomUUID(),targetPlayerId:admin.user.id,targetCastleId:'edo',troops:1000,tactic:'balanced',deviceId:staff.deviceId,expectedRevision:row(h,staff).revision};
  const departure=(await force(won,()=>h.api('/field/attack',post(staff,body)))).data;assert.equal(departure.marching,true);assert.equal(departure.battle,null);h.now+=departure.march.remainingMs;
  const attackerArrival=await progress(h,staff),defenderArrival=await progress(h,admin),defender=row(h,admin);
  const arrival=(await h.api('/marches?deviceId='+staff.deviceId,{token:staff.token})).data,receipt=arrival.history.find(m=>m.id===departure.march.id);assert.equal(receipt?.status,'resolved');const battle=receipt.battle;
  assert.equal(battle.won,won);assert.equal(battle.battleMode,'reward');assert.equal(battle.capture.captured,false);assert.deepEqual(battle.defenderLost,{troops:0,garrison:0});assert.equal(battle.lootPolicy,'half-resources-v1');assert.equal(battle.lootFraction,.5);assert.deepEqual(battle.rewards,{gold:0,rice:0,wood:0,stone:0});
  const attackerAfter=save(h,staff).state,defenderAfter=save(h,admin).state;
  for(const key of ['gold','rice','wood','stone']){
   const amount=won?Math.min(Math.floor(defenderArrival.resources[key]/2),100000000-attackerArrival.resources[key]):0;
   assert.equal(battle.loot[key],amount,key+' uses the actual balance at arrival only on victory');
   assert.equal(attackerAfter.resources[key],attackerArrival.resources[key]+amount,key+' credits exactly the transferred amount');
   assert.equal(defenderAfter.resources[key],defenderArrival.resources[key]-amount,key+' debits exactly the transferred amount');
  }
  assert.equal(battle.defenderRevision,defender.revision+1);assert.equal(row(h,admin).revision,battle.defenderRevision);assert.deepEqual(defenderAfter.castles,defenderArrival.castles);assert.deepEqual(defenderAfter.buildings,defenderArrival.buildings);assert.equal(defenderAfter.troops,defenderArrival.troops);assert.equal(defenderAfter.magatama,defenderArrival.magatama);assert.deepEqual(h.sql.prepare('SELECT * FROM staff_base').get(),palace);
  assert.equal(defenderAfter.home,'edo');assert.equal(attackerAfter.home,'kyoto_gosho');assert.notEqual(attackerAfter.castles.edo.owner,attackerAfter.clan);assert.equal(h.sql.prepare('SELECT * FROM court_leader').get(),undefined);assert.equal(h.sql.prepare('SELECT user_id FROM court_regent').get().user_id,staff.user.id);
 });
 await scope('a Regent revoked before Kyoto-to-Edo arrival gets their army back and no battle is committed',async h=>{
  const{admin,staff}=await setup(h);await appointRegent(h,admin,staff);const defender=row(h,admin),body={requestId:crypto.randomUUID(),targetPlayerId:admin.user.id,targetCastleId:'edo',troops:1000,tactic:'balanced',deviceId:staff.deviceId,expectedRevision:row(h,staff).revision};
  const departure=(await h.api('/field/attack',post(staff,body))).data;assert(departure.marching);await dismissRegent(h,admin,staff);h.now+=departure.march.remainingMs;
  const arrival=(await h.api('/marches?deviceId='+staff.deviceId,{token:staff.token})).data,history=arrival.history.find(m=>m.id===departure.march.id);assert.equal(history?.status,'cancelled');assert.equal(history.battle,null);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM field_battles').get().n,0);assert.deepEqual(row(h,admin),defender);
  const receipt=JSON.parse(h.sql.prepare('SELECT result_json FROM battle_marches WHERE id=?').get(departure.march.id).result_json);assert.equal(receipt.refund.troops,1000);const committed=row(h,staff),again=(await h.api('/marches?deviceId='+staff.deviceId,{token:staff.token})).data;assert.equal(again.history.find(m=>m.id===departure.march.id).status,'cancelled');assert.equal(again.save.state.troops,JSON.parse(committed.save_json).state.troops);assert.equal((await h.api('/field/me?deviceId='+staff.deviceId,{token:staff.token})).data.attack.canAttackEdoFromKyoto,false);
 });
 await scope('dismissal removes delegated powers immediately and replay cannot restore an old appointment',async h=>{
  const{admin,ordinary}=await setup(h),first=await appointRegent(h,admin,ordinary),p=await application(h),dismissed=await dismissRegent(h,admin,ordinary);assert.equal(dismissed.holder,null);assert.equal(dismissed.revision,2);
  const info=(await h.api('/court',{token:ordinary.token})).data;assert.equal(info.self.isCourtRegent,false);assert.equal(info.self.canRespond,false);assert.equal(info.self.canApproveShogunate,false);await h.api('/staff/court',{token:ordinary.token,expected:403});await approve(h,ordinary,p.rightId,403);
  const replay=(await h.api('/admin/court/regent',post(admin,first.body))).data;assert.equal(replay.idempotent,true);assert.deepEqual(replay.receipt,first.receipt);assert.equal(replay.holder,null);assert.equal(replay.revision,2);
  const again=(await h.api('/admin/court/regent',post(admin,dismissed.body))).data;assert(again.idempotent);assert.deepEqual(again.receipt,dismissed.receipt);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_regency_requests').get().n,2);
 });
 await scope('concurrent appointments, stale directory revisions and operation reuse cannot overwrite the current Regent',async h=>{
  const{admin,ordinary,staff}=await setup(h),view=await directory(h,admin),a={action:'appoint',targetPlayerId:ordinary.user.id,expectedRevision:view.revision,requestId:crypto.randomUUID()},b={...a,targetPlayerId:staff.user.id,requestId:crypto.randomUUID()};
  const result=await Promise.all([a,b].map(body=>h.api('/admin/court/regent',post(admin,body,null))));assert.deepEqual(result.map(r=>r.response.status).sort(),[200,409]);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_regent').get().n,1);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_regency_requests').get().n,1);
  const winner=result[0].response.status===200?a:b,loser=winner===a?b:a,used=await h.api('/admin/court/regent',post(admin,{...winner,targetPlayerId:loser.targetPlayerId},409));assert.equal(used.data.error.code,'REQUEST_ID_REUSED');
  const current=await directory(h,admin),occupied=await h.api('/admin/court/regent',post(admin,{...loser,expectedRevision:current.revision},409));assert.equal(occupied.data.error.code,'REGENT_OCCUPIED');
 });
 await scope('operator, Emperor, retired Emperor, banned and unestablished candidates cannot become Regent',async h=>{
  const{admin,ordinary,staff}=await setup(h),successor=await fixture(h,'次代の御所担当',{staff:true}),empty=await h.session('本拠未登録');await appoint(h,staff);
  const reject=async p=>{const v=await directory(h,admin);const r=await h.api('/admin/court/regent',post(admin,{action:'appoint',targetPlayerId:p.user.id,expectedRevision:v.revision,requestId:crypto.randomUUID()},400));assert.equal(r.data.error.code,'REGENT_TARGET_REQUIRED');assert(!v.candidates.some(c=>c.id===p.user.id));};
  await reject(admin);await reject(staff);await reject(empty);
  const nomination=(await nominateSuccessor(h,staff,successor)).nomination;await certifySuccessor(h,admin,nomination);await reject(staff);await reject(successor);
  h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)').run(ordinary.user.id,admin.user.id,h.now);await reject(ordinary);
 });
 await scope('promotion removes the prior external office and dismissal does not resurrect it',async h=>{
  const{admin,ordinary}=await setup(h);let offices=(await h.api('/admin/court/offices',{token:admin.token})).data;const free=offices.offices.find(o=>o.available);assert(free);
  await h.api('/admin/court/offices',post(admin,{action:'appoint',officeId:free.id,targetPlayerId:ordinary.user.id,expectedRevision:offices.revision,requestId:crypto.randomUUID()}));assert(h.sql.prepare('SELECT * FROM court_office_appointments WHERE user_id=?').get(ordinary.user.id));
  await appointRegent(h,admin,ordinary);assert.equal(h.sql.prepare('SELECT * FROM court_office_appointments WHERE user_id=?').get(ordinary.user.id),undefined);await dismissRegent(h,admin,ordinary);assert.equal(h.sql.prepare('SELECT * FROM court_office_appointments WHERE user_id=?').get(ordinary.user.id),undefined);
 });
 await scope('Kyoto merit office is freed by regency and conflicting external holder is cleared when the Regent is dismissed',async h=>{
  const{admin,ordinary,staff}=await setup(h);await appointRegent(h,admin,staff);let offices=(await h.api('/admin/court/offices',{token:admin.token})).data;assert(offices.offices.find(o=>o.id==='sangi').available);
  await h.api('/admin/court/offices',post(admin,{action:'appoint',officeId:'sangi',targetPlayerId:ordinary.user.id,expectedRevision:offices.revision,requestId:crypto.randomUUID()}));const revision=h.sql.prepare('SELECT revision FROM court_office_state').get().revision;
  await dismissRegent(h,admin,staff);assert(h.sql.prepare('SELECT revision FROM court_office_state').get().revision>revision);assert.equal(h.sql.prepare("SELECT * FROM court_office_appointments WHERE office_id='sangi'").get(),undefined);assert.equal(h.sql.prepare('SELECT office_id FROM court_kyoto_offices WHERE user_id=?').get(staff.user.id).office_id,'sangi');
 });
 await scope('a Kyoto Regent may succeed the Emperor and accession permanently clears the old delegated appointment',async h=>{
  const{admin,staff}=await setup(h),emperor=await fixture(h,'譲位する天皇',{staff:true});await appoint(h,emperor);await appointRegent(h,admin,staff);
  const nomination=(await nominateSuccessor(h,emperor,staff)).nomination;
  assert.equal(nomination.status,'pending');assert.equal(h.sql.prepare('SELECT user_id FROM court_regent').get().user_id,staff.user.id);assert.equal(h.sql.prepare('SELECT user_id FROM court_leader').get().user_id,emperor.user.id);
  const pendingInfo=(await h.api('/court',{token:staff.token})).data;assert.equal(pendingInfo.self.isCourtRegent,true);assert.equal(pendingInfo.self.isCourtEmperor,false);
  await certifySuccessor(h,admin,nomination);
  assert.equal(h.sql.prepare('SELECT * FROM court_regent').get(),undefined);assert.equal((await directory(h,admin)).holder,null);const info=(await h.api('/court',{token:staff.token})).data;assert.equal(info.self.isCourtEmperor,true);assert.equal(info.self.isCourtRegent,false);assert.equal(info.self.title,'天皇');
  await appoint(h,null);const after=(await h.api('/court',{token:staff.token})).data;assert.equal(after.self.isCourtEmperor,false);assert.equal(after.self.isCourtRegent,false);assert.equal((await h.api('/shogunate',{token:staff.token})).data.shogunate.canApprove,false);
 });
 await scope('a target or Chancellor role change immediately before appointment commit rejects the entire operation',async h=>{
  const{admin,ordinary,staff}=await setup(h),view=await directory(h,admin),body={action:'appoint',targetPlayerId:ordinary.user.id,expectedRevision:view.revision,requestId:crypto.randomUUID()},before=state(h);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_regency_requests')))return;h.beforeBatch=null;h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES(?,?,?,?)').run(ordinary.user.id,admin.user.id,h.now,crypto.randomUUID());};
  await h.api('/admin/court/regent',post(admin,body,409));assert.deepEqual(state(h),before);
  h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(ordinary.user.id);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_regency_requests')))return;h.beforeBatch=null;h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(staff.user.id);};
  await h.api('/admin/court/regent',post(admin,body,409));assert.deepEqual(state(h),before);
 });
 await scope('regency writes roll back role, receipt, office promotion and revision together on failure',async h=>{
  const{admin,ordinary}=await setup(h),view=await directory(h,admin),before=state(h);h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO court_regency_requests')))statements.push(h.db.prepare('UPDATE missing_regency SET value=1'));};
  await h.api('/admin/court/regent',post(admin,{action:'appoint',targetPlayerId:ordinary.user.id,expectedRevision:view.revision,requestId:crypto.randomUUID()},500));assert.deepEqual(state(h),before);h.beforeBatch=null;await appointRegent(h,admin,ordinary);
 });
 await scope('revoked or replaced Regent tokens cannot commit shogunate approval or return a stale private approval queue',async h=>{
  const{admin,ordinary}=await setup(h);await appointRegent(h,admin,ordinary);const p=await application(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO shogunate_approval_requests')))return;h.beforeBatch=null;h.sql.prepare('UPDATE court_regent SET appointment_token=? WHERE id=1').run(crypto.randomUUID());};
  await approve(h,ordinary,p.rightId,409);assert.equal(h.sql.prepare('SELECT status FROM shogunate_approvals WHERE right_id=?').get(p.rightId).status,'pending');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_approval_requests').get().n,0);
  let changed=false;h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-court-office')))return;changed=true;h.sql.exec('DELETE FROM court_regent');};
  const response=await h.api('/shogunate',{token:ordinary.token,expected:409});assert(changed);assert.equal(response.data.shogunate,undefined);h.beforeBatch=null;
 });
 await scope('regent dismissal during a court write or final private roster response revokes the delegated court access',async h=>{
  const{admin,ordinary}=await setup(h);await appointRegent(h,admin,ordinary);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_requests')))return;h.beforeBatch=null;h.sql.exec('DELETE FROM court_regent');};
  await h.api('/court/chat',post(ordinary,{requestId:crypto.randomUUID(),text:'失効した応対'},409));assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM court_chat WHERE body LIKE '%失効%' ").get().n,0);await appointRegent(h,admin,ordinary);
  let changed=false;h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-court-office')))return;changed=true;h.sql.exec('DELETE FROM court_regent');};await h.api('/staff/court',{token:ordinary.token,expected:409});assert(changed);h.beforeBatch=null;
 });
 await scope('ban and operator promotion clear regency durably so unban or later role loss cannot resurrect it',async h=>{
  const{admin,ordinary,staff}=await setup(h);await appointRegent(h,admin,ordinary);const before=(await directory(h,admin)).revision;
  h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)').run(ordinary.user.id,admin.user.id,h.now);assert.equal(h.sql.prepare('SELECT * FROM court_regent').get(),undefined);assert((await directory(h,admin)).revision>before);
  h.sql.prepare('UPDATE player_bans SET active=0,revision=revision+1 WHERE user_id=?').run(ordinary.user.id);assert.equal((await h.api('/shogunate',{token:ordinary.token})).data.shogunate.canApprove,false);
  await appointRegent(h,admin,staff);h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(staff.user.id);assert.equal(h.sql.prepare('SELECT * FROM court_regent').get(),undefined);h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(admin.user.id);assert.equal((await h.api('/shogunate',{token:staff.token})).data.shogunate.canApprove,false);
 });
 await scope('a suspended admin-directory response cannot publish old holder data after its revision changes',async h=>{
  const{admin,ordinary}=await setup(h);await appointRegent(h,admin,ordinary);let changed=false;h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-court-office')))return;changed=true;h.sql.exec('DELETE FROM court_regent');};
  const response=await h.api('/admin/court/regent',{token:admin.token,expected:409});assert(changed);assert.equal(response.data.holder,undefined);assert.equal(response.data.error.code,'REGENT_ACCESS_CHANGED');h.beforeBatch=null;
 });
}finally{globalThis.fetch=network;}
console.log(`${checks} regency scenarios / ${calls} API calls passed.`);
