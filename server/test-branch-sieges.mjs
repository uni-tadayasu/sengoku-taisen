import assert from 'node:assert/strict';
import {harness,settleFieldMarch,syncFieldWriter} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {fixture,post,row,save,count,appoint,updateSave} from './test-court-support.mjs';

const read=(h,p)=>h.api('/branches?deviceId='+p.deviceId,{token:p.token});
const branchRow=(h,p)=>h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,save(h,p).state.walking.campaignId);
const branchState=(h,p)=>JSON.parse(branchRow(h,p)?.state_json||'{"branches":[],"jobs":[]}');
const branchBody=(h,p,extra)=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId,sequence:branchRow(h,p)?.sequence||0,...extra});
const branchCommand=(h,p,action,extra,expected=200)=>h.api('/branches/'+action,post(p,branchBody(h,p,extra),expected));
const attackBody=(h,p,target,parent='nijo',branchId)=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,targetPlayerId:target.user.id,targetCastleId:parent,...(branchId?{targetBranchId:branchId}:{}),troops:1000,tactic:'balanced'});
async function attack(h,p,target,parent='nijo',branchId,expected=200){
 const response=await h.api('/field/attack',post(p,attackBody(h,p,target,parent,branchId),expected));
 if(expected===200){
  const departure=response.data;h.now+=departure.march.remainingMs;
  const beforeA=await advanceControl(h,p),beforeD=await advanceControl(h,target),arrived=await marches(h,p),receipt=arrived.history.find(entry=>entry.id===departure.march.id);
  assert.equal(receipt?.status,'resolved');response.data={...departure,battle:receipt.battle,beforeA,beforeD};
 }
 return response;
}
const marches=async(h,p)=>(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;
async function advanceControl(h,p){
 const view=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
 const game=GameEngine.fromSave(view.save,GAME_OFFICERS,{isAdmin:view.user.isAdmin,isStaff:view.user.isStaff,isDeputy:view.user.isDeputy,staffBase:view.staffBase,maintenanceAuthority:view.maintenanceAuthority,branchAuthority:{resolvedElapsedMs:view.branchResolvedElapsedMs}});
 const advanced=game.applyWorldClock(view.clock,{maxSeconds:86400,deferCycleSettlement:true});assert(advanced.ok&&!advanced.pending&&!advanced.settlementRequired);return JSON.parse(game.exportSave());
}
function assertResourceTransfer(h,p,target,result){
 const {beforeA,beforeD,battle}=result;
 for(const key of ['gold','rice','wood','stone']){const expected=battle.won?Math.min(Math.floor(beforeD.state.resources[key]/2),100000000-beforeA.state.resources[key]):0;assert.equal(battle.loot[key],expected);assert.equal(save(h,p).state.resources[key],beforeA.state.resources[key]+expected);assert.equal(save(h,target).state.resources[key],beforeD.state.resources[key]-expected);}
}
const clockAt=(h,at)=>h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(at,h.now);
function align(h,p,at){updateSave(h,p,s=>{s.turn=Math.floor(at/60000);s.realtime.elapsed=at%60000/1000;s.worldClock.elapsedMs=at;s.command=3+Math.floor(s.buildings.keep/8);});}
async function force(won,run){const old=crypto.getRandomValues;crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(won?0:0xffffffff):old.call(crypto,value);};try{return await run();}finally{crypto.getRandomValues=old;}}
const core=p=>({castles:p.state.castles,troops:p.state.troops,morale:p.state.morale,buildings:p.state.buildings,army:p.state.army,governors:p.state.governors,tech:p.state.tech});
const effects=h=>Object.fromEntries(['player_saves','branch_states','branch_requests','field_requests','field_battles','covert_requests','covert_battles','mail_campaigns'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all()]));
function seedBranches(h,p,branches,jobs=[]){
 const at=save(h,p).state.worldClock.elapsedMs;updateSave(h,p,s=>{s.branches=structuredClone(branches);s.jobs=[...s.jobs.filter(j=>j.kind!=='branch'),...jobs.map(job=>({...job,remainingSeconds:(job.completesElapsedMs-at)/1000,remaining:Math.ceil((job.completesElapsedMs-at)/60000)}))];});
 h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(actor_id,campaign_id) DO UPDATE SET sequence=branch_states.sequence+1,state_json=excluded.state_json').run(p.user.id,save(h,p).state.walking.campaignId,JSON.stringify({branches,jobs}),h.now);
}
const completed=(parent,direction,level=3,fallen=false)=>({id:parent+'_'+direction,parentCastleId:parent,direction,level,fallen});
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Siege tests must not contact a real service');};
try{
 await scope('real branch construction projects at its server deadline and every intact branch must fall before capture',async h=>{
  const defender=await fixture(h,'二条の防衛者',{holdings:['nijo']}),attacker=await fixture(h,'二条を攻める領主',{startCastle:'sakamoto'});
  await branchCommand(h,defender,'build',{parentCastleId:'nijo',direction:'north'});await branchCommand(h,defender,'build',{parentCastleId:'nijo',direction:'east'});
  let target=(await h.api('/field',{token:attacker.token})).data.targets.find(t=>t.playerId===defender.user.id&&t.targetCastleId==='nijo');assert.equal(target.branches.length,2);assert(target.branches.every(b=>b.level===0&&b.building&&!b.attackable));assert.equal(target.attackable,true);
  const deadline=Math.max(...branchState(h,defender).jobs.map(j=>j.completesElapsedMs));clockAt(h,deadline);align(h,attacker,deadline);
  target=(await h.api('/field',{token:attacker.token})).data.targets.find(t=>t.playerId===defender.user.id&&t.targetCastleId==='nijo');assert.equal(target.attackable,false);assert(target.branches.every(b=>b.level===1&&!b.building&&b.attackable&&b.defensePower>0&&b.defenseTroops>0));assert.match(target.attackReason,/支拠点/);assert.equal((await h.api('/field')).data.rules.branchBattles,true);
  const before=effects(h),blocked=await attack(h,attacker,defender,'nijo',undefined,409);assert.equal(blocked.data.error.code,'BRANCHES_REQUIRED');assert.deepEqual(effects(h),before);
  const actorBefore=save(h,attacker),first=(await force(true,()=>attack(h,attacker,defender,'nijo','nijo_north'))).data;
  assert.equal(first.battle.battleMode,'branch');assert.equal(first.battle.branchId,'nijo_north');assert.equal(first.battle.branchFallen,true);assert.equal(first.battle.capture.captured,false);assert.equal(first.battle.lootPolicy,'half-resources-v1');assertResourceTransfer(h,attacker,defender,first);assert(Object.values(first.battle.rewards).every(n=>n===0));assert.deepEqual(first.battle.defenderLost,{troops:0,garrison:0});assert.deepEqual(core(save(h,defender)),core(first.beforeD));
  assert.deepEqual(save(h,attacker).state.stats,actorBefore.state.stats);assert.deepEqual(save(h,attacker).state.claimedQuests,actorBefore.state.claimedQuests);assert.equal(GameEngine.fromSave(save(h,attacker),GAME_OFFICERS).questStatus('first_battle').complete,false);
  const one=branchState(h,defender).branches;assert.equal(one.find(b=>b.id==='nijo_north').fallen,true);assert.equal(one.find(b=>b.id==='nijo_east').fallen,false);assert.equal((await attack(h,attacker,defender,'nijo',undefined,409)).data.error.code,'BRANCHES_REQUIRED');
  const nextEast=(await h.api('/world-clock')).data.clock.elapsedMs+60000;clockAt(h,nextEast);align(h,attacker,nextEast);await h.api('/sync/lease',post(attacker,{deviceId:attacker.deviceId}));await force(true,()=>attack(h,attacker,defender,'nijo','nijo_east'));
  const nextMain=(await h.api('/world-clock')).data.clock.elapsedMs+60000;clockAt(h,nextMain);align(h,attacker,nextMain);await h.api('/sync/lease',post(attacker,{deviceId:attacker.deviceId}));const captured=(await force(true,()=>attack(h,attacker,defender,'nijo'))).data;
  assert.equal(captured.battle.capture.captured,true);assert.equal(branchState(h,defender).branches.length,0);assert.equal(branchState(h,defender).jobs.length,0);assert.equal(save(h,defender).state.branches.length,0);assert.equal(save(h,attacker).state.branches.length,0);assert.equal(count(h,'field_battles'),3);assert.equal(count(h,'mail_campaigns'),6);
  assert(!h.sql.prepare('SELECT body FROM mail_campaigns').all().some(row=>row.body.includes('undefined')));
 });
 await scope('imports cannot remove an intact defense, forge fallen state, or resurrect a defeated branch',async h=>{
  const defender=await fixture(h,'改竄対策の城主',{holdings:['nijo']}),attacker=await fixture(h,'改竄対策の攻め手',{startCastle:'sakamoto'});seedBranches(h,defender,[completed('nijo','north')]);
  const original=save(h,defender);for(const forged of [[],[{...completed('nijo','north'),fallen:true}],{untrusted:true}]){const imported=structuredClone(original);imported.state.branches=forged;imported.state.jobs=[];const saved=(await h.api('/sync',{method:'PUT',token:defender.token,body:{deviceId:defender.deviceId,revision:row(h,defender).revision,save:imported}})).data;assert.equal(saved.save.state.branches[0].fallen,false);}
  await force(true,()=>attack(h,attacker,defender,'nijo','nijo_north'));assert.equal(branchState(h,defender).branches[0].fallen,true);
  const current=save(h,defender);current.state.branches=original.state.branches;const restored=(await h.api('/sync',{method:'PUT',token:defender.token,body:{deviceId:defender.deviceId,revision:row(h,defender).revision,save:current}})).data;assert.equal(restored.save.state.branches[0].fallen,true);assert.equal(branchState(h,defender).branches[0].fallen,true);
 });
 await scope('defeat cancels an upgrade, repair keeps its completed level and does not block the parent until completion',async h=>{
  const defender=await fixture(h,'修復する城主',{holdings:['nijo']}),attacker=await fixture(h,'修復を監視する領主',{startCastle:'sakamoto'}),branch=completed('nijo','north',5),cost=GameEngine.branchUpgradeCost('nijo',5);
  seedBranches(h,defender,[branch],[{kind:'branch',id:branch.id,targetLevel:6,total:cost.turns,totalSeconds:cost.seconds,completesElapsedMs:cost.seconds*1000}]);
  await force(true,()=>attack(h,attacker,defender,'nijo',branch.id));assert.equal(branchState(h,defender).branches[0].level,5);assert.equal(branchState(h,defender).branches[0].fallen,true);assert.equal(branchState(h,defender).jobs.length,0);
  await syncFieldWriter(h,defender);await branchCommand(h,defender,'upgrade',{branchId:branch.id},409);const beforeResources=save(h,defender).state.resources,repair=(await branchCommand(h,defender,'repair',{branchId:branch.id})).data,job=branchState(h,defender).jobs[0];assert.equal(job.repair,true);assert.equal(job.targetLevel,5);assert.equal(branchState(h,defender).branches[0].fallen,true);assert(repair.save.state.resources.gold<beforeResources.gold);
  clockAt(h,job.completesElapsedMs-1);align(h,attacker,job.completesElapsedMs-1);let target=(await h.api('/field',{token:attacker.token})).data.targets.find(t=>t.playerId===defender.user.id&&t.targetCastleId==='nijo');assert.equal(target.branches[0].fallen,true);assert.equal(target.branches[0].repairing,true);assert(!target.attackReason.includes('支拠点をすべて'));
  clockAt(h,job.completesElapsedMs);align(h,attacker,job.completesElapsedMs);target=(await h.api('/field',{token:attacker.token})).data.targets.find(t=>t.playerId===defender.user.id&&t.targetCastleId==='nijo');assert.equal(target.branches[0].fallen,false);assert.equal(target.branches[0].level,5);assert.equal(target.attackable,false);assert.equal((await attack(h,attacker,defender,'nijo',undefined,409)).data.error.code,'BRANCHES_REQUIRED');
 });
 await scope('Edo branches retain protected main assets and Kyoto-origin assaults still require current Emperor authority',async h=>{
  const admin=await fixture(h,'支城を持つ江戸',{admin:true}),staff=await fixture(h,'支城を攻める御所担当',{staff:true}),ordinary=await fixture(h,'他地域の攻め手');seedBranches(h,admin,[completed('edo','west',8)]);
  const denied=(await h.api('/field',{token:staff.token})).data.targets.find(t=>t.playerId===admin.user.id&&t.targetCastleId==='edo');assert.equal(denied.branches[0].attackable,false);assert.match(denied.branches[0].attackReason,/天皇/);const before=effects(h);assert.equal((await attack(h,staff,admin,'edo','edo_west',403)).data.error.code,'COURT_EDO_ATTACK_REQUIRED');assert.deepEqual(effects(h),before);
  await appoint(h,staff);const result=(await force(true,()=>attack(h,staff,admin,'edo','edo_west'))).data;assert.equal(result.battle.battleMode,'branch');assert.equal(result.battle.defenderRevision,row(h,admin).revision);assert.deepEqual(core(save(h,admin)),core(result.beforeD));assertResourceTransfer(h,staff,admin,result);assert.equal(branchState(h,admin).branches[0].fallen,true);assert.equal(result.battle.rewards.gold,0);assert.equal(result.battle.capture.captured,false);
  const nextMain=(await h.api('/world-clock')).data.clock.elapsedMs+60000;clockAt(h,nextMain);align(h,ordinary,nextMain);await h.api('/sync/lease',post(ordinary,{deviceId:ordinary.deviceId}));const mainBattle=(await force(true,()=>attack(h,ordinary,admin,'edo'))).data;assert.equal(mainBattle.battle.battleMode,'reward');assert.deepEqual(core(save(h,admin)),core(mainBattle.beforeD));assertResourceTransfer(h,ordinary,admin,mainBattle);
 });
 await scope('a branch change, repair race or lost Emperor appointment aborts the complete field transaction',async h=>{
  const admin=await fixture(h,'競合する江戸',{admin:true}),staff=await fixture(h,'競合する攻め手',{staff:true});seedBranches(h,admin,[completed('edo','north')]);await appoint(h,staff);
  for(const mutate of [()=>h.sql.prepare('UPDATE branch_states SET sequence=sequence+1 WHERE actor_id=?').run(admin.user.id),()=>h.sql.prepare('UPDATE court_leader SET appointment_token=?').run(crypto.randomUUID())]){
   const before=effects(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO battle_marches')))return;h.beforeBatch=null;mutate();};await force(true,()=>attack(h,staff,admin,'edo','edo_north',409));const after=effects(h);before.branch_states=after.branch_states;assert.deepEqual(after,before);assert.equal(count(h,'field_battles'),0);
  }
  // A main attack computed against a fallen branch cannot commit after a new
  // completed defense appears in the authoritative branch generation.
  seedBranches(h,admin,[completed('edo','north',3,true)]);const before=effects(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO battle_marches')))return;h.beforeBatch=null;const state=branchState(h,admin);state.branches[0].fallen=false;h.sql.prepare('UPDATE branch_states SET state_json=?,sequence=sequence+1 WHERE actor_id=?').run(JSON.stringify(state),admin.user.id);};await attack(h,staff,admin,'edo',undefined,409);const after=effects(h);before.branch_states=after.branch_states;assert.deepEqual(after,before);
 });
 await scope('a defense restored at parent siege arrival protects the city and returns the reserved army',async h=>{
  const defender=await fixture(h,'復興する支城の領主',{holdings:['nijo']}),attacker=await fixture(h,'修復中の城への攻め手',{startCastle:'sakamoto'});
  seedBranches(h,defender,[completed('nijo','north',2,true)]);
  const original=save(h,attacker),departure=(await force(true,()=>h.api('/field/attack',post(attacker,attackBody(h,attacker,defender))))).data;
  assert(departure.marching);h.now+=departure.march.remainingMs;
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO field_requests')))return;h.beforeBatch=null;seedBranches(h,defender,[completed('nijo','north',2,false)]);};
  await marches(h,attacker);const returned=await marches(h,attacker);
  assert.equal(returned.history[0].id,departure.march.id);assert.equal(returned.history[0].status,'cancelled');
  assert.equal(returned.save.state.troops,original.state.troops);assert.equal(save(h,defender).state.castles.nijo.owner,save(h,defender).state.clan);
  assert.equal(branchState(h,defender).branches[0].fallen,false);assert.equal(count(h,'field_requests'),0);assert.equal(count(h,'field_battles'),0);assert.equal(count(h,'mail_campaigns'),0);
 });
 await scope('branch defeat transaction rolls back all condition, casualties, mail and receipts on failure',async h=>{
  const defender=await fixture(h,'原子性の城主',{holdings:['nijo']}),attacker=await fixture(h,'原子性の攻め手',{startCastle:'sakamoto'});seedBranches(h,defender,[completed('nijo','south')]);
  const body=attackBody(h,attacker,defender,'nijo','nijo_south'),departure=(await force(true,()=>h.api('/field/attack',post(attacker,body)))).data,before=effects(h);
  h.now+=departure.march.remainingMs;h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO field_requests')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_branch_siege SET value=1'));};
  const pending=await marches(h,attacker);assert.equal(pending.active[0].id,departure.march.id);assert.deepEqual(effects(h),before);
  const result=await marches(h,attacker),committed=effects(h),replayed=(await h.api('/field/attack',post(attacker,body))).data;
  assert.equal(replayed.idempotent,true);assert.equal(replayed.battle.id,result.history[0].battle.id);assert.deepEqual(effects(h),committed);
  await h.api('/field/attack',post(attacker,{...body,targetBranchId:'nijo_north'},409));await attack(h,attacker,defender,'edo','nijo_south',400);await attack(h,attacker,defender,'kyoto_gosho','kyoto_gosho_north',400);
 });
 await scope('concurrent branch assaults settle one result and cannot double-charge or double-fall a defense',async h=>{
  const defender=await fixture(h,'同時攻撃の城主',{holdings:['nijo']}),one=await fixture(h,'同時攻撃一',{startCastle:'sakamoto'}),two=await fixture(h,'同時攻撃二',{startCastle:'inuyama'});seedBranches(h,defender,[completed('nijo','north')]);let arrived=0,release;const barrier=new Promise(r=>release=r);
  h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO field_requests')))return;if(++arrived===2){h.beforeBatch=null;release();}await barrier;};
  const departures=await force(true,()=>Promise.all([one,two].map(p=>h.api('/field/attack',post(p,attackBody(h,p,defender,'nijo','nijo_north'))))));
  assert(departures.every(r=>r.data.marching));h.now+=Math.max(...departures.map(r=>r.data.march.remainingMs));await Promise.all([marches(h,one),marches(h,two)]);assert.equal(arrived,2);
  const results=await Promise.all([marches(h,one),marches(h,two)]);assert.deepEqual(results.map(r=>r.history[0].status).sort(),['cancelled','resolved']);assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'field_requests'),1);assert.equal(count(h,'mail_campaigns'),2);assert.equal(branchState(h,defender).branches[0].fallen,true);
 });
 await scope('covert parent retaliation cannot bypass intact defenses or a defense restored during its commit',async h=>{
  const admin=await fixture(h,'反撃待機の江戸',{admin:true}),defender=await fixture(h,'反撃先の二条',{holdings:['nijo']}),raider=await fixture(h,'反撃契機',{startCastle:'sakamoto'});seedBranches(h,defender,[completed('nijo','north')]);
  const mission=async(action,extra,expected=200)=>h.api('/covert/'+action,post(admin,{requestId:crypto.randomUUID(),deviceId:admin.deviceId,expectedRevision:row(h,admin).revision,campaignId:save(h,admin).state.walking.campaignId,sequence:save(h,admin).state.covert.sequence,...extra},expected));
  await mission('hire',{sourceCastleId:'edo',count:300});const dispatched=(await mission('dispatch',{sourceCastleId:'edo',target:{kind:'player',playerId:defender.user.id,castleId:'nijo'},count:200,mode:'station'})).data;assert(dispatched.marching);
  h.now+=dispatched.march.remainingMs;const stationed=await marches(h,admin);assert.equal(stationed.history[0].status,'resolved');const station=stationed.save.state.covert.stations[0].id;await syncFieldWriter(h,raider);
  const incident=(await force(false,()=>attack(h,raider,admin,'edo'))).data.battle.id;await syncFieldWriter(h,admin);const before=effects(h);assert.equal((await mission('retaliate',{stationId:station,incidentId:incident},409)).data.error.code,'BRANCHES_REQUIRED');assert.deepEqual(effects(h),before);
  seedBranches(h,defender,[completed('nijo','north',3,true)]);const stable=effects(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO covert_requests')))return;h.beforeBatch=null;const state=branchState(h,defender);state.branches[0].fallen=false;h.sql.prepare('UPDATE branch_states SET state_json=?,sequence=sequence+1 WHERE actor_id=?').run(JSON.stringify(state),defender.user.id);};await mission('retaliate',{stationId:station,incidentId:incident},409);const after=effects(h);stable.branch_states=after.branch_states;assert.deepEqual(after,stable);assert.equal(count(h,'covert_battles'),0);
 });
 await scope('branch status never returns stale operator or staff controls after a late demotion',async h=>{
  const admin=await fixture(h,'支拠点表示の運営',{admin:true}),staff=await fixture(h,'支拠点表示の担当',{staff:true,holdings:['nijo']}),replacement=await fixture(h,'支拠点表示の新しい運営');
  for(const [player,change] of [[staff,()=>h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(staff.user.id)],[admin,()=>h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(replacement.user.id)]]){
   h.beforeStatement=query=>{if(!query.startsWith('SELECT 1 AS allowed WHERE ')||!query.includes('staff_members'))return;h.beforeStatement=null;change();};const result=await h.api('/branches?deviceId='+player.deviceId,{token:player.token,expected:409});assert.equal(result.data.error.code,'BRANCH_ACCESS_CHANGED');assert.match(result.data.error.message,/支拠点/);assert.equal(result.data.parents,undefined);
  }
 });
}finally{globalThis.fetch=network;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
