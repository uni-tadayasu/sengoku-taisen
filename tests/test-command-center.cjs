'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {SengokuEngine:Engine,SENGOKU_DATA:data} = require('../engine.js');
const command = require('../command-center.js');
const rosterScope = {window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),rosterScope);
const roster = rosterScope.window.SENGOKU_OFFICERS;
const makeGame = () => new Engine({officers:roster,seed:82,clan:'織田家'});
let checks = 0;
function test(name,run){run();checks++;console.log('PASS '+name);}

test('briefing reads the real campaign without changing the save or consuming commands',()=>{
  const game=makeGame(),before=JSON.stringify(game.state);
  for(let n=0;n<40;n++){
    const model=command.build(game,{quests:data.quests});
    assert.equal(model.troops,game.state.troops.toLocaleString('ja-JP'));
    assert.equal(model.jobs,'0');
    assert.match(command.markup(game,{quests:data.quests}),/data-action="economy-details"/);
  }
  assert.equal(JSON.stringify(game.state),before);
});
test('queued work and completed unclaimed quests follow actual game transitions',()=>{
  const game=makeGame();
  assert(game.applyGift({gold:100000,wood:100000,stone:100000,rice:100000},'briefing-test').ok);
  assert(game.upgrade('farm').ok);assert(game.upgrade('farm').ok);
  let model=command.build(game,{quests:data.quests});
  assert.equal(model.jobs,'2');assert.equal(model.jobsDetail,'1件進行 · 1件予約');assert.equal(model.quests,'0');
  for(let n=0;n<12;n++)game.tick(5);
  model=command.build(game,{quests:data.quests});
  assert.equal(model.quests,'1');
  assert(game.claimQuest('first_upgrade').ok);
  assert.equal(command.build(game,{quests:data.quests}).quests,'0');
});
test('outbound and returning troops count once and completed receipts do not appear active',()=>{
  const game=makeGame(),marches=[{status:'marching',phase:'outbound'},{status:'marching',phase:'returning'},{status:'resolved',phase:'returning'},{status:'cancelled'}];
  const before=JSON.stringify(marches),model=command.build(game,{marches});
  assert.equal(model.marches,'2');assert.equal(model.marchesDetail,'うち帰還中 1部隊');assert.equal(JSON.stringify(marches),before);
});
test('budget messaging distinguishes military deficits from repair-material deficits',()=>{
  const game=makeGame();
  let model=command.build(game,{income:{net:{gold:-20,rice:50,wood:0,stone:0}}});
  assert.equal(model.gold,'−20');assert.equal(model.rice,'+50');assert.equal(model.tone,'attention');assert.match(model.note,/月替わりの自動減兵/);
  model=command.build(game,{income:{net:{gold:0,rice:0,wood:-10,stone:0}}});
  assert.match(model.note,/木材/);assert.doesNotMatch(model.note,/自動減兵/);
  model=command.build(game,{income:{net:{gold:0,rice:0,wood:0,stone:0}}});
  assert.equal(model.tone,'steady');assert.equal(model.gold,'0');
});
test('using the header income avoids an extra economy calculation and preserves maximum values',()=>{
  const game=makeGame(),income=game.income();game.state.troops=100000000;
  game.income=()=>{throw Error('The existing header projection must be reused');};
  const model=command.build(game,{income});
  assert.equal(model.troops,'100,000,000');assert(model.gold.startsWith('+'));
});
test('live briefing refresh preserves focused buttons and updates values without replacing nodes',()=>{
  const {doc,host}=require('./helpers/dom-model.cjs').setup();doc.getElementById=id=>doc.querySelector('#'+id);
  const win={document:doc,SengokuTravelUI:{snapshot:()=>({active:[]})}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../command-center.js'),'utf8'),{window:win});
  const game=makeGame();host.innerHTML=win.SengokuCommandCenter.markup(game,{quests:data.quests});
  const button=host.querySelector('[data-view="army"]'),value=host.querySelector('[data-briefing-value="troops"]');button.focus();
  for(const troops of [0,7000,100000000]){game.state.troops=troops;win.SengokuCommandCenter.refresh(game,{quests:data.quests});assert.equal(value.textContent,troops.toLocaleString('ja-JP'));assert.equal(doc.activeElement,button);assert.equal(host.querySelector('[data-briefing-value="troops"]'),value);}
  const old=value.textContent;host.querySelector('#domain-briefing').setAttribute('hidden','');game.state.troops=9;
  win.SengokuCommandCenter.refresh(game,{quests:data.quests});assert.equal(value.textContent,old,'Hidden summaries remain idle');
});
test('resource tabs retain their panels and keyboard navigation ignores Japanese composition',()=>{
  const {doc,host}=require('./helpers/dom-model.cjs').setup();
  const keys=['gold','rice','wood','stone'];
  host.innerHTML='<dialog id="modal" open><div class="economy-details-view">'+keys.map(key=>`<button data-economy-resource-tab="${key}"></button><article data-economy-resource-panel="${key}"></article>`).join('')+'</div></dialog>';
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const fn=name=>{const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  }',start);assert(start>=0&&end>start);return source.slice(start,end+4);};
  const scope={activeModal:'economy-details',activeModalContext:{},resNames:{gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},$:q=>doc.querySelector(q)};
  vm.createContext(scope);vm.runInContext(fn('selectEconomyResource')+'\n'+fn('economyResourceKeydown'),scope);
  const tabs=keys.map(key=>doc.querySelector(`[data-economy-resource-tab="${key}"]`));
  scope.selectEconomyResource('stone');
  assert.equal(scope.activeModalContext.resource,'stone');assert.equal(tabs[3].getAttribute('aria-selected'),'true');
  assert.equal(doc.querySelector('[data-economy-resource-panel="gold"]').hidden,true);
  assert.equal(doc.querySelector('[data-economy-resource-panel="stone"]').hidden,false);
  let prevented=0;
  scope.economyResourceKeydown({target:tabs[3],key:'ArrowRight',isComposing:true,preventDefault(){prevented++;}});
  assert.equal(scope.activeModalContext.resource,'stone');assert.equal(prevented,0);
  scope.economyResourceKeydown({target:tabs[3],key:'ArrowRight',preventDefault(){prevented++;}});
  assert.equal(scope.activeModalContext.resource,'gold');assert.equal(doc.activeElement,tabs[0]);assert.equal(prevented,1);
  scope.selectEconomyResource('__proto__');assert.equal(scope.activeModalContext.resource,'gold');
  assert.equal(doc.querySelectorAll('[data-economy-resource-panel]').length,4);
});
test('background refresh does not traverse a retained closed ledger',()=>{
  const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),start=source.indexOf('  function refreshEconomyPanels('),end=source.indexOf('\n  }',start);
  let scans=0;
  const panel={closest:()=>({}),querySelectorAll(){scans++;throw Error('Closed ledger should be dormant');}};
  const scope={document:{querySelectorAll:()=>[panel]}};vm.createContext(scope);vm.runInContext(source.slice(start,end+4),scope);
  for(let i=0;i<30;i++)scope.refreshEconomyPanels({});
  assert.equal(scans,0);
});
console.log(checks+' command desk and resource ledger checks passed.');
