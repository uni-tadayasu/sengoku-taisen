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
function setup(options={}) {
  const stored=options.stored||new Map(),trace=[],posts=[],gets=[],events=[],clockAccepts=[];
  let game=new SengokuEngine({officers:roster,seed:17});
  const clock={id:'field-clock',elapsedMs:100000,confirmedElapsedMs:100000,running:true,speed:1,revision:1,calendar:{turn:1,year:1560,month:2,cycle:1,elapsed:40}};
  if(stored.has('save'))game=SengokuEngine.fromSave(stored.get('save'),roster);
  else {game.applyWorldClock(clock);stored.set('save',game.exportSave());}
  const control={user:{id:'player-a',name:'領主A',isAdmin:false},deviceId:'tab-a',status:{linked:true,ready:true,writable:true,revision:7,leaseExpiresAt:new Date(Date.now()+30000).toISOString()},clock,clockReady:true,uuidCalls:0,flushes:0,refreshes:0,queued:0};
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
  context={
    game,roster,SengokuEngine,URLSearchParams,Date,JSON,Math,Promise,
    state:()=>context.game.state,
    syncAccess:{...control.status},saveKey:'save',backupKey:'backups',saveEnabled:true,saveWarning:'',
    worldCatchingUp:false,worldCatchupTimer:null,worldClockStatusKey:'',fieldActionPending:false,
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
  vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','save','backupCurrentSave','applyCloudSave','applyDurableGift','restoreAdminAssets','processWorldClock','requestField'].map(fn).join('\n'),context);
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
  assert.equal(JSON.parse(h.stored.get(pendingKey)).requestId,body.requestId,'Retry key persists before the command is sent');
  await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-c',troops:1000}}));
  assert.equal(h.posts.length,1);assert.equal(h.events.length,saveEvents);assert.equal(h.c.canMutate(),false);
  response.resolve({ok:true,report:{id:'committed'}});await until(()=>h.control.refreshes===1);
  assert.equal(h.c.canMutate(),false,'A successful HTTP response remains locked until save reconciliation');
  h.c.game.applyWorldClock(h.control.clock);refresh.resolve({ok:true});
  const result=await task;
  assert.equal(result.report.id,'committed');assert.equal(h.c.fieldActionPending,false);assert.equal(h.c.canMutate(),true);assert.equal(h.stored.has(pendingKey),false);
});

test('confirmed shared time is reflected before flushing, without applying speculative display time',async()=>{
  const h=setup();
  h.control.clock={...h.control.clock,elapsedMs:180000,confirmedElapsedMs:120000,calendar:{turn:3,year:1560,month:4,cycle:1,elapsed:0}};
  let seen;
  h.control.onFlush=async()=>{seen=JSON.parse(h.stored.get('save'));return{ok:true};};
  await h.c.requestField('/field/me',{method:'POST',data:{}});
  assert.equal(seen.state.worldClock.elapsedMs,120000);assert.equal(seen.state.turn,2);assert.equal(h.posts.length,1);
});

test('a lost response keeps its idempotency key across reload and the retry cannot execute twice',async()=>{
  const h=setup(),receipts=new Map();let executions=0,firstKey;
  const payload={targetId:'player-b',troops:700};
  h.control.onPost=async call=>{const key=call.options.data.requestId;firstKey=key;receipts.set(key,{ok:true,report:{id:'already-committed'}});executions++;throw Error('response lost');};
  await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:payload}),/response lost/);
  assert.equal(h.c.fieldActionPending,false);assert.equal(h.control.refreshes,1);
  assert.equal(JSON.parse(h.stored.get(pendingKey)).requestId,firstKey);
  const reopened=setup({stored:h.stored});reopened.control.status.revision=21;
  reopened.control.onPost=async call=>{const key=call.options.data.requestId;if(receipts.has(key))return receipts.get(key);executions++;return{ok:true,report:{id:'new'}};};
  const result=await reopened.c.requestField('/field/attack',{method:'POST',data:payload});
  assert.equal(result.report.id,'already-committed');assert.equal(reopened.posts[0].options.data.requestId,firstKey);
  assert.equal(reopened.posts[0].options.data.expectedRevision,21);assert.equal(reopened.control.uuidCalls,0);assert.equal(executions,1);assert.equal(reopened.stored.has(pendingKey),false);
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
    assert.equal(h.posts.length,0);assert.equal(h.control.flushes,0);assert.equal(h.stored.has(pendingKey),false);assert.equal(JSON.stringify(h.c.game.state),before);assert.equal(h.c.fieldActionPending,false);
  }
});

test('failed flush and unavailable durable storage abort before the field command',async()=>{
  for(const kind of ['flush','storage']){
    const h=setup();
    if(kind==='flush')h.control.onFlush=async()=>({ok:false});
    else h.control.onFlush=async()=>{h.control.storageError=true;return{ok:true};};
    await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-b',troops:900}}));
    assert.equal(h.posts.length,0);assert.equal(h.c.fieldActionPending,false);assert.equal(h.stored.has(pendingKey),false);
  }
});

test('definitive client errors retire the key while network failures retain it',async()=>{
  const h=setup();h.control.onPost=async()=>{throw Object.assign(Error('not permitted'),{status:403});};
  await assert.rejects(h.c.requestField('/field/attack',{method:'POST',data:{targetId:'player-b',troops:900}}),/not permitted/);
  assert.equal(h.stored.has(pendingKey),false);assert.equal(h.control.refreshes,1);assert.equal(h.c.fieldActionPending,false);
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

(async()=>{
  let passed=0;
  for(const {name,run} of tests){try{await run();passed++;console.log('PASS '+name);}catch(error){console.error('FAIL '+name+'\n'+error.stack);process.exitCode=1;}}
  console.log(`${passed}/${tests.length} shared-field bridge async scenarios passed.`);
})();
