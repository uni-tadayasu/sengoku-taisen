const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {SengokuEngine, SENGOKU_DATA} = require('../engine.js');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const rosterContext = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../officers-data.js'), 'utf8'), rosterContext);
const roster = rosterContext.window.SENGOKU_OFFICERS;
const SAVE = 'sengoku-tento-save-v2', BACKUP = 'sengoku-cloud-backups-v1';
const plain = value => JSON.parse(JSON.stringify(value));
let count = 0;
async function test(name, run) { await run(); count++; console.log('PASS '+name); }

// Run the complete application bootstrap and its real event handlers. Only the
// browser surface and timers are replaced; saves and engine transitions are real.
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
    localStorage:{getItem:key=>stored.has(key)?stored.get(key):null,setItem:(key,value)=>{if(failSave&&key===SAVE)throw Error('storage full');stored.set(key,value);}},
    navigator:{},location:{hash:'#town',protocol:'https:'},history:{replaceState(){}},performance:{now:()=>1000},
    setInterval:()=>1,setTimeout:()=>1,clearTimeout(){},scrollTo(){},scrollX:0,scrollY:0,
    addEventListener(){},dispatchEvent:event=>events.push(event.type),CustomEvent:class{constructor(type){this.type=type;}}
  };
  c.window=c;vm.createContext(c);vm.runInContext(source,c);
  async function event(type,target){for(const listener of handlers.get(type)||[])await listener({target});}
  async function click(action,id){const node={disabled:false,dataset:{action,id},closest(){return this;}};await event('click',node);}
  return {c,stored,events,nodes,query,click,event,failNextSave:()=>{failSave=true;}};
}

