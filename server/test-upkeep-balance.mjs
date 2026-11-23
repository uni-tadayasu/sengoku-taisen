// Current economy rules must survive authoritative ledgers and legacy flushes.
// Every request uses the local Worker with an isolated in-memory D1 database.
import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';

const reports=[],copy=value=>structuredClone(value),resources=['gold','rice','wood','stone'];
const branch=(troops=0)=>({id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,stationedTroops:troops});
const ledger=(h,p)=>h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,save(h,p).state.walking.campaignId);
const model=(h,p)=>JSON.parse(ledger(h,p).state_json);
const backup=(h,p)=>h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(p.user.id);
const personal=(h,p)=>JSON.parse(backup(h,p).save_json).state;
const snapshot=async(h,p)=>(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
const engine=snapshot=>GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isAdmin:snapshot.user.isAdmin,isStaff:snapshot.user.isStaff,staffBase:snapshot.staffBase,maintenanceAuthority:snapshot.maintenanceAuthority,branchAuthority:{resolvedElapsedMs:snapshot.branchResolvedElapsedMs}});
const put=async(h,p,value,{legacy=false,expected=200}={})=>{
 const outgoing=copy(value);if(legacy)delete outgoing.state.upkeep;
 const body={deviceId:p.deviceId,revision:row(h,p).revision,maintenanceRevision:h.maintenanceByToken.get(p.token).revision,save:outgoing,...(legacy?{}:{maintenanceRulesVersion:GameEngine.maintenanceRulesVersion})};
 return (await h.api('/sync',{method:'PUT',token:p.token,rawBody:JSON.stringify(body),expected})).data;
};
async function advance(h,p,{months=1,elapsedMs=null,rebalanceTroops=true}={}){
 const prior=await snapshot(h,p),target=elapsedMs??(Math.floor(prior.clock.elapsedMs/60000)+months)*60000;
 h.now+=target-prior.clock.elapsedMs;
 const current=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,game=engine(current);
 const moved=game.applyWorldClock(current.clock,{maxSeconds:86400,rebalanceTroops});assert(moved.ok&&!moved.pending);
 return{...current,game,save:JSON.parse(game.exportSave())};
}
function seedBranches(h,p,branches){
 updateSave(h,p,state=>{state.branches=copy(branches);});
 const current=save(h,p);h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,resolved_elapsed_ms,updated_at) VALUES(?,?,1,?,?,?) ON CONFLICT(actor_id,campaign_id) DO UPDATE SET sequence=sequence+1,state_json=excluded.state_json,resolved_elapsed_ms=excluded.resolved_elapsed_ms')
  .run(p.user.id,current.state.walking.campaignId,JSON.stringify({branches,jobs:[]}),current.state.worldClock.elapsedMs,h.now);
}
const troops=value=>({army:value.state.troops,castles:Object.fromEntries(Object.entries(value.state.castles).filter(([,castle])=>castle.owner===value.state.clan).map(([id,castle])=>[id,castle.troops])),branches:value.state.branches.map(branch=>[branch.id,branch.stationedTroops||0])});
const troopSnapshot=value=>({...troops(value),branches:Object.fromEntries(value.state.branches.map(branch=>[branch.id,branch.stationedTroops||0]))});
function assertAdjustment(result,before,balance){
 const adjustment=result.upkeepAdjustment;assert(adjustment);assert.equal(adjustment.version,1);assert.equal(adjustment.committedRevision,result.revision);assert.equal(adjustment.removed,balance.removed);assert.deepEqual(adjustment.allocations,balance.allocations);
 assert.deepEqual(adjustment.before,troopSnapshot(before));assert.deepEqual(adjustment.after,troopSnapshot(result.save));assert(!Object.hasOwn(result.save,'upkeepAdjustment'));assert(!Object.hasOwn(result.save.state,'upkeepAdjustment'));
}
function minimum(game){
 const current=game.income();assert(current.gold>=0&&current.rice>=0,'affordable force has nonnegative monthly gold and rice');
 game.state.troops++;const oneMore=game.income();game.state.troops--;
 assert(oneMore.gold<0||oneMore.rice<0,'keeping even one more soldier would retain a deficit');
}
async function scope(name,run){
 const h=harness(),batch=h.db.batch.bind(h.db);let maxBindings=0;
 h.db.batch=statements=>{for(const statement of statements){maxBindings=Math.max(maxBindings,statement.params.length);assert(statement.params.length<=100,'D1 binding limit exceeded');}return batch(statements);};
 try{await run(h);reports.push({name,calls:h.calls,maxBindings});console.log('PASS '+name);}finally{h.close();}
}

