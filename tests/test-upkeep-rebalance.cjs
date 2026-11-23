'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),copy=value=>JSON.parse(JSON.stringify(value));
const game=options=>{const g=new E({officers,seed:77,...options});g._cpuTurn=()=>[];return g;};
const load=g=>{const h=E.fromSave(g.exportSave(),officers,{isAdmin:g.isAdmin,isStaff:g.isStaff,staffBase:g.getStaffBase(),maintenanceAuthority:g.getMaintenanceAuthority()});h._cpuTurn=()=>[];return h;};
const clock=elapsedMs=>({id:'upkeep-rebalance',elapsedMs,running:true,speed:1});
const authority=(g,changes=[],asOfElapsedMs=60000,baseline={elapsedMs:0,vacant:0,trade:0,alliance:0})=>({version:1,campaignId:g.state.walking.campaignId,activatedElapsedMs:0,revision:1,asOfElapsedMs,baseline,changes});
const branch=(parent,direction,troops,extra={})=>({id:parent+'_'+direction,parentCastleId:parent,direction,level:1,fallen:false,stationedTroops:troops,...extra});
function equalProgress(a,b){const left=copy(a.state),right=copy(b.state);for(const key of D.resources){assert(Math.abs(left.realtime.incomeRemainders[key]-right.realtime.incomeRemainders[key])<1e-8,key);left.realtime.incomeRemainders[key]=right.realtime.incomeRemainders[key];}assert.deepEqual(left,right);}
function target(income){return Math.min((income.gross.gold-income.facilityUpkeep.gold)*25,Math.floor((income.gross.rice-income.facilityUpkeep.rice)*25/3));}
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}

