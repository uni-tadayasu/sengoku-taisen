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
test('combined plans sum real next-stage costs, deduplicate goals and leave campaign state untouched',()=>{
  const game=makeGame(),selections=[{kind:'building',id:'farm'},{kind:'building',id:'market'},{kind:'research',id:'cultivation'},{kind:'building',id:'farm'}];
  const before=JSON.stringify({state:game.state,selections}),plan=planner.combinedBudgetGoal(game,selections,{catalog});
  assert.equal(plan.items.length,3);assert.equal(plan.unavailable,false);
  for(const key of ['gold','rice','wood','stone'])assert.equal(plan.targets[key],(game.costs('farm')[key]||0)+(game.costs('market')[key]||0)+(game.researchCost('cultivation')[key]||0));
  assert.match(plan.note,/次の1段階/);assert.equal(JSON.stringify({state:game.state,selections}),before);
});
test('plans never label partial totals affordable when any selected goal is unavailable',()=>{
  const game=makeGame();game.state.buildings.farm=32;
  for(const selected of [[{kind:'building',id:'farm'},{kind:'building',id:'market'}],[{kind:'building',id:'unknown'}],[{kind:'constructor',id:'farm'}],null,[]]){
    assert.equal(planner.combinedBudgetGoal(game,selected,{catalog}).unavailable,true);
  }
  assert.equal(planner.combinedBudgetGoal(game,Array.from({length:9},(_,i)=>({kind:'building',id:catalog.buildings[i].id})),{catalog}).unavailable,true);
  const shared={isStaff:true,state:makeGame().state,costs(){throw Error('Unconfirmed shared costs must not be read');}};
  assert.equal(planner.combinedBudgetGoal(shared,[{kind:'building',id:'farm'}],{catalog}).unavailable,true);
});
test('a new reservation updates the planned next level and completed research is quoted again',()=>{
  const game=makeGame();game.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};
  const selections=[{kind:'building',id:'farm'},{kind:'research',id:'cultivation'}];
  const original=planner.combinedBudgetGoal(game,selections,{catalog});assert(game.upgrade('farm').ok);
  const next=planner.combinedBudgetGoal(game,selections,{catalog});assert.match(next.items[0].title,/Lv.4/);assert.notEqual(next.targets.gold,original.targets.gold);
  assert(game.research('cultivation').ok);const blocked=planner.combinedBudgetGoal(game,selections,{catalog});assert.equal(blocked.unavailable,true);assert.match(blocked.items[1].title,/研究中/);
  game.state.jobs=game.state.jobs.filter(job=>job.kind!=='research');game.state.tech.cultivation=1;
  const completed=planner.combinedBudgetGoal(game,selections,{catalog});assert.equal(completed.unavailable,false);assert.match(completed.items[1].title,/Lv.2/);
});
test('reserves remain after spending and are included in shortages, wait times and capacity checks',()=>{
  const game=balances(makeGame(),{gold:100}),targets={gold:80},reserve={gold:120};
  const before=JSON.stringify({state:game.state,targets,reserve});
  const result=planner.buildBudget(game,targets,{catalog,clock,income:{gold:50},reserve});
  assert.equal(result.status,'waiting');assert.equal(result.waitMs,120000);assert.equal(result.rows[0].target,80);assert.equal(result.rows[0].reserve,120);assert.equal(result.rows[0].required,200);assert.equal(result.rows[0].deficit,100);
  const ready=planner.buildBudget(game,{gold:80},{catalog,clock,income:{gold:50},reserve:{gold:20}});assert.equal(ready.status,'ready');assert.match(ready.title,/備蓄/);
  assert.equal(planner.buildBudget(game,{gold:catalog.assetCap},{catalog,clock,reserve:{gold:1}}).status,'cap');
  assert.equal(JSON.stringify({state:game.state,targets,reserve}),before);
});
test('declining reserves can expire before another resource arrives, even with zero planned cost',()=>{
  const game=balances(makeGame(),{gold:200});
  const blocked=planner.buildBudget(game,{wood:100},{catalog,clock,income:{gold:-100,wood:25},reserve:{gold:100}});
  assert.equal(blocked.status,'expires');assert.equal(blocked.waitMs,null);
  const paused=planner.buildBudget(game,{wood:100},{catalog,clock:{...clock,running:false},income:{gold:100,wood:25},reserve:{gold:300}});
  assert.equal(paused.status,'paused');assert.equal(paused.rows[0].deficit,100);
  for(const value of [-1,1.5,'abc',Infinity,Number.MAX_SAFE_INTEGER+1])assert.equal(planner.buildBudget(game,{}, {catalog,clock,reserve:{gold:value}}).status,'invalid');
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
  const h=mount();h.open({kind:'custom'});const dialog=h.dialog,input=dialog.querySelector('[data-budget-target="gold"]'),scroll=dialog.querySelector('.resource-plan-scroll'),forecast=dialog.querySelector('.resource-plan-forecast');
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
test('the selected facility or research opens its exact current detail after the planner releases its listener',()=>{
  for(const [kind,id,completed]of [['building','farm',false],['building','farm',true],['research','cultivation',false],['research','cultivation',true]]){
    const h=mount(),opened=[];if(completed){if(kind==='building')h.game.state.buildings[id]=32;else h.game.state.tech[id]=5;}
    const before=JSON.stringify(h.game.state);h.open({kind,id,openOperation(target){assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);opened.push(JSON.parse(JSON.stringify(target)));return true;}});
    const button=h.dialog.querySelector('[data-budget-open-target]');assert.equal(button.hidden,false);assert.equal(button.disabled,false);assert.match(button.textContent,kind==='building'?/田畑.*詳細/:/研究を見る/);button.dispatchEvent({type:'click'});
    assert.deepEqual(opened,[{kind,id,shared:false}]);assert.deepEqual(h.navigated,[]);assert.equal(JSON.stringify(h.game.state),before);
  }
});
test('shared targets keep their scope and unavailable routing falls back only to the matching read-only screen',()=>{
  const shared=mount(),opened=[];Object.defineProperty(shared.game,'isStaff',{value:true});shared.open({kind:'building',id:'farm',openOperation(target){opened.push(JSON.parse(JSON.stringify(target)));return true;}});shared.dialog.querySelector('[data-budget-open-target]').dispatchEvent({type:'click'});assert.deepEqual(opened,[{kind:'building',id:'farm',shared:true}]);
  for(const [kind,id,destination]of [['building','farm','facilities'],['research','cultivation','research']]){
    const h=mount();h.open({kind,id,openOperation:()=>false});h.dialog.querySelector('[data-budget-open-target]').dispatchEvent({type:'click'});assert.deepEqual(h.navigated,[destination]);assert.equal(h.counts.listeners,0);
  }
});
test('free budgets and combined plans never pretend to have a single detail target',()=>{
  const h=mount();for(const kind of ['custom','plan']){h.open({kind,openOperation(){assert.fail('No target exists for this budget');}});const button=h.dialog.querySelector('[data-budget-open-target]');assert(button.hidden);assert(button.disabled);button.dispatchEvent({type:'click'});assert(h.dialog.open);assert.deepEqual(h.navigated,[]);h.ui.closePlanner();}
});
test('a stale target click after a role or account change never routes the previous selection',()=>{
  for(const change of ['account','role','pending','title']){
    const h=mount();let access={playerId:'one',epoch:1};h.win.SengokuSocial={getExpansionContext:()=>access};h.open({kind:'building',id:'farm',openOperation(){assert.fail('A stale planner cannot open a target');}});
    if(change==='account')access={playerId:'two',epoch:2};if(change==='role')Object.defineProperty(h.game,'isStaff',{value:true});if(change==='pending')access={...access,pending:true};if(change==='title')h.win.SENGOKU_AT_TITLE=true;
    h.dialog.querySelector('[data-budget-open-target]').dispatchEvent({type:'click'});assert.equal(h.dialog.open,false,change);assert.equal(h.counts.listeners,0);assert.deepEqual(h.navigated,[]);
  }
});
test('returning to the same goal restores its position and open details while a different goal or owner starts fresh',()=>{
  const h=mount();let access={playerId:'one',epoch:1};h.win.SengokuSocial={getExpansionContext:()=>access};h.open({kind:'building',id:'farm'});const dialog=h.dialog,scroll=dialog.querySelector('.resource-plan-scroll'),reserve=dialog.querySelector('.resource-plan-reserve'),forecast=dialog.querySelector('.resource-plan-forecast');
  scroll.scrollTop=341;dialog.scrollTop=27;reserve.open=true;forecast.open=true;h.ui.closePlanner();h.open({kind:'building',id:'farm'});
  assert.equal(scroll.scrollTop,341);assert.equal(dialog.scrollTop,27);assert(reserve.open);assert(forecast.open);h.ui.closePlanner();h.open({kind:'research',id:'cultivation'});
  assert.equal(scroll.scrollTop,0);assert.equal(dialog.scrollTop,0);assert(!reserve.open);assert(!forecast.open);scroll.scrollTop=230;reserve.open=true;h.ui.closePlanner();
  access={playerId:'two',epoch:2};h.open({kind:'research',id:'cultivation'});assert.equal(scroll.scrollTop,0);assert(!reserve.open);h.ui.closePlanner();
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
test('players can add, inspect, remove and clear a combined plan using the live controls',()=>{
  const h=mount();h.open({kind:'building',id:'farm'});const dialog=h.dialog,choice=dialog.querySelector('[data-budget-choice]');
  const before=JSON.stringify(h.game.state),select=value=>{choice.value=value;choice.dispatchEvent({type:'change'});};
  dialog.querySelector('[data-budget-add]').dispatchEvent({type:'click'});
  assert.equal(choice.value,'plan');assert.equal(dialog.querySelectorAll('[data-budget-plan-item]').length,1);assert.equal(h.doc.activeElement,dialog.querySelector('[data-budget-total]'));
  select('building:market');dialog.querySelector('[data-budget-add]').dispatchEvent({type:'click'});
  select('research:cultivation');dialog.querySelector('[data-budget-add]').dispatchEvent({type:'click'});
  const sum=planner.combinedBudgetGoal(h.game,[{kind:'building',id:'farm'},{kind:'building',id:'market'},{kind:'research',id:'cultivation'}],{catalog});
  assert.equal(dialog.querySelector('[data-budget-target="gold"]').value,String(sum.targets.gold));assert.equal(dialog.querySelectorAll('[data-budget-plan-item]').length,3);
  select('building:farm');assert.equal(dialog.querySelector('[data-budget-add]').disabled,true);
  dialog.querySelector('[data-budget-add]').dispatchEvent({type:'click'});assert.equal(dialog.querySelectorAll('[data-budget-plan-item]').length,3,'Duplicate add is rejected even when an event is dispatched directly');
  dialog.querySelector('[data-budget-total]').dispatchEvent({type:'click'});const remove=dialog.querySelector('[data-budget-remove="building:farm"]');remove.focus();remove.dispatchEvent({type:'click'});
  assert.equal(h.doc.activeElement,choice);assert.equal(dialog.querySelectorAll('[data-budget-plan-item]').length,2);
  const clear=dialog.querySelector('[data-budget-clear-plan]');clear.focus();clear.dispatchEvent({type:'click'});assert.equal(dialog.querySelector('[data-budget-basket]').hidden,true);assert.equal(h.doc.activeElement,choice);
  assert.equal(dialog.querySelector('[data-budget-summary]').dataset.state,'unavailable');assert.equal(JSON.stringify(h.game.state),before);h.ui.closePlanner();
});
test('reserves preserve exact input, focus and scroll through shared ticks and report their own validation',()=>{
  const h=mount();h.open({kind:'custom'});const dialog=h.dialog,input=dialog.querySelector('[data-budget-reserve="gold"]'),target=dialog.querySelector('[data-budget-target="gold"]'),scroll=dialog.querySelector('.resource-plan-scroll');
  target.value='25';target.dispatchEvent({type:'input'});input.value='001200';input.focus();input.setSelectionRange(2,3);input.dispatchEvent({type:'input'});scroll.scrollTop=234;
  for(let n=0;n<5;n++)h.emit();
  assert.equal(input.value,'001200');assert.equal(h.doc.activeElement,input);assert.equal(input.selectionStart,2);assert.equal(scroll.scrollTop,234);assert.equal(dialog.querySelector('[data-budget-required="gold"]').textContent,'1,225');
  input.value='-1';input.dispatchEvent({type:'input'});assert.equal(input.getAttribute('aria-invalid'),'true');assert.equal(target.getAttribute('aria-invalid'),'false');assert.equal(dialog.querySelector('[data-budget-summary]').dataset.state,'invalid');
  dialog.querySelector('[data-budget-reserve-reset]').dispatchEvent({type:'click'});assert.equal(input.value,'0');assert.equal(input.getAttribute('aria-invalid'),'false');assert.equal(dialog.querySelector('[data-budget-required="gold"]').textContent,'25');h.ui.closePlanner();
});
test('draft goals and reserves survive reopening but never cross campaigns or account epochs',()=>{
  const h=mount();let access={playerId:'one',epoch:1};h.win.SengokuSocial={getExpansionContext:()=>access};
  h.open({kind:'building',id:'farm'});h.dialog.querySelector('[data-budget-add]').dispatchEvent({type:'click'});
  const reserve=h.dialog.querySelector('[data-budget-reserve="wood"]');reserve.value='04321';reserve.dispatchEvent({type:'input'});h.ui.closePlanner();
  h.open();assert.equal(h.dialog.querySelectorAll('[data-budget-plan-item]').length,1);assert.equal(h.dialog.querySelector('[data-budget-choice]').value,'plan');assert.equal(h.dialog.querySelector('[data-budget-reserve="wood"]').value,'04321');
  h.ui.closePlanner();h.open({kind:'research',id:'cultivation'});assert.equal(h.dialog.querySelector('[data-budget-choice]').value,'research:cultivation');assert.equal(h.dialog.querySelectorAll('[data-budget-plan-item]').length,1);
  access={playerId:'two',epoch:2};h.emit();assert.equal(h.dialog.open,false);h.open();assert.equal(h.dialog.querySelectorAll('[data-budget-plan-item]').length,0);assert.equal(h.dialog.querySelector('[data-budget-reserve="wood"]').value,'0');
  h.dialog.querySelector('[data-budget-add]').dispatchEvent({type:'click'});h.ui.closePlanner();const game=makeGame();game.state.walking.campaignId='different_campaign';h.setGame(game);h.open();assert.equal(h.dialog.querySelectorAll('[data-budget-plan-item]').length,0);h.ui.closePlanner();
});
test('unavailable plan rows retain their explanation and cannot display a partial ready total',()=>{
  const h=mount();h.open({kind:'building',id:'farm'});h.dialog.querySelector('[data-budget-add]').dispatchEvent({type:'click'});
  h.game.state.buildings.farm=32;h.emit();assert.equal(h.dialog.querySelector('[data-budget-summary]').dataset.state,'unavailable');assert.equal(h.dialog.querySelector('[data-budget-target="gold"]').disabled,true);assert.match(h.dialog.querySelector('[data-budget-plan-list]').textContent,/最高段階/);
  h.dialog.querySelector('[data-budget-remove]').dispatchEvent({type:'click'});assert.equal(h.dialog.querySelector('[data-budget-basket]').hidden,true);h.ui.closePlanner();
});
test('plan rows stay stable on ordinary ticks and untrusted names are escaped in every new surface',()=>{
  const h=mount(),copy={...catalog,buildings:catalog.buildings.map(row=>row.id==='farm'?{...row,name:'<img src=x onerror=alert(1)>'}:row)};
  h.open({kind:'building',id:'farm',catalog:copy});h.dialog.querySelector('[data-budget-add]').dispatchEvent({type:'click'});
  const row=h.dialog.querySelector('[data-budget-plan-item]'),details=row.querySelector('details'),button=row.querySelector('[data-budget-remove]');details.open=true;button.focus();
  for(let n=0;n<5;n++)h.emit();assert.equal(h.dialog.querySelector('[data-budget-plan-item]'),row);assert.equal(details.open,true);assert.equal(h.doc.activeElement,button);assert.equal(h.dialog.querySelector('img,script'),null);assert.match(row.textContent,/<img src=x onerror=alert\(1\)>/);h.ui.closePlanner();
});
test('the live plan rejects a ninth goal without changing already selected costs',()=>{
  const h=mount();h.open();const choice=h.dialog.querySelector('[data-budget-choice]');
  for(const building of catalog.buildings.slice(0,8)){choice.value='building:'+building.id;choice.dispatchEvent({type:'change'});h.dialog.querySelector('[data-budget-add]').dispatchEvent({type:'click'});}
  assert.equal(h.dialog.querySelectorAll('[data-budget-plan-item]').length,8);const before=h.dialog.querySelector('[data-budget-plan-list]').textContent;
  choice.value='building:'+catalog.buildings[8].id;choice.dispatchEvent({type:'change'});assert.equal(h.dialog.querySelector('[data-budget-add]').disabled,true);
  h.dialog.querySelector('[data-budget-add]').dispatchEvent({type:'click'});assert.equal(h.dialog.querySelectorAll('[data-budget-plan-item]').length,8);assert.equal(h.dialog.querySelector('[data-budget-plan-list]').textContent,before);assert.match(h.dialog.querySelector('[data-budget-feedback]').textContent,/8件まで/);h.ui.closePlanner();
});
console.log(checks+' resource planning checks passed. No campaign writes or network requests.');
