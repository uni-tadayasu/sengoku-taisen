/* Real command transaction bridge, local engine, synthetic server only. */
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
const pendingKey = 'sengoku-event-command-pending-v1';
const eventRecords = h => [...h.stored.entries()].filter(([key])=>key.startsWith(pendingKey+':'));
const eventPending = h => JSON.parse(eventRecords(h)[0]?.[1]||'null');
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
function setup(options={}) {
  const stored=options.stored||new Map(),trace=[],posts=[],gets=[],events=[],clockAccepts=[];
  let game=new SengokuEngine({officers:roster,seed:17});
  const clock={id:'field-clock',elapsedMs:100000,confirmedElapsedMs:100000,running:true,speed:1,revision:1,calendar:{turn:1,year:1560,month:2,cycle:1,elapsed:40}};
  if(stored.has('save'))game=SengokuEngine.fromSave(stored.get('save'),roster);
  else {game.applyWorldClock(clock);stored.set('save',game.exportSave());}
  const control={user:{id:'player-a',name:'領主A',isAdmin:false,guildId:'guild-a'},deviceId:'tab-a',status:{linked:true,ready:true,writable:true,revision:7,leaseExpiresAt:new Date(Date.now()+30000).toISOString()},clock,clockReady:true,uuidCalls:0,flushes:0,refreshes:0,queued:0};
  let context;
  const social={
    getUser:()=>control.user?{...control.user}:null,
    eventRequest:async(route,opts)=>{
      const call={route,options:clone(opts)};
      if(opts.method==='GET'){gets.push(call);trace.push('get');return control.onGet?control.onGet(call):{ok:true,players:[]};}
      posts.push(call);trace.push('send');return control.onPost?control.onPost(call):{ok:true,revision:control.status.revision,report:{id:'report-1'}};
    }
  };
  const sync={
    getStatus:()=>({...control.status}),getDevice:()=>({id:control.deviceId}),
    flush:async()=>{control.flushes++;trace.push('flush');return control.onFlush?control.onFlush():{ok:true};},
    refresh:async()=>{control.refreshes++;trace.push('sync-refresh');return control.onRefresh?control.onRefresh():{ok:true};},
  };
  social.guildRequest=async(route,opts)=>{const call={route,options:clone(opts)};posts.push(call);trace.push('send-guild');return control.onPost?control.onPost(call):{ok:true,receipt:{id:'guild-transfer-1'}};};
  context={
    game,roster,SengokuEngine,staffBaseId:'kyoto_gosho',URLSearchParams,Date,JSON,Math,Promise,
    state:()=>context.game.state,
    syncAccess:{...control.status},saveKey:'save',backupKey:'backups',saveEnabled:true,saveWarning:'',
    worldCatchingUp:false,worldSettlementPending:false,worldSettlementRetryAt:0,worldCatchupTimer:null,worldClockStatusKey:'',fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,startPending:false,
    selectedCastle:'',lastRealtime:0,saveCounter:0,importedGame:null,activeModal:'',
    localStorage:{get length(){return stored.size;},key:index=>[...stored.keys()][index]??null,getItem:key=>stored.get(key)||null,setItem:(key,value)=>{if(control.storageError)throw Error('storage unavailable');stored.set(key,value);},removeItem:key=>stored.delete(key)},
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
  vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','save','backupCurrentSave','trustedBranchAuthority','applyBranchAuthority','trustedMaintenanceAuthority','applyMaintenanceAuthority','trustedCourtProtection','trustedSentoAccess','applyCourtProtection','trustedCourtEstateProjection','courtEstateHolding','applyCloudSave','applyDurableGift','restoreAdminAssets','processWorldClock','requestField','requestEventBattle','getEventAccess'].map(fn).join('\n'),context);
  return {c:context,control,stored,trace,posts,gets,events,clockAccepts};
}
const EVENT='ev_'+'a'.repeat(32),route='/events/'+EVENT+'/battle';
const payload={requestId:'event-first',stageId:'stage-1',tactic:'balanced'};
const tests=[];
function test(name,run){tests.push({name,run});}

test('event access follows the existing command balance, keep level and writer readiness',()=>{
  const h=setup();h.c.game.state.command=2;h.c.game.state.buildings.keep=16;
  let access=h.c.getEventAccess();assert.equal(access.current,2);assert.equal(access.max,5);assert.equal(access.cost,1);assert.equal(access.writable,true);
  h.c.game.state.command=0;access=h.c.getEventAccess();assert.equal(access.current,0);assert.match(access.message,/指令不足/);
  h.c.game.state.command=1;h.control.clock={...h.control.clock,running:false};assert.equal(h.c.getEventAccess().writable,true,'Paused time does not remove saved commands');
  h.c.fieldActionPending=true;assert.equal(h.c.getEventAccess().writable,false);h.c.fieldActionPending=false;
  h.c.syncAccess.writable=false;assert.equal(h.c.getEventAccess().writable,false);
  h.c.startPending=true;assert.equal(h.c.getEventAccess().ready,false);
});

test('only the event battle route enters the transaction bridge',async()=>{
  const h=setup();
  for(const [path,method] of [['/events/'+EVENT,'POST'],[route,'GET'],[route+'?skip=1','POST'],['/events/ev_bad/battle','POST'],['/admin/events/generate','POST'],['/field/attack','POST']])await assert.rejects(h.c.requestEventBattle(path,{method,data:payload}));
  assert.equal(h.posts.length,0);assert.equal(h.control.flushes,0);
});

test('one event battle freezes shared commands until the authoritative save revision is applied',async()=>{
  const h=setup(),flush=deferred(),response=deferred(),refresh=deferred();h.c.game.state.command=2;
  const original=clone(h.c.game.state);h.control.onFlush=()=>flush.promise;h.control.onPost=()=>response.promise;h.control.onRefresh=()=>refresh.promise;
  const task=h.c.requestEventBattle(route,{data:{...payload,deviceId:'spoof',expectedRevision:999}});
  await until(()=>h.control.flushes===1);assert.deepEqual(h.trace.slice(0,3),['clock-refresh','save','flush']);assert.equal(h.c.canMutate(),false);assert.equal(h.posts.length,0);
  assert.equal(h.c.applyDurableGift({gold:50},'during-event').ok,false);assert.equal(h.c.getEventAccess().writable,false);
  h.control.clock={...h.control.clock,elapsedMs:120000,confirmedElapsedMs:120000};h.c.processWorldClock();assert.equal(h.c.game.state.command,2,'No local clock recovery while the server uses this balance');
  h.control.status.revision=19;flush.resolve({ok:true});await until(()=>h.posts.length===1);
  const body=h.posts[0].options.data;assert.equal(body.requestId,payload.requestId);assert.equal(body.deviceId,'tab-a');assert.equal(body.expectedRevision,19);assert.equal(eventPending(h).requestId,payload.requestId);
  await assert.rejects(h.c.requestEventBattle(route,{data:{...payload,requestId:'second'}}));assert.equal(h.posts.length,1);
  response.resolve({ok:true,revision:20,battle:{won:true,points:60},clock:h.control.clock});await until(()=>h.control.refreshes===1);
  assert.equal(h.c.canMutate(),false);assert.equal(h.c.game.state.command,2,'The UI never debits optimistically');assert.equal(eventPending(h).committed,true);
  h.c.game.state.command=1;h.c.game.state.worldClock.elapsedMs=120000;h.control.status.revision=20;refresh.resolve({ok:true});
  const result=await task;assert.equal(result.battle.points,60);assert.equal(h.c.game.state.command,1);assert.equal(h.c.getEventAccess().current,1);assert.equal(eventRecords(h).length,0);assert.equal(h.c.canMutate(),true);
  for(const key of ['resources','troops','army','governors','buildings'])assert.deepEqual(clone(h.c.game.state[key]),original[key]);
});

test('response loss replays the original operation without requiring another available command',async()=>{
  const h=setup();h.c.game.state.command=1;let executions=0;const receipts=new Map();
  h.control.onPost=async call=>{executions++;receipts.set(call.options.data.requestId,{ok:true,revision:8,battle:{won:true,points:60},idempotent:true});throw Error('response lost');};
  h.control.onRefresh=async()=>{h.c.game.state.command=0;h.control.status.revision=8;h.stored.set('save',h.c.game.exportSave());return{ok:true};};
  await assert.rejects(h.c.requestEventBattle(route,{data:payload}),/response lost/);assert.equal(h.c.game.state.command,0);assert(eventPending(h));
  const reopened=setup({stored:h.stored});reopened.control.status.revision=8;
  reopened.control.onPost=async call=>{assert.equal(call.options.data.expectedRevision,8);const result=receipts.get(call.options.data.requestId);assert(result);return result;};
  const result=await reopened.c.requestEventBattle(route,{data:{...payload,requestId:'fresh-ui-id'}});
  assert.equal(result.idempotent,true);assert.equal(reopened.posts[0].options.data.requestId,payload.requestId);assert.equal(executions,1);assert.equal(reopened.c.game.state.command,0);assert.equal(eventRecords(reopened).length,0);
});

test('a stale sync poll cannot confirm an event debit and uncertain revisions remain recoverable',async()=>{
  const h=setup();h.control.onPost=async()=>({ok:true,revision:8,battle:{won:false,points:15}});
  let refreshCount=0;h.control.onRefresh=async()=>{refreshCount++;if(refreshCount===2){h.control.status.revision=8;h.c.game.state.command=2;}return{ok:true};};
  await h.c.requestEventBattle(route,{data:payload});assert.equal(refreshCount,2);assert.equal(h.c.game.state.command,2);assert.equal(eventRecords(h).length,0);
  const missing=setup();missing.control.onPost=async()=>({ok:true,battle:{won:true}});
  await assert.rejects(missing.c.requestEventBattle(route,{data:payload}),e=>e.code==='EVENT_RECONCILE_PENDING');assert.equal(eventPending(missing).committed,true);assert.equal(missing.c.fieldActionPending,false);
});

test('unregistered, follower, unstarted, expired, unsaved and unsynchronized states never spend commands',async()=>{
  for(const mode of ['unregistered','unlinked','follower','unstarted','expired','clock','save','flush']){
    const h=setup();if(mode==='unregistered')h.control.user=null;if(mode==='unlinked'){h.control.status.linked=false;h.c.syncAccess.linked=false;}
    if(mode==='follower'){h.control.status.writable=false;h.c.syncAccess.writable=false;}if(mode==='unstarted')h.c.startPending=true;
    if(mode==='expired')h.c.syncAccess.leaseExpiresAt=new Date(Date.now()-1).toISOString();if(mode==='clock')h.control.clockReady=false;if(mode==='save')h.c.saveEnabled=false;if(mode==='flush')h.control.onFlush=async()=>({ok:false});
    const before=h.c.game.state.command;await assert.rejects(h.c.requestEventBattle(route,{data:payload}));assert.equal(h.posts.length,0,mode);assert.equal(h.c.game.state.command,before,mode);assert.equal(h.c.fieldActionPending,false);
  }
});

test('a rejected battle does not consume a local command and clears only an uncommitted retry',async()=>{
  for(const code of ['COMMAND_REQUIRED','EVENT_ENDED']){
    const h=setup(),before=h.c.game.state.command;h.control.onPost=async()=>{throw Object.assign(Error(code),{status:409,code});};
    await assert.rejects(h.c.requestEventBattle(route,{data:payload}),e=>e.code===code);assert.equal(h.c.game.state.command,before);assert.equal(eventRecords(h).length,0);assert.equal(h.c.canMutate(),true);
  }
});

test('identity changes before sending and before reconciliation cannot apply another lord result',async()=>{
  for(const checkpoint of ['flush','response','refresh']){
    const h=setup(),pause=deferred();
    if(checkpoint==='flush')h.control.onFlush=()=>pause.promise;
    if(checkpoint==='response')h.control.onPost=()=>pause.promise;
    if(checkpoint==='refresh')h.control.onRefresh=()=>pause.promise;
    const task=h.c.requestEventBattle(route,{data:payload});await until(()=>checkpoint==='flush'?h.control.flushes===1:checkpoint==='response'?h.posts.length===1:h.control.refreshes===1);
    h.control.user={id:'another-lord',name:'別の領主'};pause.resolve({ok:true,revision:8,battle:{won:true}});
    await assert.rejects(task,e=>e.code==='STALE_IDENTITY');assert.equal(h.c.fieldActionPending,false);if(checkpoint==='flush')assert.equal(h.posts.length,0);
  }
});

(async()=>{for(const {name,run} of tests){await run();console.log('PASS '+name);}console.log(tests.length+' event command bridge scenarios passed; no live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
