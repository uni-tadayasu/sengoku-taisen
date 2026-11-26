'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const UI=require('../travel-ui.js'),Travel=require('../travel.js'),Advisor=require('../battle-advisor.js');
const {setup}=require('./helpers/dom-model.cjs');
const route=Travel.plan({sourceCastleId:'kiyosu',targetCastleId:'odawara'});
const march=(id,extra={})=>UI.cleanMarch({id,requestId:id+'_request',kind:'castle',authority:'local',status:'marching',phase:'outbound',timeBasis:'world',...route,departedAtMs:1000,arrivesAtMs:11000,remainingMs:10000,troops:1000,...extra});
const advice=extra=>({ok:true,tactic:'balanced',tacticName:'正攻法',troops:1000,winChance:90,minWinChance:85,estimatedLoss:120,foodCost:450,reserveAfter:{troops:2300,rice:1800},...extra});
let checks=0;function test(name,fn){fn();checks++;console.log('PASS '+name);}
function fixture(rows){
 const {doc,host}=setup(),events=new Map(),timers=new Map(),clock={elapsedMs:1000,running:true,speed:1};let timerId=0;
 doc.hidden=false;doc.addEventListener=(name,fn)=>events.set(name,fn);
 const create=doc.createElement.bind(doc);doc.createElement=name=>{const node=create(name);Object.defineProperty(node,'className',{get:()=>node.getAttribute('class')||'',set:v=>node.setAttribute('class',v)});Object.defineProperty(node,'hidden',{get:()=>node.hasAttribute('hidden'),set:v=>v?node.setAttribute('hidden',''):node.removeAttribute('hidden')});return node;};
 const win={document:doc,SengokuTravel:Travel,SengokuWorldClock:{snapshot:()=>({clock})},setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../travel-ui.js'),'utf8'),{window:win});
 let scope='one',arrivals=0;const ui=win.SengokuTravelUI;ui.configure({getContext:()=>({scope,started:true,linked:false}),getLocal:()=>rows,onArrival:()=>arrivals++});ui.open();
 const dialog=doc.querySelector('dialog'),q=selector=>dialog.querySelector(selector),click=selector=>q(selector).dispatchEvent({type:'click'});
 return{ui,win,doc,host,clock,dialog,q,click,timers,setRows:r=>{rows=r;},setScope:s=>{scope=s;},get arrivals(){return arrivals;}};
}
test('filters combine mission, phase, literal normalized query, and never mutate their input',()=>{
 const rows=[march('attack'),march('return',{phase:'returning',kind:'covert',targetName:'カタカナ ＡＢＣ [東]'}),march('done',{status:'resolved',battle:{won:true}})],before=JSON.stringify(rows);
 assert.equal(UI.filterMarches(rows,{stage:'outbound'}).length,1);assert.equal(UI.filterMarches(rows,{stage:'returning',kind:'covert',query:'ｶﾀｶﾅ abc [東]'}).length,1);
 assert.equal(UI.filterMarches(rows,{stage:'history'}).length,1);assert.equal(UI.filterMarches(rows,{query:'.*'}).length,0);
 assert.equal(UI.filterMarches(rows,{stage:'__proto__',kind:'__proto__',order:'__proto__'}).length,3);assert.equal(JSON.stringify(rows),before);
});
test('sorts express real waiting time across accelerated, paused and real clocks',()=>{
 const rows=[march('world',{arrivesAtMs:11000,troops:100,distanceKm:20}),march('real',{timeBasis:'real',departedAtMs:100000,arrivesAtMs:106000,troops:400,distanceKm:10})];
 const clock={elapsedMs:1000,realNowMs:100000,running:true,speed:4};
 assert.deepEqual(UI.filterMarches(rows,{},clock).map(m=>m.id),['world','real']);
 assert.deepEqual(UI.filterMarches(rows,{}, {...clock,running:false}).map(m=>m.id),['real','world']);
 assert.deepEqual(UI.filterMarches(rows,{order:'troops'},clock).map(m=>m.id),['real','world']);
 assert.deepEqual(UI.filterMarches(rows,{order:'distance'},clock).map(m=>m.id),['real','world']);
});
test('100% progress marks an unconfirmed arrival and cannot turn into a victory or resource return',()=>{
 const m=march('unit'),before=JSON.stringify(m),clock={elapsedMs:20000,running:false,speed:4};
 assert.equal(UI.progress(m,{elapsedMs:6000}),50);assert.equal(UI.progress(m,{elapsedMs:0}),0);assert.equal(UI.progress(m,clock),100);
 assert.match(UI.waitingLabel(m,clock),/未確定/);assert.equal(UI.countdown(m,clock),'到着を確認中');
 assert.deepEqual(UI.summarize({active:[m],history:[]},clock),{active:1,outbound:1,returning:0,awaiting:1,troops:1000,history:0,wins:0,losses:0});assert.equal(JSON.stringify(m),before);
});
test('real waiting estimates never invent speed and a stopped world has no countdown estimate',()=>{
 const m=march('unit');assert.match(UI.waitingLabel(m,{elapsedMs:1000,running:true,speed:4}),/約3秒.*4倍速/);
 assert.match(UI.waitingLabel(m,{elapsedMs:1000,running:false,speed:4}),/再開/);
 assert(!UI.waitingLabel(m,{elapsedMs:1000,running:false,speed:4}).includes('約'));
 assert.match(UI.waitingLabel(m,{elapsedMs:1000,running:true}),/速度の確定後/);
 assert.equal(UI.waitingLabel(march('real',{timeBasis:'real'}),{realNowMs:1000,running:false}),'実時間で進行');
});
test('board escapes castle names in text and accessible progress labels',()=>{
 const {host}=setup(),name='\"><img src=x onerror=alert(1)><script>bad()</script>',m=march('one',{sourceName:name,targetName:name});
 host.innerHTML=UI.boardMarkup({active:[m],history:[]},{},{elapsedMs:1000});assert.equal(host.querySelectorAll('img,script').length,0);assert.equal(host.querySelectorAll('[onerror]').length,0);assert(host.textContent.includes(name));assert.equal(host.querySelector('progress').getAttribute('aria-label'),name+'への移動進捗');
});
test('IME search keeps its element, caret and scroll through 60 clock updates',()=>{
 const f=fixture([march('one'),march('two',{targetName:'江戸城'})]),search=f.q('[data-travel-filter="query"]'),body=f.q('.travel-body');
 search.focus();search.value='江戸';search.setSelectionRange(1,2);search.dispatchEvent({type:'input',isComposing:true});assert.equal(f.q('.travel-list').childNodes.length,2);
 search.dispatchEvent({type:'compositionend'});assert.equal(f.q('.travel-list').childNodes.length,1);body.scrollTop=240;
 for(let i=0;i<60;i++){f.clock.elapsedMs+=1000;f.ui.refresh();}
 assert.equal(f.q('[data-travel-filter="query"]'),search);assert.equal(f.doc.activeElement,search);assert.equal(search.value,'江戸');assert.equal(search.selectionStart,1);assert.equal(search.selectionEnd,2);assert.equal(body.scrollTop,240);assert.equal(f.arrivals,0);assert.equal(f.timers.size,1);
});
test('stage and mission controls update cards and counts without changing underlying journeys',()=>{
 const rows=[march('one'),march('two',{phase:'returning',kind:'covert'}),march('done',{status:'resolved',battle:{won:false}})],before=JSON.stringify(rows),f=fixture(rows);
 assert.equal(f.q('[data-travel-summary="troops"]').textContent,'2,000人');assert.equal(f.q('[data-travel-summary="returning"]').textContent,'1隊');
 f.click('[data-travel-stage="returning"]');assert.equal(f.q('.travel-list').childNodes.length,1);assert.equal(f.q('[data-travel-stage="returning"]').getAttribute('aria-pressed'),'true');
 const kind=f.q('[data-travel-filter="kind"]');kind.value='castle';kind.dispatchEvent({type:'change'});assert.match(f.q('.travel-empty').textContent,/条件に合う部隊/);
 f.click('[data-travel-reset]');assert.equal(kind.value,'all');assert.equal(f.q('[data-travel-stage="all"]').getAttribute('aria-pressed'),'true');
 f.click('[data-travel-stage="history"]');assert.equal(f.q('.travel-history').childNodes.length,1);assert.match(f.q('.travel-history').textContent,/撤退/);assert.equal(JSON.stringify(rows),before);
});
test('viewing a report preserves filters, hides controls, and returning restores the same list',()=>{
 const f=fixture([march('one'),march('done',{status:'resolved',battle:{won:true,ourLost:90}})]);
 f.click('[data-travel-stage="history"]');f.click('[data-travel-report="done"]');assert(f.q('.travel-tools').hidden);assert.match(f.q('.travel-report').textContent,/90人/);
 f.click('[data-travel-back]');assert(!f.q('.travel-tools').hidden);assert.equal(f.q('[data-travel-stage="history"]').getAttribute('aria-pressed'),'true');assert.equal(f.q('.travel-list').childNodes.length,1);
 f.ui.close();f.ui.open();assert.equal(f.q('[data-travel-stage="history"]').getAttribute('aria-pressed'),'true');
 f.setScope('new-player');f.setRows([march('new')]);f.ui.refresh();assert(!f.dialog.open);f.ui.open();assert.equal(f.q('[data-travel-stage="all"]').getAttribute('aria-pressed'),'true');assert.equal(f.q('[data-travel-filter="query"]').value,'');assert(!f.dialog.textContent.includes('90人'));
});
test('readiness is derived from the supplied preview, omits unknowns, and warns only on known exhausted reserves',()=>{
 const a=advice(),before=JSON.stringify(a),r=Advisor.readiness(a);
 assert.equal(r.lossRate,12);assert.equal(r.survivors,880);assert.equal(r.reserveTroops,2300);assert.equal(r.reserveFood,1800);assert.equal(r.goalMet,true);assert.equal(JSON.stringify(a),before);
 const unknown=Advisor.readiness(advice({troops:undefined,estimatedLoss:undefined,reserveAfter:undefined}));assert.equal(unknown.lossRate,null);assert.equal(unknown.reserveFood,null);
 const {host}=setup();host.innerHTML=Advisor.markup(advice({reserveAfter:{troops:0,rice:0}}));assert.match(host.textContent,/予備兵は残りません/);assert.match(host.textContent,/兵糧を使い切る/);
 host.innerHTML=Advisor.markup(advice({reserveAfter:undefined}));assert(!host.textContent.includes('手元に残る兵'));assert(!host.textContent.includes('使い切る'));
 assert.equal(Advisor.readiness(advice({estimatedLoss:1200})).lossRate,null);assert.equal(Advisor.readiness({ok:false}),null);
});
test('deterministic loss and public estimates retain distinct uncertainty labels',()=>{
 const {host}=setup();host.innerHTML=Advisor.markup(advice({deterministic:true,predictedWin:false,winChance:0}));assert.match(host.textContent,/現在の条件では敗北予測/);assert(!host.textContent.includes('勝率の目安'));
 host.innerHTML=Advisor.markup(advice({approximate:true,winChance:70}));assert.match(host.textContent,/公開情報からの推定/);assert.match(host.textContent,/85% に未達/);
});
test('comparison table exposes actual deltas and does not turn missing costs into zero',()=>{
 const {host}=setup(),a=advice({alternatives:[advice({tactic:'ambush',tacticName:'伏兵',estimatedLoss:100,foodCost:600}),{tactic:'assault',tacticName:'総攻撃',winChance:92}]});
 host.innerHTML=Advisor.markup(a,{costLabel:'必要物資',costShortLabel:'物資'});assert.equal(host.querySelectorAll('tbody tr').length,3);assert.match(host.textContent,/損失 −20人 \/ 物資 \+150/);assert.match(host.textContent,/比較用の費用・損失データなし/);assert.equal(host.querySelectorAll('tbody tr')[2].querySelectorAll('td')[2].textContent,'—');
});
console.log(`${checks} operations board and battle readiness checks passed.`);
