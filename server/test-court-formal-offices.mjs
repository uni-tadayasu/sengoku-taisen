import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row} from './test-court-support.mjs';
import {COURT_OFFICES} from './court-offices.js';
let checks=0,calls=0,maxBindings=0;
async function scope(name,run){const h=harness(),statement=h.db.statement;h.db.statement=function(sql,params){maxBindings=Math.max(maxBindings,params.length);assert(params.length<=100,'D1 binding limit');return statement.call(this,sql,params);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const directory=async(h)=>(await h.api('/admin/court/offices',{token:h.operator.token})).data;
async function office(h,p,id,action='appoint'){const d=await directory(h);return(await h.api('/admin/court/offices',post(h.operator,{requestId:crypto.randomUUID(),action,officeId:id,targetPlayerId:p.user.id,expectedRevision:d.revision}))).data;}
async function preview(h,p){const d=(await h.api('/court/membership',{token:p.token})).data.membership;return{preview:d,body:{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:d.expectedRevision,expectedHomeCastleId:d.homeCastleId,expectedJoinMode:d.joinMode,expectedOfficeToken:d.officeAppointmentToken,confirmed:true,houseId:'kujo'}};}
async function join(h,p){const shown=await preview(h,p);return{...shown,result:(await h.api('/court/membership',post(p,shown.body))).data};}
const current=async(h,p)=>(await h.api('/court',{token:p.token})).data;
function merit(h,p,points,termId){while(points>0){const n=Math.min(128,points);h.sql.prepare("INSERT INTO court_contributions VALUES(?,?,?,'castle','kyoto_gosho',?,?,0,?)").run(crypto.randomUUID(),p.user.id,termId,n,n,h.now);points-=n;}}
const SANGI={id:'sangi',title:'参議',jurisdiction:'kyoto'};

for(const def of COURT_OFFICES)await scope(def.title+' ends on admission and a formal Sangi starts in the retained home',async h=>{
 await fixture(h,'参議就任の太政大臣',{admin:true});const p=await fixture(h,'任命から正式加入 '+def.title,{score:35000}),other=await fixture(h,'別の任命候補');
 await office(h,p,def.id);merit(h,p,2000,null);
 assert.equal((await current(h,p)).self.officeJurisdiction,'external');
 const admitted=await join(h,p);assert.deepEqual(admitted.preview.inheritedOffice,{id:def.id,title:def.title});assert.deepEqual(admitted.preview.startingOffice,SANGI);assert.deepEqual(admitted.result.admission.formalOffice,SANGI);assert.equal(admitted.result.admission.inheritedOffice,null);
 assert.equal(admitted.result.save.state.home,'kiyosu');assert.equal(admitted.result.user.courtMember,true);assert.equal(admitted.result.user.isStaff,false);assert.equal(admitted.result.user.isAdmin,false);assert.equal(admitted.result.entitlements.courtEstate,true);
 const self=(await current(h,p)).self;assert.equal(self.title,'参議');assert.equal(self.merit,0);assert.equal(self.officeJurisdiction,'kyoto');assert.equal(self.canRespond,true);assert.equal(self.canAppoint,false);
 const publicUser=(await h.api('/players?q='+encodeURIComponent(p.user.name))).data.players.find(u=>u.id===p.user.id);assert.deepEqual(publicUser.courtOffice,{title:'参議',kind:'official',jurisdiction:'kyoto'});assert(!Object.hasOwn(publicUser,'isStaff'));
 const roster=(await h.api('/staff/court',{token:p.token})).data.roster.filter(person=>person.id===p.user.id);assert.equal(roster.length,1);assert.equal(roster[0].title,'参議');assert.equal(roster[0].officeJurisdiction,'kyoto');assert.equal(roster[0].canBecomeEmperor,false);
 const d=await directory(h),seat=d.offices.find(o=>o.id===def.id);assert.equal(seat.holder,null);assert.equal(seat.blockedByKyoto,def.id==='sangi');assert.equal(seat.appointmentToken,null);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_office_appointments WHERE user_id=?').get(p.user.id).n,0);assert(!d.candidates.some(c=>c.id===p.user.id));
 if(def.id==='sangi')await h.api('/admin/court/offices',post(h.operator,{requestId:crypto.randomUUID(),action:'appoint',officeId:def.id,targetPlayerId:other.user.id,expectedRevision:d.revision},409));else await office(h,other,def.id);
 assert.equal((await h.api('/court/events',{token:p.token})).data.canManage,true);
 const estate=(await h.api('/court/estate',{token:p.token})).data;assert.equal(estate.courtEstate.role.title,'参議');assert.equal(estate.courtEstate.role.jurisdiction,'kyoto');assert.equal(estate.courtEstate.home.id,'kiyosu');
 const chat=(await h.api('/court/chat',post(p,{requestId:crypto.randomUUID(),text:'正式な参議として参内します。'}))).data;assert.equal(chat.message.author.kind,'court');assert.equal(chat.message.author.id,null);
 const retry=(await h.api('/court/membership',post(p,admitted.body))).data;assert.equal(retry.admission.idempotent,true);assert.deepEqual(retry.admission.formalOffice,SANGI);
});
await scope('ordinary formal admission starts at zero current-term merit and promotes at each earned threshold',async h=>{
 await fixture(h,'通常加入の太政大臣',{admin:true});const p=await fixture(h,'旧功績を持つ加入者',{score:35000});merit(h,p,2000,'old-term');
 const admitted=await join(h,p),term=admitted.result.admission.termId;assert.equal(admitted.result.save.state.home,'kyoto_gosho');assert.deepEqual(admitted.result.admission.formalOffice,SANGI);
 let earned=0;for(const def of COURT_OFFICES){merit(h,p,def.minMerit-earned,term);earned=def.minMerit;const data=await current(h,p);assert.equal(data.self.title,def.title);assert.equal(data.self.merit,def.minMerit);assert.equal(data.self.officeJurisdiction,'kyoto');assert.equal(data.lineage.canCreateImperialHouse,def.id==='sadaijin');}
});
await scope('shared construction is credited to the retained term, excluding jobs ordered before admission',async h=>{
 await fixture(h,'普請功績の太政大臣',{admin:true});const p=await fixture(h,'在任期間の普請担当',{score:35000});await office(h,p,'udaijin');
 async function build(id){const v=(await h.api('/court/estate',{token:p.token})).data.courtEstate;return(await h.api('/court/estate/upgrade',post(p,{requestId:crypto.randomUUID(),kind:'building',id,baseRevision:v.base.revision,accessStamp:v.accessStamp,deviceId:p.deviceId,expectedRevision:row(h,p).revision}))).data;}
 const before=await build('farm');assert.equal(before.receipt.staffTerm,null);const admitted=await join(h,p),term=admitted.result.admission.termId,after=await build('market');assert.equal(after.receipt.staffTerm,term);
 const state=JSON.parse(h.sql.prepare("SELECT state_json FROM staff_base WHERE id='kyoto_gosho'").get().state_json);assert.equal(state.jobs.find(j=>j.jobId===after.receipt.jobId).startedBy.termId,term);
 const end=Math.max(...state.jobs.map(j=>j.completesElapsedMs))+1;h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1 WHERE id='world-v1'").run(end,h.now);
 await h.api('/court/estate',{token:p.token});const self=(await current(h,p)).self;assert.equal(self.merit,after.receipt.targetLevel);assert.equal(h.sql.prepare('SELECT staff_term FROM court_contributions WHERE job_id=?').get(before.receipt.jobId).staff_term,null);assert.equal(h.sql.prepare('SELECT staff_term FROM court_contributions WHERE job_id=?').get(after.receipt.jobId).staff_term,term);
 const entitlement=h.sql.prepare('SELECT authority_key FROM court_estate_current WHERE user_id=?').get(p.user.id);assert.equal(entitlement.authority_key,'member:'+term);
});
await scope('established pre-migration staff keep their progress, and a new term starts at Sangi',async h=>{
 await fixture(h,'既存在任の太政大臣',{admin:true});const p=await fixture(h,'既存の正規左大臣',{staff:true});
 // A missing marker is exactly the shape of an already active pre-v5.25 term.
 h.sql.prepare('DELETE FROM court_rank_terms WHERE user_id=?').run(p.user.id);merit(h,p,2000,'historical-term');assert.equal((await current(h,p)).self.title,'左大臣');
 h.sql.prepare('UPDATE staff_members SET appointed_by=appointed_by WHERE user_id=?').run(p.user.id);assert.equal((await current(h,p)).self.title,'左大臣');
 h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run('new-formal-term',p.user.id);const restarted=await current(h,p);assert.equal(restarted.self.title,'参議');assert.equal(restarted.self.merit,0);merit(h,p,50,'new-formal-term');assert.equal((await current(h,p)).self.title,'中納言');
});
await scope('current membership decides formal status and stale admission receipts never restore a former appointment',async h=>{
 await fixture(h,'状態確認の太政大臣',{admin:true});const p=await fixture(h,'所属状態を確認する領主',{score:35000});await office(h,p,'sadaijin');const admitted=await join(h,p);
 h.sql.prepare('DELETE FROM court_retained_memberships WHERE user_id=?').run(p.user.id);
 const me=(await h.api('/me',{token:p.token})).data.user;assert.equal(me.courtMember,false);assert.equal(me.courtOffice,null);
 const retry=(await h.api('/court/membership',post(p,admitted.body))).data;assert.equal(retry.admission.idempotent,true);assert.equal(retry.admission.formalOffice,null);assert.equal(retry.membership.isMember,false);assert.equal(retry.user.courtMember,false);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_office_appointments WHERE user_id=?').get(p.user.id).n,0);
 await h.api('/court/events',{token:p.token,expected:403});await h.api('/court/estate',{token:p.token,expected:403});
});
await scope('admission failure rolls back the former appointment, formal membership, term and receipt together',async h=>{
 await fixture(h,'原子性確認の太政大臣',{admin:true});const p=await fixture(h,'加入失敗時の任命右大臣',{score:35000});await office(h,p,'udaijin');const shown=await preview(h,p),original=h.sql.prepare('SELECT * FROM court_office_appointments WHERE user_id=?').get(p.user.id);
 h.sql.exec("CREATE TEMP TRIGGER reject_formal_admission BEFORE UPDATE ON player_saves BEGIN SELECT RAISE(ABORT,'isolated admission rollback'); END");await h.api('/court/membership',post(p,shown.body,500));h.sql.exec('DROP TRIGGER reject_formal_admission');
 assert.deepEqual(h.sql.prepare('SELECT * FROM court_office_appointments WHERE user_id=?').get(p.user.id),original);for(const table of ['court_retained_memberships','court_rank_terms'])assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE user_id=?').get(p.user.id).n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_membership_requests WHERE actor_id=?').get(p.user.id).n,0);
});
console.log(`${checks} formal-office scenarios passed (${calls} API calls, max ${maxBindings} bindings).`);
