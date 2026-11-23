// Staff personal-home debits must survive backup refresh, dismissal and retry.
// Uses the real Worker transfer route and the normal staff role transitions.
import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';

const reports=[];
const clone=value=>structuredClone(value);
const backup=(h,p)=>h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(p.user.id);
const personal=(h,p)=>JSON.parse(backup(h,p).save_json).state;
const branchLedger=(h,p)=>h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,save(h,p).state.walking.campaignId);
const deploymentReceipts=(h,p)=>h.sql.prepare('SELECT * FROM branch_deployment_requests WHERE actor_id=? ORDER BY request_id').all(p.user.id);
const movement=(h,p)=>h.sql.prepare('SELECT * FROM troop_transfer_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,save(h,p).state.walking.campaignId);
const stable=(h,p)=>clone({save:row(h,p),backup:backup(h,p),branch:branchLedger(h,p),movement:movement(h,p),receipts:deploymentReceipts(h,p)});
const sync=async(h,p)=>(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
const role=(h,p,action)=>h.api('/admin/staff',post(h.operator,{targetPlayerId:p.user.id,action,requestId:crypto.randomUUID()}));
const put=(h,p,value,expected=200)=>h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected});
function body(h,p,from,to,troops){return{from,to,troops,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId,sequence:Number(branchLedger(h,p)?.sequence||0)};}
const transfer=async(h,p,request,expected=200)=>(await h.api('/branches/transfer-troops',post(p,request,expected))).data;
const total=(value,home)=>value.state.troops+value.state.castles[home].troops+value.state.castles.nijo.troops+(value.state.branches||[]).reduce((n,b)=>n+(b.stationedTroops||0),0);
async function staffFixture(h,name){await fixture(h,name+'運営',{admin:true});return fixture(h,name,{staff:true,holdings:['nijo'],startCastle:'himeji'});}
async function readyBranch(h,p){
 const request={requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId,sequence:Number(branchLedger(h,p)?.sequence||0),parentCastleId:'nijo',direction:'north'};
 await h.api('/branches/build',post(p,request));
 const job=JSON.parse(branchLedger(h,p).state_json).jobs.find(row=>row.id==='nijo_north');assert(job);
 h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1 WHERE id='world-v1'").run(job.completesElapsedMs,h.now);
 const snapshot=await sync(h,p),game=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isStaff:true,staffBase:snapshot.staffBase});
 const advanced=game.applyWorldClock(snapshot.clock);assert(advanced.ok&&!advanced.pending);
 await put(h,p,JSON.parse(game.exportSave()));assert.equal(save(h,p).state.branches.find(row=>row.id==='nijo_north').level,1);
}
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);let maxBindings=0;h.db.batch=statements=>{for(const statement of statements){maxBindings=Math.max(maxBindings,statement.params.length);assert(statement.params.length<=100,'D1 binding limit exceeded');}return batch(statements);};try{await run(h);reports.push({name,calls:h.calls,maxBindings});console.log('PASS '+name);}finally{h.close();}}

