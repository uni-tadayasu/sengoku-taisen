/* Real engine checks for future income, affordable development and recruitment. */
'use strict';
const assert=require('node:assert/strict');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {fixture,officers}=require('../tools/audit-economy.cjs');
const copy=value=>JSON.parse(JSON.stringify(value)),load=game=>{const result=E.fromSave(game.exportSave(),officers,{maintenanceAuthority:game.getMaintenanceAuthority()});result._cpuTurn=()=>[];return result;};
const clock=elapsedMs=>({id:'economy-balance-clock',elapsedMs,running:true,speed:1});
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}

test('ordinary starting production stays intact and every ledger row reconciles',()=>{
 const game=fixture(),income=game.income();assert.deepEqual(income.net,{gold:530,rice:445,wood:197,stone:147});assert.deepEqual(income.net,income.rawNet);assert.deepEqual(income.surplusAdjustment,{gold:0,rice:0,wood:0,stone:0});
 for(const level of [4,8,16,32]){const income=fixture(level).income();for(const key of D.resources){assert.equal(income.rawNet[key],income.gross[key]-income.troopUpkeep[key]-income.facilityUpkeep[key]);assert.equal(income.net[key],income.rawNet[key]-income.surplusAdjustment[key]);assert.equal(income[key],income.net[key]);assert(income.surplusAdjustment[key]>=0);assert.equal(income.grossRice,income.gross.rice);}}
});
test('the surplus curve has no threshold jump, reversals or flat high-output ceiling',()=>{
 const game=fixture(),zero={gold:0,rice:0,wood:0,stone:0};
 for(const key of D.resources){const threshold=E.economyRules.surplusThresholds[key];let previous=-Infinity;
  for(const raw of [-100,0,1,threshold-1,threshold,threshold+1,threshold+2,threshold*2,threshold*10,threshold*100]){
   const income={totalTroops:0,facilityUpkeep:zero,gross:{...zero,[key]:raw}},preview=game.previewRecruitment(0,income),actual=preview.net[key];assert(actual>=previous);assert.equal(Math.sign(actual),Math.sign(raw));if(raw<=threshold)assert.equal(actual,raw);else assert(actual<=raw&&actual>=threshold);if(raw===threshold+1)assert(actual-threshold<=1);previous=actual;
  }
 }
});
test('large sustainable armies keep their production budget and are not cut by the surplus curve',()=>{
 const game=fixture(32);game.state.troops=game.troopCapacity();const before=game.income(),troops=game.state.troops;assert(before.rawNet.gold>0&&before.rawNet.rice>0);assert(before.surplusAdjustment.wood>0);assert.equal(game.rebalanceTroopsForUpkeep().changed,false);game._advanceRealtime(60);assert.equal(game.state.troops,troops);assert.equal(game.state.upkeep.settledTurn,1);assert(!game.state.log.some(row=>row.kind==='upkeep'));
 const deficit=fixture(32);deficit.state.troops=10000000;const income=deficit.income();assert.deepEqual(income.net.gold,income.rawNet.gold);assert.deepEqual(income.net.rice,income.rawNet.rice);assert.equal(income.surplusAdjustment.gold,0);assert.equal(income.surplusAdjustment.rice,0);const expected=Math.min((income.gross.gold-income.facilityUpkeep.gold)*25,Math.floor((income.gross.rice-income.facilityUpkeep.rice)*25/3));deficit._advanceRealtime(60);assert.equal(deficit.maintenance().totalTroops,expected);
});
test('loading savings and crediting direct rewards never invokes the passive adjustment',()=>{
 const game=fixture(32);game.state.resources={gold:90000000,rice:90000000,wood:90000000,stone:90000000};const before=copy(game.state.resources),loaded=load(game);assert.deepEqual(loaded.state.resources,before);const state=copy(loaded.state);loaded.income();loaded.recruitmentBudget();loaded.previewRecruitment(1000);assert.deepEqual(loaded.state,state);
 const gift={gold:50000,rice:40000,wood:30000,stone:20000,magatama:150};assert(loaded.applyGift(gift,'economy-gift').ok);for(const key of D.resources)assert.equal(loaded.state.resources[key],before[key]+gift[key]);loaded._gain(Object.fromEntries(D.resources.map(key=>[key,E.ASSET_CAP])));assert.deepEqual(loaded.state.resources,Object.fromEntries(D.resources.map(key=>[key,E.ASSET_CAP])));
});
test('large catch-up and small ticks with reloads accrue identical balanced resources',()=>{
 const original=fixture(16);original.applyWorldClock(clock(0));const fast=load(original);let slow=load(original);fast.applyWorldClock(clock(3600000),{maxSeconds:86400});for(let at=1237;at<3600000;at+=1237){slow.applyWorldClock(clock(at));if(at%123700===0)slow=load(slow);}slow.applyWorldClock(clock(3600000));const a=copy(fast.state),b=copy(slow.state);for(const key of D.resources){assert(Math.abs(a.realtime.incomeRemainders[key]-b.realtime.incomeRemainders[key])<1e-8,key);a.realtime.incomeRemainders[key]=b.realtime.incomeRemainders[key];}assert.deepEqual(a,b);
});
test('recruitment uses all owned troops and both resource budgets with exact rounding',()=>{
 const game=fixture();game.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};game.state.buildings.barracks=20;game.state.troops=100;game.state.castles[game.state.home].troops=1200;game.state.castles.nijo.owner=game.state.clan;game.state.castles.nijo.troops=2500;game.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,stationedTroops:2300}];
 assert(game.setMaintenanceAuthority({version:1,campaignId:game.state.walking.campaignId,activatedElapsedMs:0,revision:1,asOfElapsedMs:60000,baseline:{elapsedMs:0,vacant:400,trade:300,alliance:200},changes:[]}).ok);
 const income=game.income(),budget=game.recruitmentBudget(income);assert.equal(income.totalTroops,7000);const exhaustive=[];for(let amount=0;amount<=20000;amount++){const total=income.totalTroops+amount;if(Math.ceil(total/25)+income.facilityUpkeep.gold<=income.gross.gold&&Math.ceil(3*total/25)+income.facilityUpkeep.rice<=income.gross.rice)exhaustive.push(amount);}assert.equal(budget.sustainableMax,exhaustive.at(-1)||0);
 const preview=game.previewRecruitment(1000,income);assert.equal(preview.totalTroops,8000);for(const key of ['gold','rice'])assert.equal(preview.rawNet[key],income.gross[key]-preview.totalUpkeep[key]);assert.equal(preview.troopUpkeep.gold,320);assert.equal(preview.troopUpkeep.rice,960);
});
test('recommended recruitment leaves two months of its resulting upkeep and fixed minimum reserves',()=>{
 const game=fixture();game.state.buildings.barracks=8;game.state.resources={gold:3200,rice:3000,wood:17,stone:23};const income=game.income(),budget=game.recruitmentBudget(income),recommended=game.previewRecruitment(budget.recommendedMax,income);assert(budget.recommendedMax>=100&&budget.recommendedMax<budget.affordableMax);assert(recommended.sustainable&&recommended.affordable&&recommended.withinReserve);for(const key of ['gold','rice'])assert(recommended.balances[key]>=Math.max(budget.minimumReserve[key],recommended.totalUpkeep[key]*2));assert.equal(recommended.balances.wood,17);assert.equal(recommended.balances.stone,23);
 if(budget.recommendedMax<Math.min(budget.sustainableMax,budget.affordableMax))assert.equal(game.previewRecruitment(budget.recommendedMax+1,income).withinReserve,false);
 const chosen=budget.affordableMax;assert(game.previewRecruitment(chosen,income).affordable);assert.equal(game.recruitTroops(chosen).ok,true,'manual affordable recruitment remains available');
 const poor=fixture();poor.state.resources.gold=499;poor.state.resources.rice=999;assert.equal(poor.recruitmentBudget().recommendedMax,0);assert.equal(poor.previewRecruitment(-1),null);assert.equal(poor.previewRecruitment(20001),null);
});
test('budget and previews can share one current income snapshot without extra scans',()=>{
 const game=fixture(32),income=game.income(),state=copy(game.state);game.income=()=>{throw new Error('unexpected income rescan');};const budget=game.recruitmentBudget(income),preview=game.previewRecruitment(budget.recommendedMax,income);assert(preview);assert.deepEqual(game.state,state);
});
console.log(checks+' resource-economy checks passed. No external requests.');
