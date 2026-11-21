import assert from 'node:assert/strict';
import {generateEventPlan,resolveEventBattle} from './event-planner.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;};
const army={lead:66,valor:61,intellect:68,politics:55,count:3};
const draft=(extra={})=>generateEventPlan({name:'青葉の野戦',durationDays:1,seed:'fixture_seed',...extra});
const battle=(plan,extra={},roll=.5)=>resolveEventBattle(plan,{stageId:'stage-1',tactic:'balanced',army:{...army},morale:65,...extra},roll);
let passed=0;function test(name,run){run();passed++;console.log('PASS '+name);}
const originalRandom=Math.random,originalNow=Date.now,originalFetch=globalThis.fetch;
Math.random=()=>{throw Error('Event AI cannot use an unrecorded random source');};Date.now=()=>{throw Error('Event AI cannot read wall-clock time');};globalThis.fetch=()=>{throw Error('Event AI cannot contact an external service');};
try{
test('identical normalized inputs reproduce a complete draft without shared mutable output',()=>{
  const a=draft(),b=draft();assert.deepEqual(a,b);assert.deepEqual(draft({name:'  Cafe\u0301の野戦  '}),draft({name:'Caféの野戦'}));
  a.tactics[0].name='changed';a.stages[0].tacticMultipliers.balanced=7;a.milestones[0].gift.gold=1;assert.deepEqual(draft(),b);
  assert.equal(b.schemaVersion,1);assert.equal(b.generator,'game-ai-v1');assert.equal(b.dailyAttempts,3);assert(b.rules.some(rule=>rule.includes('開催開始から24時間')));assert(b.rules.every(rule=>!rule.includes('運営')&&!rule.includes('スタッフ')));
});
test('title cues score terrain candidates while seeds vary a bounded three-stage challenge',()=>{
  for(const [name,theme]of [['草原の戦い','plain'],['峠の戦い','mountain'],['河川の戦い','river'],['城砦の戦い','castle'],['森林の戦い','forest'],['海浜の戦い','coast'],['雪氷の戦い','snow'],['夜闇の戦い','night']])assert.equal(draft({name}).theme.id,theme,name);
  const variants=new Set(Array.from({length:24},(_,seed)=>JSON.stringify(draft({name:'新しい合戦',seed}).stages)));assert(variants.size>12);
  const rewards=draft({seed:'one'}).milestones;assert.deepEqual(rewards,draft({seed:'another'}).milestones,'seed rerolls do not enlarge rewards');
});
test('one-to-seven day plans have three initially selectable stages and reachable ascending milestones',()=>{
  for(let days=1;days<=7;days++)for(let seed=0;seed<12;seed++){
    const plan=draft({durationDays:days,seed});assert.equal(plan.durationDays,days);assert.deepEqual(plan.stages.map(stage=>stage.id),['stage-1','stage-2','stage-3']);assert.equal(plan.milestones.length,3);
    let prior=0;for(const milestone of plan.milestones){assert(milestone.points>prior);prior=milestone.points;assert.deepEqual(Object.keys(milestone.gift).sort(),['gold','magatama','rice','stone','wood']);for(const value of Object.values(milestone.gift))assert(Number.isSafeInteger(value)&&value>=0);}
    const attempts=days*plan.dailyAttempts;assert(attempts*Math.floor(plan.stages[0].basePoints*.25)>=plan.milestones[0].points,'even failed basic attempts can reach the first milestone');assert(attempts*plan.stages[0].basePoints>=plan.milestones.at(-1).points,'basic-stage wins can reach the highest milestone');
    assert(plan.stages[0].enemyPower<plan.stages[1].enemyPower&&plan.stages[1].enemyPower<plan.stages[2].enemyPower);
    for(const stage of plan.stages){assert.equal(battle(plan,{stageId:stage.id},0).won,true);assert.equal(battle(plan,{stageId:stage.id},.999999).won,false);assert(Number.isSafeInteger(stage.enemyPower));assert(stage.enemyPower>=60&&stage.enemyPower<=180);}
  }
});
test('victory and defeat award bounded points with reproducible readable combat results',()=>{
  const plan=draft();for(const stage of plan.stages){const input={stageId:stage.id,tactic:stage.recommendedTactic};const won=battle(plan,input,0),lost=battle(plan,input,.999999);
    assert.equal(won.points,stage.basePoints);assert.equal(lost.points,Math.floor(stage.basePoints*.25));assert(won.points>lost.points&&lost.points>0);assert.deepEqual(won,battle(plan,input,0));
    for(const result of [won,lost]){assert.equal(result.stageId,stage.id);assert.equal(result.enemyName,stage.enemyName);assert.equal(result.enemyPower,stage.enemyPower);assert.equal(result.tactic,stage.recommendedTactic);assert.equal(result.log.length,4);assert(result.log.every(line=>typeof line==='string'&&line.length>0));assert(result.summary.includes('戦功'+result.points+'点'));assert(result.winChance>=10&&result.winChance<=96);assert(Number.isSafeInteger(result.playerPower)&&result.playerPower>0);assert(!Object.hasOwn(result,'gift'));assert(!Object.hasOwn(result,'save'));}
  }
});
test('terrain hints help balanced armies and each tactic evaluates the matching officer abilities',()=>{
  const plan=draft({name:'林の戦い'}),equal={lead:60,valor:60,intellect:60,politics:60,count:3};
  for(const stage of plan.stages){const candidates=plan.tactics.map(tactic=>battle(plan,{stageId:stage.id,tactic:tactic.id,army:equal},.5));const recommended=candidates.find(row=>row.tactic===stage.recommendedTactic);assert(candidates.every(row=>recommended.playerPower>=row.playerPower),'the terrain recommendation should help an evenly skilled army');}
  const strong={...equal,valor:100,intellect:20},cunning={...equal,valor:20,intellect:100};assert(battle(plan,{army:strong,tactic:'charge'}).playerPower>battle(plan,{army:cunning,tactic:'charge'}).playerPower);assert(battle(plan,{army:cunning,tactic:'raid'}).playerPower>battle(plan,{army:strong,tactic:'raid'}).playerPower);
  assert(battle(plan,{morale:100}).playerPower>=battle(plan,{morale:0}).playerPower);assert(battle(plan,{army:{...equal,count:3}}).playerPower>=battle(plan,{army:{...equal,count:0}}).playerPower);
});
test('role flags, special effects and excessive stats confer no advantage beyond the common caps',()=>{
  const plan=draft(),capped={lead:100,valor:100,intellect:100,politics:100,count:3};
  const regular=battle(plan,{army:capped,morale:100}),excessive=battle(plan,{army:{lead:100000,valor:10000,intellect:1000,politics:101,count:99,skill:'exclusive',isAdmin:true,isStaff:true},morale:999,isAdmin:true,home:'edo'});assert.deepEqual(excessive,regular);
  assert.equal(JSON.stringify(excessive).includes('exclusive'),false);assert.equal(JSON.stringify(excessive).includes('isAdmin'),false);
});
test('generation and NPC resolution leave saved armies and the approved plan unchanged',()=>{
  const plan=freeze(draft()),input=freeze({stageId:'stage-3',tactic:'siege',army:copy(army),morale:50,save:{resources:{gold:100},troops:1000,home:'kiyosu',castles:{kiyosu:{owner:'織田家'}}}}),before=JSON.stringify({plan,input});
  resolveEventBattle(plan,input,.2);resolveEventBattle(plan,input,.8);assert.equal(JSON.stringify({plan,input}),before);
});
test('invalid titles, durations and seeds fail without inventing defaults',()=>{
  for(const name of [undefined,null,1,'','  ','a'.repeat(61),'戦い\n開催','戦い\u0000'])assert.throws(()=>draft({name}));assert.equal(Array.from(draft({name:'🏯'.repeat(60)}).name).length,60);
  for(const durationDays of [0,8,1.5,'1',NaN,Infinity,null])assert.throws(()=>draft({durationDays}));
  for(const seed of [undefined,null,{},-1,1.5,2**32,NaN,'','x'.repeat(129),'a\n'])assert.throws(()=>draft({seed}));assert(draft({seed:0}));assert(draft({seed:0xffffffff}));
});
test('invalid battle selections, unbounded plans and malformed stats or rolls are rejected',()=>{
  const plan=draft();for(const stageId of ['',null,'stage-4','__proto__'])assert.throws(()=>battle(plan,{stageId}));for(const tactic of ['',null,'assault','__proto__'])assert.throws(()=>battle(plan,{tactic}));
  for(const roll of [-.1,1,Infinity,NaN,'0',null,undefined])assert.throws(()=>resolveEventBattle(plan,{stageId:'stage-1',tactic:'balanced',army,morale:60},roll));
  for(const value of [NaN,Infinity,-1,'80',null,undefined])for(const key of ['lead','valor','intellect','politics','count'])assert.throws(()=>battle(plan,{army:{...army,[key]:value}}));assert.throws(()=>battle(plan,{army:{...army,count:1.5}}));
  for(const morale of [NaN,Infinity,-1,'80',null,undefined])assert.throws(()=>battle(plan,{morale}));
  for(const mutate of [p=>{p.schemaVersion=2;},p=>{p.dailyAttempts=100;},p=>{p.stages[0].enemyPower=-1;},p=>{p.stages[0].enemyPower=1e10;},p=>{p.stages[0].basePoints=999999;},p=>{p.stages[0].tacticMultipliers.balanced=Infinity;},p=>{p.stages[0].tacticMultipliers.balanced=2;},p=>{p.stages[1].id='stage-1';},p=>{p.milestones[0].gift.magatama=1e9;},p=>{p.milestones[0].points=0;}]){const bad=copy(plan);mutate(bad);assert.throws(()=>battle(bad));}
});
}finally{Math.random=originalRandom;Date.now=originalNow;globalThis.fetch=originalFetch;}
console.log(`${passed} event planner groups passed. Fixtures only; no clocks, external calls, campaign writes or reward grants.`);
