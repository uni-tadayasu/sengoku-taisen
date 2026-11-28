'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const Travel=require('../travel.js');
const roster={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),roster);const officers=JSON.parse(JSON.stringify(roster.window.SENGOKU_OFFICERS));
const game=(options={})=>new E({officers,seed:1,...options});
const advance=(g,seconds,chunk=1)=>{const receipts=[];for(let left=seconds;left>1e-9;){const step=Math.min(chunk,left),r=g.tick(step);receipts.push(...(r.marchResults||[]));left-=step;}return receipts;};
const stableSave=g=>{const save=JSON.parse(g.exportSave());delete save.savedAt;return JSON.stringify(save);};
const load=(g,options={})=>E.fromSave(stableSave(g),officers,options);
const snapshot=v=>structuredClone(v);
let tests=0;function test(name,fn){fn();tests++;console.log('PASS '+name);}
const target=g=>g.adjacentTargets().find(c=>g.previewBattle(c.id).ok).id;
const weakTarget=g=>{const id=target(g);g.state.castles[id].troops=100;g.state.castles[id].wall=1;return id;};
const pending=(g,n=1500)=>{const id=weakTarget(g),result=g.departAttack(id,'balanced',n);assert(result.ok,result.message);return result.march;};
const clock=(elapsedMs,more={})=>({id:'test-world',elapsedMs,running:true,speed:1,...more});

