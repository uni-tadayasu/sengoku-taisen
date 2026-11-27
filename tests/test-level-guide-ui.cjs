/* Exercise the real guide/navigation handlers and construction refresh with the engine. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fn(name){const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;assert(end>start,name);return source.slice(start,end);}
function harness(game=new E({seed:23})){
  const handlers=new Map(),writes=[],requests=[],flags={writable:true},modalClasses=new Set();let buttons=[],details=[];
  function closestAction(selector){
    if(selector==='dialog'&&buttons.includes(this))return dialog;
    return selector.split(',').includes('[data-action]')?this:null;
  }
  const attributes=new Map();
  const dialog={
    open:false,
    setAttribute:(name,value)=>attributes.set(name,value),
    getAttribute:name=>attributes.get(name)??null,
    removeAttribute:name=>attributes.delete(name),
    classList:{toggle(key,on){if(on)modalClasses.add(key);else modalClasses.delete(key);}},
    showModal(){this.open=true;},close(){this.open=false;}
  };
  const content={_html:'',set innerHTML(value){this._html=value;buttons=[...value.matchAll(/<button\b([^>]*)>/g)].map(match=>{const get=key=>new RegExp(`data-${key}="([^"]*)"`).exec(match[1])?.[1];return{dataset:{action:get('action'),id:get('id')},disabled:/\sdisabled(?:\s|$)/.test(match[1]),closest:closestAction};}).filter(b=>b.dataset.action);details=[...value.matchAll(/data-level-guide-section="([^"]+)"/g)].map(match=>({dataset:{levelGuideSection:match[1]},open:false}));},get innerHTML(){return this._html;}};
  const nodes={'#modal':dialog,'#modal-content':content,'#main':{}},c={game,data:D,staffBaseId:D.staffBaseId||'kyoto_gosho',state:()=>game.state,console,Math,JSON,Set,Date,Number,String,
    activeModal:'',activeModalContext:null,staffBaseReady:!!game.getStaffBase(),gachaPresentation:null,saveEnabled:true,currentView:'town',townSection:'town-overview',townSections:['town-overview','town-facilities-section','town-reports-section'],settings:{tips:false},facilityQuery:'',facilityCategory:'all',facilitySort:'default',facilityLayout:'cards',facilityPage:1,categoryNames:{},
    window:{},document:{addEventListener:(type,listener)=>handlers.set(type,listener),querySelectorAll:selector=>selector==='[data-action]'?buttons:selector.includes('data-level-guide-section')?details.filter(d=>!selector.includes('[open]')||d.open):[]},$:selector=>nodes[selector]||null,
    esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),icon:()=>'',num:value=>String(value),resNames:{gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},resIcons:{},governorHelp:{},
    clearGachaPresentation(){},syncMusic(){},refreshTouchHeaderStatus(){},refreshBranchDeploymentPanels(){},canMutate:()=>flags.writable,requireWritable:()=>flags.writable,syncMessage:()=>'',toast(){},playNote(){},save:()=>{writes.push(game.exportSave());return true;},render(){},renderHeader(){},preserveInteraction:(_node,draw)=>draw(),
    heading:()=>'',syncBanner:()=>'',governorAssignmentEntry:()=>'',facilityGovernorLabel:()=>'',buildingCard:()=>'',facilitiesResults:()=>'',officerCrest:()=>'',walkingEntry:()=>'',logItems:()=>'',date:()=>({season:'春'}),clanCrest:()=>'',
    upgradeSharedBase:async(kind,id)=>requests.push({kind,id})
  };
  const declaration=source.slice(source.indexOf('  const mutationActions='),source.indexOf('\n',source.indexOf('  const mutationActions=')));
  vm.createContext(c);vm.runInContext([declaration,...['patchHTML','modal','closeModal','perform','hasResources','costHtml','constructionJobs','currentJob','constructionCount','buildingChain','buildingTailLevel','jobKey','jobDuration','jobClockText','refreshJobTimers','castleLevelLimit','staffConstructionReady','sharedJobAttribution','buildingQueueHtml','buildingOutput','facilityMaintenanceHtml','economyNumber','economyBalanceTitle','economyPanel','buildingAvailability','buildingModal','campaignCastleGrowth','castleDetail','staffBaseNotice','staffBaseModal','jobsHtml','townSceneArt','premiumTownBanner','premiumLord','durabilityMarkup','durabilityHelp','townPanelAttributes','townTabMarkup','renderTown','facilityPlannerTools','renderFacilities','levelGuideCastle','castleUpgradeModal','levelGuideModal','refreshLiveControls','refreshActiveModal','upgradeDurableBuilding'].map(fn)].join('\n'),c);
  const start=source.indexOf("  document.addEventListener('click',async event=>"),end=source.indexOf("  document.addEventListener('input'",start);vm.runInContext(source.slice(start,end),c);
  async function click(action,id,{force=false}={}){const node=force?{dataset:{action,id},disabled:false,closest:closestAction}:buttons.find(b=>b.dataset.action===action&&(id===undefined||b.dataset.id===id));assert(node,action);await handlers.get('click')({target:node});}
  return{c,game,flags,writes,requests,dialog,content,modalClasses,click,buttons:()=>buttons,details:()=>details};
}
const stateJson=game=>JSON.stringify(game.state);
const checks=[];async function test(name,run){await run();checks.push(name);console.log('PASS '+name);}
function rich(g){for(const key of Object.keys(g.state.resources))g.state.resources[key]=999999;return g;}
function staff(){const g=rich(new E({seed:24})),personal=JSON.parse(g.exportSave()).state;g.setRoleAccess({isStaff:true});const buildings={...g.state.buildings,keep:8},base={id:'kyoto_gosho',revision:1,castleLevel:127,buildings,initial:{castleLevel:127,buildings:{...buildings}},history:[],jobs:[],updatedElapsedMs:0,accessSinceElapsedMs:0,personalClan:personal.clan,personalHome:personal.home,personalCycleHome:personal.home,personalHomeCastle:personal.castles[personal.home],personalBaseCastle:personal.castles.kyoto_gosho};assert.equal(g.applyStaffBase(base).ok,true);return g;}
(async()=>{
await test('town, castle and keep guide entries navigate to real details without changing saves or formations',async()=>{
  const h=harness(),before=stateJson(h.game);assert(h.c.renderTown().includes('data-action="level-guide"'));assert(h.c.renderFacilities().includes('data-action="level-guide"'));assert(h.c.castleDetail(h.game.state.home).includes('data-action="level-guide"'));
  await h.click('level-guide',h.game.state.home,{force:true});assert.equal(h.c.activeModal,'level-guide');assert(h.modalClasses.has('level-guide-modal'));assert.equal(h.dialog.getAttribute('aria-labelledby'),'modal-title');assert(h.content.innerHTML.includes('天守（城下町の施設）'));assert(h.content.innerHTML.includes('城郭（城そのもの）'));
  await h.click('building','keep');assert.equal(h.c.activeModal,'building');assert(!h.modalClasses.has('level-guide-modal'));assert(h.content.innerHTML.includes('増築する'));assert(h.content.innerHTML.includes('data-action="level-guide"'));
  await h.click('level-guide');await h.click('level-guide-castle');assert.equal(h.c.activeModal,'castle-upgrade');assert(h.content.innerHTML.includes('城郭の拡張'));assert(h.buttons().some(b=>b.dataset.action==='upgrade-castle'&&b.dataset.id===h.game.state.home));assert.equal(stateJson(h.game),before);assert.equal(h.writes.length,0);assert.equal(h.requests.length,0);
});
await test('followers and unverified staff can read guides without enabling a mutation or exposing a private keep level',async()=>{
  const h=harness();h.flags.writable=false;const before=stateJson(h.game);await h.click('level-guide',h.game.state.home,{force:true});await h.click('level-guide-castle');assert(h.buttons().find(b=>b.dataset.action==='upgrade-castle').disabled);await h.click('upgrade-castle',h.game.state.home,{force:true});assert.equal(stateJson(h.game),before);assert.equal(h.writes.length,0);
  const g=new E({seed:4});g.state.buildings.keep=29;g.setRoleAccess({isStaff:true});const s=harness(g),raw=stateJson(g);await s.click('level-guide','kyoto_gosho',{force:true});assert(s.content.innerHTML.includes('共同拠点を確認中'));assert(!s.content.innerHTML.includes('Lv.29 / 32'));await s.click('level-guide-castle');assert.equal(s.c.activeModal,'staff-base');assert(s.buttons().find(b=>b.dataset.action==='upgrade-castle').disabled);assert.equal(stateJson(g),raw);assert.equal(s.requests.length,0);
});
await test('ordinary, metropolitan, operator and staff guide targets use the real limits and correct operation labels',async()=>{
  const ordinary=rich(new E({seed:5}));ordinary.state.castles.nijo.owner=ordinary.state.clan;ordinary.state.castles.nijo.level=47;
  const cases=[{game:ordinary,id:'nijo',limit:48,label:'Lv.48へ拡張する'},{game:new E({isAdmin:true,seed:6}),id:'edo',limit:64,label:'あなたの本拠は江戸城'},{game:staff(),id:'kyoto_gosho',limit:128,label:'Lv.128へ共同普請する'}];
  for(const entry of cases){const h=harness(entry.game),before=stateJson(h.game);await h.click('level-guide',entry.id,{force:true});assert.equal(h.game.castleLevelLimit(entry.id),entry.limit);assert(h.content.innerHTML.includes(entry.label));assert(!/運営|スタッフ/.test(h.content.innerHTML),'Development guidance describes the castle without disclosing management roles');assert(h.content.innerHTML.includes('guide/#castle-upgrades'));assert(h.content.innerHTML.includes('<dt>京都御所の城郭</dt><dd>Lv.128</dd>'));assert(h.content.innerHTML.includes('<dt>江戸城の城郭</dt><dd>Lv.64</dd>'));assert(h.content.innerHTML.includes('城郭は連続予約できない'));assert(h.content.innerHTML.includes('取り消しはできません'));assert.equal(stateJson(h.game),before);}
  const h=harness(staff());await h.click('level-guide','kyoto_gosho',{force:true});await h.click('level-guide-castle');assert.equal(h.c.activeModal,'staff-base');await h.click('upgrade-castle','kyoto_gosho');assert.deepEqual(h.requests,[{kind:'castle',id:'kyoto_gosho'}]);assert.equal(h.writes.length,0,'shared upgrade retains its existing server command');
  const fallback=harness();await fallback.click('level-guide','osaka',{force:true});assert.equal(fallback.c.activeModalContext.id,fallback.game.state.home,'an enemy guide opens a safe own-castle development target');
});
await test('guided castle construction closes the old action, shows the job and refreshes to the next level after completion',async()=>{
  const h=harness(rich(new E({seed:7}))),id=h.game.state.home,level=h.game.castle(id).level,army=[...h.game.state.army],cost=h.game.castleUpgradeCost(id);
  await h.click('level-guide',id,{force:true});await h.click('level-guide-castle');assert(h.content.innerHTML.includes(`Lv.${level+1}へ拡張する`));await h.click('upgrade-castle',id);assert.equal(h.dialog.open,false);assert.equal(h.writes.length,1);assert.equal(h.game.state.jobs.filter(j=>j.kind==='castle'&&j.id===id).length,1);
  h.c.castleUpgradeModal(id);assert(h.content.innerHTML.includes('拡張中'));assert(!h.buttons().some(b=>b.dataset.action==='upgrade-castle'));for(let seconds=0;seconds<cost.seconds;seconds+=5)h.game.tick(Math.min(5,cost.seconds-seconds));h.c.refreshActiveModal();assert.equal(h.game.castle(id).level,level+1);assert(h.content.innerHTML.includes(`Lv.${level+2}へ拡張する`));assert(!h.content.innerHTML.includes('拡張中'));assert.deepEqual(h.game.state.army,army);assert.equal(h.writes.length,1,'a guide refresh is not another save or upgrade');
});
await test('sync refresh preserves expanded explanation sections and updates current levels',async()=>{
  const h=harness();await h.click('level-guide',h.game.state.home,{force:true});h.details().find(d=>d.dataset.levelGuideSection==='queue').open=true;h.details().find(d=>d.dataset.levelGuideSection==='limits').open=true;
  h.game.state.buildings.keep=8;const before=stateJson(h.game);h.c.refreshActiveModal();assert.deepEqual(h.details().filter(d=>d.open).map(d=>d.dataset.levelGuideSection),['queue','limits']);assert(h.content.innerHTML.includes('Lv.8 / 32'));assert(h.content.innerHTML.includes('現在3枠'));assert.equal(stateJson(h.game),before);assert.equal(h.writes.length,0);
  await h.click('close');await h.click('level-guide',h.game.state.home,{force:true});assert(h.details().every(d=>!d.open),'a newly opened guide starts with concise sections');
});
console.log(`${checks.length} level guide UI checks passed. No external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
