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
const fieldRecords = h => [...h.stored.entries()].filter(([key])=>key.startsWith(pendingKey+':'));
const fieldPending = h => JSON.parse(fieldRecords(h)[0]?.[1]||'null');
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
    fieldRequest:async(route,opts)=>{
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
  social.expansionRequest=async(route,opts={})=>{const call={route,options:clone({method:'GET',...opts})};if(call.options.method==='GET'){gets.push(call);trace.push('get-expansion');return control.onGet?control.onGet(call):{ok:true};}posts.push(call);trace.push('send-expansion');return control.onPost?control.onPost(call):{ok:true,revision:control.status.revision,receipt:{id:'expansion-1'}};};
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
  vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','save','backupCurrentSave','trustedBranchAuthority','applyBranchAuthority','trustedMaintenanceAuthority','applyMaintenanceAuthority','trustedCourtProtection','applyCourtProtection','trustedCourtEstateProjection','applyCloudSave','applyDurableGift','restoreAdminAssets','processWorldClock','requestField','requestExpansion'].map(fn).join('\n'),context);
  return {c:context,control,stored,trace,posts,gets,events,clockAccepts};
}
const tests=[];
function test(name,run){tests.push({name,run});}

test('public field reads work without registration, use the current device, and reject route escapes',async()=>{
  const h=setup();h.control.user=null;h.control.status.linked=false;h.c.syncAccess.linked=false;
  await h.c.requestField('/field?cursor=next');
  await h.c.requestField('/field/me?cursor=a&deviceId=caller-spoof');
  assert.equal(h.gets.length,2);assert.equal(h.posts.length,0);assert.equal(h.control.flushes,0);
  const params=new URLSearchParams(h.gets[1].route.split('?')[1]);
  assert.equal(params.get('deviceId'),'tab-a');assert.equal(params.getAll('deviceId').length,1);assert.equal(params.get('cursor'),'a');
  for(const [route,method] of [['/admin','POST'],['/field/attack/other','POST'],['/field#x','GET'],['/field','DELETE']])await assert.rejects(h.c.requestField(route,{method}));
  assert.equal(h.gets.length,2);assert.equal(h.posts.length,0);
});

test('a writer flushes first, sends the current revision/device, and freezes mutations until reconciliation',async()=>{
  const h=setup(),flush=deferred(),response=deferred(),refresh=deferred();
  h.control.onFlush=()=>flush.promise;h.control.onPost=()=>response.promise;h.control.onRefresh=()=>refresh.promise;
  const task=h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-b',troops:900,deviceId:'spoof',expectedRevision:9999}});
  await until(()=>h.control.flushes===1);
  assert.deepEqual(h.trace.slice(0,3),['clock-refresh','save','flush']);assert.equal(h.posts.length,0);
  const before=JSON.stringify(h.c.game.state),saveEvents=h.events.length;
  assert.equal(h.c.canMutate(),false);assert.equal(h.c.save(),false);
  assert.equal(h.c.applyDurableGift({gold:500},'while-flushing').ok,false);
  h.control.clock={...h.control.clock,elapsedMs:150000,confirmedElapsedMs:150000};h.c.processWorldClock();
  assert.equal(JSON.stringify(h.c.game.state),before,'Clock progression is frozen during the transaction');
  h.control.status.revision=19;flush.resolve({ok:true});await until(()=>h.posts.length===1);
  const body=h.posts[0].options.data;
  assert.equal(body.expectedRevision,19);assert.equal(body.deviceId,'tab-a');assert.equal(body.targetId,'player-b');assert.equal(body.troops,900);assert(body.requestId);
  assert.equal(fieldPending(h).requestId,body.requestId,'Retry key persists before the command is sent');
  await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-c',troops:1000}}));
  assert.equal(h.posts.length,1);assert.equal(h.events.length,saveEvents);assert.equal(h.c.canMutate(),false);
  response.resolve({ok:true,revision:20,report:{id:'committed'}});await until(()=>h.control.refreshes===1);
  assert.equal(h.c.canMutate(),false,'A successful HTTP response remains locked until save reconciliation');
  h.c.game.applyWorldClock(h.control.clock);h.control.status.revision=20;refresh.resolve({ok:true});
  const result=await task;
  assert.equal(result.report.id,'committed');assert.equal(h.c.fieldActionPending,false);assert.equal(h.c.canMutate(),true);assert.equal(fieldRecords(h).length,0);
});

