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


test('construction targets keep exact identities and shared/private scope apart',()=>{
  const game=createGame();game.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1}];
  const jobs=[{kind:'building',id:'farm',shared:false},{kind:'building',id:'farm',shared:true},{kind:'research',id:'cultivation'},{kind:'castle',id:'nijo'},{kind:'branch',id:'nijo_north'},{kind:'branch',id:'gone'}];
  const before=JSON.stringify({state:game.state,jobs}),model=command.buildOperations(game,{catalog,jobs,clock});
  const targets=model.items.map(row=>row.target);
  assert(targets.some(row=>row.kind==='building'&&row.id==='farm'&&row.shared===false));
  assert(targets.some(row=>row.kind==='building'&&row.id==='farm'&&row.shared===true));
  assert.equal(targets.find(row=>row.id==='nijo').parentCastleId,'nijo');
  assert.equal(targets.find(row=>row.id==='nijo_north').parentCastleId,'nijo');
  assert.equal(targets.find(row=>row.id==='gone').parentCastleId,'');
  assert.equal(JSON.stringify({state:game.state,jobs}),before);
});
test('a detail route releases the ledger before opening the exact selected facility',()=>{
  const h=mount(),targets=[];h.open({openOperation(target){assert.equal(h.dialog.open,false);assert.equal(h.counts.listeners,0);targets.push(target);return true;}});
  const before=JSON.stringify(h.game.state),button=h.dialog.querySelector('[data-command-go="facilities"]');
  assert.match(button.getAttribute('aria-label'),/田畑.*この施設を開く/);button.dispatchEvent({type:'click'});
  assert.equal(targets.length,1);assert.deepEqual(JSON.parse(JSON.stringify(targets[0])),{kind:'building',id:'farm',shared:false});
  assert.deepEqual(h.navigated,[]);assert.equal(JSON.stringify(h.game.state),before);
});
test('unavailable target details use the existing destination without inventing another target',()=>{
  const h=mount(),targets=[];h.open({openOperation(target){targets.push(target);return false;}});
  h.dialog.querySelector('[data-command-go="research"]').dispatchEvent({type:'click'});
  assert.equal(targets.length,1);assert.equal(targets[0].id,'cultivation');assert.deepEqual(h.navigated,['research']);assert.equal(h.counts.listeners,0);
});
test('IME conversion keeps the committed search and stable rows until composition finishes',()=>{
  const h=mount();h.open();const search=h.dialog.querySelector('[data-command-query]'),scroll=h.dialog.querySelector('[data-command-scroll]');
  search.focus();search.value='田';search.setSelectionRange(0,1);search.dispatchEvent({type:'compositionstart'});search.dispatchEvent({type:'input',isComposing:true});scroll.scrollTop=75;
  for(let i=0;i<60;i++)h.emit([],{...clock,elapsedMs:i*1000});
  assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,3);assert.equal(h.dialog.querySelector('[data-command-query]'),search);assert.equal(h.doc.activeElement,search);assert.equal(search.selectionStart,0);assert.equal(search.selectionEnd,1);assert.equal(scroll.scrollTop,75);
  search.value='田畑';search.dispatchEvent({type:'compositionend'});
  assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,2);assert.equal(h.doc.activeElement,search);assert.equal(h.counts.listeners,1);h.ui.close();
});
test('detail round trips preserve filters, pagination and reading position only within the same campaign',()=>{
  const h=mount();h.open();const search=h.dialog.querySelector('[data-command-query]'),scroll=h.dialog.querySelector('[data-command-scroll]');
  search.value='田畑';search.dispatchEvent({type:'input'});h.dialog.querySelector('[data-command-filter="construction"]').dispatchEvent({type:'click'});scroll.scrollTop=81;h.dialog.scrollTop=28;h.ui.close();
  h.open();assert.equal(search.value,'田畑');assert.equal(h.dialog.querySelector('[data-command-filter="construction"]').getAttribute('aria-pressed'),'true');assert.equal(scroll.scrollTop,81);assert.equal(h.dialog.scrollTop,28);assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,2);h.ui.close();
  h.open({filter:'research'});assert.equal(search.value,'');assert.equal(scroll.scrollTop,0);assert.equal(h.dialog.scrollTop,0);assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,1);h.ui.close();
  const next=queuedGame();next.state.walking.campaignId='another_campaign';h.setGame(next);h.open();assert.equal(search.value,'');assert.equal(scroll.scrollTop,0);assert.equal(h.dialog.querySelector('[data-command-filter="all"]').getAttribute('aria-pressed'),'true');h.ui.close();
});
test('expanded pages are retained when the same campaign ledger is reopened',()=>{
  const game=createGame();game.constructionJobs=()=>Array.from({length:85},(_,i)=>({kind:'building',id:'farm_'+i,name:'田畑 '+i,remainingSeconds:60+i,totalSeconds:180,targetLevel:2}));
  const h=mount(game);h.open();h.dialog.querySelector('[data-command-more]').dispatchEvent({type:'click'});h.dialog.querySelector('[data-command-more]').dispatchEvent({type:'click'});h.dialog.querySelector('[data-command-scroll]').scrollTop=520;h.ui.close();
  h.open();assert.equal(h.dialog.querySelectorAll('[data-command-operation]').length,85);assert.equal(h.dialog.querySelector('[data-command-scroll]').scrollTop,520);h.ui.close();
});
test('Escape stays in the top layer and only a primary pointer outside its rectangle dismisses it',()=>{
  const h=mount();h.open();let stopped=false;h.dialog.dispatchEvent({type:'keydown',key:'Escape',stopPropagation(){stopped=true;}});assert(stopped);assert(h.dialog.open);
  h.dialog.dispatchEvent({type:'click',detail:0,clientX:150,clientY:150});assert(h.dialog.open);
  h.dialog.dispatchEvent({type:'click',detail:1,button:2,clientX:150,clientY:150});assert(h.dialog.open);
  h.dialog.dispatchEvent({type:'click',detail:1,button:0,clientX:50,clientY:50});assert(h.dialog.open);
  h.dialog.dispatchEvent({type:'click',detail:1,button:0,clientX:150,clientY:150});assert(!h.dialog.open);assert.equal(h.counts.listeners,0);assert.equal(h.doc.activeElement,h.launch);
});
test('access changes are checked on a click before the next clock notification',()=>{
  for(const change of [access=>({...access,playerId:'another'}),access=>({...access,pending:true}),access=>({...access,banned:true}),access=>({...access,rolePending:true})]){
    const h=mount(),targets=[];let access={playerId:'self',pending:false,banned:false,rolePending:false};h.win.SengokuSocial={getExpansionContext:()=>access};
    h.open({openOperation(target){targets.push(target);return true;}});const button=h.dialog.querySelector('[data-command-go="facilities"]');access=change(access);let stopped=false;button.dispatchEvent({type:'click',stopPropagation(){stopped=true;}});assert(stopped);
    assert(!h.dialog.open);assert.equal(h.counts.listeners,0);assert.deepEqual(targets,[]);assert.deepEqual(h.navigated,[]);
  }
});
test('an already pending role cannot open a snapshot of the previous campaign',()=>{
  const h=mount();h.win.SengokuSocial={getExpansionContext:()=>({playerId:'self',pending:true})};assert.equal(h.open(),false);assert(!h.dialog.open);assert.equal(h.counts.listeners,0);
});

