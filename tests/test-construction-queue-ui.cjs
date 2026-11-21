/* Actual engine queues through the application helpers, rendered only in a VM. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine,SENGOKU_DATA}=require('../engine.js');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),plain=value=>JSON.parse(JSON.stringify(value));
function fn(name){const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);const first=source.indexOf('\n',start);if(source.slice(start,first).endsWith('}'))return source.slice(start,first);const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
function harness(game=new SengokuEngine({clan:'織田家',seed:7})){
 const controls=[],clocks=[],progress=[],calls={saved:[],modal:[],render:0,refresh:0},flags={failSave:false};
 game.state.resources={gold:100000000,rice:100000000,wood:100000000,stone:100000000};game.state.command=game.commandMax();
 const c={console,Date,Math,Set,Number,String,JSON,game,data:SENGOKU_DATA,state:()=>game.state,window:{},document:{querySelectorAll(selector){return selector==='[data-action]'?controls:selector==='[data-job-clock]'?clocks:selector==='[data-job-progress]'?progress:[];}},$:()=>null,
 saveEnabled:true,staffBaseReady:game.isStaff===true,mutationActions:new Set(['upgrade','upgrade-castle']),canMutate:()=>true,canStartNew:()=>true,syncMessage:()=>'',canCommand:true,
 icon:()=>'',esc:value=>String(value??'').replace(/[&<>"']/g,v=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[v])),num:value=>String(value),resNames:{gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},resIcons:{},governorHelp:{},buildingOutput:id=>game.buildingSummary(id),
 modal(...args){calls.modal.push(args);},save(){if(flags.failSave)return false;calls.saved.push(game.exportSave());return true;},render(){calls.render++;},renderHeader(){},preserveInteraction(_container,draw){draw();},refreshActiveModal(){calls.refresh++;c.buildingModal('farm');},playNote(){},
 };
 vm.createContext(c);vm.runInContext(['constructionJobs','currentJob','constructionCount','buildingChain','buildingTailLevel','jobKey','jobDuration','jobClockText','refreshJobTimers','staffConstructionReady','castleLevelLimit','hasResources','costHtml','sharedJobAttribution','buildingQueueHtml','buildingModal','refreshLiveControls','upgradeDurableBuilding'].map(fn).join('\n'),c);
 return{c,game,controls,clocks,progress,calls,flags,html:()=>calls.modal.at(-1)?.[2]||'',footer:()=>calls.modal.at(-1)?.[3]||''};
}
function upgrade(h,id='farm'){h.game.state.command=h.game.commandMax();const result=h.c.upgradeDurableBuilding(id);assert.equal(result.ok,true,result.message);return result;}
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
test('each queued stage has its own clock and stays at zero progress until it actually starts',()=>{
 const h=harness();upgrade(h);upgrade(h);const jobs=h.game.constructionJobs().filter(j=>j.id==='farm');for(const job of jobs){h.clocks.push({dataset:{jobClock:h.c.jobKey(job)},textContent:''});h.progress.push({dataset:{jobProgress:h.c.jobKey(job)},style:{}});}
 h.c.refreshJobTimers();assert.notEqual(h.clocks[0].dataset.jobClock,h.clocks[1].dataset.jobClock);assert.match(h.clocks[0].textContent,/経過/);assert.match(h.clocks[1].textContent,/着工まで/);assert.equal(h.progress[1].style.width,'0%');
 h.game.state.jobs[0].remainingSeconds=20;h.game.state.jobs[0].remaining=1;h.c.refreshJobTimers();assert.match(h.clocks[0].textContent,/あと 20秒/);assert.match(h.clocks[1].textContent,/着工まで 20秒/);assert.match(h.clocks[1].textContent,/工期 1分00秒/);
});
test('level 32 is the last reservation and the displayed facility remains at its completed level',()=>{
 const h=harness();h.game.state.buildings.farm=30;upgrade(h);upgrade(h);h.c.buildingModal('farm');assert.equal(h.game.state.buildings.farm,30);assert.equal(h.c.buildingTailLevel('farm'),32);assert.match(h.html(),/Lv\.32まで予約済み/);assert(!h.footer().includes('data-action="upgrade"'));h.controls.push({dataset:{action:'upgrade',id:'farm'}});h.c.refreshLiveControls();assert.equal(h.controls[0].disabled,true);
});
test('failed durability restores the resources, command and complete queue without redrawing or adding a receipt',()=>{
 const h=harness();upgrade(h);h.game.state.command=h.game.commandMax();const before=plain(h.game.state),saved=h.calls.saved.length,renders=h.calls.render;h.flags.failSave=true;const result=h.c.upgradeDurableBuilding('farm');assert.equal(result.ok,false);assert.deepEqual(plain(h.game.state),before);assert.equal(h.calls.saved.length,saved);assert.equal(h.calls.render,renders);
});
test('staff shared reservations distinguish their actor and timing from a surviving personal chain',()=>{
 const g=new SengokuEngine({clan:'伊達家',seed:8});g.state.jobs=[{kind:'building',id:'farm',targetLevel:2,remainingSeconds:50,totalSeconds:60,remaining:1,total:1}];g.setRoleAccess({isStaff:true});
 const buildings={...g.state.buildings,farm:5,keep:10},base={id:'sunpu',revision:3,castleLevel:6,buildings,initial:{castleLevel:6,buildings:{...buildings}},history:[],updatedElapsedMs:0,accessSinceElapsedMs:0,personalClan:'伊達家',protected:true,jobs:[{jobId:'shared-a',kind:'building',id:'farm',targetLevel:6,totalSeconds:60,startedElapsedMs:0,completesElapsedMs:60000,startedBy:{id:'private-a',name:'<staff>'}},{jobId:'shared-b',kind:'building',id:'farm',targetLevel:7,totalSeconds:120,startedElapsedMs:60000,completesElapsedMs:180000,startedBy:{id:'private-b',name:'担当二'}}]};
 assert.equal(g.applyStaffBase(base).ok,true);const h=harness(g);h.c.buildingModal('farm');assert.match(h.html(),/building:farm:shared:6/);assert.match(h.html(),/building:farm:shared:7/);assert.match(h.html(),/&lt;staff&gt;が着手/);assert.match(h.html(),/担当二が予約/);assert(!h.html().includes('private-a'));assert(!h.html().includes('building:farm:personal'));assert.equal(h.c.constructionCount(true),1);assert.equal(h.c.constructionCount(false),1);assert.equal(h.c.currentJob('building','farm','personal',2).targetLevel,2);assert.equal(h.c.currentJob('building','farm','shared',7).targetLevel,7);
});
console.log(`${count} sequential construction UI checks passed. No external requests.`);