test('confirmed shared time is reflected before flushing, without applying speculative display time',async()=>{
  const h=setup();
  h.control.clock={...h.control.clock,elapsedMs:180000,confirmedElapsedMs:120000,calendar:{turn:3,year:1560,month:4,cycle:1,elapsed:0}};
  let seen;
  h.control.onFlush=async()=>{seen=JSON.parse(h.stored.get('save'));return{ok:true};};
  await h.c.requestField('/field/me',{method:'POST',data:{}});
  assert.equal(seen.state.worldClock.elapsedMs,120000);assert.equal(seen.state.turn,2);assert.equal(h.posts.length,1);
});

test('a lost legacy response replays its original body overnight despite a new UI request ID',async()=>{
  const h=setup(),receipts=new Map();let executions=0,firstKey;
  const payload={targetPlayerId:'player-b',troops:700,tactic:'balanced',requestId:'old-ui-request'};
  h.control.onPost=async call=>{const key=call.options.data.requestId;firstKey=key;receipts.set(key,{ok:true,revision:8,report:{id:'already-committed'}});executions++;throw Error('response lost');};
  await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:payload}),/response lost/);
  assert.equal(h.c.fieldActionPending,false);assert.equal(h.control.refreshes,1);
  assert.equal(fieldPending(h).requestId,firstKey);
  const [scopedKey,raw]=fieldRecords(h)[0];h.stored.delete(scopedKey);
  h.stored.set(pendingKey,JSON.stringify({...JSON.parse(raw),payload:undefined,signature:JSON.stringify({route:'/field/attack',payload}),createdAt:Date.now()-86400000}));
  const reopened=setup({stored:h.stored});reopened.control.status.revision=21;
  reopened.control.onPost=async call=>{assert.equal(Object.hasOwn(call.options.data,'targetCastleId'),false,'A legacy raid must not silently become a capture');const key=call.options.data.requestId;if(receipts.has(key))return receipts.get(key);executions++;return{ok:true,revision:22,report:{id:'new'}};};
  const result=await reopened.c.requestField('/field/attack',{method:'POST',data:{tactic:'balanced',troops:700,targetPlayerId:'player-b',requestId:'new-ui-request',deviceId:'other',expectedRevision:0}});
  assert.equal(result.report.id,'already-committed');assert.equal(reopened.posts[0].options.data.requestId,firstKey);
  assert.equal(reopened.posts[0].options.data.expectedRevision,21);assert.equal(reopened.control.uuidCalls,0);assert.equal(executions,1);assert.equal(reopened.stored.has(pendingKey),false);assert.equal(fieldRecords(reopened).length,0);
});

test('unregistered, unlinked, follower, stale-clock and expired-lease players cannot send commands',async()=>{
  const scenarios=[
    h=>{h.control.user=null;},
    h=>{h.control.status.linked=false;h.c.syncAccess.linked=false;},
    h=>{h.control.status.writable=false;h.c.syncAccess.writable=false;},
    h=>{h.control.clockReady=false;},
    h=>{h.c.syncAccess.leaseExpiresAt=new Date(Date.now()-1000).toISOString();},
  ];
  for(const set of scenarios){
    const h=setup();set(h);const before=JSON.stringify(h.c.game.state);
    await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-b',troops:900}}));
    assert.equal(h.posts.length,0);assert.equal(h.control.flushes,0);assert.equal(fieldRecords(h).length,0);assert.equal(JSON.stringify(h.c.game.state),before);assert.equal(h.c.fieldActionPending,false);
  }
});

test('failed flush and unavailable durable storage abort before the field command',async()=>{
  for(const kind of ['flush','storage']){
    const h=setup();
    if(kind==='flush')h.control.onFlush=async()=>({ok:false});
    else h.control.onFlush=async()=>{h.control.storageError=true;return{ok:true};};
    await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-b',troops:900}}));
    assert.equal(h.posts.length,0);assert.equal(h.c.fieldActionPending,false);assert.equal(fieldRecords(h).length,0);
  }
});

test('definitive client errors retire the key while network failures retain it',async()=>{
  const h=setup();h.control.onPost=async()=>{throw Object.assign(Error('not permitted'),{status:403});};
  await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-b',troops:900}}),/not permitted/);
  assert.equal(fieldRecords(h).length,0);assert.equal(h.control.refreshes,1);assert.equal(h.c.fieldActionPending,false);
});

