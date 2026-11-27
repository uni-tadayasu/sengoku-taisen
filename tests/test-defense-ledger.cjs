'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const ledger=require('../defense-ledger.js');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../defense-ledger.js'),'utf8');
const stableSource=fs.readFileSync(require.resolve('../stable-dom.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
const fresh=options=>new E({seed:4918,clan:'織田家',...options});
function damage(game,id,fraction=.5,kind='castle') {
  const view=kind==='castle'?game.castle(id):game.branch(id);
  const target=kind==='castle'?game.state.castles[id]:game.state.branches.find(row=>row.id===id);
  target.durability={version:1,current:Math.round(view.durability.max*fraction),max:view.durability.max,updatedElapsedMs:game.state.turn*60000+Math.round(game.state.realtime.elapsed*1000)};
}
function prepared() {
  const game=fresh();game.state.castles.nijo.owner=game.state.clan;game.state.castles.osaka.owner=game.state.clan;
  game.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};
  game.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:false,stationedTroops:275}];
  return game;
}
function constrained() {
  const game=prepared();for(const key of Object.keys(game.state.buildings))game.state.buildings[key]=0;
  game.state.buildings.keep=32;game.state.buildings.wall=32;game.state.buildings.barracks=32;game.state.buildings.academy=32;
  game.state.resources.wood=1;game.state.resources.stone=1;
  damage(game,game.state.home,.2);damage(game,'nijo',.7);damage(game,'nijo_north',.4,'branch');
  return game;
}
function mount(game=prepared()) {
  const {doc,host}=setup();doc.getElementById=id=>doc.querySelector('#'+id);
  const originalCreate=doc.createElement.bind(doc);
  doc.createElement=tag=>{const node=originalCreate(tag);Object.defineProperty(node,'className',{get:()=>node.getAttribute('class')||'',set:value=>node.setAttribute('class',value)});return node;};
  const win={document:doc,SENGOKU_DATA:D,setTimeout(){throw Error('The ledger must not poll');},setInterval(){throw Error('The ledger must not poll');}};
  vm.runInNewContext(stableSource,{window:win});vm.runInNewContext(source,{window:win,Event:class{constructor(type,opts){this.type=type;Object.assign(this,opts);}}});
  host.innerHTML='<button id="ledger-launch">修復を確認</button>';const launch=host.querySelector('button');launch.focus();
  let current=game,access={playerId:'test-lord',roleEpoch:1},reads=0;
  const original=game.income;game.income=function(...args){reads++;return original.apply(this,args);};
  const opened=[],options={getGame:()=>current,getContext:()=>access,openBase:row=>opened.push(plain(row))};
  return {doc,host,win,game,launch,options,opened,ui:win.SengokuDefenseLedger,
    open(extra={}){return this.ui.open({...options,...extra});},setGame(next){current=next;},setAccess(next){access=next;},
    get dialog(){return doc.querySelector('dialog');},get reads(){return reads;}};
}
function click(node){node.dispatchEvent({type:'click'});}
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}

