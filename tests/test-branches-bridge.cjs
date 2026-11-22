/* Attached branch transaction facade: real game state, isolated storage and fake transport. */
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
const pendingKey = 'sengoku-branch-command-pending-v1';
const branchRecords = h => [...h.stored.entries()].filter(([key])=>key.startsWith(pendingKey+':'));
const branchPending = h => JSON.parse(branchRecords(h)[0]?.[1]||'null');
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
    branchRequest:async(route,opts)=>{
      const call={route,options:clone(opts)};
      if(opts.method==='GET'){gets.push(call);trace.push('get');return control.onGet?control.onGet(call):{ok:true,campaignId:context.game.state.walking.campaignId,sequence:control.branchSequence||0,branchState:{branches:[]}};}
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
  vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','save','backupCurrentSave','trustedBranchAuthority','applyBranchAuthority','applyCloudSave','applyDurableGift','restoreAdminAssets','processWorldClock','requestField','requestBranches'].map(fn).join('\n'),context);
  return {c:context,control,stored,trace,posts,gets,events,clockAccepts};
}

const tests=[],test=(name,run)=>tests.push([name,run]),build={parentCastleId:'edo',direction:'north'};
test('branch reads and commands route through the private connector with authoritative writer metadata',async()=>{
 const h=setup(),before=clone(h.c.game.state);await h.c.requestBranches('/branches');h.control.onPost=async()=>({ok:true,revision:9});h.control.onRefresh=async()=>{h.control.status.revision=9;return{ok:true};};const r=await h.c.requestBranches('/branches/build',{method:'POST',data:{...build,deviceId:'forged',expectedRevision:999}});assert(r.ok);assert.equal(h.posts.length,1);const body=h.posts[0].options.data;assert.equal(body.deviceId,'tab-a');assert.equal(body.expectedRevision,7);assert.equal(body.campaignId,h.c.game.state.walking.campaignId);assert.equal(body.sequence,0);assert.equal(body.parentCastleId,'edo');assert.equal(body.direction,'north');assert.equal(h.control.flushes,1);assert.equal(branchRecords(h).length,0);assert.deepEqual(clone(h.c.game.state),before,'Cloud actions never optimistically change local branches/resources');
});
test('a lost response keeps the original request UUID, campaign and sequence despite a newer GET',async()=>{
 const h=setup();h.control.onPost=async()=>{throw Error('lost response');};await assert.rejects(h.c.requestBranches('/branches/build',{method:'POST',data:build}),/lost response/);const first=clone(h.posts[0].options.data),pending=branchPending(h);assert.equal(pending.branchSequence,0);assert.equal(pending.branchCampaignId,first.campaignId);
 h.control.branchSequence=1;h.control.status.revision=8;h.control.onPost=async()=>({ok:true,idempotent:true,revision:8});await h.c.requestBranches('/branches/build',{method:'POST',data:{...build,requestId:'new-ui-request'}});const second=h.posts[1].options.data;assert.equal(second.requestId,first.requestId);assert.equal(second.campaignId,first.campaignId);assert.equal(second.sequence,first.sequence);assert.equal(second.expectedRevision,8);assert.equal(branchRecords(h).length,0);
});
test('unconfirmed revisions retain their receipt and cannot report successful construction',async()=>{
 const h=setup();h.control.onPost=async()=>({ok:true,revision:10});await assert.rejects(h.c.requestBranches('/branches/build',{method:'POST',data:build}),error=>error.code==='BRANCH_RECONCILE_PENDING');assert.equal(branchPending(h).committedRevision,10);const id=branchPending(h).requestId;h.control.status.revision=10;await h.c.requestBranches('/branches/build',{method:'POST',data:build});assert.equal(h.posts.at(-1).options.data.requestId,id);assert.equal(branchRecords(h).length,0);
});
test('another branch action first reconciles the unresolved operation without mixing its payload',async()=>{
 const h=setup();h.control.onPost=async()=>{throw Error('lost');};await assert.rejects(h.c.requestBranches('/branches/build',{method:'POST',data:build}));const original=h.posts[0].options.data.requestId;h.control.onPost=async()=>({ok:true,revision:7});await h.c.requestBranches('/branches/upgrade',{method:'POST',data:{branchId:'edo_north'}});assert.equal(h.posts.length,3);assert.equal(h.posts[1].options.data.requestId,original);assert.equal(h.posts[1].route,'/branches/build');assert.equal(h.posts[2].route,'/branches/upgrade');assert.equal(h.posts[2].options.data.branchId,'edo_north');assert.notEqual(h.posts[2].options.data.requestId,original);
});
test('account, role and campaign changes at metadata/flush boundaries prevent the old command',async()=>{
 for(const stage of ['metadata','flush'])for(const kind of ['identity','role','campaign']){const h=setup(),gate=deferred();if(stage==='metadata')h.control.onGet=()=>gate.promise;else h.control.onFlush=()=>gate.promise;const task=h.c.requestBranches('/branches/build',{method:'POST',data:build});await until(()=>stage==='metadata'?h.gets.length>0:h.control.flushes>0);if(kind==='identity')h.control.user={id:'other',name:'other'};else if(kind==='role')h.c.roleEpoch++;else h.c.game.state.walking.campaignId='replacement-campaign';gate.resolve(stage==='metadata'?{ok:true,campaignId:'original',sequence:0}:{ok:true});await assert.rejects(task,error=>error.code==='STALE_IDENTITY');assert.equal(h.posts.length,0);}
});
test('local commands save costs and timers once; storage failure restores the complete state',async()=>{
 const h=setup();h.c.syncAccess.linked=false;const quote=h.c.game.branchQuote('edo','north'),gold=h.c.game.state.resources.gold;assert(quote.ok);const result=await h.c.requestBranches('/branches/build',{method:'POST',data:build});assert(result.ok);assert.equal(h.c.game.state.branches[0].level,0);assert.equal(h.c.game.state.resources.gold,gold-quote.cost.gold);assert(JSON.parse(h.stored.get('save')).state.jobs.some(job=>job.kind==='branch'));assert.equal(h.posts.length,0);
 const failed=setup();failed.c.syncAccess.linked=false;const before=clone(failed.c.game.state);failed.c.localStorage.setItem=()=>{throw Error('full');};await assert.rejects(failed.c.requestBranches('/branches/build',{method:'POST',data:build}),/保存できなかった/);assert.deepEqual(clone(failed.c.game.state),before);
});
test('followers, missing local durability and unrelated routes cannot send a construction command',async()=>{
 for(const kind of ['follower','unsaved','guest']){const h=setup();if(kind==='follower'){h.c.syncAccess.writable=false;h.control.status.writable=false;}if(kind==='unsaved')h.c.saveEnabled=false;if(kind==='guest')h.control.user=null;await assert.rejects(h.c.requestBranches('/branches/build',{method:'POST',data:build}));assert.equal(h.posts.length,0);}
 const h=setup();for(const route of ['/branches?owner=other','/branches/build/extra','/branches/../admin'])await assert.rejects(h.c.requestBranches(route,{method:'POST',data:build}));assert.equal(h.posts.length,0);
});
test('facility orders use the same authoritative branch ledger and never mutate local resources optimistically',async()=>{
 for(const action of ['build-facility','upgrade-facility']){
  const h=setup(),before=clone(h.c.game.state);h.control.branchSequence=4;h.control.onPost=async()=>({ok:true,revision:9});h.control.onRefresh=async()=>{h.control.status.revision=9;return{ok:true};};
  const result=await h.c.requestBranches('/branches/'+action,{method:'POST',data:{branchId:'edo_north',facilityId:'farm',deviceId:'forged',sequence:999,expectedRevision:999}});
  assert(result.ok);assert.equal(h.posts.length,1);const body=h.posts[0].options.data;assert.equal(body.facilityId,'farm');assert.equal(body.branchId,'edo_north');assert.equal(body.deviceId,'tab-a');assert.equal(body.expectedRevision,7);assert.equal(body.sequence,4);assert.equal(body.campaignId,h.c.game.state.walking.campaignId);assert.deepEqual(clone(h.c.game.state),before);assert.equal(branchRecords(h).length,0);
 }
});
test('different facility orders reconcile a lost response with its original target and receipt before sending the next',async()=>{
 const h=setup(),farm={branchId:'edo_north',facilityId:'farm'},market={branchId:'edo_north',facilityId:'market'};h.control.onPost=async()=>{throw Error('lost facility response');};
 await assert.rejects(h.c.requestBranches('/branches/build-facility',{method:'POST',data:farm}),/lost facility response/);const first=clone(h.posts[0].options.data);h.control.onPost=async()=>({ok:true,revision:7});
 await h.c.requestBranches('/branches/build-facility',{method:'POST',data:market});assert.equal(h.posts.length,3);assert.equal(h.posts[1].options.data.requestId,first.requestId);assert.equal(h.posts[1].options.data.facilityId,'farm');assert.equal(h.posts[2].options.data.facilityId,'market');assert.notEqual(h.posts[2].options.data.requestId,first.requestId);assert.equal(branchRecords(h).length,0);
});
test('local facility build and upgrade each save a timed paid order and roll back completely on storage failure',async()=>{
 for(const action of ['build-facility','upgrade-facility']){
  const prepare=()=>{const h=setup();h.c.syncAccess.linked=false;h.c.game.state.branches=[{id:'edo_north',parentCastleId:'edo',direction:'north',level:3,fallen:false,facilities:action==='upgrade-facility'?{farm:1}:{}}];return h;};
  const h=prepare(),q=h.c.game.branchFacilityQuote('edo_north','farm'),gold=h.c.game.state.resources.gold,result=await h.c.requestBranches('/branches/'+action,{method:'POST',data:{branchId:'edo_north',facilityId:'farm'}});
  assert(result.ok,result.message);assert.equal(h.c.game.state.resources.gold,gold-q.cost.gold);assert.equal(h.c.game.state.branches[0].level,3);const saved=JSON.parse(h.stored.get('save'));assert.equal(saved.state.jobs.find(job=>job.facilityId==='farm').targetLevel,action==='upgrade-facility'?2:1);assert.equal(h.posts.length,0);
  const after=clone(h.c.game.state),duplicate=await h.c.requestBranches('/branches/'+action,{method:'POST',data:{branchId:'edo_north',facilityId:'farm'}});assert.equal(duplicate.ok,false);assert.deepEqual(clone(h.c.game.state),after);
  const failed=prepare(),before=clone(failed.c.game.state);failed.c.localStorage.setItem=()=>{throw Error('full');};await assert.rejects(failed.c.requestBranches('/branches/'+action,{method:'POST',data:{branchId:'edo_north',facilityId:'farm'}}),/保存できなかった/);assert.deepEqual(clone(failed.c.game.state),before);
 }
});
test('real delegated click actions carry the chosen facility through the mutation gate and branch transaction bridge',async()=>{
 const start=source.indexOf("  document.addEventListener('click',async event=>"),end=source.indexOf("  document.addEventListener('input'",start),mutations=source.match(/^  const mutationActions=.*$/m)?.[0];assert(start>=0&&end>start&&mutations);
 for(const action of ['build-branch-facility','upgrade-branch-facility']){
  const h=setup();let click;h.c.document.addEventListener=(type,handler)=>{if(type==='click')click=handler;};vm.runInContext(mutations+'\n'+source.slice(start,end),h.c);
  const node={dataset:{action,id:'edo_north',facility:'watchtower'},disabled:false,closest(){return this;}};await click({target:node});assert.equal(h.posts.length,1);assert.equal(h.posts[0].route,'/branches/'+action.replace('-branch',''));assert.equal(h.posts[0].options.data.branchId,'edo_north');assert.equal(h.posts[0].options.data.facilityId,'watchtower');
  const blocked=setup();blocked.c.syncAccess.writable=false;blocked.c.document.addEventListener=(type,handler)=>{if(type==='click')click=handler;};vm.runInContext(mutations+'\n'+source.slice(start,end),blocked.c);node.disabled=false;await click({target:node});assert.equal(blocked.posts.length,0);
 }
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' branch transaction bridge checks passed. No live writes.');})().catch(error=>{console.error(error);process.exitCode=1;});

