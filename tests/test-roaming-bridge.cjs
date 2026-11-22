/* CPU battle transaction facade: real game state, isolated storage and fake transport. */
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
const pendingKey = 'sengoku-roaming-command-pending-v1';
const roamingRecords = h => [...h.stored.entries()].filter(([key])=>key.startsWith(pendingKey+':'));
const roamingPending = h => JSON.parse(roamingRecords(h)[0]?.[1]||'null');
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
    roamingRequest:async(route,opts)=>{
      const call={route,options:clone(opts)};
      if(opts.method==='GET'){gets.push(call);trace.push('get');return control.onGet?control.onGet(call):route.startsWith('/roaming/map?')?{ok:true,deployment:SengokuEngine.roamingDeploymentDefaults(),units:SengokuEngine.roamingDeploymentUnits(SengokuEngine.roamingDeploymentDefaults(),new URLSearchParams(route.split('?')[1]).get('castleId')),serverNow:Date.now()}:{ok:true,players:[]};}
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
    game,roster,SengokuEngine,staffBaseId:'kyoto_gosho',data:game.data,URLSearchParams,Date,JSON,Math,Promise,
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
  vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','changedLocalCampaign','save','backupCurrentSave','trustedBranchAuthority','applyBranchAuthority','applyCloudSave','applyDurableGift','restoreAdminAssets','processWorldClock','requestField','requestRoamingBattle','getRoamingAccess'].map(fn).join('\n'),context);
  return {c:context,control,stored,trace,posts,gets,events,clockAccepts};
}

const tests=[];
const test=(name,run)=>tests.push({name,run});
const payload=h=>{const unit=SengokuEngine.roamingDeploymentUnits(SengokuEngine.roamingDeploymentDefaults(),h.c.game.state.home)[0];return{encounterId:unit.encounterId,unitId:unit.unitId,castleId:unit.castleId,deploymentRevision:unit.deploymentRevision,tactic:'balanced',troops:1000,requestId:'roaming-first',campaignId:h.c.game.state.walking.campaignId,sequence:h.c.game.state.roaming.sequence};};

test('CPU access follows campaign, clock, owner and writer without treating empty commands as lost-receipt failure',()=>{
 const h=setup();let a=h.c.getRoamingAccess();assert.equal(a.writable,true);assert.equal(a.linked,true);assert.equal(a.ownerId,'player-a');
 h.c.game.state.command=0;assert.equal(h.c.getRoamingAccess().writable,true);
 h.control.clock.running=false;assert.equal(h.c.getRoamingAccess().writable,true,'Paused time stops command recovery, not spending saved commands');h.control.clock.running=true;
 h.c.fieldActionPending=true;assert.equal(h.c.getRoamingAccess().writable,false);h.c.fieldActionPending=false;
 h.c.startPending=true;assert.equal(h.c.getRoamingAccess().writable,false);
});

test('linked CPU battle freezes local mutations, flushes first and waits for committed cloud revision',async()=>{
 const h=setup(),flush=deferred(),response=deferred(),refresh=deferred(),body=payload(h),before=clone(h.c.game.state);
 h.control.onFlush=()=>flush.promise;h.control.onPost=()=>response.promise;h.control.onRefresh=()=>refresh.promise;
 const task=h.c.requestRoamingBattle({...body,deviceId:'spoof',expectedRevision:999});
 await until(()=>h.control.flushes===1);assert.equal(h.c.canMutate(),false);assert.equal(h.posts.length,0);
 assert.equal(h.c.applyDurableGift({gold:50},'during-roaming').ok,false);
 h.control.status.revision=19;flush.resolve({ok:true});await until(()=>h.posts.length===1);
 const sent=h.posts[0];assert.equal(sent.route,'/roaming/battle');assert.equal(sent.options.data.expectedRevision,19);assert.equal(sent.options.data.deviceId,'tab-a');
 assert.equal(sent.options.data.sequence,body.sequence);assert.equal(roamingPending(h).requestId,body.requestId);
 await assert.rejects(h.c.requestRoamingBattle({...body,requestId:'second'}));
 response.resolve({ok:true,revision:20,battle:{requestId:body.requestId,won:true},clock:h.control.clock});await until(()=>h.control.refreshes===1);
 assert.deepEqual(clone(h.c.game.state),before,'No optimistic local reward/debit');assert.equal(roamingPending(h).committed,true);
 h.control.status.revision=20;refresh.resolve({ok:true});assert.equal((await task).battle.won,true);assert.equal(roamingRecords(h).length,0);assert.equal(h.c.canMutate(),true);
});

