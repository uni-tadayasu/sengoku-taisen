'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {SengokuEngine:Engine,SENGOKU_DATA:catalog}=require('../engine.js');
const command=require('../command-center.js');
const Travel=require('../travel.js');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../command-center.js'),'utf8');
const stableSource=fs.readFileSync(require.resolve('../stable-dom.js'),'utf8');
const createGame=()=>new Engine({seed:34,clan:'織田家'});
const clock={elapsedMs:0,realNowMs:1000000,running:true,speed:1};
const route=Travel.plan({sourceCastleId:'kiyosu',targetCastleId:'odawara'});
const march=(extra={})=>({id:'unit_one',kind:'castle',status:'marching',phase:'outbound',timeBasis:'world',departedAtMs:0,arrivesAtMs:100000,travel:{...route,durationMs:100000},troops:1000,...extra});
function queuedGame(){const game=createGame();game.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};assert(game.upgrade('farm').ok);assert(game.upgrade('farm').ok);assert(game.research('cultivation').ok);return game;}
function mount(game=queuedGame(),initialMarches=[]){
  const {doc,host}=setup();doc.getElementById=id=>doc.querySelector('#'+id);
  const make=doc.createElement.bind(doc);doc.createElement=name=>{const node=make(name);Object.defineProperty(node,'className',{get:()=>node.getAttribute('class')||'',set:value=>node.setAttribute('class',value)});return node;};
  let activeGame=game,rows=initialMarches,currentClock={...clock},subscribed=0,unsubscribed=0,marchesOpened=0;const listeners=new Set(),navigated=[];
  const win={document:doc,SENGOKU_DATA:catalog,SengokuTravelUI:{snapshot:()=>({active:rows,history:[]}),subscribe(fn){subscribed++;listeners.add(fn);fn({active:rows,history:[]},currentClock);return()=>{unsubscribed++;listeners.delete(fn);};},open(){marchesOpened++;}},setTimeout(){throw Error('The command ledger must share the travel tick, not add a timer');},setInterval(){throw Error('The command ledger must not add a polling timer');}};
  vm.runInNewContext(stableSource,{window:win});vm.runInNewContext(source,{window:win});
  host.innerHTML='<button id="launch-operations">予定表を開く</button>';const launch=host.querySelector('button');launch.focus();
  const options={getGame:()=>activeGame,navigate:view=>navigated.push(view)};
  return {doc,host,win,game,launch,ui:win.SengokuCommandCenter,options,navigated,
    open(extra={}){return win.SengokuCommandCenter.open({...options,...extra});},
    emit(nextRows=rows,nextClock=currentClock){rows=nextRows;currentClock=nextClock;for(const listener of [...listeners])listener({active:rows,history:[]},currentClock);},
    setGame(value){activeGame=value;},get dialog(){return doc.querySelector('dialog');},get counts(){return{subscribed,unsubscribed,marchesOpened,listeners:listeners.size};}};
}
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}