test('identity switching during a flush prevents the old command from being sent',async()=>{
  const h=setup(),flush=deferred();h.control.onFlush=()=>flush.promise;
  const task=h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-b',troops:900}});
  await until(()=>h.control.flushes===1);h.control.user={id:'player-new',name:'領主B',isAdmin:false};h.control.deviceId='tab-new';flush.resolve({ok:true});
  await assert.rejects(task,/領主|接続|以前/);
  assert.equal(h.posts.length,0);assert.equal(h.clockAccepts.length,0);assert.equal(h.control.refreshes,0);assert.equal(h.c.fieldActionPending,false);
});

test('identity switching during the response rejects the old result and preserves another identity pending record',async()=>{
  const h=setup(),response=deferred();h.control.onPost=()=>response.promise;
  const task=h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-b',troops:900}});
  await until(()=>h.posts.length===1);
  h.control.user={id:'player-new',name:'領主B',isAdmin:false};h.control.deviceId='tab-new';
  const newPending=JSON.stringify({playerId:'player-new',requestId:'new-identity-pending',signature:'new-action',createdAt:Date.now()});h.stored.set(pendingKey,newPending);
  response.resolve({ok:true,report:{id:'old-player-result'},clock:{...h.control.clock,revision:2}});
  await assert.rejects(task,/領主|接続|以前/);
  assert.equal(h.stored.get(pendingKey),newPending);assert.equal(h.clockAccepts.length,0);assert.equal(h.control.refreshes,0);assert.equal(h.c.fieldActionPending,false);
});

test('identity switching during reconciliation cannot deliver an old player report to the new UI',async()=>{
  const h=setup(),refresh=deferred();h.control.onRefresh=()=>refresh.promise;
  const task=h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-b',troops:900}});
  await until(()=>h.control.refreshes===1);h.control.user={id:'player-new',name:'領主B',isAdmin:false};h.control.deviceId='tab-new';refresh.resolve({ok:true});
  await assert.rejects(task,/領主|接続|以前/);assert.equal(h.c.fieldActionPending,false);
});

test('capture waits past a stale poll and applies the cloud save without resetting army, governors or buildings',async()=>{
  const h=setup(),gate=deferred(),s=h.c.game.state;
  s.governors.farm=s.officers.find(id=>!s.army.includes(id));s.buildings.farm=5;
  s.jobs.push({kind:'building',id:'farm',remaining:1,total:1,remainingSeconds:60,totalSeconds:60,targetLevel:6});
  const retained=state=>clone(Object.fromEntries(['home','cycle','army','governors','buildings','jobs','officers','officerVariants','walking'].map(key=>[key,state[key]])));
  const before=retained(s),remote=JSON.parse(h.c.game.exportSave());remote.state.castles.nijo.owner=s.clan;remote.state.resources.gold+=300;
  h.control.onPost=async()=>({ok:true,revision:9,battle:{id:'captured-nijo',captured:true}});
  h.control.onRefresh=async()=>{if(h.control.refreshes===1)return{ok:true};await gate.promise;const applied=h.c.applyCloudSave(remote,{isAdmin:false,isStaff:false});assert.equal(applied.ok,true);h.control.status.revision=9;return{ok:true};};
  const task=h.c.requestField('/field/attack',{method:'POST',data:{targetPlayerId:'player-b',targetCastleId:'nijo',troops:900,tactic:'balanced'}});
  await until(()=>h.control.refreshes===2);
  assert.equal(h.c.canMutate(),false);assert.equal(fieldPending(h).committedRevision,9);assert.notEqual(h.c.game.state.castles.nijo.owner,s.clan,'Capture is not applied optimistically');
  gate.resolve();const result=await task;
  assert.equal(result.battle.id,'captured-nijo');assert.equal(h.c.game.state.castles.nijo.owner,s.clan);
  assert.deepEqual(retained(h.c.game.state),before);assert.deepEqual(retained(JSON.parse(h.stored.get('save')).state),before);
  assert.equal(fieldRecords(h).length,0);assert.equal(h.control.refreshes,2);
});

