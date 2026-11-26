'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {SengokuEngine:Engine,SENGOKU_DATA:catalog}=require('../engine.js');
const planner=require('../command-center.js');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../command-center.js'),'utf8');
const makeGame=()=>new Engine({seed:38,clan:'織田家'});
const clock={elapsedMs:0,realNowMs:100000,running:true,speed:1};
const balances=(game,values={})=>{game.state.resources={gold:0,rice:0,wood:0,stone:0,...values};return game;};
const estimate=(game,target,rates={},time=clock)=>planner.buildBudget(game,target,{catalog,income:{net:{gold:0,rice:0,wood:0,stone:0,...rates}},clock:time});
let checks=0;const test=(name,run)=>{run();checks++;console.log('PASS '+name);};

test('real facility and research plans read costs without touching resources, commands or jobs',()=>{
  const game=makeGame(),before=JSON.stringify(game.state);
  for(let n=0;n<20;n++){
    const goal=planner.budgetGoal(game,{kind:'building',id:'farm'},{catalog});
    assert.deepEqual(goal.targets,game.costs('farm'));assert.match(goal.title,/田畑 Lv.3/);
    const budget=planner.buildBudget(game,goal.targets,{catalog,clock});assert.equal(budget.status,'ready');
    const research=planner.budgetGoal(game,{kind:'research',id:'cultivation'},{catalog});assert.deepEqual(research.targets,game.researchCost('cultivation'));
  }
  assert.equal(JSON.stringify(game.state),before);
});
test('facility reservations advance the target and keep the full scaled price',()=>{
  const game=makeGame();game.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};
  assert(game.upgrade('farm').ok);assert(game.upgrade('farm').ok);
  const before=JSON.stringify(game.state),goal=planner.budgetGoal(game,{kind:'building',id:'farm'},{catalog});
  assert.match(goal.title,/Lv.5/);assert.deepEqual(goal.targets,game.costs('farm',4));assert.match(goal.note,/予約済み/);
  assert.equal(JSON.stringify(game.state),before);
});
test('completed levels, unknown targets and already-running research do not quote stale costs',()=>{
  const game=makeGame();game.state.buildings.farm=32;
  assert(planner.budgetGoal(game,{kind:'building',id:'farm'},{catalog}).unavailable);
  assert(planner.budgetGoal(game,{kind:'building',id:'no_such_id'},{catalog}).unavailable);
  assert(planner.budgetGoal(game,{kind:'constructor',id:'farm'},{catalog}).unavailable);
  assert(game.research('cultivation').ok);
  assert.match(planner.budgetGoal(game,{kind:'research',id:'cultivation'},{catalog}).title,/研究中/);
});
test('shared-court costs stay unavailable until the supplied readiness gate confirms them',()=>{
  let quoted=0;const game=makeGame();
  const staff={isStaff:true,state:game.state,constructionJobs:()=>[],costs(){quoted++;return game.costs('farm');},buildingUnlock:()=>({ok:true})};
  assert(planner.budgetGoal(staff,{kind:'building',id:'farm'},{catalog}).unavailable);assert.equal(quoted,0);
  const goal=planner.budgetGoal(staff,{kind:'building',id:'farm'},{catalog,staffReady:true});assert.equal(quoted,1);assert.match(goal.note,/本人の資源/);
});
test('multiple shortages use the slowest resource and honor each supported speed',()=>{
  const game=balances(makeGame(),{gold:100});
  for(const speed of [1,2,4]){
    const result=estimate(game,{gold:200,wood:100},{gold:100,wood:25},{...clock,speed});
    assert.equal(result.status,'waiting');assert.equal(result.waitMs,240000/speed);assert.match(result.detail,/木材/);
  }
});
test('zero and negative income are never presented as a countdown',()=>{
  const game=balances(makeGame());
  for(const rate of [0,-20]){const result=estimate(game,{gold:100},{gold:rate});assert.equal(result.status,'blocked');assert.equal(result.waitMs,null);assert.match(result.detail,/金銭/);}
});
test('a declining resource must remain sufficient when all other resources finally arrive',()=>{
  const game=balances(makeGame(),{gold:200});
  const impossible=estimate(game,{gold:100,wood:100},{gold:-100,wood:25});assert.equal(impossible.status,'expires');assert.equal(impossible.waitMs,null);
  const fits=estimate(game,{gold:100,wood:25},{gold:-100,wood:25});assert.equal(fits.status,'waiting');assert.equal(fits.waitMs,60000);
  const noGoldNeeded=estimate(game,{gold:0,wood:100},{gold:-100,wood:25});assert.equal(noGoldNeeded.status,'waiting');assert.equal(noGoldNeeded.waitMs,240000);
});
test('paused time suppresses estimates but keeps already-funded budgets funded',()=>{
  const game=balances(makeGame(),{gold:100});
  assert.equal(estimate(game,{gold:200},{gold:100},{...clock,running:false}).status,'paused');
  const ready=estimate(game,{gold:100},{gold:-100},{...clock,running:false});assert.equal(ready.status,'ready');assert.match(ready.detail,/資源だけ/);
});
test('invalid target inputs and costs above the real asset cap remain visibly blocked',()=>{
  const game=balances(makeGame(),{gold:catalog.assetCap});
  for(const raw of [-1,1.5,'abc',Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(estimate(game,{gold:raw}).status,'invalid');
  const costly=estimate(game,{gold:catalog.assetCap+1},{gold:10000});assert.equal(costly.status,'cap');assert.equal(costly.rows[0].target,catalog.assetCap+1);
  assert.equal(estimate(game,{gold:''}).status,'ready');assert.equal(estimate(game,{gold:catalog.assetCap}).status,'ready');
});
test('forecasts apply the displayed net rate and clamp to real balance bounds',()=>{
  const game=balances(makeGame(),{gold:catalog.assetCap-10,wood:30});
  const result=estimate(game,{}, {gold:100,wood:-20,rice:15});
  assert.deepEqual(result.rows.find(row=>row.key==='gold').after,[catalog.assetCap,catalog.assetCap,catalog.assetCap]);
  assert.deepEqual(result.rows.find(row=>row.key==='wood').after,[10,0,0]);
  assert.deepEqual(result.rows.find(row=>row.key==='rice').after,[15,45,90]);
  assert.equal(result.militaryDeficit,false);assert.equal(estimate(game,{}, {rice:-1}).militaryDeficit,true);
});
test('a caller-supplied income projection is reused and neither target nor state is changed',()=>{
  const game=makeGame(),target={gold:12000,wood:12000},before=JSON.stringify({state:game.state,target});
  game.income=()=>{throw Error('unneeded duplicate calculation');};estimate(game,target,{gold:100,wood:40});
  assert.equal(JSON.stringify({state:game.state,target}),before);
});

function mount(){
  const {doc,host}=setup();doc.getElementById=id=>doc.querySelector('#'+id);
  const create=doc.createElement.bind(doc);doc.createElement=name=>{const node=create(name);Object.defineProperty(node,'className',{get:()=>node.getAttribute('class')||'',set:value=>node.setAttribute('class',value)});return node;};
  let game=makeGame(),currentClock=clock,subscribed=0,unsubscribed=0;const listeners=new Set(),navigated=[];
  const win={document:doc,SENGOKU_DATA:catalog,SengokuTravelUI:{subscribe(fn){subscribed++;listeners.add(fn);fn({active:[]},currentClock);return()=>{unsubscribed++;listeners.delete(fn);};}},setTimeout(){throw Error('No planner timeout');},setInterval(){throw Error('No planner polling');}};
  vm.runInNewContext(source,{window:win});host.innerHTML='<button id="budget-launch">資源計画を開く</button>';const launch=host.querySelector('button');launch.focus();
  const options={getGame:()=>game,navigate:value=>navigated.push(value)};
  return {doc,win,launch,options,navigated,get game(){return game;},setGame(value){game=value;},get ui(){return win.SengokuCommandCenter;},get dialog(){return doc.querySelector('.resource-plan-dialog');},get counts(){return{subscribed,unsubscribed,listeners:listeners.size};},open(extra={}){return win.SengokuCommandCenter.openPlanner({...options,...extra});},emit(time=currentClock){currentClock=time;for(const fn of [...listeners])fn({active:[]},time);}};
}
test('live custom-budget updates preserve typed digits, focus, scroll and open forecast',()=>{
  const h=mount();h.open({kind:'custom'});const dialog=h.dialog,input=dialog.querySelector('[data-budget-target="gold"]'),scroll=dialog.querySelector('.resource-plan-scroll'),forecast=dialog.querySelector('details');
  input.value='012000';input.focus();input.dispatchEvent({type:'input'});scroll.scrollTop=210;forecast.open=true;
  const before=JSON.stringify(h.game.state);for(let n=0;n<10;n++)h.emit();
  assert.equal(input.value,'012000');assert.equal(h.doc.activeElement,input);assert.equal(scroll.scrollTop,210);assert.equal(forecast.open,true);assert.equal(JSON.stringify(h.game.state),before);
  input.value='1.5';input.dispatchEvent({type:'input'});assert.equal(input.getAttribute('aria-invalid'),'true');assert.equal(dialog.querySelector('[data-budget-summary]').dataset.state,'invalid');
  h.ui.closePlanner();assert.equal(h.counts.listeners,0);assert.equal(h.doc.activeElement,h.launch);
});
test('switching from a preset back to custom restores the exact custom draft',()=>{
  const h=mount();h.open({kind:'custom'});const dialog=h.dialog,choice=dialog.querySelector('[data-budget-choice]'),input=dialog.querySelector('[data-budget-target="gold"]');
  input.value='12345';input.dispatchEvent({type:'input'});choice.value='building:farm';choice.dispatchEvent({type:'change'});assert.equal(input.value,String(h.game.costs('farm').gold));assert.equal(input.readOnly,true);
  choice.value='custom';choice.dispatchEvent({type:'change'});assert.equal(input.value,'12345');assert.equal(input.readOnly,false);assert.equal(dialog.querySelector('[data-budget-goal]').textContent,'自由な予算');h.ui.closePlanner();
});
test('preset costs track new reservations without replacing focused controls',()=>{
  const h=mount();h.open({kind:'building',id:'farm'});const input=h.dialog.querySelector('[data-budget-target="gold"]'),choice=h.dialog.querySelector('[data-budget-choice]');choice.focus();
  const old=input.value;assert(h.game.upgrade('farm').ok);h.emit();assert.notEqual(input.value,old);assert.equal(input.value,String(h.game.costs('farm').gold));assert.equal(h.doc.activeElement,choice);h.ui.closePlanner();
});
test('navigation and account changes release the shared subscription before leaving',()=>{
  const h=mount();h.open();h.dialog.querySelector('[data-budget-go="research"]').dispatchEvent({type:'click'});assert.deepEqual(h.navigated,['research']);assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);
  h.open();const next=makeGame();next.state.walking.campaignId='new_campaign';h.setGame(next);h.emit();assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);
  let access={playerId:'one',epoch:1};h.win.SengokuSocial={getExpansionContext:()=>access};h.open();access={playerId:'two',epoch:2};h.emit();assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);
});
test('operations and planner dialogs never retain simultaneous subscriptions',()=>{
  const h=mount();h.open();assert.equal(h.counts.listeners,1);h.ui.open(h.options);assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,1);
  h.open();assert.equal(h.doc.querySelector('.command-activity-dialog:not(.resource-plan-dialog)').open,false);assert.equal(h.counts.listeners,1);h.ui.closePlanner();assert.equal(h.counts.listeners,0);
});
test('a delayed close event cannot tear down a reopened planner session',()=>{
  const h=mount();h.open();const dialog=h.dialog,queued=[];dialog.close=()=>{dialog.open=false;queued.push(()=>dialog.dispatchEvent({type:'close',bubbles:false}));};
  h.open({kind:'custom'});queued.shift()();assert.equal(dialog.open,true);assert.equal(h.counts.listeners,1);
  h.ui.closePlanner();queued.shift()();assert.equal(h.counts.listeners,0);assert.equal(h.doc.activeElement,h.launch);
});
test('Escape closes only the planner and preserves an underlying detail refresh context',()=>{
  const h=mount();let activeModal='building';h.doc.body.addEventListener('keydown',event=>{if(event.key==='Escape')activeModal='';});
  h.open();const input=h.dialog.querySelector('[data-budget-target="gold"]');
  const event={type:'keydown',key:'Escape',stopPropagation(){this.bubbles=false;}};input.dispatchEvent(event);
  assert.equal(activeModal,'building');assert.notEqual(event.defaultPrevented,true,'Native dialog cancellation remains available');
  h.dialog.dispatchEvent({type:'cancel',bubbles:false});assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);assert.equal(activeModal,'building');
});
test('title-screen rejection returns the listener and backdrop dismissal spends nothing',()=>{
  const h=mount();h.win.SENGOKU_AT_TITLE=true;assert.equal(h.open(),false);assert.equal(h.counts.listeners,0);
  h.win.SENGOKU_AT_TITLE=false;h.open();const before=JSON.stringify(h.game.state);h.dialog.dispatchEvent({type:'click',clientX:-5,clientY:-5});assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);assert.equal(JSON.stringify(h.game.state),before);
});
test('untrusted catalog names remain text in the goal and selection controls',()=>{
  const h=mount(),copy={...catalog,buildings:catalog.buildings.map(row=>row.id==='farm'?{...row,name:'<img src=x onerror=alert(1)>'}:row)};
  h.open({kind:'building',id:'farm',catalog:copy});assert.equal(h.dialog.querySelector('img,script'),null);assert.match(h.dialog.querySelector('[data-budget-goal]').textContent,/<img src=x onerror=alert\(1\)>/);h.ui.closePlanner();
});
console.log(checks+' resource planning checks passed. No campaign writes or network requests.');
