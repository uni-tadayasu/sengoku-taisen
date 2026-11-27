/* Rank food affects real engine production, elapsed-time settlement and forecasts. */
'use strict';
const assert=require('node:assert/strict');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {officers}=require('../tools/audit-economy.cjs');
const clone=value=>structuredClone(value);
const newGame=options=>new E({officers,seed:3,...options});
const clock=elapsedMs=>({id:'rank-rice-clock',elapsedMs,running:true,speed:1,revision:0});
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}
function verify(game){
 const before=clone(game.state),rank=game.evaluation(),income=game.income(),bonus=income.rankRiceBonus;
 assert.equal(bonus.rankId,rank.rankId);assert.equal(bonus.rankName,rank.rankName);assert.equal(bonus.rankIndex,rank.rankIndex);
 assert.equal(bonus.percent,rank.rankIndex*2);assert.equal(rank.riceBonusPercent,bonus.percent);
 assert.equal(bonus.amount,Math.floor(bonus.baseRice*bonus.percent/100));assert.equal(income.gross.rice,bonus.baseRice+bonus.amount);assert.equal(income.grossRice,income.gross.rice);
 for(const key of D.resources){assert.equal(income.rawNet[key],income.gross[key]-income.troopUpkeep[key]-income.facilityUpkeep[key]-income.governorSalary[key]);assert.equal(income.operatingNet[key],income.rawNet[key]-income.surplusAdjustment[key]);assert.equal(income.net[key],income.operatingNet[key]-income.repairUpkeep[key]);}
 assert.deepEqual(game.state,before,'reading a bonus cannot credit funds or alter progress');
 return income;
}
let developed;

test('all 17 inclusive rank boundaries carry 0–32 percent and invalid scores cannot confer rank',()=>{
 assert.equal(D.evaluationRanks.length,17);assert.deepEqual(D.evaluationRanks.map(rank=>rank.riceBonusPercent),[0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32]);
 for(const [index,rank] of D.evaluationRanks.entries()){
  assert.equal(E.evaluationRank(rank.minScore).riceBonusPercent,index*2);
  if(index)assert.equal(E.evaluationRank(rank.minScore-1).riceBonusPercent,(index-1)*2);
 }
 for(const score of [NaN,Infinity,-Infinity,-1,'98000',null,undefined])assert.equal(E.evaluationRank(score).riceBonusPercent,0);
 assert.equal(E.evaluationRank(Number.MAX_SAFE_INTEGER).riceBonusPercent,32);
});

test('ordinary campaign growth reaches every rank and each rank adds its stated rate exactly once',()=>{
 const unranked=newGame({officers:[]}),seen=new Set([verify(unranked).rankRiceBonus.rankIndex]);
 const game=newGame(),record=()=>{const rank=game.evaluation();if(!seen.has(rank.rankIndex)){verify(game);seen.add(rank.rankIndex);}};record();
 for(const officer of officers){game._grantOfficerVariant(officer.id,game.canOwnOfficerVariant(officer.id,'U')?'U':'SSS');record();}
 for(const building of D.buildings){game.state.buildings[building.id]=32;record();}
 for(const tech of D.techs){game.state.tech[tech.id]=5;record();}
 for(const castle of D.castles)if(game.canOwnCastle(castle.id)){game.state.castles[castle.id].owner=game.state.clan;game.state.castles[castle.id].level=game.castleLevelLimit(castle.id);record();}
 for(let prestige=1000;prestige<=20000;prestige+=1000){game.state.prestige=prestige;record();}
 for(let wins=10;wins<=100;wins+=10){game.state.stats.wins=wins;game.state.stats.battles=wins;record();}
 for(let steps=100000;steps<=1000000;steps+=100000){game.state.walking.localSteps=steps;record();}
 const best=game.state.officers.map(id=>game.officer(id)).sort((a,b)=>(b.lead+b.valor+b.intellect)-(a.lead+a.valor+a.intellect)).slice(0,3);
 assert(game.assignArmy(best.map(officer=>officer.id)).ok);record();
 const plan=game.planGovernorAssignments();assert(plan.ok);for(const [id,officer] of Object.entries(plan.governors)){game.state.governors[id]=officer;record();}
 assert.deepEqual([...seen].sort((a,b)=>a-b),Array.from({length:17},(_,i)=>i));assert.equal(game.evaluation().rankName,'正一位');developed=game;
 const income=verify(developed);assert(income.surplusAdjustment.rice>0,'developed production still uses the existing surplus adjustment');
});

