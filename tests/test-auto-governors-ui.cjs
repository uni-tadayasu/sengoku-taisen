/* Real application handlers and durable save code with the real game engine. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),plain=value=>JSON.parse(JSON.stringify(value));
function fn(name){
  const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);
  const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;
  assert(end>start,name);return source.slice(start,end);
}
function declaration(name){const start=source.indexOf(`  const ${name}=`);assert(start>=0,name);return source.slice(start,source.indexOf('\n',start));}
function create({all=false}={}){
  const game=new E({officers:plain(roster),clan:'織田家',seed:17});
  if(all){for(const officer of roster)game._grantOfficerVariant(officer.id,'S');for(const building of D.buildings)game.state.buildings[building.id]=Math.max(1,game.state.buildings[building.id]);}
  return game;
}
function staffFixture({projected=true}={}){
  const personal=create(),s=personal.state;
  for(const officer of roster.slice(20,36))personal._grantOfficerVariant(officer.id,'S');
  const buildings={...s.buildings,gold_mine:1},base={id:'kyoto_gosho',revision:1,accessSinceElapsedMs:0,castleLevel:1,buildings,initial:{buildings:plain(buildings),castleLevel:1},history:[],jobs:[],personalClan:s.clan,personalHome:s.home,personalCycleHome:s.cycle.home,personalBaseCastle:plain(s.castles.kyoto_gosho),personalHomeCastle:plain(s.castles[s.home])};
  const game=E.fromSave(personal.exportSave(),roster,{isStaff:true,...(projected?{staffBase:base}:{})});
  return{game,base};
}
function harness(game=create()){
  const stored=new Map([['save',game.exportSave()]]),writes=[],events=[],modals=[],toasts=[],handlers=new Map();
  const flags={failSave:false},calls={render:0,header:0,sound:0},nodes=new Map([['#main',{}],['#save-indicator',{textContent:''}]]);
  const controls=[0,1].map(index=>({id:`governor-button-${index}`,dataset:{action:'auto-governors'},disabled:false,closest(){return this;}}));
  const c={game,staffBaseId:'kyoto_gosho',data:D,roster,state:()=>c.game.state,console,Date,Math,JSON,Number,String,Set,
    syncAccess:{linked:false,ready:true,writable:true,rolePending:false},lastLocalSaveRaw:null,lastLocalSaveGame:null,localCampaignRefreshPending:false,saveKey:'save',saveEnabled:true,saveWarning:'',
    worldCatchingUp:false,worldSettlementPending:false,fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,startPending:false,
    staffBaseReady:game.isStaff&&Boolean(game.getStaffBase()),settings:{tips:false},currentView:'town',facilityCategory:'all',facilityQuery:'',facilityPage:1,
    document:{querySelectorAll:selector=>selector==='[data-action]'?controls:[],addEventListener:(type,listener)=>handlers.set(type,listener)},
    window:{dispatchEvent:event=>events.push(event.type)},CustomEvent:class{constructor(type){this.type=type;}},
    localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>{if(flags.failSave)throw Error('QuotaExceededError');stored.set(key,value);writes.push({key,value});}},
    $:selector=>nodes.get(selector)||null,icon:()=>'',num:value=>Number(value||0).toLocaleString('ja-JP'),
    esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
    toast:(message,error)=>toasts.push({message,error}),modal:(title,subtitle,body,footer,kind)=>modals.push({title,subtitle,body,footer,kind}),
    preserveInteraction:(_node,draw)=>draw(),renderHeader:()=>{calls.header++;},refreshTouchHeaderStatus(){},playNote:()=>{calls.sound++;},
    render:()=>{calls.render++;c.lastMarkup=c.currentView==='facilities'?c.renderFacilities():c.renderTown();c.refreshLiveControls();},
    heading:()=>'',staffBaseNotice:()=>'',syncBanner:()=>'',walkingEntry:()=>'',jobsHtml:()=>'',logItems:()=>'',officerCrest:()=>'',pageControls:()=>'',
    constructionJobs:()=>[],currentJob:()=>null,castleLevelLimit:id=>game.castleLevelLimit(id),date:()=>({year:1560,month:1,season:'春'}),costHtml:()=>''
  };
  vm.createContext(c);
  vm.runInContext([declaration('mutationActions'),declaration('categoryNames'),...['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','changedLocalCampaign','save','staffConstructionReady','governorAssignmentStatus','governorAssignmentEntry','facilityGovernorLabel','governorAssignmentResult','autoAssignGovernors','buildingOutput','buildingCard','facilitiesResults','renderFacilities','premiumTownImage','townSceneSources','premiumTownBanner','premiumLord','renderTown','refreshLiveControls'].map(fn)].join('\n'),c);
  const clickStart=source.indexOf("  document.addEventListener('click',async event=>"),clickEnd=source.indexOf("  document.addEventListener('input'",clickStart);
  assert(clickStart>=0&&clickEnd>clickStart);vm.runInContext(source.slice(clickStart,clickEnd),c);
  const click=async({force=false}={})=>{const target=force?{dataset:{action:'auto-governors'},disabled:false,closest(){return this;}}:controls[0];await handlers.get('click')({target});};
  return{c,game,stored,writes,events,modals,toasts,controls,flags,calls,click};
}
function withoutGovernors(state){const copy=plain(state);delete copy.governors;return copy;}
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}

(async()=>{
await test('both town and facility screens render the assignment entry with live counts',()=>{
  const h=harness(),before=plain(h.game.state),status=plain(h.c.governorAssignmentStatus());
  assert.deepEqual(status,{facilityCount:8,candidateCount:1,assignedCount:0});
  for(const view of ['town','facilities']){
    h.c.currentView=view;h.c.render();
    assert.equal((h.c.lastMarkup.match(/data-action="auto-governors"/g)||[]).length,1);
    assert(h.c.lastMarkup.includes('軍団の武将は対象外'));
    assert(h.controls.every(node=>!node.disabled));
  }
  assert.deepEqual(h.game.state,before);assert.equal(h.writes.length,0);
});

await test('one real click assigns all built facilities despite search/page filters and saves once without changing the army',async()=>{
  const h=harness(create({all:true}));h.game.state.command=0;
  h.c.currentView='facilities';h.c.facilityCategory='gold';h.c.facilityQuery='金山';h.c.facilityPage=2;
  const before=plain(h.game.state),armyReference=h.game.state.army;
  h.c.refreshLiveControls();assert.equal(h.controls[0].disabled,false,'The free assignment works with no commands');
  await h.click();
  assert.equal(Object.keys(h.game.state.governors).length,64);
  assert.equal(new Set(Object.values(h.game.state.governors)).size,64);
  assert(Object.values(h.game.state.governors).every(id=>!before.army.includes(id)));
  assert.equal(h.game.state.army,armyReference);assert.deepEqual(withoutGovernors(h.game.state),withoutGovernors(before));
  assert.equal(h.writes.length,1);assert.deepEqual(h.events,['sengoku:game-saved']);
  assert.deepEqual(JSON.parse(h.stored.get('save')).state.governors,h.game.state.governors);
  const result=h.modals.at(-1);assert.equal(result.kind,'governor-result');assert.equal((result.body.match(/class="governor-result-row/g)||[]).length,64);
  assert.equal(h.c.facilityCategory,'gold');assert.equal(h.c.facilityQuery,'金山');
  assert.deepEqual(E.fromSave(h.stored.get('save'),roster).state.governors,h.game.state.governors);
});

await test('insufficient candidates leave explicit vacancies and a repeated click preserves the existing optimal formation',async()=>{
  const h=harness();await h.click();
  assert.equal(Object.keys(h.game.state.governors).length,1);
  assert.equal((h.modals.at(-1).body.match(/class="governor-vacant"/g)||[]).length,7);
  assert(h.modals.at(-1).body.includes('家臣が足りない施設は未任命'));
  const before=plain(h.game.state);await h.click();
  assert.deepEqual(h.game.state,before);assert.equal(h.modals.at(-1).title,'現在の配置を維持しました');
});

await test('durable storage failure rolls back the exact governor map and never reports success or emits a save event',async()=>{
  const h=harness(create({all:true})),spare=h.game.state.officers.find(id=>!h.game.state.army.includes(id));
  h.game.assignGovernor('farm',spare);h.stored.set('save',h.game.exportSave());
  const before=plain(h.game.state),governorReference=h.game.state.governors,storedBefore=h.stored.get('save');h.flags.failSave=true;
  await h.click();
  assert.deepEqual(h.game.state,before);assert.equal(h.game.state.governors,governorReference);assert.equal(h.stored.get('save'),storedBefore);
  assert.equal(h.writes.length,0);assert.equal(h.events.length,0);assert.equal(h.modals.length,0);assert.equal(h.calls.sound,0);
  assert(h.toasts.some(item=>item.error&&item.message.includes('元の配置に戻しました')));
  assert.equal(h.c.saveEnabled,false);assert(h.controls.every(node=>node.disabled));
});

await test('unverified roles, pending sync, followers and expired leases disable controls and reject direct action dispatch',async()=>{
  const states=[{rolePending:true},{linked:true,ready:false,writable:false},{linked:true,ready:true,writable:false},{linked:true,ready:true,writable:true,leaseExpiresAt:new Date(Date.now()-1000).toISOString()}];
  for(const access of states){
    const h=harness(create({all:true}));Object.assign(h.c.syncAccess,access);const before=plain(h.game.state),raw=h.stored.get('save');
    let engineCalls=0;const assign=h.game.autoAssignGovernors.bind(h.game);h.game.autoAssignGovernors=()=>{engineCalls++;return assign();};
    h.c.refreshLiveControls();assert(h.controls.every(node=>node.disabled));
    await h.click({force:true});h.c.autoAssignGovernors();
    assert.equal(engineCalls,0);assert.deepEqual(h.game.state,before);assert.equal(h.stored.get('save'),raw);assert.equal(h.writes.length,0);assert.equal(h.modals.length,0);
  }
});

await test('clock catch-up, pending field/walking actions and a prior storage failure also leave assignments untouched',async()=>{
  for(const flag of ['worldCatchingUp','fieldActionPending','walkingActionPending','strategyActionPending','worldSettlementPending','saveEnabled']){
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
  await h.click();
  assert.equal(game.state.buildings.gold_mine,1);assert(game.state.governors.gold_mine);
  assert.deepEqual(withoutGovernors(game.state),withoutGovernors(before));
  const stored=JSON.parse(h.stored.get('save'));assert.equal(stored.state.buildings.gold_mine,0);assert.equal(stored.state.governors.gold_mine,game.state.governors.gold_mine);
  assert.deepEqual(E.fromSave(stored,roster,{isStaff:true,staffBase:base}).state.governors,game.state.governors);
});

await test('no non-army candidates disables the entry and a normal click cannot save',async()=>{
  const game=create(),owned=game.state.army.slice();game.state.officers=owned.slice();game.state.officerVariants=game.state.officerVariants.filter(key=>owned.includes(key.split(':')[0]));
  const h=harness(game),before=plain(game.state);h.c.refreshLiveControls();assert(h.controls.every(node=>node.disabled));
  assert(h.c.governorAssignmentEntry().includes('軍団に入っていない家臣'));
  await h.click();assert.deepEqual(game.state,before);assert.equal(h.writes.length,0);assert.equal(h.modals.length,0);
});

await test('result rows and facility labels escape officer names and omit labels for unbuilt facilities',async()=>{
  const h=harness(),spare=h.game.state.officers.find(id=>!h.game.state.army.includes(id));
  h.game.officerMap[spare].name='<img src=x onerror=alert(1)>';
  await h.click();const building=Object.keys(h.game.state.governors)[0],body=h.modals.at(-1).body,label=h.c.facilityGovernorLabel(building);
  assert(body.includes('&lt;img'));assert(label.includes('&lt;img'));assert(!body.includes('<img src=x'));assert(!label.includes('<img src=x'));
  assert.equal(h.c.facilityGovernorLabel('gold_mine'),'');
});

console.log(`${count} automatic governor UI scenarios passed. No external requests or player data changes.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