test('version 1 is explicit and read-only loading never applies partial-authority reductions',()=>{
 assert.equal(E.maintenanceRulesVersion,1);const g=game();g.state.troops=100000;const before=copy(g.state),h=load(g);assert.equal(h.state.troops,100000);assert.equal(h.state.log.filter(v=>v.kind==='upkeep').length,0);assert.deepEqual(g.state,before);
});
test('minimum reductions match exhaustive rounded gold and rice budgets',()=>{
 const g=game();g.state.castles[g.state.home].troops=0;
 for(const gold of [0,1,2,3,4,5])for(const rice of [0,1,2,3,4,7,8,11,12])for(let troops=0;troops<=101;troops++){
  g.state.troops=troops;g.income=()=>{const troopUpkeep=g.maintenance().troopUpkeep;return{gold:gold-troopUpkeep.gold,rice:rice-troopUpkeep.rice,gross:{gold,rice},facilityUpkeep:{gold:0,rice:0},troopUpkeep,totalTroops:g.state.troops};};
  const viable=Array.from({length:troops+1},(_,n)=>n).filter(n=>Math.ceil(n/25)<=gold&&Math.ceil(3*n/25)<=rice).at(-1),result=g.rebalanceTroopsForUpkeep();assert.equal(g.state.troops,viable,JSON.stringify({gold,rice,troops}));assert.equal(result.removed,troops-viable);
 }
});
test('large cash reserves do not defer a current deficit, and only troop upkeep changes',()=>{
 const g=game();g.state.resources={gold:10000000,rice:10000000,wood:10000000,stone:10000000};g.state.troops=20000;g.state.castles[g.state.home].troops=10000;const before=g.income(),balances=copy(g.state.resources),needed=before.totalTroops-target(before),morale=g.state.morale;
 const result=g.rebalanceTroopsForUpkeep();assert.equal(result.removed,needed);assert.deepEqual(result.reductions,{field:20000,home:needed-20000,castles:0,branches:0});assert.deepEqual(result.income.facilityUpkeep,before.facilityUpkeep);assert.deepEqual(result.income.gross,before.gross);assert.deepEqual(g.state.resources,balances);assert.equal(g.state.morale,morale);assert(result.income.gold>=0&&result.income.rice>=0);
 assert.equal(g.state.log.filter(v=>v.kind==='upkeep').length,1);assert.match(result.message,/手持ち.*→.*本拠/);const unchanged=copy(g.state);assert.equal(g.rebalanceTroopsForUpkeep().changed,false);assert.deepEqual(g.state,unchanged);
});
test('order is army, home, stable owned castles, then stable explicit branch soldiers',()=>{
 const g=game();g.state.troops=100;g.state.castles[g.state.home].troops=200;
 for(const id of ['osaka','nijo']){g.state.castles[id].owner=g.state.clan;g.state.castles[id].troops=300;}
 g.state.branches=[branch('osaka','north',30000),branch('nijo','north',1000),branch('nijo','east',1000)];const fixed=copy(g.income().facilityUpkeep),needed=g.income().totalTroops-target(g.income());
 const result=g.rebalanceTroopsForUpkeep();assert.equal(result.removed,needed);assert.deepEqual(result.allocations.map(row=>row.id),['army',g.state.home,'nijo','osaka','nijo_east','nijo_north','osaka_north']);assert.deepEqual(result.reductions,{field:100,home:200,castles:600,branches:needed-900});
 assert.equal(g.state.branches.find(row=>row.id==='nijo_east').stationedTroops,0);assert.equal(g.state.branches.find(row=>row.id==='nijo_north').stationedTroops,0);assert(g.state.branches.find(row=>row.id==='osaka_north').stationedTroops>0);assert.deepEqual(g.income().facilityUpkeep,fixed);
});
test('marches, covert troops, external deposits and enemy defenders are not debited',()=>{
 const g=game();g.state.troops=10000;const targetCastle=g.adjacentTargets().find(c=>g.previewBattle(c.id,'balanced',1000).ok);assert(targetCastle);assert(g.departAttack(targetCastle.id,'balanced',1000).ok);
 g.state.troops=17;g.state.castles[g.state.home].troops=8;g.state.covert.reserves.edo=50;assert(g.setMaintenanceAuthority(authority(g,[],60000,{elapsedMs:0,vacant:100000,trade:200000,alliance:300000})).ok);
 const march=copy(g.state.march),covert=copy(g.state.covert),external=g.getMaintenanceAuthority(),enemy=copy(g.state.castles[targetCastle.id]);const result=g.rebalanceTroopsForUpkeep();assert.equal(result.removed,25);assert.equal(g.state.troops,0);assert.equal(g.state.castles[g.state.home].troops,0);assert(result.income.gold<0&&result.income.rice<0);assert.deepEqual(g.state.march,march);assert.deepEqual(g.state.covert,covert);assert.deepEqual(g.getMaintenanceAuthority(),external);assert.deepEqual(g.state.castles[targetCastle.id],enemy);
 assert.equal(g.rebalanceTroopsForUpkeep().removed,0);
});
test('virtual branch support is never removed and exhausted retreat records do not revive',()=>{
 const g=game();g.state.castles.nijo.owner=g.state.clan;g.state.branches=[branch('nijo','north',0)];const before=g.branchDefense('nijo_north').baselineTroops;assert(before>0);g.state.troops=100000;g.rebalanceTroopsForUpkeep();assert.equal(g.state.branches[0].stationedTroops,0);assert.equal(g.branchDefense('nijo_north').baselineTroops,before);
 g.state.branches.push(branch('osaka','north',10,{fallen:true,retreating:true}));g.state.troops=0;g.state.castles[g.state.home].troops=0;g.state.castles.nijo.troops=0;assert(g.setMaintenanceAuthority(authority(g,[],60000,{elapsedMs:0,vacant:100000,trade:0,alliance:0})).ok);assert.equal(g.rebalanceTroopsForUpkeep().reductions.branches,10);assert(!g.state.branches.some(row=>row.id==='osaka_north'));assert.equal(load(g).maintenance().troops.retreating,0);
});
test('fixed facility deficits remain real after every reducible soldier reaches zero',()=>{
 const g=game();for(const b of D.buildings)if(['military','defense','research','diplomacy'].includes(b.category))g.state.buildings[b.id]=32;g.state.buildings.keep=1;g.state.buildings.farm=1;const before=g.income(),result=g.rebalanceTroopsForUpkeep();assert.equal(g.maintenance().totalTroops,0);assert.equal(result.income.troopUpkeep.gold,0);assert.equal(result.income.troopUpkeep.rice,0);assert.deepEqual(result.income.facilityUpkeep,before.facilityUpkeep);assert(result.income.gold<0&&result.income.rice<0);assert.equal(result.income.gold,result.income.gross.gold-before.facilityUpkeep.gold);
});
test('staff shared Kyoto soldiers stay intact and personal-home reductions survive reload and demotion',()=>{
 const personal=game({clan:'豊臣家'}),home=personal.state.home;personal.state.troops=0;personal.state.castles[home].troops=20000;personal.state.castles.nijo.owner=personal.state.clan;personal.state.castles.nijo.troops=3000;const buildings=copy(personal.state.buildings),base={id:'kyoto_gosho',revision:1,castleLevel:1,initial:{castleLevel:1,buildings},buildings,jobs:[],history:[],createdElapsedMs:0,updatedElapsedMs:0,accessSinceElapsedMs:0,clanSinceElapsedMs:0,personalClan:personal.state.clan,personalHome:home,personalCycleHome:home,personalBaseCastle:copy(personal.state.castles.kyoto_gosho),personalHomeCastle:copy(personal.state.castles[home])};
 const g=E.fromSave(personal.exportSave(),officers,{isStaff:true,staffBase:base});g.state.castles.kyoto_gosho.troops=9000000;const result=g.rebalanceTroopsForUpkeep();assert(result.removed>0);assert.equal(result.allocations[0].id,home);assert.equal(result.reductions.home,result.removed);assert.equal(g.state.castles.nijo.troops,3000);assert.equal(g.state.castles.kyoto_gosho.troops,9000000);const troops=g.state.castles[home].troops;assert.equal(g.getStaffPersonalProgress().castle.troops,troops);assert.equal(g.getStaffBase().personalHomeCastle.troops,troops);
 const restored=load(g);assert.equal(restored.state.castles[home].troops,troops);assert.equal(restored.rebalanceTroopsForUpkeep().changed,false);restored.setRoleAccess({isAdmin:false,isStaff:false});assert.equal(restored.state.castles[home].troops,troops);assert.equal(E.fromSave(g.exportSave(),officers).state.castles[home].troops,troops);
});
test('deficits wait until the monthly boundary and do not apply the former 8-percent loss',()=>{
 const g=game();g.state.troops=8000;g.state.resources.rice=1;g.state.buildings.farm=1;const original=copy(g.upkeepTroopSnapshot()),fees=copy(g.income().facilityUpkeep),expected=target(g.income());
 g._advanceRealtime(59.5);assert.deepEqual(g.upkeepTroopSnapshot(),original);assert.equal(g.state.resources.rice,0);assert(g.income().rice<0);assert.equal(g.state.log.filter(v=>v.kind==='upkeep').length,0);assert.equal(g.state.upkeep.settledTurn,0);
 const result=g._advanceRealtime(.5);assert.equal(g.state.turn,1);assert.equal(g.maintenance().totalTroops,expected);assert.equal(g.state.castles[g.state.home].troops,original.castles[g.state.home]+60);assert.equal(result.events.filter(text=>text.includes('自動調整')).length,1);assert(!result.events.some(text=>text.includes('離散')));assert.equal(g.state.resources.rice,0);assert.deepEqual(g.income().facilityUpkeep,fees);assert(g.income().gold>=0&&g.income().rice>=0);assert.equal(g.state.upkeep.settledTurn,1);
});
test('troops recruited after the monthly check survive reload and remain until the following month',()=>{
 const g=game();g.state.troops=10000;g.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};g._advanceRealtime(60);g.state.troops+=1000;const army=g.state.troops,logs=g.state.log.filter(v=>v.kind==='upkeep').length;
 assert(g.income().rice<0);assert.equal(g.settleMonthlyUpkeep().changed,false);const h=load(g);h._advanceRealtime(59.999);assert.equal(h.state.troops,army);assert.equal(h.state.log.filter(v=>v.kind==='upkeep').length,logs);assert.equal(h.state.upkeep.settledTurn,1);
 h._advanceRealtime(.001);assert.equal(h.state.turn,2);assert.equal(h.state.troops,army-1060);assert.equal(h.state.log.filter(v=>v.kind==='upkeep').length,logs+1);assert.equal(h.state.upkeep.settledTurn,2);assert.equal(h.settleMonthlyUpkeep().changed,false);
});
test('midmonth facility completion waits and a same-boundary production completion counts before balancing',()=>{
 const g=game();g.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};g.state.troops=20000;g._advanceRealtime(20);assert(g.upgrade('wall').ok);g._advanceRealtime(40);const troops=g.maintenance().totalTroops,fees=copy(g.income().facilityUpkeep),logCount=g.state.log.filter(v=>v.kind==='upkeep').length;
 g._advanceRealtime(20);assert.equal(g.state.jobs.length,0);assert.equal(g.income().facilityUpkeep.rice,fees.rice+1);assert(g.income().rice<0);assert.equal(g.maintenance().totalTroops,troops);assert.equal(g.state.log.filter(v=>v.kind==='upkeep').length,logCount);
 g._advanceRealtime(40);assert(g.maintenance().totalTroops<troops);assert(g.income().gold>=0&&g.income().rice>=0);assert.equal(g.state.log.filter(v=>v.kind==='upkeep').length,logCount+1);
 const h=game();h.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};h.state.buildings.farm=1;h.state.troops=8000;const lowerAllowance=target(h.income());assert(h.upgrade('farm').ok);h._advanceRealtime(60);assert.equal(h.state.buildings.farm,2);assert.equal(h.maintenance().totalTroops,target(h.income()));assert(h.maintenance().totalTroops>lowerAllowance);
});
test('midmonth external maintenance changes wait for a confirmed monthly boundary',()=>{
 const h=game();h.applyWorldClock(clock(0));const original=copy(h.upkeepTroopSnapshot());assert(h.setMaintenanceAuthority(authority(h,[{elapsedMs:15000,vacant:100000,trade:0,alliance:0}])).ok);h.applyWorldClock(clock(15000));assert.deepEqual(h.upkeepTroopSnapshot(),original);assert(h.income().rice<0);assert.equal(h.state.upkeep.settledTurn,0);
 h.applyWorldClock(clock(59999));assert.deepEqual(h.upkeepTroopSnapshot(),original);h.applyWorldClock(clock(60000));assert.equal(h.state.troops,0);assert.equal(h.state.castles[h.state.home].troops,0);assert(h.income().rice<0);assert.equal(h.state.upkeep.settledTurn,1);
});
test('long catch-up and fractional ticks with reloads converge without repeated monthly checks',()=>{
 const base=game();base.state.troops=30000;base.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};assert(base.upgrade('wall').ok);base.applyWorldClock(clock(0));assert(base.setMaintenanceAuthority(authority(base,[{elapsedMs:14573,vacant:37,trade:0,alliance:0},{elapsedMs:45491,vacant:0,trade:127,alliance:0},{elapsedMs:110033,vacant:0,trade:0,alliance:73}],240000)).ok);
 const fast=load(base);let stepped=load(base);fast.applyWorldClock(clock(240000));for(let at=1237;at<240000;at+=1237){stepped.applyWorldClock(clock(at));if(at%3711===0)stepped=load(stepped);}stepped.applyWorldClock(clock(240000));equalProgress(fast,stepped);assert.equal(fast.state.upkeep.settledTurn,4);const before=copy(fast.state);assert.equal(fast.settleMonthlyUpkeep().changed,false);assert.equal(fast.applyWorldClock(clock(240000)).changed,false);assert.deepEqual(fast.state,before);
});
test('server partial projections retain the unpaid month for one authoritative final check',()=>{
 const g=game();g.state.troops=20000;g.applyWorldClock(clock(0));g.applyWorldClock(clock(1000),{rebalanceTroops:false});assert.equal(g.state.troops,20000);assert.equal(g.settleMonthlyUpkeep().changed,false);g.applyWorldClock(clock(60000),{rebalanceTroops:false});assert.equal(g.state.troops,20000);assert.equal(g.state.upkeep.settledTurn,0);assert.equal(g.state.log.filter(v=>v.kind==='upkeep').length,0);
 const restored=load(g);assert.equal(restored.state.upkeep.settledTurn,0);assert(restored.settleMonthlyUpkeep().changed);assert.equal(restored.state.upkeep.settledTurn,1);assert.equal(restored.settleMonthlyUpkeep().changed,false);
 const h=game();h.state.troops=20000;h._advanceRealtime(1,{rebalanceTroops:false});h._advanceRealtime(1);assert.equal(h.state.troops,20000);h._advanceRealtime(58);assert(h.state.troops<20000);
});
test('monthly receipts retain cumulative branch losses through teardown, rebuilding and reload',()=>{
 const g=game();g.state.castles.nijo.owner=g.state.clan;g.state.troops=0;g.state.castles[g.state.home].troops=0;g.state.castles.nijo.troops=0;g.state.branches=[branch('nijo','north',30000)];const finish=g.beginUpkeepTracking();g._advanceRealtime(60);const receipt=copy(g.state.upkeep),left=g.state.branches[0].stationedTroops,journal=finish();assert.equal(receipt.settledTurn,1);assert.equal(receipt.branchReductions.nijo_north,30000-left);assert.equal(journal.records.length,1);assert.equal(journal.records[0].monthlyTurn,1);
 g.state.branches=[];const h=load(g);assert.deepEqual(h.state.upkeep,receipt);h.state.branches=[branch('nijo','north',30000)];h._advanceRealtime(60);assert.equal(h.state.upkeep.settledTurn,2);assert.equal(h.state.upkeep.branchReductions.nijo_north,receipt.branchReductions.nijo_north+30000-h.state.branches[0].stationedTroops);assert.deepEqual(load(h).state.upkeep,h.state.upkeep);
});
test('older saves and clock migration start at the current month without retroactive cuts',()=>{
 const old=game();old.state.troops=20000;old._advanceRealtime(20);const raw=JSON.parse(old.exportSave());delete raw.state.upkeep;const restored=E.fromSave(raw,officers);restored._cpuTurn=()=>[];assert.equal(restored.state.troops,20000);assert.deepEqual(restored.state.upkeep,{version:1,settledTurn:0,branchReductions:{}});restored._advanceRealtime(39.999);assert.equal(restored.state.troops,20000);restored._advanceRealtime(.001);assert(restored.state.troops<20000);
 const migrated=game();migrated.state.troops=20000;migrated.applyWorldClock(clock(121000));assert.equal(migrated.state.troops,20000);assert.equal(migrated.state.upkeep.settledTurn,2);migrated.applyWorldClock(clock(179999));assert.equal(migrated.state.troops,20000);migrated.applyWorldClock(clock(180000));assert(migrated.state.troops<20000);assert.equal(migrated.state.upkeep.settledTurn,3);
});
test('monthly receipt validation rejects future checks, unknown branches and invalid counters',()=>{
 const g=game(),raw=JSON.parse(g.exportSave());for(const upkeep of [{version:1,settledTurn:1,branchReductions:{}},{version:1,settledTurn:0,branchReductions:{missing:2}},{version:1,settledTurn:0,branchReductions:{nijo_north:-1}},{version:1,settledTurn:0,branchReductions:{nijo_north:.5}},{version:1,settledTurn:0,branchReductions:{nijo_north:Number.MAX_SAFE_INTEGER+1}}]){assert.throws(()=>E.fromSave({...raw,state:{...raw.state,upkeep}},officers));}
 assert.deepEqual(E.normalizeUpkeepState(undefined,5),{version:1,settledTurn:5,branchReductions:{}});
});
console.log(checks+' upkeep rebalance checks passed.');
