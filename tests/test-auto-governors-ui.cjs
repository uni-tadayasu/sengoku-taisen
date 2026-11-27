/* Real application handlers and durable save code with the real game engine. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const durabilityUI=require('../durability.js');
const managementModel=require('../management-model.js');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),plain=value=>JSON.parse(JSON.stringify(value));
function fn(name){
  const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(', 'm'));assert(start>=0,name);
  const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;
  assert(end>start,name);return source.slice(start,end);
}
function declaration(name){const start=source.indexOf(`  const ${name}=`);assert(start>=0,name);return source.slice(start,source.indexOf('\n',start));}
function create({all=false}={}){
  const game=new E({officers:plain(roster),clan:'織田家',seed:17});
  if(all){for(const officer of roster)game._grantOfficerVariant(officer.id,'S');for(const building of D.buildings)game.state.buildings[building.id]=16;}
  return game;
}
function staffFixture({projected=true}={}){
  const personal=create(),s=personal.state;
  for(const officer of roster.slice(20,36))personal._grantOfficerVariant(officer.id,'S');
  const buildings={...s.buildings,gold_mine:1},base={id:'kyoto_gosho',revision:1,accessSinceElapsedMs:0,castleLevel:1,buildings,initial:{buildings:plain(buildings),castleLevel:1},history:[],jobs:[],personalClan:s.clan,personalHome:s.home,personalCycleHome:s.cycle.home,personalBaseCastle:plain(s.castles.kyoto_gosho),personalHomeCastle:plain(s.castles[s.home])};
  const game=E.fromSave(personal.exportSave(),roster,{isStaff:true,...(projected?{staffBase:base}:{})});
  return{game,base};
}
function branchFixture(){
  const game=new E({officers:plain(roster),seed:17,isAdmin:true});
  for(const officer of roster.slice(0,24))game._grantOfficerVariant(officer.id,'S');
  game.state.command=0;
  game.state.branches=[{id:'edo_north',parentCastleId:'edo',direction:'north',level:2,fallen:false},{id:'edo_east',parentCastleId:'edo',direction:'east',level:2,fallen:false}];
  const leader=game.branchCommanderAutoPlan('all').assignments[0].officerId;
  assert(game.assignGovernor('farm',leader).ok);
  return{game,leader};
}
function fullBranchFixture(){
  const game=new E({officers:plain(roster),seed:17,isAdmin:true}),army=game.state.army.slice();
  for(const officer of roster.slice(0,24))game._grantOfficerVariant(officer.id,'S');
  const candidates=game.officerViews(game.state.officers.filter(id=>!army.includes(id))).sort((a,b)=>b.lead-a.lead||b.intellect-a.intellect||b.valor-a.valor),strong=candidates.slice(0,2).map(o=>o.id),released=candidates.slice(-2).map(o=>o.id),owned=[...army,...strong,...released];
  game.state.officers=owned;game.state.officerVariants=game.state.officerVariants.filter(key=>owned.includes(key.split(':')[0]));game.state.officerHealth.values=Object.fromEntries(Object.entries(game.state.officerHealth.values).filter(([id])=>owned.includes(id)));
  game.state.command=0;game.state.governors={farm:strong[0],market:strong[1]};
  game.state.branches=['north','east'].map((direction,i)=>({id:'edo_'+direction,parentCastleId:'edo',direction,level:2,fallen:false,commanders:[released[i]]}));
  return{game,strong,released};
}
function harness(game=create()){
  const stored=new Map([['save',game.exportSave()]]),writes=[],events=[],modals=[],toasts=[],handlers=new Map();
  const flags={failSave:false},calls={render:0,header:0,sounds:[]},nodes=new Map([['#main',{}],['#save-indicator',{textContent:''}]]);
  const actionControl=()=>({dataset:{action:'auto-governors'},disabled:false,closest(selector){return selector==='[data-action]'||selector==='[data-action],[data-view]:not(#main)'?this:null;}});
  const controls=[0,1].map(index=>({...actionControl(),id:`governor-button-${index}`}));
  const c={game,SengokuEngine:E,staffBaseId:'kyoto_gosho',data:D,roster:plain(roster),state:()=>c.game.state,console,Date,Math,JSON,Number,String,Set,
    syncAccess:{linked:false,ready:true,writable:true,rolePending:false},lastLocalSaveRaw:null,lastLocalSaveGame:null,localCampaignRefreshPending:false,saveKey:'save',saveEnabled:true,saveWarning:'',
    branchBookingPending:false,worldCatchingUp:false,worldSettlementPending:false,fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,startPending:false,
    staffBaseReady:game.isStaff&&Boolean(game.getStaffBase()),settings:{tips:false},currentView:'town',townSection:'town-overview',townSections:['town-overview','town-facilities-section','town-reports-section'],facilityCategory:'all',facilityQuery:'',facilityState:'all',facilityPage:1,facilitySort:'default',facilityLayout:'cards',
    document:{querySelectorAll:selector=>selector==='[data-action]'?controls:[],addEventListener:(type,listener)=>handlers.set(type,listener)},
    window:{SengokuDurabilityUI:durabilityUI,SengokuManagement:managementModel,dispatchEvent:event=>events.push(event.type)},CustomEvent:class{constructor(type){this.type=type;}},
    localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>{if(flags.failSave)throw Error('QuotaExceededError');stored.set(key,value);writes.push({key,value});}},
    $:selector=>nodes.get(selector)||null,icon:()=>'',num:value=>Number(value||0).toLocaleString('ja-JP'),
    esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    toast:(message,error)=>toasts.push({message,error}),modal:(title,subtitle,body,footer,kind)=>modals.push({title,subtitle,body,footer,kind}),
    preserveInteraction:(_node,draw)=>draw(),renderHeader:()=>{calls.header++;},refreshTouchHeaderStatus(){},refreshBranchDeploymentPanels(){},refreshActiveModal(){},playNote:sound=>{calls.sounds.push(sound);},
    render:()=>{calls.render++;c.lastMarkup=c.currentView==='facilities'?c.renderFacilities():c.renderTown();c.refreshLiveControls();},
    heading:()=>'',staffBaseNotice:()=>'',syncBanner:()=>'',walkingEntry:()=>'',jobsHtml:()=>'',logItems:()=>'',officerCrest:()=>'',pageControls:()=>'',
    constructionJobs:()=>[],currentJob:()=>null,castleLevelLimit:id=>c.game.castleLevelLimit(id),date:()=>({year:1560,month:1,season:'春'}),costHtml:()=>''
  };
  vm.createContext(c);
  vm.runInContext([declaration('mutationActions'),declaration('categoryNames'),declaration('resNames'),declaration('resIcons'),...['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','changedLocalCampaign','save','requestBranches','staffConstructionReady','governorAssignmentStatus','governorAssignmentEntry','facilityGovernorLabel','governorAssignmentResult','autoAssignGovernors','buildingOutput','buildingCard','catalogMatches','catalogChips','facilityPlannerTools','facilitiesResults','economyNumber','economyPanel','renderFacilities','premiumTownProduct','premiumTownImage','premiumTownDescription','townSceneSources','premiumTownBanner','premiumLord','durabilityMarkup','durabilityHelp','townPanelAttributes','townTabMarkup','renderTown','refreshLiveControls'].map(fn)].join('\n'),c);
  const clickStart=source.indexOf("  document.addEventListener('click',async event=>"),clickEnd=source.indexOf("  document.addEventListener('input'",clickStart);
  assert(clickStart>=0&&clickEnd>clickStart);vm.runInContext(source.slice(clickStart,clickEnd),c);
  const click=async({force=false}={})=>{const target=force?actionControl():controls[0];await handlers.get('click')({target});};
  return{c,get game(){return c.game;},stored,writes,events,modals,toasts,controls,flags,calls,click};
}
function withoutGovernors(state){const copy=plain(state);delete copy.governors;return copy;}
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}

(async()=>{
await test('both town and facility screens render the assignment entry with live counts',()=>{
  const h=harness(),before=plain(h.game.state),status=plain(h.c.governorAssignmentStatus());
  assert.deepEqual({facilityCount:status.facilityCount,candidateCount:status.candidateCount,assignedCount:status.assignedCount},{facilityCount:8,candidateCount:1,assignedCount:0});
  for(const view of ['town','facilities']){
    h.c.currentView=view;h.c.render();
    assert.equal((h.c.lastMarkup.match(/data-action="auto-governors"/g)||[]).length,1);
    assert(h.c.lastMarkup.includes('支拠点の軍団を優先'));
    assert(h.c.lastMarkup.includes('本隊を維持'));
    assert(h.controls.every(node=>!node.disabled));
  }
  assert.deepEqual(h.game.state,before);assert.equal(h.writes.length,0);
});

await test('one real click assigns all built facilities despite search/page filters and saves once without changing the army',async()=>{
  const h=harness(create({all:true}));h.game.state.command=0;
  h.c.currentView='facilities';h.c.facilityCategory='gold';h.c.facilityQuery='金山';h.c.facilityPage=2;
  const before=plain(h.game.state),original=h.game;
  h.c.refreshLiveControls();assert.equal(h.controls[0].disabled,false,'The free assignment works with no commands');
  await h.click();
  assert.equal(Object.keys(h.game.state.governors).length,64);
  assert.equal(new Set(Object.values(h.game.state.governors)).size,64);
  assert(Object.values(h.game.state.governors).every(id=>!before.army.includes(id)));
  assert.notEqual(h.game,original);assert.deepEqual(original.state,before);
  assert.deepEqual(h.game.state.army,before.army);assert.deepEqual(withoutGovernors(h.game.state),withoutGovernors(before));
  assert.equal(h.writes.length,1);assert.deepEqual(h.events,['sengoku:game-saved']);
  assert.deepEqual(JSON.parse(h.stored.get('save')).state.governors,h.game.state.governors);
  const result=h.modals.at(-1);assert.equal(result.kind,'governor-result');assert.equal((result.body.match(/class="governor-result-row/g)||[]).length,64);
  assert.equal(h.c.facilityCategory,'gold');assert.equal(h.c.facilityQuery,'金山');
  assert.deepEqual(E.fromSave(h.stored.get('save'),roster).state.governors,h.game.state.governors);
});

await test('a real assignment click reports payroll-limited vacancies separately from a shortage of officers',async()=>{
  const game=create();for(const officer of roster)game._grantOfficerVariant(officer.id,'S');game.state.buildings.keep=4;
  for(const building of D.buildings)if(building.requiredKeep<=4)game.state.buildings[building.id]=Math.max(1,game.state.buildings[building.id]);
  const expected=game.planGovernorAssignments();assert(expected.budgetLimitedCount>0);assert.equal(expected.staffingVacantCount,0);
  const h=harness(game);await h.click();const result=h.modals.at(-1);
  assert.equal(h.writes.length,1);assert(h.game.income().gold>=0);assert.equal(h.game.governorPayroll().gold,expected.monthlySalary);
  assert(result.body.includes('給与による赤字を抑えるため'));assert(result.body.includes('任命を見送りました'));assert(!result.body.includes('家臣が足りない施設は未任命'));
  assert(result.body.includes('現在の給与総額は金銭'+expected.monthlySalary.toLocaleString('ja-JP')+'／月'));
});

await test('insufficient candidates leave explicit vacancies and a repeated click preserves the existing optimal formation',async()=>{
  const h=harness();await h.click();
  assert.equal(Object.keys(h.game.state.governors).length,1);
  assert.equal((h.modals.at(-1).body.match(/class="governor-vacant"/g)||[]).length,7);
  assert(h.modals.at(-1).body.includes('家臣が足りない施設は未任命'));
  const before=plain(h.game.state);await h.click();
  assert.deepEqual(h.game.state,before);assert.equal(h.modals.at(-1).title,'現在の配置を維持しました');
});

await test('a real click fills branch army slots before governors in one saved clone, without duplicate posts or costs',async()=>{
  const {game,leader}=branchFixture(),h=harness(game),before=plain(game.state),plan=game.planGovernorAssignments();
  assert.equal(plan.branchAssignedCount,2);assert(plan.branchAssignments.some(row=>row.officerId===leader&&row.fromBuildingId==='farm'));
  await h.click();
  assert.notEqual(h.game,game);assert.deepEqual(game.state,before,'The transaction never mutates the previous runtime');
  assert.deepEqual(h.game.state.army,before.army);assert.equal(h.game.state.command,0);assert.deepEqual(h.game.state.resources,before.resources);
  for(const assignment of plan.branchAssignments)assert(h.game.branch(assignment.branchId).commanders.includes(assignment.officerId));
  const branches=h.game.state.branches.flatMap(branch=>branch.commanders||[]),governors=Object.values(h.game.state.governors),all=[...h.game.state.army,...branches,...governors];
  assert.equal(new Set(all).size,all.length,'No officer is assigned to two posts');assert(!governors.includes(leader));assert.deepEqual(h.game.state.governors,plan.governors);
  assert.equal(h.writes.length,1);assert.deepEqual(h.events,['sengoku:game-saved']);
  assert.deepEqual(JSON.parse(h.stored.get('save')).state.branches,h.game.state.branches);assert.deepEqual(E.fromSave(h.stored.get('save'),roster,{isAdmin:true}).state.governors,plan.governors);
  assert(h.modals.at(-1).body.includes('2枠を変更'));assert.equal(h.c.branchBookingPending,false);
});

await test('one real click replaces full branches from governors and assigns the displaced officers back to facilities',async()=>{
  const {game,strong,released}=fullBranchFixture(),h=harness(game),before=plain(game.state),plan=game.planGovernorAssignments();
  assert.equal(plan.branchAssignedCount,2);assert.equal(plan.branchReplacedCount,2);h.c.refreshLiveControls();assert(h.controls.every(node=>!node.disabled));
  await h.click();assert.equal(h.toasts.filter(row=>row.error).length,0,JSON.stringify(h.toasts));assert.notEqual(h.game,game);assert.deepEqual(game.state,before);assert.deepEqual(h.game.state.army,before.army);assert.deepEqual(h.game.state.resources,before.resources);assert.equal(h.game.state.command,0);
  const posted=h.game.state.branches.flatMap(branch=>branch.commanders||[]);assert.deepEqual([...posted].sort(),[...strong].sort());assert(h.game.state.branches.every(branch=>branch.commanders.length===1));
  const governors=Object.values(h.game.state.governors);for(const id of released)assert(governors.includes(id),'An officer displaced from a full branch can serve as governor');
  const roles=[...h.game.state.army,...posted,...governors];assert.equal(new Set(roles).size,roles.length);assert.equal(h.writes.length,1);assert.deepEqual(h.events,['sengoku:game-saved']);
  const loaded=E.fromSave(h.stored.get('save'),roster,{isAdmin:true});assert.deepEqual(loaded.state.branches,h.game.state.branches);assert.deepEqual(loaded.state.governors,h.game.state.governors);assert.match(h.modals.at(-1).body,/入れ替え/);
  const stable=plain(h.game.state);await h.click();assert.deepEqual(h.game.state,stable);assert.equal(h.modals.at(-1).title,'現在の配置を維持しました');
});

await test('a failed replacement restores full branch formations and every governor atomically',async()=>{
  const {game}=fullBranchFixture(),h=harness(game),before=plain(game.state),stored=h.stored.get('save'),branches=game.state.branches,governors=game.state.governors;
  h.flags.failSave=true;await h.click();assert.equal(h.game,game);assert.equal(game.state.branches,branches);assert.equal(game.state.governors,governors);assert.deepEqual(game.state,before);assert.equal(h.stored.get('save'),stored);assert.equal(h.writes.length,0);assert.equal(h.events.length,0);assert.equal(h.modals.length,0);assert(h.toasts.some(row=>row.error));
});

await test('a failed branch-first save restores branch commanders and governors together without a success dialog',async()=>{
  const {game}=branchFixture(),h=harness(game),before=plain(game.state),oldSave=h.stored.get('save'),governors=game.state.governors,branches=game.state.branches;
  h.flags.failSave=true;await h.click();
  assert.equal(h.game,game);assert.equal(h.game.state.governors,governors);assert.equal(h.game.state.branches,branches);assert.deepEqual(h.game.state,before);assert.equal(h.stored.get('save'),oldSave);
  assert.equal(h.writes.length,0);assert.equal(h.events.length,0);assert.equal(h.modals.length,0);assert.deepEqual(h.calls.sounds,['error']);assert.equal(h.c.branchBookingPending,false);
  assert(h.toasts.some(row=>row.error&&row.message.includes('操作前に戻しました')));
});

await test('durable storage failure rolls back the exact governor map and never reports success or emits a save event',async()=>{
  const h=harness(create({all:true})),spare=h.game.state.officers.find(id=>!h.game.state.army.includes(id));
  h.game.assignGovernor('farm',spare);h.stored.set('save',h.game.exportSave());
  const before=plain(h.game.state),governorReference=h.game.state.governors,storedBefore=h.stored.get('save');h.flags.failSave=true;
  await h.click();
  assert.deepEqual(h.game.state,before);assert.equal(h.game.state.governors,governorReference);assert.equal(h.stored.get('save'),storedBefore);
  assert.equal(h.writes.length,0);assert.equal(h.events.length,0);assert.equal(h.modals.length,0);assert.deepEqual(h.calls.sounds,['error']);
  assert(h.toasts.some(item=>item.error&&item.message.includes('操作前に戻しました')));
  assert.equal(h.c.saveEnabled,false);assert(h.controls.every(node=>node.disabled));
});

await test('unverified roles, pending sync, followers and expired leases disable controls and reject direct action dispatch',async()=>{
  const states=[{rolePending:true},{linked:true,ready:false,writable:false},{linked:true,ready:true,writable:false},{linked:true,ready:true,writable:true,leaseExpiresAt:new Date(Date.now()-1000).toISOString()}];
  for(const access of states){
    const h=harness(create({all:true}));Object.assign(h.c.syncAccess,access);const before=plain(h.game.state),raw=h.stored.get('save');
    let engineCalls=0;const assign=h.game.autoAssignGovernors.bind(h.game);h.game.autoAssignGovernors=()=>{engineCalls++;return assign();};
    h.c.refreshLiveControls();assert(h.controls.every(node=>node.disabled));
    await h.click({force:true});await h.c.autoAssignGovernors();
    assert.equal(engineCalls,0);assert.deepEqual(h.game.state,before);assert.equal(h.stored.get('save'),raw);assert.equal(h.writes.length,0);assert.equal(h.modals.length,0);
  }
});

await test('clock catch-up, pending field/walking actions and a prior storage failure also leave assignments untouched',async()=>{
  for(const flag of ['branchBookingPending','worldCatchingUp','fieldActionPending','walkingActionPending','strategyActionPending','worldSettlementPending','saveEnabled']){
    const h=harness(create({all:true}));h.c[flag]=flag==='saveEnabled'?false:true;const before=plain(h.game.state);
    h.c.refreshLiveControls();assert(h.controls.every(node=>node.disabled),flag);
    await h.click({force:true});assert.deepEqual(h.game.state,before,flag);assert.equal(h.writes.length,0,flag);assert.equal(h.modals.length,0,flag);
  }
});

await test('staff assignment waits for both an actual shared projection and application readiness',async()=>{
  for(const projected of [false,true]){
    const {game}=staffFixture({projected}),h=harness(game);if(projected)h.c.staffBaseReady=false;
    const before=plain(game.state);h.c.refreshLiveControls();assert(h.controls.every(node=>node.disabled));
    assert(h.c.governorAssignmentEntry().includes('共同拠点の成長を確認'));
    await h.click({force:true});assert.deepEqual(game.state,before);assert.equal(h.writes.length,0);assert.equal(h.modals.length,0);
  }
});

await test('verified staff assignments use shared built facilities but persist only personal building levels',async()=>{
  const {game,base}=staffFixture(),h=harness(game),before=plain(game.state);
  const normalized=E.fromSave(game.exportSave(),roster,{isStaff:true,staffBase:game.getStaffBase(),branchAuthority:{resolvedElapsedMs:game.branchResolvedElapsedMs},maintenanceAuthority:game.getMaintenanceAuthority()}).state;
  await h.click();
  assert.equal(h.game.state.buildings.gold_mine,1);assert(h.game.state.governors.gold_mine);
  assert.deepEqual(withoutGovernors(h.game.state),withoutGovernors(normalized));assert.deepEqual(game.state,before);
  const stored=JSON.parse(h.stored.get('save'));assert.equal(stored.state.buildings.gold_mine,0);assert.equal(stored.state.governors.gold_mine,h.game.state.governors.gold_mine);
  assert.deepEqual(E.fromSave(stored,roster,{isStaff:true,staffBase:base}).state.governors,h.game.state.governors);
});

await test('no non-army candidates disables the entry and a normal click cannot save',async()=>{
  const game=create(),owned=game.state.army.slice();game.state.officers=owned.slice();game.state.officerVariants=game.state.officerVariants.filter(key=>owned.includes(key.split(':')[0]));game.state.officerHealth.values=Object.fromEntries(Object.entries(game.state.officerHealth.values).filter(([id])=>owned.includes(id)));
  const h=harness(game),before=plain(game.state);h.c.refreshLiveControls();assert(h.controls.every(node=>node.disabled));
  assert(h.c.governorAssignmentEntry().includes('本隊'));
  await h.click();assert.deepEqual(game.state,before);assert.equal(h.writes.length,0);assert.equal(h.modals.length,0);
});

await test('already posted eligible branch commanders keep global optimization available without spare officers',async()=>{
  const {game,leader}=branchFixture();assert(game.assignBranchCommander('edo_north',leader).ok);
  const owned=[...game.state.army,leader];game.state.officers=owned;game.state.officerVariants=game.state.officerVariants.filter(key=>owned.includes(key.split(':')[0]));game.state.officerHealth.values=Object.fromEntries(Object.entries(game.state.officerHealth.values).filter(([id])=>owned.includes(id)));
  const h=harness(game),before=plain(game.state);assert.equal(h.c.governorAssignmentStatus().candidateCount,1);
  h.c.refreshLiveControls();assert(h.controls.every(node=>!node.disabled));await h.click();
  assert.deepEqual(game.state,before);assert.deepEqual(h.game.branch('edo_north').commanders,[leader]);assert.equal(h.modals.at(-1).title,'現在の配置を維持しました');
  const positions=[...h.game.state.army,...h.game.state.branches.flatMap(branch=>branch.commanders||[]),...Object.values(h.game.state.governors)];assert.equal(new Set(positions).size,positions.length);
});

await test('result rows and facility labels escape officer names and omit labels for unbuilt facilities',async()=>{
  const h=harness(),spare=h.game.state.officers.find(id=>!h.game.state.army.includes(id));
  h.c.roster.find(officer=>officer.id===spare).name='<img src=x onerror=alert(1)>';
  await h.click();const building=Object.keys(h.game.state.governors)[0],body=h.modals.at(-1).body,label=h.c.facilityGovernorLabel(building);
  assert(body.includes('&lt;img'));assert(label.includes('&lt;img'));assert(!body.includes('<img src=x'));assert(!label.includes('<img src=x'));
  assert.equal(h.c.facilityGovernorLabel('gold_mine'),'');
});

console.log(`${count} automatic governor UI scenarios passed. No external requests or player data changes.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