test('lost CPU response retains its operation and can be retried after last command was spent',async()=>{
 const h=setup(),body=payload(h);h.c.game.state.command=1;let actual=0;const receipts=new Map();
 h.control.onPost=async call=>{actual++;receipts.set(call.options.data.requestId,{ok:true,revision:8,battle:{won:true,requestId:body.requestId},idempotent:true});throw Error('response lost');};
 h.control.onRefresh=async()=>{h.c.game.state.command=0;h.c.game.state.roaming.sequence=1;h.control.status.revision=8;h.stored.set('save',h.c.game.exportSave());return{ok:true};};
 await assert.rejects(h.c.requestRoamingBattle(body),/response lost/);assert.equal(h.c.game.state.command,0);assert(roamingPending(h));
 const reopened=setup({stored:h.stored});reopened.control.status.revision=8;
 reopened.control.onPost=async call=>{assert.equal(call.options.data.expectedRevision,8);return receipts.get(call.options.data.requestId);};
 const result=await reopened.c.requestRoamingBattle({...body,requestId:'changed-ui-id'});
 assert.equal(result.idempotent,true);assert.equal(result.effectiveRequestId,body.requestId);assert.equal(reopened.posts[0].options.data.requestId,body.requestId);assert.equal(actual,1);assert.equal(roamingRecords(reopened).length,0);
});

test('missing or stale cloud confirmation retains committed CPU receipt',async()=>{
 const h=setup();h.control.onPost=async()=>({ok:true,battle:{won:false}});
 await assert.rejects(h.c.requestRoamingBattle(payload(h)),e=>e.code==='ROAMING_RECONCILE_PENDING');assert.equal(roamingPending(h).committed,true);assert.equal(h.c.fieldActionPending,false);
});

test('unregistered linked, follower, expired, unstarted and unsaved campaigns never send CPU actions',async()=>{
 for(const mode of ['unregistered','follower','expired','unstarted','unsaved','clock','flush']){
  const h=setup();if(mode==='unregistered')h.control.user=null;if(mode==='follower'){h.control.status.writable=false;h.c.syncAccess.writable=false;}
  if(mode==='expired')h.c.syncAccess.leaseExpiresAt=new Date(Date.now()-1).toISOString();if(mode==='unstarted')h.c.startPending=true;if(mode==='unsaved')h.c.saveEnabled=false;
  if(mode==='clock')h.control.clockReady=false;if(mode==='flush')h.control.onFlush=async()=>({ok:false});
  const before=clone(h.c.game.state);await assert.rejects(h.c.requestRoamingBattle(payload(h)));assert.equal(h.posts.length,0,mode);assert.deepEqual(clone(h.c.game.state),before,mode);assert.equal(h.c.fieldActionPending,false);
 }
});

test('a change of player during flush, response or refresh rejects old CPU results',async()=>{
 for(const checkpoint of ['flush','response','refresh']){
  const h=setup(),pause=deferred();if(checkpoint==='flush')h.control.onFlush=()=>pause.promise;if(checkpoint==='response')h.control.onPost=()=>pause.promise;if(checkpoint==='refresh')h.control.onRefresh=()=>pause.promise;
  const task=h.c.requestRoamingBattle(payload(h));await until(()=>checkpoint==='flush'?h.control.flushes===1:checkpoint==='response'?h.posts.length===1:h.control.refreshes===1);
  h.control.user={id:'another-lord',name:'別の領主'};pause.resolve({ok:true,revision:8,battle:{won:true}});
  await assert.rejects(task,e=>e.code==='STALE_IDENTITY');assert.equal(h.c.fieldActionPending,false);if(checkpoint==='flush')assert.equal(h.posts.length,0);
 }
});

function arrive(h, departure, worldDelayMs=0) {
  assert(departure.ok && departure.marching);
  const {game}=h.c;
  const clock={...h.control.clock,elapsedMs:departure.march.arrivesElapsedMs+worldDelayMs,
    confirmedElapsedMs:departure.march.arrivesElapsedMs+worldDelayMs};
  h.control.clock=clock;
  const update=game.applyWorldClock(clock);
  assert.equal(update.marchResults.length,1);
  const [receipt]=update.marchResults;
  assert.equal(receipt.id,departure.march.id);
  assert.equal(receipt.status,'resolved');
  assert(h.c.save(),'the settled clock saves the arrival receipt');
  return receipt.battle;
}

test('local CPU departure saves escrow once and arrival settles casualties, rewards and history',async()=>{
 const h=setup();h.c.syncAccess.linked=false;h.c.game.state.command=2;
 const body=payload(h),before=clone(h.c.game.state);
 const departure=await h.c.requestRoamingBattle(body),march=departure.march;
 assert(departure.ok&&departure.marching);assert.equal(h.posts.length,0);assert.equal(departure.battle,undefined);
 assert.equal(h.c.game.state.command,1);
 assert.equal(h.c.game.state.troops,before.troops-body.troops);
 assert.equal(h.c.game.state.resources.rice,before.resources.rice-march.foodCost);
 assert.equal(h.c.game.state.roaming.sequence,0);
 assert.equal(JSON.parse(h.stored.get('save')).state.march.id,march.id);
 const escrow=clone(h.c.game.state),replayed=await h.c.requestRoamingBattle(body);
 assert(replayed.idempotent);assert.equal(replayed.march.id,march.id);assert.deepEqual(clone(h.c.game.state),escrow);
 // Advance an identical garrison without an arrival to isolate passive income during travel.
 const garrison=SengokuEngine.fromSave(h.c.game.exportSave(),roster);garrison.state.troops+=march.troops;garrison.state.march=null;
 const battle=arrive(h,departure);garrison.applyWorldClock(h.control.clock);
 assert.equal(h.c.game.state.troops,before.troops-battle.ourLost);
 assert.equal(battle.foodCost,march.foodCost);
 assert.equal(h.c.game.state.resources.rice,garrison.state.resources.rice+battle.rewards.rice);
 assert.equal(h.c.game.state.roaming.sequence,1);assert.equal(h.c.game.state.march,null);
 const after=clone(h.c.game.state),duplicate=await h.c.requestRoamingBattle(body);
 assert(duplicate.idempotent);assert.equal(duplicate.battle.requestId,body.requestId);
 assert.deepEqual(clone(h.c.game.state),after);
 assert.equal(JSON.parse(h.stored.get('save')).state.roaming.history[0].requestId,body.requestId);
});

