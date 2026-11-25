'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),{setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const roster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
function fn(name){const start=source.indexOf(`  function ${name}(`),lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;assert(start>=0&&end>start,name);return source.slice(start,end);}
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}
function fixture(){
 const game=new E({officers:roster,seed:4920}),{host,doc}=setup();game.state.buildings.academy=5;game.state.command=3;game.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};
 const c={game,data:D,state:()=>game.state,window:{},document:doc,$:selector=>doc.querySelector(selector),num:String,icon:()=>'',heading:()=>'',strategyEntry:()=>'',
  esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),resNames:{gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},
  saveEnabled:true,writable:true,canMutate:()=>c.writable,staffConstructionReady:()=>true,questState:'all',questPage:1,logPage:1,currentView:'research',activeModal:'',
  currentJob:(kind,id)=>game.state.jobs.find(job=>job.kind===kind&&job.id===id),costHtml:()=>'<div class="cost">費用</div>',jobKey:()=>'',jobClockText:()=>'',sharedJobAttribution:()=>'',pageControls:(_action,page,pages)=>`<p class="pagination">${page} / ${pages}</p>`,
  refreshTouchHeaderStatus(){},refreshBranchDeploymentPanels(){},mutationActions:new Set(['research','claim-quest']),hasResources:cost=>D.resources.every(key=>game.state.resources[key]>=(cost?.[key]||0))
 };
 vm.createContext(c);vm.runInContext(['researchAvailability','renderResearch','refreshLiveControls','catalogChips','questResults'].map(fn).join('\n'),c);return{c,game,host,doc};
}
test('research readiness agrees with real engine acceptance across prerequisites and insufficient resources',()=>{
 const scenarios=[
  [()=>{},true,/指令1回/],
  [s=>{s.command=0;},false,/指令が1回/],
  [s=>{s.resources.gold=0;},false,/金銭が不足/],
  [s=>{s.resources.wood=0;s.resources.stone=0;},false,/木材・石材が不足/],
  [s=>{s.buildings.academy=0;},false,/学問所をLv.1/],
  [s=>{s.tech.cultivation=5;},false,/すべての段階/],
  [s=>{s.gameOver=true;},false,/本拠を失い/],
  [s=>{s.jobs.push({kind:'research',id:'commerce',targetLevel:1,remainingSeconds:60,totalSeconds:60,remaining:1,total:1});},false,/完成後/]
 ];
 for(const[prepare,accepted,reason]of scenarios){const{c,game}=fixture();prepare(game.state);const before=JSON.stringify(game.state),view=c.researchAvailability('cultivation');assert.equal(view.ok,accepted);assert.match(view.reason,reason);assert.equal(JSON.stringify(game.state),before);assert.equal(game.research('cultivation').ok,accepted);}
});
test('read-only and unsavable sessions expose the actual UI guard without spending resources',()=>{
 const{c,game}=fixture(),before=JSON.stringify(game.state);c.writable=false;assert.equal(c.researchAvailability('cultivation').ok,false);assert.match(c.researchAvailability('cultivation').reason,/この端末/);c.writable=true;c.saveEnabled=false;assert.match(c.researchAvailability('cultivation').reason,/保存できる状態/);assert.equal(JSON.stringify(game.state),before);
});
test('live resource and command changes update the same research button and reason nodes',()=>{
 const{c,game,host,doc}=fixture();host.innerHTML='<input id="draft">'+c.renderResearch();const input=doc.querySelector('#draft'),button=doc.querySelector('[data-action="research"]'),id=button.getAttribute('data-id'),reason=doc.querySelector('#research-reason-'+id),card=button.closest('[data-research-card]');input.value='次の研究';input.focus();
 game.state.command=0;c.refreshLiveControls();assert(button.disabled);assert.match(button.textContent,/指令/);assert.match(reason.textContent,/指令が1回/);assert.equal(card.getAttribute('data-research-state'),'waiting');
 game.state.command=3;game.state.resources.gold=0;c.refreshLiveControls();assert(button.disabled);assert.match(reason.textContent,/金銭/);
 game.state.resources.gold=100000;c.refreshLiveControls();assert(!button.disabled);assert.equal(button.textContent,'研究を始める');assert.equal(card.getAttribute('data-research-state'),'available');assert.strictEqual(doc.querySelector('#research-reason-'+id),reason);assert.strictEqual(doc.querySelector('[data-action="research"]'),button);assert.strictEqual(doc.activeElement,input);assert.equal(input.value,'次の研究');
});
test('completed unclaimed quests appear first and each state filter reflects real reward status',()=>{
 const{c,game,host}=fixture();game.state.stats.upgrades=1;game.state.stats.wins=1;game.state.stats.researches=1;assert(game.claimQuest('first_upgrade').ok);const before=JSON.stringify(game.state);
 host.innerHTML=c.questResults();const first=host.querySelector('.quest-row');assert.equal(first.getAttribute('data-quest-state'),'ready');
 for(const kind of ['ready','progress','claimed']){c.questState=kind;c.questPage=100;host.innerHTML=c.questResults();assert(host.querySelectorAll('.quest-row').length>0);for(const row of host.querySelectorAll('.quest-row')){assert.equal(row.getAttribute('data-quest-state'),kind);const button=row.querySelector('[data-action="claim-quest"]'),status=game.questStatus(button.getAttribute('data-id'));assert.equal(button.hasAttribute('disabled'),kind!=='ready');assert.equal(status.claimed,kind==='claimed');assert.equal(status.complete,kind!=='progress');}}
 assert.equal(JSON.stringify(game.state),before);
});
test('claiming a reward removes it from ready results without allowing a second credit',()=>{
 const{c,game,host}=fixture();game.state.stats.upgrades=1;c.questState='ready';host.innerHTML=c.questResults();const id=host.querySelector('[data-action="claim-quest"]').getAttribute('data-id');assert(game.claimQuest(id).ok);const after=JSON.stringify(game.state);
 host.innerHTML=c.questResults();assert(!host.querySelector(`[data-action="claim-quest"][data-id="${id}"]`));assert(!game.claimQuest(id).ok);assert.equal(JSON.stringify(game.state),after);
});
test('empty state filters keep a clear route back to every quest',()=>{
 const{c,host}=fixture();c.questState='claimed';c.questPage=5;host.innerHTML=c.questResults();assert.equal(c.questPage,1);assert.equal(host.querySelectorAll('.quest-row').length,0);assert.match(host.textContent,/受け取った報酬はまだありません/);assert.equal(host.querySelector('[data-action="catalog-reset"]').getAttribute('data-kind'),'quest');
});
console.log(`${count} research availability and council reward checks passed.`);
