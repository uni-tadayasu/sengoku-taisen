/* Exercise the actual app facade against deferred network operations. No live API calls. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {SengokuEngine} = require('../engine.js');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const rosterScope = {window:{}};
vm.createContext(rosterScope);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../officers-data.js'), 'utf8'), rosterScope);
const roster = rosterScope.window.SENGOKU_OFFICERS;
const pendingKey = 'sengoku-field-pending-v1';
const clone = value => JSON.parse(JSON.stringify(value));
function fn(name) {
  const start = source.search(new RegExp('^  (?:async )?function '+name+'\\(', 'm'));
  assert(start >= 0, name);
  const firstEnd = source.indexOf('\n', start);
  if(source.slice(start, firstEnd).endsWith('}')) return source.slice(start, firstEnd);
  const end = source.indexOf('\n  }', start);
  assert(end > start, name);
  return source.slice(start, end + 4);
}
function deferred() {
  let resolve,reject;
  const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
async function until(predicate) {
  for(let i=0;i<50;i++){if(predicate())return;await Promise.resolve();}
  assert(predicate(), 'Async checkpoint was not reached');
}
function base(game,revision=1){const buildings=clone(game.state.buildings);return{id:'kyoto_gosho',revision,castleLevel:1,buildings,initial:{castleLevel:1,buildings:clone(buildings)},history:[],jobs:[],accessSinceElapsedMs:0,updatedElapsedMs:100000,protected:true};}
function pending(h){return [...h.stored].filter(([key])=>key.startsWith('sengoku-staff-upgrade-pending-v1:'));}
function revoke(h){h.c.roleEpoch++;h.c.game.setRoleAccess({isAdmin:false,isStaff:false});h.control.user.isStaff=false;h.c.staffBaseReady=false;}
function setup(options={}) {
  const stored=options.stored||new Map(),trace=[],posts=[],gets=[],events=[],clockAccepts=[];
  let game=new SengokuEngine({officers:roster,seed:17,isStaff:options.isStaff!==false});
  const clock={id:'field-clock',elapsedMs:100000,confirmedElapsedMs:100000,running:true,speed:1,revision:1,calendar:{turn:1,year:1560,month:2,cycle:1,elapsed:40}};
  if(stored.has('save'))game=SengokuEngine.fromSave(stored.get('save'),roster,{isStaff:options.isStaff!==false});
  else {game.applyWorldClock(clock);stored.set('save',game.exportSave());}
  const shared=options.base||base(game);if(game.isStaff)game.applyStaffBase(shared);
  const control={user:{id:'player-a',name:'領主A',isAdmin:false,isStaff:game.isStaff,guildId:'guild-a'},deviceId:'tab-a',status:{linked:true,ready:true,writable:true,revision:7,leaseExpiresAt:new Date(Date.now()+30000).toISOString()},clock,clockReady:true,uuidCalls:0,flushes:0,refreshes:0,queued:0};
  let context;
  const social={
    getUser:()=>control.user?{...control.user}:null,
    fieldRequest:async(route,opts)=>{
      const call={route,options:clone(opts)};
      if(opts.method==='GET'){gets.push(call);trace.push('get');return control.onGet?control.onGet(call):{ok:true,players:[]};}
      posts.push(call);trace.push('send');return control.onPost?control.onPost(call):{ok:true,report:{id:'report-1'}};
    }
  };
  const sync={
    getStatus:()=>({...control.status}),getDevice:()=>({id:control.deviceId}),
    flush:async()=>{control.flushes++;trace.push('flush');return control.onFlush?control.onFlush():{ok:true};},
    refresh:async()=>{control.refreshes++;trace.push('sync-refresh');return control.onRefresh?control.onRefresh():{ok:true};},
  };
  social.guildRequest=async(route,opts)=>{const call={route,options:clone(opts)};posts.push(call);trace.push('send-guild');return control.onPost?control.onPost(call):{ok:true,receipt:{id:'guild-transfer-1'}};};
  social.staffRequest=async(route,opts)=>{const call={route,options:clone(opts)};posts.push(call);trace.push('send-staff');return control.onPost?control.onPost(call):{ok:true,revision:7,staffBase:shared};};
  context={
    game,roster,SengokuEngine,URLSearchParams,Date,JSON,Math,Promise,
    state:()=>context.game.state,
    syncAccess:{...control.status},saveKey:'save',backupKey:'backups',saveEnabled:true,saveWarning:'',
    worldCatchingUp:false,worldSettlementPending:false,worldSettlementRetryAt:0,worldCatchupTimer:null,worldClockStatusKey:'',fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,startPending:false,staffBaseReady:true,roleEpoch:1,
    selectedCastle:'',lastRealtime:0,saveCounter:0,importedGame:null,activeModal:'',
    localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>{if(control.storageError)throw Error('storage unavailable');stored.set(key,value);},removeItem:key=>stored.delete(key)},
    crypto:{randomUUID:()=>{control.uuidCalls++;return 'test-request-'+control.uuidCalls;}},
    window:{SengokuSocial:social,SengokuCloudSync:sync,
      SengokuWorldClock:{snapshot:()=>({ready:control.clockReady,clock:control.clock,message:'clock'}),refresh:async()=>{trace.push('clock-refresh');return control.onClockRefresh?control.onClockRefresh():{ok:true};},accept:value=>{clockAccepts.push(value);trace.push('accept-clock');control.clock=value;}},
      dispatchEvent:event=>{events.push(event.type);trace.push('save');}
    },
    CustomEvent:class{constructor(type){this.type=type;}},
    performance:{now:()=>1000},document:{hidden:false},$:()=>null,
    setTimeout:()=>1,clearTimeout:()=>{},toast:()=>{},render:()=>{},renderHeader:()=>{},
    refreshLiveControls:()=>{},refreshJobTimers:()=>{},refreshActiveModal:()=>{},
    queueWorldProgress:()=>control.queued++,preserveInteraction:()=>{},closeModal:()=>{},updateBattlePreview:()=>{},syncMusic:()=>{},
  };
  vm.createContext(context);
  vm.runInContext(['staffConstructionReady','confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','save','backupCurrentSave','trustedBranchAuthority','applyBranchAuthority','applyCloudSave','applyDurableGift','restoreAdminAssets','processWorldClock','requestField'].map(fn).join('\n'),context);
  return {c:context,control,stored,trace,posts,gets,events,clockAccepts};
}

let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
await test('shared upgrades freeze personal actions, flush once, and wait for both authoritative revisions',async()=>{
  const h=setup(),gate=deferred(),shared=base(h.c.game,3);h.control.onFlush=()=>gate.promise;
  h.control.onPost=async()=>({ok:true,revision:12,staffBase:shared});
  h.control.onRefresh=async()=>{h.control.status.revision=12;if(h.control.refreshes===2)h.c.game.applyStaffBase(shared);return{ok:true};};
  const task=h.c.requestField('/staff/base/upgrade',{method:'POST',data:{kind:'building',id:'farm',deviceId:'spoof',expectedRevision:999,baseRevision:999}});
  await until(()=>h.control.flushes===1);assert.equal(h.posts.length,0);assert.equal(h.c.canMutate(),false);
  assert.equal(h.c.applyDurableGift({gold:10},'during-shared').ok,false);
  h.control.status.revision=11;gate.resolve({ok:true});await task;
  const body=h.posts[0].options.data;assert.equal(body.expectedRevision,11);assert.equal(body.deviceId,'tab-a');assert.equal(body.baseRevision,1);
  assert.equal(h.control.refreshes,2,'A fresh personal revision cannot conceal an older shared base');
  assert.equal(h.c.game.getStaffBase().revision,3);assert.equal(pending(h).length,0);assert.equal(h.c.fieldActionPending,false);
});
await test('uncertain response replay keeps the first base revision and request ID across reloads',async()=>{
  const h=setup(),shared=base(h.c.game,4),receipts=new Map();let executions=0;
  h.control.onPost=async call=>{executions++;receipts.set(call.options.data.requestId,{ok:true,revision:15,staffBase:shared});throw Error('lost response');};
  h.control.onRefresh=async()=>{h.control.status.revision=15;h.c.game.applyStaffBase(shared);return{ok:true};};
  await assert.rejects(h.c.requestField('/staff/base/upgrade',{method:'POST',data:{kind:'castle',id:'kyoto_gosho'}}),/lost response/);
  const original=h.posts[0].options.data;assert.equal(pending(h).length,1);
  const resumed=setup({stored:h.stored,base:shared});resumed.control.status.revision=15;resumed.control.deviceId='tab-reopened';
  resumed.control.onPost=async call=>{assert.equal(call.options.data.baseRevision,original.baseRevision);assert.equal(call.options.data.requestId,original.requestId);assert.equal(call.options.data.expectedRevision,15);assert.equal(call.options.data.deviceId,'tab-reopened');return receipts.get(call.options.data.requestId);};
  await resumed.c.requestField('/staff/base/upgrade',{method:'POST',data:{kind:'castle',id:'kyoto_gosho'}});
  assert.equal(executions,1);assert.equal(pending(resumed).length,0);assert.equal(resumed.c.fieldActionPending,false);
});
await test('role revocation at every awaited stage prevents old staff results from being applied',async()=>{
  for(const stage of ['clock','flush','response','refresh']){
    const h=setup(),shared=base(h.c.game,2);
    if(stage==='clock')h.control.onClockRefresh=async()=>{revoke(h);return{ok:true};};
    if(stage==='flush')h.control.onFlush=async()=>{revoke(h);return{ok:true};};
    h.control.onPost=async()=>{if(stage==='response')revoke(h);return{ok:true,revision:8,staffBase:shared,clock:h.control.clock};};
    if(stage==='refresh')h.control.onRefresh=async()=>{revoke(h);return{ok:true};};
    await assert.rejects(h.c.requestField('/staff/base/upgrade',{method:'POST',data:{kind:'building',id:'farm'}}),error=>error.code==='STALE_STAFF');
    assert.equal(h.c.game.isStaff,false);assert.equal(h.c.game.getStaffBase(),null);assert.equal(h.c.fieldActionPending,false);
    assert.equal(h.posts.length,['clock','flush'].includes(stage)?0:1);
    if(stage==='response')assert.equal(h.clockAccepts.length,0);
  }
});
await test('reappointment during a request cannot validate a response from the former staff membership',async()=>{
  const h=setup();h.control.onPost=async()=>{revoke(h);h.c.roleEpoch++;h.c.game.setRoleAccess({isStaff:true});h.c.game.applyStaffBase(base(h.c.game));h.c.staffBaseReady=true;h.control.user.isStaff=true;return{ok:true,revision:8,staffBase:base(h.c.game,2)};};
  await assert.rejects(h.c.requestField('/staff/base/upgrade',{method:'POST',data:{kind:'building',id:'farm'}}),error=>error.code==='STALE_STAFF');
  assert.equal(h.c.game.getStaffBase().revision,1);assert.equal(h.c.fieldActionPending,false);
});
await test('missing source, follower lease, and ordinary roles block shared construction before sending',async()=>{
  for(const mode of ['missing','follower','ordinary','admin']){
    const h=setup();if(mode==='missing')h.c.staffBaseReady=false;if(mode==='follower'){h.c.syncAccess.writable=false;h.control.status.writable=false;}
    if(mode==='ordinary')revoke(h);if(mode==='admin'){h.c.game.setRoleAccess({isAdmin:true,isStaff:true});h.control.user.isAdmin=true;}
    await assert.rejects(h.c.requestField('/staff/base/upgrade',{method:'POST',data:{kind:'building',id:'farm'}}));assert.equal(h.posts.length,0);assert.equal(h.control.flushes,0);
  }
});
await test('unconfirmed shared revision retains its receipt key and never reports successful construction',async()=>{
  const h=setup(),shared=base(h.c.game,2);h.control.onPost=async()=>({ok:true,revision:8,staffBase:shared});
  h.control.onRefresh=async()=>{h.control.status.revision=8;return{ok:true};};
  await assert.rejects(h.c.requestField('/staff/base/upgrade',{method:'POST',data:{kind:'building',id:'farm'}}),error=>error.code==='STAFF_RECONCILE_PENDING');
  assert.equal(pending(h).length,1);const id=h.posts[0].options.data.requestId;
  h.control.onRefresh=async()=>{h.c.game.applyStaffBase(shared);return{ok:true};};
  await h.c.requestField('/staff/base/upgrade',{method:'POST',data:{kind:'building',id:'farm'}});
  assert.equal(h.posts[1].options.data.requestId,id);assert.equal(pending(h).length,0);
});
await test('definitive shared conflicts discard the failed key and refresh before the next intentional attempt',async()=>{
  const h=setup();h.control.onPost=async()=>{throw Object.assign(Error('base changed'),{status:409,code:'BASE_REVISION_CONFLICT'});};
  await assert.rejects(h.c.requestField('/staff/base/upgrade',{method:'POST',data:{kind:'building',id:'farm'}}),/base changed/);
  assert.equal(pending(h).length,0);assert.equal(h.control.refreshes,1);assert.equal(h.c.fieldActionPending,false);
});
console.log(`${count} shared staff-base transaction scenarios passed. No network requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