test('unconfirmed attack revisions retain their receipt even when reconciliation or a later retry returns a client error',async()=>{
  for(const mode of ['offline','stale','missing-revision','client-error']){
    const h=setup(),payload={targetPlayerId:'player-b',targetCastleId:'nijo',troops:900,tactic:'balanced'},before=JSON.stringify(h.c.game.state);
    h.control.onPost=async()=>({ok:true,...(mode==='missing-revision'?{}:{revision:10}),battle:{id:'committed'}});
    h.control.onRefresh=async()=>{if(mode==='client-error')throw Object.assign(Error('sync expired'),{status:401});return{ok:mode!=='offline'};};
    await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:payload}),error=>mode==='client-error'?error.status===401:error.code==='FIELD_RECONCILE_PENDING');
    const record=fieldPending(h);assert.equal(record.committed,true);assert.equal(h.c.fieldActionPending,false);assert.equal(JSON.stringify(h.c.game.state),before);
    h.control.onPost=async()=>{throw Object.assign(Error('identity requires reconnecting'),{status:403});};
    await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:payload}),/identity requires/);
    assert.equal(fieldPending(h).requestId,record.requestId,'A post-commit error must not create another attack ID');
  }
});

test('a changed castle or force waits for the original attack before sending a distinct operation',async()=>{
  for(const priorCastle of [undefined,'nijo']){
    const h=setup(),receipts=new Map();let executions=0;
    const first={targetPlayerId:'player-b',...(priorCastle?{targetCastleId:priorCastle}:{}),troops:700,tactic:'balanced',requestId:'first-intent'};
    const next={targetPlayerId:'player-b',targetCastleId:priorCastle?'osaka':'nijo',troops:priorCastle?1200:700,tactic:'balanced',requestId:'next-intent'};
    h.control.onPost=async call=>{const key=call.options.data.requestId;if(!receipts.has(key)){executions++;receipts.set(key,{ok:true,revision:7+executions,battle:{id:key}});}return receipts.get(key);};
    h.control.onRefresh=async()=>({ok:false});
    await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:first}),error=>error.code==='FIELD_RECONCILE_PENDING');
    await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:next}),error=>error.code==='FIELD_RECONCILE_PENDING');
    assert.equal(h.posts.length,2);assert.equal(executions,1);assert.equal(fieldRecords(h).length,1);
    assert.equal(h.posts[1].options.data.requestId,'first-intent');assert.equal(h.posts[1].options.data.targetCastleId,priorCastle);assert.equal(h.posts[1].options.data.troops,700);
    h.control.onRefresh=async()=>{h.control.status.revision=7+executions;return{ok:true};};
    const result=await h.c.requestField('/field/attack',{method:'POST',data:next});
    assert.equal(h.posts[2].options.data.requestId,'first-intent');assert.equal(h.posts[2].options.data.targetCastleId,priorCastle);
    assert.equal(h.posts[3].options.data.requestId,'next-intent');assert.equal(h.posts[3].options.data.expectedRevision,8);assert.equal(h.posts[3].options.data.targetCastleId,next.targetCastleId);assert.equal(h.posts[3].options.data.troops,next.troops);
    assert.equal(result.battle.id,'next-intent');assert.equal(executions,2);assert.equal(fieldRecords(h).length,0);
  }
});

test('another identity never replays or overwrites an unresolved attack and the original identity can resume it',async()=>{
  const h=setup(),payload={targetPlayerId:'player-target',targetCastleId:'nagoya',troops:900,tactic:'balanced'};
  h.control.onPost=async()=>{throw Error('response lost');};
  await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:payload}));
  const [firstKey,firstRaw]=fieldRecords(h)[0],firstRecord=JSON.parse(firstRaw);
  h.control.user={id:'player-new',name:'領主B',isAdmin:false};h.control.deviceId='tab-new';
  h.control.onPost=async()=>({ok:true,revision:8,battle:{id:'new-player-result'}});
  h.control.onRefresh=async()=>{h.control.status.revision=8;return{ok:true};};
  const result=await h.c.requestField('/field/attack',{method:'POST',data:payload});
  assert.equal(result.battle.id,'new-player-result');assert.equal(h.posts.length,2);assert.notEqual(h.posts[1].options.data.requestId,firstRecord.requestId);assert.equal(h.stored.get(firstKey),firstRaw);
  h.control.user={id:'player-a',name:'領主A',isAdmin:false};h.control.deviceId='tab-restored';
  h.control.onPost=async()=>({ok:true,revision:9,battle:{id:'original-player-result'}});
  h.control.onRefresh=async()=>{h.control.status.revision=9;return{ok:true};};
  assert.equal((await h.c.requestField('/field/attack',{method:'POST',data:payload})).battle.id,'original-player-result');
  assert.equal(h.posts[2].options.data.requestId,firstRecord.requestId);assert.equal(h.posts[2].options.data.deviceId,'tab-restored');assert.equal(fieldRecords(h).length,0);
});