test('real engine projections are pure and include only owned eligible castles and outposts',()=>{
  const game=prepared();game.state.castles.edo.owner=game.state.clan;game.state.castles.kyoto_gosho.owner=game.state.clan;
  game.state.branches.push({id:'nagoya_south',parentCastleId:'nagoya',direction:'south',level:1,fallen:false});
  const before=plain(game.state);game.random=()=>{throw Error('A preview must not use randomness');};
  const model=ledger.build(game);
  assert.equal(model.summary.castles,3);assert.equal(model.summary.branches,1);assert.equal(model.summary.damaged,0);
  assert(!model.rows.some(row=>['edo','kyoto_gosho','nagoya_south'].includes(row.id)));
  assert.equal(model.rows.find(row=>row.id==='nijo_north').troops,275);
  assert.equal(model.rows.find(row=>row.id==='nijo_north').defense,game.branchDefense('nijo_north').power);
  assert.deepEqual(game.state,before);
});
test('current materials and next-month production use distinct existing quotes',()=>{
  const game=prepared();game.state.resources.wood=0;game.state.resources.stone=0;damage(game,game.state.home,.2);
  const before=plain(game.state),held=game.repairQuote(),predicted=game.income().repair,model=ledger.build(game);
  assert.equal(held.repairedHP,0);assert(predicted.repairedHP>0);
  assert.equal(model.current.recovery,held.repairedHP);assert.equal(model.forecast.recovery,predicted.repairedHP);
  assert.deepEqual(model.forecast.cost,{wood:predicted.cost.wood,stone:predicted.cost.stone});
  assert.equal(model.rows.find(row=>row.home).recovery,predicted.allocations.find(row=>row.id===game.state.home).repairedHP);
  assert.equal(model.rows.find(row=>row.home).currentRecovery,0);assert.deepEqual(game.state,before);
});
test('material shortage allocation and total cost match the engine without inventing priority rules',()=>{
  const game=constrained(),before=plain(game.state),quote=game.income().repair,model=ledger.build(game);
  assert(quote.limited);assert.equal(model.forecast.limited,true);assert.equal(model.forecast.unfilled,quote.requestedHP-quote.repairedHP);
  assert.deepEqual(model.forecast.required,{wood:quote.requiredCost.wood,stone:quote.requiredCost.stone});
  for(const allocation of quote.allocations){const row=model.rows.find(row=>row.key===allocation.kind+':'+allocation.id);assert(row);assert.equal(row.requested,allocation.requestedHP);assert.equal(row.recovery,allocation.repairedHP);assert.equal(row.after,allocation.after);assert.equal(row.unfilled,allocation.requestedHP-allocation.repairedHP);}
  const shortages=ledger.filter(model,{status:'shortage'});assert(shortages.length>0);assert(shortages.every(row=>row.unfilled>0));
  ledger.filter(model,{sort:'name'});ledger.filter(model,{sort:'damage'});assert.deepEqual(game.state,before);
});
test('fallen, rebuilding, unfinished and withdrawing branches never promise automatic recovery',()=>{
  const game=prepared();const seed=game.state.branches[0];
  game.state.branches=[{...seed,fallen:true},{...seed,id:'nijo_east',direction:'east',level:0},{...seed,id:'osaka_south',parentCastleId:'osaka',direction:'south',retreating:true}];
  let model=ledger.build(game),fallen=model.rows.find(row=>row.id==='nijo_north');
  assert.equal(fallen.status,'fallen');assert.equal(fallen.recovery,0);assert.equal(fallen.defense,null);assert.equal(model.summary.rebuild,1);
  assert.equal(model.rows.find(row=>row.id==='nijo_east').status,'unbuilt');assert.equal(model.rows.find(row=>row.id==='osaka_south').status,'retreating');
  game.state.jobs.push({kind:'branch',id:'nijo_north',repair:true,targetLevel:2,totalSeconds:60,remainingSeconds:60});
  model=ledger.build(game);fallen=model.rows.find(row=>row.id==='nijo_north');assert.equal(fallen.status,'rebuilding');assert.equal(model.summary.rebuild,0);assert.equal(ledger.filter(model,{status:'rebuild'}).length,0);
});
test('Edo stays owner-only and its eligible outposts use the same paid repair rules',()=>{
  const game=fresh({isAdmin:true});damage(game,'edo',.5);
  const model=ledger.build(game),edo=model.rows.find(row=>row.id==='edo');
  assert(edo);assert.equal(edo.protected,true);assert.equal(edo.shared,false);assert.equal(edo.home,true);assert.equal(edo.recoveryMode,'paid');
  assert.equal(edo.recovery,game.income().repair.allocations.find(row=>row.id==='edo').repairedHP);
});
test('confirmed Kyoto is shared, protected and projected through the free recovery API',()=>{
  const personal=fresh(),buildings=plain(personal.state.buildings),shared={id:'kyoto_gosho',revision:1,castleLevel:1,buildings,initial:{castleLevel:1,buildings:plain(buildings)},history:[],jobs:[],updatedElapsedMs:0,accessSinceElapsedMs:0,personalClan:'織田家',protected:true};
  const game=E.fromSave(personal.exportSave(),personal.roster,{isStaff:true,staffBase:shared});damage(game,'kyoto_gosho',.5);
  game.state.realtime.elapsed=15;const before=plain(game.state),model=ledger.build(game),kyoto=model.rows.find(row=>row.id==='kyoto_gosho');
  assert(kyoto);assert.equal(kyoto.shared,true);assert.equal(kyoto.protected,true);assert.equal(kyoto.recoveryMode,'free');
  const projected=E.durabilityView(game.state.castles.kyoto_gosho.durability,{castleId:'kyoto_gosho',level:1,wall:game.state.castles.kyoto_gosho.wall,elapsedMs:60000,recoveryMode:'free'});
  assert.equal(kyoto.after,projected.current);assert.equal(kyoto.recovery,projected.current-kyoto.current);
  assert.equal(model.forecast.recovery,0);assert.equal(model.forecast.cost.wood,0);assert.deepEqual(game.state,before);
  const waiting=ledger.build(game,{staffReady:()=>false});
  assert.equal(waiting.sharedReady,false);assert.equal(waiting.forecast,null);assert.equal(waiting.rows.find(row=>row.id==='kyoto_gosho').current,null);
  const h=mount(game);h.open({staffReady:()=>false});assert.match(h.dialog.querySelector('[data-defense-note]').textContent,/共同拠点/);assert.equal(h.reads,0);h.ui.destroy();
});
test('unconfirmed shared base and missing quote fields remain unknown rather than zero',()=>{
  const game=fresh();game.setRoleAccess({isStaff:true});let model=ledger.build(game);
  assert.equal(model.sharedReady,false);assert.equal(model.forecast,null);assert.equal(model.rows.find(row=>row.id==='kyoto_gosho').current,null);assert.match(model.note,/共同拠点/);
  const local=prepared();damage(local,local.state.home,.3);model=ledger.build(local,{income:{repair:{cost:{wood:0,stone:0}}}});
  assert.equal(model.forecast,null);assert.equal(model.summary.recovery,null);assert.equal(model.rows.find(row=>row.home).recovery,null);
});
test('search, state filters and ordering are deterministic and leave the snapshot intact',()=>{
  const game=constrained(),model=ledger.build(game),before=plain(model);
  assert(ledger.filter(model,{query:'本拠'}).every(row=>row.home));assert(ledger.filter(model,{kind:'branch',query:'二条 北'}).every(row=>row.kind==='branch'&&row.id==='nijo_north'));
  assert.equal(ledger.filter(model,{query:'no such castle'}).length,0);
  assert(ledger.filter(model,{status:'damaged'}).every(row=>row.missing>0));assert(ledger.filter(model,{status:'sound'}).every(row=>row.status==='sound'));
  assert.deepEqual(ledger.filter(model,{sort:'recovery'}).map(row=>row.id),ledger.filter(model,{sort:'recovery'}).map(row=>row.id));
  assert.deepEqual(model,before);
});
test('month timing distinguishes stopped time and selected speed without advancing time',()=>{
  const game=prepared();game.state.realtime.elapsed=15;const before=plain(game.state);
  assert.equal(ledger.build(game,{clock:{running:true,speed:1}}).waitSeconds,45);
  assert.equal(ledger.build(game,{clock:{running:true,speed:2}}).waitSeconds,23);
  const paused=ledger.build(game,{clock:{running:false,speed:4}});assert.equal(paused.waitSeconds,null);assert.match(paused.clockLabel,/停止中/);assert.deepEqual(game.state,before);
});
test('an unconfirmed shared clock cannot borrow saved timing and recovers on explicit refresh',()=>{
  const game=prepared();Object.assign(game.state.realtime,{elapsed:15,running:true,speed:2});const before=plain(game.state);
  assert.equal(ledger.build(game).waitSeconds,23);
  const unknown=ledger.build(game,{clock:null});assert.equal(unknown.waitSeconds,null);assert.equal(unknown.speed,null);assert.match(unknown.clockLabel,/不明/);
  assert.equal(ledger.build(game,{clock:{running:true}}).waitSeconds,null);
  const h=mount(game);let clock=null;assert(h.open({getClock:()=>clock}));assert.match(h.dialog.querySelector('[data-defense-clock]').textContent,/不明/);
  clock={running:true,speed:2};click(h.dialog.querySelector('[data-defense-refresh]'));assert.match(h.dialog.querySelector('[data-defense-clock]').textContent,/約23秒/);
  clock=null;click(h.dialog.querySelector('[data-defense-refresh]'));assert.match(h.dialog.querySelector('[data-defense-clock]').textContent,/不明/);
  assert.deepEqual(game.state,before);h.ui.destroy();
});
test('owned site picker restores a matching row and expires with the ledger session',()=>{
  const h=mount();let picker;h.win.SengokuInputList={open:options=>{picker=options;}};
  h.open();const input=h.dialog.querySelector('[data-defense-query]');
  input.value='該当なし';input.dispatchEvent({type:'input'});assert.equal(h.dialog.querySelectorAll('[data-defense-row]').length,0);
  click(h.dialog.querySelector('[data-defense-input-list]'));assert(picker.options.length);
  picker.onSelect(picker.options[0]);assert.equal(input.value,picker.options[0].value);
  assert(h.dialog.querySelectorAll('[data-defense-row]').length);
  assert(picker.valid());h.ui.close();assert.equal(picker.valid(),false);
});
test('mounted ledger computes only on open or explicit refresh and preserves search, selection and scroll',()=>{
  const h=mount(constrained());assert(h.open());assert.equal(h.reads,1);
  const query=h.dialog.querySelector('[data-defense-query]'),scroll=h.dialog.querySelector('[data-defense-scroll]');
  query.value='二条';query.focus();query.setSelectionRange(1,2);query.dispatchEvent({type:'input'});scroll.scrollTop=411;
  for(let i=0;i<60;i++)h.ui.invalidate();assert.equal(h.reads,1);assert.equal(query.value,'二条');assert.equal(h.doc.activeElement,query);assert.equal(query.selectionStart,1);assert.equal(scroll.scrollTop,411);
  const status=h.dialog.querySelector('[data-defense-filter="status"]');status.value='shortage';status.dispatchEvent({type:'change'});assert.equal(h.reads,1);
  const details=h.dialog.querySelector('details');details.open=false;click(h.dialog.querySelector('[data-defense-refresh]'));
  assert.equal(h.reads,2);assert.equal(query.value,'二条');assert.equal(query.selectionStart,1);assert.equal(scroll.scrollTop,411);assert.equal(h.dialog.querySelector('details').open,false);
  h.ui.close();assert.equal(h.doc.activeElement,h.launch);
});
test('Japanese composition does not rebuild rows until composition ends',()=>{
  const h=mount();h.open();const query=h.dialog.querySelector('[data-defense-query]'),first=h.dialog.querySelector('[data-defense-row]');
  query.dispatchEvent({type:'compositionstart'});query.value='二';query.dispatchEvent({type:'input',isComposing:true});assert.equal(h.dialog.querySelector('[data-defense-row]'),first);
  query.value='二条';query.dispatchEvent({type:'compositionend'});assert.equal(h.reads,1);assert(h.dialog.querySelectorAll('[data-defense-row]').every(row=>row.textContent.includes('二条')));
  h.ui.destroy();
});
test('detail navigation uses the existing base route and rechecks ownership before leaving',()=>{
  const h=mount();h.open();const branch=h.dialog.querySelector('[data-defense-open="branch:nijo_north"]');click(branch);
  assert.deepEqual(h.opened,[{kind:'branch',id:'nijo_north',parentCastleId:'nijo'}]);assert.equal(h.dialog.open,false);
  h.open();h.game.state.castles.nijo.owner='在地衆';click(h.dialog.querySelector('[data-defense-open="castle:nijo"]'));
  assert.equal(h.opened.length,1);assert.equal(h.dialog.open,true);assert(!h.dialog.querySelector('[data-defense-open="castle:nijo"]'));
  h.ui.destroy();
});
test('account, campaign, home and privilege changes close a stale ledger without recomputing',()=>{
  for(const change of [h=>h.setAccess({playerId:'other',roleEpoch:1}),h=>h.setAccess({playerId:'test-lord',roleEpoch:2}),h=>h.setAccess({playerId:'test-lord',roleEpoch:1,pending:true}),h=>h.setAccess({playerId:'test-lord',roleEpoch:1,user:{isBanned:true}}),h=>{h.win.SengokuBridge={getRoleAccess:()=>({pending:true})};},h=>{h.win.SengokuBridge={getRoleAccess:()=>({epoch:2})};},h=>{h.game.state.walking.campaignId='new';},h=>{h.game.state.home='nijo';},h=>{h.win.SENGOKU_AT_TITLE=true;}]) {
    const h=mount();h.open();change(h);h.ui.invalidate();assert.equal(h.dialog.open,false);assert.equal(h.reads,1);assert.equal(h.doc.activeElement,h.launch);h.ui.destroy();
  }
});
test('late native close events cannot dispose a reopened session and subscriptions are released',()=>{
  const h=mount(),callbacks=[],events=[];let stopped=0;
  const subscribe=fn=>{callbacks.push(fn);fn();return()=>{stopped++;};};h.open({subscribe});
  assert.match(h.dialog.querySelector('[data-defense-update]').textContent,/計算時点/);callbacks[0]();
  assert.match(h.dialog.querySelector('[data-defense-update]').textContent,/状況が変わりました/);assert.equal(h.reads,1);
  const dialog=h.dialog;dialog.close=function(){this.open=false;events.push(()=>this.dispatchEvent({type:'close',bubbles:false}));};
  h.ui.close();h.open({subscribe});const query=dialog.querySelector('[data-defense-query]');query.focus();query.value='清洲';query.dispatchEvent({type:'input'});
  events.shift()();assert.equal(dialog.open,true);assert.equal(h.doc.activeElement,query);assert.equal(query.value,'清洲');assert.equal(stopped,1);
  h.ui.close();events.shift()();assert.equal(stopped,2);h.ui.destroy();
});
test('unconfirmed access never opens the ledger and only a pointer backdrop or native cancellation dismisses it',()=>{
  const h=mount();h.setAccess({pending:true});assert.equal(h.open(),false);assert.equal(h.reads,0);assert.equal(h.dialog,null);
  h.setAccess({playerId:'test-lord'});h.win.SengokuBridge={getRoleAccess:()=>({pending:true})};assert.equal(h.open(),false);
  h.win.SengokuBridge={hasStarted:()=>false};assert.equal(h.open(),false);delete h.win.SengokuBridge;
  h.open();const node=h.dialog;node.getBoundingClientRect=()=>({left:20,right:300,top:20,bottom:500});
  node.dispatchEvent({type:'click',target:node,detail:1,button:0,clientX:100,clientY:100});assert.equal(node.open,true);
  node.dispatchEvent({type:'click',target:node,detail:0,button:0,clientX:0,clientY:0});assert.equal(node.open,true);
  node.dispatchEvent({type:'click',target:node,detail:1,button:2,clientX:0,clientY:0});assert.equal(node.open,true);
  node.dispatchEvent({type:'click',target:node,detail:1,button:0,clientX:0,clientY:0});assert.equal(node.open,false);assert.equal(h.doc.activeElement,h.launch);
  h.open();node.dispatchEvent({type:'cancel',cancelable:true});assert.equal(node.open,false);h.ui.destroy();
});
test('large holdings are paged and filter work never asks the engine for another quote',()=>{
  const game=prepared();for(const castle of D.castles)if(game.canOwnCastle(castle.id))game.state.castles[castle.id].owner=game.state.clan;
  const h=mount(game);h.open();assert.equal(h.dialog.querySelectorAll('[data-defense-row]').length,24);
  click(h.dialog.querySelector('[data-defense-more]'));assert.equal(h.dialog.querySelectorAll('[data-defense-row]').length,48);assert.equal(h.reads,1);
  h.ui.destroy();
});
test('untrusted display strings stay text and absent durability never yields a fabricated meter',()=>{
  const h=mount(),read=h.game.castle.bind(h.game);h.game.castle=id=>{const row=read(id);if(id===h.game.state.home)return{...row,name:'<img src=x onerror=alert(1)>',durability:null};return row;};
  h.open();const card=h.dialog.querySelector('[data-defense-row="castle:'+h.game.state.home+'"]');
  assert(card.textContent.includes('<img src=x onerror=alert(1)>'));assert.equal(card.querySelector('img'),null);assert.equal(card.querySelector('[role="meter"]'),null);assert.match(card.textContent,/不明/);
  h.ui.destroy();
});
console.log(`${count} defense ledger scenarios passed.`);
