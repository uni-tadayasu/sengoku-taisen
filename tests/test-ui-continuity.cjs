'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function fn(name){const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);const first=source.indexOf('\n',start);if(source.slice(start,first).endsWith('}'))return source.slice(start,first);const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
let checks=0;
async function test(name,run){await run();checks++;console.log('PASS '+name);}
function context(extra={}){const c={console,Date,Math,WeakMap,Object,Number,String,interactionEpoch:0,interactionRestores:new WeakMap(),currentView:'map',refreshLiveControls(){},refreshJobTimers(){},$:()=>null,...extra};vm.createContext(c);return c;}
function load(c,...names){vm.runInContext(names.map(fn).join('\n'),c);return c;}
class Node {
  constructor(tag='DIV',id='',dataset={}){this.tagName=tag;this.id=id;this.dataset=dataset;this.children=[];this.parentElement=null;this.style={};this.scrollTop=0;this.scrollLeft=0;this.value='';this.checked=false;this.selectionStart=null;this.selectionEnd=null;}
  append(node){node.parentElement=this;this.children.push(node);return node;}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  querySelectorAll(selector){const descendants=this.children.flatMap(child=>[child,...child.querySelectorAll('*')]);if(selector==='*')return descendants;if(selector==='input,select,textarea')return descendants.filter(node=>['INPUT','SELECT','TEXTAREA'].includes(node.tagName));return descendants.filter(node=>node.tagName===selector.toUpperCase());}
  focus(options){this.focusOptions=options;this.document.activeElement=this;}
  setSelectionRange(start,end,direction){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}
}
function surface(){
  const main=new Node('MAIN','main'),dialog=new Node('DIALOG','modal'),frames=[],window={scrollX:0,scrollY:0,requestAnimationFrame:callback=>frames.push(callback),scrollTo({left,top}){this.scrollX=left;this.scrollY=top;}};
  const document={activeElement:null,getElementById(id){return [main,dialog,...main.querySelectorAll('*'),...dialog.querySelectorAll('*')].find(node=>node.id===id)||null;}};
  const attach=node=>{node.document=document;for(const child of node.children)attach(child);};
  const draw=()=>{main.children=[];const detail=main.append(new Node('ASIDE','castle-detail')),search=main.append(new Node('INPUT','castle-search')),nested=detail.append(new Node('DIV')),draft=nested.append(new Node('TEXTAREA','note'));search.value='server replacement';draft.value='server draft';attach(main);return{detail,search,nested,draft};};
  const c=load(context({document,window,$:selector=>selector==='#modal'?dialog:document.getElementById(selector.slice(1))}),'interactionLocator','locateInteraction','preserveInteraction');
  return{c,main,dialog,frames,window,document,draw};
}
(async()=>{
await test('explicit desktop navigation resets the content pane, while choosing no unsupported view',()=>{
  const main={scrollTop:640,scrollLeft:30},calls=[],c=load(context({currentView:'facilities',document:{documentElement:{classList:{contains:name=>name==='sengoku-desktop-fit'}}},window:{scrollTo:value=>calls.push(value)},history:{replaceState(...args){calls.push(args);}},$:()=>main,closeModal(){},syncMusic(){},render(){}}),'go');
  c.go('town');assert.equal(main.scrollTop,0);assert.equal(main.scrollLeft,0);assert.equal(c.currentView,'town');assert.equal(c.interactionEpoch,1);assert.equal(calls.at(-1).top,0);
  c.go('unknown');assert.equal(c.currentView,'town');assert.equal(c.interactionEpoch,1);
});
await test('moving between modal views restores a valid keyboard target without disturbing retained fields',()=>{
  const stable=require('../stable-dom.js'),{doc,host}=require('./helpers/dom-model.cjs').setup();host.id='outside';
  const dialog=doc.createElement('dialog');dialog.id='modal';const content=doc.createElement('div');content.id='modal-content';dialog.appendChild(content);doc.body.appendChild(dialog);
  const c=load(context({document:doc,window:{SengokuStableDOM:stable},activeModal:'',activeModalContext:null,clearGachaPresentation(){},icon:()=>'',esc:String,$:selector=>doc.querySelector(selector)}),'patchHTML','modal');
  c.modal('武将詳細','説明','<button id="open-compare">比較表へ</button>','','officer',{id:'first'});const open=content.querySelector('#open-compare');open.focus();
  c.modal('武将比較','説明','<input id="compare-note" value=""><button id="open-detail">詳細</button>','','officer-comparison',{});
  assert(!open.isConnected);assert.strictEqual(doc.activeElement,content.querySelector('[data-action="close"]'));assert(dialog.contains(doc.activeElement));
  const note=content.querySelector('#compare-note');note.value='選択中';note.focus();note.setSelectionRange(1,3,'backward');
  c.modal('武将比較','更新した説明','<input id="compare-note" value=""><button id="open-detail">詳細</button>','','officer-comparison',{});
  assert.strictEqual(doc.activeElement,note);assert.equal(note.value,'選択中');assert.equal(note.selectionStart,1);assert.equal(note.selectionEnd,3);
  const external=doc.createElement('input');host.appendChild(external);external.focus();c.modal('武将比較','最新','<input id="compare-note" value="">','','officer-comparison',{});assert.strictEqual(doc.activeElement,external,'background refresh does not take focus from another surface');
});
await test('sync redraw retains nested scroll offsets, draft text, keyboard focus and selected text',()=>{
  const s=surface(),old=s.draw();s.main.scrollTop=418;s.main.scrollLeft=9;old.detail.scrollTop=137;old.nested.scrollTop=52;s.dialog.scrollTop=24;old.search.value='犬山';old.draft.value='入力途中';old.search.selectionStart=1;old.search.selectionEnd=2;old.search.selectionDirection='backward';s.document.activeElement=old.search;
  let fresh;s.c.preserveInteraction(s.main,()=>{fresh=s.draw();s.main.scrollTop=0;s.dialog.scrollTop=0;});
  assert.equal(fresh.search.value,'犬山');assert.equal(fresh.draft.value,'入力途中');assert.equal(s.document.activeElement,fresh.search);assert.equal(fresh.search.focusOptions.preventScroll,true);assert.equal(fresh.search.selectionStart,1);assert.equal(fresh.search.selectionEnd,2);assert.equal(fresh.search.selectionDirection,'backward');assert.equal(s.main.scrollTop,418);assert.equal(s.main.scrollLeft,9);assert.equal(fresh.detail.scrollTop,137);assert.equal(fresh.nested.scrollTop,52);assert.equal(s.dialog.scrollTop,24);
  s.main.scrollTop=0;fresh.detail.scrollTop=0;s.frames.shift()();assert.equal(s.main.scrollTop,418);assert.equal(fresh.detail.scrollTop,137,'Late layout is corrected without navigating');s.frames.shift()();assert.equal(s.main.style.overflowAnchor,'');
});
await test('late restoration yields to a new user scroll or navigation',()=>{
  for(const navigation of [false,true]){const s=surface();s.draw();s.main.scrollTop=418;s.c.preserveInteraction(s.main,s.draw);s.main.scrollTop=60;if(navigation)s.c.currentView='town';else s.c.interactionEpoch++;s.frames.shift()();assert.equal(s.main.scrollTop,60);assert.equal(s.frames.length,0);assert.equal(s.main.style.overflowAnchor,'');}
});
await test('a second redraw invalidates old animation-frame callbacks for the same pane',()=>{
  const s=surface();s.draw();s.main.scrollTop=418;s.c.preserveInteraction(s.main,s.draw);s.main.scrollTop=230;s.c.preserveInteraction(s.main,s.draw);s.frames.shift()();assert.equal(s.main.scrollTop,230);s.frames.shift()();s.frames.shift()();assert.equal(s.main.scrollTop,230);assert.equal(s.main.style.overflowAnchor,'');
});
await test('five consecutive town sync redraws carry the console position through temporary zero-height layout',()=>{
  const s=surface();s.c.currentView='town';let pane,layoutReady=true;
  const draw=()=>{s.main.children=[];pane=s.main.append(new Node('ASIDE','town-console'));let offset=0;Object.defineProperty(pane,'scrollTop',{get:()=>offset,set:value=>{offset=layoutReady?value:0;}});return pane;};
  draw().scrollTop=592;layoutReady=false;
  for(let i=0;i<5;i++)s.c.preserveInteraction(s.main,draw);
  assert.equal(pane.scrollTop,0,'The browser clamps offsets while the new console has no scroll range');
  layoutReady=true;while(s.frames.length)s.frames.shift()();
  assert.equal(pane.scrollTop,592,'Only the latest restoration runs, using the position from before the sync batch');
  assert.equal(s.main.scrollTop,0);assert.equal(s.main.style.overflowAnchor,'');
});
await test('a user gesture invalidates a pending town console position between sync redraws',()=>{
  const s=surface();s.c.currentView='town';let pane;
  const draw=()=>{s.main.children=[];pane=s.main.append(new Node('ASIDE','town-console'));return pane;};
  draw().scrollTop=592;s.c.preserveInteraction(s.main,draw);pane.scrollTop=0;s.c.interactionEpoch++;
  s.c.preserveInteraction(s.main,draw);while(s.frames.length)s.frames.shift()();assert.equal(pane.scrollTop,0);
});
await test('real app preservation and StableDOM retain document/pane reading positions through phone, tablet and PC sync batches',()=>{
  const stable=require('../stable-dom.js'),{setup}=require('./helpers/dom-model.cjs');
  for(const [width,height,desktop]of [[390,844,false],[768,1024,false],[1440,900,true]]){
    const {doc,host}=setup(),frames=[],scroller=desktop?host:doc.body;host.id='main';doc.getElementById=id=>doc.querySelector('#'+id);
    doc.defaultView={innerWidth:width,innerHeight:height,visualViewport:{width,height,offsetTop:0,offsetLeft:0,scale:1}};
    for(const node of [host,doc.body]){node.clientWidth=width;node.clientHeight=height;node.getBoundingClientRect=()=>({top:0,left:0,bottom:height,right:width,width,height});}
    const html=revision=>Array.from({length:30},(_,i)=>`<article id="row-${i}" data-height="${i===0?100+revision:100}"><p>${i===12?'最新 '+revision:'報告 '+i}</p>${i===12?'<input id="draft" value="">':''}</article>`).join('');
    const draw=revision=>{stable.patch(host,html(revision),{key:'town'});for(const [index,row]of [...host.querySelectorAll('article')].entries()){
      const rect=(offset,h)=>{const before=[...host.querySelectorAll('article')].slice(0,index).reduce((sum,node)=>sum+Number(node.dataset.height),0),top=before-scroller.scrollTop+offset;return{top,left:0,bottom:top+h,right:width,width,height:h};};
      row.getBoundingClientRect=()=>rect(0,Number(row.dataset.height));row.querySelector('p').getBoundingClientRect=()=>rect(10,20);const input=row.querySelector('input');if(input)input.getBoundingClientRect=()=>rect(40,24);
    }};
    draw(0);scroller.scrollTop=1150;scroller.scrollLeft=7;const row=doc.getElementById('row-12'),before=row.getBoundingClientRect().top,input=doc.getElementById('draft');input.value='入力途中の検索';input.setSelectionRange(1,4,'backward');input.focus();
    const window={SengokuStableDOM:stable,scrollX:desktop?0:7,scrollY:desktop?0:1150,requestAnimationFrame:callback=>frames.push(callback),scrollTo(){assert.fail('StableDOM owns ancestor scrolling');}};
    const c=load(context({currentView:'town',document:doc,window,$:selector=>doc.querySelector(selector)}),'interactionLocator','locateInteraction','preserveInteraction');
    for(let revision=1;revision<=20;revision++)c.preserveInteraction(host,()=>draw(revision));while(frames.length)frames.shift()();
    assert.equal(row.getBoundingClientRect().top,before,width+'px content anchor');assert.equal(scroller.scrollTop,1170);assert.equal(scroller.scrollLeft,7);assert.strictEqual(doc.activeElement,input);assert.strictEqual(doc.getElementById('draft'),input);assert.equal(input.value,'入力途中の検索');assert.deepEqual([input.selectionStart,input.selectionEnd,input.selectionDirection],[1,4,'backward']);assert.equal(row.querySelector('p').textContent,'最新 20');
    c.preserveInteraction(host,()=>draw(21));scroller.scrollTop+=37;c.interactionEpoch++;while(frames.length)frames.shift()();assert.equal(scroller.scrollTop,1208,'a newer user gesture owns the next position');
  }
});
await test('unchanged verified operator role does not rebuild the page or modal',()=>{
  let renders=0,modalRefresh=0;const c=load(context({game:{isAdmin:true,setAdminAccess(){return{ok:true,changed:false};}},syncAccess:{linked:true,ready:true},selectedCastle:'edo',activeModal:'building',preserveInteraction(){renders++;},refreshActiveModal(){modalRefresh++;}}),'setRoleAccess','setAdminAccess');
  for(let i=0;i<20;i++)assert(c.setAdminAccess(true).ok);assert.equal(renders,0);assert.equal(modalRefresh,0);
});
await test('map synchronization updates the existing controller and retains its camera',()=>{
  const map={},controller={camera:{x:54,y:92,zoom:17},updates:0,destroyed:false,update(){this.updates++;},destroy(){this.destroyed=true;}},c=load(context({worldMapController:null,worldMapElement:null,selectedCastle:'himeji',mapRegion:'all',data:{castles:[{id:'himeji'}]},state:()=>({castles:{himeji:{}},clan:'織田家',home:'kiyosu',treaties:{},turn:30}),game:{isAdmin:false,adjacentTargets:()=>[]},window:{SengokuWorldMap:{mount:()=>controller}},$:()=>map}),'homeCastleAppearance','campaignCastleOwnerAppearance','campaignCastleGrowth','campaignCastleAppearance','campaignCastleTooltip','syncWorldMap');
  c.syncWorldMap();const before={...controller.camera};c.syncWorldMap();assert.equal(controller.updates,1);assert.deepEqual(controller.camera,before);assert.equal(controller.destroyed,false);c.currentView='town';c.syncWorldMap();assert.equal(controller.destroyed,true);assert.equal(c.worldMapController,null);
});
await test('elapsed construction uses actual progress and remaining time follows current speed or pause',()=>{
  const state={realtime:{speed:1,running:true}},c=load(context({state:()=>state}),'jobDuration','jobClockText'),job={totalSeconds:180,remainingSeconds:100};
  assert.equal(c.jobClockText(job),'経過 1分20秒 / 3分00秒 · あと 1分40秒');state.realtime.speed=4;assert.equal(c.jobClockText(job),'経過 1分20秒 / 3分00秒 · あと 25秒（4倍速）');state.realtime.running=false;assert.match(c.jobClockText(job),/経過 1分20秒.*あと 25秒（停止中）/);assert.equal(c.jobClockText(null),'完成');
  assert.match(c.jobClockText({total:1,remaining:1,totalSeconds:60,remainingSeconds:0}),/^経過 1分00秒.*あと 0秒/,'Zero remaining is not replaced by the legacy month count');
});
await test('cycle settlement persists final occupation, blocks mutations, flushes and only then refreshes',async()=>{
  let state={cycle:{index:8},turn:6047},release;const calls=[],barrier=new Promise(resolve=>release=resolve),c=load(context({syncAccess:{linked:true},worldSettlementPending:false,worldSettlementRetryAt:0,state:()=>state,save:options=>{calls.push(['save',options.allowClockCatchup]);return true;},window:{SengokuCloudSync:{flush:async()=>{calls.push('flush');await barrier;state={cycle:{index:9},turn:6048};return{ok:true};},refresh:async options=>{assert.equal(options.settleCycle,true);calls.push('refresh');return{ok:true};}}},queueWorldProgress(){calls.push('queued');},toast(message){calls.push(message);}}),'settleWorldCycle');
  const promise=c.settleWorldCycle();assert.equal(c.worldSettlementPending,true);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['save',true],'flush']);assert.equal(c.settleWorldCycle(),undefined);release();await promise;assert.deepEqual(JSON.parse(JSON.stringify(calls)),[['save',true],'flush','refresh','queued']);assert.equal(c.worldSettlementPending,false);assert.equal(c.worldSettlementRetryAt,0);
});
await test('cycle reconciliation failure has a bounded retry and never treats the old cycle as settled',async()=>{
  let requests=0;const c=load(context({syncAccess:{linked:true},worldSettlementPending:false,worldSettlementRetryAt:0,state:()=>({cycle:{index:8},turn:6047}),save:()=>true,window:{SengokuCloudSync:{flush:async()=>({ok:true}),refresh:async()=>{requests++;return{ok:true};}}},queueWorldProgress(){},toast(){}}),'settleWorldCycle');
  await c.settleWorldCycle();assert.equal(requests,1);assert(c.worldSettlementRetryAt>Date.now());assert.equal(c.worldSettlementPending,false);assert.equal(c.settleWorldCycle(),undefined);assert.equal(requests,1);
});
await test('failed local durability prevents cycle transfer; guests never call settlement APIs',async()=>{
  let calls=0;const c=load(context({syncAccess:{linked:true},worldSettlementPending:false,worldSettlementRetryAt:0,save:()=>false,window:{SengokuCloudSync:{flush:()=>calls++,refresh:()=>calls++}},queueWorldProgress(){}}),'settleWorldCycle');
  assert.equal(c.settleWorldCycle(),undefined);assert.equal(calls,0);assert(c.worldSettlementRetryAt>Date.now());c.syncAccess.linked=false;c.worldSettlementRetryAt=0;assert.equal(c.settleWorldCycle(),undefined);assert.equal(calls,0);
});
console.log(`${checks} live UI continuity, elapsed timer and cycle settlement checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
