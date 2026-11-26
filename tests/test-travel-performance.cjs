'use strict';
// Observable work and continuity under repeated clock updates. No wall-clock
// threshold, network, real save or authenticated account is used.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup,Node}=require('./helpers/dom-model.cjs');
const Travel=require('../travel.js');
const source=fs.readFileSync(path.join(__dirname,'../travel-ui.js'),'utf8');
const route=Travel.plan({sourceCastleId:'kiyosu',targetCastleId:'odawara'});
function march(id='unit_one',extra={}){return{id,requestId:id+'_request',kind:'field',authority:'local',status:'marching',timeBasis:'world',...route,departedAtMs:1000,arrivesAtMs:1000+route.durationMs,remainingMs:route.durationMs,troops:1000,...extra};}
function fixture({rows=[march()],clock={elapsedMs:1000,running:true,speed:1},context={scope:'local:one',started:true,linked:false},request}={}){
 const {doc,host}=setup(),events=new Map(),timers=new Map(),observations=[];
 const counts={localReads:0,bodyScans:0,documentScans:0,subscriptions:0,textWrites:0,arrivals:0};
 let timerId=0,now=2000000000000,mutations;
 doc.hidden=false;doc.addEventListener=(type,fn)=>{events.set(type,fn);};
 const create=doc.createElement.bind(doc);doc.createElement=name=>{
  const node=create(name);Object.defineProperty(node,'className',{get:()=>node.getAttribute('class')||'',set:value=>node.setAttribute('class',value)});
  Object.defineProperty(node,'hidden',{get:()=>node.hasAttribute('hidden'),set:value=>value?node.setAttribute('hidden',''):node.removeAttribute('hidden')});return node;
 };
 const bodyQuery=doc.body.querySelectorAll.bind(doc.body);doc.body.querySelectorAll=selector=>{if(selector==='[data-march-countdown]')counts.bodyScans++;return bodyQuery(selector);};
 const documentQuery=doc.querySelectorAll.bind(doc);doc.querySelectorAll=selector=>{if(selector==='[data-march-countdown]')counts.documentScans++;return documentQuery(selector);};
 const win={document:doc,SengokuTravel:Travel,SengokuWorldClock:{snapshot:()=>({clock})},
  MutationObserver:class{constructor(fn){mutations=fn;}observe(root){observations.push(root);}},
  setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id)};
 class ClockDate extends Date{static now(){return now;}}
 vm.runInNewContext(source,{window:win,Date:ClockDate,JSON,Map,Set,Number,String,Object,Math});
 const ui=win.SengokuTravelUI;
 ui.configure({getContext:()=>context,getLocal:()=>{counts.localReads++;return rows;},request,onArrival:()=>counts.arrivals++});
 function countText(node){const property=Object.getOwnPropertyDescriptor(Node.prototype,'textContent');Object.defineProperty(node,'textContent',{get:()=>property.get.call(node),set:value=>{counts.textWrites++;property.set.call(node,value);}});return node;}
 function insert(html){const root=doc.createElement('section');root.innerHTML=html;host.appendChild(root);mutations?.([{addedNodes:[root],removedNodes:[]}]);return root;}
 return{ui,win,doc,host,clock,context,counts,timers,observations,countText,insert,
  rows:value=>{rows=value;},now:value=>{now=value;},mutate:records=>mutations?.(records),
  visibility(hidden){doc.hidden=hidden;events.get('visibilitychange')?.();},
  tick(){assert.equal(timers.size,1,'one fallback is armed');const [id,job]=timers.entries().next().value;timers.delete(id);job.fn();},
  reset(){for(const key of Object.keys(counts))counts[key]=0;}};
}
let checks=0;async function test(name,run){await run();checks++;console.log('PASS '+name);}
(async()=>{
 await test('60 clock updates read local journeys once each and never scan the whole document again',()=>{
  const f=fixture(),before=JSON.stringify(f.ui.snapshot());f.reset();
  for(let i=0;i<60;i++){f.clock.elapsedMs+=1000;f.ui.refresh();}
  assert.equal(f.counts.localReads,60);assert.equal(f.counts.documentScans,0);assert.equal(f.counts.bodyScans,0);
  assert.equal(f.timers.size,1,'explicit game updates replace the fallback instead of adding permanent timers');
  assert.equal(f.doc.querySelector('dialog').open,false);assert.equal(f.counts.arrivals,0);
  assert.equal(JSON.stringify(f.ui.snapshot()),before,'countdown rendering cannot settle or change a journey');
 });
 await test('mounted countdowns are tracked, unchanged text is untouched, and hidden or detached views do no work',()=>{
  const f=fixture(),root=f.insert(f.ui.countdownMarkup(march(),f.clock)),counter=f.countText(root.querySelector('[data-march-countdown]'));
  f.ui.refresh();f.reset();for(let i=0;i<20;i++)f.ui.refresh();assert.equal(f.counts.textWrites,0,'same-second refreshes do not rebuild text nodes');
  f.clock.elapsedMs+=4000;f.ui.refresh();assert.equal(f.counts.textWrites,1);assert.match(counter.textContent,/到着まで/);
  root.setAttribute('hidden','');f.clock.elapsedMs+=4000;f.reset();f.ui.refresh();assert.equal(f.counts.textWrites,0);
  root.removeAttribute('hidden');f.ui.refresh();assert.equal(f.counts.textWrites,1,'showing a reused node catches up immediately');
  root.remove();f.mutate([{addedNodes:[],removedNodes:[root]}]);f.clock.elapsedMs+=4000;f.reset();f.ui.refresh();assert.equal(f.counts.textWrites,0);assert.equal(f.counts.bodyScans,0);assert.equal(f.counts.documentScans,0);
 });
 await test('a reconciled existing node can gain or lose its countdown role without a whole-page scan',()=>{
  const f=fixture(),root=f.insert('<strong>以前の表示</strong>'),counter=f.countText(root.querySelector('strong'));
  counter.setAttribute('data-march-countdown','unit_one');f.mutate([{type:'attributes',target:counter,attributeName:'data-march-countdown'}]);f.reset();f.ui.refresh();
  assert.match(counter.textContent,/到着まで/);assert.equal(f.counts.textWrites,1);assert.equal(f.counts.bodyScans,0);
  counter.removeAttribute('data-march-countdown');f.mutate([{type:'attributes',target:counter,attributeName:'data-march-countdown'}]);counter.textContent='新しい表示';f.reset();f.clock.elapsedMs+=5000;f.ui.refresh();assert.equal(counter.textContent,'新しい表示');assert.equal(f.counts.textWrites,0);
 });
 await test('open list retains its countdown nodes and focus while the world is paused',()=>{
  const f=fixture();f.ui.open();const dialog=f.doc.querySelector('dialog'),body=dialog.querySelector('.travel-body'),counter=f.countText(dialog.querySelector('[data-travel-countdown]'));
  const close=dialog.querySelector('[data-travel-close]');close.focus();body.scrollTop=240;f.clock.running=false;f.ui.refresh();f.reset();
  for(let i=0;i<60;i++)f.ui.refresh();assert.equal(f.counts.localReads,60);assert.equal(f.counts.textWrites,0);assert.equal(f.counts.bodyScans,0);
  assert.equal(dialog.querySelector('[data-travel-countdown]'),counter);assert.equal(f.doc.activeElement,close);assert.equal(body.scrollTop,240);assert.match(counter.textContent,/停止中/);
 });
 await test('subscribers share the refresh snapshot and stop receiving updates when removed',()=>{
  const f=fixture();let last=null,notifications=0;const unsubscribe=f.ui.subscribe((data,clock)=>{notifications++;last={data,clock};});
  assert.equal(notifications,1);f.reset();f.clock.speed=4;f.clock.elapsedMs+=4000;f.ui.refresh();
  assert.equal(f.counts.localReads,1);assert.equal(notifications,2);assert.equal(last.clock.speed,4);assert.equal(last.clock.elapsedMs,f.clock.elapsedMs);assert.equal(last.data.active.length,1);
  unsubscribe();f.ui.refresh();assert.equal(notifications,2);assert.equal(f.timers.size,1);
 });
 await test('hidden tabs cancel the fallback and resume immediately without synthesizing an arrival',()=>{
  const f=fixture();f.ui.open();const dialog=f.doc.querySelector('dialog'),counter=dialog.querySelector('[data-travel-countdown]'),before=counter.textContent;f.reset();
  f.visibility(true);assert.equal(f.timers.size,0);assert.equal(f.counts.localReads,0);
  f.clock.elapsedMs=1000+route.durationMs+10000;f.visibility(false);
  assert.equal(f.counts.localReads,1);assert.equal(f.timers.size,1);assert.equal(counter.textContent,'到着を確認中');assert.notEqual(counter.textContent,before);assert.equal(f.counts.arrivals,0);
  const done=march('unit_one',{status:'resolved',battle:{won:true}});f.rows([done]);f.ui.refresh();assert.equal(f.counts.arrivals,1);f.ui.refresh();assert.equal(f.counts.arrivals,1,'the authoritative arrival is reported once');
 });
 await test('a corrected report with the same id updates losses while keeping the back button and scroll',()=>{
  const f=fixture({rows:[march('unit_one',{status:'resolved',battle:{won:true,ourLost:100}})]});f.ui.open();
  const dialog=f.doc.querySelector('dialog');dialog.querySelector('[data-travel-report]').dispatchEvent({type:'click'});
  const body=dialog.querySelector('.travel-body'),back=dialog.querySelector('[data-travel-back]');back.focus();body.scrollTop=160;
  assert.match(dialog.textContent,/自軍の損失100人/);f.rows([march('unit_one',{status:'resolved',battle:{won:true,ourLost:245}})]);f.ui.refresh();
  assert.match(dialog.textContent,/自軍の損失245人/);assert.equal(f.doc.activeElement,dialog.querySelector('[data-travel-back]'));assert.equal(body.scrollTop,160);
 });
 await test('late server results from another campaign cannot replace a new scope',async()=>{
  let resolve;const reply=new Promise(done=>{resolve=done;});const f=fixture({context:{scope:'owner:old',started:true,linked:true,ready:true},request:()=>reply});
  f.context.scope='owner:new';f.context.linked=false;f.rows([march('new_unit')]);f.ui.refresh();
  resolve({ok:true,serverNow:123,active:[],history:[march('old_unit',{authority:'server',status:'resolved',battle:{won:true}})]});for(let i=0;i<10;i++)await Promise.resolve();
  const data=f.ui.snapshot();assert.equal(data.active[0].id,'new_unit');assert.equal(data.history.length,0);assert.equal(f.counts.arrivals,0);
 });
 console.log(`${checks} travel work/continuity checks passed. 60 ticks: 60 local reads, 0 document rescans; unchanged counters: 0 DOM text writes.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