const guildRoute='/guild/treasury/transfer';
const guildPayload={guildId:'guild-a',direction:'deposit',resource:'gold',amount:100};
const guildRecords=h=>[...h.stored.entries()].filter(([key])=>key.startsWith('sengoku-guild-transfer-pending-v1:'));

test('guild transfer flushes, sends the writer revision, and waits for the authoritative balance',async()=>{
  const h=setup(),response=deferred(),refresh=deferred(),before=h.c.game.state.resources.gold;
  h.control.onPost=()=>response.promise;h.control.onRefresh=()=>refresh.promise;
  const task=h.c.requestField(guildRoute,{method:'POST',data:{...guildPayload,deviceId:'forged',expectedRevision:999}});
  await until(()=>h.posts.length===1);
  assert.equal(h.posts[0].options.data.deviceId,'tab-a');assert.equal(h.posts[0].options.data.expectedRevision,7);
  assert.equal(h.c.game.state.resources.gold,before,'The client must not debit optimistically');assert.equal(h.c.canMutate(),false);
  await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-b',troops:700}}));
  response.resolve({ok:true,receipt:{id:'vault-1'},revision:8});await until(()=>h.control.refreshes===1);
  assert.equal(guildRecords(h).length,1);assert.equal(h.c.canMutate(),false);
  h.c.game.state.resources.gold=before-100;h.control.status.revision=8;refresh.resolve({ok:true});
  assert.equal((await task).receipt.id,'vault-1');assert.equal(h.c.game.state.resources.gold,before-100);
  assert.equal(guildRecords(h).length,0);assert.equal(h.c.fieldActionPending,false);
});

test('a guild response lost overnight reuses its receipt even with a new UI request ID',async()=>{
  const h=setup(),receipts=new Map();let executions=0,key;
  h.control.onPost=async call=>{key=call.options.data.requestId;receipts.set(key,{ok:true,receipt:{id:key}});executions++;throw Error('response lost');};
  await assert.rejects(h.c.requestField(guildRoute,{method:'POST',data:{...guildPayload,requestId:'original'}}),/response lost/);
  const [storedKey,raw]=guildRecords(h)[0];h.stored.set(storedKey,JSON.stringify({...JSON.parse(raw),createdAt:Date.now()-86400000}));
  const reopened=setup({stored:h.stored});reopened.control.status.revision=22;
  reopened.control.onPost=async call=>{const receipt=receipts.get(call.options.data.requestId);if(receipt)return receipt;executions++;return{ok:true,receipt:{id:'duplicate'}};};
  const result=await reopened.c.requestField(guildRoute,{method:'POST',data:{...guildPayload,requestId:'new-ui-id',expectedRevision:0}});
  assert.equal(result.receipt.id,key);assert.equal(executions,1);assert.equal(reopened.posts[0].options.data.expectedRevision,22);
  assert.equal(guildRecords(reopened).length,0);
});

test('different uncertain guild operations keep separate retry records',async()=>{
  const h=setup();h.control.onPost=async()=>{throw Error('response lost');};
  await assert.rejects(h.c.requestField(guildRoute,{method:'POST',data:guildPayload}));
  await assert.rejects(h.c.requestField(guildRoute,{method:'POST',data:{...guildPayload,resource:'rice',amount:200}}));
  assert.equal(guildRecords(h).length,2);const firstId=h.posts[0].options.data.requestId;
  h.control.onPost=async()=>({ok:true,receipt:{id:firstId}});
  await h.c.requestField(guildRoute,{method:'POST',data:guildPayload});
  assert.equal(h.posts[2].options.data.requestId,firstId);assert.equal(guildRecords(h).length,1);
  assert.equal(JSON.parse(guildRecords(h)[0][1]).signature.includes('rice'),true);
});

