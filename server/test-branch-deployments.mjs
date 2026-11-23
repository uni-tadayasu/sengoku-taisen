// Actual Worker, journal migrations and atomic local SQLite; no production I/O.
import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';

const clone=value=>structuredClone(value),failures=[];let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}catch(error){failures.push({name,error});console.error('FAIL '+name+'\n'+error.stack);}finally{calls+=h.calls;h.close();}}
const ledger=(h,p)=>h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,save(h,p).state.walking.campaignId);
const movement=(h,p)=>h.sql.prepare('SELECT * FROM troop_transfer_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,save(h,p).state.walking.campaignId);
const model=(h,p)=>JSON.parse(ledger(h,p)?.state_json||'{"branches":[],"jobs":[]}');
const receipts=(h,p)=>h.sql.prepare('SELECT * FROM branch_deployment_requests WHERE actor_id=? ORDER BY request_id').all(p.user.id);
const stable=(h,p)=>clone({save:row(h,p),ledger:ledger(h,p),movement:movement(h,p),receipts:receipts(h,p)});
const body=(h,p,extra={})=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId,sequence:ledger(h,p)?.sequence||0,...extra});
const action=(h,p,name,extra={},expected=200)=>h.api('/branches/'+name,post(p,body(h,p,extra),expected));
const transfer=(h,p,from,to,troops,expected=200)=>action(h,p,'transfer-troops',{from,to,troops},expected);
const total=value=>value.state.troops+Object.values(value.state.castles).filter(c=>c.owner===value.state.clan).reduce((sum,c)=>sum+c.troops,0)+value.state.branches.reduce((sum,b)=>sum+(b.stationedTroops||0),0);
const put=(h,p,value,expected=200)=>h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected});
function seed(h,p,{admin=false}={}){
 const branches=['nijo','osaka',...(admin?['edo']:[])].map(parent=>({id:parent+'_north',parentCastleId:parent,direction:'north',level:2,fallen:false}));
 updateSave(h,p,s=>{for(const b of branches)s.castles[b.parentCastleId].owner=s.clan;s.branches=clone(branches);s.jobs=[];s.troops=4000;s.command=5;s.army=[];});
 h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,resolved_elapsed_ms,updated_at) VALUES(?,?,1,?,?,?)').run(p.user.id,save(h,p).state.walking.campaignId,JSON.stringify({branches,jobs:[]}),save(h,p).state.worldClock.elapsedMs,h.now);
}
function updateBranch(h,p,change){const value=model(h,p);change(value);h.sql.prepare('UPDATE branch_states SET state_json=?,sequence=sequence+1 WHERE actor_id=? AND campaign_id=?').run(JSON.stringify(value),p.user.id,save(h,p).state.walking.campaignId);updateSave(h,p,s=>{s.branches=clone(value.branches);s.jobs=clone(value.jobs);});}
function recharge(h,p){updateSave(h,p,s=>{s.command=5;});}
function freeRoster(h,p,{admin=false}={}){
 const game=GameEngine.fromSave(save(h,p),GAME_OFFICERS,{isAdmin:admin});
 for(const officer of game.roster.filter(officer=>game.canOwnOfficerVariant(officer.id,'A')).slice(0,12))game._grantOfficerVariant(officer.id,'A');
 updateSave(h,p,s=>{s.officers=clone(game.state.officers);s.officerVariants=clone(game.state.officerVariants);s.stats.recruited=game.state.stats.recruited;s.army=[];s.governors={};s.command=0;s.resources={gold:0,rice:0,wood:0,stone:0};});
 return save(h,p).state.officers;
}