const appSource=fs.readFileSync(require.resolve('../app.js'),'utf8');
function appFunction(name){const start=appSource.indexOf('  function '+name+'(');assert(start>=0,name);const lineEnd=appSource.indexOf('\n',start);if(appSource.slice(start,lineEnd).endsWith('}'))return appSource.slice(start,lineEnd);const end=appSource.indexOf('\n  }',start);assert(end>start,name);return appSource.slice(start,end+4);}
function routeFixture(){
  const {doc,host}=setup();host.id='main';const modal=doc.createElement('dialog');modal.innerHTML='<div id="modal-content"></div>';doc.body.appendChild(modal);
  const game=queuedGame();game.state.castles.nijo.owner=game.state.clan;game.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1}];
  const opened=[],views=[],ctx={document:doc,window:{scrollTo(){}},$:s=>doc.querySelector(s),game,data:catalog,state:()=>game.state,startPending:false,syncAccess:{banned:false,rolePending:false},interactionEpoch:0,currentView:'town',
    closeModal(){modal.close();},syncMusic(){},history:{replaceState(){}},
    buildingModal(id){opened.push({kind:'building',id});modal.showModal();},
    castleUpgradeModal(id){opened.push({kind:'castle',id});modal.querySelector('#modal-content').innerHTML='<article class="branch-card" data-stable-key="branch-nijo_north"><h4>二条城 北支拠点</h4></article>';modal.showModal();},
    render(){views.push(ctx.currentView);host.innerHTML=ctx.currentView==='research'?catalog.techs.map(t=>'<section data-research-card="'+t.id+'"><h3>'+t.name+'</h3></section>').join(''):'';}};
  vm.createContext(ctx);vm.runInContext(['go','openDefenseBase','openCommandOperation'].map(appFunction).join('\n'),ctx);
  return{ctx,game,doc,host,modal,opened,views,open:target=>ctx.openCommandOperation(target)};
}
test('the app opens completed or cancelled construction targets without spending or starting new work',()=>{
  const f=routeFixture(),model=command.buildOperations(f.game,{catalog,clock});
  const facility=model.items.find(row=>row.target.kind==='building').target,research=model.items.find(row=>row.target.kind==='research').target;
  f.game.state.jobs=[];f.game.state.tech.cultivation=5;const before=JSON.stringify(f.game.state);
  assert.equal(f.open(facility),true);assert.deepEqual(f.opened,[{kind:'building',id:'farm'}]);assert.equal(f.open(research),true);
  assert.deepEqual(f.views,['research']);const card=f.host.querySelector('[data-research-card="cultivation"]'),heading=card.querySelector('h3');assert.equal(f.doc.activeElement,heading);assert.equal(heading.scrollIntoViewCalls,1);assert(card.hasAttribute('data-command-target'));assert(!f.modal.open);assert.equal(JSON.stringify(f.game.state),before);
});
test('the app opens the exact owned castle or branch and never falls through to the home castle',()=>{
  const f=routeFixture(),before=JSON.stringify(f.game.state);assert(f.open({kind:'castle',id:'nijo',parentCastleId:'nijo'}));assert(f.open({kind:'branch',id:'nijo_north',parentCastleId:'nijo'}));
  assert.deepEqual(f.opened,[{kind:'castle',id:'nijo'},{kind:'castle',id:'nijo'}]);assert.equal(f.doc.activeElement,f.modal.querySelector('h4'));assert.equal(f.modal.querySelector('.branch-card').scrollIntoViewCalls,1);assert.equal(JSON.stringify(f.game.state),before);
  for(const target of [{kind:'castle',id:'nijo',parentCastleId:'kiyosu'},{kind:'branch',id:'nijo_north',parentCastleId:'kiyosu'},{kind:'branch',id:'missing',parentCastleId:'nijo'},{kind:'building',id:'missing',shared:false},{kind:'research',id:'missing'},null,{kind:'unknown',id:'nijo'}])assert.equal(f.open(target),false);
  f.game.state.castles.nijo.owner='他勢力';assert.equal(f.open({kind:'castle',id:'nijo',parentCastleId:'nijo'}),false);assert.equal(f.open({kind:'branch',id:'nijo_north',parentCastleId:'nijo'}),false);assert.equal(f.opened.length,2);
});
test('old personal and shared facility routes cannot open each other after a role transition',()=>{
  const f=routeFixture();assert.equal(f.open({kind:'building',id:'farm',shared:true}),false);
  Object.defineProperty(f.game,'isStaff',{value:true,configurable:true});assert.equal(f.open({kind:'building',id:'farm',shared:false}),false);assert.equal(f.open({kind:'building',id:'farm',shared:true}),true);
  for(const flag of ['startPending','banned','rolePending']){if(flag==='startPending')f.ctx.startPending=true;else f.ctx.syncAccess[flag]=true;assert.equal(f.open({kind:'building',id:'farm',shared:true}),false);f.ctx.startPending=false;f.ctx.syncAccess.banned=false;f.ctx.syncAccess.rolePending=false;}
  assert.equal(f.opened.length,1);
});

console.log(checks+' operations ledger checks passed. No external requests or writes.');