const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Staff transfer tests must not contact a real service');};
try{
 await scope('emptying the personal home stays exact through refresh, dismissal, reappointment and historical replay',async h=>{
  const p=await staffFixture(h,'個人兵を移す家臣'),home=personal(h,p).home,before=save(h,p),oldPersonal=clone(personal(h,p).castles[home]),quantity=before.state.castles[home].troops;
  assert(quantity>0);const request=body(h,p,'castle:'+home,'castle:nijo',quantity),result=await transfer(h,p,request);
  assert.equal(result.idempotent,false);assert.equal(result.save.state.castles[home].troops,0);assert.equal(result.save.state.castles.nijo.troops,before.state.castles.nijo.troops+quantity);
  assert.equal(total(result.save,home),total(before,home));assert.equal(result.save.state.command,before.state.command-1);
  assert.deepEqual(result.save.state.resources,before.state.resources);
  assert.equal(personal(h,p).castles[home].troops,0,'active appointment backup records the debit, including zero');
  assert.equal(result.staffBase.personalHomeCastle.troops,0,'subsequent shared-base DTO must not restore the old troop floor');
  assert.equal(personal(h,p).castles[home].level,oldPersonal.level);assert.equal(personal(h,p).castles[home].wall,oldPersonal.wall);
  const client=GameEngine.fromSave(result.save,GAME_OFFICERS,{isStaff:true,staffBase:result.staffBase});client.applyStaffBase(result.staffBase);
  assert.equal(client.state.castles[home].troops,0);assert.equal(client.getStaffPersonalProgress().castle.troops,0);
  assert.equal(JSON.parse(client.exportSave()).state.staffService.personalHomeCastle.troops,0);
  const committed=stable(h,p),replayed=await transfer(h,p,request);assert(replayed.idempotent);assert.deepEqual(replayed.result,result.result);assert.deepEqual(stable(h,p),committed);
  const fresh=await sync(h,p);await put(h,p,fresh.save);assert.equal(personal(h,p).castles[home].troops,0);assert.equal(total(save(h,p),home),total(before,home));
  await role(h,p,'dismiss');const dismissed=await sync(h,p);assert.equal(dismissed.user.isStaff,false);assert.equal(dismissed.save.state.home,home);assert.equal(dismissed.save.state.castles[home].troops,0);assert.equal(total(dismissed.save,home),total(before,home));
  const afterDismissal=stable(h,p),historic=await transfer(h,p,request);assert(historic.idempotent);assert.deepEqual(historic.result,result.result);assert.deepEqual(stable(h,p),afterDismissal);
  await role(h,p,'appoint');const reappointed=await sync(h,p);assert.equal(reappointed.staffBase.personalHome,home);assert.equal(reappointed.staffBase.personalHomeCastle.troops,0);assert.equal(total(reappointed.save,home),total(before,home));
 });
 await scope('personal-home transfers to and from a real branch conserve only stationed troops and update the backup in both directions',async h=>{
  const p=await staffFixture(h,'支拠点を往復する家臣');await readyBranch(h,p);
  const home=personal(h,p).home,before=save(h,p),quantity=Math.min(700,before.state.castles[home].troops);assert(quantity>0);
  const outgoing=await transfer(h,p,body(h,p,'castle:'+home,'branch:nijo_north',quantity));
  assert.equal(outgoing.save.state.branches[0].stationedTroops,quantity);assert.equal(outgoing.save.state.castles[home].troops,before.state.castles[home].troops-quantity);assert.equal(personal(h,p).castles[home].troops,before.state.castles[home].troops-quantity);assert.equal(total(outgoing.save,home),total(before,home));
  const incoming=await transfer(h,p,body(h,p,'branch:nijo_north','castle:'+home,quantity));
  assert.equal(incoming.save.state.branches[0].stationedTroops,0);assert.equal(incoming.save.state.castles[home].troops,before.state.castles[home].troops);assert.equal(personal(h,p).castles[home].troops,before.state.castles[home].troops);assert.equal(total(incoming.save,home),total(before,home));
  const settled=stable(h,p),rejected=await transfer(h,p,body(h,p,'branch:nijo_north','castle:'+home,1),409);
  assert.equal(rejected.error.code,'INSUFFICIENT_TROOPS');assert.deepEqual(stable(h,p),settled,'a branch baseline cannot be withdrawn or credited to the personal backup');
  await role(h,p,'dismiss');const dismissed=await sync(h,p);assert.equal(total(dismissed.save,home),total(before,home));assert.equal(dismissed.save.state.castles[home].troops,before.state.castles[home].troops);
 });
 await scope('a dismissal at transfer commit cannot debit, credit, update personal backup or create a receipt',async h=>{
  const p=await staffFixture(h,'任期競合の家臣'),home=personal(h,p).home,request=body(h,p,'castle:'+home,'castle:nijo',100),before=stable(h,p);let raced=false;
  h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.beforeBatch=null;raced=true;h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(p.user.id);};
  const failed=await transfer(h,p,request,409);assert(raced);assert.equal(failed.error.code,'BRANCH_STATE_CHANGED');assert.deepEqual(stable(h,p),before);
  const dismissed=await sync(h,p);assert.equal(dismissed.user.isStaff,false);assert.equal(dismissed.save.state.castles[home].troops,JSON.parse(before.save.save_json).state.castles[home].troops);assert.equal(deploymentReceipts(h,p).length,0);
 });
 await scope('shared Kyoto stock rejects personal transfers in both directions while personal-home troops remain movable through dismissal',async h=>{
  const p=await staffFixture(h,'共同兵を区別する家臣'),home=personal(h,p).home;updateSave(h,p,state=>{state.troops=2000;});const before=stable(h,p);
  const status=(await h.api('/branches?deviceId='+p.deviceId,{token:p.token})).data,palace=status.troopTransfer.endpoints.find(row=>row.id==='castle:kyoto_gosho');
  assert(palace);assert.equal(palace.canSource,false);assert.equal(palace.canDestination,false);assert.match(palace.reason,/共同拠点/);
  for(const [from,to] of [['army','castle:kyoto_gosho'],['castle:kyoto_gosho','army']]){
   const denied=await transfer(h,p,body(h,p,from,to,100),409);assert.equal(denied.error.code,'TROOP_ENDPOINT_UNAVAILABLE');assert.deepEqual(stable(h,p),before);
  }
  const initial=save(h,p),moved=await transfer(h,p,body(h,p,'castle:'+home,'army',100));assert.equal(moved.save.state.troops,initial.state.troops+100);assert.equal(moved.save.state.castles[home].troops,initial.state.castles[home].troops-100);assert.equal(personal(h,p).castles[home].troops,initial.state.castles[home].troops-100);
  await role(h,p,'dismiss');const dismissed=await sync(h,p);assert.equal(dismissed.save.state.troops,initial.state.troops+100);assert.equal(dismissed.save.state.castles[home].troops,initial.state.castles[home].troops-100);assert.equal(total(dismissed.save,home),total(initial,home));
 });
 console.log(JSON.stringify({ok:true,groups:reports.length,calls:reports.reduce((n,r)=>n+r.calls,0),reports,productionRequests:0},null,2));
}finally{globalThis.fetch=originalFetch;}