const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Economy tests must not contact a real service');};
try{
 await scope('legacy imports and midmonth saves retain troops; the next month settles once',async h=>{
  const p=await h.session('旧版の更新前保存');p.deviceId='legacy-'+p.user.id;
  const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
  const game=new GameEngine({officers:GAME_OFFICERS,seed:17});game.applyWorldClock(lease.clock);game.state.troops=20000;
  const original=JSON.parse(game.exportSave()),facility=copy(game.maintenance().facilityUpkeep);
  const imported=await put(h,p,original,{legacy:true});assert.deepEqual(troops(imported.save),troops(original));assert(!imported.upkeepAdjustment);assert(engine(imported).income().rice<0);
  for(let attempt=0;attempt<3;attempt++){
   const retried=await put(h,p,original,{legacy:true});assert.deepEqual(troops(retried.save),troops(imported.save));assert.deepEqual(retried.save.state.resources,original.state.resources);
  }
  const pending=await advance(h,p,{rebalanceTroops:false}),expected=pending.game.settleMonthlyUpkeep();assert(expected.changed);assert.equal(expected.reductions.home,0);
  const first=await put(h,p,pending.save,{legacy:true});assert.deepEqual(troops(first.save),troops(JSON.parse(pending.game.exportSave())));assertAdjustment(first,pending.save,expected);assert(!row(h,p).save_json.includes('upkeepAdjustment'),'the receipt is transient response metadata');
  minimum(engine(first));assert.deepEqual(engine(first).maintenance().facilityUpkeep,facility);
  const modern=await put(h,p,first.save);assert.deepEqual(troops(modern.save),troops(first.save));assert(modern.writable,'legacy flush leaves the lease usable for the upgraded client');assert(!Object.hasOwn(modern,'upkeepAdjustment'),'unchanged troop counts need no correction receipt');assert(!Object.hasOwn(await snapshot(h,p),'upkeepAdjustment'),'a GET never replays an old adjustment');
 });

 await scope('an upkeep receipt is omitted when the response observes a newer committed snapshot',async h=>{
  const p=await fixture(h,'応答直前に保存更新');updateSave(h,p,state=>{state.troops=20000;});const pending=await advance(h,p,{rebalanceTroops:false}),incoming=pending.save,revision=row(h,p).revision;
  let raced=false;h.afterBatch=async statements=>{if(!statements[0]?.sql.includes('UPDATE player_saves SET save_json=')||!statements[0]?.sql.includes('RETURNING *'))return;h.afterBatch=null;raced=true;updateSave(h,p,state=>{state.resources.gold++;});};
  const result=await put(h,p,incoming,{legacy:true});assert(raced);assert.equal(result.revision,revision+2);assert.equal(result.save.state.resources.gold,incoming.state.resources.gold+1);assert(result.save.state.troops<incoming.state.troops);assert(!Object.hasOwn(result,'upkeepAdjustment'),'the earlier reduction cannot be attached to a different revision');
 });

 await scope('new recruits after the monthly boundary survive the first save and every remaining midmonth sync',async h=>{
  const p=await fixture(h,'月初に追加募兵',{holdings:['nijo']});
  updateSave(h,p,state=>{state.troops=300;state.buildings.barracks=32;state.castles[state.home].troops=400;state.castles.nijo.troops=500;});seedBranches(h,p,[branch(25000)]);
  const boundary=await advance(h,p),game=boundary.game;assert.equal(game.state.upkeep.settledTurn,1);assert(game.state.upkeep.branchReductions.nijo_north>0);assert.equal(game.state.troops,0);
  const fixed=copy(game.maintenance().facilityUpkeep),recruited=game.recruitTroops(1000);assert(recruited.ok,recruited.message);assert(game.income().rice<0);
  const submitted=JSON.parse(game.exportSave()),first=await put(h,p,submitted);assert.equal(first.save.state.troops,1000);assert.deepEqual(troops(first.save),troops(submitted));assert.deepEqual(first.save.state.upkeep,submitted.state.upkeep);assert.deepEqual(model(h,p).branches,first.save.state.branches);
  assert(first.upkeepAdjustment?.allocations.every(item=>item.kind==='branch'),'the server only applies the recorded branch debit, never another army cut');
  for(let i=0;i<3;i++){const same=await put(h,p,first.save);assert.equal(same.save.state.troops,1000);assert.deepEqual(same.save.state.upkeep,first.save.state.upkeep);assert(!same.upkeepAdjustment);}
  const middle=await advance(h,p,{elapsedMs:75000}),mid=await put(h,p,middle.save);assert.equal(mid.save.state.troops,1000);assert.deepEqual(engine(mid).maintenance().facilityUpkeep,fixed);
  const next=await advance(h,p),last=await put(h,p,next.save);assert(last.save.state.troops<1000);assert.equal(last.save.state.upkeep.settledTurn,2);assert.deepEqual(engine(last).maintenance().facilityUpkeep,fixed);
 });

 await scope('a month with no deficit is still settled before later recruitment makes income negative',async h=>{
  const p=await fixture(h,'黒字の月替わり');updateSave(h,p,state=>{state.troops=100;state.castles[state.home].troops=100;state.buildings.barracks=32;});
  const boundary=await advance(h,p),game=boundary.game;assert.equal(game.state.upkeep.settledTurn,1);assert(!game.state.log.some(item=>item.kind==='upkeep'));assert(game.income().rice>=0);
  const recruited=game.recruitTroops(10000);assert(recruited.ok,recruited.message);assert(game.income().rice<0);
  const incoming=JSON.parse(game.exportSave()),result=await put(h,p,incoming);assert.equal(result.save.state.troops,incoming.state.troops);assert.equal(result.save.state.upkeep.settledTurn,1);assert(!result.upkeepAdjustment);
 });

 await scope('multiple offline months carry cumulative branch receipts without reapplying them after reload',async h=>{
  const p=await fixture(h,'三か月の減兵記録',{holdings:['nijo']});updateSave(h,p,state=>{state.troops=0;state.castles[state.home].troops=0;state.castles.nijo.troops=0;});seedBranches(h,p,[branch(25000)]);
  const pending=await advance(h,p,{months:3}),result=await put(h,p,pending.save);assert.deepEqual(troops(result.save),troops(pending.save));assert.deepEqual(result.save.state.upkeep,pending.save.state.upkeep);assert.equal(result.save.state.upkeep.settledTurn,3);assert(result.save.state.upkeep.branchReductions.nijo_north>0);
  const reloaded=engine(await snapshot(h,p));assert.deepEqual(reloaded.state.upkeep,result.save.state.upkeep);const noop=reloaded.applyWorldClock(result.clock);assert(noop.ok);assert.deepEqual(troops(JSON.parse(reloaded.exportSave())),troops(result.save));const repeated=await put(h,p,JSON.parse(reloaded.exportSave()));assert(!repeated.upkeepAdjustment);assert.deepEqual(model(h,p).branches,repeated.save.state.branches);
 });

 await scope('malformed, excessive and repeated same-month branch receipts cannot debit canonical troops',async h=>{
  const p=await fixture(h,'減兵記録の検証',{holdings:['nijo']});seedBranches(h,p,[branch(25000)]);const pending=await advance(h,p),stored=copy({save:row(h,p),branch:ledger(h,p)});
  for(const mutate of [state=>{state.upkeep.settledTurn=state.turn+1;},state=>{state.upkeep.branchReductions.unknown_branch=1;},state=>{state.upkeep.branchReductions.nijo_north=-1;}]){const bad=copy(pending.save);mutate(bad.state);const result=await put(h,p,bad,{expected:400});assert.equal(result.error.code,'INVALID_SAVE');assert.deepEqual(copy({save:row(h,p),branch:ledger(h,p)}),stored);}
  const tooMany=copy(pending.save);tooMany.state.upkeep.branchReductions.nijo_north=25001;const blocked=await put(h,p,tooMany,{expected:409});assert.equal(blocked.error.code,'BRANCH_STATE_CHANGED');assert.deepEqual(copy({save:row(h,p),branch:ledger(h,p)}),stored);
  const first=await put(h,p,pending.save),second=copy(first.save);second.state.upkeep.branchReductions.nijo_north++;const repeated=await put(h,p,second,{expected:409});assert.equal(repeated.error.code,'BRANCH_STATE_CHANGED');assert.deepEqual(troops(save(h,p)),troops(first.save));
 });

 await scope('full save rebalance debits army, owned garrisons and canonical branches in order without resurrection',async h=>{
  const p=await fixture(h,'枝兵も維持費調整',{holdings:['nijo']});
  updateSave(h,p,state=>{state.troops=300;state.castles[state.home].troops=400;state.castles.nijo.troops=500;});seedBranches(h,p,[branch(25000)]);
  const before=await advance(h,p,{rebalanceTroops:false}),expected=before.game,fixed=copy(expected.maintenance().facilityUpkeep),balance=expected.settleMonthlyUpkeep();
  assert.equal(balance.reductions.field,300);assert.equal(balance.reductions.home,before.save.state.castles[before.save.state.home].troops);assert.equal(balance.reductions.castles,before.save.state.castles.nijo.troops);assert(balance.reductions.branches>0);
  const result=await put(h,p,before.save,{legacy:true});assert.deepEqual(troops(result.save),troops(JSON.parse(expected.exportSave())));assert.deepEqual(model(h,p).branches,result.save.state.branches);assert.equal(ledger(h,p).sequence,2);minimum(engine(result));assert.deepEqual(engine(result).maintenance().facilityUpkeep,fixed);
  assertAdjustment(result,before.save,balance);
  const sequence=ledger(h,p).sequence;
  const forged=copy(result.save);forged.state.branches[0].stationedTroops=99999999;
  for(let attempt=0;attempt<2;attempt++){
   const retried=await put(h,p,forged,{legacy:true}),fresh=await snapshot(h,p),listed=(await h.api('/branches?deviceId='+p.deviceId,{token:p.token})).data;
   assert.deepEqual(troops(retried.save),troops(result.save));assert.deepEqual(troops(fresh.save),troops(result.save));assert.deepEqual(listed.branchState.branches,result.save.state.branches);assert.equal(ledger(h,p).sequence,sequence,'repeated stale input cannot reduce the authoritative branch twice');
  }
 });

 await scope('adjustment allocations preserve the final debit when an emptied retreating branch disappears',async h=>{
  const p=await fixture(h,'退避兵の減兵明細',{holdings:['nijo']});seedBranches(h,p,[{...branch(1000),fallen:true,retreating:true}]);
  h.sql.prepare('INSERT INTO vacant_garrisons VALUES(?,?,?,?,?,?)').run(p.user.id,save(h,p).state.walking.campaignId,'inuyama',30000,1,h.now);
  const current=await advance(h,p,{rebalanceTroops:false}),expected=current.game,balance=expected.settleMonthlyUpkeep(),result=await put(h,p,current.save,{legacy:true});assertAdjustment(result,current.save,balance);
  assert.equal(result.upkeepAdjustment.before.branches.nijo_north,1000);assert.deepEqual(result.upkeepAdjustment.after.branches,{});assert(result.upkeepAdjustment.allocations.some(item=>item.kind==='branch'&&item.id==='nijo_north'&&item.removed===1000));assert.deepEqual(model(h,p).branches,[]);
 });

 await scope('a modern monthly receipt debits a retreating branch exactly once after the client prunes it',async h=>{
  const p=await fixture(h,'退避兵の月次記録',{holdings:['nijo']});seedBranches(h,p,[{...branch(1000),fallen:true,retreating:true}]);
  h.sql.prepare('INSERT INTO vacant_garrisons VALUES(?,?,?,?,?,?)').run(p.user.id,save(h,p).state.walking.campaignId,'inuyama',30000,1,h.now);
  const pending=await advance(h,p);assert.deepEqual(pending.save.state.branches,[]);assert.equal(pending.save.state.upkeep.branchReductions.nijo_north,1000);
  const result=await put(h,p,pending.save);assert.deepEqual(result.save.state.branches,[]);assert.deepEqual(model(h,p).branches,[]);assert.deepEqual(result.upkeepAdjustment.allocations,[{kind:'branch',id:'nijo_north',removed:1000}]);assert.equal(result.upkeepAdjustment.before.branches.nijo_north,1000);assert.deepEqual(result.upkeepAdjustment.after.branches,{});
  const repeated=await put(h,p,result.save);assert(!repeated.upkeepAdjustment);assert.deepEqual(repeated.save.state.upkeep,result.save.state.upkeep);
 });

 await scope('proof-only branch replay does not reduce troops using obsolete income before merged improvements',async h=>{
  const p=await fixture(h,'改善後の収入を使う',{holdings:['nijo']});
  updateSave(h,p,state=>{state.troops=300;state.castles[state.home].troops=400;state.castles.nijo.troops=500;});seedBranches(h,p,[branch(25000)]);
  const before=await snapshot(h,p);assert(engine(before).income().rice<0);
  h.now+=1000;const latest=await snapshot(h,p),incoming=copy(before.save);incoming.state.worldClock.elapsedMs=latest.clock.elapsedMs;incoming.state.realtime.elapsed=1;incoming.state.buildings.farm=32;
  const expected=GameEngine.fromSave(incoming,GAME_OFFICERS,{maintenanceAuthority:latest.maintenanceAuthority});assert(expected.income().rice>0);
  const written=await put(h,p,incoming);assert.deepEqual(troops(written.save),troops(incoming));assert.equal(ledger(h,p).resolved_elapsed_ms,1000);assert.equal(ledger(h,p).sequence,1);assert.equal(written.save.state.buildings.farm,32);
 });

 await scope('player save and branch debits roll back together when ledger persistence fails',async h=>{
  const p=await fixture(h,'減兵保存の原子性',{holdings:['nijo']});updateSave(h,p,state=>{state.troops=0;for(const castle of Object.values(state.castles))if(castle.owner===state.clan)castle.troops=0;});seedBranches(h,p,[branch(25000)]);
  const current=await advance(h,p),before=copy({save:row(h,p),branch:ledger(h,p)});
  h.sql.exec("CREATE TRIGGER fail_upkeep_branch BEFORE UPDATE ON branch_states BEGIN SELECT RAISE(ABORT,'fixture branch rollback'); END");
  await put(h,p,current.save,{expected:500});assert.deepEqual(copy({save:row(h,p),branch:ledger(h,p)}),before);
  h.sql.exec('DROP TRIGGER fail_upkeep_branch');const result=await put(h,p,current.save);assert(result.save.state.branches[0].stationedTroops<25000);assert.deepEqual(result.save.state.branches,model(h,p).branches);
 });

 await scope('external troop ownership is charged but never removed by sync normalization',async h=>{
  const p=await fixture(h,'預託兵は維持する',{holdings:['nijo']});seedBranches(h,p,[branch(1000)]);
  h.sql.prepare('INSERT INTO vacant_garrisons VALUES(?,?,?,?,?,?)').run(p.user.id,save(h,p).state.walking.campaignId,'inuyama',30000,1,h.now);
  const current=await advance(h,p),outside=copy(h.sql.prepare('SELECT * FROM vacant_garrisons WHERE actor_id=?').all(p.user.id));
  const result=await put(h,p,current.save),game=engine(result);assert.equal(game.maintenance().troops.external,30000);assert.equal(game.state.troops,0);assert(game.ownedCastles().every(castle=>castle.troops===0));assert.equal(result.save.state.branches[0].stationedTroops,0);assert(game.income().rice<0,'protected external forces may leave a residual deficit');
  assert.deepEqual(copy(h.sql.prepare('SELECT * FROM vacant_garrisons WHERE actor_id=?').all(p.user.id)),outside);
 });

 await scope('switching campaigns does not impose a midmonth cut; the next month uses destination depots',async h=>{
  const p=await fixture(h,'戦役別の維持費'),original=save(h,p);original.state.troops=20000;
  h.sql.prepare('INSERT INTO vacant_garrisons VALUES(?,?,?,?,?,?)').run(p.user.id,original.state.walking.campaignId,'inuyama',30000,1,h.now);
  await snapshot(h,p);const fresh=copy(original);fresh.state.walking.campaignId='fresh-upkeep-campaign';delete fresh.state.roaming;
  const switched=await put(h,p,fresh,{legacy:true});assert.equal(switched.save.state.troops,20000);assert.equal(engine(switched).maintenance().troops.external,0);
  const restored=await put(h,p,original,{legacy:true});assert.equal(restored.save.state.troops,20000);assert.equal(engine(restored).maintenance().troops.external,30000);
  const pending=await advance(h,p),settled=await put(h,p,pending.save);assert.equal(settled.save.state.troops,0);assert.equal(h.sql.prepare('SELECT troops FROM vacant_garrisons WHERE actor_id=?').get(p.user.id).troops,30000);
 });

 await scope('staff personal-home upkeep reductions survive refresh, old flushes and dismissal without touching shared Kyoto',async h=>{
  await fixture(h,'減兵検証の運営',{admin:true});const p=await fixture(h,'個人本拠の維持兵',{startCastle:'himeji'});
  updateSave(h,p,state=>{state.troops=100;state.castles.himeji.troops=100000;});
  await h.api('/admin/staff',post(h.operator,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));
  const before=await advance(h,p),home=personal(h,p).home;assert(before.save.state.castles[home].troops<100000);
  const kyoto=before.save.state.castles.kyoto_gosho.troops,shared=copy(h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get()),result=await put(h,p,before.save),remaining=result.save.state.castles[home].troops;
  assert.equal(remaining,before.save.state.castles[home].troops);
  assert(remaining<100000);assert.equal(result.save.state.castles.kyoto_gosho.troops,kyoto);assert.equal(result.staffBase.personalHomeCastle.troops,remaining);assert.equal(personal(h,p).castles[home].troops,remaining);assert.equal(engine(result).state.castles[home].troops,remaining);assert.deepEqual(copy(h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get()),shared);
  const retried=await put(h,p,result.save,{legacy:true});assert.equal(retried.save.state.castles[home].troops,remaining);assert.equal(personal(h,p).castles[home].troops,remaining);
  const fresh=await snapshot(h,p);assert.equal(engine(fresh).state.castles[home].troops,remaining);
  await h.api('/admin/staff',post(h.operator,{targetPlayerId:p.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
  const dismissed=await snapshot(h,p);assert.equal(dismissed.save.state.home,home);assert.equal(dismissed.save.state.castles[home].troops,remaining);
 });

 await scope('staff shared-base changes invalidate a prepared upkeep save and leave both private copies intact',async h=>{
  await fixture(h,'共同収入の運営',{admin:true});const p=await fixture(h,'共同収入の競合',{staff:true,startCastle:'himeji'}),before=await snapshot(h,p),incoming=copy(before.save);incoming.state.troops=20000;
  const stored=copy(row(h,p)),oldBackup=copy(backup(h,p));
  h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('UPDATE player_saves SET save_json=')||!statements[0]?.sql.includes('RETURNING *'))return;h.beforeBatch=null;h.sql.prepare("UPDATE staff_base SET revision=revision+1 WHERE id='kyoto_gosho'").run();};
  const blocked=await put(h,p,incoming,{expected:409});assert.equal(blocked.error.code,'REVISION_CONFLICT');assert.deepEqual(copy(row(h,p)),stored);assert.deepEqual(copy(backup(h,p)),oldBackup);
  const accepted=await put(h,p,incoming);assert.equal(accepted.save.state.troops,incoming.state.troops,'a shared-base retry is not a monthly settlement');
 });

 await scope('roaming arrival saves branch and personal-home reductions atomically while the travelling army reaches its battle',async h=>{
  await fixture(h,'野良兵到着の運営',{admin:true});const p=await fixture(h,'進軍中の維持費',{staff:true,holdings:['nijo'],startCastle:'himeji'});const near=await advance(h,p,{elapsedMs:59000});await put(h,p,near.save);const before=await snapshot(h,p);
  const map=(await h.api('/roaming/map?castleId=kyoto_gosho',{token:p.token})).data,unit=map.units[0];assert(unit);
  const request={requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:before.revision,campaignId:before.save.state.walking.campaignId,sequence:before.save.state.roaming.sequence,encounterId:unit.encounterId,unitId:unit.unitId,castleId:unit.castleId,deploymentRevision:unit.deploymentRevision,tactic:'balanced',troops:1000};
  const departure=(await h.api('/roaming/battle',post(p,request))).data;assert(departure.marching);
  const home=personal(h,p).home,stored=personal(h,p);stored.castles[home].troops=100000;
  h.sql.prepare('UPDATE staff_campaign_backups SET save_json=? WHERE user_id=?').run(JSON.stringify({...JSON.parse(backup(h,p).save_json),state:stored}),p.user.id);
  updateSave(h,p,state=>{state.troops=0;state.castles[home].troops=100000;});seedBranches(h,p,[branch(25000)]);
  h.sql.prepare('INSERT INTO vacant_garrisons VALUES(?,?,?,?,?,?)').run(p.user.id,save(h,p).state.walking.campaignId,'inuyama',30000,1,h.now);
  await snapshot(h,p); // Establish the depot change before the next monthly boundary.
  h.now+=departure.march.remainingMs;const arrival=(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data,receipt=arrival.history.find(item=>item.id===departure.march.id);
  assert.equal(receipt?.status,'resolved');assert(receipt.battle,'travelling soldiers remained available for their accepted battle');
  const current=await snapshot(h,p);assert.equal(current.save.state.castles[home].troops,0);assert.equal(personal(h,p).castles[home].troops,0);assert.equal(current.staffBase.personalHomeCastle.troops,0);assert.equal(current.save.state.castles.kyoto_gosho.troops,before.save.state.castles.kyoto_gosho.troops);assert.equal(model(h,p).branches[0].stationedTroops,0);assert.deepEqual(current.save.state.branches,model(h,p).branches);
  const committed=copy({save:row(h,p),branch:ledger(h,p),backup:backup(h,p)});await h.api('/marches?deviceId='+p.deviceId,{token:p.token});assert.deepEqual(copy({save:row(h,p),branch:ledger(h,p),backup:backup(h,p)}),committed,'arrival replay cannot repeat or reverse the debit');
 });

 await scope('a roaming arrival during the same month does not settle an existing deficit',async h=>{
  const p=await fixture(h,'月途中に野良兵へ進軍',{holdings:['nijo']}),before=await snapshot(h,p),map=(await h.api('/roaming/map?castleId='+before.save.state.home,{token:p.token})).data,unit=map.units[0];assert(unit);
  const departure=(await h.api('/roaming/battle',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:before.revision,campaignId:before.save.state.walking.campaignId,sequence:before.save.state.roaming.sequence,encounterId:unit.encounterId,unitId:unit.unitId,castleId:unit.castleId,deploymentRevision:unit.deploymentRevision,tactic:'balanced',troops:1000}))).data;
  assert(departure.march.remainingMs<60000);updateSave(h,p,state=>{state.castles[state.home].troops=100000;});seedBranches(h,p,[branch(25000)]);
  h.now+=departure.march.remainingMs;const arrival=(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;assert.equal(arrival.history.find(item=>item.id===departure.march.id)?.status,'resolved');
  const current=await snapshot(h,p);assert.equal(current.save.state.turn,0);assert.equal(current.save.state.castles[current.save.state.home].troops,100000);assert.equal(model(h,p).branches[0].stationedTroops,25000);assert.equal(current.save.state.upkeep.settledTurn,0);assert.deepEqual(current.save.state.upkeep.branchReductions,{});assert(engine(current).income().rice<0);
 });

 await scope('covert arrival persists branch and personal-home reductions without deleting the dispatched force',async h=>{
  await fixture(h,'部隊到着の運営',{admin:true});const p=await fixture(h,'派遣中の維持費',{staff:true,holdings:['nijo'],startCastle:'himeji'});const near=await advance(h,p,{elapsedMs:59000});await put(h,p,near.save);
  const command=(action,extra)=>h.api('/covert/'+action,post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId,sequence:save(h,p).state.covert.sequence,...extra}));
  await command('hire',{sourceCastleId:'nijo',count:50});const departure=(await command('dispatch',{sourceCastleId:'nijo',target:{kind:'castle',castleId:'osaka'},count:40,mode:'station'})).data;
  const home=personal(h,p).home,stored=personal(h,p);stored.castles[home].troops=100000;
  h.sql.prepare('UPDATE staff_campaign_backups SET save_json=? WHERE user_id=?').run(JSON.stringify({...JSON.parse(backup(h,p).save_json),state:stored}),p.user.id);
  updateSave(h,p,state=>{state.troops=0;state.castles[home].troops=100000;});seedBranches(h,p,[branch(25000)]);
  h.sql.prepare('INSERT INTO vacant_garrisons VALUES(?,?,?,?,?,?)').run(p.user.id,save(h,p).state.walking.campaignId,'inuyama',30000,1,h.now);
  await snapshot(h,p);
  h.now+=departure.march.remainingMs;const arrived=(await h.api('/covert',{token:p.token})).data;assert.equal(arrived.covert.stations[0]?.count,40);
  const current=await snapshot(h,p);assert.equal(current.save.state.covert.reserves.nijo,10);assert.equal(current.save.state.castles[home].troops,0);assert.equal(personal(h,p).castles[home].troops,0);assert.equal(current.staffBase.personalHomeCastle.troops,0);assert.equal(model(h,p).branches[0].stationedTroops,0);assert.deepEqual(current.save.state.branches,model(h,p).branches);
  const committed=copy({save:row(h,p),branch:ledger(h,p),backup:backup(h,p)});await h.api('/covert',{token:p.token});assert.deepEqual(copy({save:row(h,p),branch:ledger(h,p),backup:backup(h,p)}),committed);
 });

 await scope('branch construction charges the current three-castle multiplier once and keeps time and upkeep units unchanged',async h=>{
  const p=await fixture(h,'三城で支城を建てる',{holdings:['nijo','osaka']}),before=await snapshot(h,p),game=engine(before),quote=game.branchQuote('nijo','north'),base=GameEngine.branchUpgradeCost('nijo',0);
  assert.equal(game.upgradeCastleCount(),3);for(const key of resources)assert.equal(quote.cost[key],base[key]*4);assert.equal(quote.cost.seconds,base.seconds);
  const fixed=copy(game.maintenance().facilityUpkeep),request={requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:before.revision,campaignId:before.save.state.walking.campaignId,sequence:0,parentCastleId:'nijo',direction:'north'},result=(await h.api('/branches/build',post(p,request))).data;
  for(const key of resources)assert.equal(result.save.state.resources[key],before.save.state.resources[key]-quote.cost[key]);assert.equal(result.save.state.command,before.save.state.command-1);assert.equal(model(h,p).jobs[0].totalSeconds,base.seconds);assert.deepEqual(engine(result).maintenance().facilityUpkeep,fixed,'pending construction does not multiply recurring upkeep');
  const costAfter=engine(result).branchQuote('nijo','east').cost;assert.deepEqual(costAfter,quote.cost,'a branch does not count as another owned castle');
  const repeated=(await h.api('/branches/build',post(p,request))).data;assert(repeated.idempotent);assert.deepEqual(repeated.save.state.resources,result.save.state.resources);
 });

 await scope('Kyoto joint construction uses the paying staff member personal castle count and preserves recurring upkeep',async h=>{
  await fixture(h,'共同普請費の運営',{admin:true});const p=await fixture(h,'三城の共同普請',{staff:true,holdings:['nijo','osaka'],startCastle:'himeji'});seedBranches(h,p,[branch()]);
  const before=await snapshot(h,p),game=engine(before),baseGame=new GameEngine({officers:GAME_OFFICERS,seed:1}),baseCost=baseGame.costs('farm',before.staffBase.buildings.farm),cost=game.costs('farm');
  assert.equal(game.ownedCastles().length,4);assert.equal(game.upgradeCastleCount(),3);for(const key of resources)assert.equal(cost[key],baseCost[key]*4);
  const fixed=copy(game.maintenance().facilityUpkeep),request={kind:'building',id:'farm',requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:before.revision,baseRevision:before.staffBase.revision},result=(await h.api('/staff/base/upgrade',post(p,request))).data;
  for(const key of resources){assert.equal(result.receipt.cost[key],cost[key]);assert.equal(result.save.state.resources[key],before.save.state.resources[key]-cost[key]);}
  assert.equal(result.receipt.completesElapsedMs-result.receipt.startedElapsedMs,cost.seconds*1000);assert.equal(result.save.state.command,before.save.state.command-1);assert.deepEqual(engine(result).maintenance().facilityUpkeep,fixed);
 });
 console.log(JSON.stringify({checks:reports.length,reports},null,2));
}finally{globalThis.fetch=originalFetch;}
