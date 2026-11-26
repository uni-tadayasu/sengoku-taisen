/* Private dispatch transaction facade: real game state, isolated storage and fake transport. */
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
const pendingKey = 'sengoku-covert-command-pending-v1';
const covertRecords = h => [...h.stored.entries()].filter(([key])=>key.startsWith(pendingKey+':'));
const covertPending = h => JSON.parse(covertRecords(h)[0]?.[1]||'null');
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
  let game=new SengokuEngine({officers:roster,seed:17,isAdmin:true});
  const clock={id:'field-clock',elapsedMs:100000,confirmedElapsedMs:100000,running:true,speed:1,revision:1,calendar:{turn:1,year:1560,month:2,cycle:1,elapsed:40}};
  if(stored.has('save'))game=SengokuEngine.fromSave(stored.get('save'),roster,{isAdmin:true});
  else {game.applyWorldClock(clock);stored.set('save',game.exportSave());}
  const control={user:{id:'player-a',name:'領主A',isAdmin:true,guildId:'guild-a'},deviceId:'tab-a',status:{linked:true,ready:true,writable:true,revision:7,leaseExpiresAt:new Date(Date.now()+30000).toISOString()},clock,clockReady:true,uuidCalls:0,flushes:0,refreshes:0,queued:0};
  let context;
  const social={
    getUser:()=>control.user?{...control.user}:null,
    covertRequest:async(route,opts)=>{
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
    syncAccess:{...control.status},lastLocalSaveRaw:null,lastLocalSaveGame:null,localCampaignRefreshPending:false,saveKey:'save',backupKey:'backups',saveEnabled:true,saveWarning:'',
    worldCatchingUp:false,worldSettlementPending:false,worldSettlementRetryAt:0,worldCatchupTimer:null,worldClockStatusKey:'',fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,startPending:false,roleEpoch:1,
    selectedCastle:'',lastRealtime:0,saveCounter:0,importedGame:null,activeModal:'',
    localStorage:{get length(){return stored.size;},key:index=>[...stored.keys()][index]??null,getItem:key=>stored.get(key)||null,setItem:(key,value)=>{if(control.storageError)throw Error('storage unavailable');stored.set(key,value);},removeItem:key=>stored.delete(key)},
    crypto:{randomUUID:()=>{control.uuidCalls++;return 'test-request-'+control.uuidCalls;}},
    window:{SengokuSocial:social,SengokuCloudSync:sync,
      SengokuWorldClock:{snapshot:()=>({ready:control.clockReady,clock:control.clock,message:'clock'}),refresh:async()=>{trace.push('clock-refresh');return control.onClockRefresh?control.onClockRefresh():{ok:true};},accept:value=>{clockAccepts.push(value);trace.push('accept-clock');control.clock=value;}},
      dispatchEvent:event=>{events.push(event.type);trace.push('save');}
    },
    CustomEvent:class{constructor(type){this.type=type;}},
    navigator:{onLine:true},performance:{now:()=>1000},document:{hidden:false},$:()=>null,
    setTimeout:()=>1,clearTimeout:()=>{},toast:()=>{},render:()=>{},renderHeader:()=>{},
    refreshLiveControls:()=>{},refreshJobTimers:()=>{},refreshActiveModal:()=>{},
    queueWorldProgress:()=>control.queued++,preserveInteraction:()=>{},closeModal:()=>{},updateBattlePreview:()=>{},syncMusic:()=>{},
  };
  vm.createContext(context);
  vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','changedLocalCampaign','save','backupCurrentSave','trustedBranchAuthority','applyBranchAuthority','trustedMaintenanceAuthority','applyMaintenanceAuthority','applyCloudSave','applyDurableGift','restoreAdminAssets','processWorldClock','requestField','requestCovert','getCovertAccess','getRoamingAccess'].map(fn).join('\n'),context);
  return {c:context,control,stored,trace,posts,gets,events,clockAccepts};
}

const tests=[];const test=(name,run)=>tests.push({name,run});
const payload=h=>({sourceCastleId:'edo',count:10,requestId:'covert-first',campaignId:h.c.game.state.walking.campaignId,sequence:h.c.game.state.covert.sequence});

test('private reads use the covert connector and only exact cursor routes are accepted',async()=>{
 const h=setup();await h.c.requestCovert('/covert');await h.c.requestCovert('/covert?cursor=lord-a&limit=100');assert.equal(h.gets.length,2);assert.equal(h.posts.length,0);
 for(const route of ['/covert?playerId=other','/covert/../admin/staff','/covert/hire/extra','/trades'])await assert.rejects(h.c.requestCovert(route));
 await assert.rejects(h.c.requestCovert('/covert',{method:'POST',data:payload(h)}));
});

