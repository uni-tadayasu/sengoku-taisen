/* Actual engine queues through the application helpers, rendered only in a VM. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine,SENGOKU_DATA}=require('../engine.js');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
function fn(name){const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);const first=source.indexOf('\n',start);if(source.slice(start,first).endsWith('}'))return source.slice(start,first);const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
function harness(game=new SengokuEngine({clan:'織田家',seed:7})){
 const controls=[],clocks=[],progress=[],calls={saved:[],modal:[],render:0,refresh:0},flags={failSave:false};
 game.state.resources={gold:100000000,rice:100000000,wood:100000000,stone:100000000};game.state.command=game.commandMax();
 const c={currentView:'town',activeModal:'',console,Date,Math,Set,Number,String,JSON,game,staffBaseId:'kyoto_gosho',data:SENGOKU_DATA,state:()=>game.state,window:{},document:{querySelectorAll(selector){return selector==='[data-action]'?controls:selector==='[data-job-clock]'?clocks:selector==='[data-job-progress]'?progress:[];}},$:()=>null,
 saveEnabled:true,syncAccess:{reason:'writer'},staffBaseReady:game.isStaff===true,mutationActions:new Set(['upgrade','upgrade-castle']),canMutate:()=>true,canStartNew:()=>true,syncMessage:()=>'',canCommand:true,
 icon:()=>'',esc:value=>String(value??'').replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v])),num:value=>String(value),resNames:{gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},resIcons:{},governorHelp:{},buildingOutput:id=>game.buildingSummary(id),
 modal(...args){calls.modal.push(args);},save(){if(flags.failSave)return false;calls.saved.push(game.exportSave());return true;},render(){calls.render++;},renderHeader(){},refreshTouchHeaderStatus(){},refreshBranchDeploymentPanels(){},preserveInteraction(_container,draw){draw();},refreshActiveModal(){calls.refresh++;c.buildingModal('farm');},playNote(){},
 };
 vm.createContext(c);vm.runInContext(['constructionJobs','currentJob','constructionCount','buildingChain','buildingTailLevel','jobKey','jobDuration','jobClockText','refreshJobTimers','staffConstructionReady','castleLevelLimit','hasResources','costHtml','sharedJobAttribution','buildingQueueHtml','facilityMaintenanceHtml','buildingAvailability','buildingModal','refreshLiveControls','upgradeDurableBuilding'].map(fn).join('\n'),c);
 return{c,game,controls,clocks,progress,calls,flags,html:()=>calls.modal.at(-1)?.[2]||'',footer:()=>calls.modal.at(-1)?.[3]||''};
}
function upgrade(h,id='farm'){h.game.state.command=h.game.commandMax();const result=h.c.upgradeDurableBuilding(id);assert.equal(result.ok,true,result.message);return result;}
function mountBuilding(h,id='farm'){
 const {doc,host}=setup(),dialog=doc.createElement('dialog');doc.body.appendChild(dialog);host.innerHTML='<input id="draft">';
 h.c.document=doc;h.c.$=selector=>doc.querySelector(selector);h.c.modal=(_title,_subtitle,body,footer)=>{dialog.innerHTML='<div class="modal-body">'+body+'</div><footer>'+footer+'</footer>';dialog.showModal();};h.c.buildingModal(id);
 return{doc,host,dialog,button:dialog.querySelector('[data-action="upgrade"]'),reason:dialog.querySelector('[data-building-order-reason]')};
}
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}
test('repeated facility upgrades keep the modal open, pay the next level once and show current versus reserved levels',()=>{
 const h=harness(),start=h.game.state.buildings.farm,cost1=h.game.costs('farm'),before=h.game.state.resources.gold;h.c.buildingModal('farm');const first=upgrade(h),cost2=h.game.costs('farm');const second=upgrade(h);
 assert.equal(first.targetLevel,start+1);assert.equal(second.targetLevel,start+2);assert.equal(second.queued,true);assert.equal(h.game.state.buildings.farm,start);assert.equal(h.game.state.resources.gold,before-cost1.gold-cost2.gold);assert.equal(h.calls.saved.length,2);assert.equal(h.calls.refresh,2);
 assert.match(h.html(),new RegExp(`現在の効果 · Lv\\.${start}`));assert.match(h.html(),new RegExp(`Lv\\.${start+2}まで手配済み`));assert.match(h.html(),/次の増築を予約/);assert.match(h.html(),/予約の取り消しはできません/);assert.match(h.footer(),/data-action="upgrade"/);
 const restored=SengokuEngine.fromSave(h.calls.saved.at(-1));assert.equal(restored.state.jobs.filter(j=>j.id==='farm').length,2);assert.equal(restored.state.resources.gold,h.game.state.resources.gold);
});
test('a full construction allotment permits another stage of the same facility but rejects a new chain',()=>{
 const h=harness();h.game.state.buildings.keep=8;for(const id of ['farm','market','lumber'])upgrade(h,id);assert.equal(h.c.constructionCount(false),h.game.constructionSlots());
 h.game.state.command=h.game.commandMax();h.controls.push({dataset:{action:'upgrade',id:'farm'}},{dataset:{action:'upgrade',id:'quarry'}});h.c.refreshLiveControls();assert.equal(h.controls[0].disabled,false);assert.equal(h.controls[1].disabled,true);
 upgrade(h);assert.equal(h.c.constructionCount(false),3);assert.equal(h.game.state.jobs.length,4);
});
test('a full construction allotment explains the disabled facility action and links to its exact schedule',()=>{
 const h=harness();upgrade(h,'market');upgrade(h,'lumber');h.game.state.command=h.game.commandMax();const before=JSON.stringify(h.game.state),{button,reason,dialog}=mountBuilding(h);
 assert(reason,'the facility detail should explain why a displayed action is unavailable');assert.match(reason.textContent,/普請枠.*2.*2/);assert(button.disabled);assert.equal(button.getAttribute('aria-describedby'),reason.id);
 const next=dialog.querySelector('[data-building-next-step="slots"]');assert.equal(next.getAttribute('data-action'),'command-activity');assert.equal(next.getAttribute('data-filter'),'construction');assert(!next.hasAttribute('hidden'));assert.equal(JSON.stringify(h.game.state),before);
});
test('facility availability explains the real engine guards without changing resources, commands or queues',()=>{
 const scenarios=[
  {prepare(){},id:'farm',ok:true,state:'available',reason:/指令1回/},
  {prepare(s){s.command=0;},id:'farm',ok:false,state:'command',reason:/指令が1回/},
  {prepare(s){s.resources.gold=0;s.resources.wood=0;},id:'farm',ok:false,state:'resources',reason:/金銭・木材/},
  {prepare(s){s.buildings.keep=0;},id:'farm',ok:false,state:'locked',reason:/天守.*1/},
  {prepare(s){s.buildings.farm=32;},id:'farm',ok:false,state:'complete',reason:/最高レベル/},
  {prepare(s){s.gameOver=true;},id:'farm',ok:false,state:'waiting',reason:/本拠を失い/},
  {prepare(){},id:'missing',ok:false,state:'waiting',reason:/見つかりません/}
 ];
 for(const scenario of scenarios){const h=harness();scenario.prepare(h.game.state);const before=JSON.stringify(h.game.state),view=h.c.buildingAvailability(scenario.id);assert.equal(view.ok,scenario.ok,scenario.state);assert.equal(view.state,scenario.state);assert.match(view.reason,scenario.reason);assert.equal(JSON.stringify(h.game.state),before);assert.equal(h.game.upgrade(scenario.id).ok,scenario.ok,scenario.state);}
});
test('the locked facility keeps a direct path to its required keep and same-chain reservations explain their slot use',()=>{
 const h=harness();h.game.state.buildings.keep=0;const {reason,button,dialog}=mountBuilding(h),next=dialog.querySelector('[data-building-next-step="locked"]');
 assert(button.disabled);assert.match(reason.textContent,/天守/);assert.equal(next.getAttribute('data-action'),'building');assert.equal(next.getAttribute('data-id'),'keep');assert(!next.hasAttribute('hidden'));
 const queued=harness();upgrade(queued,'farm');upgrade(queued,'market');queued.game.state.command=queued.game.commandMax();const before=JSON.stringify(queued.game.state),view=queued.c.buildingAvailability('farm');assert(view.ok);assert.match(view.reason,/前の工事/);assert.match(view.reason,/追加の普請枠は使いません/);assert.equal(JSON.stringify(queued.game.state),before);
});
test('live facility reasons preserve nodes, draft, focus, selection and scroll as the actual blockers change',()=>{
 const h=harness(),{doc,host,dialog,button,reason}=mountBuilding(h),draft=host.querySelector('#draft'),body=dialog.querySelector('.modal-body');draft.value='次に田を増築';draft.focus();draft.setSelectionRange(1,4);dialog.scrollTop=29;body.scrollTop=187;
 h.game.state.command=0;h.c.refreshLiveControls();assert(button.disabled);assert.match(reason.textContent,/指令が1回/);
 h.game.state.command=h.game.commandMax();h.game.state.resources.gold=0;h.c.refreshLiveControls();assert(button.disabled);assert.match(reason.textContent,/金銭が不足/);
 h.game.state.resources.gold=100000000;h.game.state.jobs=['market','lumber'].map(id=>({kind:'building',id,targetLevel:2,totalSeconds:60,remainingSeconds:40}));h.c.refreshLiveControls();assert(button.disabled);assert.match(reason.textContent,/普請枠/);assert.equal(dialog.querySelector('[data-building-next-step="slots"]').hidden,false);
 h.game.state.jobs=[];h.c.refreshLiveControls();assert(!button.disabled);assert.match(reason.textContent,/普請1枠/);assert.equal(dialog.querySelector('[data-building-next-step="slots"]').hidden,true);
 let removals=0;doc.onRemove=()=>{removals++;};for(let i=0;i<60;i++)h.c.refreshLiveControls();assert.equal(removals,0,'unchanged explanations must not replace text nodes');
 assert.strictEqual(dialog.querySelector('[data-action="upgrade"]'),button);assert.strictEqual(dialog.querySelector('[data-building-order-reason]'),reason);assert.strictEqual(doc.activeElement,draft);assert.equal(draft.value,'次に田を増築');assert.deepEqual([draft.selectionStart,draft.selectionEnd],[1,4]);assert.equal(dialog.scrollTop,29);assert.equal(body.scrollTop,187);
});
test('temporary sync barriers stay quiet and retain gameplay guidance while durable blockers remain explicit',()=>{
 const h=harness(),notices=require('../sync-notices.js');h.c.window.SengokuSyncNotices=notices;h.c.canMutate=()=>false;
 for(const status of ['pending','applying','conflict','hidden','lease-expired']){h.c.syncAccess={reason:status};const before=JSON.stringify(h.game.state),view=h.c.buildingAvailability('farm');assert(!view.ok);assert.equal(view.state,'available');assert.match(view.reason,/指令1回/);assert(!/同期|保存|確認しています/.test(view.reason));assert.equal(JSON.stringify(h.game.state),before);}
 h.c.syncAccess={reason:'follower'};assert.match(h.c.buildingAvailability('farm').reason,/この端末/);h.c.canMutate=()=>true;h.c.saveEnabled=false;assert.match(h.c.buildingAvailability('farm').reason,/保存できる状態/);
});
test('each queued stage has its own clock and stays at zero progress until it actually starts',()=>{
 const h=harness();upgrade(h);upgrade(h);const jobs=h.game.constructionJobs().filter(j=>j.id==='farm');for(const job of jobs){h.clocks.push({dataset:{jobClock:h.c.jobKey(job)},textContent:''});h.progress.push({dataset:{jobProgress:h.c.jobKey(job)},style:{}});}
 h.c.refreshJobTimers();assert.notEqual(h.clocks[0].dataset.jobClock,h.clocks[1].dataset.jobClock);assert.match(h.clocks[0].textContent,/経過/);assert.match(h.clocks[1].textContent,/着工まで/);assert.equal(h.progress[1].style.width,'0%');
 h.game.state.jobs[0].remainingSeconds=20;h.game.state.jobs[0].remaining=1;h.c.refreshJobTimers();assert.match(h.clocks[0].textContent,/あと 20秒/);assert.match(h.clocks[1].textContent,/着工まで 20秒/);assert.match(h.clocks[1].textContent,/工期 1分00秒/);
});
test('level 32 is the last reservation and the displayed facility remains at its completed level',()=>{
 const h=harness();h.game.state.buildings.farm=30;upgrade(h);upgrade(h);h.c.buildingModal('farm');assert.equal(h.game.state.buildings.farm,30);assert.equal(h.c.buildingTailLevel('farm'),32);assert.match(h.html(),/Lv\.32まで予約済み/);assert(!h.footer().includes('data-action="upgrade"'));h.controls.push({dataset:{action:'upgrade',id:'farm'}});h.c.refreshLiveControls();assert.equal(h.controls[0].disabled,true);
});
test('Sento details use their own twenty-stage limit and do not expose an unavailable legacy facility',()=>{
 const h=harness(new SengokuEngine({isSento:true,seed:7}));h.game.state.buildings.farm=19;h.game.state.buildings.gold_mine=31;
 h.c.buildingModal('farm');assert.match(h.calls.modal.at(-1)[0],/19 \/ 20/);assert.match(h.html(),/20段階の姿を見る/);assert(!h.html().includes('32段階'));
 upgrade(h,'farm');h.c.buildingModal('farm');assert.match(h.html(),/Lv\.20まで予約済み/);assert(!h.footer().includes('data-action="upgrade"'));
 const count=h.calls.modal.length;h.c.buildingModal('gold_mine');assert.equal(h.calls.modal.length,count);assert.equal(h.c.buildingAvailability('gold_mine').ok,false);
 h.game.state.jobs=[];h.game.state.buildings.farm=32;h.c.buildingModal('farm');assert.match(h.calls.modal.at(-1)[0],/20 \/ 20/);assert.equal(h.game.state.buildings.farm,32,'legacy growth stays stored while the own facility display is capped');
});
test('failed durability restores the resources, command and complete queue without redrawing or adding a receipt',()=>{
 const h=harness();upgrade(h);h.game.state.command=h.game.commandMax();const before=plain(h.game.state),saved=h.calls.saved.length,renders=h.calls.render;h.flags.failSave=true;const result=h.c.upgradeDurableBuilding('farm');assert.equal(result.ok,false);assert.deepEqual(plain(h.game.state),before);assert.equal(h.calls.saved.length,saved);assert.equal(h.calls.render,renders);
});
test('staff shared reservations distinguish their actor and timing from a surviving personal chain',()=>{
 const g=new SengokuEngine({clan:'伊達家',seed:8});g.state.jobs=[{kind:'building',id:'farm',targetLevel:2,remainingSeconds:50,totalSeconds:60,remaining:1,total:1}];g.setRoleAccess({isStaff:true});
 const buildings={...g.state.buildings,farm:5,keep:10},base={id:'kyoto_gosho',revision:3,castleLevel:6,buildings,initial:{castleLevel:6,buildings:{...buildings}},history:[],updatedElapsedMs:0,accessSinceElapsedMs:0,personalClan:'伊達家',protected:true,jobs:[{jobId:'shared-a',kind:'building',id:'farm',targetLevel:6,totalSeconds:60,startedElapsedMs:0,completesElapsedMs:60000,startedBy:{id:'private-a',name:'<staff>'}},{jobId:'shared-b',kind:'building',id:'farm',targetLevel:7,totalSeconds:120,startedElapsedMs:60000,completesElapsedMs:180000,startedBy:{id:'private-b',name:'担当二'}}]};
 assert.equal(g.applyStaffBase(base).ok,true);const h=harness(g);h.c.buildingModal('farm');assert.match(h.html(),/building:farm:shared:6/);assert.match(h.html(),/building:farm:shared:7/);assert.match(h.html().replace(/<[^>]*>/g,''),/&lt;staff&gt;が着手/);assert.match(h.html().replace(/<[^>]*>/g,''),/担当二が予約/);assert(!h.html().includes('private-a'));assert(!h.html().includes('building:farm:personal'));assert.equal(h.c.constructionCount(true),1);assert.equal(h.c.constructionCount(false),1);assert.equal(h.c.currentJob('building','farm','personal',2).targetLevel,2);assert.equal(h.c.currentJob('building','farm','shared',7).targetLevel,7);
 assert.equal(h.c.buildingAvailability('farm').ok,true);h.c.staffBaseReady=false;const waiting=h.c.buildingAvailability('farm');assert.equal(waiting.ok,false);assert.equal(waiting.reason,'','unverified shared progress remains quiet');const mounted=mountBuilding(h);assert(mounted.button.disabled);assert(mounted.reason.closest('[data-building-availability]').hasAttribute('hidden'));
});
console.log(`${count} sequential construction UI checks passed. No external requests.`);
