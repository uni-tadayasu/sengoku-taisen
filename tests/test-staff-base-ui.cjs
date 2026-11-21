/* Real app bootstrap with in-memory DOM/storage; no remote service is contacted. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine,SENGOKU_DATA}=require('../engine.js');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),rosterContext={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),rosterContext);
const roster=rosterContext.window.SENGOKU_OFFICERS,SAVE='sengoku-tento-save-v2',BACKUP='sengoku-cloud-backups-v1',plain=v=>JSON.parse(JSON.stringify(v));
const clock={id:'staff-test-world',elapsedMs:120000,confirmedElapsedMs:120000,running:true,speed:1,revision:1,calendar:{turn:2,year:1560,month:3,cycle:0,elapsed:0}};
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}
function personal(){const g=new SengokuEngine({clan:'伊達家',startCastle:'himeji',officers:roster,seed:7});g.state.buildings.farm=3;g.state.resources.gold=900000;g.state.resources.wood=900000;g.state.resources.stone=900000;g.applyWorldClock(clock);return g;}
function base(revision=1){const buildings=plain(personal().state.buildings);buildings.farm=5;buildings.keep=10;return {id:'sunpu',revision,castleLevel:63,buildings,initial:{castleLevel:63,buildings:plain(buildings)},history:[],jobs:[],updatedElapsedMs:120000,accessSinceElapsedMs:0,protected:true};}
function browser(initialSave) {
  const stored = new Map(initialSave === undefined ? [] : [[SAVE, initialSave]]);
  const nodes = new Map(), handlers = new Map(), events = [];
  const staticIds = new Set(['main','calendar','resources','clan-panel','sound-button','navigation','save-indicator','save-import','modal','modal-content','toast']);
  let failSave = false;
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
    if(!selector.startsWith('#'))return null;
    const id=selector.slice(1);if(nodes.has(id))return nodes.get(id);
    const html=nodes.get('modal-content').innerHTML+nodes.get('main').innerHTML;
    if(!html.includes(`id="${id}"`))return null;
    const node=new Node(id), select=html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    if(select){const options=[...select[1].matchAll(/<option\s+value="([^"]*)"([^>]*)>/g)];node.value=(options.find(m=>/\bselected\b/.test(m[2]))||options[0])?.[1]||'';}
    nodes.set(id,node);return node;
  }
  const document = {hidden:false,activeElement:null,querySelector:query,querySelectorAll:()=>[],getElementById:id=>query('#'+id),addEventListener:(type,fn)=>{if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);}};
  const c = {document,console,SengokuEngine,SENGOKU_DATA,SENGOKU_OFFICERS:roster,Date,Math,URL,Blob,URLSearchParams,
    localStorage:{getItem:key=>stored.has(key)?stored.get(key):null,setItem:(key,value)=>{if(failSave&&key===SAVE)throw Error('storage full');stored.set(key,value);},removeItem:key=>stored.delete(key)},
    crypto:require('node:crypto').webcrypto,navigator:{},location:{hash:'#town',protocol:'https:'},history:{replaceState(){}},performance:{now:()=>1000},
    setInterval:()=>1,setTimeout:()=>1,clearTimeout(){},scrollTo(){},scrollX:0,scrollY:0,
    addEventListener(){},dispatchEvent:event=>events.push(event.type),CustomEvent:class{constructor(type){this.type=type;}}
  };
  c.window=c;vm.createContext(c);vm.runInContext(source,c);
  async function event(type,target){for(const listener of handlers.get(type)||[])await listener({target});}
  async function click(action,id){const node={disabled:false,dataset:{action,id},closest(){return this;}};await event('click',node);}
  return {c,stored,events,nodes,query,click,event,failNextSave:()=>{failSave=true;}};
}

(async()=>{
await test('verified staff metadata fixes Sunpu, retains the house, and shares growth without exporting it',()=>{
  const g=personal(),b=browser(g.exportSave()),bridge=b.c.SengokuBridge,shared=base();
  const forged=JSON.parse(g.exportSave());forged.state.isStaff=true;
  assert(bridge.applyCloudSave(forged,{isStaff:false}).ok);assert.notEqual(bridge.getState().home,'sunpu');
  assert(bridge.applyCloudSave(g.exportSave(),{isStaff:true,staffBase:shared}).ok);
  assert.equal(bridge.getState().home,'sunpu');assert.equal(bridge.getState().clan,'伊達家');
  assert.equal(bridge.getState().buildings.farm,5);assert.equal(bridge.getState().castles.sunpu.level,63);
  assert.equal(bridge.getSave().state.buildings.farm,3);const before=plain(bridge.getSave().state),events=b.events.length;
  const next=base(2);next.buildings.farm=6;next.initial.buildings.farm=6;next.castleLevel=64;next.initial.castleLevel=64;
  assert(bridge.applyStaffBase(next).changed);assert.equal(bridge.getState().buildings.farm,6);
  assert.equal(bridge.getState().castles.sunpu.level,64);assert.deepEqual(plain(bridge.getSave().state),before);
  assert.equal(b.events.length,events,'Shared projection never emits a personal save');
});
await test('role revocation removes the shared view and rejects late base replies, with operator priority',()=>{
  const b=browser(personal().exportSave()),bridge=b.c.SengokuBridge;
  bridge.setRoleAccess({isStaff:true});const epoch=bridge.getRoleAccess().epoch;
  assert.equal(bridge.getStaffBase(),null);assert(bridge.applyStaffBase(base(),{roleEpoch:epoch}).ok);
  bridge.setRoleAccess({isStaff:false});const own=plain(bridge.getState());
  assert.notEqual(own.home,'sunpu');assert.equal(own.clan,'伊達家');assert.equal(own.buildings.farm,3);assert.equal(bridge.getStaffBase(),null);
  assert.equal(bridge.applyStaffBase(base(2),{roleEpoch:epoch}).ok,false);assert.deepEqual(plain(bridge.getState()),own);
  bridge.setRoleAccess({isAdmin:true,isStaff:true});assert.equal(bridge.getState().home,'edo');assert.equal(bridge.getRoleAccess().isStaff,false);
  assert(bridge.getSave().state.officerVariants.includes('of_b0616adde162:U'));assert.equal(bridge.getStaffBase(),null);
});
await test('a staff first start waits for the shared source and offers house selection with fixed Sunpu',async()=>{
  const b=browser(),bridge=b.c.SengokuBridge;bridge.setRoleAccess({isStaff:true});bridge.openStartSelection();
  assert.match(b.nodes.get('modal-content').innerHTML,/スタッフ共同本拠 · 駿府城固定/);assert.equal(b.query('#new-start-castle'),null);
  await b.click('start-new');assert.equal(bridge.hasStarted(),false);assert(!b.stored.has(SAVE));
  bridge.applyStaffBase(base());await b.click('choose-clan','武田家');await b.click('start-new');
  assert.equal(bridge.hasStarted(),true);assert.equal(bridge.getState().home,'sunpu');assert.equal(bridge.getState().clan,'武田家');
  assert.equal(bridge.getState().buildings.farm,5);assert.equal(b.nodes.get('modal').open,false);
});
await test('shared construction names are escaped and separate timers distinguish personal work on the same facility',()=>{
  const g=personal();g.state.jobs.push({kind:'building',id:'farm',remaining:1,total:1,remainingSeconds:60,totalSeconds:60,targetLevel:4});
  const shared=base();shared.jobs=[{jobId:'job1',kind:'building',id:'farm',targetLevel:6,totalSeconds:60,startedElapsedMs:100000,completesElapsedMs:160000,startedBy:{id:'PRIVATE-ACTOR-ID',name:'<img src=x onerror=alert(1)>'}}];
  const b=browser(g.exportSave());assert(b.c.SengokuBridge.applyCloudSave(g.exportSave(),{isStaff:true,staffBase:shared}).ok);
  const html=b.nodes.get('main').innerHTML;
  assert.match(html,/staff-base-notice/);assert.match(html,/スタッフ共同拠点/);assert.match(html,/farm:shared/);assert.match(html,/farm:personal/);
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
await test('staff castle UI allows level 64 while facilities retain level 32',async()=>{
  const b=browser(personal().exportSave()),bridge=b.c.SengokuBridge;bridge.setRoleAccess({isStaff:true});bridge.applyStaffBase(base());
  await b.click('staff-base-detail');let html=b.nodes.get('modal-content').innerHTML;
  assert.match(html,/Lv\.63 \/ 64/);assert.match(html,/Lv\.64へ共同普請する/);assert(!html.includes('最高のLv.32'));
  const complete=base(2);complete.castleLevel=64;complete.initial.castleLevel=64;bridge.applyStaffBase(complete);
  html=b.nodes.get('modal-content').innerHTML;assert.match(html,/最高のLv\.64/);assert(!html.includes('data-action="upgrade-castle"'));
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
console.log(`${count} staff-base application UI scenarios passed. No network requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});