test('failed local saving restores all CPU campaign state before reporting an error',async()=>{
 const h=setup();h.c.syncAccess.linked=false;const before=clone(h.c.game.state);h.c.localStorage.setItem=()=>{throw Error('storage full');};
 await assert.rejects(h.c.requestRoamingBattle(payload(h)),/保存できなかった/);assert.deepEqual(clone(h.c.game.state),before);assert.equal(h.posts.length,0);
});

test('map identity survives the durable command bridge without accepting client soldier edits',async()=>{
 const h=setup(),body=payload(h);h.control.onPost=async()=>({ok:true,revision:7,battle:{unitId:body.unitId}});await h.c.requestRoamingBattle(body);const sent=h.posts[0].options.data;assert.equal(sent.unitId,body.unitId);assert.equal(sent.castleId,body.castleId);assert.equal(sent.deploymentRevision,body.deploymentRevision);assert.equal(sent.enemyTroops,undefined);
});
test('local stale deployment and absent map target fail before consuming',async()=>{
 const h=setup();h.c.syncAccess.linked=false;const body=payload(h),before=clone(h.c.game.state);await assert.rejects(h.c.requestRoamingBattle({...body,deploymentRevision:2}),e=>e.code==='ROAMING_DEPLOYMENT_CHANGED');await assert.rejects(h.c.requestRoamingBattle({...body,unitId:undefined}),e=>e.code==='ROAMING_MAP_REQUIRED');assert.deepEqual(clone(h.c.game.state),before);
});
test('local mapped victory starts the real-time cooldown on settlement and persists it until expiry',async()=>{
 const h=setup();h.c.syncAccess.linked=false;h.c.window.SENGOKU_OFFLINE=true;
 const body={...payload(h),troops:Math.min(h.c.game.state.troops,h.c.game.troopCapacity())};
 const departure=await h.c.requestRoamingBattle(body);
 const duration=departure.march.options.respawnSeconds*1000,start=Date.now();
 const battle=arrive(h,departure,2*duration);
 assert(battle.won);assert(battle.respawnAt>=start+duration&&battle.respawnAt<=Date.now()+duration);
 const restored=setup({stored:h.stored});restored.control.clock=h.control.clock;
 restored.c.syncAccess.linked=false;restored.c.window.SENGOKU_OFFLINE=true;
 assert.equal(restored.c.state().roaming.history[0].respawnAt,battle.respawnAt);
 assert.equal(restored.c.state().marchHistory[0].battle.respawnAt,battle.respawnAt);
 const before=clone(restored.c.state()),next={...payload(restored),requestId:'second-at-same-unit'};
 restored.c.Date=class extends Date{static now(){return battle.respawnAt-1;}};
 await assert.rejects(restored.c.requestRoamingBattle(next),e=>e.code==='ROAMING_UNIT_UNAVAILABLE');
 const replay=await restored.c.requestRoamingBattle(body);
 assert(replay.idempotent);assert.equal(replay.battle.respawnAt,battle.respawnAt);
 assert.deepEqual(clone(restored.c.state()),before);
 restored.c.Date=class extends Date{static now(){return battle.respawnAt;}};
 const again=await restored.c.requestRoamingBattle(next);
 assert(again.ok&&again.marching);assert.equal(again.march.options.unitId,body.unitId);
});
test('temporary preflight failure retains the same uncertain operation for later receipt lookup',async()=>{
 const h=setup(),body=payload(h);h.control.onPost=async()=>{throw Error('lost response');};await assert.rejects(h.c.requestRoamingBattle(body));const id=roamingPending(h).requestId;h.control.onPost=async()=>{throw Object.assign(Error('writer refreshing'),{status:409,code:'ROAMING_SYNC_REQUIRED',retryable:true});};await assert.rejects(h.c.requestRoamingBattle(body));assert.equal(roamingPending(h).requestId,id);
});

(async()=>{for(const {name,run}of tests){await run();console.log('PASS '+name);}console.log(tests.length+' CPU transaction bridge scenarios passed; no live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
