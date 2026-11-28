import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {harness,syncFieldWriter} from './test-support.mjs';
import {fixture,post,row,save,appoint,nominateSuccessor,certifySuccessor} from './test-court-support.mjs';
import {COURT_OFFICES} from './court-offices.js';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

let checks=0,calls=0,maxBindings=0;
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Court estate tests must not contact a real service');};
async function scope(name,run){const h=harness(),statement=h.db.statement;h.db.statement=function(sql,params){maxBindings=Math.max(maxBindings,params.length);assert(params.length<=100,'D1 binding limit');return statement.call(this,sql,params);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const baseRow=h=>h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get();
const base=h=>JSON.parse(baseRow(h).state_json);
const receipts=h=>h.sql.prepare('SELECT COUNT(*) n FROM staff_base_requests').get().n;
const estate=async(h,p)=>(await h.api('/court/estate',{token:p.token})).data;
async function regent(h,p,action='appoint'){const data=(await h.api('/admin/court/regent',{token:h.operator.token})).data;return h.api('/admin/court/regent',post(h.operator,{requestId:crypto.randomUUID(),action,targetPlayerId:p.user.id,expectedRevision:data.revision}));}
async function office(h,p,id='chunagon',action='appoint'){const data=(await h.api('/admin/court/offices',{token:h.operator.token})).data;return h.api('/admin/court/offices',post(h.operator,{requestId:crypto.randomUUID(),action,officeId:id,targetPlayerId:p.user.id,expectedRevision:data.revision}));}
async function setup(h,{staff=true}={}){const admin=await fixture(h,'共同領地の太政大臣',{admin:true}),ordinary=await fixture(h,'一般城の摂政',{startCastle:'inuyama'}),other=await fixture(h,'任命官職の領主',{startCastle:'himeji'}),member=staff?await fixture(h,'京都御所の領主',{staff:true}):null;return{admin,ordinary,other,member};}
const operation=(h,p,view,kind='building',id='farm')=>({requestId:crypto.randomUUID(),kind,id,baseRevision:view.courtEstate.base.revision,accessStamp:view.courtEstate.accessStamp,deviceId:p.deviceId,expectedRevision:Number(row(h,p).revision)});
const upgrade=(h,p,body,expected=200)=>h.api('/court/estate/upgrade',post(p,body,expected));
const assets=(h,p)=>({resources:structuredClone(save(h,p).state.resources),command:save(h,p).state.command,revision:row(h,p).revision});
function paid(before,after,receipt){for(const key of ['gold','rice','wood','stone'])assert.equal(after.resources[key],before.resources[key]-(receipt.cost[key]||0),key+' debited once');assert.equal(after.command,before.command-1);assert.equal(after.revision,before.revision+1);}
function keepPersonal(before,after){for(const key of ['home','clan','buildings','castles','jobs','tech','troops','magatama','governors','officers','staffService'])assert.deepEqual(after[key],before[key],key+' stays personal');}
function finish(h){const end=Math.max(...base(h).jobs.map(job=>job.completesElapsedMs))+1;h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1 WHERE id='world-v1'").run(end,h.now);}
function race(h,mutate){h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO staff_base_requests')))return;h.beforeBatch=null;mutate();};}
function barrier(h){let hits=0,release;const ready=new Promise(done=>release=done);h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO staff_base_requests')))return;if(++hits===2){h.beforeBatch=null;release();}await ready;};}

try{
 await scope('ordinary regent keeps home, all personal buildings and economy while funding shared Kyoto',async h=>{
  const{ordinary,member,other}=await setup(h);await regent(h,ordinary);
  const before=structuredClone(save(h,ordinary).state),memberBefore=row(h,member),otherBefore=row(h,other),view=await estate(h,ordinary),e=view.courtEstate;
  assert.equal(e.role.id,'regent');assert.equal(e.home.id,'inuyama');assert.equal(e.holding.ownership,'shared');assert.equal(e.holding.homePreserved,true);assert.equal(e.actions.length,65);assert.equal(e.actions.filter(a=>a.kind==='building').length,64);assert.equal(e.base.castleLevel,1);assert.equal(e.base.buildings.keep,base(h).initial.buildings.keep);assert.equal(e.resources.gold,900000);
  const quote=e.actions.find(a=>a.id==='farm'),beforeAssets=assets(h,ordinary),result=(await upgrade(h,ordinary,operation(h,ordinary,view))).data;
  assert.equal(result.idempotent,false);assert.deepEqual(result.receipt.cost,quote.cost);paid(beforeAssets,assets(h,ordinary),result.receipt);keepPersonal(before,save(h,ordinary).state);assert.deepEqual(row(h,member),memberBefore);assert.deepEqual(row(h,other),otherBefore);
  assert.equal(result.user.isStaff,false);assert.equal(result.save.state.home,'inuyama');assert.equal(result.staffBase,null);assert.equal(result.entitlements.courtEstate,true);assert.equal(result.courtEstate.base.jobs[0].startedBy.id,ordinary.user.id);
  const staffView=(await h.api('/staff/base',{token:member.token})).data.staffBase;assert.equal(staffView.jobs[0].jobId,result.receipt.jobId);assert.equal(staffView.jobs[0].startedBy.termId,null);
  const personal=GameEngine.fromSave(result.save,GAME_OFFICERS,{isCourtProtected:true});assert.equal(personal.isStaff,false);assert(!personal.ownedCastleIds().includes('kyoto_gosho'));assert.equal(personal.state.buildings.keep,before.buildings.keep);
  if(process.env.COURT_ESTATE_FIXTURE)writeFileSync(process.env.COURT_ESTATE_FIXTURE,JSON.stringify({ok:true,courtEstate:result.courtEstate,courtEstateProjection:result.courtEstateProjection,clock:result.clock},null,2));
  finish(h);const completed=await estate(h,ordinary);assert.equal(completed.courtEstate.base.buildings.farm,quote.targetLevel);assert.equal(completed.courtEstate.base.jobs.length,0);assert.equal((await h.api('/staff/base',{token:member.token})).data.staffBase.buildings.farm,quote.targetLevel);assert.equal(save(h,ordinary).state.buildings.farm,before.buildings.farm);assert.equal(h.sql.prepare('SELECT staff_term FROM court_contributions WHERE actor_id=?').get(ordinary.user.id).staff_term,null);
 });
 await scope('all six external offices qualify without becoming staff or acquiring private court powers',async h=>{
  const{ordinary,other}=await setup(h,{staff:false});
  await h.api('/court/estate',{expected:401});await h.api('/court/estate',{token:ordinary.token,expected:403});
  for(const def of COURT_OFFICES){h.resetRates();await office(h,ordinary,def.id);const before=structuredClone(save(h,ordinary).state),info=(await h.api('/court',{token:ordinary.token})).data;
   assert.equal(info.self.canDevelopEstate,true);assert.equal(info.features.estate,true);assert.equal(info.self.canRespond,false);assert.equal(info.self.canAppoint,false);assert.equal(info.features.eventRoom,false);assert.equal(info.features.roster,false);
   const view=await estate(h,ordinary);assert.equal(view.courtEstate.role.id,def.id);assert.equal(view.courtEstate.home.id,'inuyama');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM staff_members').get().n,0);keepPersonal(before,save(h,ordinary).state);
   await h.api('/staff/base',{token:ordinary.token,expected:403});await h.api('/staff/court',{token:ordinary.token,expected:403});await h.api('/court/events',{token:ordinary.token,expected:403});
   await office(h,ordinary,def.id,'dismiss');await h.api('/court/estate',{token:ordinary.token,expected:403});
  }
  const forged=operation(h,other,{courtEstate:{base:{revision:0},accessStamp:'forged'}});await upgrade(h,other,forged,403);
 });
 await scope('below-rank external appointee sees the estate entry while visitor chat and audiences remain locked',async h=>{
  await fixture(h,'低位階検証の太政大臣',{admin:true});const p=await h.session('低位階の任命領主');p.deviceId=p.user.id+'-estate';const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
  const game=new GameEngine({officers:GAME_OFFICERS,startCastle:'inuyama'});game.applyWorldClock(lease.clock);await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save:JSON.parse(game.exportSave())}});await office(h,p,'sadaijin');
  const info=(await h.api('/court',{token:p.token})).data;assert.equal(info.eligible,false);assert.equal(info.features.conversation,false);assert.equal(info.features.audience,false);assert.equal(info.features.estate,true);assert.equal(info.self.canDevelopEstate,true);assert.equal((await estate(h,p)).courtEstate.home.id,'inuyama');await h.api('/court/chat',{token:p.token,expected:403});
 });
 await scope('appointed minister can upgrade the shared castle and preserves the personal castle levels',async h=>{
  const{other,member}=await setup(h);await office(h,other);const view=await estate(h,other),before=structuredClone(save(h,other).state),paidBefore=assets(h,other),result=(await upgrade(h,other,operation(h,other,view,'castle','kyoto_gosho'))).data;
  paid(paidBefore,assets(h,other),result.receipt);keepPersonal(before,save(h,other).state);assert.equal(result.receipt.targetLevel,2);assert.equal(result.courtEstate.base.castleLevel,1);assert.equal((await h.api('/staff/base',{token:member.token})).data.staffBase.jobs[0].targetLevel,2);
  finish(h);assert.equal((await estate(h,other)).courtEstate.base.castleLevel,2);assert.equal(save(h,other).state.castles.kyoto_gosho.level,before.castles.kyoto_gosho.level);
 });
 await scope('Chancellor and Kyoto member share the new flow while the old staff endpoint remains strict',async h=>{
  const{admin,member}=await setup(h);for(const p of [admin,member]){const view=await estate(h,p),before=structuredClone(save(h,p).state),paidBefore=assets(h,p),body=operation(h,p,view,'building',p===admin?'farm':'market'),result=(await upgrade(h,p,body)).data;paid(paidBefore,assets(h,p),result.receipt);assert.equal(result.courtEstate.home.id,p===admin?'edo':'kyoto_gosho');keepPersonal(before,save(h,p).state);}
  const legacy=operation(h,admin,await estate(h,admin));delete legacy.accessStamp;await h.api('/staff/base/upgrade',post(admin,legacy,403));
 });
 await scope('retired Emperor keeps the restored ordinary home and gains shared development only',async h=>{
  const{admin,ordinary,member}=await setup(h),next=await fixture(h,'後継の天皇候補',{staff:true});
  await appoint(h,member);const nomination=(await nominateSuccessor(h,member,next)).nomination;await certifySuccessor(h,admin,nomination);await h.api('/sync?deviceId='+member.deviceId,{token:member.token});
  const view=await estate(h,member),before=structuredClone(save(h,member).state);assert.equal(view.courtEstate.role.id,'retired-emperor');assert.notEqual(before.home,'kyoto_gosho');assert.equal(view.courtEstate.home.id,before.home);
  const result=(await upgrade(h,member,operation(h,member,view))).data;assert.equal(result.user.isStaff,false);keepPersonal(before,save(h,member).state);assert.equal(result.courtEstate.role.title,'上皇');await h.api('/court/succession',{token:member.token,expected:403});
 });
 await scope('idempotent retries, unknown outcomes and semantic request reuse cannot double charge',async h=>{
  const{ordinary}=await setup(h);await regent(h,ordinary);const view=await estate(h,ordinary),body=operation(h,ordinary,view),before=assets(h,ordinary);
  h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO staff_base_requests'))){h.afterBatch=null;throw Error('isolated response loss');}};
  await upgrade(h,ordinary,body,500);const replay=(await upgrade(h,ordinary,{...body,deviceId:'reconnected',expectedRevision:0})).data;assert.equal(replay.idempotent,true);paid(before,assets(h,ordinary),replay.receipt);assert.equal(receipts(h),1);assert.equal(base(h).jobs.length,1);
  await upgrade(h,ordinary,{...body,id:'market'},409);await upgrade(h,ordinary,{...body,baseRevision:body.baseRevision+1},409);paid(before,assets(h,ordinary),replay.receipt);
 });
 await scope('duplicate and competing writers serialize one shared debit and receipt',async h=>{
  const{ordinary,other}=await setup(h);await regent(h,ordinary);await office(h,other);const view=await estate(h,ordinary),body=operation(h,ordinary,view),before=assets(h,ordinary);barrier(h);
  const duplicate=await Promise.all([upgrade(h,ordinary,body),upgrade(h,ordinary,body)]);assert.deepEqual(duplicate.map(r=>r.data.idempotent).sort(),[false,true]);paid(before,assets(h,ordinary),duplicate[0].data.receipt);assert.equal(receipts(h),1);
  const a=operation(h,ordinary,await estate(h,ordinary),'building','market'),b=operation(h,other,await estate(h,other),'building','market'),balances=[assets(h,ordinary),assets(h,other)];barrier(h);const results=await Promise.all([upgrade(h,ordinary,a,null),upgrade(h,other,b,null)]);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);assert.equal(receipts(h),2);for(let i=0;i<2;i++){const p=[ordinary,other][i];if(results[i].response.status===200)paid(balances[i],assets(h,p),results[i].data.receipt);else assert.deepEqual(assets(h,p),balances[i]);}
 });
 await scope('a failed transaction leaves payer, shared progress and receipts unchanged',async h=>{
  const{ordinary}=await setup(h);await regent(h,ordinary);const body=operation(h,ordinary,await estate(h,ordinary)),before={player:row(h,ordinary),base:baseRow(h),count:receipts(h)};
  h.sql.exec("CREATE TEMP TRIGGER reject_estate BEFORE UPDATE ON staff_base BEGIN SELECT RAISE(ABORT,'isolated rollback'); END");await upgrade(h,ordinary,body,500);h.sql.exec('DROP TRIGGER reject_estate');assert.deepEqual(row(h,ordinary),before.player);assert.deepEqual(baseRow(h),before.base);assert.equal(receipts(h),before.count);
 });
 for(const role of ['regent','office'])for(const change of ['dismiss','reappoint'])await scope(role+' '+change+' before commit invalidates every pending estate effect',async h=>{
  const{ordinary}=await setup(h);if(role==='regent')await regent(h,ordinary);else await office(h,ordinary);
  const body=operation(h,ordinary,await estate(h,ordinary)),before={player:row(h,ordinary),base:baseRow(h),count:receipts(h)},table=role==='regent'?'court_regent':'court_office_appointments';
  race(h,()=>change==='dismiss'?h.sql.prepare('DELETE FROM '+table+' WHERE user_id=?').run(ordinary.user.id):h.sql.prepare('UPDATE '+table+' SET appointment_token=? WHERE user_id=?').run(crypto.randomUUID(),ordinary.user.id));
  const result=await upgrade(h,ordinary,body,409);assert.equal(result.data.error.code,'COURT_ESTATE_ACCESS_CHANGED');assert.deepEqual(row(h,ordinary),before.player);assert.deepEqual(baseRow(h),before.base);assert.equal(receipts(h),before.count);
 });
 await scope('dismissal and reappointment between quote and click rejects the old access stamp',async h=>{
  const{ordinary}=await setup(h);await regent(h,ordinary);const body=operation(h,ordinary,await estate(h,ordinary)),before=assets(h,ordinary);await regent(h,ordinary,'dismiss');await regent(h,ordinary);assert.notEqual((await estate(h,ordinary)).courtEstate.accessStamp,body.accessStamp);assert.equal((await upgrade(h,ordinary,body,409)).data.error.code,'COURT_ESTATE_ACCESS_CHANGED');assert.deepEqual(assets(h,ordinary),before);assert.equal(receipts(h),0);
 });
 for(const change of ['lease','player-revision','base-revision','clock'])await scope(change+' conflict cannot debit resources or add a shared job',async h=>{
  const{ordinary}=await setup(h);await regent(h,ordinary);const body=operation(h,ordinary,await estate(h,ordinary)),before={state:save(h,ordinary),base:base(h),count:receipts(h)};
  race(h,()=>{if(change==='lease')h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run('another-device',ordinary.user.id);if(change==='player-revision')h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(ordinary.user.id);if(change==='base-revision')h.sql.exec('UPDATE staff_base SET revision=revision+1');if(change==='clock')h.sql.exec('UPDATE world_clock SET revision=revision+1');});
  await upgrade(h,ordinary,body,409);assert.deepEqual(save(h,ordinary),before.state);assert.deepEqual(base(h),before.base);assert.equal(receipts(h),before.count);
 });
 await scope('final response authorization drops a private estate response after late role revocation',async h=>{
  const{ordinary}=await setup(h);await office(h,ordinary);let guards=0;
  h.beforeStatement=query=>{if(!query.startsWith('SELECT 1 AS allowed WHERE ')||!query.includes('court_external_offices WHERE user_id=? AND office_id=? AND appointment_token=?'))return;if(++guards===4){h.beforeStatement=null;h.sql.prepare('DELETE FROM court_office_appointments WHERE user_id=?').run(ordinary.user.id);}};
  const result=await h.api('/court/estate',{token:ordinary.token,expected:409});assert.equal(guards,4);assert.equal(result.data.courtEstate,undefined);assert.equal(result.data.error.code,'COURT_ESTATE_ACCESS_CHANGED');
 });
 await scope('guarded court entry does not return stale estate flags after final identity decoration',async h=>{
  const{ordinary}=await setup(h);await office(h,ordinary);let changed=false;h.afterBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-court-office')))return;changed=true;h.afterBatch=null;h.sql.prepare('DELETE FROM court_office_appointments WHERE user_id=?').run(ordinary.user.id);};
  await h.api('/court',{token:ordinary.token,expected:409});assert(changed);
 });
 await scope('shared keep controls locks, queues and caps without using the personal keep',async h=>{
  const{ordinary}=await setup(h);await regent(h,ordinary);let view=await estate(h,ordinary);assert.equal(save(h,ordinary).state.buildings.keep,16);assert.equal(view.courtEstate.base.buildings.keep,base(h).initial.buildings.keep);
  const locked=view.courtEstate.actions.find(a=>a.code==='BUILDING_LOCKED');assert(locked);await upgrade(h,ordinary,operation(h,ordinary,view,'building',locked.id),409);
  let state=base(h);state.initial.castleLevel=128;state.castleLevel=128;state.initial.buildings.farm=32;state.buildings.farm=32;h.sql.prepare('UPDATE staff_base SET state_json=?,revision=revision+1').run(JSON.stringify(state));view=await estate(h,ordinary);
  for(const id of ['kyoto_gosho','farm']){const action=view.courtEstate.actions.find(a=>a.id===id);assert.equal(action.enabled,false);assert.equal(action.code,'BUILDING_MAX');assert.equal(action.cost,null);assert.equal(action.targetLevel,null);await upgrade(h,ordinary,operation(h,ordinary,view,action.kind,id),409);}
  const body=operation(h,ordinary,view,'building','market');for(const extra of [{cost:{gold:0}},{isStaff:true},{baseRevision:-1},{kind:'research'},{id:'edo',kind:'castle'}])await upgrade(h,ordinary,{...body,...extra},400);
  for(const value of [null,[],1,'estate'])await h.api('/court/estate/upgrade',{method:'POST',token:ordinary.token,rawBody:JSON.stringify(value),expected:400});
 });
 await scope('revocation stops estate access while completed and pending shared growth survive',async h=>{
  const{ordinary,member}=await setup(h);await regent(h,ordinary);const body=operation(h,ordinary,await estate(h,ordinary)),accepted=(await upgrade(h,ordinary,body)).data;await regent(h,ordinary,'dismiss');await h.api('/court/estate',{token:ordinary.token,expected:403});await upgrade(h,ordinary,body,403);assert.equal((await h.api('/sync?deviceId='+ordinary.deviceId,{token:ordinary.token})).data.entitlements.courtEstate,false);assert.equal(base(h).jobs[0].jobId,accepted.receipt.jobId);
  finish(h);const shared=(await h.api('/staff/base',{token:member.token})).data.staffBase;assert.equal(shared.buildings.farm,accepted.receipt.targetLevel);assert.equal(shared.jobs.length,0);assert.equal(receipts(h),1);assert.equal(save(h,ordinary).state.home,'inuyama');
 });
}finally{globalThis.fetch=network;}
console.log(JSON.stringify({ok:true,checks,calls,maxBindings,productionRequests:0},null,2));
