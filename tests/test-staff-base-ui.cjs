/* Real app bootstrap with in-memory DOM/storage; no remote service is contacted. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine,SENGOKU_DATA}=require('../engine.js');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),rosterContext={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),rosterContext);
const roster=rosterContext.window.SENGOKU_OFFICERS,SAVE='sengoku-tento-save-v2',BACKUP='sengoku-cloud-backups-v1',plain=v=>JSON.parse(JSON.stringify(v));
const clock={id:'staff-test-world',elapsedMs:120000,confirmedElapsedMs:120000,running:true,speed:1,revision:1,calendar:{turn:2,year:1560,month:3,cycle:0,elapsed:0}};
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}
function personal(){const g=new SengokuEngine({clan:'伊達家',startCastle:'himeji',officers:roster,seed:7});g.state.buildings.farm=3;g.state.resources.gold=900000;g.state.resources.wood=900000;g.state.resources.stone=900000;g.applyWorldClock(clock);return g;}
function base(revision=1){const buildings=plain(personal().state.buildings);buildings.farm=5;buildings.keep=10;return {id:'kyoto_gosho',revision,castleLevel:63,buildings,initial:{castleLevel:63,buildings:plain(buildings)},history:[],jobs:[],updatedElapsedMs:120000,accessSinceElapsedMs:0,personalClan:'伊達家',protected:true};}
function browser(initialSave,{linked=false,liveModal=false,travelUI}={}) {
  const stored = new Map(initialSave === undefined ? [] : [[SAVE, initialSave]]);
  if(linked)stored.set('sengoku-online-identity-v1',JSON.stringify({id:'staff-fixture',token:'test-token'}));
  const nodes = new Map(), handlers = new Map(), events = [];
  const staticIds = new Set(['main','calendar','resources','clan-panel','sound-button','navigation','save-indicator','save-import','modal','modal-content','toast']);
  let failSave = false;
  const modalDOM=liveModal?require('./helpers/dom-model.cjs').setup():null;
  const stable=liveModal?require('../stable-dom.js'):null;
  function decorate(node){if(!node)return node;if(!node.classList.toggle)node.classList.toggle=(name,force)=>{const enabled=force===undefined?!node.classList.contains(name):!!force;if(enabled)node.classList.add(name);else node.classList.remove(name);return enabled;};if(modalDOM)node.focus=()=>{if(!node.disabled)modalDOM.doc.activeElement=node;};return node;}
  if(modalDOM)modalDOM.doc.onAttributeChange=({node,name,after})=>{if(name==='disabled'&&after!==null&&node===modalDOM.doc.activeElement)modalDOM.doc.activeElement=modalDOM.doc.body;};
  class Node {
    constructor(id) { this.id=id;this.dataset={};this.style={};this.value='';this.scrollTop=0;this.disabled=false;this.open=false;this._html='';this.classList={add(){},remove(){},toggle(){}}; }
    set innerHTML(value) { this._html=value; if(this.id==='modal-content')for(const id of [...nodes.keys()])if(!staticIds.has(id))nodes.delete(id); }
    get innerHTML(){return this._html;}
    setAttribute(){} addEventListener(){} querySelectorAll(){return [];} querySelector(){return null;}
    insertAdjacentHTML(_where,html){this._html=html+this._html;} contains(){return false;}
    showModal(){this.open=true;} close(){this.open=false;} focus(){} matches(){return false;}
  }
  for(const id of staticIds)nodes.set(id,new Node(id));
  function query(selector) {
    if(modalDOM){const node=modalDOM.host.querySelector(selector);if(node)return decorate(node);}
    if(!selector.startsWith('#'))return null;
    const id=selector.slice(1);if(nodes.has(id))return nodes.get(id);
    const html=nodes.get('modal-content').innerHTML+nodes.get('main').innerHTML;
    if(!html.includes(`id="${id}"`))return null;
    const node=new Node(id), select=html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    if(select){const options=[...select[1].matchAll(/<option\s+value="([^"]*)"([^>]*)>/g)];node.value=(options.find(m=>/\bselected\b/.test(m[2]))||options[0])?.[1]||'';}
    nodes.set(id,node);return node;
  }
  const document = {hidden:false,activeElement:null,querySelector:query,querySelectorAll:selector=>modalDOM?modalDOM.host.querySelectorAll(selector).map(decorate):[],getElementById:id=>query('#'+id),addEventListener:(type,fn)=>{if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);}};
  if(modalDOM){
    document.createElement=name=>modalDOM.doc.createElement(name);
    Object.defineProperty(document,'activeElement',{get:()=>modalDOM.doc.activeElement,set:node=>{modalDOM.doc.activeElement=node;}});
  }
  const c = {document,console,SengokuEngine,SENGOKU_DATA,SENGOKU_OFFICERS:roster,Date,Math,URL,Blob,URLSearchParams,
    localStorage:{getItem:key=>stored.has(key)?stored.get(key):null,setItem:(key,value)=>{if(failSave&&key===SAVE)throw Error('storage full');stored.set(key,value);},removeItem:key=>stored.delete(key)},
    crypto:require('node:crypto').webcrypto,navigator:{},location:{hash:'#town',protocol:'https:'},history:{replaceState(){}},performance:{now:()=>1000},
    setInterval:()=>1,setTimeout:()=>1,clearTimeout(){},scrollTo(){},scrollX:0,scrollY:0,
    addEventListener(){},dispatchEvent:event=>events.push(event.type),CustomEvent:class{constructor(type){this.type=type;}}
  };
  if(modalDOM)c.SengokuStableDOM={patch(node,html,options){node._html=html;if(node===nodes.get('modal-content'))return stable.patch(modalDOM.host,html,options);if(node.ownerDocument===modalDOM.doc)return stable.patch(node,html,options);node.innerHTML=html;return{artwork:false};},forget(node){if(node===nodes.get('modal-content'))stable.forget(modalDOM.host);}};
  if(travelUI)c.SengokuTravelUI=travelUI;
  c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../kamon.js'),'utf8'),c);vm.runInContext(source,c);
  async function event(type,target){for(const listener of handlers.get(type)||[])await listener({target});}
  async function click(action,id){const node={disabled:false,dataset:{action,id},closest(){return this;}};await event('click',node);}
  return {c,stored,events,nodes,query,click,event,failNextSave:()=>{failSave=true;}};
}

(async()=>{
await test('reload and temporary authentication loss preserve the exact staff formation while blocking writes',async()=>{
  const shared=base();shared.buildings.gold_mine=shared.initial.buildings.gold_mine=1;
  const g=SengokuEngine.fromSave(personal().exportSave(),roster,{isStaff:true,staffBase:shared}),ids=[...g.state.officers];
  assert(g.assignArmy([ids[1],ids[0]]).ok);assert(g.assignGovernor('gold_mine',ids[2]).ok);assert(g.assignGovernor('farm',ids[3]).ok);
  const original=g.exportSave(),formation={army:plain(g.state.army),governors:plain(g.state.governors)},b=browser(original,{linked:true}),bridge=b.c.SengokuBridge;
  assert.equal(bridge.getRoleAccess().isStaff,false);assert.equal(bridge.getRoleAccess().pending,true);assert.equal(bridge.canReceiveGifts(),false);
  assert.equal(b.stored.get(SAVE),original,'Bootstrap never writes its unverified role projection');assert.deepEqual(plain(bridge.getSave().state.governors),formation.governors);
  bridge.setRoleAccess({isStaff:true});assert(bridge.applyStaffBase(shared).ok);bridge.setSyncAccess({linked:true,ready:true,writable:true});assert.equal(bridge.canReceiveGifts(),true);
  bridge.setRoleAccess({pending:true});assert.equal(bridge.getRoleAccess().isStaff,false);assert.equal(bridge.getRoleAccess().isAdmin,false);assert.equal(bridge.canReceiveGifts(),false);
  assert.equal(bridge.applyGift({gold:100},'unverified-gift').ok,false);b.c.document.hidden=true;await b.event('visibilitychange');b.c.document.hidden=false;
  assert.equal(b.stored.get(SAVE),original);assert.deepEqual(plain(bridge.getSave().state.governors),formation.governors);
  bridge.setRoleAccess({isStaff:true});assert(bridge.applyStaffBase(shared).ok);
  assert.deepEqual(plain(bridge.getState().army),formation.army);assert.deepEqual(plain(bridge.getState().governors),formation.governors);assert.equal(bridge.canReceiveGifts(),true);
});
await test('confirmed demotion still removes shared-only appointments without resetting the army or personal governors',()=>{
  const shared=base();shared.buildings.gold_mine=shared.initial.buildings.gold_mine=1;
  const g=SengokuEngine.fromSave(personal().exportSave(),roster,{isStaff:true,staffBase:shared}),ids=[...g.state.officers];
  g.assignArmy([ids[1],ids[0]]);g.assignGovernor('gold_mine',ids[2]);g.assignGovernor('farm',ids[3]);
  const b=browser(g.exportSave(),{linked:true}),bridge=b.c.SengokuBridge;bridge.setRoleAccess({isStaff:true});bridge.applyStaffBase(shared);bridge.setSyncAccess({linked:true,ready:true,writable:true});
  bridge.setRoleAccess({pending:true});bridge.setRoleAccess({isAdmin:false,isStaff:false});
  assert.equal(bridge.getRoleAccess().pending,false);assert.equal(bridge.getRoleAccess().isStaff,false);assert.equal(bridge.getStaffBase(),null);
  assert.deepEqual(plain(bridge.getState().army),[ids[1],ids[0]]);assert.deepEqual(plain(bridge.getState().governors),{farm:ids[3]});assert.notEqual(bridge.getState().home,'kyoto_gosho');
  assert(bridge.applyGift({gold:1},'verified-ordinary-gift').ok);assert.deepEqual(JSON.parse(b.stored.get(SAVE)).state.governors,{farm:ids[3]});
});
await test('verified staff metadata fixes the house and Kyoto Gosho, preserves officers, and shares growth without exporting it',()=>{
  const g=personal(),b=browser(g.exportSave()),bridge=b.c.SengokuBridge,shared=base();
  const forged=JSON.parse(SengokuEngine.fromSave(g.exportSave(),roster,{isAdmin:true}).exportSave());Object.assign(forged.state,{isStaff:true,isAdmin:true});
  assert(bridge.applyCloudSave(forged,{isStaff:false}).ok);assert.notEqual(bridge.getState().home,'kyoto_gosho');assert.notEqual(bridge.getState().home,'edo');assert.notEqual(bridge.getState().clan,'德川家');assert(!bridge.getState().officerVariants.includes('of_b0616adde162:U'));assert.equal(bridge.getRoleAccess().isAdmin,false);assert.equal(bridge.getRoleAccess().isStaff,false);
  assert(bridge.applyCloudSave(g.exportSave(),{isStaff:true,staffBase:shared}).ok);
  assert.equal(bridge.getState().home,'kyoto_gosho');assert.equal(bridge.getState().clan,'德川家');assert.equal(bridge.getState().castles.kyoto_gosho.owner,'德川家');
  assert.equal(bridge.getRoleAccess().isAdmin,false);assert.equal(bridge.getRoleAccess().isStaff,true);
  assert.deepEqual(plain(bridge.getState().officers),plain(g.state.officers));assert.deepEqual(plain(bridge.getState().officerVariants),plain(g.state.officerVariants));
  assert(!bridge.getState().officerVariants.includes('of_b0616adde162:U'));
  const header=b.nodes.get('clan-panel').innerHTML;
  assert.match(header,/<b>徳川家<\/b>/);assert.match(header,/徳川家康 の治世/);assert.match(header,/assets\/kamon\/tokugawa\.svg/);assert.match(header,/aria-label="徳川家：三つ葉葵"/);assert(!/運営|スタッフ/.test(header));
  assert(!header.includes('織田信長'));assert(!header.includes('德川家康 の治世'));
  assert.equal(bridge.getState().buildings.farm,5);assert.equal(bridge.getState().castles.kyoto_gosho.level,63);
  assert.equal(bridge.getSave().state.buildings.farm,3);const before=plain(bridge.getSave().state),events=b.events.length;
  const next=base(2);next.buildings.farm=6;next.initial.buildings.farm=6;next.castleLevel=64;next.initial.castleLevel=64;
  assert(bridge.applyStaffBase(next).changed);assert.equal(bridge.getState().buildings.farm,6);
  assert.equal(bridge.getState().castles.kyoto_gosho.level,64);assert.deepEqual(plain(bridge.getSave().state),before);
  assert.equal(b.events.length,events,'Shared projection never emits a personal save');
});
await test('role revocation removes the shared view and rejects late base replies, with operator priority',()=>{
  const b=browser(personal().exportSave()),bridge=b.c.SengokuBridge;
  bridge.setRoleAccess({isStaff:true});const epoch=bridge.getRoleAccess().epoch;
  assert.equal(bridge.getStaffBase(),null);assert(bridge.applyStaffBase(base(),{roleEpoch:epoch}).ok);
  bridge.setRoleAccess({isStaff:false});const own=plain(bridge.getState());
  assert.notEqual(own.home,'kyoto_gosho');assert.equal(own.clan,'伊達家');assert.equal(own.buildings.farm,3);assert.equal(bridge.getStaffBase(),null);
  assert.equal(bridge.applyStaffBase(base(2),{roleEpoch:epoch}).ok,false);assert.deepEqual(plain(bridge.getState()),own);
  bridge.setRoleAccess({isAdmin:true,isStaff:true});assert.equal(bridge.getState().home,'edo');assert.equal(bridge.getRoleAccess().isStaff,false);
  assert(bridge.getSave().state.officerVariants.includes('of_b0616adde162:U'));assert.equal(bridge.getStaffBase(),null);
});
await test('a staff first start waits for the shared source and fixes both 德川家 and Kyoto Gosho',async()=>{
  const b=browser(),bridge=b.c.SengokuBridge;bridge.setRoleAccess({isStaff:true});bridge.openStartSelection();
  const chooser=b.nodes.get('modal-content').innerHTML;
  assert.match(chooser,/共同本拠 · 京都御所固定/);assert.match(chooser,/家は徳川家に固定/);assert(!/運営|スタッフ/.test(chooser));assert.equal(b.query('#new-start-castle'),null);
  assert.equal((chooser.match(/data-action="choose-clan"/g)||[]).length,1);assert.match(chooser,/data-id="德川家"/);assert.match(chooser,/<small>徳川家康<\/small>/);
  assert(!chooser.includes('data-id="武田家"'));assert(!chooser.includes('data-id="徳川家"'));assert(!chooser.includes('德川家康 U の特別イラスト'));
  await b.click('start-new');assert.equal(bridge.hasStarted(),false);assert(!b.stored.has(SAVE));
  bridge.applyStaffBase(base());await b.click('choose-clan','武田家');await b.click('start-new');
  assert.equal(bridge.hasStarted(),true);assert.equal(bridge.getState().home,'kyoto_gosho');assert.equal(bridge.getState().clan,'德川家');
  assert.equal(bridge.getRoleAccess().isAdmin,false);assert(!bridge.getState().officerVariants.includes('of_b0616adde162:U'));
  assert.equal(bridge.getState().buildings.farm,5);assert.equal(b.nodes.get('modal').open,false);
});
await test('shared construction names are escaped and separate timers distinguish personal work on the same facility',()=>{
  const g=personal();g.state.jobs.push({kind:'building',id:'farm',remaining:1,total:1,remainingSeconds:60,totalSeconds:60,targetLevel:4});
  const shared=base();shared.jobs=[{jobId:'job1',kind:'building',id:'farm',targetLevel:6,totalSeconds:60,startedElapsedMs:100000,completesElapsedMs:160000,startedBy:{id:'PRIVATE-ACTOR-ID',name:'<img src=x onerror=alert(1)>'}}];
  const b=browser(g.exportSave());assert(b.c.SengokuBridge.applyCloudSave(g.exportSave(),{isStaff:true,staffBase:shared}).ok);
  const html=b.nodes.get('main').innerHTML;
  assert.match(html,/staff-base-notice/);assert.match(html,/共同拠点/);assert.match(html,/farm:shared/);assert.match(html,/farm:personal/);
  assert.match(html,/経過 20秒/);assert.match(html,/あと 40秒/);assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert(!html.includes('<img src=x'));assert(!html.includes('PRIVATE-ACTOR-ID'));
});
await test('town structure dedicates the left column to the complete town and keeps the console content in the right column',()=>{
  const b=browser(personal().exportSave()),html=b.nodes.get('main').innerHTML;
  assert.match(html,/dashboard-grid town-workspace/);assert.match(html,/left-column town-visual/);assert.match(html,/right-column town-console/);
  const visual=html.slice(html.indexOf('left-column town-visual'),html.indexOf('right-column town-console'));
  assert(visual.includes('town-scene-image'));assert(!visual.includes('page-heading'));assert(!visual.includes('buildings-grid'));
  const overview=html.indexOf('town-overview'),facilities=html.indexOf('town-facility-console'),status=html.indexOf('town-status-panels');
  assert(overview<facilities&&facilities<status);
});
await test('staff castle UI allows level 128 while facilities retain level 32',async()=>{
  const b=browser(personal().exportSave()),bridge=b.c.SengokuBridge,nearLimit=base();nearLimit.castleLevel=127;nearLimit.initial.castleLevel=127;bridge.setRoleAccess({isStaff:true});bridge.applyStaffBase(nearLimit);
  await b.click('staff-base-detail');let html=b.nodes.get('modal-content').innerHTML;
  assert.match(html,/Lv\.127 \/ 128/);assert.match(html,/Lv\.128へ共同普請する/);assert(!html.includes('最高のLv.32'));
  assert.match(html,/自領 · 徳川家/);assert.match(html,/aria-label="徳川家：三つ葉葵"/);assert(!html.includes('江戸城を本拠'));
  const complete=base(2);complete.castleLevel=128;complete.initial.castleLevel=128;bridge.applyStaffBase(complete);
  html=b.nodes.get('modal-content').innerHTML;assert.match(html,/最高のLv\.128/);assert(!html.includes('data-action="upgrade-castle"'));
  await b.click('building','farm');html=b.nodes.get('modal-content').innerHTML;assert.match(html,/Lv\.5 \/ 32/);assert.match(html,/共同普請する/);
});
await test('independent base polls retain the current view and an open facility modal',async()=>{
  const b=browser(personal().exportSave()),bridge=b.c.SengokuBridge;bridge.setRoleAccess({isStaff:true});bridge.applyStaffBase(base());
  await b.click('building','farm');const beforeModal=b.nodes.get('modal').open,location=b.c.location.hash;
  const same=bridge.applyStaffBase(base());assert.equal(same.changed,false);
  const next=base(2);next.buildings.farm=6;next.initial.buildings.farm=6;bridge.applyStaffBase(next);
  assert.equal(b.nodes.get('modal').open,beforeModal);assert.equal(b.c.location.hash,location);assert.match(b.nodes.get('modal-content').innerHTML,/Lv\.6 \/ 32/);
  assert.match(b.nodes.get('main').innerHTML,/town-workspace/);
});
await test('a staff house name never enables operator recovery, Edo ownership, or the exclusive U officer',async()=>{
  const b=browser(personal().exportSave()),bridge=b.c.SengokuBridge;
  bridge.applyCloudSave(personal().exportSave(),{isStaff:true,staffBase:base()});
  await b.click('settings');assert(!b.nodes.get('modal-content').innerHTML.includes('data-action="restore-admin-assets"'));
  const before=plain(bridge.getState());await b.click('restore-admin-assets');assert.deepEqual(plain(bridge.getState()),before);
  assert.equal(bridge.getRoleAccess().isAdmin,false);assert.equal(bridge.getState().home,'kyoto_gosho');assert.notEqual(bridge.getState().castles.edo.owner,'德川家');
});
await test('ordinary 徳川家 remains selectable without staff or operator access',async()=>{
  const b=browser(),bridge=b.c.SengokuBridge;bridge.openStartSelection();
  let html=b.nodes.get('modal-content').innerHTML;assert(html.includes('data-id="徳川家"'));assert(!html.includes('data-id="德川家"'));
  assert.match(html,/data-action="choose-residency-mode" data-id="local"/);
  await b.click('choose-residency-mode','local');
  b.query('#new-start-castle').value='himeji';await b.event('change',b.query('#new-start-castle'));
  await b.click('choose-clan','徳川家');await b.click('choose-clan','德川家');await b.click('start-new');
  assert.equal(bridge.getState().clan,'徳川家');assert.equal(bridge.getState().home,'himeji');assert.equal(bridge.getRoleAccess().isStaff,false);assert.equal(bridge.getRoleAccess().isAdmin,false);
  assert(!bridge.getState().officerVariants.includes('of_b0616adde162:U'));assert.match(b.nodes.get('clan-panel').innerHTML,/aria-label="徳川家：三つ葉葵"/);
  html=b.nodes.get('main').innerHTML;assert(!html.includes('staff-base-notice'));
});
await test('real app branch construction pays once, retains its detail modal and refreshes the completed level',async()=>{
  const b=browser(personal().exportSave()),bridge=b.c.SengokuBridge;b.c.SengokuBranches=require('../branches.js');bridge.setRoleAccess({isAdmin:true});await b.click('level-guide-castle','edo');const before=plain(bridge.getState());assert.match(b.nodes.get('modal-content').innerHTML,/data-action="build-branch"/);
  await b.event('click',{disabled:false,dataset:{action:'build-branch',id:'edo',direction:'north'},closest(){return this;}});const after=bridge.getState();assert.equal(after.branches[0].id,'edo_north');assert.equal(after.branches[0].level,0);assert.equal(after.command,before.command-1);assert(after.resources.gold<before.resources.gold);assert.equal(b.nodes.get('modal').open,true);assert.match(b.nodes.get('modal-content').innerHTML,/branch:edo_north:personal:1/);
  const completed=plain(bridge.getSave());completed.state.jobs=completed.state.jobs.filter(job=>job.kind!=='branch');completed.state.branches[0].level=1;assert(bridge.applyCloudSave(completed,{isAdmin:true}).ok);assert.equal(b.nodes.get('modal').open,true);assert.match(b.nodes.get('modal-content').innerHTML,/Lv\.1 \/ 8/);assert.match(b.nodes.get('modal-content').innerHTML,/data-action="upgrade-branch"/);assert.match(b.nodes.get('modal-content').innerHTML,/data-action="build-branch"/);
});
await test('the complete Edo modal keeps four Lv8 defenses and removes only exhausted construction controls',async()=>{
 const b=browser(personal().exportSave(),{liveModal:true}),bridge=b.c.SengokuBridge;b.c.SengokuBranches=require('../branches.js');bridge.setRoleAccess({isAdmin:true});await b.click('level-guide-castle','edo');
 const saved=plain(bridge.getSave());saved.state.branches=['north','east','south','west'].map(direction=>({id:'edo_'+direction,parentCastleId:'edo',direction,level:8,fallen:false}));assert(bridge.applyCloudSave(saved,{isAdmin:true}).ok);
 assert.equal(bridge.getState().branches.length,4);assert.equal(b.nodes.get('modal').open,true);assert.match(b.nodes.get('modal-content').innerHTML,/最大4か所/);assert.match(b.nodes.get('modal-content').innerHTML,/各Lv\.8/);assert.equal(b.c.document.querySelectorAll('.branch-card').length,4);assert.equal(b.query('[data-action="build-branch"]'),null);assert.equal(b.query('[data-action="upgrade-branch"]'),null);assert.equal(b.query('[data-branch-parent]'),null);
 const revision=plain(bridge.getSave());revision.state.branches[3].fallen=true;assert(bridge.applyCloudSave(revision,{isAdmin:true}).ok);assert.match(b.nodes.get('modal-content').innerHTML,/防衛中の支拠点 3か所/);assert(b.query('[data-action="repair-branch"]'));assert.equal(b.c.document.querySelectorAll('.branch-card').length,4);
});
await test('canonical app refresh preserves a branch direction and the matching build payload',async()=>{
 const b=browser(personal().exportSave()),bridge=b.c.SengokuBridge;b.c.SengokuBranches=require('../branches.js');bridge.setRoleAccess({isAdmin:true});await b.click('level-guide-castle','edo');
 await b.event('change',{dataset:{branchParent:'edo'},value:'south'});assert.match(b.nodes.get('modal-content').innerHTML,/data-direction="south"/);
 assert(bridge.applyCloudSave(bridge.getSave(),{isAdmin:true}).ok);assert.match(b.nodes.get('modal-content').innerHTML,/<option value="south" selected>/);assert.match(b.nodes.get('modal-content').innerHTML,/data-direction="south"/);
});
await test('quiet canonical refresh keeps the branch preference editable while construction actions wait for the writer',async()=>{
 const initial=personal();initial.state.castles.nijo.owner=initial.state.clan;initial.state.captureRewards.push('nijo');
 const b=browser(initial.exportSave(),{liveModal:true}),bridge=b.c.SengokuBridge;b.c.SengokuBranches=require('../branches.js');await b.click('level-guide-castle','nijo');
 const select=b.query('#branch-direction-nijo');select.value='south';select.focus();await b.event('change',select);assert.equal(select.disabled,false);
 bridge.setSyncAccess({linked:true,ready:true,writable:false,rolePending:false,reason:'applying'});assert(bridge.applyCloudSave(bridge.getSave()).ok);
 assert.strictEqual(b.query('#branch-direction-nijo'),select);assert.equal(select.disabled,false,'A local compass choice stays editable while the save is applying');assert.strictEqual(b.c.document.activeElement,select);assert.equal(select.value,'south');
 const build=b.c.document.querySelectorAll('[data-action="build-branch"]')[0];assert(build.disabled);const before=JSON.stringify(bridge.getState());await b.event('click',build);assert.equal(JSON.stringify(bridge.getState()),before,'Editing a preference does not unlock construction');
 select.value='west';await b.event('change',select);assert.equal(b.c.document.querySelectorAll('[data-action="build-branch"]')[0].dataset.direction,'west');assert.equal(b.c.document.querySelectorAll('[data-action="build-branch"]')[0].disabled,true);
 bridge.setSyncAccess({linked:true,ready:true,writable:true,rolePending:false,reason:'writer'});assert.strictEqual(b.query('#branch-direction-nijo'),select);assert.equal(select.disabled,false);assert.equal(select.value,'west');assert.strictEqual(b.c.document.activeElement,select);assert.equal(b.c.document.querySelectorAll('[data-action="build-branch"]')[0].disabled,false);
 select.disabled=true;bridge.setSyncAccess({linked:true,ready:true,writable:true});assert.equal(select.disabled,true,'An unchanged acknowledgement intentionally skips rescanning every live control');
 bridge.setSyncAccess({linked:true,ready:true,writable:false,reason:'applying'});assert.equal(select.disabled,false,'An actual authority transition repairs a stale disabled attribute without rebuilding the field');
 bridge.setSyncAccess({linked:true,ready:true,writable:true,reason:'writer'});assert.strictEqual(b.query('#branch-direction-nijo'),select);assert.equal(select.disabled,false);
});
await test('branch departure preserves its target, refunds a vanished defense, and renders branch-specific combat receipts',async()=>{
  let actions;
  const travelUI={...require('../travel-ui.js'),configure(options){actions=options;}};
  const b=browser(personal().exportSave(),{travelUI}),bridge=b.c.SengokuBridge;
  b.c.SengokuBranches=require('../branches.js');
  const s=bridge.getState();s.castles.nijo.owner='在地衆';
  const neighbor=SENGOKU_DATA.castles.find(c=>c.id==='nijo').neighbors[0];s.castles[neighbor].owner=s.clan;
  s.branches=[{id:'nijo_east',parentCastleId:'nijo',direction:'east',level:2,fallen:false}];s.command=3;s.troops=30000;s.resources.rice=900000;
  // Enemy branches are absent from the attacker's durable private save.
  // Retain a separate battle fixture for the distinct completed-report route.
  const defender=personal();defender.state=plain(s);
  const combat=defender.attackBranch('nijo_east','balanced',s.troops);
  assert(combat.ok);assert.equal(combat.battle.branchId,'nijo_east');assert.equal(combat.battle.captured,false);
  const before={troops:s.troops,command:s.command,battles:s.stats.battles};
  await b.click('prepare-branch-battle','nijo_east');let html=b.nodes.get('modal-content').innerHTML;
  assert.match(html,/支拠点への出陣/);assert.match(html,/data-action="attack-branch"/);assert.match(html,/領地の占領・資源の獲得はありません/);
  await b.click('attack-branch');const march=bridge.getState().march;
  assert.equal(march.targetBranchId,'nijo_east');assert.equal(bridge.getState().lastBattle,null);
  assert.equal(actions.getLocal()[0].id,march.id);assert.equal(b.nodes.get('modal').open,false);
  const due={...clock,elapsedMs:march.arrivesElapsedMs,confirmedElapsedMs:march.arrivesElapsedMs};
  b.c.SengokuWorldClock={snapshot:()=>({ready:true,clock:due}),refresh(){}};
  await b.event('visibilitychange',b.c.document);
  const receipt=actions.getLocal().find(row=>row.id===march.id);assert(receipt);
  assert.equal(receipt.status,'cancelled');assert.equal(receipt.targetBranchId,march.targetBranchId);
  assert.equal(receipt.battle,undefined);assert.equal(actions.onReport(receipt),false);
  assert.equal(bridge.getState().castles.nijo.owner,'在地衆');assert.equal(bridge.getState().march,null);
  assert.equal(bridge.getState().troops,before.troops);assert.equal(bridge.getState().command,before.command);
  assert.equal(bridge.getState().stats.battles,before.battles);
  const completed={...march,status:'resolved',battle:combat.battle};
  assert.equal(actions.onReport(completed),true);assert.equal(b.nodes.get('modal').open,true);
  html=b.nodes.get('modal-content').innerHTML;assert.match(html,/領地の占領・資源の獲得はありません/);assert.doesNotMatch(html,/領国に加わりました/);
});
await test('court navigation and evaluation entry mount once, refresh in place and dispose on leaving',async()=>{
  const b=browser(personal().exportSave()),bridge=b.c.SengokuBridge,trace=[];let options;
  b.c.SengokuCourt={mount(host,value){assert.equal(host.id,'court-field');options=value;trace.push('mount');return{refresh(){trace.push('refresh');},dispose(){trace.push('dispose');},controller:{selectSection(section){trace.push(section);}}};}};
  assert.match(b.nodes.get('navigation').innerHTML,/data-view="court"/);bridge.showEvaluation();assert.match(b.nodes.get('modal-content').innerHTML,/京都御所へ出向く/);
  bridge.openCourt();assert.equal(b.nodes.get('main').dataset.view,'court');assert.equal(options.initialSection,'overview');assert.equal(b.nodes.get('modal').open,false);bridge.setSyncAccess({linked:true,ready:true,writable:false,rolePending:false,reason:'follower'});assert.equal(trace.filter(x=>x==='mount').length,1);assert(trace.includes('refresh'),'A changed authority refreshes the existing court without remounting it');
  bridge.openCourt({management:true});assert.equal(trace.at(-1),'management');assert.equal(trace.filter(x=>x==='mount').length,1);
  await b.event('click',{disabled:false,dataset:{view:'town'},closest(){return this;}});assert.equal(trace.filter(x=>x==='dispose').length,1);bridge.openCourt({management:true});assert.equal(options.initialSection,'management');assert.equal(trace.filter(x=>x==='mount').length,2);
});
console.log(`${count} staff-base application UI scenarios passed. No network requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});

