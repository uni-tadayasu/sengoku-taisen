// Real Worker branch commands, authoritative clock/ledger, retries and rollback.
// Field combat is intentionally exercised by the separate field-branch suite.
import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {fixture,post,row,save,count,updateSave} from './test-court-support.mjs';

const clone=value=>value===undefined?undefined:structuredClone(value),failures=[];
let checks=0,calls=0;
const filter=process.env.BRANCH_API_TEST_FILTER||'';
async function scope(name,run){if(filter&&!name.includes(filter))return;const h=harness();try{await run(h);checks++;console.log('PASS '+name);}catch(error){failures.push({name,error});console.error('FAIL '+name+'\n'+error.stack);}finally{calls+=h.calls;h.close();}}
const ledger=(h,p,campaignId=save(h,p).state.walking.campaignId)=>h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,campaignId);
const model=(h,p)=>{const r=ledger(h,p);return r?JSON.parse(r.state_json):{branches:[],jobs:[]};};
const receipts=(h,p)=>h.sql.prepare('SELECT * FROM branch_requests WHERE actor_id=? ORDER BY request_id').all(p.user.id);
const stable=(h,p)=>({save:clone(row(h,p)),ledger:clone(ledger(h,p)),receipts:clone(receipts(h,p))});
function body(h,p,extra={}){const r=row(h,p),s=JSON.parse(r.save_json).state;return{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:r.revision,campaignId:s.walking.campaignId,sequence:Number(ledger(h,p)?.sequence||0),...extra};}
const status=async(h,p)=>(await h.api('/branches?deviceId='+p.deviceId,{token:p.token})).data;
const command=async(h,p,action,extra={},expected=200)=>(await h.api('/branches/'+action,post(p,body(h,p,extra),expected))).data;
const put=async(h,p,value,expected=200)=>(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected})).data;
function worldAt(h,elapsedMs){h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1 WHERE id='world-v1'").run(elapsedMs,h.now);}
function anchor(value,elapsedMs){value.state.worldClock={id:'world-v1',elapsedMs};value.state.turn=Math.floor(elapsedMs/60000);value.state.realtime.elapsed=elapsedMs%60000/1000;return value;}
async function syncNow(h,p){const snap=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;const game=GameEngine.fromSave(snap.save,GAME_OFFICERS,{isAdmin:snap.user.isAdmin,isStaff:snap.user.isStaff,staffBase:snap.staffBase});const result=game.applyWorldClock(snap.clock);assert(result.ok);assert(!result.pending);return put(h,p,JSON.parse(game.exportSave()));}
async function finish(h,p,id){const job=model(h,p).jobs.find(job=>job.id===id);assert(job,'accepted authoritative job');worldAt(h,job.completesElapsedMs);return syncNow(h,p);}
function authoritativeBranch(h,p,id,change){const state=model(h,p),branch=state.branches.find(row=>row.id===id);assert(branch);change(branch,state);h.sql.prepare('UPDATE branch_states SET sequence=sequence+1,state_json=? WHERE actor_id=? AND campaign_id=?').run(JSON.stringify(state),p.user.id,save(h,p).state.walking.campaignId);const value=save(h,p);value.state.branches=clone(state.branches);value.state.jobs=value.state.jobs.filter(job=>job.kind!=='branch');h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(value),p.user.id);}
function assertCharges(before,after,cost){const owned=Object.entries(before.state.castles).filter(([id,castle])=>id!=='kyoto_gosho'&&castle.owner===before.state.clan).length,multiplier=2**Math.max(0,owned-1);for(const key of ['gold','rice','wood','stone'])assert.equal(after.state.resources[key],before.state.resources[key]-(cost[key]||0)*multiplier,key);assert.equal(after.state.command,before.state.command-1);}
const errorCode=result=>result.error?.code;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Branch API tests must not contact a real service');};
try{
 await scope('authenticated status returns canonical parents and unknown commands/input are rejected',async h=>{
  await h.api('/branches',{expected:401});await h.api('/branches/build',{method:'POST',body:{},expected:401});
  const empty=await h.session('保存前の支拠点');const absent=(await h.api('/branches',{token:empty.token})).data;assert.deepEqual(absent.branchState,{branches:[],jobs:[]});assert.equal(absent.campaignId,null);
  const p=await fixture(h,'支拠点の読取',{holdings:['nijo']});const s=await status(h,p);assert.equal(s.sequence,0);assert.equal(s.campaignId,save(h,p).state.walking.campaignId);assert.deepEqual(s.parents.map(p=>[p.parentCastleId,p.maxBranches,p.maxLevel]),[['edo',4,8],['nijo',2,24],['osaka',2,24],['nagoya',2,24]]);assert(s.parents.find(x=>x.parentCastleId==='nijo').available);assert(!s.parents.find(x=>x.parentCastleId==='edo').available);assert(s.writable);assert.equal(count(h,'branch_states'),0);
  await h.api('/branches?extra=1',{token:p.token,expected:400});await h.api('/branches/unknown',post(p,{},404));
  for(const extra of [{direction:'northwest'},{direction:''},{direction:1},{parentCastleId:'kyoto_gosho'},{parentCastleId:'sunpu'},{parentCastleId:'missing'}])assert.equal(errorCode(await command(h,p,'build',{parentCastleId:'nijo',direction:'north',...extra},400)),'INVALID_BRANCH_PARENT');
  for(const extra of [{sequence:-1},{sequence:'0'},{expectedRevision:.5},{requestId:'bad/id'},{campaignId:null},{cost:{gold:0}},{isAdmin:true},{fallen:false}])await command(h,p,'build',{parentCastleId:'nijo',direction:'north',...extra},400);
  assert.equal(receipts(h,p).length,0);assert.equal(count(h,'branch_states'),0);
 });
 await scope('build pays once and records a real absolute deadline after catching up a fresh checkpoint',async h=>{
  const p=await fixture(h,'建設する領主',{holdings:['nijo']}),before=save(h,p),cost=GameEngine.branchUpgradeCost('nijo',0);worldAt(h,5000);
  const sim=GameEngine.fromSave(before,GAME_OFFICERS);sim.applyWorldClock({...((await h.api('/world-clock')).data.clock)});const afterCatchup=JSON.parse(sim.exportSave());
  const r=await command(h,p,'build',{parentCastleId:'nijo',direction:'north'});assert(r.ok&&!r.idempotent);assert.equal(r.result.branchId,'nijo_north');assert.equal(r.sequence,1);assert.equal(r.revision,2);assertCharges(afterCatchup,save(h,p),cost);assert.deepEqual(r.branchState.branches,[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:0,fallen:false}]);const job=model(h,p).jobs[0];assert.equal(job.kind,'branch');assert.equal(job.targetLevel,1);assert.equal(job.totalSeconds,60);assert.equal(job.completesElapsedMs,65000);assert(!('remainingSeconds'in job));assert.equal(r.branchState.jobs[0].remainingSeconds,60);assert.equal(save(h,p).state.worldClock.elapsedMs,5000);
  const snapshot=stable(h,p);await status(h,p);assert.deepEqual(stable(h,p),snapshot,'GET does not mutate a job, save or ledger');
  worldAt(h,64000);const partial=await syncNow(h,p);assert.equal(partial.save.state.branches[0].level,0);assert.equal(partial.save.state.jobs.find(j=>j.kind==='branch').remainingSeconds,1);assert.equal(model(h,p).jobs[0].completesElapsedMs,65000);assert.equal(ledger(h,p).sequence,1,'relative clock progress does not bump branch sequence');
  await finish(h,p,'nijo_north');const completed=await status(h,p);assert.equal(completed.branchState.branches[0].level,1);assert.deepEqual(completed.branchState.jobs,[]);assert.equal(model(h,p).jobs.length,0);assert.equal(completed.sequence,2);assert.equal(receipts(h,p).length,1);
 });
 await scope('paid branch and facility reservations share one FIFO on the same branch, run beside a different branch and settle at their own deadlines',async h=>{
  const p=await fixture(h,'支城の連続予約',{holdings:['nijo']}),id='nijo_north',facilityId='market',opening=save(h,p);
  const plans=[
   ['build',{parentCastleId:'nijo',direction:'north'},GameEngine.branchUpgradeCost('nijo',0)],
   ['upgrade',{branchId:id},GameEngine.branchUpgradeCost('nijo',1)],
   ['build-facility',{branchId:id,facilityId},GameEngine.branchFacilityCost('nijo',facilityId,0)],
   ['upgrade-facility',{branchId:id,facilityId},GameEngine.branchFacilityCost('nijo',facilityId,1)]
  ],deadlines=[];let paid=0,original;
  for(const [index,[operation,fields,cost]] of plans.entries()){
   const before=save(h,p),request=body(h,p,fields),r=(await h.api('/branches/'+operation,post(p,request))).data;
   if(index===1)original=request;
   assertCharges(before,r.save,cost);assert.equal(r.result.queued,index>0);assert.equal(r.result.queuePosition,index+1);
   assert.equal(r.result.startsInSeconds,paid);paid+=cost.seconds;deadlines.push(paid*1000);
   assert.deepEqual(model(h,p).jobs.map(j=>j.completesElapsedMs),deadlines);
  }
  const parallel=await command(h,p,'build',{parentCastleId:'nijo',direction:'east'});assert.equal(parallel.result.queuePosition,1);
  assert.equal(save(h,p).state.command,opening.state.command-5);const exhausted=stable(h,p);
  await command(h,p,'upgrade',{branchId:id},409);assert.deepEqual(stable(h,p),exhausted);
  const retry=(await h.api('/branches/upgrade',post(p,original))).data;assert(retry.idempotent);assert.equal(retry.revision,row(h,p).revision);assert.deepEqual(stable(h,p),exhausted);
  const legacy=save(h,p);delete legacy.state.branches;legacy.state.jobs=[];await put(h,p,legacy);assert.deepEqual(model(h,p).jobs.filter(j=>j.id===id).map(j=>j.completesElapsedMs),deadlines);
  // Public field information projects every due reservation without running
  // the owner's save, including multiple finished jobs on one branch.
  const scout=await fixture(h,'普請の推移を確認する領主',{startCastle:'inuyama'});
  const view=async at=>{worldAt(h,at);return(await h.api('/field',{token:scout.token})).data.targets.find(t=>t.playerId===p.user.id&&t.targetCastleId==='nijo').branches.find(b=>b.id===id);};
  assert.equal((await view(deadlines[0]-1)).level,0);assert.equal((await view(deadlines[1])).level,2);
  let branch=await view(deadlines[2]);assert.equal(branch.facilities[facilityId],1);assert(branch.building);
  branch=await view(deadlines[3]);assert.equal(branch.facilities[facilityId],2);assert.equal(branch.building,false);
  worldAt(h,deadlines[0]);let snapshot=await syncNow(h,p);
  assert.equal(snapshot.save.state.branches.find(b=>b.id==='nijo_east').level,1);
  assert.deepEqual(model(h,p).jobs.map(j=>j.completesElapsedMs),deadlines.slice(1));
  worldAt(h,deadlines[3]);snapshot=await syncNow(h,p);branch=snapshot.save.state.branches.find(b=>b.id===id);
  assert.equal(branch.level,2);assert.equal(branch.facilities[facilityId],2);assert.deepEqual(branch.facilityCompletedAt[facilityId],deadlines.slice(2));
  assert.equal(model(h,p).jobs.length,0);assert.equal(receipts(h,p).length,5);
 });
 await scope('a valid paid branch queue remains readable and writable beyond the previous whole-save limit of 193 jobs',async h=>{
  const p=await fixture(h,'大規模普請',{holdings:['nijo']}),id='nijo_north';
  await command(h,p,'build',{parentCastleId:'nijo',direction:'north'});await finish(h,p,id);
  authoritativeBranch(h,p,id,b=>{b.level=24;});
  const game=GameEngine.fromSave(save(h,p),GAME_OFFICERS),types=game.branchFacilityStatus(id).facilities.map(f=>f.id);
  for(const key of Object.keys(game.state.resources))game.state.resources[key]=GameEngine.ASSET_CAP;
  let end=game.state.worldClock.elapsedMs;
  // Reconstruct a valid long-running queue from fully paid facility commands.
  // The fixture supplies the instructions several hours of play would recover.
  for(let i=0;i<194;i++){
   const facility=types[Math.floor(i/24)];game.state.command=game.commandMax();
   const accepted=i%24?game.upgradeBranchFacility(id,facility):game.buildBranchFacility(id,facility);
   assert(accepted.ok);const j=game.state.jobs.at(-1);end+=j.totalSeconds*1000;j.completesElapsedMs=end;
  }
  const before=JSON.parse(game.exportSave()),jobs=before.state.jobs.map(({remaining,remainingSeconds,...rest})=>rest);
  h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(before),p.user.id);
  h.sql.prepare('UPDATE branch_states SET state_json=?,sequence=sequence+1 WHERE actor_id=? AND campaign_id=?').run(JSON.stringify({branches:before.state.branches,jobs}),p.user.id,before.state.walking.campaignId);
  assert.equal((await status(h,p)).branchState.jobs.length,194);assert.equal((await put(h,p,before)).save.state.jobs.length,194);
  const newest=await command(h,p,'upgrade-facility',{branchId:id,facilityId:types[8]});assert.equal(newest.result.queuePosition,195);assert.equal(newest.branchState.jobs[193].completesElapsedMs,end);
  assert(Buffer.byteLength(JSON.stringify(newest.save))<2*1024*1024);assert.equal(newest.branchState.jobs[194].completesElapsedMs,end+newest.branchState.jobs[194].totalSeconds*1000);
 });
 await scope('parent ownership, direction uniqueness, four/two placement limits and Kyoto exclusion hold on actual commands',async h=>{
  const p=await fixture(h,'方角と設置上限',{holdings:['nijo','osaka','nagoya']}),operator=await fixture(h,'江戸の設置上限',{admin:true});
  assert.equal(errorCode(await command(h,p,'build',{parentCastleId:'edo',direction:'north'},409)),'BRANCH_UNAVAILABLE');
  await command(h,p,'build',{parentCastleId:'nijo',direction:'north'});await command(h,p,'build',{parentCastleId:'nijo',direction:'south'});const before=stable(h,p);await command(h,p,'build',{parentCastleId:'nijo',direction:'north'},409);await command(h,p,'build',{parentCastleId:'nijo',direction:'east'},409);assert.deepEqual(stable(h,p),before);
  await command(h,p,'build',{parentCastleId:'osaka',direction:'east'});await command(h,p,'build',{parentCastleId:'osaka',direction:'west'});assert.equal(model(h,p).branches.length,4);assert.equal(model(h,p).jobs.length,4);await command(h,p,'build',{parentCastleId:'nagoya',direction:'north'},409);assert.equal(model(h,p).branches.length,4,'shared construction slots are enforced');
  for(const direction of ['north','east','south','west'])await command(h,operator,'build',{parentCastleId:'edo',direction});assert.equal(model(h,operator).branches.length,4);assert.equal(model(h,operator).jobs.length,4);const opBefore=stable(h,operator);await command(h,operator,'build',{parentCastleId:'edo',direction:'east'},409);assert.deepEqual(stable(h,operator),opBefore);await finish(h,operator,'edo_north');assert.equal((await status(h,operator)).parents.find(parent=>parent.parentCastleId==='edo').branches.filter(branch=>branch.level===1&&!branch.fallen).length,4);
  const staff=await fixture(h,'御所に支拠点なし',{staff:true});assert.equal(save(h,staff).state.home,'kyoto_gosho');await command(h,staff,'build',{parentCastleId:'kyoto_gosho',direction:'north'},400);assert.deepEqual((await status(h,staff)).branchState.branches,[]);
 });
 await scope('real upgrades reach each cap through timed commands without extra income/evaluation or a next level',async h=>{
  for(const [parent,cap,admin]of[['edo',8,true],['nijo',24,false]]){
   h.resetRates();const p=await fixture(h,'上限検証'+parent,{admin,holdings:admin?[]:[parent]});updateSave(h,p,s=>{s.castles[parent].troops=1000000;s.troops=100000;s.resources={gold:9000000,rice:9000000,wood:9000000,stone:9000000};});
   await command(h,p,'build',{parentCastleId:parent,direction:'north'});await finish(h,p,parent+'_north');
   for(let level=1;level<cap;level++){const before=save(h,p),cost=GameEngine.branchUpgradeCost(parent,level),r=await command(h,p,'upgrade',{branchId:parent+'_north'});assert.equal(r.result.targetLevel,level+1);assertCharges(before,save(h,p),cost);assert.equal(model(h,p).jobs[0].totalSeconds,level>=16?180:level>=6?120:60);await finish(h,p,parent+'_north');assert.equal(model(h,p).branches[0].level,level+1);}
   const before=stable(h,p);await command(h,p,'upgrade',{branchId:parent+'_north'},409);assert.deepEqual(stable(h,p),before);assert.equal(model(h,p).branches[0].level,cap);assert.equal(receipts(h,p).length,cap);assert.equal(save(h,p).state.stats.castleUpgrades,0);
  }
 });
 await scope('the complete ten-branch layout persists through authoritative commands and ordinary synchronization',async h=>{
  const p=await fixture(h,'全十支拠点',{admin:true,holdings:['nijo','osaka','nagoya']});updateSave(h,p,s=>{for(const parent of ['edo','nijo','osaka','nagoya'])s.castles[parent].troops=1000000;s.troops=100000;});
  for(const [parent,directions]of [['edo',['north','east','south','west']],['nijo',['north','south']],['osaka',['east','west']],['nagoya',['north','west']]])for(const direction of directions){await command(h,p,'build',{parentCastleId:parent,direction});await finish(h,p,parent+'_'+direction);}
  const current=await status(h,p);assert.equal(current.branchState.branches.length,10);assert.deepEqual(current.parents.map(parent=>[parent.parentCastleId,parent.branches.length,parent.maxBranches,parent.maxLevel]),[['edo',4,4,8],['nijo',2,2,24],['osaka',2,2,24],['nagoya',2,2,24]]);assert.equal(model(h,p).branches.length,10);assert.equal(receipts(h,p).length,10);assert.equal(GameEngine.fromSave(current.save,GAME_OFFICERS,{isAdmin:true}).activeBranches('edo').length,4);await put(h,p,current.save);assert.equal(model(h,p).branches.length,10);
 });
 await scope('repair uses a paid timed job, keeps the completed level and refuses intact/missing branches',async h=>{
  const p=await fixture(h,'修復する領主',{holdings:['nijo']});await command(h,p,'build',{parentCastleId:'nijo',direction:'east'});await finish(h,p,'nijo_east');await command(h,p,'repair',{branchId:'nijo_east'},409);await command(h,p,'repair',{branchId:'missing'},409);
  // Battle transitions have a separate real field API suite; seed its exact committed output here.
  authoritativeBranch(h,p,'nijo_east',branch=>{branch.fallen=true;});const before=save(h,p),cost=GameEngine.branchUpgradeCost('nijo',0),r=await command(h,p,'repair',{branchId:'nijo_east'});assert.equal(r.result.repair,true);assert.equal(r.branchState.branches[0].fallen,true);assert.equal(r.branchState.branches[0].level,1);assert.equal(model(h,p).jobs[0].repair,true);assert.equal(model(h,p).jobs[0].targetLevel,1);assertCharges(before,save(h,p),cost);await command(h,p,'repair',{branchId:'nijo_east'},409);await command(h,p,'upgrade',{branchId:'nijo_east'},409);
  const due=model(h,p).jobs[0].completesElapsedMs;worldAt(h,due-1);const early=await syncNow(h,p);assert.equal(early.save.state.branches[0].fallen,true);worldAt(h,due);await syncNow(h,p);const complete=await status(h,p);assert.equal(complete.branchState.branches[0].fallen,false);assert.equal(complete.branchState.branches[0].level,1);assert.equal(complete.branchState.jobs.length,0);
 });
 await scope('writer lease, revision, campaign and branch sequence reject stale commands before charging',async h=>{
  const p=await fixture(h,'古い操作の拒否',{holdings:['nijo']}),base=body(h,p,{parentCastleId:'nijo',direction:'north'}),before=stable(h,p);
  for(const [extra,code]of[[{deviceId:'other-device'},'LEASE_REQUIRED'],[{expectedRevision:base.expectedRevision+1},'REVISION_CONFLICT'],[{campaignId:'other-campaign'},'BRANCH_SCOPE_CHANGED'],[{sequence:1},'BRANCH_STATE_CHANGED']]){const r=(await h.api('/branches/build',post(p,{...base,...extra},409))).data;assert.equal(errorCode(r),code);assert.deepEqual(stable(h,p),before);}
  h.sql.prepare('UPDATE player_saves SET lease_expires_at=? WHERE user_id=?').run(h.now,p.user.id);const expired=stable(h,p);const denied=(await h.api('/branches/build',post(p,base,409))).data;assert.equal(errorCode(denied),'LEASE_REQUIRED');assert.deepEqual(stable(h,p),expired);
 });
 await scope('missing/stale world anchors and a paused clock cannot start branch work',async h=>{
  const p=await fixture(h,'時計の準備不足',{holdings:['nijo']}),baseline=save(h,p);worldAt(h,15001);assert.equal(errorCode(await command(h,p,'build',{parentCastleId:'nijo',direction:'north'},409)),'CLOCK_STALE');worldAt(h,0);
  h.sql.exec("UPDATE world_clock SET running=0,revision=revision+1");assert.equal(errorCode(await command(h,p,'build',{parentCastleId:'nijo',direction:'north'},409)),'WORLD_PAUSED');h.sql.exec("UPDATE world_clock SET running=1,revision=revision+1");
  updateSave(h,p,s=>{delete s.worldClock;});assert.equal(errorCode(await command(h,p,'build',{parentCastleId:'nijo',direction:'north'},409)),'CLOCK_ANCHOR_REQUIRED');assert.equal(receipts(h,p).length,0);assert.deepEqual(save(h,p).state.resources,baseline.state.resources);
 });
 await scope('duplicate and committed lost-response retries use one receipt, one charge and one job',async h=>{
  const p=await fixture(h,'同じ建設の再送',{holdings:['nijo']}),request=body(h,p,{parentCastleId:'nijo',direction:'north'}),before=save(h,p),cost=GameEngine.branchUpgradeCost('nijo',0),first=(await h.api('/branches/build',post(p,request))).data;
  assertCharges(before,save(h,p),cost);const after=stable(h,p),again=(await h.api('/branches/build',post(p,{...request,expectedRevision:0,deviceId:'reconnected-reader'}))).data;assert.equal(again.idempotent,true);assert.deepEqual(again.result,first.result);assert.deepEqual(stable(h,p),after);
  await h.api('/branches/build',post(p,{...request,direction:'east'},409));assert.deepEqual(stable(h,p),after);
  const lost=body(h,p,{parentCastleId:'nijo',direction:'south'}),lostBefore=save(h,p);h.afterBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_requests'))return;h.afterBatch=null;throw Error('Local branch test: response lost after commit');};await h.api('/branches/build',post(p,lost,500));assertCharges(lostBefore,save(h,p),cost);const committed=stable(h,p),recovered=(await h.api('/branches/build',post(p,lost))).data;assert.equal(recovered.idempotent,true);assert.deepEqual(stable(h,p),committed);assert.equal(receipts(h,p).length,2);assert.equal(model(h,p).jobs.length,2);
 });
 await scope('simultaneous duplicates and competing placements commit at most once from the same revision',async h=>{
  const p=await fixture(h,'競合する建設',{holdings:['nijo']}),request=body(h,p,{parentCastleId:'nijo',direction:'north'}),before=save(h,p);let inner;
  h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_requests'))return;h.beforeBatch=null;inner=(await h.api('/branches/build',post(p,request))).data;};const outer=(await h.api('/branches/build',post(p,request))).data;assert.equal(inner.idempotent,false);assert.equal(outer.idempotent,true);assertCharges(before,save(h,p),GameEngine.branchUpgradeCost('nijo',0));assert.equal(receipts(h,p).length,1);
  const one=body(h,p,{parentCastleId:'nijo',direction:'south'}),two={...one,requestId:crypto.randomUUID(),direction:'east'},prior=save(h,p);h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_requests'))return;h.beforeBatch=null;await h.api('/branches/build',post(p,two));};await h.api('/branches/build',post(p,one,409));assertCharges(prior,save(h,p),GameEngine.branchUpgradeCost('nijo',0));assert.deepEqual(model(h,p).branches.map(b=>b.direction).sort(),['east','north']);assert.equal(receipts(h,p).length,2);
 });
 await scope('atomic SQLite failure rolls back receipt, resource payment, save revision and branch ledger',async h=>{
  const p=await fixture(h,'建設の一括失敗',{holdings:['nijo']}),request=body(h,p,{parentCastleId:'nijo',direction:'north'}),before=stable(h,p);
  h.sql.exec("CREATE TEMP TRIGGER reject_branch_ledger BEFORE INSERT ON branch_states BEGIN SELECT RAISE(ABORT,'Local branch rollback'); END");await h.api('/branches/build',post(p,request,500));h.sql.exec('DROP TRIGGER reject_branch_ledger');assert.deepEqual(stable(h,p),before);await h.api('/branches/build',post(p,request));assert.equal(receipts(h,p).length,1);assert.equal(model(h,p).branches.length,1);
 });
 await scope('commit-time writer, revision, campaign, ledger, clock and operator changes block all side effects',async h=>{
  for(const kind of ['writer','revision','campaign','ledger','clock','operator']){h.resetRates();const p=await fixture(h,'同時変更'+kind,{admin:kind==='operator',holdings:kind==='operator'?[]:['nijo']}),parent=kind==='operator'?'edo':'nijo',request=body(h,p,{parentCastleId:parent,direction:'north'});let expected;
   h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_requests'))return;h.beforeBatch=null;
    if(kind==='writer')h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run('replacement-writer',p.user.id);
    if(kind==='revision')h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(p.user.id);
    if(kind==='campaign'){const value=save(h,p);value.state.walking.campaignId='replacement-campaign';value.state.roaming.campaignId='replacement-campaign';value.state.covert.campaignId='replacement-campaign';h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(value),p.user.id);}
    if(kind==='ledger')h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,updated_at) VALUES(?,?,?,?,?)').run(p.user.id,request.campaignId,1,JSON.stringify({branches:[],jobs:[]}),h.now);
    if(kind==='clock')h.sql.exec('UPDATE world_clock SET revision=revision+1');
    if(kind==='operator')h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run('operator-changed');expected=stable(h,p);
   };await h.api('/branches/build',post(p,request,409));assert(expected,'commit hook reached '+kind);assert.deepEqual(stable(h,p),expected,kind+' race cannot charge or store receipt');
  }
 });
 await scope('a forged save five seconds ahead cannot complete construction before the actual absolute deadline',async h=>{
  const p=await fixture(h,'早すぎる完成の拒否',{holdings:['nijo']});await command(h,p,'build',{parentCastleId:'nijo',direction:'north'});const deadline=model(h,p).jobs[0].completesElapsedMs;
  for(const remaining of [5000,1000]){
   worldAt(h,deadline-remaining);const forged=anchor(save(h,p),deadline-remaining+5000);forged.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:24,fallen:false}];forged.state.jobs=forged.state.jobs.filter(job=>job.kind!=='branch');
   const before=stable(h,p),rejected=await put(h,p,forged,409);assert.equal(rejected.error.code,'MAINTENANCE_REFRESH_REQUIRED');assert.deepEqual(stable(h,p),before);
   const written=await syncNow(h,p);assert.equal(written.save.state.branches[0].level,0);assert.equal(written.save.state.jobs.find(job=>job.kind==='branch').completesElapsedMs,deadline);assert.equal(model(h,p).branches[0].level,0);
   if(remaining===5000){const queued=await command(h,p,'upgrade',{branchId:'nijo_north'});assert(queued.result.queued);assert.equal(queued.result.startsInSeconds,5);}
   assert.deepEqual(model(h,p).jobs.map(j=>j.completesElapsedMs),[deadline,deadline+60000]);
  }
  worldAt(h,deadline);await syncNow(h,p);const exact=await status(h,p);assert.equal(exact.branchState.branches[0].level,1);assert.equal(exact.branchState.jobs.length,1);assert.equal(exact.branchState.jobs[0].targetLevel,2);assert.equal(receipts(h,p).length,2);
 });
 await scope('incoming sync cannot erase, relocate, forge or revive authoritative branches and repair work',async h=>{
  const p=await fixture(h,'支拠点インポート防御',{holdings:['nijo','osaka']});await command(h,p,'build',{parentCastleId:'nijo',direction:'west'});await finish(h,p,'nijo_west');const initial=clone(model(h,p).branches[0]);
  for(const branches of [undefined,[],null,'forged',[{...initial,fallen:true}],[{...initial,direction:'east',id:'nijo_east'}],[{id:'kyoto_gosho_north',parentCastleId:'kyoto_gosho',direction:'north',level:128,fallen:false}],[{...initial,level:32},{id:'osaka_east',parentCastleId:'osaka',direction:'east',level:24,fallen:false}]]){const forged=save(h,p);if(branches===undefined)delete forged.state.branches;else forged.state.branches=branches;forged.state.jobs.push({kind:'branch',id:'osaka_east',total:0,totalSeconds:0,remaining:0,remainingSeconds:0,targetLevel:24,repair:true,completesElapsedMs:0});const result=await put(h,p,forged);assert.deepEqual(result.save.state.branches,[initial]);assert.deepEqual(result.save.state.jobs.filter(job=>job.kind==='branch'),[]);}
  authoritativeBranch(h,p,'nijo_west',branch=>{branch.fallen=true;});const old=save(h,p);old.state.branches[0].fallen=false;assert.equal((await put(h,p,old)).save.state.branches[0].fallen,true);await command(h,p,'repair',{branchId:'nijo_west'});const due=model(h,p).jobs[0].completesElapsedMs;worldAt(h,due-5000);const early=anchor(save(h,p),due);early.state.branches[0].fallen=false;early.state.jobs=early.state.jobs.filter(job=>job.kind!=='branch');assert.equal((await put(h,p,early,409)).error.code,'MAINTENANCE_REFRESH_REQUIRED');const prevented=await syncNow(h,p);assert.equal(prevented.save.state.branches[0].fallen,true);assert.equal(prevented.save.state.jobs.find(job=>job.kind==='branch').repair,true);assert.equal(model(h,p).jobs[0].completesElapsedMs,due);worldAt(h,due);await syncNow(h,p);const repaired=await status(h,p);assert.equal(repaired.branchState.branches[0].fallen,false);assert.equal(repaired.branchState.branches[0].level,1);
 });
 await scope('losing operator ownership keeps old Edo ledger from breaking personal migration or granting a branch',async h=>{
  const p=await fixture(h,'退任する支拠点主',{admin:true}),next=await fixture(h,'次の運営');await command(h,p,'build',{parentCastleId:'edo',direction:'north'});await finish(h,p,'edo_north');h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(next.user.id);
  const current=await status(h,p);assert.equal(current.user.isAdmin,false);assert.notEqual(current.save.state.home,'edo');assert.equal(current.branchState.branches.some(b=>b.parentCastleId==='edo'),false);assert.equal(current.parents.find(parent=>parent.parentCastleId==='edo').available,false);await command(h,p,'upgrade',{branchId:'edo_north'},409);assert.equal(receipts(h,p).length,1);assert.doesNotThrow(()=>GameEngine.fromSave(current.save,GAME_OFFICERS));
 });
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({ok:failures.length===0,checks,failed:failures.map(f=>f.name),calls,productionRequests:0}));
if(failures.length)process.exitCode=1;