test('linked dispatch freezes writes, refreshes writer metadata and waits for authoritative revision',async()=>{
 const h=setup(),flush=deferred(),response=deferred(),refresh=deferred(),body=payload(h),before=clone(h.c.game.state);
 h.control.onFlush=()=>flush.promise;h.control.onPost=()=>response.promise;h.control.onRefresh=()=>refresh.promise;
 const task=h.c.requestCovert('/covert/hire',{method:'POST',data:{...body,deviceId:'spoof',expectedRevision:999}});await until(()=>h.control.flushes===1);assert.equal(h.c.canMutate(),false);assert.equal(h.posts.length,0);
 h.control.status.revision=19;flush.resolve({ok:true});await until(()=>h.posts.length===1);const sent=h.posts[0];assert.equal(sent.route,'/covert/hire');assert.equal(sent.options.data.deviceId,'tab-a');assert.equal(sent.options.data.expectedRevision,19);assert.equal(covertPending(h).requestId,body.requestId);
 response.resolve({ok:true,revision:20,result:{action:'hire',requestId:body.requestId},clock:h.control.clock});await until(()=>h.control.refreshes===1);assert.deepEqual(clone(h.c.game.state),before);assert.equal(covertPending(h).committed,true);h.control.status.revision=20;refresh.resolve({ok:true});assert.equal((await task).result.action,'hire');assert.equal(covertRecords(h).length,0);assert.equal(h.c.canMutate(),true);
});

test('lost dispatch response reuses the exact intent and request ID across reload',async()=>{
 const h=setup(),body=payload(h);h.control.onPost=async()=>{throw Error('lost response');};await assert.rejects(h.c.requestCovert('/covert/hire',{method:'POST',data:body}),/lost response/);assert(covertPending(h));
 const reopened=setup({stored:h.stored});reopened.control.status.revision=8;reopened.control.onPost=async call=>({ok:true,revision:8,result:{action:'hire',requestId:call.options.data.requestId},idempotent:true});
 const result=await reopened.c.requestCovert('/covert/hire',{method:'POST',data:{...body,requestId:'new-ui-id'}});assert.equal(result.effectiveRequestId,body.requestId);assert.equal(reopened.posts[0].options.data.requestId,body.requestId);assert.equal(covertRecords(reopened).length,0);
});

test('uncertain 408/429 and committed unconfirmed results retain durable replay records',async()=>{
 for(const status of [408,429,500]){const h=setup();h.control.onPost=async()=>{throw Object.assign(Error('uncertain'),{status});};await assert.rejects(h.c.requestCovert('/covert/hire',{method:'POST',data:payload(h)}));assert(covertPending(h),String(status));}
 const h=setup();h.control.onPost=async()=>({ok:true,result:{action:'hire'}});await assert.rejects(h.c.requestCovert('/covert/hire',{method:'POST',data:payload(h)}),e=>e.code==='COVERT_RECONCILE_PENDING');assert.equal(covertPending(h).committed,true);assert.equal(h.c.fieldActionPending,false);
});

test('preflight sync rejection after a lost response preserves the same bridge operation',async()=>{
 const h=setup(),body=payload(h);h.control.onPost=async()=>{throw Error('committed response lost');};await assert.rejects(h.c.requestCovert('/covert/hire',{method:'POST',data:body}));assert.equal(covertPending(h).requestId,body.requestId);
 h.control.onPost=async()=>{throw Object.assign(Error('changed writer metadata'),{status:409,code:'COVERT_SYNC_REQUIRED',retryable:true});};await assert.rejects(h.c.requestCovert('/covert/hire',{method:'POST',data:{...body,requestId:'ui-retry'}}),e=>e.code==='COVERT_SYNC_REQUIRED');assert.equal(covertPending(h).requestId,body.requestId);
 h.control.onPost=async call=>({ok:true,revision:7,result:{action:'hire',requestId:call.options.data.requestId},idempotent:true});const response=await h.c.requestCovert('/covert/hire',{method:'POST',data:{...body,requestId:'ui-retry-again'}});assert.equal(response.effectiveRequestId,body.requestId);assert.equal(covertRecords(h).length,0);
});

test('owner and role changes at every await boundary reject earlier private results',async()=>{
 for(const kind of ['owner','role'])for(const stage of ['clock','flush','response','refresh']){const h=setup(),pause=deferred();if(stage==='clock')h.control.onClockRefresh=()=>pause.promise;if(stage==='flush')h.control.onFlush=()=>pause.promise;if(stage==='response')h.control.onPost=()=>pause.promise;if(stage==='refresh')h.control.onRefresh=()=>pause.promise;
 const task=h.c.requestCovert('/covert/hire',{method:'POST',data:payload(h)});await until(()=>stage==='clock'?h.trace.includes('clock-refresh'):stage==='flush'?h.control.flushes===1:stage==='response'?h.posts.length===1:h.control.refreshes===1);if(kind==='owner')h.control.user={id:'other-player'};else h.c.roleEpoch++;
 pause.resolve({ok:true,revision:7,result:{action:'hire'}});await assert.rejects(task,e=>e.code==='STALE_IDENTITY');assert.equal(h.c.fieldActionPending,false);if(['clock','flush'].includes(stage))assert.equal(h.posts.length,0);
 }
});

