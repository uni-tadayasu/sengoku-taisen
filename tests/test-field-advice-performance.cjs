/* Advice candidates reuse one fresh army read without retaining it across actions. */
'use strict';
const assert=require('node:assert/strict');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {officers}=require('../tools/audit-economy.cjs');
const advisor=require('../battle-advisor.js');
let captured,combatReads=0;
global.SENGOKU_DATA=D;
global.SengokuEngine={officerCombatFactor(state,id){combatReads++;return E.officerCombatFactor(state,id);}};
global.SengokuBattleAdvisor={...advisor,compare(candidates,options){captured={candidates,options};return advisor.compare(candidates,options);}};
const field=require('../field.js');
const ids=officers.map(o=>o.id);
function context(){
 const army=ids.slice(0,3);
 return{player:{playerId:'other',name:'相手',homeCastleId:'kiyosu',targetCastleId:'kiyosu',defensePower:3500,defenseTroops:2000,attackable:true,capturable:false,battleMode:'raid'},
  me:{attack:{ready:true,minTroops:300,maxTroops:100000,availableTroops:20000}},identity:{id:'self'},access:{writable:true},troops:1000,
  state:{troops:20000,command:3,morale:80,resources:{rice:50000},tech:{discipline:2,gunnery:1},army,officerVariants:ids.flatMap(id=>D.ranks.map(rank=>id+':'+rank)),officerHealth:{values:Object.fromEntries(army.map((id,i)=>[id,100-i*25]))}},
  rules:{targetCastles:true},clock:{ready:true,clock:{running:true,elapsedMs:0}}};
}
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}
function assertFreshEstimates(ctx){
 const {candidates,options}=captured;
 const individual=candidates.map(candidate=>field.estimateBattle({player:ctx.player,state:ctx.state,troops:candidate.troops,tactic:candidate.tactic,rules:ctx.rules}));
 assert.deepEqual(candidates,individual,'Every candidate must match a fresh public estimate');
 return advisor.compare(individual,options);
}

test('hundreds of candidates read the complete rank collection and each army member only once',()=>{
 const ctx=context(),variants=ctx.state.officerVariants;let rankReads=0;
 Object.defineProperty(ctx.state,'officerVariants',{enumerable:true,get(){rankReads++;return variants;}});
 const before=JSON.stringify(ctx);rankReads=0;combatReads=0;
 const result=field.battleAdvice(ctx);
 assert.equal(result.ok,true);assert(captured.candidates.length>100);
 assert.equal(rankReads,1);assert.equal(combatReads,ctx.state.army.length);
 assert.deepEqual(result,assertFreshEstimates(ctx));assert.equal(JSON.stringify(ctx),before);
});
test('same-length rank edits, health edits, army replacements and styles are fresh on the next request',()=>{
 const ctx=context(),[first,second,third]=ctx.state.army;
 ctx.state.officerVariants=[first+':D',second+':S',third+':C',ids[3]+':U'];
 const inspect=()=>{combatReads=0;const result=field.battleAdvice(ctx);assert.equal(combatReads,ctx.state.army.length);assert.deepEqual(result,assertFreshEstimates(ctx));return captured.candidates.find(candidate=>candidate.troops===300&&candidate.tactic==='balanced').attackPower;};
 const initial=inspect();ctx.state.officerVariants[0]=first+':U';const promoted=inspect();assert(promoted>initial);
 ctx.state.officerHealth.values[first]=0;const tired=inspect();assert(tired<promoted);
 ctx.state.army[0]=ids[3];ctx.state.officerHealth.values[ids[3]]=100;assert(inspect()>tired);
 for(const style of ['balanced','conserve','rapid']){ctx.style=style;inspect();}
});
test('unavailable estimates stay lazy and never grant attack permission',()=>{
 for(const update of [ctx=>ctx.state.resources.rice=0,ctx=>ctx.player.defensePower=0]){
  const ctx=context();update(ctx);combatReads=0;assert.equal(field.battleAdvice(ctx).ok,false);assert.equal(combatReads,0);
 }
 for(const update of [ctx=>ctx.access.writable=false,ctx=>ctx.player.displayOnly=true,ctx=>ctx.player.playerId='self',ctx=>ctx.player.relationship='allied']){
  const ctx=context();update(ctx);assert.equal(field.battleAdvice(ctx).ok,false);assert.equal(captured.candidates.length,0);
 }
});
console.log(checks+' field advice correctness/performance checks passed.');
