'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const {create}=require('../live-dom.js');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}
function fixture(markup=''){
 const {doc,host}=setup();host.innerHTML=markup;let observer,queries=0;
 const original=doc.querySelectorAll.bind(doc);doc.querySelectorAll=selector=>{queries++;return original(selector);};
 class Observer{
  constructor(callback){this.callback=callback;this.records=[];observer=this;}
  observe(_root,options){this.options=options;}
  takeRecords(){return this.records.splice(0);}
  disconnect(){this.disconnected=true;}
 }
 const registry=create(doc,Observer),record=value=>observer.records.push(value);
 return{doc,host,registry,observer,queries:()=>queries,record,attribute:(target,attributeName)=>record({type:'attributes',target,attributeName}),children:(target,addedNodes=[],removedNodes=[])=>record({type:'childList',target,addedNodes,removedNodes})};
}
test('60 unchanged ticks and changing clock text never rescan the document',()=>{
 const f=fixture('<button data-action="train">訓練</button><span data-job-clock="farm">60秒</span><span data-cost-resource="gold">100</span>');
 const selectors=['[data-action]','[data-job-clock]','[data-cost-resource]'];selectors.forEach(selector=>f.registry.nodes(selector));const initial=f.queries();
 const clock=f.host.querySelector('[data-job-clock]');
 for(let tick=0;tick<60;tick++){
  const removed=[...clock.childNodes];clock.textContent=String(60-tick)+'秒';f.children(clock,[...clock.childNodes],removed);
  for(const selector of selectors)assert.equal(f.registry.nodes(selector).length,1);
 }
 assert.equal(initial,3);assert.equal(f.queries(),initial,'Text-only updates do not invalidate live control membership');
});
test('new views, moved nodes, detached trees and same-task refresh retain the right controls',()=>{
 const f=fixture('<section id="old"><button data-action="train">元の訓練</button></section><section id="next"></section>');
 const old=f.host.querySelector('#old'),next=f.host.querySelector('#next'),train=old.firstElementChild;
 assert.deepEqual(f.registry.nodes('[data-action]'),[train]);const scans=f.queries();
 next.appendChild(train);f.children(old,[],[train]);f.children(next,[train]);assert.deepEqual(f.registry.nodes('[data-action]'),[train]);
 const section=f.doc.createElement('section');section.innerHTML='<button data-action="research">研究</button><span data-cost-resource="wood">30</span>';
 next.appendChild(section);f.children(next,[section]);const research=section.firstElementChild;
 assert.deepEqual(new Set(f.registry.nodes('[data-action]')),new Set([train,research]),'takeRecords applies an insertion before the observer microtask');
 section.remove();f.children(next,[],[section]);assert.deepEqual(f.registry.nodes('[data-action]'),[train]);
 next.appendChild(section);f.children(next,[section]);f.observer.callback(f.observer.takeRecords());assert(f.registry.nodes('[data-action]').includes(research));
 assert.equal(f.queries(),scans,'Only changed subtrees are inspected after initial membership');
 next.remove();f.children(f.host,[],[next]);assert.deepEqual(f.registry.nodes('[data-action]'),[]);
});
test('selector-changing attributes update membership without watching every decoration attribute',()=>{
 const f=fixture('<button id="candidate">候補</button>'),button=f.host.firstElementChild;
 assert.deepEqual(f.registry.nodes('[data-action]'),[]);button.dataset.action='train';f.attribute(button,'data-action');assert.deepEqual(f.registry.nodes('[data-action]'),[button]);
 button.removeAttribute('data-action');f.attribute(button,'data-action');assert.deepEqual(f.registry.nodes('[data-action]'),[]);
 const selectors='#new-start-castle,#new-difficulty,.clan-choice,[data-action="choose-residency-mode"],[data-action="residency-retry"]';
 assert.deepEqual(f.registry.nodes(selectors),[]);button.classList.add('clan-choice');f.attribute(button,'class');assert.deepEqual(f.registry.nodes(selectors),[button]);
 button.classList.remove('clan-choice');f.attribute(button,'class');assert.deepEqual(f.registry.nodes(selectors),[]);
 button.id='new-start-castle';f.attribute(button,'id');assert.deepEqual(f.registry.nodes(selectors),[button]);
 assert(!f.observer.options.attributeFilter.includes('style'));assert(!f.observer.options.attributeFilter.includes('aria-label'));assert(!f.observer.options.attributeFilter.includes('disabled'));
});
test('unsupported queries, old browsers and a disposed index use current DOM directly',()=>{
 const f=fixture('<button>一</button>');assert.equal(f.registry.nodes('button').length,1);
 const second=f.doc.createElement('button');f.host.appendChild(second);assert.equal(f.registry.nodes('button').length,2);
 const noObserver=create(f.doc,null);assert.equal(noObserver.nodes('[data-action]').length,0);second.dataset.action='train';assert.equal(noObserver.nodes('[data-action]').length,1);
 f.registry.dispose();assert(f.observer.disconnected);second.removeAttribute('data-action');assert.equal(f.registry.nodes('[data-action]').length,0);
});
test('a large insertion batch avoids pairwise subtree comparisons and visits nested insertions once',()=>{
 const f=fixture();f.registry.nodes('[data-action]');
 let subtreeComparisons=0,subtreeQueries=0;
 // Model the browser's native connection test separately from the intentionally
 // recursive fixture implementation, then count actual root-selection work.
 f.doc.body.contains=()=>true;
 const nodes=[];
 for(let i=0;i<1024;i++){
  const row=f.doc.createElement('section'),button=f.doc.createElement('button');button.dataset.action='train';row.appendChild(button);f.host.appendChild(row);
  const contains=row.contains.bind(row),query=row.querySelectorAll.bind(row);
  row.contains=node=>{subtreeComparisons++;return contains(node);};
  row.querySelectorAll=selector=>{subtreeQueries++;return query(selector);};
  f.children(f.host,[row]);f.children(row,[button]);nodes.push(button);
 }
 assert.deepEqual(f.registry.nodes('[data-action]'),nodes);
 assert.equal(subtreeComparisons,0,'No all-pairs inserted-tree contains() work');
 assert.equal(subtreeQueries,1024,'Each outer insertion is inspected exactly once');
});
function liveFunction(){const start=source.indexOf('  function refreshLiveControls('),end=source.indexOf('\n  function ',start+1);assert(start>=0&&end>start);return source.slice(start,end);}
test('mounted recruitment buttons share one fresh batch and hidden panes do no quote work',()=>{
 const rosterScope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),rosterScope);
 const game=new E({officers:JSON.parse(JSON.stringify(rosterScope.window.SENGOKU_OFFICERS)),seed:71});
 const ids=game.searchOfficers().filter(officer=>!game.state.officers.includes(officer.id)).slice(0,12).map(officer=>officer.id);
 const rows=ids.map(id=>'<article><button data-action="recruit-officer" data-id="'+id+'">登用</button><span data-recruit-reason="'+id+'"></span></article>').join('');
 const f=fixture('<section>'+rows+'</section><dialog>'+rows+'</dialog><section hidden>'+rows+'</section><section inert>'+rows+'</section>');
 const context={document:f.doc,window:{SengokuLiveDOM:f.registry},game,data:D,state:()=>game.state,currentView:'officers',saveEnabled:true,mutationActions:new Set(['recruit-officer']),canMutate:()=>true,
  $:()=>null,refreshTouchHeaderStatus(){},refreshBranchDeploymentPanels(){},hasResources:cost=>D.resources.every(key=>game.state.resources[key]>=(cost?.[key]||0)),num:String};
 vm.createContext(context);vm.runInContext(liveFunction(),context);
 let batches=0,individual=0,quoted=[];const batch=game.canRecruitOfficers.bind(game),single=game.canRecruitOfficer.bind(game);
 game.canRecruitOfficers=values=>{batches++;quoted=[...values];return batch(values);};game.canRecruitOfficer=(id,modifiers)=>{if(!modifiers)individual++;return single(id,modifiers);};
 const before=JSON.stringify(game.state);context.refreshLiveControls();assert.equal(batches,1);assert.equal(individual,0);assert.deepEqual(quoted,ids);assert.equal(JSON.stringify(game.state),before);
 const visible=f.host.firstElementChild,buttons=visible.querySelectorAll('button'),reasons=visible.querySelectorAll('[data-recruit-reason]');
 for(let i=0;i<ids.length;i++){const expected=single(ids[i]);assert.equal(buttons[i].disabled,!expected.ok);assert.equal(reasons[i].textContent,expected.ok?'':expected.reason);}
 game.state.resources.gold=0;context.refreshLiveControls();assert.equal(batches,2);assert.equal(individual,0);assert(buttons.every(button=>button.disabled));assert(reasons.every(node=>node.textContent.length>0));
 const dialog=f.host.querySelector('dialog');dialog.open=true;context.refreshLiveControls();assert.equal(batches,3);assert(dialog.querySelectorAll('button').every(button=>button.disabled));
 visible.setAttribute('hidden','');dialog.open=false;context.refreshLiveControls();assert.equal(batches,3,'No recruitment is quoted when every roster pane is hidden');
});
test('visually present decorative ability bars update even when hidden from assistive reading',()=>{
 const game=new E({seed:19}),f=fixture('<span data-army-health-stat="lead"></span><div aria-hidden="true"><i data-army-health-stat-bar="lead"></i></div><section hidden><i data-army-health-stat-bar="lead"></i></section>');
 let lead=80;game.armyStats=()=>({lead});
 const context={document:f.doc,window:{SengokuLiveDOM:f.registry},game,data:D,state:()=>game.state,currentView:'army',saveEnabled:true,mutationActions:new Set(),canMutate:()=>true,
  $:()=>null,refreshTouchHeaderStatus(){},refreshBranchDeploymentPanels(){},num:String};
 vm.createContext(context);vm.runInContext(liveFunction(),context);context.refreshLiveControls();
 const bars=f.host.querySelectorAll('[data-army-health-stat-bar]');assert.equal(bars[0].style.width,'80%');assert.equal(bars[1].style.width,undefined);
 lead=42;context.refreshLiveControls();assert.equal(f.host.querySelector('[data-army-health-stat]').textContent,'42');assert.equal(bars[0].style.width,'42%');
});
console.log(`${checks} live DOM and recruitment checks passed. 60 unchanged ticks: 0 document rescans after the initial three selector reads.`);