test('all 130 map coordinates are shared; near routes take less time and remote routes are not capped',()=>{
  const ctx={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../map-data.js'),'utf8'),ctx);const geodata=ctx.window.SENGOKU_GEOGRAPHY.castles;
  assert.equal(Object.keys(Travel.coordinates).length,130);for(const c of D.castles){assert.equal(Travel.coordinates[c.id].lat,geodata[c.id].lat);assert.equal(Travel.coordinates[c.id].lon,geodata[c.id].lon);}
  const near=Travel.plan({sourceCastleId:'kiyosu',targetCastleId:'inuyama'}),far=Travel.plan({sourceCastleId:'kiyosu',targetCastleId:'edo'}),remote=Travel.plan({sourceCastleId:'ishikawa',targetCastleId:'uchijo'});
  assert(near.distanceKm<far.distanceKm&&near.durationMs<far.durationMs);assert(remote.durationMs>600000);assert.equal(near.durationMs,26000);assert.equal(far.durationMs,150000);
  assert.equal(Travel.plan({sourceCastleId:'kiyosu',targetCastleId:'kiyosu'}).durationMs,15000);
  for(const id of ['bad','__proto__','constructor'])assert.equal(Travel.plan({sourceCastleId:id,targetCastleId:'edo'}),null);
  assert.equal(Travel.plan({sourceCastleId:'edo',targetCastleId:'kiyosu',localOffsetKm:NaN}),null);
});

test('departure escrows every soldier and cost without battle, capture, reward or progress',()=>{
  const g=game(),id=weakTarget(g),before=snapshot(g.state),beforeUpkeep=g.income().upkeep,preview=g.previewBattle(id,'balanced',1500),untouched=stableSave(g);
  assert(preview.travel);assert.equal(stableSave(g),untouched);const r=g.departAttack(id,'balanced',1500);assert(r.accepted);assert.equal(r.battle,undefined);
  assert.equal(g.state.troops,before.troops-1500);assert.equal(g.state.resources.rice,before.resources.rice-preview.foodCost);assert.equal(g.state.command,before.command-1);
  assert.equal(g.state.castles[id].owner,before.castles[id].owner);assert.deepEqual(g.state.stats,before.stats);assert.equal(g.state.lastBattle,null);assert.equal(g.state.marchHistory.length,0);
  assert.deepEqual(g.state.progress,before.progress);assert.equal(g.income().upkeep,beforeUpkeep);
  const after=stableSave(g),again=g.departAttack(id,'balanced',1500);assert(again.idempotent);assert.equal(stableSave(g),after);assert.equal(g.departAttack(id,'assault',1500).code,'MARCH_ACTIVE');assert.equal(g.attack(id,'balanced',300).ok,false);
});

test('arrival occurs on the exact simulated boundary once and returns survivors',()=>{
  const g=game(),before=g.state.troops,m=pending(g);advance(g,m.travel.durationMs/1000-.001,5);assert(g.state.march);assert.equal(g.state.stats.battles,0);const r=g.tick(.001);assert.equal(r.marchResults.length,1);
  const record=r.marchResults[0];assert.equal(record.id,m.id);assert.equal(record.status,'resolved');assert.equal(record.resolvedElapsedMs,m.arrivesElapsedMs);assert.equal(g.state.troops,before-record.battle.ourLost-record.battle.garrison);assert.equal(g.state.stats.battles,1);
  const state=stableSave(g);assert.deepEqual(g.resolveDueMarches(),[]);assert.equal(stableSave(g),state);assert.equal(g.state.march,null);assert.equal(g.state.marchHistory.length,1);
});

test('recruiting cannot use the space already reserved by soldiers in transit',()=>{
  const g=game();g.state.troops=g.troopCapacity();pending(g,1500);assert.equal(g.availableTroopCapacity(),g.troopCapacity()-1500);const before=stableSave(g);assert.equal(g.recruitTroops(100).ok,false);assert.equal(stableSave(g),before);
});

test('saving and restoring a pending army preserves exact timing and one result',()=>{
  const g=game(),m=pending(g);advance(g,7.5);const h=load(g);assert.deepEqual(h.state,g.state);assert.equal(h.getMarchStatus().remainingMs,m.travel.durationMs-7500);
  advance(g,40,1);advance(h,40,5);const a=snapshot(h.state),b=snapshot(g.state);for(const state of [a,b])for(const key of D.resources)state.realtime.incomeRemainders[key]=Math.round(state.realtime.incomeRemainders[key]*1e8)/1e8;assert.deepEqual(a,b);assert.deepEqual(load(h).state,h.state);
});

test('arrival uses departure strength, formation and random seed despite later training or random draws',()=>{
  const g=game(),m=pending(g),h=load(g);g.state.army=[];g.state.morale=15;g.state.tech.siege=5;g.state.tech.discipline=5;g.state.tech.gunnery=5;g.state.resources.rice=0;g.state.command=0;for(let i=0;i<20;i++)g.random();
  advance(g,m.travel.durationMs/1000);advance(h,m.travel.durationMs/1000);assert.deepEqual(g.state.marchHistory[0].battle,h.state.marchHistory[0].battle);for(const id of m.profile.army)assert.equal(g.state.progress.officers[id].sorties,1);
});

test('nearest owned adjacent castle is the real origin and branches retain geographic direction',()=>{
  const g=game(),dest=D.castles.find(c=>c.neighbors.length>=3&&!['edo','kyoto_gosho'].includes(c.id));for(const id of dest.neighbors)g.state.castles[id].owner=g.state.clan;g.state.castles[dest.id].owner='在地衆';
  const expected=Travel.nearest(dest.neighbors,dest.id),p=g.previewBattle(dest.id,'balanced',300);assert.equal(p.travel.sourceCastleId,expected.sourceCastleId);
  const b={id:'osaka_north',parentCastleId:'osaka',direction:'north'};g.state.branches.push({id:b.id,parentCastleId:'osaka',direction:b.direction,level:1,fallen:false});for(const id of D.castles.find(v=>v.id==='osaka').neighbors)g.state.castles[id].owner=g.state.clan;
  const branch=g.previewBranchBattle(b.id,'balanced',300);assert(branch.ok,branch.message);assert.equal(branch.travel.branchDirection,b.direction);assert(g.departBranchAttack(b.id,'balanced',300).accepted);advance(g,300,5);assert.equal(g.state.marchHistory[0].kind,'branch');assert.equal(g.state.marchHistory[0].status,'cancelled');assert.equal(load(g).state.marchHistory[0].targetBranchId,b.id);
});

test('owner changes and newly allied targets cancel without combat and refund escrow once',()=>{
  for(const mutate of [(g,m)=>g.state.castles[m.targetCastleId].owner='在地衆',(g,m)=>g.state.treaties[m.targetOwner]=g.state.turn+6]){
    const g=game(),before=snapshot(g.state),m=pending(g);mutate(g,m);const income=g.income().rice;advance(g,m.travel.durationMs/1000);const receipt=g.state.marchHistory[0];assert.equal(receipt.status,'cancelled');assert.equal(receipt.battle,undefined);assert.equal(g.state.stats.battles,0);assert.equal(g.state.troops,before.troops);assert.equal(g.state.resources.rice,before.resources.rice+Math.trunc(income*m.travel.durationMs/60000));assert.deepEqual(g.resolveDueMarches(),[]);assert.equal(load(g).state.marchHistory[0].status,'cancelled');
  }
});

test('losing the departure city returns the army without using the remaining home troops',()=>{
  const g=game();g.state.castles.inuyama.owner=g.state.clan;const m=pending(g),before=g.state.troops;g.state.castles[m.sourceCastleId].owner='在地衆';const r=g.resolveDueMarches();assert.equal(r[0].status,'cancelled');assert.equal(g.state.troops,before+m.troops);assert.equal(g.resolveDueMarches().length,0);
});

test('world time pause, speed, delayed packets and catchup control travel without wall-clock settlement',()=>{
  const local=game(),m=pending(local);local.setRunning(false);advance(local,30);assert.equal(local.getMarchStatus().remainingMs,m.travel.durationMs);local.setRunning(true);local.setSpeed(4);advance(local,m.travel.durationMs/4000);assert.equal(local.state.march,null);
  const g=game();g.applyWorldClock(clock(0));const n=pending(g);g.applyWorldClock(clock(0,{running:false}));advance(g,500);assert.equal(g.getMarchStatus().remainingMs,n.travel.durationMs);g.applyWorldClock(clock(n.arrivesElapsedMs-1));assert(g.state.march);const r=g.applyWorldClock(clock(n.arrivesElapsedMs));assert.equal(r.marchResults.length,1);const saved=stableSave(g);g.applyWorldClock(clock(n.arrivesElapsedMs-10));assert.equal(stableSave(g),saved);
});

test('a cycle boundary cancels native marches and refunds before territory resets',()=>{
  const g=game();g.state.turn=671;g.state.realtime.elapsed=59;const before=g.state.troops,m=pending(g);const r=g.tick(1);assert.equal(g.state.cycle.index,1);assert.equal(g.state.march,null);assert.equal(g.state.troops,before);assert.equal(g.state.marchHistory[0].id,m.id);assert.equal(g.state.marchHistory[0].status,'cancelled');assert.equal(r.marchResults.length,1);assert.equal(load(g).state.marchHistory[0].status,'cancelled');
});

test('all server march kinds survive load and clock or cycle progression without local settlement/refund',()=>{
  for(const kind of ['castle','branch','roaming','field','rally']){
    const g=game(),m=pending(g);g.state.march={...g.state.march,authority:'server',kind};delete g.state.march.profile;delete g.state.march.seed;delete g.state.march.commandBefore;const h=load(g),troops=h.state.troops;advance(h,120,5);assert.equal(h.state.march.id,m.id);assert.equal(h.state.marchHistory.length,0);assert.equal(h.state.troops,troops);assert.equal(h.departAttack(m.targetCastleId,'balanced',300).code,'MARCH_ACTIVE');h._settleCycle(1);assert.equal(h.state.march.id,m.id);assert.equal(h.state.troops,troops);assert.equal(h.reservedTroops(),kind==='rally'?0:m.troops);
  }
});

test('strict save normalization rejects corrupted timing, troop escrow, target and profile',()=>{
  const g=game();pending(g);for(const mutate of [m=>m.arrivesElapsedMs--,m=>m.travel.distanceKm++,m=>m.travel.durationMs--,m=>m.troops=-1,m=>m.profile.attackPower=NaN,m=>m.sourceCastleId='missing',m=>m.authority='untrusted']){const save=JSON.parse(stableSave(g));mutate(save.state.march);assert.throws(()=>E.fromSave(save,officers));}
});

test('roaming departures preserve sequence until arrival and support semantic idempotent recovery',()=>{
  const g=game(),unit=E.roamingDeploymentUnits(E.roamingDeploymentDefaults(),'kiyosu')[0],options={requestId:'roaming-travel',campaignId:g.state.walking.campaignId,sequence:0,deploymentUnit:unit,unitId:unit.unitId,castleId:unit.castleId,deploymentRevision:unit.deploymentRevision,respawnSeconds:300};
  const result=g.departRoamingBattle(unit.encounterId,'balanced',1500,options);assert(result.accepted,result.message);assert.equal(result.march.requestId,options.requestId);assert.equal(g.state.roaming.sequence,0);assert.equal(g.state.roaming.history.length,0);
  const retry={...options};delete retry.deploymentUnit;const before=stableSave(g);assert(g.departRoamingBattle(unit.encounterId,'balanced',1500,retry).idempotent);assert.equal(stableSave(g),before);assert.equal(g.departRoamingBattle(unit.encounterId,'balanced',1500,{...retry,sequence:1}).code,'REQUEST_ID_REUSED');
  const h=load(g);h.state.command=0;h.state.resources.rice=0;advance(h,result.march.travel.durationMs/1000);assert.equal(h.state.roaming.sequence,1);assert.equal(h.state.roaming.history.length,1);assert.equal(h.state.roaming.history[0].commandBefore,3);assert.equal(h.state.marchHistory[0].options.respawnSeconds,300);const saved=stableSave(h);assert(h.departRoamingBattle(unit.encounterId,'balanced',1500,retry).idempotent);assert.equal(stableSave(h),saved);assert.deepEqual(load(h).state,h.state);
});

test('retrying a cancelled roaming request returns its receipt without deploying again',()=>{
  const g=game(),unit=E.roamingDeploymentUnits(E.roamingDeploymentDefaults(),'kiyosu')[0],options={requestId:'cancelled-roaming',campaignId:g.state.walking.campaignId,sequence:0,deploymentUnit:unit};const result=g.departRoamingBattle(unit.encounterId,'balanced',1500,options);assert(result.accepted);g._cancelMarch('進軍を中止しました。');const h=load(g),before=stableSave(h),replay=h.departRoamingBattle(unit.encounterId,'balanced',1500,options);assert(replay.cancelled&&replay.idempotent);assert.equal(replay.accepted,false);assert.equal(replay.march.status,'cancelled');assert.equal(stableSave(h),before);assert.equal(h.departRoamingBattle(unit.encounterId,'assault',1500,options).code,'REQUEST_ID_REUSED');
});

test('automatic strategy waits for arrival, counting only finished castle battles',()=>{
  const g=game();g.state.troops=20000;g.state.resources.rice=100000;for(const c of g.adjacentTargets()){g.state.castles[c.id].troops=100;g.state.castles[c.id].wall=1;}
  const policy=g.compileStrategy('弱い城から1回攻める').policy,decision=g.planStrategy(policy);assert.equal(decision.action,'attack');const result=g.executeStrategy(policy,decision);assert(result.accepted);assert.equal(result.shouldStop,false);assert.equal(result.battle,undefined);assert.equal(g.state.stats.battles,policy.anchor.startBattles);assert.equal(g.planStrategy(policy).code,'STRATEGY_MARCHING');advance(g,result.march.travel.durationMs/1000);assert.equal(g.state.stats.battles,policy.anchor.startBattles+1);assert.equal(g.planStrategy(policy).code,'STRATEGY_LIMIT');
});

const covertGame=()=>{const g=game({isAdmin:true});g.state.covert.reserves.edo=100;return g;};
const dispatch=(g,mode='station',extra={})=>g.departCovertDispatch('edo',{kind:'castle',castleId:'kawagoe'},40,mode,{requestId:'covert-travel',...extra});

test('covert troops travel in escrow; reports and stations appear only at arrival',()=>{
  const g=covertGame(),result=dispatch(g);assert(result.accepted);assert.equal(g.state.covert.reserves.edo,60);assert.equal(g.covertStatus().sources[0].inTransit,40);assert.equal(g.covertStatus().stations.length,0);assert.equal(g.covertStatus().reports.length,0);assert.equal(g.covertStatus().dispatches[0].targetSnapshot,undefined);assert.equal(g.covertStatus().dispatches[0].kind,'covert');
  const before=stableSave(g);assert(dispatch(g).idempotent);assert.equal(stableSave(g),before);const h=load(g,{isAdmin:true});advance(h,result.march.travel.durationMs/1000-.001);assert.equal(h.state.covert.stations.length,0);h.tick(.001);assert.equal(h.state.covert.stations.length,1);assert.equal(h.state.covert.stations[0].createdElapsedMs,result.march.arrivesElapsedMs);assert.equal(h.state.covert.reports[0].observedElapsedMs,result.march.arrivesElapsedMs);assert.equal(h.state.covert.dispatches.length,0);assert.equal(h.state.covert.reserves.edo,60);assert.deepEqual(h.settleCovertDue(),[]);assert.deepEqual(load(h,{isAdmin:true}).state,h.state);
});

test('covert scouting reserves the party then returns it after reporting current defenses',()=>{
  const g=covertGame(),result=dispatch(g,'scout');g.state.castles.kawagoe.troops=777;advance(g,result.march.travel.durationMs/1000);assert.equal(g.state.covert.reserves.edo,60);assert.equal(g.state.covert.stations.length,0);assert.equal(g.state.covert.reports[0].snapshot.garrison,777);assert.equal(g.state.scouted.kawagoe,g.state.turn+3);assert.equal(load(g,{isAdmin:true}).state.covert.history[0].status,'marching');assert.equal(g.state.covert.dispatches[0].phase,'returning');advance(g,g.state.covert.dispatches[0].travel.durationMs/1000);assert.equal(g.state.covert.reserves.edo,100);assert.equal(load(g,{isAdmin:true}).state.covert.history[0].status,'resolved');
});

test('covert player reports require a fresh arrival snapshot and cannot leak departure intelligence',()=>{
  const g=covertGame(),old={level:1,troops:100,garrison:200,wall:1,defensePower:400},result=g.departCovertDispatch('edo',{kind:'player',playerId:'target-player',castleId:'kawagoe'},40,'station',{requestId:'player-travel',targetSnapshot:old});assert(result.accepted);assert(!JSON.stringify(g.state.covert).includes('defensePower'));
  advance(g,result.march.travel.durationMs/1000+10);assert.equal(g.state.covert.reports.length,0);assert.equal(g.state.covert.dispatches.length,1);const fresh={...old,garrison:900};const arrived=g.settleCovertDue({targetSnapshots:{'target-player:kawagoe':{snapshot:fresh,battleCursor:55}}});assert.equal(arrived.length,1);assert.equal(g.state.covert.reports[0].snapshot.garrison,900);assert.equal(g.state.covert.stations[0].battleCursor,55);assert(g.state.covert.stations[0].createdElapsedMs>=result.march.arrivesElapsedMs);
});

test('server covert dispatches never settle or cancel locally; authoritative arrival settles once',()=>{
  const g=covertGame(),result=dispatch(g);g.state.covert.dispatches[0].authority='server';g.state.covert.history[0].march.authority='server';const h=load(g,{isAdmin:true});advance(h,80);assert.equal(h.state.covert.stations.length,0);assert.equal(h.state.covert.reserves.edo,60);assert.equal(h.cancelCovertDispatch(result.march.id,'cancel'),null);assert.equal(h.settleCovertDue().length,0);
  const done=h.settleCovertDue({authoritative:true});assert.equal(done.length,1);assert.equal(h.state.covert.stations.length,1);assert.equal(h.settleCovertDue({authoritative:true}).length,0);
  const j=covertGame(),r=dispatch(j);j.state.covert.dispatches[0].authority='server';j._settleCycle(1);assert.equal(j.state.covert.dispatches.length,1);assert.equal(j.state.covert.reserves.edo,60);assert.equal(j.cancelCovertDispatch(r.march.id,'cycle',{authoritative:true}).status,'cancelled');assert.equal(j.state.covert.reserves.edo,100);
});

test('covert hiring includes traveling parties and cycle cancellation returns all reserved people',()=>{
  const g=covertGame(),capacity=g.covertStatus().sources[0].capacity;g.state.covert.reserves.edo=capacity;dispatch(g);const before=stableSave(g);assert.equal(g.hireCovert('edo',1).code,'COVERT_CAPACITY');assert.equal(stableSave(g),before);g._settleCycle(1);assert.equal(g.state.covert.dispatches.length,0);assert.equal(g.state.covert.reserves.edo,capacity);assert.equal(g.state.covert.history.find(v=>v.dispatchId).status,'cancelled');assert.deepEqual(load(g,{isAdmin:true}).state,g.state);
});

console.log(`Travel engine: ${tests} tests passed.`);
