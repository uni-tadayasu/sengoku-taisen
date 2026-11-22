'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Advisor=require('../battle-advisor.js'),Roaming=require('../roaming.js');
const {SengokuEngine:Engine}=require('../engine.js'),{setup}=require('./helpers/dom-model.cjs');
const rosterContext={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),rosterContext);
const game=()=>new Engine({officers:rosterContext.window.SENGOKU_OFFICERS,seed:17});
const choice=(extra={})=>({ok:true,tactic:'balanced',tacticName:'正攻法',troops:1000,winChance:90,estimatedLoss:100,foodCost:450,...extra});
let count=0;
async function test(name,run){await run();count++;console.log('PASS '+name);}

(async()=>{
 await test('comparison uses only legal preview candidates without changing their data',()=>{
  const candidates=[choice(),choice({tactic:'ambush',tacticName:'伏兵',winChance:91,estimatedLoss:80}),choice({ok:false,tactic:'siege',winChance:100,estimatedLoss:0}),choice({tactic:'invalid',winChance:NaN})],before=JSON.stringify(candidates);
  const advice=Advisor.compare(candidates,{style:'balanced',targetName:'敵陣'});
  assert.equal(advice.tactic,'ambush');assert.equal(advice.targetName,'敵陣');assert.equal(advice.recommendation,'attack');assert.equal(JSON.stringify(candidates),before);assert(!advice.alternatives.some(a=>['siege','invalid'].includes(a.tactic)));
  assert.equal(Advisor.compare([{...choice(),ok:false}]).ok,false);
  const weak=Advisor.compare([choice({winChance:20}),choice({tactic:'assault',winChance:40,estimatedLoss:300})]);assert.equal(weak.tactic,'assault');assert.equal(weak.recommendation,'prepare');assert.equal(weak.caution,true);
 });

 await test('the shared panel escapes all user-controlled labels and action attributes',()=>{
  const {host}=setup(),attack='\"><img src=x onerror=alert(1)><script>alert(1)</script>';
  host.innerHTML=Advisor.markup({...choice(),targetName:attack,tacticName:attack,reasons:[attack],alternatives:[choice({tacticName:attack})]},{action:attack,costLabel:attack,costShortLabel:attack,note:attack,applyLabel:attack});
  assert.equal(host.querySelectorAll('img,script').length,0);assert.equal(host.querySelectorAll('[onerror],[onclick]').length,0);assert(host.textContent.includes(attack));assert.equal(host.querySelector('[data-battle-advisor-action]').dataset.battleAdvisorAction,attack);
 });

 await test('fixed armies omit unavailable troop and loss metrics and tournament costs are named correctly',()=>{
  const {host}=setup();host.innerHTML=Advisor.markup({ok:true,tactic:'ambush',tacticName:'伏兵',winChance:80,reasons:['軍団の知略が有効です。']},{showStyles:false});
  assert.equal(host.querySelector('[data-battle-advisor-style]'),null);assert(!host.textContent.includes('出陣兵数'));assert(!host.textContent.includes('予想損失'));assert(host.textContent.includes('80%'));
  host.innerHTML=Advisor.markup({...choice(),alternatives:[choice({tactic:'siege'})]},{costLabel:'必要物資',costShortLabel:'物資'});assert(host.textContent.includes('必要物資'));assert(host.textContent.includes('物資450'));assert(!host.textContent.includes('消費兵糧'));
 });

 await test('adoption evaluates the latest advice and never adopts an unavailable or disabled proposal',()=>{
  const {host}=setup();let live=choice(),applied=[],unavailable=0,styles=[];
  Advisor.render(host,live,{action:'test-apply'});
  const binding=Advisor.bind(host,{action:'test-apply',getAdvice:()=>live,onApply:a=>applied.push(a),onUnavailable:()=>unavailable++,onStyleChange:style=>styles.push(style)});
  live=choice({tactic:'ambush',troops:700});host.querySelector('button').dispatchEvent({type:'click'});assert.equal(applied.length,1);assert.equal(applied[0].troops,700);assert.equal(applied[0].tactic,'ambush');
  live={ok:false,message:'指令が不足しています。'};host.querySelector('button').dispatchEvent({type:'click'});assert.equal(applied.length,1);assert.equal(unavailable,1);
  Advisor.render(host,live,{action:'test-apply'});assert.equal(host.querySelector('button').disabled,true);host.querySelector('button').dispatchEvent({type:'click'});assert.equal(unavailable,1);
  const select=host.querySelector('select');select.value='conserve';select.dispatchEvent({type:'change'});assert.deepEqual(styles,['conserve']);
  binding.dispose();live=choice();Advisor.render(host,live,{action:'test-apply'});host.querySelector('button').dispatchEvent({type:'click'});assert.equal(applied.length,1);
 });

 await test('background advice updates retain the focused selector, apply button and scroll position',()=>{
  const previous=global.SengokuStableDOM;global.SengokuStableDOM=require('../stable-dom.js');
  try{
   const {host,doc}=setup();Advisor.render(host,choice());const select=host.querySelector('select'),button=host.querySelector('button');select.focus();host.scrollTop=120;
   Advisor.render(host,choice({troops:1100,foodCost:480}));assert.equal(host.querySelector('select'),select);assert.equal(host.querySelector('button'),button);assert.equal(doc.activeElement,select);assert.equal(host.scrollTop,120);assert(host.textContent.includes('1,100人'));
  }finally{global.SengokuStableDOM=previous;}
 });

 await test('the CPU and branch modal integration applies inputs without executing a battle',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),start=source.indexOf("  let battleAdviceStyle='balanced'"),end=source.indexOf('  function battleModal(',start);assert(start>=0&&end>start);
  for(const branch of [false,true]){
   const g=game();if(branch){g.state.castles.sakamoto.owner=g.state.clan;g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false}];}
   const before=JSON.stringify(g.state);let callbacks=null,updates=0,requests=0;
   g.attack=()=>{requests++;throw Error('Adoption cannot execute a battle');};g.attackBranch=g.attack;
   const nodes={'#battle-advisor-slot':{},'#battle-tactic':{value:'balanced'}},context={game:g,battleBranchTarget:branch?'nijo_north':'',battleTarget:branch?'nijo':'inuyama',battleTactic:'balanced',battleTroops:3400,activeModal:'battle',$:selector=>nodes[selector],updateBattlePreview:()=>updates++,toast(){},window:{SengokuBattleAdvisor:{render(){},bind(_host,options){callbacks=options;return{dispose(){}};}}}};
   vm.createContext(context);vm.runInContext(source.slice(start,end),context);vm.runInContext('mountBattleAdvisor()',context);const expected=callbacks.getAdvice();assert.equal(expected.ok,true);callbacks.onApply(expected);
   assert.equal(context.battleTactic,expected.tactic);assert.equal(context.battleTroops,expected.troops);assert.equal(nodes['#battle-tactic'].value,expected.tactic);assert.equal(updates,1);assert.equal(requests,0);assert.equal(JSON.stringify(g.state),before);
   callbacks.onStyleChange('rapid');assert.equal(callbacks.getAdvice().style,'rapid');context.activeModal='';assert.equal(callbacks.getAdvice(),null);callbacks.onApply(expected);assert.equal(updates,1);
  }
 });

 await test('roaming advice changes preparation only and clears any previous confirmation',async()=>{
  const g=game(),records=new Map(),storage={getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};let requests=0;
  const controller=Roaming.createController({getGame:()=>g,getStatus:()=>({writable:true,online:true,linked:false,ownerId:'tester'}),storage,battle:async()=>{requests++;throw Error('Adoption must not submit a battle');},uuid:()=> 'new-request'});
  const unit=controller.snapshot().units.find(u=>u.available);assert(unit);assert.equal(controller.select(unit.unitId),true);
  const stateBefore=JSON.stringify(g.state),advice=controller.advise();assert.equal(advice.ok,true);
  assert.equal(controller.prepare(),true);assert(controller.snapshot().confirmation);
  assert.equal(controller.applyAdvice(),true);const s=controller.snapshot();assert.equal(s.tactic,advice.tactic);assert.equal(Number(s.troopsInput),advice.troops);assert.equal(s.confirmation,null);assert.equal(s.pending,null);assert.equal(requests,0);assert.equal(JSON.stringify(g.state),stateBefore);
  assert.equal(await controller.submit(),false);assert.equal(requests,0,'An adoption must still pass the ordinary confirmation');
  assert.equal(controller.prepare(),true);assert.equal(controller.setAdviceStyle('conserve'),true);assert.equal(controller.snapshot().confirmation,null);assert.equal(controller.snapshot().advice.style,'conserve');assert.equal(JSON.stringify(g.state),stateBefore);controller.dispose();
 });

 await test('roaming adoption rechecks resources and account identity before changing inputs',()=>{
  let g=game(),ownerId='first';const controller=Roaming.createController({getGame:()=>g,getStatus:()=>({writable:true,linked:false,ownerId})});
  const unit=controller.snapshot().units.find(u=>u.available);controller.select(unit.unitId);assert.equal(controller.advise().ok,true);
  const oldTroops=controller.snapshot().troopsInput;g.state.resources.rice=0;assert.equal(controller.applyAdvice(),false);assert.equal(controller.snapshot().troopsInput,oldTroops);assert.match(controller.snapshot().error,/兵糧/);
  g=game();ownerId='second';assert.equal(controller.applyAdvice(),false);assert.equal(controller.snapshot().selectedUnitId,'');assert.equal(controller.snapshot().confirmation,null);controller.dispose();
 });

 await test('a pending roaming receipt locks military advice until its result is resolved',()=>{
  const g=game(),config=Engine.roamingDeploymentDefaults(),unit=Engine.roamingDeploymentUnits(config,g.state.home)[0],campaignId=g.state.walking.campaignId,record={ownerId:'tester',campaignId,data:{encounterId:unit.encounterId,tactic:'balanced',requestId:'pending-battle',campaignId,sequence:0,troops:1000,unitId:unit.unitId,castleId:unit.castleId,deploymentRevision:unit.deploymentRevision}};
  const controller=Roaming.createController({getGame:()=>g,getStatus:()=>({writable:true,linked:false,ownerId:'tester'}),storage:{getItem:()=>JSON.stringify(record)}});
  assert(controller.snapshot().pending);assert.equal(controller.applyAdvice(),false);assert.equal(controller.setAdviceStyle('rapid'),false);assert.equal(controller.snapshot().tactic,'balanced');assert.equal(controller.snapshot().troopsInput,'1000');controller.dispose();
 });

 console.log(`Battle advisor UI: ${count} tests passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