test('local paid hire and scouting persist once and keep the military soldier balance unchanged',async()=>{
 const h=setup();h.c.syncAccess.linked=false;const body=payload(h),before=clone(h.c.game.state);let response=await h.c.requestCovert('/covert/hire',{method:'POST',data:body});assert.equal(response.ok,true);assert.equal(h.posts.length,0);assert.equal(h.c.game.state.command,before.command-1);assert.equal(h.c.game.state.troops,before.troops);assert.equal(h.c.game.state.covert.reserves.edo,10);assert.equal(response.covert.sequence,1);
 const after=clone(h.c.game.state);response=await h.c.requestCovert('/covert/hire',{method:'POST',data:body});assert.equal(response.idempotent,true);assert.deepEqual(clone(h.c.game.state),after);
 const scout={...body,requestId:'covert-scout',sequence:1,mode:'scout',target:{kind:'castle',castleId:'odawara'}};
 const send=()=>h.c.requestCovert('/covert/dispatch',{method:'POST',data:scout});
 response=await send();assert(response.ok&&response.marching);const {march}=response;
 assert.equal(response.covert.reports.length,0);assert.equal(h.c.game.state.covert.reserves.edo,0);
 assert.equal(h.c.game.state.troops,before.troops);
 assert.equal(JSON.parse(h.stored.get('save')).state.covert.dispatches[0].id,march.id);
 const enRoute=clone(h.c.state());assert((await send()).idempotent);assert.deepEqual(clone(h.c.state()),enRoute);
 const arrival={...h.control.clock,elapsedMs:march.arrivesElapsedMs,confirmedElapsedMs:march.arrivesElapsedMs};
 h.control.clock=arrival;const advanced=h.c.game.applyWorldClock(arrival);
 assert.equal(advanced.covertResults.length,1);assert.equal(advanced.covertResults[0].dispatchId,march.id);
 assert.equal(h.c.state().covert.dispatches[0].phase,'returning');assert.equal(h.c.state().covert.reserves.edo,0);
 const homeArrival={...arrival,elapsedMs:h.c.state().covert.dispatches[0].arrivesElapsedMs,confirmedElapsedMs:h.c.state().covert.dispatches[0].arrivesElapsedMs};h.control.clock=homeArrival;h.c.game.applyWorldClock(homeArrival);
 assert.equal(h.c.state().covert.dispatches.length,0);assert.equal(h.c.state().covert.reserves.edo,10);
 const status=await h.c.requestCovert('/covert');assert.equal(status.covert.reports.length,1);
 assert.equal(status.covert.reports[0].target.castleId,'odawara');assert.equal(h.c.state().troops,before.troops);
 assert(h.c.save());const persisted=JSON.parse(h.stored.get('save')).state.covert;
 assert.equal(persisted.sequence,2);assert.deepEqual(persisted.reports,clone(status.covert.reports));
 const settled=clone(h.c.state()),again=await send();assert(again.idempotent);
 assert.equal(again.result.status,'resolved');assert.deepEqual(clone(h.c.state()),settled);

});

test('failed local save restores the complete pre-operation campaign',async()=>{
 const h=setup();h.c.syncAccess.linked=false;const before=clone(h.c.game.state);h.c.localStorage.setItem=()=>{throw Error('full');};await assert.rejects(h.c.requestCovert('/covert/hire',{method:'POST',data:payload(h)}),/保存できなかった/);assert.deepEqual(clone(h.c.game.state),before);assert.equal(h.posts.length,0);
});

test('follower, stale-clock, unsaved, unstarted and unregistered contexts never mutate',async()=>{
 for(const kind of ['follower','clock','unsaved','unstarted','guest']){const h=setup();if(kind==='follower'){h.c.syncAccess.writable=false;h.control.status.writable=false;}if(kind==='clock')h.control.clockReady=false;if(kind==='unsaved')h.c.saveEnabled=false;if(kind==='unstarted')h.c.startPending=true;if(kind==='guest')h.control.user=null;const before=clone(h.c.game.state);await assert.rejects(h.c.requestCovert('/covert/hire',{method:'POST',data:payload(h)}));assert.equal(h.posts.length,0,kind);assert.deepEqual(clone(h.c.game.state),before,kind);}
});

(async()=>{for(const{name,run}of tests){await run();console.log('PASS '+name);}console.log(tests.length+' covert transaction bridge scenarios passed; no live writes.');})().catch(error=>{console.error(error);process.exitCode=1;});