const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Deployment tests must not contact production');};
try{
 await scope('authenticated finite troop route validates input and returns only owned movable stocks',async h=>{
  await h.api('/branches/transfer-troops',{method:'POST',body:{},expected:401});const p=await fixture(h,'配置の検証',{holdings:['nijo','osaka']});seed(h,p);
  const status=(await h.api('/branches?deviceId='+p.deviceId,{token:p.token})).data;assert.equal(status.troopTransferSequence,0);assert(status.troopTransfer.endpoints.some(e=>e.id==='army'));assert(!status.troopTransfer.endpoints.some(e=>e.id==='castle:edo'));assert.equal(status.troopTransfer.endpoints.find(e=>e.id==='branch:nijo_north').troops,0);
  const before=stable(h,p);for(const extra of [{troops:0},{troops:1.5},{troops:'1'},{troops:GameEngine.ASSET_CAP+1},{from:'__proto__'},{to:'army:bad'},{power:999},{stationedTroops:999}])await action(h,p,'transfer-troops',{from:'army',to:'castle:nijo',troops:1,...extra},400);
  for(const [from,to,n]of [['army','army',1],['castle:edo','army',1],['branch:nijo_north','army',1],['army','branch:missing',1],['army','castle:nijo',5000]])await transfer(h,p,from,to,n,409);assert.deepEqual(stable(h,p),before);
 });

 await scope('every main/branch/army direction persists one exact debit-credit and marker without changing resources',async h=>{
  const p=await fixture(h,'全方向の兵移動',{holdings:['nijo','osaka']});seed(h,p);let expected=0;
  for(const [from,to,n]of [['army','castle:nijo',400],['castle:nijo','castle:osaka',200],['castle:osaka','branch:nijo_north',300],['branch:nijo_north','branch:osaka_north',120],['branch:osaka_north','castle:nijo',80],['branch:nijo_north','army',100],['castle:nijo','army',100]]){
   recharge(h,p);const before=save(h,p),r=(await transfer(h,p,from,to,n)).data,after=save(h,p);assert.equal(total(after),total(before));assert.deepEqual(after.state.resources,before.state.resources);assert.equal(after.state.command,before.state.command-1);assert.equal(after.state.troopTransferSequence,++expected);assert.equal(movement(h,p).sequence,expected);assert.equal(r.result.sourceBefore-r.result.sourceAfter,n);assert.equal(r.result.destinationAfter-r.result.destinationBefore,n);assert.equal(r.idempotent,false);
  }
  assert.equal(model(h,p).branches.find(b=>b.id==='nijo_north').stationedTroops,80);assert.equal(model(h,p).branches.find(b=>b.id==='osaka_north').stationedTroops,40);assert.equal(receipts(h,p).length,7);
  const current=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.equal(total(current.save),total(save(h,p)));assert.equal(current.save.state.troopTransferSequence,7);
 });

 await scope('fallen and orphan branches retain soldiers as source-only stock with exact subsequent withdrawal',async h=>{
  const p=await fixture(h,'支城の撤収',{holdings:['nijo','osaka']});seed(h,p);await transfer(h,p,'army','branch:nijo_north',300);updateBranch(h,p,state=>{state.branches[0].fallen=true;});
  const before=stable(h,p);await transfer(h,p,'army','branch:nijo_north',1,409);assert.deepEqual(stable(h,p),before);recharge(h,p);await transfer(h,p,'branch:nijo_north','castle:osaka',100);assert.equal(model(h,p).branches[0].stationedTroops,200);
  const checkpoint=GameEngine.fromSave(save(h,p),GAME_OFFICERS);checkpoint.state.castles.nijo.owner='在地衆';checkpoint._pruneBranches();h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(checkpoint.exportSave(),p.user.id);
  const current=(await h.api('/branches?deviceId='+p.deviceId,{token:p.token})).data,retreat=current.troopTransfer.endpoints.find(e=>e.id==='branch:nijo_north');assert(retreat.retreating&&retreat.canSource&&!retreat.canDestination);assert.equal(retreat.troops,200);
  recharge(h,p);await transfer(h,p,'branch:nijo_north','castle:osaka',200);assert(!model(h,p).branches.some(b=>b.id==='nijo_north'));assert(!save(h,p).state.branches.some(b=>b.id==='nijo_north'));
 });

 await scope('actual CPU capture and a divergent held-parent replay preserve one exact stationed balance',async h=>{
  for(const retained of [false,true]){
   h.resetRates();const p=await fixture(h,'CPU駐留兵'+retained,{holdings:['nijo','osaka']});seed(h,p);await transfer(h,p,'army','branch:nijo_north',300);
   updateBranch(h,p,state=>{state.branches=state.branches.filter(b=>b.id==='nijo_north');state.branches[0].fallen=true;});
   updateSave(h,p,s=>{for(const c of Object.values(s.castles)){c.owner='在地衆';c.troops=100000;}s.castles.nijo={owner:s.clan,troops:100,wall:1,level:1};s.home=s.cycle.home='nijo';s.difficulty='hard';s.troops=300;s.treaties={};s.seed=17;s.turn=8;s.upkeep.settledTurn=Math.min(s.upkeep.settledTurn,8);s.realtime.elapsed=59;s.worldClock.elapsedMs=539000;});
   h.sql.prepare('UPDATE branch_states SET resolved_elapsed_ms=539000 WHERE actor_id=?').run(p.user.id);h.sql.prepare('UPDATE castle_seats SET lord_user_id=NULL,lord_epoch=lord_epoch+1 WHERE lord_user_id=?').run(p.user.id);h.sql.prepare('DELETE FROM castle_residents WHERE user_id=?').run(p.user.id);h.sql.prepare('UPDATE player_saves SET cycle_home=? WHERE user_id=?').run('nijo',p.user.id);
   const game=GameEngine.fromSave(save(h,p),GAME_OFFICERS),clock={id:game.state.worldClock.id,elapsedMs:540000,running:true,speed:1};assert(game.applyWorldClock(clock,{maxSeconds:86400}).ok);const incoming=JSON.parse(game.exportSave());assert.notEqual(incoming.state.castles.nijo.owner,incoming.state.clan);assert.equal(incoming.state.branches[0].stationedTroops,300);assert(incoming.state.branches[0].retreating);
   if(retained)incoming.state.castles.nijo.owner=incoming.state.clan;
   h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(540000,h.now);
   const accepted=(await put(h,p,incoming)).data;assert.equal(accepted.save.state.branches.length,1);assert.equal(accepted.save.state.branches[0].stationedTroops,300);assert.equal(!!accepted.save.state.branches[0].retreating,!retained);assert.equal(accepted.save.state.troops,incoming.state.troops);assert.equal(accepted.save.state.troopTransferSequence,1);
   const again=(await put(h,p,accepted.save)).data;assert.equal(again.save.state.branches.length,1);assert.equal(again.save.state.branches[0].stationedTroops,300);assert.equal(again.save.state.troops,accepted.save.state.troops);
  }
 });

 await scope('server cycle settlement retains nonhome branch soldiers as withdrawal-only escrow exactly once',async h=>{
  const p=await fixture(h,'時代更新の駐留兵',{holdings:['nijo','osaka']});seed(h,p);await transfer(h,p,'army','branch:nijo_north',300);const boundary=672*60000;
  updateSave(h,p,s=>{s.turn=671;s.realtime.elapsed=59;s.worldClock.elapsedMs=boundary-1000;});h.sql.prepare('UPDATE branch_states SET resolved_elapsed_ms=? WHERE actor_id=?').run(boundary-1000,p.user.id);h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(boundary,h.now);
  const settled=(await h.api('/sync/settle',post(p,{deviceId:p.deviceId,revision:row(h,p).revision}))).data;assert.equal(settled.save.state.cycle.index,1);assert.equal(settled.save.state.branches.length,1);assert(settled.save.state.branches[0].retreating);assert.equal(settled.save.state.branches[0].stationedTroops,300);assert.equal(settled.save.state.troopTransferSequence,1);
  const again=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.equal(again.save.state.branches[0].stationedTroops,300);recharge(h,p);const before=save(h,p);await transfer(h,p,'branch:nijo_north','castle:'+before.state.home,300);assert.equal(total(save(h,p)),total(before));assert.equal(save(h,p).state.branches.length,0);
 });

 await scope('immutable receipts recover lost responses, reject reused IDs and serialize simultaneous repeated requests',async h=>{
  const p=await fixture(h,'兵移動の再送',{holdings:['nijo','osaka']});seed(h,p);const request=body(h,p,{from:'army',to:'branch:nijo_north',troops:300}),before=save(h,p);let inner;
  h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.beforeBatch=null;inner=(await h.api('/branches/transfer-troops',post(p,request))).data;};const outer=(await h.api('/branches/transfer-troops',post(p,request))).data;assert(!inner.idempotent&&outer.idempotent);assert.equal(save(h,p).state.troops,before.state.troops-300);assert.equal(receipts(h,p).length,1);
  const committed=stable(h,p),retry=(await h.api('/branches/transfer-troops',post(p,{...request,deviceId:'reader',expectedRevision:0}))).data;assert(retry.idempotent);assert.deepEqual(stable(h,p),committed);await h.api('/branches/transfer-troops',post(p,{...request,troops:301},409));await h.api('/branches/assign-commander',post(p,{...(({from,to,troops,...common})=>common)(request),branchId:'nijo_north',officerId:save(h,p).state.officers[0]},409));
  recharge(h,p);const lost=body(h,p,{from:'castle:nijo',to:'castle:osaka',troops:100});h.afterBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.afterBatch=null;throw Error('Local deployment response lost');};await h.api('/branches/transfer-troops',post(p,lost,500));const accepted=stable(h,p);assert((await h.api('/branches/transfer-troops',post(p,lost))).data.idempotent);assert.deepEqual(stable(h,p),accepted);
 });

 await scope('two distinct concurrent requests cannot spend the same soldiers or restore a stale pure-castle checkpoint',async h=>{
  const p=await fixture(h,'兵移動の競合',{holdings:['nijo','osaka']});seed(h,p);const old=save(h,p),first=body(h,p,{from:'army',to:'castle:nijo',troops:3000}),second={...first,requestId:crypto.randomUUID(),to:'castle:osaka'};
  h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.beforeBatch=null;await h.api('/branches/transfer-troops',post(p,second));};await h.api('/branches/transfer-troops',post(p,first,409));assert.equal(save(h,p).state.troops,1000);assert.equal(receipts(h,p).length,1);assert.equal(movement(h,p).sequence,1);
  const committed=stable(h,p),rejected=await put(h,p,old,409);assert.equal(rejected.data.error.code,'TROOP_STATE_CHANGED');assert.deepEqual(stable(h,p),committed);
 });

 await scope('commit-time writer, revision, branch, troop, clock and administrator guards prevent partial movement',async h=>{
  for(const kind of ['writer','revision','branch','troop','clock','operator']){
   h.resetRates();const p=await fixture(h,'移動の条件'+kind,{admin:kind==='operator',holdings:['nijo','osaka']});seed(h,p,{admin:kind==='operator'});const request=body(h,p,{from:'army',to:kind==='operator'?'branch:edo_north':'branch:nijo_north',troops:200});let expected;
   h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.beforeBatch=null;if(kind==='writer')h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run('other-device',p.user.id);if(kind==='revision')h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(p.user.id);if(kind==='branch')h.sql.prepare('UPDATE branch_states SET sequence=sequence+1 WHERE actor_id=?').run(p.user.id);if(kind==='troop')h.sql.prepare('INSERT INTO troop_transfer_states(actor_id,campaign_id,sequence,updated_at) VALUES(?,?,1,?)').run(p.user.id,request.campaignId,h.now);if(kind==='clock')h.sql.exec('UPDATE world_clock SET revision=revision+1');if(kind==='operator')h.sql.prepare("UPDATE settings SET value='replacement-operator' WHERE key='adminUserId'").run();expected=stable(h,p);};await h.api('/branches/transfer-troops',post(p,request,409));assert(expected);assert.deepEqual(stable(h,p),expected,kind);
  }
 });

 await scope('a failed marker write rolls back the save, command, receipt and branch garrison together',async h=>{
  const p=await fixture(h,'移動の一括保存',{holdings:['nijo','osaka']});seed(h,p);const request=body(h,p,{from:'army',to:'branch:nijo_north',troops:100}),before=stable(h,p);
  h.sql.exec("CREATE TEMP TRIGGER stop_troop_marker BEFORE INSERT ON troop_transfer_states BEGIN SELECT RAISE(ABORT,'local marker rollback'); END");await h.api('/branches/transfer-troops',post(p,request,500));h.sql.exec('DROP TRIGGER stop_troop_marker');assert.deepEqual(stable(h,p),before);await h.api('/branches/transfer-troops',post(p,request));assert.equal(receipts(h,p).length,1);assert.equal(movement(h,p).sequence,1);
 });

 await scope('commander placement respects owned IDs, Edo/major limits, formation conflicts and branch ledger replay',async h=>{
  const p=await fixture(h,'支城の武将',{admin:true,holdings:['nijo','osaka']});seed(h,p,{admin:true});const ids=save(h,p).state.officers.slice(0,3),before=save(h,p);
  await action(h,p,'assign-commander',{branchId:'nijo_north',officerId:ids[0]});await action(h,p,'assign-commander',{branchId:'nijo_north',officerId:ids[1]});await action(h,p,'assign-commander',{branchId:'nijo_north',officerId:ids[2]},409);
  await action(h,p,'assign-commander',{branchId:'edo_north',officerId:ids[2]});await action(h,p,'assign-commander',{branchId:'osaka_north',officerId:ids[0]},409);await action(h,p,'assign-commander',{branchId:'osaka_north',officerId:'foreign'},409);
  assert.deepEqual(model(h,p).branches.find(b=>b.id==='nijo_north').commanders,ids.slice(0,2));assert.equal(save(h,p).state.command,before.state.command);assert.deepEqual(save(h,p).state.resources,before.state.resources);assert.equal(movement(h,p),undefined);assert.equal(save(h,p).state.troopTransferSequence,0);
  const old=clone(before);old.state.troopTransferSequence=0;const canonical=(await put(h,p,old)).data;assert.deepEqual(canonical.save.state.branches.find(b=>b.id==='nijo_north').commanders,ids.slice(0,2));
  const bad=clone(canonical.save);bad.state.army=[ids[0]];await put(h,p,bad,400);
  updateBranch(h,p,state=>{state.branches.find(b=>b.id==='nijo_north').fallen=true;});await action(h,p,'remove-commander',{branchId:'nijo_north',officerId:ids[0]});await action(h,p,'assign-commander',{branchId:'osaka_north',officerId:ids[0]});
  assert(!model(h,p).branches.find(b=>b.id==='nijo_north').commanders.includes(ids[0]));assert.deepEqual(model(h,p).branches.find(b=>b.id==='osaka_north').commanders,[ids[0]]);
 });

 await scope('automatic placement is free, preserves the main army and other branches, and transfers facility governors when suited',async h=>{
  for(const admin of [false,true]){
   const p=await fixture(h,'おまかせ配置'+admin,{admin,holdings:['nijo','osaka']});seed(h,p,{admin});const ids=freeRoster(h,p,{admin});
   updateSave(h,p,s=>{s.army=[ids[0]];s.governors={farm:ids[1]};});await action(h,p,'assign-commander',{branchId:'osaka_north',officerId:ids[2]});const before=save(h,p);
   const single=(await action(h,p,'auto-assign-commanders',{branchId:'nijo_north'})).data;assert.equal(single.result.commandCost,0);assert.equal(single.result.assignments.length,2);assert(single.result.assignments.every(item=>item.branchId==='nijo_north'&&ids.includes(item.officerId)&&![ids[0],ids[2]].includes(item.officerId)));
   assert.deepEqual(model(h,p).branches.find(b=>b.id==='osaka_north').commanders,[ids[2]]);assert.deepEqual(single.save.state.army,before.state.army);assert.deepEqual(single.save.state.governors,Object.fromEntries(Object.entries(before.state.governors).filter(([,id])=>!single.result.assignments.some(item=>item.officerId===id))));assert.deepEqual(single.save.state.resources,before.state.resources);assert.equal(single.save.state.command,0);assert.equal(single.save.state.troops,before.state.troops);assert.equal(single.save.state.troopTransferSequence,0);assert.equal(movement(h,p),undefined);
   const singleIds=model(h,p).branches.find(b=>b.id==='nijo_north').commanders,canonical=(await put(h,p,clone(before))).data;assert.deepEqual(canonical.save.state.branches.find(b=>b.id==='nijo_north').commanders,singleIds,'an older saved branch array cannot erase automatic placement');
   const all=(await action(h,p,'auto-assign-commanders',{branchId:'all'})).data,assigned=model(h,p).branches.flatMap(b=>b.commanders||[]);assert.equal(all.result.assignments.length,admin?2:1);assert.equal(new Set(assigned).size,assigned.length);assert(assigned.every(id=>all.save.state.officers.includes(id)&&!all.save.state.army.includes(id)&&!Object.values(all.save.state.governors).includes(id)));
   for(const branch of model(h,p).branches)assert.equal(branch.commanders.length,branch.parentCastleId==='edo'?1:2);assert.deepEqual(model(h,p).branches.find(b=>b.id==='nijo_north').commanders,singleIds);assert.equal(model(h,p).branches.find(b=>b.id==='osaka_north').commanders[0],ids[2]);assert.equal(all.save.state.command,0);assert.deepEqual(all.save.state.resources,before.state.resources);
   const snapshot=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.deepEqual(snapshot.save.state.branches.flatMap(b=>b.commanders||[]).sort(),[...assigned].sort());assert.doesNotThrow(()=>GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isAdmin:admin}));
   const full=stable(h,p);assert.equal((await action(h,p,'auto-assign-commanders',{branchId:'all'},409)).data.error.code,'BRANCH_COMMANDER_NO_SLOTS');assert.deepEqual(stable(h,p),full);
  }
 });

 await scope('automatic assignment rejects unauthorized targets, forged choices and unavailable slots or officers without a receipt',async h=>{
  await h.api('/branches/auto-assign-commanders',{method:'POST',body:{},expected:401});const p=await fixture(h,'おまかせ配置の条件',{holdings:['nijo','osaka']});seed(h,p);const before=stable(h,p);
  for(const branchId of ['missing','edo_north'])await action(h,p,'auto-assign-commanders',{branchId},409);
  for(const extra of [{officerId:save(h,p).state.officers[0]},{assignments:[{officerId:'foreign',branchId:'nijo_north'}]},{commandCost:0}])await action(h,p,'auto-assign-commanders',{branchId:'all',...extra},400);
  await action(h,p,'auto-assign-commanders',{branchId:'all',campaignId:'another-campaign'},409);await action(h,p,'auto-assign-commanders',{branchId:'all',sequence:0},409);assert.deepEqual(stable(h,p),before);
  updateBranch(h,p,state=>{for(const branch of state.branches)branch.fallen=true;});const unavailable=stable(h,p);assert.equal((await action(h,p,'auto-assign-commanders',{branchId:'all'},409)).data.error.code,'BRANCH_COMMANDER_NO_SLOTS');assert.equal((await action(h,p,'auto-assign-commanders',{branchId:'nijo_north'},409)).data.error.code,'BRANCH_COMMANDER_UNAVAILABLE');assert.deepEqual(stable(h,p),unavailable);
  updateBranch(h,p,state=>{for(const branch of state.branches)branch.fallen=false;state.branches[1].commanders=save(h,p).state.officers.slice(3);});updateSave(h,p,s=>{s.army=s.officers.slice(0,3);s.governors={};});const occupied=stable(h,p);assert.equal((await action(h,p,'auto-assign-commanders',{branchId:'all'},409)).data.error.code,'BRANCH_COMMANDER_NO_CANDIDATES');assert.deepEqual(stable(h,p),occupied);
 });

 await scope('automatic assignment receipts recover lost responses, reject changed scope and serialize against manual placement',async h=>{
  const p=await fixture(h,'おまかせ再送',{holdings:['nijo','osaka']});seed(h,p);freeRoster(h,p);const request=body(h,p,{branchId:'all'});
  h.afterBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.afterBatch=null;throw Error('Local automatic placement response lost');};await h.api('/branches/auto-assign-commanders',post(p,request,500));
  const committed=stable(h,p),receipt=receipts(h,p)[0],result=JSON.parse(receipt.result_json);assert.equal(receipts(h,p).length,1);assert.equal(receipt.action,'assign-commander');assert.equal(result.assignments.length,4);
  const replay=(await h.api('/branches/auto-assign-commanders',post(p,{...request,deviceId:'reader',expectedRevision:0}))).data;assert(replay.idempotent);assert.deepEqual(replay.result,result);assert.deepEqual(stable(h,p),committed);
  assert.equal((await h.api('/branches/auto-assign-commanders',post(p,{...request,branchId:'nijo_north'},409))).data.error.code,'REQUEST_ID_REUSED');assert.equal((await h.api('/branches/assign-commander',post(p,{...request,branchId:'nijo_north',officerId:result.assignments[0].officerId},409))).data.error.code,'REQUEST_ID_REUSED');assert.deepEqual(stable(h,p),committed);
  const other=await fixture(h,'おまかせと手動の競合',{holdings:['nijo','osaka']});seed(h,other);const ids=freeRoster(h,other),before=save(h,other),automatic=body(h,other,{branchId:'all'}),manual={...automatic,requestId:crypto.randomUUID(),branchId:'nijo_north',officerId:ids[0]};
  h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.beforeBatch=null;await h.api('/branches/assign-commander',post(other,manual));};await h.api('/branches/auto-assign-commanders',post(other,automatic,409));
  assert.equal(receipts(h,other).length,1);assert.deepEqual(model(h,other).branches.find(b=>b.id==='nijo_north').commanders,[ids[0]]);assert.equal(model(h,other).branches.flatMap(b=>b.commanders||[]).length,1);assert.equal(save(h,other).state.command,before.state.command);assert.deepEqual(save(h,other).state.resources,before.state.resources);assert.equal(movement(h,other),undefined);
  const completed=(await action(h,other,'auto-assign-commanders',{branchId:'all'})).data;assert.equal(completed.result.assignments.length,3);assert.equal(new Set(model(h,other).branches.flatMap(b=>b.commanders||[])).size,4);assert.equal(model(h,other).branches.find(b=>b.id==='nijo_north').commanders[0],ids[0]);
 });

 await scope('automatic bulk placement reuses writer, revision, branch, clock, role and campaign commit guards',async h=>{
  for(const kind of ['writer','revision','branch','clock','operator','campaign']){
   h.resetRates();const admin=kind==='operator',p=await fixture(h,'おまかせ競合'+kind,{admin,holdings:['nijo','osaka']});seed(h,p,{admin});freeRoster(h,p,{admin});const request=body(h,p,{branchId:'all'});let expected;
   const snapshot=()=>clone({save:row(h,p),ledgers:h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? ORDER BY campaign_id').all(p.user.id),receipts:receipts(h,p),movement:movement(h,p)});
   h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.beforeBatch=null;if(kind==='writer')h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run('other-device',p.user.id);if(kind==='revision')h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(p.user.id);if(kind==='branch')h.sql.prepare('UPDATE branch_states SET sequence=sequence+1 WHERE actor_id=?').run(p.user.id);if(kind==='clock')h.sql.exec('UPDATE world_clock SET revision=revision+1');if(kind==='operator')h.sql.prepare("UPDATE settings SET value='replacement-operator' WHERE key='adminUserId'").run();if(kind==='campaign'){const replaced=save(h,p);replaced.state.walking.campaignId+='-replaced';h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(replaced),p.user.id);}expected=snapshot();};
   await h.api('/branches/auto-assign-commanders',post(p,request,409));assert(expected);assert.deepEqual(snapshot(),expected,kind);assert.equal(receipts(h,p).length,0);
  }
 });

 await scope('first cloud import with stationed soldiers is explicitly rejected and a fully returned offline save starts marker zero',async h=>{
  const p=await h.session('初回の兵配置');p.deviceId='first-import-device';const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
  const game=new GameEngine({officers:GAME_OFFICERS,seed:19});game.state.castles.nijo.owner=game.state.clan;game.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false}];game.applyWorldClock(lease.clock);assert(game.transferTroops('army','branch:nijo_north',100).ok);const original=game.exportSave();
  const rejected=await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save:JSON.parse(original)},expected:409});assert.equal(rejected.data.error.code,'TROOP_IMPORT_RECALL_REQUIRED');assert.deepEqual(JSON.parse(game.exportSave()).state,JSON.parse(original).state);assert.equal(row(h,p).save_json,null);
  game.state.command=3;assert(game.transferTroops('branch:nijo_north','castle:nijo',100).ok);const accepted=await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:JSON.parse(game.exportSave())}});assert.equal(accepted.data.save.state.troopTransferSequence,0);assert.equal(accepted.data.save.state.troops,game.state.troops);assert.equal(accepted.data.save.state.castles.nijo.troops,game.state.castles.nijo.troops);
 });
}finally{globalThis.fetch=originalFetch;}
if(failures.length){console.error(JSON.stringify({ok:false,passed:checks,failed:failures.map(f=>f.name),calls,productionRequests:0},null,2));process.exitCode=1;}else console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0},null,2));