test('promotion changes only rice production; fees, reserves and non-rice income remain unchanged',()=>{
 const game=newGame({officers:[]}),before=verify(game),reserves=clone(game.state.resources),maintenance=clone(game.maintenance());assert.equal(before.rankRiceBonus.percent,0);
 game.state.prestige=10000;const promoted=verify(game);assert.equal(promoted.rankRiceBonus.percent,2);assert.equal(promoted.rankRiceBonus.baseRice,before.gross.rice);
 assert.equal(promoted.gross.rice-before.gross.rice,promoted.rankRiceBonus.amount);assert.equal(promoted.rawNet.rice-before.rawNet.rice,promoted.rankRiceBonus.amount);
 assert.deepEqual(game.maintenance(),maintenance);assert.deepEqual(game.state.resources,reserves);
 for(const key of ['gold','wood','stone'])for(const part of ['gross','rawNet','operatingNet','net'])assert.equal(promoted[part][key],before[part][key]);
 game.state.prestige=0;assert.deepEqual(verify(game),before,'demotion immediately restores the previous rate');
});

test('production growth increases the bonus while stored resources, gifts and forged saved titles never multiply it',()=>{
 const game=newGame({officers:[]});game.state.prestige=20000;const initial=verify(game);game.state.buildings.farm++;
 const grown=verify(game);assert(grown.rankRiceBonus.baseRice>initial.rankRiceBonus.baseRice);assert(grown.rankRiceBonus.amount>initial.rankRiceBonus.amount);
 for(const key of D.resources)game.state.resources[key]=100000000;
 game.state.evaluation={score:100000,rankName:'正一位',riceBonusPercent:999};game.state.rank='正一位';game.state.riceBonusPercent=999;game.state.rankRiceBonus={percent:999,amount:100000000};
 const forged=verify(game);assert.deepEqual(forged.gross,grown.gross);assert.deepEqual(forged.rankRiceBonus,grown.rankRiceBonus);
 const restored=E.fromSave(game.exportSave(),[]);assert.deepEqual(verify(restored).rankRiceBonus,grown.rankRiceBonus,'reload derives the rate from real progress');
 for(const building of D.buildings)game.state.buildings[building.id]=0;for(const castle of Object.values(game.state.castles))castle.owner='在地衆';
 const empty=verify(game);assert.equal(empty.rankRiceBonus.baseRice,0);assert.equal(empty.rankRiceBonus.amount,0);
});

test('governor forecasts use their proposed rank and yield the same result when appointments take effect',()=>{
 const game=newGame();game.state.army=[];game.state.governors={};game.state.prestige=0;game.state.stats.wins=0;
 const base=game.evaluation().score;assert(base<4999);game.state.prestige=(4999-base)*2;assert.equal(game.evaluation().score,4999);
 const candidate=game.state.officers.map(id=>game.officer(id)).sort((a,b)=>b.politics-a.politics)[0],before=clone(game.state),actual=verify(game),preview=game.income({governors:{farm:candidate.id}});
 assert.equal(actual.rankRiceBonus.percent,0);assert.equal(preview.rankRiceBonus.percent,2);assert(preview.gross.rice>actual.gross.rice);assert.deepEqual(game.state,before);
 assert(game.assignGovernor('farm',candidate.id).ok);assert.deepEqual(verify(game),preview,'forecast does not miss the promotion from a valid new appointment');
});

test('local play and shared-clock settlement pay the same prorated bonus across a save reload without duplicate credit',()=>{
 const local=newGame();local.state.prestige=20000;const rate=verify(local),start=clone(local.state.resources),shared=E.fromSave(local.exportSave(),officers);
 assert(shared.applyWorldClock(clock(0)).migrated);local._advanceRealtime(30);assert(shared.applyWorldClock(clock(15000)).changed);
 const restored=E.fromSave(shared.exportSave(),officers);assert(restored.applyWorldClock(clock(30000)).changed);
 for(const key of D.resources){assert.equal(local.state.resources[key],start[key]+Math.trunc(rate.operatingNet[key]/2));assert.equal(restored.state.resources[key],local.state.resources[key]);assert(Math.abs(restored.state.realtime.incomeRemainders[key]-local.state.realtime.incomeRemainders[key])<1e-9);}
 const settled=clone(restored.state);assert.equal(restored.applyWorldClock(clock(30000)).changed,false);assert.deepEqual(restored.state,settled);assert.equal(restored.applyWorldClock(clock(15000)).changed,false);assert.deepEqual(restored.state,settled);
});

console.log(`${checks} rank rice production groups passed with all 17 real campaign ranks. No live requests.`);
