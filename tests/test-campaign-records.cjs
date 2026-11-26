'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const records=require('../campaign-records.js');
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}
const rows=(n=45)=>Array.from({length:n},(_,i)=>({turn:i===0?1:660-i,text:'記録 '+i+' 清洲城',kind:i%2?'build':'march'}));
function fixture(log=rows()) {
  const {doc,host}=require('./helpers/dom-model.cjs').setup(),events=new Map(),docEvents=new Map(),sync=new Set(),downloads=[],timers=[];
  let game={state:{log,clan:'織田家',home:'kiyosu',walking:{campaignId:'campaign-a'}}},identity={playerId:'lord-a',epoch:1};
  const originalCreate=doc.createElement.bind(doc);
  doc.createElement=name=>{const node=originalCreate(name);if(name==='a')node.click=()=>downloads.push({href:node.href,name:node.download});return node;};
  doc.addEventListener=(type,fn)=>{if(!docEvents.has(type))docEvents.set(type,new Set());docEvents.get(type).add(fn);};
  doc.removeEventListener=(type,fn)=>docEvents.get(type)?.delete(fn);
  host.innerHTML='<button id="opener">戦記を開く</button>';const opener=host.querySelector('#opener');opener.focus();
  const blobs=[],revoked=[];
  const win={document:doc,Blob:class {constructor(parts,options){this.parts=parts;this.options=options;}},URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test-'+blobs.length;},revokeObjectURL(url){revoked.push(url);}},setTimeout:fn=>timers.push(fn),
    SengokuSocial:{getExpansionContext:()=>identity},SengokuCloudSync:{subscribe(fn){sync.add(fn);fn({});return()=>sync.delete(fn);}},
    addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener(type,fn){events.get(type)?.delete(fn);}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../campaign-records.js'),'utf8'),{window:win});
  const api=win.SengokuCampaignRecords,open=()=>api.open({getGame:()=>game,formatDate:turn=>'月 '+turn,formatText:text=>text});
  const getDialog=()=>doc.querySelector('.campaign-records-dialog'),q=selector=>getDialog().querySelector(selector),click=selector=>q(selector).dispatchEvent({type:'click'});
  return{api,open,doc,win,opener,events,docEvents,sync,downloads,blobs,revoked,timers,get game(){return game;},setGame:value=>{game=value;},setIdentity:value=>{identity=value;},getDialog,q,click,emit:type=>{for(const fn of events.get(type)||[])fn({type});}};
}

test('snapshot is bounded, copied and preserves source order through calendar wrap',()=>{
  const game={state:{log:rows(180)}},before=JSON.stringify(game);
  const snapshot=records.snapshot(game,{formatDate:turn=>'月 '+turn});
  assert.equal(snapshot.length,160);assert.equal(snapshot[0].turn,1);assert(snapshot[1].turn>snapshot[0].turn);
  assert.equal(records.filterRecords(snapshot)[0].index,0);assert.equal(records.filterRecords(snapshot,{order:'oldest'})[0].index,159);
  snapshot[0].text='changed';assert.equal(JSON.stringify(game),before);
});
test('literal search normalizes half-width, case and kana without interpreting regular expressions',()=>{
  const source=records.snapshot({state:{log:[{turn:2,text:'カタカナ ＡＢＣ [東]',kind:'officer'},{turn:1,text:'かな abc (東)',kind:'info'}]}});
  assert.equal(records.filterRecords(source,{query:'ｶﾀｶﾅ abc [東]'}).length,1);
  assert.equal(records.filterRecords(source,{query:'かたかな'}).length,1);
  assert.equal(records.filterRecords(source,{query:'.*'}).length,0);
  assert.equal(records.filterRecords(source,{group:'people'}).length,1);
  assert.equal(records.filterRecords(source,{group:'other'}).length,1);
  assert.equal(records.filterRecords(source,{group:'__proto__'}).length,2);
});
test('bad log entries are omitted and unknown kind falls into the honest other group',()=>{
  const source=records.snapshot({state:{log:[null,{},'x',{text:'untyped'},{text:'new kind',kind:'__proto__'}]}});
  assert.equal(source.length,2);assert(source.every(row=>row.group==='other'));
  assert.equal(source[0].date,'時点不明');assert.equal(records.snapshot({state:{log:{}}}).length,0);
});
test('engine defeats, scouting and diplomacy stay with military actions; completed work stays with development',()=>{
  const source=records.snapshot({state:{log:[
    {text:'城攻めに敗れました',kind:'defeat'},
    {text:'敵城を偵察しました',kind:'scout'},
    {text:'同盟を締結しました',kind:'diplomacy'},
    {text:'田畑の増築開始',kind:'build'},
    {text:'技術の研究開始',kind:'research'},
    {text:'研究が完成しました',kind:'complete'}]}});
  assert.equal(records.filterRecords(source,{group:'campaign'}).length,3);
  assert.equal(records.filterRecords(source,{group:'development'}).length,3);
  assert.equal(records.filterRecords(source,{group:'other'}).length,0);
});
test('export contains all filtered rows and clearly separates itself from a restore save',()=>{
  const source=records.snapshot({state:{log:rows()}}),filtered=records.filterRecords(source,{group:'development'}),text=records.exportText(filtered,{group:'development',order:'oldest'});
  assert.match(text,/復元用セーブではありません/);assert.match(text,/最新160件/);assert.match(text,/内政・普請/);
  assert.equal((text.match(/【/g)||[]).length,22);assert.doesNotMatch(text,/記録 0 清洲城/);
});
test('mounted search keeps input focus and selection, respects IME, and paginates 20 records',()=>{
  const f=fixture();f.game.state.log[40].text='清洲城の増築完了';const before=JSON.stringify(f.game);assert(f.open());assert.equal(f.q('[data-records-list]').childNodes.length,20);
  assert.equal(f.q('[data-records-page-label]').textContent,'1 / 3頁');assert.equal(f.sync.size,1);
  const input=f.q('[data-records-query]');assert.equal(f.doc.activeElement,input);input.value='増築完了';input.setSelectionRange(1,3);input.dispatchEvent({type:'input',isComposing:true});
  assert.equal(f.q('[data-records-list]').childNodes.length,20);input.dispatchEvent({type:'compositionend'});
  assert.equal(f.q('[data-records-list]').childNodes.length,1);assert.equal(f.doc.activeElement,input);assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);
  f.click('[data-records-reset]');f.click('[data-records-page="1"]');assert.equal(f.q('[data-records-page-label]').textContent,'2 / 3頁');assert.equal(f.doc.activeElement,f.q('[data-records-scroll]'));
  f.click('[data-records-page="1"]');assert.equal(f.q('[data-records-list]').childNodes.length,5);assert(f.q('[data-records-page="1"]').disabled);
  assert.equal(JSON.stringify(f.game),before);
});
test('background save/sync notifications never replace rows or reset reading position',()=>{
  const f=fixture();f.open();const list=f.q('[data-records-list]'),first=list.firstChild,input=f.q('[data-records-query]'),scroll=f.q('[data-records-scroll]');scroll.scrollTop=290;input.value='清洲';input.setSelectionRange(0,1);
  f.game.state.log.unshift({turn:2,text:'新しい戦記',kind:'event'});
  for(let i=0;i<5;i++){f.emit('sengoku:game-saved');for(const fn of f.sync)fn({});}
  assert.equal(list.firstChild,first);assert.equal(scroll.scrollTop,290);assert.equal(input.value,'清洲');assert.equal(input.selectionEnd,1);
  f.click('[data-records-refresh]');assert.match(list.textContent,/新しい戦記/);assert.equal(scroll.scrollTop,290);assert.equal(f.q('[data-records-query]'),input);
});
test('manual refresh retains active query, kind and order, including literal HTML as text',()=>{
  const f=fixture();f.open();const input=f.q('[data-records-query]');input.value='清洲';input.dispatchEvent({type:'input'});
  const group=f.q('[data-records-group]');group.value='development';group.dispatchEvent({type:'change'});
  const order=f.q('[data-records-order]');order.value='oldest';order.dispatchEvent({type:'change'});
  f.game.state.log.unshift({turn:2,text:'清洲 <img src=x onerror=alert(1)>',kind:'build'});f.click('[data-records-refresh]');
  assert.equal(input.value,'清洲');assert.equal(group.value,'development');assert.equal(order.value,'oldest');
  f.click('[data-records-page="1"]');assert.equal(f.q('[data-records-list] img'),null);assert.match(f.q('[data-records-list]').textContent,/<img src=x/);
});
test('current filtered results download as UTF-8 text and object URL is released',()=>{
  const f=fixture();f.open();const group=f.q('[data-records-group]');group.value='development';group.dispatchEvent({type:'change'});const before=JSON.stringify(f.game);
  f.click('[data-records-export]');assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].name,'sengoku-war-records.txt');assert.equal(f.blobs[0].options.type,'text/plain;charset=utf-8');
  assert.equal((f.blobs[0].parts.join('').match(/【/g)||[]).length,22);assert.match(f.q('[data-records-feedback]').textContent,/22件/);f.timers.forEach(fn=>fn());assert.deepEqual(f.revoked,['blob:test-1']);assert.equal(JSON.stringify(f.game),before);
});
test('failed download removes its anchor and still releases its object URL',()=>{
  const f=fixture();f.open();const create=f.doc.createElement.bind(f.doc);
  f.doc.createElement=name=>{const node=create(name);if(name==='a')node.click=()=>{throw Error('Blocked download');};return node;};
  f.click('[data-records-export]');assert.match(f.q('[data-records-feedback]').textContent,/保存できませんでした/);
  assert.equal(f.doc.querySelectorAll('a').length,0);f.timers.forEach(fn=>fn());assert.deepEqual(f.revoked,['blob:test-1']);
});
test('cancel/backdrop close restores focus, clears player data and releases subscriptions',()=>{
  for(const method of ['cancel','backdrop','button']){
    const f=fixture();f.open();const el=f.getDialog();
    if(method==='cancel')el.dispatchEvent({type:'cancel'});else if(method==='backdrop')el.dispatchEvent({type:'click',clientX:101,clientY:30});else f.click('[data-records-close]');
    assert(!el.open);assert.equal(f.doc.activeElement,f.opener);assert.equal(f.sync.size,0);assert.equal(f.q('[data-records-list]').textContent,'');assert([...f.events.values()].every(set=>set.size===0));
  }
});
test('source game replacement, campaign and identity changes close without leaking prior rows',()=>{
  for(const change of ['game','campaign','identity','title']){
    const f=fixture();f.open();
    if(change==='game')f.setGame({state:JSON.parse(JSON.stringify(f.game.state))});
    if(change==='campaign')f.game.state.walking.campaignId='campaign-b';
    if(change==='identity')f.setIdentity({playerId:'lord-b',epoch:2});
    if(change==='title')f.win.SENGOKU_AT_TITLE=true;
    f.emit('sengoku:game-saved');assert(!f.getDialog().open);assert.equal(f.q('[data-records-list]').textContent,'');assert.equal(f.sync.size,0);
  }
});
test('empty results disable download and closed dialogs remain dormant through stale callbacks',()=>{
  const f=fixture([]);f.open();assert(f.q('[data-records-export]').disabled);assert(!f.q('[data-records-empty]').hidden);
  const stale=Array.from(f.sync)[0];f.api.close();stale({});assert(!f.getDialog().open);assert.equal(f.q('[data-records-list]').textContent,'');
  f.open();f.emit('pagehide');assert(!f.getDialog().open);
});
test('Escape stays scoped to the journal without preventing native cancellation',()=>{
  const f=fixture();f.open();let stopped=0,prevented=0;
  f.q('[data-records-query]').dispatchEvent({type:'keydown',key:'Escape',stopPropagation(){stopped++;},preventDefault(){prevented++;}});
  assert.equal(stopped,1);assert.equal(prevented,0);assert(f.getDialog().open);
  f.getDialog().dispatchEvent({type:'cancel'});assert(!f.getDialog().open);assert.equal(f.doc.activeElement,f.opener);
});
test('a queued native close event cannot tear down a newly reopened journal',()=>{
  const f=fixture();f.open();const el=f.getDialog(),queued=[];
  el.close=()=>{el.open=false;queued.push(()=>el.dispatchEvent({type:'close',bubbles:false}));};
  f.api.close();assert.equal(f.sync.size,0);assert(f.open());const first=f.q('[data-records-list]').firstChild;
  queued.forEach(fn=>fn());assert(el.open);assert.equal(f.sync.size,1);assert.equal(f.q('[data-records-list]').firstChild,first);
  assert.equal(f.doc.activeElement,f.q('[data-records-query]'));f.api.close();assert.equal(f.sync.size,0);
});
console.log(checks+' campaign journal behavior checks passed.');
