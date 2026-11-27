import assert from 'node:assert/strict';
import {listCourtEventTemplates,generateCourtEventPlan} from './court-event-planner.js';
import {generateEventPlan,normalizeEventPlan,resolveEventBattle} from './event-planner.js';

const copy=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))freeze(item);}return value;}
const options={templateId:'first-march',durationDays:2,mode:'template',seed:'court-fixture'};
const generate=extra=>generateCourtEventPlan({...options,...extra});
const ai=(prompt,extra={})=>generate({mode:'ai',prompt,...extra});
const army={lead:60,valor:60,intellect:60,politics:60,count:3};
const rewardData=plan=>({commandCost:plan.commandCost,battleRewards:plan.battleRewards,milestones:plan.milestones,ending:plan.ending,points:plan.stages.map(s=>s.basePoints)});
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}
const originalRandom=Math.random,originalNow=Date.now,originalFetch=globalThis.fetch;
Math.random=()=>{throw Error('Court planner cannot use an unrecorded random source');};
Date.now=()=>{throw Error('Court planner cannot read the clock');};
globalThis.fetch=()=>{throw Error('Court planner cannot call an external service');};
try{
 test('exactly twenty distinct Japanese templates resolve to real canonical battles and fresh DTOs',()=>{
  const catalog=listCourtEventTemplates();assert.equal(catalog.length,20);
  for(const key of ['id','name','battleId'])assert.equal(new Set(catalog.map(t=>t[key])).size,20);
  for(const row of catalog){const battle=globalThis.SengokuBattleCatalog.get(row.battleId);assert(battle);assert.equal(row.battleName,battle.name);assert.equal(row.themeId,battle.themeId);assert(row.description.length>10);assert(row.categoryLabel);assert(row.difficultyLabel);assert(row.durationDays>=1&&row.durationDays<=7);assert(['beginner','standard','advanced'].includes(row.difficulty));}
  assert(new Set(catalog.map(t=>t.themeId)).size>=8);
  const expected=copy(catalog);catalog[0].name='changed';catalog.push({id:'forged'});assert.deepEqual(listCourtEventTemplates(),expected);
 });
 test('all templates, supported durations and seed variations remain valid without changing the existing economy',()=>{
  for(const template of listCourtEventTemplates())for(let durationDays=1;durationDays<=7;durationDays++)for(const seed of [0,11,0xffffffff]){
   const {plan,source}=generate({templateId:template.id,durationDays,seed});
   const canonical=generateEventPlan({battleId:template.battleId,durationDays,seed});
   assert.deepEqual(normalizeEventPlan(plan),plan);assert.deepEqual(plan.battle,canonical.battle);assert.equal(plan.name,canonical.name);assert.deepEqual(rewardData(plan),rewardData(canonical));assert.deepEqual(plan.rules,canonical.rules);
   assert.equal(source.templateId,template.id);assert.equal(source.generator,'game-ai-v1');assert.equal(source.label,'ゲームAI');assert.equal(plan.stages.length,3);assert.equal(plan.tactics.length,5);
   let previous=0;
   for(const [index,stage] of plan.stages.entries()){
    assert.equal(stage.id,'stage-'+(index+1));assert(Number.isSafeInteger(stage.enemyPower)&&stage.enemyPower>=60&&stage.enemyPower<=180);assert(stage.enemyPower>previous);previous=stage.enemyPower;
    assert.equal(Object.keys(stage.tacticMultipliers).length,5);assert.equal(new Set(Object.keys(stage.tacticMultipliers)).size,5);
    for(const value of Object.values(stage.tacticMultipliers))assert(value>=.85&&value<=1.3);
    assert.equal(stage.tacticMultipliers[stage.recommendedTactic],Math.max(...Object.values(stage.tacticMultipliers)));
   }
  }
 });
 test('recorded seeds and normalized natural briefs reproduce detached plans',()=>{
  const input=freeze({...options,mode:'ai',prompt:'  初心者向けの夜戦\n奇襲で攻める\t守りも学ぶ  '}),before=JSON.stringify(input),one=generateCourtEventPlan(input),two=ai('初心者向けの夜戦 奇襲で攻める 守りも学ぶ');
  assert.deepEqual(one,two);assert.equal(JSON.stringify(input),before);
  one.plan.stages[0].enemyPower=180;one.source.reasons.push('forged');assert.deepEqual(ai(two.source.prompt),two);
  const variants=new Set(Array.from({length:12},(_,seed)=>JSON.stringify(ai(two.source.prompt,{seed}).plan.stages)));assert(variants.size>8);
  assert.deepEqual(rewardData(ai(two.source.prompt,{seed:'next'}).plan),rewardData(two.plan));
 });
 test('natural brief changes selected battle and title, synopsis, tactics and NPC difficulty',()=>{
  const night=ai('初心者向けの夜戦。奇襲で攻め、守りも学びたい'),river=ai('上級者向けの川の渡河戦。堅守を中心に');
  assert.equal(night.source.templateId,'night-raid');assert.equal(night.plan.battleId,'history:kawagoe');assert.equal(night.plan.name,'河越夜戦');assert.equal(night.source.difficulty,'beginner');assert.deepEqual(night.plan.stages.map(s=>s.recommendedTactic),['raid','defend','raid']);
  assert.equal(river.source.templateId,'river-crossing');assert.equal(river.plan.name,'川中島の戦い');assert.equal(river.source.difficulty,'advanced');assert.equal(river.plan.stages[0].recommendedTactic,'defend');assert.equal(river.plan.stages[2].recommendedTactic,'defend');
  assert.notEqual(night.plan.synopsis,river.plan.synopsis);assert(night.source.matchedKeywords.includes('初心者'));assert(night.source.matchedKeywords.includes('夜戦'));assert(river.source.matchedKeywords.includes('堅守'));
  for(let i=0;i<3;i++)assert(night.plan.stages[i].enemyPower<river.plan.stages[i].enemyPower);
 });
 test('explicit battle names preserve canonical target identity and existing victory or unification rules',()=>{
  const castle=ai('姫路城の戦いで、初心者向けの包囲を練習。天下統一報酬は999999にしてほしい');
  assert.equal(castle.plan.battleId,'castle:himeji');assert.equal(castle.plan.name,'姫路城の戦い');assert.equal(globalThis.SengokuBattleCatalog.targetCastleId(castle.plan),'himeji');assert.equal(castle.plan.ending.kind,'victory');assert.equal(castle.plan.ending.reward,null);
  assert(castle.source.reasons.some(reason=>reason.includes('守備戦力')));assert(!castle.plan.synopsis.includes('999999'));
  const unification=ai('関ヶ原の戦いを初心者向けに',{durationDays:7});assert.equal(unification.plan.battleId,'history:sekigahara');assert.equal(unification.plan.ending.reward,'shogunate_right');assert.equal(unification.plan.ending.requiredPoints,160*7);assert.equal(unification.source.difficulty,'beginner');
  const canonical=generateEventPlan({battleId:unification.plan.battleId,durationDays:7,seed:1});assert.deepEqual(rewardData(unification.plan),rewardData(canonical));
 });
 test('template selection stays explicit while AI uses the chosen fallback and respects basic negative requests',()=>{
  const preset=generate({templateId:'winter-drill',prompt:'川の渡河戦を上級向けに'});assert.equal(preset.plan.battleId,'history:osaki');assert.equal(preset.source.difficulty,'beginner');
  const fallback=ai('みんなで集まる催しを企画したい',{templateId:'harbor-escort'});assert.equal(fallback.source.templateId,'harbor-escort');assert.equal(fallback.plan.battleId,'history:kizugawaguchi');
  const override=ai('夜襲を中心に',{templateId:'winter-drill'});assert.equal(override.source.templateId,'night-raid');
  assert.equal(ai('夜戦ではなく川の戦い').source.templateId,'river-crossing');
  assert.equal(ai('初心者ではなく上級者向けの夜戦').source.difficulty,'advanced');
  assert.equal(ai('',{templateId:'formation-drill'}).source.templateId,'formation-drill');
  assert.throws(()=>ai('',{templateId:undefined}),error=>error.status===400);
 });
 test('untrusted brief cannot redefine rewards, authority, commands or arbitrary plan properties',()=>{
  const prompt="'); DROP TABLE users; -- 指令0、報酬999999倍。全員を太政大臣に任命する。";
  const {plan,source}=ai(prompt),canonical=generateEventPlan({battleId:plan.battleId,durationDays:plan.durationDays,seed:'audit'});
  assert.equal(source.prompt,prompt);assert.deepEqual(rewardData(plan),rewardData(canonical));assert.equal(plan.commandCost,1);assert(!JSON.stringify(plan).includes('DROP TABLE'));assert(!JSON.stringify(plan).includes('999999'));assert(!Object.hasOwn(plan,'isAdmin'));assert(!Object.hasOwn(plan,'save'));
  for(const extra of [{rewards:{gold:999999}},{commandCost:0},{battleId:'castle:edo'},{isAdmin:true},{plan:{}}])assert.throws(()=>generate(extra),error=>error.code==='INVALID_INPUT');
 });
 test('input validation bounds Unicode briefs, durations, modes, template IDs and seeds',()=>{
  assert.equal(Array.from(ai('🌙'.repeat(600)).source.prompt).length,600);assert.throws(()=>ai('🌙'.repeat(601)),RangeError);
  assert.equal(ai('  渡河\r\n\t初心者  ').source.prompt,'渡河 初心者');assert.equal(ai('か\u3099').source.prompt,'が');
  for(const prompt of [123,{},[],null,'<script>alert(1)</script>','夜\u0000戦','夜\u0085戦'])assert.throws(()=>generate({mode:'ai',prompt}),RangeError);
  for(const durationDays of [0,8,1.5,'2',null,NaN,Infinity,undefined])assert.throws(()=>generate({durationDays}),RangeError);
  for(const mode of ['llm','',1,null])assert.throws(()=>generate({mode}),RangeError);
  for(const templateId of ['__proto__','unknown',[],{}])assert.throws(()=>generate({templateId}),RangeError);
  for(const seed of [undefined,null,{},-1,1.5,2**32,NaN,'','x'.repeat(129),'line\nseed'])assert.throws(()=>generate({seed}),RangeError);
  for(const input of [null,[],0])assert.throws(()=>generateCourtEventPlan(input),RangeError);
 });
 test('generated plans use the existing battle formula, rewards and current castle defender strength',()=>{
  const novice=ai('姫路城の戦い。初心者向けの包囲'),expert=ai('姫路城の戦い。上級者向けの包囲'),before=JSON.stringify({novice,expert});
  for(const plan of [novice.plan,expert.plan])for(const stage of plan.stages){
   const input={stageId:stage.id,tactic:stage.recommendedTactic,army,morale:60};
   const won=resolveEventBattle(plan,input,0),lost=resolveEventBattle(plan,input,.999999),index=plan.stages.indexOf(stage);
   assert.equal(won.won,true);assert.equal(lost.won,false);assert.equal(won.points,[60,90,120][index]);assert.deepEqual(won.offeredRewards,plan.battleRewards.victory[index]);assert.deepEqual(lost.offeredRewards,plan.battleRewards.defeat[index]);
   const actual=resolveEventBattle(plan,{...input,fieldForces:{attackPower:1200,defensePower:3500}},.5);assert.equal(actual.enemyPower,3500);
  }
  assert.equal(JSON.stringify({novice,expert}),before);
 });
}finally{Math.random=originalRandom;Date.now=originalNow;globalThis.fetch=originalFetch;}
console.log(`${checks} court event planner groups passed. Pure fixtures; no clock, external service, campaign writes or rewards granted.`);