test('guild membership changes while waiting for the clock or flush prevent the old transfer',async()=>{
  for(const phase of ['clock','flush']){
    const h=setup(),gate=deferred();if(phase==='clock')h.control.onClockRefresh=()=>gate.promise;else h.control.onFlush=()=>gate.promise;
    const task=h.c.requestField(guildRoute,{method:'POST',data:guildPayload});
    await until(()=>phase==='clock'?h.trace.includes('clock-refresh'):h.control.flushes===1);
    h.control.user.guildId='guild-new';gate.resolve({ok:true});await assert.rejects(task,/所属する同盟/);
    assert.equal(h.posts.length,0);assert.equal(guildRecords(h).length,0);assert.equal(h.c.fieldActionPending,false);
  }
});

test('a changed guild after the server commits reconciles the player without delivering old private data',async()=>{
  const h=setup(),response=deferred();h.control.onPost=()=>response.promise;
  const task=h.c.requestField(guildRoute,{method:'POST',data:guildPayload});await until(()=>h.posts.length===1);
  h.control.user.guildId='guild-new';response.resolve({ok:true,receipt:{id:'old-guild'},treasury:{gold:900}});
  await assert.rejects(task,/所属する同盟/);assert(h.control.refreshes>=1);assert.equal(h.c.fieldActionPending,false);
});

test('an older in-flight sync poll cannot complete a newer guild operation',async()=>{
  const h=setup();h.control.onPost=async()=>({ok:true,revision:10,receipt:{id:'current'}});
  h.control.onRefresh=async()=>{if(h.control.refreshes===2)h.control.status.revision=10;return{ok:true};};
  await h.c.requestField(guildRoute,{method:'POST',data:guildPayload});
  assert.equal(h.control.refreshes,2);assert.equal(guildRecords(h).length,0);
});

test('a failed guild reconciliation retains the retry key and never reports success',async()=>{
  const h=setup();h.control.onPost=async()=>({ok:true,revision:10,receipt:{id:'committed'}});h.control.onRefresh=async()=>({ok:false});
  await assert.rejects(h.c.requestField(guildRoute,{method:'POST',data:guildPayload}),e=>e.code==='GUILD_RECONCILE_PENDING');
  assert.equal(guildRecords(h).length,1);assert.equal(h.c.fieldActionPending,false);
});

test('guild gateway rejects reads, nested routes and stale membership before a mutation',async()=>{
  const h=setup();
  for(const [route,method,payload]of[[guildRoute,'GET',guildPayload],[guildRoute+'/other','POST',guildPayload],['/guild/members/role','POST',guildPayload],[guildRoute,'POST',{...guildPayload,guildId:'other'}],[guildRoute,'POST',{}]]){
    await assert.rejects(h.c.requestField(route,{method,data:payload}));
  }
  assert.equal(h.posts.length,0);assert.equal(h.control.flushes,0);assert.equal(guildRecords(h).length,0);
});

