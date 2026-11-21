import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

// Every user, save, role, clock and shared base in this suite exists only in
// test-support's in-memory SQLite. No production requests or persisted fixtures.
const h=harness(),{api,sql}=h,checks=[];
const post=(token,body,expected=200)=>({method:'POST',token,body,expected});
const player=p=>sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const save=p=>JSON.parse(player(p).save_json);
const baseRow=()=>sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get();
const baseState=()=>JSON.parse(baseRow().state_json);
const requests=()=>Number(sql.prepare('SELECT COUNT(*) n FROM staff_base_requests').get().n);
const staffBase=async p=>(await api('/staff/base',{token:p.token})).data.staffBase;
const sync=async p=>(await api('/sync?deviceId='+encodeURIComponent(p.deviceId),{token:p.token})).data;
const setClock=elapsed=>sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=1,speed=1,revision=revision+1 WHERE id='world-v1'").run(elapsed,h.now);
const setBase=change=>{const state=baseState();change(state);sql.prepare("UPDATE staff_base SET state_json=?,revision=revision+1,updated_at=? WHERE id='kyoto_gosho'").run(JSON.stringify(state),h.now);};
const assign=async(p,action='appoint')=>(await api('/admin/staff',post(operator.token,{targetPlayerId:p.user.id,action,requestId:crypto.randomUUID()}))).data;
async function fixture(name,{staff=false,clan='織田家',rich=false}={}){
 const p=await h.session(name,clan);p.deviceId=p.user.id+'-writer';
 const lease=(await api('/sync/lease',post(p.token,{deviceId:p.deviceId,takeOver:true}))).data;
 const clock=(await api('/world-clock')).data.clock,g=new GameEngine({clan,startCastle:'himeji',officers:GAME_OFFICERS,seed:7});
 g.applyWorldClock(clock);g.state.resources={gold:900000,rice:900000,wood:900000,stone:900000};
 if(rich){g.state.buildings.farm=22;g.state.buildings.keep=24;g.state.castles.himeji.level=17;}
 g.state.command=g.commandMax();
 await api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save:JSON.parse(g.exportSave())}});
 if(staff){await assign(p);await sync(p);}
 return p;
}
async function align(p){
 const latest=await sync(p),clock=(await api('/world-clock')).data.clock;
 const g=GameEngine.fromSave(latest.save,GAME_OFFICERS,{isAdmin:latest.user.isAdmin,isStaff:latest.user.isStaff,staffBase:latest.staffBase});
 for(let i=0;i<10;i++){const moved=g.applyWorldClock(clock,{maxSeconds:7200});if(!moved.pending)break;}
 return (await api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:latest.revision,save:JSON.parse(g.exportSave())}})).data;
}
async function finish(...players){
 const jobs=baseState().jobs;if(jobs.length)setClock(Math.max(...jobs.map(j=>j.completesElapsedMs))+1);
 await staffBase(players[0]);for(const p of players)await align(p);h.resetRates();
}
const body=(p,kind='building',id='farm',extra={})=>({kind,id,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:Number(player(p).revision),baseRevision:Number(baseRow().revision),...extra});
const upgrade=(p,payload,expected=200)=>api('/staff/base/upgrade',post(p.token,payload,expected));
function barrier(){let entered=0,release;const gate=new Promise(done=>release=done);h.beforeBatch=async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO staff_base_requests'))){entered++;if(entered===2){h.beforeBatch=null;release();}await gate;}};return()=>entered;}
function balances(p){const current=save(p);return{resources:structuredClone(current.state.resources),command:current.state.command,revision:player(p).revision};}
function assertPaid(before,after,receipt){for(const kind of ['gold','rice','wood','stone'])assert.equal(after.resources[kind],before.resources[kind]-(receipt.cost[kind]||0),kind+' charged exactly once');assert.equal(after.command,before.command-1);assert.equal(after.revision,before.revision+1);}
let operator;
try{
 operator=await h.session('共同普請の運営');await api('/admin/claim',post(operator.token,{key:h.env.SENGOKU_ADMIN_KEY}));
 const a=await fixture('共同普請A',{staff:true,clan:'伊達家',rich:true}),b=await fixture('共同普請B',{staff:true,clan:'武田家'}),ordinary=await fixture('共同普請の一般領主');
 const initial=await staffBase(a),aSync=await sync(a),bSync=await sync(b);
 assert.equal(initial.id,'kyoto_gosho');assert.equal(initial.protected,true);assert.equal(initial.castleLevel,1);assert.equal(Object.keys(initial.buildings).length,64);
 assert.notEqual(initial.buildings.farm,22);assert.notEqual(initial.buildings.keep,24);assert.deepEqual(initial.initial.buildings,initial.buildings);
 assert.equal(aSync.save.state.home,'kyoto_gosho');assert.equal(aSync.save.state.clan,'德川家');assert.equal(aSync.staffBase.personalClan,'伊達家');assert.equal(bSync.save.state.home,'kyoto_gosho');assert.equal(bSync.save.state.clan,'德川家');assert.equal(bSync.staffBase.personalClan,'武田家');
 assert.deepEqual(aSync.staffBase.buildings,bSync.staffBase.buildings);assert.equal(aSync.save.state.buildings.farm,22,'Personal building baseline remains separate from shared development');
 assert.equal((await api('/staff/base',{token:operator.token})).data.staffBase.id,'kyoto_gosho');
 await api('/staff/base',{expected:401});await api('/staff/base',{token:ordinary.token,expected:403});await upgrade(operator,body(a),403);
 assert.equal((await sync(ordinary)).staffBase,null);assert.equal((await api('/sync',{token:operator.token})).data.staffBase,null);
 for(const secret of ['commit_token','request_hash','transition_token','token_hash','save_json'])assert(!JSON.stringify(initial).includes(secret));
 checks.push('server-owned seed, fixed Kyoto palace/德川家, preserved personal houses and private source permissions');

 const firstBody=body(a),beforeA=balances(a),beforeB=balances(b),first=(await upgrade(a,firstBody)).data;
 assert.equal(first.idempotent,false);assert.equal(first.staffBase.jobs.length,1);assert.equal(first.staffBase.jobs[0].startedBy.id,a.user.id);assert.equal(first.staffBase.jobs[0].startedBy.name,a.user.name);
 assertPaid(beforeA,balances(a),first.receipt);assert.deepEqual(balances(b),beforeB);assert.equal(first.receipt.baseRevision,first.staffBase.revision);assert.equal(first.receipt.playerRevision,first.revision);
 assert.equal((await staffBase(b)).jobs[0].jobId,first.receipt.jobId);
 const nextStage=(await upgrade(b,body(b))).data;assert.equal(nextStage.receipt.targetLevel,first.receipt.targetLevel+1);assert.equal(nextStage.receipt.queued,true);assert.equal(nextStage.receipt.startedElapsedMs,first.receipt.completesElapsedMs);assertPaid(beforeB,balances(b),nextStage.receipt);
 const repeated=(await upgrade(a,{...firstBody,deviceId:'another-device',expectedRevision:0})).data;
 assert.equal(repeated.idempotent,true);assert.equal(repeated.receipt.jobId,first.receipt.jobId);assert.deepEqual(balances(a),{resources:first.save.state.resources,command:first.save.state.command,revision:first.revision});
 assert.equal((await upgrade(a,{...firstBody,baseRevision:firstBody.baseRevision+1},409)).data.error.code,'REQUEST_ID_REUSED');
 assert.equal((await upgrade(a,{...firstBody,id:'market'},409)).data.error.code,'REQUEST_ID_REUSED');
 await finish(a,b);assert.equal((await staffBase(b)).buildings.farm,nextStage.receipt.targetLevel);assert.equal(baseState().jobs.length,0);
 checks.push('one payer per stage, one command, shared attribution, sequential facility reservation and durable same-ID replay');

 const same=body(a,'building','market'),duplicateBefore=balances(a),requestCount=requests(),entered=barrier();
 const duplicates=await Promise.all([upgrade(a,same),upgrade(a,same)]);assert.equal(entered(),2);assert.deepEqual(duplicates.map(r=>r.data.idempotent).sort(),[false,true]);assert.equal(duplicates[0].data.receipt.jobId,duplicates[1].data.receipt.jobId);assert.equal(requests(),requestCount+1);assertPaid(duplicateBefore,balances(a),duplicates[0].data.receipt);
 await finish(a,b);
 const raceA=body(a,'building','farm'),raceB=body(b,'building','farm'),sameBefore=[balances(a),balances(b)],countSame=requests();barrier();
 const sameRaces=await Promise.all([upgrade(a,raceA,null),upgrade(b,raceB,null)]);assert.deepEqual(sameRaces.map(r=>r.response.status).sort(),[200,409]);assert.equal(baseState().jobs.length,1);assert.equal(requests(),countSame+1);
 const winnerIndex=sameRaces[0].response.status===200?0:1,loserIndex=1-winnerIndex,players=[a,b];assertPaid(sameBefore[winnerIndex],balances(players[winnerIndex]),sameRaces[winnerIndex].data.receipt);assert.deepEqual(balances(players[loserIndex]),sameBefore[loserIndex]);
 const nextAfterRace=(await upgrade(players[loserIndex],body(players[loserIndex]))).data;assert.equal(nextAfterRace.receipt.targetLevel,sameRaces[winnerIndex].data.receipt.targetLevel+1);assertPaid(sameBefore[loserIndex],balances(players[loserIndex]),nextAfterRace.receipt);assert.equal(baseState().jobs.length,2);
 await finish(a,b);
 const differentBefore=[balances(a),balances(b)],differentCount=requests(),ops=[body(a,'building','lumber'),body(b,'building','quarry')];barrier();
 const different=await Promise.all([upgrade(a,ops[0],null),upgrade(b,ops[1],null)]);assert.deepEqual(different.map(r=>r.response.status).sort(),[200,409]);
 const retryIndex=different[0].response.status===409?0:1,retry=(await upgrade(players[retryIndex],body(players[retryIndex],'building',ops[retryIndex].id))).data;
 assert.equal(baseState().jobs.length,2);assert.equal(new Set(baseState().jobs.map(j=>j.id)).size,2);assert.equal(requests(),differentCount+2);
 for(let i=0;i<2;i++)assertPaid(differentBefore[i],balances(players[i]),i===retryIndex?retry.receipt:different[i].data.receipt);
 await finish(a,b);checks.push('concurrent duplicate, same facility and independent writers on different facilities');

 const lost=body(a,'castle','kyoto_gosho'),lostBefore=balances(a);h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO staff_base_requests'))){h.afterBatch=null;throw Error('local lost response after atomic commit');}};
 await upgrade(a,lost,500);const committed=sql.prepare('SELECT * FROM staff_base_requests WHERE actor_id=? AND request_id=?').get(a.user.id,lost.requestId);assert(committed);const receipt=JSON.parse(committed.result_json);assertPaid(lostBefore,balances(a),receipt);
 const recovered=(await upgrade(a,{...lost,deviceId:'reconnected-device',expectedRevision:0})).data;assert(recovered.idempotent);assert.equal(recovered.receipt.jobId,receipt.jobId);assertPaid(lostBefore,balances(a),receipt);
 await finish(a,b);
 const rollback=body(a,'building','farm'),rollbackBefore={player:player(a),base:baseRow(),count:requests()};
 sql.exec("CREATE TEMP TRIGGER reject_staff_base BEFORE UPDATE ON staff_base BEGIN SELECT RAISE(ABORT,'local injected failure'); END");await upgrade(a,rollback,500);sql.exec('DROP TRIGGER reject_staff_base');
 assert.deepEqual(player(a),rollbackBefore.player);assert.deepEqual(baseRow(),rollbackBefore.base);assert.equal(requests(),rollbackBefore.count);await upgrade(a,rollback);await finish(a,b);
 checks.push('atomic rollback and committed lost-response replay without double billing');

 for(const kind of ['dismiss','reappoint','lease','personal-revision','base-revision','clock']){
   h.resetRates();const operation=body(b,'building','farm'),before={save:save(b),revision:player(b).revision,base:baseRow(),count:requests()};
   h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO staff_base_requests')))return;h.beforeBatch=null;
     if(kind==='dismiss')sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(b.user.id);
     if(kind==='reappoint')sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run('replacement-term-'+crypto.randomUUID(),b.user.id);
     if(kind==='lease')sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run('replacement-writer',b.user.id);
     if(kind==='personal-revision')sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(b.user.id);
     if(kind==='base-revision')sql.exec("UPDATE staff_base SET revision=revision+1 WHERE id='kyoto_gosho'");
     if(kind==='clock')sql.exec("UPDATE world_clock SET running=0,revision=revision+1 WHERE id='world-v1'");
   };
   const result=await upgrade(b,operation,['dismiss','reappoint'].includes(kind)?403:409);assert.equal(requests(),before.count);assert.deepEqual(save(b),before.save);assert.equal(baseRow().state_json,before.base.state_json);
   if(kind==='dismiss'){assert.equal(result.data.error.code,'STAFF_BASE_REQUIRED');await assign(b);await sync(b);}
   if(kind==='reappoint'){assert.equal(result.data.error.code,'STAFF_BASE_REQUIRED');await sync(b);}
   if(kind==='lease'){assert.equal(result.data.error.code,'LEASE_REQUIRED');await api('/sync/lease',post(b.token,{deviceId:b.deviceId,takeOver:true}));}
   if(kind==='personal-revision')assert.equal(result.data.error.code,'REVISION_CONFLICT');
   if(kind==='base-revision')assert.equal(result.data.error.code,'STAFF_BASE_CHANGED');
   if(kind==='clock')sql.exec("UPDATE world_clock SET running=1,revision=revision+1 WHERE id='world-v1'");
 }
 checks.push('commit-time role term, dismissal, writer lease, personal/shared revision and world-clock guards');

 const protectedBefore=baseRow(),forged=(await sync(a)).save;forged.state.buildings.farm=32;forged.state.castles.kyoto_gosho.level=64;forged.state.staffBase={revision:999,castleLevel:64,buildings:{farm:32}};forged.state.isStaff=true;
 await api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:player(a).revision,save:forged}});
 assert.deepEqual(baseRow(),protectedBefore);assert.notEqual((await staffBase(a)).castleLevel,64);assert.notEqual((await staffBase(a)).buildings.farm,32);
 const illegal=(await sync(ordinary)).save;illegal.state.home='kyoto_gosho';illegal.state.castles.kyoto_gosho.owner=illegal.state.clan;
 assert.equal((await api('/sync',{method:'PUT',token:ordinary.token,body:{deviceId:ordinary.deviceId,revision:player(ordinary).revision,save:illegal},expected:403})).data.error.code,'STAFF_ENTITLEMENT_REQUIRED');
 for(const extra of [{kind:'research'},{id:'edo',kind:'castle'},{id:'missing'},{baseRevision:-1},{baseRevision:'1'},{expectedRevision:1.5},{requestId:undefined},{cost:{gold:0}},{staffBase:{castleLevel:64}}])await upgrade(a,{...body(a),...extra},400);
 checks.push('untrusted personal saves, role fields and upgrade payloads cannot change shared growth');

 setBase(state=>{state.initial.castleLevel=127;state.castleLevel=127;state.history=[];state.jobs=[];});await align(a);
 const finalCastle=(await upgrade(a,body(a,'castle','kyoto_gosho'))).data;assert.equal(finalCastle.receipt.targetLevel,128);await finish(a,b);assert.equal((await staffBase(a)).castleLevel,128);
 const maxBefore=balances(a);assert.equal((await upgrade(a,body(a,'castle','kyoto_gosho'),409)).data.error.code,'BUILDING_MAX');assert.deepEqual(balances(a),maxBefore);
 setBase(state=>{state.initial.buildings.farm=31;state.buildings.farm=31;state.history=[];state.jobs=[];});await align(a);
 const finalFacility=(await upgrade(a,body(a,'building','farm'))).data;assert.equal(finalFacility.receipt.targetLevel,32);await finish(a,b);assert.equal((await staffBase(b)).buildings.farm,32);
 const capBefore=balances(a);assert.equal((await upgrade(a,body(a,'building','farm'),409)).data.error.code,'BUILDING_MAX');assert.deepEqual(balances(a),capBefore);
 checks.push('shared castle level 128, facility level 32 and completed jobs advance for every member');

 const visible=(await api('/field?limit=100',{token:ordinary.token})).data;
 for(const p of [a,b]){const row=visible.players.find(row=>row.playerId===p.user.id);assert(row);assert.equal(row.homeCastleId,'kyoto_gosho');assert.equal(row.level,128);assert.equal(Object.hasOwn(row,'isStaff'),false);assert.equal(row.attackable,true);assert.equal(row.battleMode,'reward');assert.equal(row.capturable,false);}
 for(const privateKey of ['staffBase','personalHome','personalBaseCastle','requestId','request_hash','resources'])assert(!JSON.stringify(visible).includes(privateKey));
 await align(ordinary);
 const protectedBeforeAttack={base:baseRow(),a:player(a),b:player(b),backups:sql.prepare('SELECT * FROM staff_campaign_backups ORDER BY user_id').all()};
 const rewardAttack={targetPlayerId:a.user.id,targetCastleId:'kyoto_gosho',troops:300,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:ordinary.deviceId,expectedRevision:player(ordinary).revision};
 let reward;const random=crypto.getRandomValues;crypto.getRandomValues=array=>array.fill(0);
 try{reward=(await api('/field/attack',post(ordinary.token,rewardAttack))).data;}finally{crypto.getRandomValues=random;}
 assert.equal(reward.battle.battleMode,'reward');assert.equal(reward.battle.won,true);assert.equal(reward.battle.defenderRevision,protectedBeforeAttack.a.revision);
 assert.deepEqual(reward.battle.defenderLost,{troops:0,garrison:0});assert.deepEqual(reward.battle.loot,{gold:0,rice:0,wood:0,stone:0});assert.deepEqual(reward.battle.rewards,{gold:500,rice:500,wood:500,stone:500});
 assert.equal(reward.battle.defenderProtectedUntilElapsedMs,reward.battle.occurredElapsedMs+60000);
 assert.deepEqual({base:baseRow(),a:player(a),b:player(b),backups:sql.prepare('SELECT * FROM staff_campaign_backups ORDER BY user_id').all()},protectedBeforeAttack,'Victory cannot change either staff save, the shared base, its revision or personal backups');
 const afterReward=(await api('/field?limit=100',{token:ordinary.token})).data;
 for(const p of [a,b]){const target=afterReward.players.find(row=>row.playerId===p.user.id);assert.equal(target.attackable,false);assert.equal(target.protectedUntilElapsedMs,reward.battle.defenderProtectedUntilElapsedMs,'The Kyoto palace protection period also covers another staff member');}
 const actorBefore=balances(a),targetBefore=player(ordinary),battleCount=sql.prepare('SELECT COUNT(*) n FROM field_battles').get().n,fieldRequestCount=sql.prepare('SELECT COUNT(*) n FROM field_requests').get().n;
 h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO field_requests')))return;h.beforeBatch=null;sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,?)').run(ordinary.user.id,operator.user.id,h.now,'target-promoted-before-attack',baseState().updatedElapsedMs);};
 const promotedRace=await api('/field/attack',post(a.token,{targetPlayerId:ordinary.user.id,troops:300,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:a.deviceId,expectedRevision:player(a).revision},409));
 assert.equal(h.beforeBatch,null,'The target is promoted at the actual attack commit boundary');assert.equal(promotedRace.data.error.code,'FIELD_CHANGED');
 assert.deepEqual(balances(a),actorBefore);assert.deepEqual(player(ordinary),targetBefore);assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_battles').get().n,battleCount);assert.equal(sql.prepare('SELECT COUNT(*) n FROM field_requests').get().n,fieldRequestCount);sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(ordinary.user.id);
 checks.push('Kyoto palace reward victory preserves both staff saves/shared base/backups, shares its protection period, and rejects a mid-attack staff promotion with 409');

 const oldSource=await staffBase(b),oldReplay=body(b,'building','market'),accepted=(await upgrade(b,oldReplay)).data;await assign(b,'dismiss');
 await api('/staff/base',{token:b.token,expected:403});await upgrade(b,oldReplay,403);const dismissed=await sync(b);assert.equal(dismissed.user.isStaff,false);assert.equal(dismissed.staffBase,null);assert.equal(dismissed.save.state.home,'himeji');
 assert.equal((await staffBase(a)).revision,accepted.staffBase.revision);assert.equal((await staffBase(a)).castleLevel,oldSource.castleLevel);
 const feed=(await api('/achievements')).data;assert(feed.events.some(e=>e.kind==='building'));assert(!feed.events.some(e=>e.kind==='staff-building'));
 for(const privateKey of ['staffBase','personalHomeCastle','requestId','commit_token','request_hash','save_json','token_hash'])assert(!JSON.stringify(feed).includes(privateKey));
 checks.push('dismissal removes shared read/replay access without erasing growth; completion notices expose no private fields');
 await assign(b);await sync(b);h.beforeStatement=(query,params)=>{if(query.startsWith('SELECT joined_elapsed_ms,save_json FROM staff_campaign_backups')&&params[0]===b.user.id){h.beforeStatement=null;sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(b.user.id);}};
 const revokedRead=await api('/staff/base',{token:b.token,expected:403});assert.equal(revokedRead.data.error.code,'STAFF_BASE_REQUIRED');assert.equal(revokedRead.data.staffBase,undefined);
 checks.push('private shared-base read rechecks live membership after assembling its source');

 h.resetRates();const offline=await fixture('長期離席のスタッフ',{staff:true,clan:'毛利家',rich:true}),joined=await sync(offline),left=joined.save.state.worldClock.elapsedMs+172830000;
 setClock(left);await assign(offline,'dismiss');const originalRevision=player(offline).revision;
 const partial=await api('/sync',{token:offline.token,expected:409});assert.equal(partial.data.error.code,'STAFF_TRANSITION_PENDING');
 const checkpoint=player(offline),checkpointSave=save(offline);assert(checkpoint.revision>originalRevision);assert.equal(checkpointSave.state.worldClock.elapsedMs,joined.save.state.worldClock.elapsedMs+86400000);assert.equal(sql.prepare('SELECT active FROM staff_campaign_backups WHERE user_id=?').get(offline.user.id).active,1);
 const receiptsBefore=sql.prepare('SELECT COUNT(*) n FROM cycle_receipts WHERE user_id=?').get(offline.user.id).n;
 h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('staff_campaign_backups WHERE user_id=? AND active=1 AND term_id=?')))return;h.beforeBatch=null;sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,?)').run(offline.user.id,operator.user.id,h.now,'reappointed-during-transition',left);};
 const changedRole=await api('/sync',{token:offline.token,expected:409});assert.equal(changedRole.data.error.code,'STAFF_ROLE_CHANGED');assert.deepEqual(player(offline),checkpoint);assert.equal(sql.prepare('SELECT COUNT(*) n FROM cycle_receipts WHERE user_id=?').get(offline.user.id).n,receiptsBefore);sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(offline.user.id);
 setClock(left+10000);let restored;
 for(let i=0;i<4;i++){const result=await api('/sync',{token:offline.token,expected:null});if(result.response.status===200){restored=result.data;break;}assert.equal(result.response.status,409);assert.equal(result.data.error.code,'STAFF_TRANSITION_PENDING');}
 assert(restored,'Bounded follow-up polls finish the pending staff term');assert.equal(restored.user.isStaff,false);assert.equal(restored.staffBase,null);assert.equal(restored.save.state.worldClock.elapsedMs,left,'Shared production stops at dismissal, not the later reconnect time');
 assert.equal(restored.save.state.home,'himeji');assert.equal(restored.save.state.castles.himeji.level,17);assert.equal(restored.save.state.buildings.farm,22);assert.equal(sql.prepare('SELECT active FROM staff_campaign_backups WHERE user_id=?').get(offline.user.id).active,0);
 const settledReceiptCount=sql.prepare('SELECT COUNT(*) n FROM cycle_receipts WHERE user_id=?').get(offline.user.id).n;assert(settledReceiptCount>receiptsBefore);
 const stable=await sync(offline);assert.equal(stable.revision,restored.revision);assert.deepEqual(stable.save,restored.save);assert.equal(sql.prepare('SELECT COUNT(*) n FROM cycle_receipts WHERE user_id=?').get(offline.user.id).n,settledReceiptCount);
 checks.push('long offline dismissal checkpoints at 24-hour bounds, aborts on term races, stops shared production at departure, and restores original home growth without duplicate awards');
 console.log(JSON.stringify({ok:true,calls:h.calls,checks,productionRequests:0},null,2));
}finally{h.beforeStatement=null;h.beforeBatch=null;h.afterBatch=null;h.close();}
