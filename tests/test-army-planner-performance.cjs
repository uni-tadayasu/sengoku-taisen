/* Exact search reduction, checked against an independent unpruned enumeration. */
'use strict';
const assert=require('node:assert/strict');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const Planner=require('../army-planner.js');
const {fixture:developed,officers}=require('../tools/audit-economy.cjs');
const BITS={commander:1,cavalry:2,infantry:4,ranged:8,strategist:16,medic:32};
const skills=['merchant','medic','commander','cavalry','ranged','strategist','infantry'];
const copy=value=>JSON.parse(JSON.stringify(value));
let checks=0,comparisons=0;
function test(name,run){run();checks++;console.log('PASS '+name);}
function make(list){
 const game=new E({officers:list,clan:'織田家',seed:91});
 game.state.officers=list.map(row=>row.id);game.state.officerVariants=list.map(row=>row.id+':D');
 game.state.army=list.slice(-3).map(row=>row.id);game.state.governors={};game.state.officerHealth.values=Object.fromEntries(list.map(row=>[row.id,100]));return game;
}
function officer(id,lead,valor,intellect,skill='merchant'){
 return{id,name:id,clan:'織田家',region:'東海',rank:'D',rarity:'D',lead,valor,intellect,politics:65,skill};
}
function exhaustive(game,{tactic='balanced',locked=[],includeGovernors=false}={}){
 const s=game.state,stationed=new Set(s.branches.flatMap(row=>row.commanders||[])),governors=new Set(Object.values(s.governors)),current=new Set(s.army);
 const eligible=[...new Set(s.officers)].filter(id=>!stationed.has(id)&&(includeGovernors||!governors.has(id))),fixed=[...new Set(locked)],pool=eligible.filter(id=>!fixed.includes(id)),size=Math.min(3,eligible.length);
 let best=null,bestValue=-1,bestMedic=-1,bestRetained=-1;
 function consider(ids){
  // Use the real engine's public stat/rank/health calculations for every
  // combination; no pruning helper or model-internal projection is reused.
  const stats=game.armyStats(ids),rows=game.officerViews(ids),mask=rows.reduce((value,row)=>value|(BITS[row.skill]||0),0);
  const assignments={...s.governors};for(const [building,id]of Object.entries(assignments))if(ids.includes(id))delete assignments[building];
  const value=Planner.strength(stats,mask,tactic)*(1+game._facilityEffect('military',undefined,assignments));
  const medic=Number(rows.some(row=>row.skill==='medic')),retained=ids.filter(id=>current.has(id)).length;
  if(value>bestValue+1e-12||Math.abs(value-bestValue)<=1e-12&&(medic>bestMedic||medic===bestMedic&&retained>bestRetained)){
   best=ids.slice();bestValue=value;bestMedic=medic;bestRetained=retained;
  }
 }
 function visit(start,chosen){
  if(fixed.length+chosen.length===size){consider([...fixed,...chosen]);return;}
  const remaining=size-fixed.length-chosen.length;
  for(let i=start;i<=pool.length-remaining;i++){chosen.push(pool[i]);visit(i+1,chosen);chosen.pop();}
 }
 visit(0,[]);return{ids:best,value:bestValue};
}
function agrees(game,options){
 const before=copy(game.state),expected=exhaustive(game,options),actual=Planner.build(game,options);
 assert(actual.ok);assert.deepEqual(actual.ids.slice().sort(),expected.ids.slice().sort(),'same exact winning identities, including tie priorities');
 assert(Math.abs(actual.strength-expected.value)<1e-11,'same real engine strength');
 assert.deepEqual(actual.stats,game.armyStats(actual.ids));assert.deepEqual(game.state,before);comparisons++;return actual;
}
test('dominated candidates are pruned without changing first-result, medic, retention or fixed-officer ties',()=>{
 const list=Array.from({length:24},(_,i)=>officer('tie_'+i,90-Math.floor(i/6)*10,90-Math.floor(i/6)*10,90-Math.floor(i/6)*10,skills[i%6]));
 const game=make(list);game.state.army=['tie_18','tie_19','tie_20'];let reduced=0;
 for(const tactic of Planner.TACTICS)for(const locked of [[],['tie_20'],['tie_19','tie_20'],['tie_18','tie_19','tie_20']])reduced+=agrees(game,{tactic,locked}).prunedCandidates;
 assert(reduced>0,'fixture must exercise actual pruning');
 const equal=make(Array.from({length:24},(_,i)=>officer('equal_'+i,70,70,70,i===23?'medic':'merchant')));
 for(const tactic of Planner.TACTICS){const plan=agrees(equal,{tactic});assert(plan.medic);assert.equal(plan.ids.filter(id=>equal.state.army.includes(id)).length,3);assert(plan.prunedCandidates>0);}
});
test('randomized ranks, fractional health, governors, stationing and locks match exhaustive public-engine reads',()=>{
 let seed=4951;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<12;trial++){
  const count=18+trial%5,list=Array.from({length:count},(_,i)=>officer('r'+trial+'_'+i,Math.floor(random()*100),Math.floor(random()*100),Math.floor(random()*100),skills[Math.floor(random()*skills.length)])),game=make(list);
  game.state.officerVariants=list.map(row=>row.id+':'+D.ranks[Math.floor(random()*D.ranks.length)]);
  for(const row of list)game.state.officerHealth.values[row.id]=trial%3===0?100:Math.round(random()*600000)/6000;
  game.state.buildings.dojo=12;game.state.buildings.stable=9;game.state.governors={dojo:list[2].id,stable:list[3].id,market:list[4].id};
  if(trial%2)game.state.branches=[{id:'nijo_north',parentCastleId:'nijo',level:1,commanders:[list[1].id]}];
  const includeGovernors=trial%2===0,locked=trial%3===1?[list.at(-1).id]:trial%3===2?[list.at(-1).id,list.at(-2).id]:[];
  for(const tactic of Planner.TACTICS)agrees(game,{tactic,includeGovernors,locked});
 }
});
test('health near half-rounding boundaries and military-governor losses retain exhaustive choices',()=>{
 const list=Array.from({length:21},(_,i)=>officer('edge_'+i,95-i,80+i%5,92-i%7,skills[i%skills.length])),game=make(list);
 for(const [index,row]of list.entries())game.state.officerHealth.values[row.id]=[0,50,99.99983333333334,33.333333333333336,75,100][index%6];
 game.state.buildings.dojo=32;game.state.buildings.stable=31;game.state.governors={dojo:list[5].id,stable:list[12].id};
 for(const tactic of Planner.TACTICS){agrees(game,{tactic,includeGovernors:true});agrees(game,{tactic,includeGovernors:true,locked:[list[5].id]});}
});
test('the full 256-officer collection searches fewer than one tenth of the possible trios',()=>{
 const game=developed(32,20);game.state.officers=officers.map(row=>row.id);game.state.officerVariants=officers.flatMap(row=>D.ranks.filter(rank=>game.canOwnOfficerVariant(row.id,rank)).map(rank=>row.id+':'+rank));
 game.state.officerHealth.values=Object.fromEntries(officers.map(row=>[row.id,100]));game.state.army=game.state.officers.slice(0,3);game.state.governors={};
 const full=256*255*254/6,before=copy(game.state);
 for(const tactic of Planner.TACTICS){const result=Planner.build(game,{tactic});assert(result.ok);assert.equal(result.candidateCount,256);assert(result.examined<full/10);assert(result.prunedCandidates>150);assert.equal(new Set(result.ids).size,3);assert.deepEqual(result.stats,game.armyStats(result.ids));}
 assert.deepEqual(game.state,before);
});
console.log(`${checks} formation search groups passed; ${comparisons} independent exhaustive comparisons, with no saved-game changes or network requests.`);