const expansionCases=[
 ['/progress/claim',{key:'d:20000:build'}],
 ['/progress/exchange',{officerId:'officer-1',rank:'SS'}],
 ['/alliance/rally/join',{operationId:'operation-1',troops:500}],
 ['/alliance/rally/launch',{operationId:'operation-1'}],
 ['/alliance/reinforcements/send',{targetPlayerId:'player-b',castleId:'nagoya',troops:500,hours:6}],
 ['/alliance/units/claim',{unitId:'unit-1'}],
 ['/alliance/treasury/claim',{withdrawalId:'withdrawal-1'}]
];
const expansionRecords=h=>[...h.stored.entries()].filter(([key])=>key.startsWith('sengoku-expansion-pending-v1:'));
for(const [route,payload]of expansionCases){
 test(route+' freezes local play, flushes current writer fields, then reconciles before success',async()=>{
  const h=setup(),flush=deferred(),response=deferred(),refresh=deferred(),before=JSON.stringify(h.c.game.state);
  h.control.onFlush=()=>flush.promise;h.control.onPost=()=>response.promise;h.control.onRefresh=()=>refresh.promise;
  const task=h.c.requestExpansion(route,{method:'POST',data:{...payload,requestId:'intent-original',deviceId:'spoof',expectedRevision:999}});
  await until(()=>h.control.flushes===1);assert.deepEqual(h.trace.slice(0,3),['clock-refresh','save','flush']);assert.equal(h.posts.length,0);assert.equal(h.c.canMutate(),false);assert.equal(h.c.save(),false);assert.equal(h.c.applyDurableGift({gold:50},'during-expansion').ok,false);assert.equal(JSON.stringify(h.c.game.state),before);
  h.control.status.revision=19;flush.resolve({ok:true});await until(()=>h.posts.length===1);
  const sent=h.posts[0];assert.equal(sent.route,route);assert.equal(sent.options.data.deviceId,'tab-a');assert.equal(sent.options.data.expectedRevision,19);assert.equal(sent.options.data.requestId,'intent-original');for(const[k,v]of Object.entries(payload))assert.deepEqual(sent.options.data[k],v);
  assert.equal(expansionRecords(h).length,1);assert.equal(JSON.parse(expansionRecords(h)[0][1]).requestId,'intent-original');await assert.rejects(h.c.requestExpansion(route,{method:'POST',data:payload}));assert.equal(h.posts.length,1);
  response.resolve({ok:true,revision:20,receipt:{id:'committed-expansion'}});await until(()=>h.control.refreshes===1);assert.equal(h.c.canMutate(),false);assert.equal(expansionRecords(h).length,1);assert.equal(JSON.parse(expansionRecords(h)[0][1]).committed,true);
  const authoritative=JSON.parse(h.c.game.exportSave());authoritative.state.resources.gold-=20;h.c.game=SengokuEngine.fromSave(authoritative,roster);h.stored.set('save',h.c.game.exportSave());h.control.status.revision=20;refresh.resolve({ok:true});
  const result=await task;assert.equal(result.receipt.id,'committed-expansion');assert.equal(h.c.game.state.resources.gold,authoritative.state.resources.gold);assert.equal(h.c.fieldActionPending,false);assert.equal(h.c.canMutate(),true);assert.equal(expansionRecords(h).length,0);
 });
 test(route+' retains the exact receipt ID and semantic payload across response loss and reload',async()=>{
  const h=setup(),receipts=new Map();let executions=0;
  h.control.onPost=async call=>{const id=call.options.data.requestId;executions++;receipts.set(id,{ok:true,revision:8,receipt:{id}});throw Error('expansion response lost');};
  await assert.rejects(h.c.requestExpansion(route,{method:'POST',data:{...payload,requestId:'first-intent'}}),/response lost/);assert.equal(expansionRecords(h).length,1);assert.equal(h.c.fieldActionPending,false);assert.equal(h.control.refreshes,1);
  const reopened=setup({stored:h.stored});reopened.control.status.revision=21;reopened.control.onPost=async call=>{if(receipts.has(call.options.data.requestId))return receipts.get(call.options.data.requestId);executions++;return{ok:true,revision:21,receipt:{id:'duplicate'}};};
  const result=await reopened.c.requestExpansion(route,{method:'POST',data:{...payload,requestId:'new-button-id',expectedRevision:0,deviceId:'foreign'}});assert.equal(result.receipt.id,'first-intent');assert.equal(reopened.posts[0].options.data.requestId,'first-intent');assert.equal(reopened.posts[0].options.data.expectedRevision,21);assert.equal(reopened.posts[0].options.data.deviceId,'tab-a');assert.equal(executions,1);assert.equal(expansionRecords(reopened).length,0);
 });
}
test('expansion reads bypass the writer flow and a changed account cannot finish another owner claim',async()=>{
 const h=setup();await h.c.requestExpansion('/progress');assert.equal(h.gets[0].route,'/progress');assert.equal(h.control.flushes,0);
 const flush=deferred();h.control.onFlush=()=>flush.promise;const task=h.c.requestExpansion('/progress/claim',{method:'POST',data:{key:'d:20000:build'}});await until(()=>h.control.flushes===1);h.control.user={...h.control.user,id:'player-other'};flush.resolve({ok:true});await assert.rejects(task,e=>e.code==='STALE_IDENTITY');assert.equal(h.posts.length,0);assert.equal(expansionRecords(h).length,0);assert.equal(h.c.fieldActionPending,false);
});

(async()=>{
  let passed=0;
  for(const {name,run} of tests){try{await run();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+'\n'+error.stack);process.exitCode=1;}}
  console.log(`${passed}/${tests.length} shared-field / guild bridge async scenarios passed.`);
})();
