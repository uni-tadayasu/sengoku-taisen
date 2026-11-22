import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';

const clone=value=>structuredClone(value);
const branch=()=>({id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false});
const ledger=(h,p)=>h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,save(h,p).state.walking.campaignId);
const model=(h,p)=>JSON.parse(ledger(h,p).state_json);
const clockAt=(h,at)=>h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(at,h.now);
const clock=(h,at)=>({id:'sengoku-world-v1',elapsedMs:at,running:true,speed:1});
const sync=(h,p,value,expected=200)=>h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected});
const snapshot=h=>Object.fromEntries(['player_saves','branch_states','branch_requests','covert_incidents','achievement_events'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all()]));
function seed(h,p,branches,jobs=[]){
 const at=save(h,p).state.worldClock.elapsedMs;
 updateSave(h,p,s=>{s.branches=clone(branches);s.jobs=[...s.jobs.filter(j=>j.kind!=='branch'),...jobs.map(job=>({...job,remainingSeconds:(job.completesElapsedMs-at)/1000,remaining:Math.ceil((job.completesElapsedMs-at)/60000)}))];});
 h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,resolved_elapsed_ms,updated_at) VALUES(?,?,1,?,?,?)').run(p.user.id,save(h,p).state.walking.campaignId,JSON.stringify({branches,jobs}),at,h.now);
}
function advance(value,at,options={}){
 const game=GameEngine.fromSave(value,GAME_OFFICERS,options),result=game.applyWorldClock({...clock(null,at),id:value.state.worldClock.id},{maxSeconds:86400});
 assert(result.ok&&!result.pending);return JSON.parse(game.exportSave());
}
async function cpuPlayer(h,name,{upgrade=false,station=false}={}){
 const p=await fixture(h,name,{holdings:['nijo']});
 if(station){const mission=async(action,extra)=>h.api('/covert/'+action,post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId,sequence:save(h,p).state.covert.sequence,...extra}));await mission('hire',{sourceCastleId:'nijo',count:300});const dispatch=(await mission('dispatch',{sourceCastleId:'nijo',target:{kind:'castle',castleId:'osaka'},count:200,mode:'station'})).data;h.now+=dispatch.march.durationMs;const arrived=(await h.api('/covert',{token:p.token})).data;assert.equal(arrived.covert.stations.length,1);await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));}
 clockAt(h,539000);
 updateSave(h,p,s=>{
  for(const c of Object.values(s.castles)){c.owner='在地衆';c.troops=100000;}
  s.castles.nijo={owner:s.clan,troops:100,wall:1,level:1};s.home='nijo';s.cycle.home='nijo';s.difficulty='hard';s.troops=300;s.treaties={};s.seed=17;
  s.turn=8;s.realtime.elapsed=59;s.worldClock.elapsedMs=539000;
 });
 h.sql.prepare('UPDATE player_saves SET cycle_home=? WHERE user_id=?').run('nijo',p.user.id);
 const jobs=upgrade?[{kind:'branch',id:'nijo_north',targetLevel:2,total:1,totalSeconds:60,completesElapsedMs:599000}]:[];
 seed(h,p,[branch()],jobs);return p;
}
async function forceWin(run){const old=crypto.getRandomValues;crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(0):old.call(crypto,value);};try{return await run();}finally{crypto.getRandomValues=old;}}
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Branch sync tests must not contact a real service');};
try{
 await scope('ordinary sync proves a CPU branch fall from the prior checkpoint and never resurrects it on refresh or an old import',async h=>{
  const p=await cpuPlayer(h,'CPU進行の城主',{upgrade:true,station:true});
  const original=save(h,p),predicted=advance(original,540000);assert.equal(predicted.state.branches[0].fallen,true);assert.equal(predicted.state.castles.nijo.owner,predicted.state.clan);assert.equal(predicted.state.jobs.filter(j=>j.kind==='branch').length,0);
  clockAt(h,540000);predicted.state.resources.gold+=137;predicted.state.prestige+=11;
  const result=(await sync(h,p,predicted)).data;assert.equal(result.save.state.branches[0].fallen,true);assert.equal(model(h,p).branches[0].fallen,true);assert.equal(model(h,p).jobs.length,0);assert.equal(result.branchResolvedElapsedMs,540000);
  assert.deepEqual(result.save.state.resources,predicted.state.resources);assert.equal(result.save.state.prestige,predicted.state.prestige);assert.deepEqual(result.save.state.stats,predicted.state.stats);assert.deepEqual(result.save.state.castles.nijo,predicted.state.castles.nijo);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM covert_incidents').get().n,1);
  const refreshed=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.equal(refreshed.save.state.branches[0].fallen,true);
  const imported=(await sync(h,p,original)).data;assert.equal(imported.save.state.branches[0].fallen,true);assert.equal(imported.branchResolvedElapsedMs,540000);assert.equal(imported.save.state.castles.nijo.owner,imported.save.state.clan);
  const onceMore=clone(imported.save);onceMore.state.turn=9;onceMore.state.realtime.elapsed=0;onceMore.state.worldClock.elapsedMs=540000;
  const stable=(await sync(h,p,onceMore)).data;assert.equal(stable.save.state.castles.nijo.owner,stable.save.state.clan);assert.equal(model(h,p).branches[0].fallen,true);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM covert_incidents').get().n,1);
 });
 await scope('a forged fall and future timestamp cannot trigger an early raid or skip its later real boundary',async h=>{
  const p=await cpuPlayer(h,'未来時刻の検証');const predicted=advance(save(h,p),540000);assert.equal(predicted.state.branches[0].fallen,true);
  // A normal save may predict up to five seconds ahead; branch authority is
  // still resolved only through the actual server clock.
  predicted.state.seed=0;const early=(await sync(h,p,predicted)).data;assert.equal(early.save.state.branches[0].fallen,false);assert.equal(early.branchResolvedElapsedMs,539000);
  clockAt(h,540000);const onTime=(await sync(h,p,early.save)).data;assert.equal(onTime.save.state.branches[0].fallen,true);assert.equal(onTime.branchResolvedElapsedMs,540000);assert.equal(onTime.save.state.castles.nijo.owner,onTime.save.state.clan);
 });
 await scope('an old ownership import is canonically corrected without erasing defenses or trapping repeat saves',async h=>{
  const p=await fixture(h,'領有を守る城主',{holdings:['nijo']});seed(h,p,[branch()]);const original=save(h,p),bad=clone(original);bad.state.castles.nijo.owner='在地衆';bad.state.branches=[];bad.state.jobs=[];const before=model(h,p);
  for(let attempt=0;attempt<2;attempt++){const corrected=(await sync(h,p,bad)).data;assert.equal(corrected.save.state.castles.nijo.owner,corrected.save.state.clan);assert.equal(corrected.save.state.branches[0].fallen,false);assert.deepEqual(model(h,p),before);}
  const allowed=clone(original);allowed.state.resources.gold+=101;allowed.state.prestige+=7;allowed.state.branches=[{...branch(),fallen:true}];const result=(await sync(h,p,allowed)).data;
  assert.equal(result.save.state.resources.gold,allowed.state.resources.gold);assert.equal(result.save.state.prestige,allowed.state.prestige);assert.equal(result.save.state.branches[0].fallen,false);assert.equal(model(h,p).branches.length,1);
 });
 await scope('correcting a false last-parent loss keeps paid branch jobs and reconciles home and campaign summary',async h=>{
  const p=await cpuPlayer(h,'本拠表示の補正',{upgrade:true}),incoming=save(h,p),before=model(h,p);incoming.state.castles.nijo.owner='在地衆';incoming.state.home='kiyosu';incoming.state.branches=[];incoming.state.jobs=[];incoming.state.gameOver=true;incoming.state.won=true;incoming.state.resources.gold+=73;
  const result=(await sync(h,p,incoming)).data;assert.equal(result.save.state.home,'nijo');assert.equal(result.save.state.cycle.home,'nijo');assert.equal(row(h,p).cycle_home,'nijo');assert.equal(result.save.state.castles.nijo.owner,result.save.state.clan);assert.equal(result.save.state.gameOver,false);assert.equal(result.save.state.won,false);assert.equal(result.save.state.realtime.running,true);assert.equal(result.save.state.resources.gold,incoming.state.resources.gold);assert.deepEqual(model(h,p),before);assert.equal(result.save.state.jobs[0].id,'nijo_north');
  const retried=(await sync(h,p,incoming)).data;assert.equal(retried.save.state.home,'nijo');assert.deepEqual(model(h,p),before);
 });
 await scope('a divergent client-held parent retains exact proved fallen levels and cannot revive a canceled upgrade',async h=>{
  const p=await cpuPlayer(h,'異なるCPU予測の城主',{upgrade:true}),state=model(h,p);state.jobs[0].completesElapsedMs=540000;
  h.sql.prepare('UPDATE branch_states SET state_json=? WHERE actor_id=?').run(JSON.stringify(state),p.user.id);updateSave(h,p,s=>{s.jobs[0].completesElapsedMs=540000;s.jobs[0].remainingSeconds=1;s.jobs[0].remaining=1;});
  const original=save(h,p),proof=advance(original,720000);assert.notEqual(proof.state.castles.nijo.owner,proof.state.clan);assert.equal(proof.state.branches.length,0);
  const incoming=clone(proof);incoming.state.castles.nijo.owner=incoming.state.clan;incoming.state.resources.gold+=91;incoming.state.prestige+=3;clockAt(h,720000);
  for(let attempt=0;attempt<2;attempt++){const result=(await sync(h,p,incoming)).data;assert.equal(result.save.state.castles.nijo.owner,result.save.state.clan);assert.equal(result.save.state.gameOver,false);assert.equal(result.save.state.branches[0].level,2);assert.equal(result.save.state.branches[0].fallen,true);assert.equal(model(h,p).jobs.length,0);assert.equal(result.save.state.resources.gold,incoming.state.resources.gold);assert.equal(result.save.state.prestige,incoming.state.prestige);}
  const old=(await sync(h,p,original)).data;assert.equal(old.save.state.branches[0].level,2);assert.equal(old.save.state.branches[0].fallen,true);assert.equal(model(h,p).jobs.length,0);
 });
 await scope('a client-held parent retains the exact paid repair after a divergent CPU capture and repairs only at its deadline',async h=>{
  const p=await cpuPlayer(h,'修復中の異なる予測'),state=model(h,p);state.branches[0].fallen=true;state.jobs=[{kind:'branch',id:'nijo_north',repair:true,targetLevel:1,total:1,totalSeconds:60,completesElapsedMs:599000}];
  h.sql.prepare('UPDATE branch_states SET state_json=? WHERE actor_id=?').run(JSON.stringify(state),p.user.id);updateSave(h,p,s=>{s.branches[0].fallen=true;s.jobs=[{...state.jobs[0],remainingSeconds:60,remaining:1}];});
  const incoming=advance(save(h,p),570000);assert.notEqual(incoming.state.castles.nijo.owner,incoming.state.clan);incoming.state.castles.nijo.owner=incoming.state.clan;clockAt(h,570000);
  const result=(await sync(h,p,incoming)).data;assert.equal(result.save.state.branches[0].fallen,true);assert.equal(model(h,p).jobs[0].repair,true);assert.equal(model(h,p).jobs[0].completesElapsedMs,599000);
  clockAt(h,599000);const completed=advance(result.save,599000,{branchAuthority:{resolvedElapsedMs:result.branchResolvedElapsedMs}}),repaired=(await sync(h,p,completed)).data;assert.equal(repaired.save.state.branches[0].fallen,false);assert.equal(repaired.save.state.branches[0].level,1);assert.equal(model(h,p).jobs.length,0);
 });
 await scope('canonical correction cannot restore revoked Edo ownership or authorize Kyoto ownership',async h=>{
  const former=await fixture(h,'失効した江戸の権限',{admin:true}),replacement=await fixture(h,'新しい江戸の権限');seed(h,former,[{id:'edo_north',parentCastleId:'edo',direction:'north',level:8,fallen:false}]);
  h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(replacement.user.id);
  const current=(await h.api('/sync?deviceId='+former.deviceId,{token:former.token})).data;assert.notEqual(current.save.state.castles.edo.owner,current.save.state.clan);assert.equal(current.save.state.branches.length,0);
  const saved=(await sync(h,former,current.save)).data;assert.notEqual(saved.save.state.castles.edo.owner,saved.save.state.clan);assert.equal(model(h,former).branches.length,0);
  for(const parent of ['edo','kyoto_gosho']){const forged=clone(saved.save);forged.state.castles[parent].owner=forged.state.clan;forged.state.branches=[{id:parent+'_north',parentCastleId:parent,direction:'north',level:1,fallen:false}];const before=snapshot(h);await sync(h,former,forged,403);assert.deepEqual(snapshot(h),before);}
 });
 await scope('a server-proved later CPU capture removes the parent defenses instead of blocking legitimate loss',async h=>{
  const p=await cpuPlayer(h,'陥落後の本城'),state=model(h,p);state.branches[0].fallen=true;
  h.sql.prepare('UPDATE branch_states SET state_json=?,sequence=sequence+1 WHERE actor_id=?').run(JSON.stringify(state),p.user.id);updateSave(h,p,s=>{s.branches[0].fallen=true;});
  const predicted=advance(save(h,p),540000);assert.notEqual(predicted.state.castles.nijo.owner,predicted.state.clan);assert.equal(predicted.state.branches.length,0);clockAt(h,540000);
  const result=(await sync(h,p,predicted)).data;assert.equal(result.save.state.branches.length,0);assert.equal(model(h,p).branches.length,0);assert.equal(model(h,p).jobs.length,0);assert.equal(result.save.state.gameOver,true);
 });
 await scope('a later PvP fall cannot be replayed backward into a historical CPU capture of the parent',async h=>{
  const defender=await cpuPlayer(h,'古い保存位置の守備側'),attacker=await fixture(h,'新しい支拠点攻撃側');clockAt(h,541000);updateSave(h,attacker,s=>{s.turn=9;s.realtime.elapsed=1;s.worldClock.elapsedMs=541000;});
  const departure=(await forceWin(()=>h.api('/field/attack',post(attacker,{requestId:crypto.randomUUID(),deviceId:attacker.deviceId,expectedRevision:row(h,attacker).revision,targetPlayerId:defender.user.id,targetCastleId:'nijo',targetBranchId:'nijo_north',troops:1000,tactic:'balanced'})))).data;
  assert(departure.marching);const arrivedAt=departure.march.arrivesAtMs;clockAt(h,arrivedAt);const arrivals=(await h.api('/marches',{token:attacker.token})).data,fight={battle:arrivals.history[0].battle};
  assert.equal(fight.battle.branchFallen,true);assert.equal(save(h,defender).state.worldClock.elapsedMs,539000);assert.equal(ledger(h,defender).resolved_elapsed_ms,arrivedAt);
  const obsolete=advance(save(h,defender),arrivedAt);assert.notEqual(obsolete.state.castles.nijo.owner,obsolete.state.clan);
  assert.equal(save(h,defender).state.castles.nijo.owner,save(h,defender).state.clan);
  const verified=(await h.api('/sync?deviceId='+defender.deviceId,{token:defender.token})).data,corrected=advance(verified.save,arrivedAt,{branchAuthority:{resolvedElapsedMs:verified.branchResolvedElapsedMs}});assert.equal(corrected.state.castles.nijo.owner,corrected.state.clan);
  // Flush elapsed travel time before repairing; the authoritative watermark
  // must still prevent the old CPU raid from consuming the parent again.
  await sync(h,defender,corrected);
  const repair=(await h.api('/branches/repair',post(defender,{requestId:crypto.randomUUID(),deviceId:defender.deviceId,expectedRevision:row(h,defender).revision,campaignId:verified.save.state.walking.campaignId,sequence:ledger(h,defender).sequence,branchId:'nijo_north'}))).data;
  assert.equal(repair.save.state.castles.nijo.owner,repair.save.state.clan);assert.equal(repair.save.state.branches[0].fallen,true);assert.equal(model(h,defender).jobs[0].repair,true);
  const result=(await sync(h,defender,repair.save)).data;assert.equal(result.save.state.castles.nijo.owner,result.save.state.clan);assert.equal(result.save.state.branches[0].fallen,true);assert.equal(result.branchResolvedElapsedMs,arrivedAt);
 });
 await scope('watermark-only sync does not stale a pinned construction sequence',async h=>{
  const p=await fixture(h,'時間だけ進む支拠点',{holdings:['nijo']});seed(h,p,[branch()]);const initial=ledger(h,p),value=save(h,p);clockAt(h,1000);value.state.realtime.elapsed=1;value.state.worldClock.elapsedMs=1000;
  const result=(await sync(h,p,value)).data;assert.equal(ledger(h,p).sequence,initial.sequence);assert.equal(ledger(h,p).resolved_elapsed_ms,1000);
  const command=(await h.api('/branches/build',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:result.revision,campaignId:value.state.walking.campaignId,sequence:initial.sequence,parentCastleId:'nijo',direction:'east'}))).data;
  assert.equal(command.result.branchId,'nijo_east');assert.equal(model(h,p).branches.length,2);assert.equal(ledger(h,p).sequence,initial.sequence+1);
 });
 await scope('one parent transition advances the campaign cursor without retroactive CPU damage to a second branched parent',async h=>{
  const defender=await cpuPlayer(h,'二都市の支拠点'),attacker=await fixture(h,'二都市の攻撃側'),second={id:'osaka_east',parentCastleId:'osaka',direction:'east',level:2,fallen:false};
  updateSave(h,defender,s=>{s.castles.osaka={owner:s.clan,troops:100,wall:1,level:1};s.branches.push(second);});const state=model(h,defender);state.branches.push(second);h.sql.prepare('UPDATE branch_states SET state_json=?,sequence=sequence+1 WHERE actor_id=?').run(JSON.stringify(state),defender.user.id);
  clockAt(h,541000);updateSave(h,attacker,s=>{s.turn=9;s.realtime.elapsed=1;s.worldClock.elapsedMs=541000;});
  const departure=(await forceWin(()=>h.api('/field/attack',post(attacker,{requestId:crypto.randomUUID(),deviceId:attacker.deviceId,expectedRevision:row(h,attacker).revision,targetPlayerId:defender.user.id,targetCastleId:'nijo',targetBranchId:'nijo_north',troops:1000,tactic:'balanced'})))).data;const arrivedAt=departure.march.arrivesAtMs;clockAt(h,arrivedAt);await h.api('/marches',{token:attacker.token});
  const snapshot=(await h.api('/sync?deviceId='+defender.deviceId,{token:defender.token})).data;assert.equal(snapshot.branchResolvedElapsedMs,arrivedAt);assert.equal(snapshot.save.state.worldClock.elapsedMs,539000);
  const correct=advance(snapshot.save,arrivedAt,{branchAuthority:{resolvedElapsedMs:snapshot.branchResolvedElapsedMs}});assert.equal(correct.state.branches.find(b=>b.id==='osaka_east').fallen,false);
  const result=(await sync(h,defender,correct)).data;assert.equal(result.save.state.branches.find(b=>b.id==='nijo_north').fallen,true);assert.equal(result.save.state.branches.find(b=>b.id==='osaka_east').fallen,false);assert.equal(result.save.state.castles.nijo.owner,result.save.state.clan);assert.equal(result.save.state.castles.osaka.owner,result.save.state.clan);
 });
 await scope('normal-sync replay pins semantic state, its private cursor, roles and clock until commit',async h=>{
  const appointing=await h.session('同期競合の任命者');
  for(const race of ['branch','watermark','clock','role']){
   const p=await cpuPlayer(h,'同期競合 '+race),value=advance(save(h,p),540000);clockAt(h,540000);const savedBefore=row(h,p),ledgerBefore=ledger(h,p),incidents=h.sql.prepare('SELECT * FROM covert_incidents').all();
   h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('cycle_commit=?')&&s.sql.includes('branch_states')))return;h.beforeBatch=null;
    if(race==='branch')h.sql.prepare('UPDATE branch_states SET sequence=sequence+1 WHERE actor_id=?').run(p.user.id);
    if(race==='watermark')h.sql.prepare('UPDATE branch_states SET resolved_elapsed_ms=resolved_elapsed_ms+1 WHERE actor_id=?').run(p.user.id);
    if(race==='clock')h.sql.prepare('UPDATE world_clock SET revision=revision+1').run();
    if(race==='role')h.sql.prepare("INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,0)").run(p.user.id,appointing.user.id,h.now,'race-term-'+crypto.randomUUID());
   };
   await sync(h,p,value,409);assert.deepEqual(row(h,p),savedBefore);assert.deepEqual(h.sql.prepare('SELECT * FROM covert_incidents').all(),incidents);assert.equal(model(h,p).branches[0].fallen,false);assert.equal(ledger(h,p).state_json,ledgerBefore.state_json);
  }
 });
 await scope('failed replay transaction rolls back branch damage, cursor, save and immutable incidents together',async h=>{
  const p=await cpuPlayer(h,'同期の原子性'),value=advance(save(h,p),540000);clockAt(h,540000);const before=snapshot(h);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('cycle_commit=?')&&s.sql.includes('branch_states')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_branch_sync_table SET value=1'));};
  await sync(h,p,value,500);assert.deepEqual(snapshot(h),before);const retried=(await sync(h,p,value)).data;assert.equal(retried.save.state.branches[0].fallen,true);assert.equal(ledger(h,p).resolved_elapsed_ms,540000);
 });
}finally{globalThis.fetch=network;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
