'use strict';
// Live meters share the game's incremental DOM registry, and closed UI does no
// projection work. This fixture counts work, not machine-specific frame time.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const {create}=require('../live-dom.js');
function fixture(markup=''){
 const {doc,host}=setup();doc.hidden=false;host.innerHTML=markup;
 let observer,scans=0,healthBatches=0,healthIds=[],castleReads=[];
 const original=doc.querySelectorAll.bind(doc);doc.querySelectorAll=selector=>{scans++;return original(selector);};
 class Observer{constructor(callback){this.callback=callback;this.records=[];observer=this;}observe(){}takeRecords(){return this.records.splice(0);}disconnect(){}}
 const registry=create(doc,Observer),win={document:doc,SengokuLiveDOM:registry,SENGOKU_AT_TITLE:false};
 const state={current:50,max:100};
 const game={officerHealth:id=>({current:state.current,factor:.75}),armyHealth(ids){healthBatches++;healthIds.push([...ids]);return{officers:ids.map(id=>({id,current:state.current,factor:.75,recovering:true}))};},castle(id){castleReads.push(id);return{durability:{...state,recoveryPerMonth:10}};},branch(id){castleReads.push('branch:'+id);return{durability:{...state,recoveryPerMonth:10}};}};
 for(const file of ['officer-health.js','durability.js'])vm.runInNewContext(fs.readFileSync(require.resolve('../'+file),'utf8'),{window:win});
 const refresh=()=>{win.SengokuOfficerHealthUI.refresh(doc,game);win.SengokuDurabilityUI.refresh(doc,game);};
 const meter=id=>win.SengokuOfficerHealthUI.markup(game,id,{deferred:true});
 const wall=(id,kind='castle')=>win.SengokuDurabilityUI.markup({current:20,max:100,recoveryPerMonth:10},{kind,id,live:true});
 const children=(target,addedNodes=[],removedNodes=[])=>observer.records.push({type:'childList',target,addedNodes,removedNodes});
 return{doc,host,win,game,state,registry,refresh,meter,wall,children,attribute:(target,attributeName)=>observer.records.push({type:'attributes',target,attributeName}),counts:()=>({scans,healthBatches,healthIds,castleReads}),reset(){scans=0;healthBatches=0;healthIds=[];castleReads=[];}};
}
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}
test('60 ticks never rescan the document or project closed, hidden, inert or title-only game meters',()=>{
 const f=fixture();f.host.id='app';
 const visibleIds=['one','two','three'],hiddenIds=Array.from({length:256},(_,i)=>'hidden_'+i);
 f.host.innerHTML='<section id="visible">'+visibleIds.map(f.meter).join('')+f.meter('one')+f.wall('home')+f.wall('home')+'</section><dialog id="closed">'+hiddenIds.map(f.meter).join('')+f.wall('closed-castle')+'</dialog><section hidden>'+f.meter('hidden')+f.wall('hidden-castle')+'</section><section inert>'+f.meter('inert')+f.wall('inert-castle')+'</section>';
 f.refresh();f.reset();
 for(let tick=0;tick<60;tick++){f.state.current=25+tick;f.refresh();}
 const counts=f.counts();assert.equal(counts.scans,0);assert.equal(counts.healthBatches,60);assert(counts.healthIds.every(ids=>JSON.stringify(ids)===JSON.stringify(visibleIds)));assert.deepEqual(counts.castleReads,Array(60).fill('home'));
 assert.equal(f.host.querySelector('#visible [data-health-current]').textContent,'84');assert.equal(f.host.querySelector('#closed [data-health-current]').textContent,'—');
 f.win.SENGOKU_AT_TITLE=true;f.reset();f.refresh();assert.equal(f.counts().healthBatches,0);assert.equal(f.counts().castleReads.length,0);
 f.win.SENGOKU_AT_TITLE=false;f.doc.hidden=true;f.reset();f.refresh();assert.equal(f.counts().healthBatches,0);assert.equal(f.counts().castleReads.length,0);assert.equal(f.counts().scans,0);
});
test('reopening retained panes immediately catches up without changing inputs, focus or scroll',()=>{
 const f=fixture();f.host.innerHTML='<input id="draft"><dialog id="pane">'+f.meter('one')+f.wall('home')+'</dialog>';f.refresh();
 const input=f.host.querySelector('#draft'),pane=f.host.querySelector('#pane');input.value='守備の予定';input.setSelectionRange(1,3);input.focus();f.host.scrollTop=201;
 f.state.current=73;pane.open=true;f.refresh();
 assert.equal(pane.querySelector('[data-health-current]').textContent,'73');assert.equal(pane.querySelector('[data-durability-current]').textContent,'73');assert.equal(f.doc.activeElement,input);assert.equal(input.value,'守備の予定');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);assert.equal(f.host.scrollTop,201);
 pane.open=false;f.state.current=40;f.reset();f.refresh();assert.equal(f.counts().healthBatches,0);assert.equal(f.counts().castleReads.length,0);
 pane.open=true;f.refresh();assert.equal(pane.querySelector('[data-health-current]').textContent,'40');assert.equal(pane.querySelector('[data-durability-current]').textContent,'40');
});
test('insertions, selector changes, identity changes and removals are reflected in the same task',()=>{
 const f=fixture();f.refresh();f.reset();
 const section=f.doc.createElement('section');section.innerHTML=f.meter('one')+f.wall('home');f.host.appendChild(section);f.children(f.host,[section]);f.refresh();
 assert.deepEqual(f.counts().healthIds,[['one']]);assert.deepEqual(f.counts().castleReads,['home']);assert.equal(f.counts().scans,0);
 const health=section.querySelector('[data-officer-health]'),wall=section.querySelector('[data-durability-live]');
 health.setAttribute('data-officer-health','two');f.attribute(health,'data-officer-health');wall.setAttribute('data-durability-id','north');wall.setAttribute('data-durability-live','branch');f.attribute(wall,'data-durability-live');f.reset();f.refresh();assert.deepEqual(f.counts().healthIds,[['two']]);assert.deepEqual(f.counts().castleReads,['branch:north']);
 health.removeAttribute('data-officer-health');f.attribute(health,'data-officer-health');wall.removeAttribute('data-durability-live');f.attribute(wall,'data-durability-live');f.reset();f.refresh();assert.equal(f.counts().healthBatches,0);assert.equal(f.counts().castleReads.length,0);
 health.setAttribute('data-officer-health','three');f.attribute(health,'data-officer-health');wall.setAttribute('data-durability-live','castle');f.attribute(wall,'data-durability-live');f.refresh();assert.deepEqual(f.counts().healthIds,[['three']]);
 section.remove();f.children(f.host,[],[section]);f.reset();f.refresh();assert.equal(f.counts().healthBatches,0);assert.equal(f.counts().castleReads.length,0);assert.equal(f.counts().scans,0);
 f.host.appendChild(section);f.children(f.host,[section]);f.state.current=61;f.refresh();assert.equal(health.querySelector('[data-health-current]').textContent,'61');assert.equal(wall.querySelector('[data-durability-current]').textContent,'61');
});
test('direct subtree refreshes still work without an index, including the root meter itself',()=>{
 const f=fixture();delete f.win.SengokuLiveDOM;f.host.innerHTML=f.meter('one')+f.wall('home');
 const health=f.host.querySelector('[data-officer-health]'),wall=f.host.querySelector('[data-durability-live]');f.state.current=88;
 f.win.SengokuOfficerHealthUI.refresh(health,f.game);f.win.SengokuDurabilityUI.refresh(wall,f.game);assert.equal(health.querySelector('[data-health-current]').textContent,'88');assert.equal(wall.querySelector('[data-durability-current]').textContent,'88');
 health.remove();wall.remove();f.reset();f.win.SengokuOfficerHealthUI.refresh(health,f.game);f.win.SengokuDurabilityUI.refresh(wall,f.game);assert.equal(f.counts().healthBatches,0);assert.equal(f.counts().castleReads.length,0);
});
console.log(`${checks} live meter work/continuity groups passed. 60 ticks: 0 document rescans, 3 visible officer IDs per tick, 0 hidden projections.`);