(async()=>{
await test('every ordinary castle can be the sole first home, independently of the house',()=>{
  const available=SENGOKU_DATA.castles.filter(c=>!c.majorCity);assert.equal(available.length,124);
  for(const castle of available){const g=new SengokuEngine({clan:'織田家',startCastle:castle.id,officers:roster,seed:7});assert.equal(g.state.home,castle.id);assert.deepEqual(g.ownedCastles().map(c=>c.id),[castle.id]);assert.deepEqual(g.state.captureRewards,[castle.id]);assert.equal(g.state.castles[castle.id].troops,1200);}
  for(const clan of SENGOKU_DATA.clans){const g=new SengokuEngine({clan:clan.name,startCastle:'himeji',officers:roster});assert.equal(g.state.clan,clan.name);assert.equal(g.state.home,'himeji');assert(g.state.officers.every(id=>g.officer(id).clan===clan.name));}
});
await test('ordinary players cannot start at the five major cities or unknown/inherited castle keys',()=>{
  for(const id of ['edo','kyoto_gosho','nijo','osaka','nagoya','missing','',null,123,{},'toString','__proto__','constructor'])assert.throws(()=>new SengokuEngine({startCastle:id,officers:roster}));
});
await test('verified operators always begin with Edo and the exclusive Ieyasu U',()=>{
  for(const request of ['himeji','kiyosu','edo','toString']){const g=new SengokuEngine({clan:'武田家',startCastle:request,officers:roster,isAdmin:true});assert.equal(g.state.home,'edo');assert.deepEqual(g.ownedCastles().map(c=>c.id),['edo']);assert(g.ownsVariant('of_b0616adde162','U'));assert.equal(g.officer('of_b0616adde162','U').name,'德川家康');}
});
await test('selected homes round-trip and existing legacy campaigns keep their holdings and resources',()=>{
  const selected=new SengokuEngine({clan:'上杉家',startCastle:'himeji',officers:roster,seed:19});
  const restored=SengokuEngine.fromSave(selected.exportSave(),roster);assert.deepEqual(plain(restored.state),plain(selected.state));
  const legacy=new SengokuEngine({clan:'織田家',officers:roster,seed:37});legacy.state.resources.gold+=912;legacy.state.castles.himeji.owner=legacy.state.clan;legacy.state.captureRewards.push('himeji');
  const result=SengokuEngine.fromSave(legacy.exportSave(),roster);assert.deepEqual(plain(result.state),plain(legacy.state));assert.equal(result.state.home,'kiyosu');assert.equal(result.ownedCastles().length,2);
});
await test('the five major-city flags restrict only new starts and preserve existing metropolitan campaigns',()=>{
  assert.deepEqual(SENGOKU_DATA.majorCityIds,['edo','kyoto_gosho','nijo','osaka','nagoya']);
  assert.deepEqual(SENGOKU_DATA.castles.filter(c=>c.majorCity).map(c=>c.id).sort(),[...SENGOKU_DATA.majorCityIds].sort());
  for(const id of ['nijo','osaka','nagoya']){
    const legacy=new SengokuEngine({clan:'徳川家',officers:roster,seed:43});legacy.state.home=id;legacy.state.castles[id].owner=legacy.state.clan;legacy.state.castles[id].level=13;legacy.state.resources.gold=662211;
    const loaded=SengokuEngine.fromSave(legacy.exportSave(),roster);assert.deepEqual(plain(loaded.state),plain(legacy.state));assert(loaded.canOwnCastle(id));
  }
});
await test('first bootstrap remains unsaved and opens an explicit 124-castle choice with recovery access',async()=>{
  const b=browser();assert.equal(b.c.SengokuBridge.hasStarted(),false);assert.equal(b.c.SengokuBridge.getSave(),null);assert(!b.stored.has(SAVE));assert.equal(b.events.length,0);
  assert.match(b.nodes.get('main').innerHTML,/はじまりの城を選ぶ/);b.c.SengokuBridge.openStartSelection();await b.click('choose-residency-mode','local');
  const html=b.nodes.get('modal-content').innerHTML;assert.match(html,/以前の領主を復元/);assert.match(html,/data-action="open-recovery"/);assert.equal(b.query('#new-start-castle').value,'');for(const id of SENGOKU_DATA.majorCityIds)assert(!html.includes(`<option value="${id}"`));assert.match(html,/本拠にする城を一つ選択 · 124城/);
  await b.click('start-new');assert.equal(b.c.SengokuBridge.hasStarted(),false);assert(!b.stored.has(SAVE));
});
await test('registration opens without a castle or clock and cancel returns to the uncommitted choices',async()=>{
  const b=browser();b.c.SengokuBridge.openStartSelection();
  b.c.SengokuWorldClock={snapshot:()=>({ready:false,message:'確認中'})};
  b.query('#new-difficulty').value='hard';
  assert.equal(b.query('#new-start-castle').value,'');
  assert.match(b.nodes.get('modal-content').innerHTML,/data-action="open-lord-registration"/);
  let returnToChoices,opened=false;
  b.nodes.set('community-modal',{addEventListener:(event,fn)=>{assert.equal(event,'close');returnToChoices=fn;}});
  b.c.SengokuSocial={open(tab){assert.equal(tab,'profile');opened=true;}};
  await b.click('open-lord-registration');
  assert(opened);assert.equal(b.query('#modal').open,false);assert(!b.stored.has(SAVE));
  returnToChoices();
  assert.equal(b.query('#modal').open,true);assert.equal(b.query('#new-difficulty').value,'hard');
  assert.equal(b.c.SengokuBridge.hasStarted(),false);assert(!b.stored.has(SAVE));
});
await test('a personal campaign at an occupied online castle displays personal starting facts',async()=>{
  const b=browser(),castle=SENGOKU_DATA.castles.find(row=>row.id==='himeji');
  const occupied={castleId:castle.id,castleName:castle.name,region:castle.region,available:false,lord:{name:'共有の領主'},retainerCount:3};
  b.c.SengokuResidency={loadDirectory:async()=>({capacity:124,occupied:124,full:true,castles:[occupied]}),choiceMode:()=>'retainer',choices:()=>[occupied]};
  b.c.SengokuBridge.openStartSelection();await b.click('choose-residency-mode','local');
  b.query('#new-start-castle').value='himeji';await b.click('choose-clan','武田家');
  const preview=b.nodes.get('modal-content').innerHTML;assert.match(preview,/守備兵 1,200人/);
  assert.doesNotMatch(preview,/共有の領主|入城時の継承順/);assert(!b.stored.has(SAVE));
});
await test('confirmed first start persists the selected castle before exposing a save to sync',async()=>{
  const b=browser();b.c.SengokuBridge.openStartSelection();await b.click('choose-residency-mode','local');b.query('#new-start-castle').value='himeji';await b.click('choose-clan','武田家');
  assert.equal(b.query('#new-start-castle').value,'himeji');b.query('#new-difficulty').value='hard';assert(!b.stored.has(SAVE));
  await b.click('start-new');assert.equal(b.c.SengokuBridge.hasStarted(),true);
  const save=b.c.SengokuBridge.getSave();assert.equal(save.state.home,'himeji');assert.equal(save.state.clan,'武田家');assert.equal(save.state.difficulty,'hard');assert.equal(Object.values(save.state.castles).filter(c=>c.owner===save.state.clan).length,1);assert.deepEqual(plain(save.state),JSON.parse(b.stored.get(SAVE)).state);assert.deepEqual(b.events,['sengoku:game-saved']);assert(!b.stored.has(BACKUP));
});
await test('opening or cancelling a new story preserves the existing save, and a failed commit rolls back',async()=>{
  const old=new SengokuEngine({clan:'伊達家',officers:roster,seed:12});old.state.resources.gold=12345;const b=browser(old.exportSave()),saved=b.stored.get(SAVE),state=plain(b.c.SengokuBridge.getState());
  assert.equal(b.c.SengokuBridge.hasStarted(),true);b.c.SengokuBridge.openStartSelection();assert.equal(b.nodes.get('modal').open,false);
  await b.click('new-game');await b.click('choose-residency-mode','local');b.query('#new-start-castle').value='himeji';await b.click('close');assert.equal(b.stored.get(SAVE),saved);assert.deepEqual(plain(b.c.SengokuBridge.getState()),state);
  await b.click('new-game');await b.click('choose-residency-mode','local');b.query('#new-start-castle').value='himeji';b.failNextSave();await b.click('start-new');assert.equal(b.stored.get(SAVE),saved);assert.deepEqual(plain(b.c.SengokuBridge.getState()),state);assert.equal(b.nodes.get('modal').open,true);
});
await test('a failed first durable write leaves the player in the unconfirmed selection',async()=>{
  const b=browser();b.c.SengokuBridge.openStartSelection();await b.click('choose-residency-mode','local');b.query('#new-start-castle').value='himeji';b.failNextSave();await b.click('start-new');assert.equal(b.c.SengokuBridge.hasStarted(),false);assert.equal(b.c.SengokuBridge.getSave(),null);assert(!b.stored.has(SAVE));assert.equal(b.events.length,0);
});
await test('an unreadable local save never uploads its starter fallback and a verified cloud save can recover it',async()=>{
  for(const hasRemote of [false,true]){
    const original='{unreadable-old-save',b=browser(original),bridge=b.c.SengokuBridge;
    assert.throws(()=>bridge.getSave(),/仮の進行は同期しません/);assert.equal(b.stored.get(SAVE),original);
    const g=new SengokuEngine({clan:'伊達家',officers:roster,seed:32});g.assignArmy([g.state.officers[2],g.state.officers[0]]);g.assignGovernor('farm',g.state.officers[3]);
    const remote=hasRemote?JSON.parse(g.exportSave()):null,requests=[];let writer=null;
    const snapshot=()=>({ok:true,user:{id:'recovery-fixture',isAdmin:false,isStaff:false},save:plain(remote),revision:remote?4:0,serverTime:new Date().toISOString(),writerDeviceId:writer,leaseExpiresAt:writer?new Date(Date.now()+30000).toISOString():null,writable:Boolean(writer)});
    const request=async(route,options={})=>{requests.push({route,method:options.method||'GET'});if(route==='/presence'||route==='/sync/release')return{ok:true};if(route==='/sync/lease'){writer=options.data.deviceId;return snapshot();}if(route.startsWith('/sync?'))return snapshot();throw Error('Unexpected save write '+route);};
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../cloud-sync.js'),'utf8'),b.c);
    const sync=b.c.SengokuCloudSync.create({bridge:()=>bridge,storage:b.c.localStorage,device:{id:'recovery-fixture-tab',name:'test'},setTimeout:()=>1,clearTimeout(){}});
    await sync.start({id:'recovery-fixture',request});assert.equal(requests.filter(r=>r.method==='PUT').length,0,'A starter fallback can never replace a cloud campaign');
    if(hasRemote){assert.equal(sync.getStatus().writable,true);assert.deepEqual(plain(bridge.getState().army),plain(g.state.army));assert.deepEqual(plain(bridge.getState().governors),plain(g.state.governors));assert.equal(JSON.parse(b.stored.get(BACKUP))[0].save,original);}
    else{assert.equal(sync.getStatus().writable,false);assert.equal(b.stored.get(SAVE),original);}
    sync.stop();
  }
});
await test('a cloud campaign replaces only the provisional draft and ends first-start selection',()=>{
  const b=browser();b.c.SengokuBridge.openStartSelection();const remote=new SengokuEngine({clan:'毛利家',startCastle:'himeji',officers:roster,seed:22});remote.state.resources.gold=21119;
  assert.equal(b.c.SengokuBridge.applyCloudSave(remote.exportSave(),{reason:'initial',backup:true}).ok,true);assert.equal(b.c.SengokuBridge.hasStarted(),true);assert.equal(b.c.SengokuBridge.getSave().state.resources.gold,21119);assert.equal(b.c.SengokuBridge.getState().home,'himeji');assert.equal(b.nodes.get('modal').open,false);assert(!b.stored.has(BACKUP));assert.equal(b.events.length,0);
});
await test('operator recovery preview is non-mutating, then confirmed recovery restores Edo without an extra choice',()=>{
  const b=browser(),before=plain(b.c.SengokuBridge.getState());
  assert.equal(b.c.SengokuBridge.prepareNewRecoverySave({isAdmin:false}).ok,false);const preview=b.c.SengokuBridge.prepareNewRecoverySave({isAdmin:true,clan:'徳川家'});assert.equal(preview.ok,true);assert.equal(preview.save.state.home,'edo');assert(preview.save.state.officerVariants.includes('of_b0616adde162:U'));assert.deepEqual(plain(b.c.SengokuBridge.getState()),before);assert(!b.stored.has(SAVE));assert.equal(b.c.SengokuBridge.hasStarted(),false);
  assert.equal(b.c.SengokuBridge.applyRecoverySave(preview.save,{isAdmin:true}).ok,true);assert.equal(b.c.SengokuBridge.hasStarted(),true);assert.equal(b.c.SengokuBridge.getState().home,'edo');
});
await test('operator identity changes an open first-start chooser to the fixed Edo choice',async()=>{
  const b=browser();b.c.SengokuBridge.openStartSelection();b.c.SengokuBridge.setAdminAccess(true);const html=b.nodes.get('modal-content').innerHTML;assert.match(html,/本拠 · 江戸城固定/);assert.equal(b.query('#new-start-castle'),null);await b.click('start-new');assert.equal(b.c.SengokuBridge.getState().home,'edo');assert.equal(Object.values(b.c.SengokuBridge.getState().castles).filter(c=>c.owner===b.c.SengokuBridge.getState().clan).length,1);
});
console.log(`${count} castle selection and durable-start checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
