/* Usage: node tools/benchmark-field-advice.cjs [path/to/prior/field.js]
 * Without a baseline, measures the current implementation only.
 * All fixtures are synthetic; this makes no requests and changes no saves.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {officers}=require('./audit-economy.cjs');
const advisor=require('../battle-advisor.js');
const ids=officers.map(officer=>officer.id);
const WARMUP=20,TRIALS=7,ITERATIONS=50,DIFFERENTIAL_CASES=100,SEED=1397;

function loadField(filename){
 let healthReads=0,candidates=0;
 const context={
  module:{exports:{}},SENGOKU_DATA:D,
  SengokuEngine:{officerCombatFactor(state,id){healthReads++;return E.officerCombatFactor(state,id);}},
  SengokuBattleAdvisor:{...advisor,compare(values,options){candidates=values.length;return advisor.compare(values,options);}}
 };
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});
 return{api:context.module.exports,reset(){healthReads=0;candidates=0;},reads(){return{healthReads,candidates};}};
}
const before=process.argv[2]?loadField(path.resolve(process.argv[2])):null;
const after=loadField(path.join(__dirname,'../field.js'));

function fixture(){
 const army=ids.slice(0,3);
 return{
  player:{playerId:'other',name:'相手',homeCastleId:'kiyosu',targetCastleId:'kiyosu',defensePower:3500,defenseTroops:2000,attackable:true,capturable:false,battleMode:'raid'},
  me:{attack:{ready:true,minTroops:300,maxTroops:100000,availableTroops:20000}},
  identity:{id:'self'},access:{writable:true},troops:1000,
  state:{
   troops:20000,command:3,morale:80,resources:{rice:50000},tech:{discipline:2,gunnery:1},army,
   officerVariants:ids.flatMap(id=>D.ranks.map(rank=>id+':'+rank)),
   officerHealth:{values:Object.fromEntries(army.map((id,i)=>[id,100-i*25]))}
  },
  rules:{targetCastles:true},clock:{ready:true,clock:{running:true,elapsedMs:0}}
 };
}

let seed=SEED;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
if(before)for(let i=0;i<DIFFERENTIAL_CASES;i++){
 const ctx=fixture();
 ctx.state.troops=Math.floor(random()*80000);
 ctx.me.attack.availableTroops=ctx.state.troops;
 ctx.troops=Math.floor(random()*ctx.state.troops);
 ctx.player.defensePower=1+Math.floor(random()*100000);
 ctx.state.morale=Math.floor(random()*101);
 ctx.state.resources.rice=Math.floor(random()*100000);
 ctx.state.tech.discipline=Math.floor(random()*12);
 ctx.style=['balanced','conserve','rapid'][i%3];
 ctx.state.officerVariants=ctx.state.officerVariants.filter(()=>random()>.65);
 for(const id of ctx.state.army)ctx.state.officerHealth.values[id]=Math.floor(random()*101);
 assert.equal(JSON.stringify(after.api.battleAdvice(ctx)),JSON.stringify(before.api.battleAdvice(ctx)),`Differential scenario ${i}`);
}

const ctx=fixture();
function reads(implementation){
 const state=ctx.state,variants=state.officerVariants;let rankReads=0;
 Object.defineProperty(state,'officerVariants',{configurable:true,enumerable:true,get(){rankReads++;return variants;}});
 try{
  implementation.reset();implementation.api.battleAdvice(ctx);
  return{...implementation.reads(),rankCollectionReads:rankReads};
 }finally{
  Object.defineProperty(state,'officerVariants',{configurable:true,enumerable:true,writable:true,value:variants});
 }
}
const oldReads=before?reads(before):null,newReads=reads(after);
for(let i=0;i<WARMUP;i++){before?.api.battleAdvice(ctx);after.api.battleAdvice(ctx);}
function trial(implementation){
 const start=performance.now();
 for(let i=0;i<ITERATIONS;i++)implementation.api.battleAdvice(ctx);
 return(performance.now()-start)/ITERATIONS;
}
const oldTimes=[],newTimes=[];
for(let i=0;i<TRIALS;i++){
 // Alternate trial order to reduce a consistent first-run bias.
 if(i%2){newTimes.push(trial(after));if(before)oldTimes.push(trial(before));}
 else{if(before)oldTimes.push(trial(before));newTimes.push(trial(after));}
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const oldMs=before?median(oldTimes):null,newMs=median(newTimes);
console.log(JSON.stringify({
 benchmark:'field.battleAdvice',runtime:process.version,
 comparison:'synthetic fixture; isolated Node VM; median milliseconds per advice; not browser FPS or multi-user latency',
 differentialScenarios:before?DIFFERENTIAL_CASES:0,differentialSeed:SEED,
 fixture:{officers:ids.length,variants:ctx.state.officerVariants.length,army:ctx.state.army.length},
 ...(before?{before:oldReads}:{}),after:newReads,
 measurement:{warmup:WARMUP,trials:TRIALS,iterations:ITERATIONS,...(before?{medianBeforeMs:oldMs}:{}),medianAfterMs:newMs,...(before?{reductionPercent:(1-newMs/oldMs)*100}:{})}
},null,2));