test('the real construction queue and research are projected without changing campaign state',()=>{
  const game=queuedGame(),before=JSON.stringify(game.state);
  for(let i=0;i<25;i++){
    const model=command.buildOperations(game,{catalog,clock});
    assert.equal(model.counts.all,3);assert.equal(model.counts.construction,2);assert.equal(model.counts.research,1);assert.equal(model.queued,1);
    assert(model.items.some(row=>row.name==='田畑 Lv.'+(game.state.buildings.farm+1)));assert(model.items.some(row=>row.name==='灌漑農法 Lv.1'));
  }
  assert.equal(JSON.stringify(game.state),before,'reading does not complete work, claim rewards or consume resources');
});
test('queued completion includes preceding work and the current speed, while progress remains zero',()=>{
  const game=queuedGame(),model=command.buildOperations(game,{catalog,clock:{...clock,speed:2}}),queued=model.items.find(row=>row.queued),active=model.items.find(row=>row.category==='construction'&&!row.queued);
  assert.equal(active.time,'完成まで 30秒');assert.equal(queued.time,'完成まで 1分');assert.equal(queued.timingNote,'着工まで 30秒');assert.equal(queued.progress,0);
  assert.equal(queued.remainingMs,120000);assert.equal(model.items.at(-1),queued);
});
test('paused shared time has no promised finish time, while real-time travel continues',()=>{
  const game=queuedGame(),before=JSON.stringify(game.state),real=march({id:'real_time',timeBasis:'real',kind:'conquest',departedAtMs:1000000,arrivesAtMs:1030000});
  const model=command.buildOperations(game,{catalog,clock:{...clock,running:false},marches:[march(),real]});
  assert.equal(model.items[0].id,'march:real_time');assert.equal(model.items[0].time,'到着まで 30秒');
  assert(model.items.filter(row=>row.timeBasis==='world').every(row=>row.time==='停止中 · 時刻未定'));
  assert.match(model.items.find(row=>row.queued).timingNote,/1倍速/);assert.equal(JSON.stringify(game.state),before);
});
test('due arrivals remain pending authority and do not turn into battle results',()=>{
  const game=createGame(),rows=[march({arrivesAtMs:10000})],before=JSON.stringify({state:game.state,rows});
  const model=command.buildOperations(game,{catalog,clock:{...clock,elapsedMs:10001,running:false},marches:rows});
  assert.equal(model.items[0].time,'到着を確認中');assert.equal(model.items[0].progress,100);assert.equal(model.counts.marching,1);
  assert.equal(JSON.stringify({state:game.state,rows}),before);
});
test('all existing travel kinds appear once and reverse legs retain their actual route',()=>{
  const game=createGame(),rows=Object.keys({castle:1,branch:1,field:1,roaming:1,rally:1,conquest:1,covert:1}).map((kind,i)=>march({id:'kind_'+i,kind}));
  const back=march({id:'back',kind:'covert',phase:'returning',travel:{...Travel.plan({sourceCastleId:'odawara',targetCastleId:'kiyosu'}),durationMs:100000}});
  rows.push(back,back,march({id:'complete',status:'resolved'}),march({id:'cancelled',status:'cancelled'}));
  const before=JSON.stringify(rows),model=command.buildOperations(game,{catalog,clock,marches:rows});
  assert.equal(model.counts.all,8);assert.equal(model.counts.returning,1);assert.equal(model.counts.marching,7);
  assert.equal(model.items.find(row=>row.id==='march:back').name,'小田原城 → 清洲城');assert.equal(JSON.stringify(rows),before);
});
test('shared and personal jobs have separate keys and branch facility names stay visible',()=>{
  const game=createGame(),jobs=[{kind:'building',id:'farm',targetLevel:2,remainingSeconds:40,totalSeconds:60,shared:false},{kind:'building',id:'farm',targetLevel:2,remainingSeconds:30,totalSeconds:60,shared:true},{kind:'branch',id:'branch_a',facilityId:'farm',name:'清洲城北砦・田畑',remainingSeconds:50,totalSeconds:60,targetLevel:3}];
  const model=command.buildOperations(game,{catalog,jobs,clock});
  assert.equal(new Set(model.items.map(row=>row.id)).size,3);assert(model.items.some(row=>row.name==='清洲城北砦・田畑 Lv.3'));
  assert.match(model.items.find(row=>row.id.includes(':shared:')).detail,/共同/);
});
test('search accepts Japanese names and full-width letters without altering counts or data',()=>{
  const game=queuedGame(),model=command.buildOperations(game,{catalog,clock,marches:[march({phase:'returning'})]}),before=JSON.stringify(model);
  assert.equal(command.matchingOperations(model,'all','田畑 Ｌｖ．'+(game.state.buildings.farm+1)).length,1);
  assert.equal(command.matchingOperations(model,'returning','清洲城').length,1);
  assert.equal(command.matchingOperations(model,'research','田畑').length,0);
  assert.equal(model.counts.all,4);assert.equal(JSON.stringify(model),before);
});
test('mounted countdowns preserve search, focus, selected filter and scroll position',()=>{
  const h=mount();assert(h.open());const dialog=h.dialog,search=dialog.querySelector('[data-command-query]'),scroll=dialog.querySelector('[data-command-scroll]');
  search.value='田畑';search.focus();search.setSelectionRange(1,2);search.dispatchEvent({type:'input'});
  const filter=dialog.querySelector('[data-command-filter="construction"]');filter.dispatchEvent({type:'click'});search.focus();scroll.scrollTop=74;
  const time=dialog.querySelector('[data-command-time]'),before=time.textContent;
  h.game.state.jobs[0].remainingSeconds=50;h.emit([],{...clock,elapsedMs:10000});
  assert.equal(search.value,'田畑');assert.equal(h.doc.activeElement,search);assert.equal(search.selectionStart,1);assert.equal(scroll.scrollTop,74);
  assert.equal(filter.getAttribute('aria-pressed'),'true');assert.equal(dialog.querySelector('[data-command-time]'),time);assert.notEqual(time.textContent,before);
  assert.equal(h.counts.listeners,1);h.ui.close();assert.equal(h.counts.listeners,0);assert.equal(h.doc.activeElement,h.launch);
});
test('a finished focused row moves focus to close, without erasing the search',()=>{
  const h=mount();h.open();const dialog=h.dialog,button=dialog.querySelector('[data-command-key]'),rowId=button.dataset.commandKey;
  button.focus();h.game.state.jobs=h.game.state.jobs.filter(job=>!rowId.includes(':'+job.kind+':'+job.id+':'));
  h.emit();assert.equal(h.doc.activeElement,dialog.querySelector('[data-command-close]'));assert.equal(dialog.querySelector('[data-command-query]').value,'');h.ui.close();
});
test('completed jobs disappear and the filter can be cleared without recreating the dialog',()=>{
  const h=mount();h.open({filter:'research'});const dialog=h.dialog;
  h.game.state.jobs=h.game.state.jobs.filter(job=>job.kind!=='research');h.emit();
  assert.equal(dialog.querySelector('[data-command-empty]').hidden,false);
  dialog.querySelector('[data-command-reset]').dispatchEvent({type:'click'});
  assert.equal(h.dialog,dialog);assert.equal(dialog.querySelector('[data-command-filter="all"]').getAttribute('aria-pressed'),'true');assert.equal(dialog.querySelector('[data-command-empty]').hidden,true);h.ui.close();
});
test('work navigation closes the read-only ledger and disconnects its subscription first',()=>{
  const h=mount();h.open();const button=h.dialog.querySelector('[data-command-go="facilities"]');button.dispatchEvent({type:'click'});
  assert.deepEqual(h.navigated,['facilities']);assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);
  h.open();h.dialog.dispatchEvent({type:'cancel'});assert.equal(h.dialog.open,false);assert.equal(h.doc.activeElement,h.launch);assert.equal(h.counts.unsubscribed,2);
});
test('troop navigation opens the existing travel UI after releasing the operations listener',()=>{
  const h=mount(createGame(),[march()]);h.open();h.dialog.querySelector('[data-command-go="marches"]').dispatchEvent({type:'click'});
  assert.equal(h.counts.marchesOpened,1);assert.equal(h.counts.listeners,0);assert.equal(h.dialog.open,false);
});
test('account or campaign changes close the ledger and ignore later stale ticks',()=>{
  const h=mount();h.open();const before=h.dialog.textContent;
  const next=createGame();next.state.walking.campaignId='a_new_campaign';h.setGame(next);h.emit();
  assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);assert.equal(h.doc.activeElement,h.launch);h.emit([march()]);assert.equal(h.dialog.textContent,before);
});
test('an account switch or access hold closes the ledger before campaign replacement',()=>{
  for(const change of [access=>({...access,playerId:'u_new',epoch:2}),access=>({...access,accountEpoch:2,pending:true}),access=>({...access,banned:true})]){
    const h=mount();let access={playerId:'u_self',epoch:1,accountEpoch:1,privilegeEpoch:1,pending:false,banned:false};h.win.SengokuSocial={getExpansionContext:()=>access};
    h.open();access=change(access);h.emit();assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);assert.equal(h.doc.activeElement,h.launch);
  }
});
test('names are escaped as text and never become executable markup',()=>{
  const game=createGame();game.constructionJobs=()=>[{kind:'branch',id:'safe',name:'<img src=x onerror=alert(1)>',targetLevel:2,remainingSeconds:20,totalSeconds:60}];
  const h=mount(game);h.open();assert.equal(h.dialog.querySelector('img,script'),null);assert.match(h.dialog.textContent,/<img src=x onerror=alert\(1\)>/);h.ui.close();
});
test('large queues are paged while every job remains discoverable',()=>{
  const game=createGame();game.constructionJobs=()=>Array.from({length:85},(_,i)=>({kind:'building',id:'farm_'+i,name:'田畑 '+i,remainingSeconds:60+i,totalSeconds:180,targetLevel:2}));
  const h=mount(game);h.open();assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,40);
  h.dialog.querySelector('[data-command-more]').dispatchEvent({type:'click'});assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,80);
  h.dialog.querySelector('[data-command-more]').dispatchEvent({type:'click'});assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,85);assert.equal(h.dialog.querySelector('[data-command-more]').hidden,true);
  const search=h.dialog.querySelector('[data-command-query]');search.value='田畑 84';search.dispatchEvent({type:'input'});assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,1);assert.match(h.dialog.textContent,/田畑 84/);h.ui.close();
});
test('reopening keeps one listener and close remains idempotent',()=>{
  const h=mount();h.open();h.open({filter:'research'});assert.equal(h.counts.listeners,1);assert.equal(h.counts.subscribed,2);assert.equal(h.counts.unsubscribed,1);
  h.ui.close();h.ui.close();assert.equal(h.counts.listeners,0);assert.equal(h.counts.unsubscribed,2);
});
test('a queued native close event cannot tear down a newly reopened ledger',()=>{
  const h=mount(),callbacks=[],subscribe=h.win.SengokuTravelUI.subscribe;h.win.SengokuTravelUI.subscribe=fn=>{callbacks.push(fn);return subscribe(fn);};h.open();const dialog=h.dialog,events=[];
  dialog.close=()=>{dialog.open=false;events.push(()=>dialog.dispatchEvent({type:'close',bubbles:false}));};
  h.open({filter:'research'});const search=dialog.querySelector('[data-command-query]');search.value='灌漑';search.focus();search.dispatchEvent({type:'input'});
  events.shift()();assert.equal(dialog.open,true);assert.equal(h.counts.listeners,1);assert.equal(h.doc.activeElement,search);assert.equal(search.value,'灌漑');
  callbacks[0]({active:[],history:[]},{...clock,speed:4});assert.match(dialog.querySelector('[data-command-clock]').textContent,/1倍速/);
  h.game.state.jobs=h.game.state.jobs.filter(job=>job.kind!=='research');h.emit();assert.equal(dialog.querySelectorAll('[data-command-operation]').length,0);
  h.ui.close();events.shift()();assert.equal(h.counts.listeners,0);assert.equal(h.counts.unsubscribed,2);assert.equal(h.doc.activeElement,h.launch);
});
test('an immediate subscription rejection releases the listener without focusing a closed dialog',()=>{
  const h=mount();h.win.SENGOKU_AT_TITLE=true;
  assert.equal(h.open(),false);assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);assert.equal(h.counts.unsubscribed,1);assert.equal(h.doc.activeElement,h.launch);
});
test('authorized alliance movements appear in the briefing and retain the existing alliance action',()=>{
  const h=mount(createGame()),allied=march({id:'alliance-unit:au_one',kind:'covert',allianceKind:'aid'});
  h.win.SengokuAlliance={ownTravelSnapshot:()=>({available:true,status:'ready',fetchedAt:Date.parse('2026-11-26T09:00:00Z'),active:[allied]})};
  const before=JSON.stringify(allied),briefing=h.ui.build(h.game);assert.equal(briefing.marches,'1');assert.equal(briefing.operations,'1');assert.match(briefing.marchesDetail,/同盟1/);assert.match(briefing.nextTime,/最終確認/);
  h.open();const action=h.dialog.querySelector('[data-command-go="alliance"]');assert(action);assert.equal(action.getAttribute('data-action'),'alliance-strategy');assert(action.hasAttribute('data-command-dismiss'));
  assert.match(h.dialog.querySelector('[data-command-alliance-note]').textContent,/18:00 JST/);assert.match(h.dialog.textContent,/同盟援軍/);assert.equal(JSON.stringify(allied),before);
  action.dispatchEvent({type:'click'});assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);
});
test('revoked alliance snapshots remove only their rows and preserve ongoing search',()=>{
  const h=mount(createGame());let available=true;
  h.win.SengokuAlliance={ownTravelSnapshot:()=>({available,status:available?'ready':'unloaded',fetchedAt:Date.now(),active:[march({id:'alliance-unit:au_one',kind:'rally',allianceKind:'rally'})]})};
  h.open();const search=h.dialog.querySelector('[data-command-query]');search.value='清洲';search.focus();search.dispatchEvent({type:'input'});assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,1);
  available=false;h.emit();assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,0);assert.equal(h.doc.activeElement,search);assert.equal(search.value,'清洲');assert.match(h.dialog.querySelector('[data-command-alliance-note]').textContent,/未取得/);h.ui.close();
});
test('the same movement supplied by both read sources is counted only once',()=>{
  const h=mount(createGame()),allied=march({id:'alliance-unit:au_one',kind:'rally',allianceKind:'rally'});
  h.win.SengokuAlliance={ownTravelSnapshot:()=>({available:true,status:'ready',fetchedAt:Date.now(),active:[allied]})};
  const model=h.ui.buildOperations(h.game,{marches:[allied],clock});assert.equal(model.items.length,1);assert.equal(model.items[0].destination,'alliance');assert.equal(h.ui.build(h.game,{marches:[allied]}).marches,'1');
});

console.log(checks+' operations ledger checks passed. No external requests or writes.');
