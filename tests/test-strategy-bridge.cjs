'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine}=require('../engine.js'),source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),rosterContext={window:{}};
vm.createContext(rosterContext);vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),rosterContext);const roster=rosterContext.window.SENGOKU_OFFICERS;
function method(name){let start=source.indexOf('  function '+name+'(');if(start<0)start=source.indexOf('  async function '+name+'(');assert(start>=0,name);const line=source.indexOf('\n',start);if(source.slice(start,line).endsWith('}'))return source.slice(start,line);const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function attachController(h){
  const {createController}=require('../strategy.js'),timers=new Map();let serial=0;
  const controller=createController({bridge:()=>h.c,document:h.c.document,window:h.c.window,now:()=>0,setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
  h.c.window.SengokuStrategy=controller;
  return{controller,timers,fire:async()=>{const [id,fn]=timers.entries().next().value||[];assert.equal(typeof fn,'function','an explicit start schedules one first step');timers.delete(id);fn();for(let i=0;i<12;i++)await drain();}};
}
function setup(){
  const game=new SengokuEngine({officers:roster,clan:'徳川家',startCastle:'okazaki',seed:451});game.state.resources={gold:120000,rice:180000,wood:120000,stone:120000};game.state.buildings.keep=8;game.state.buildings.barracks=8;game.state.troops=18000;game.state.morale=100;game.state.command=4;
  const shared={ready:true,clock:{id:'world-v1',elapsedMs:0,confirmedElapsedMs:0,running:true,speed:1}};game.applyWorldClock(shared.clock);
  const stored=new Map([['save',game.exportSave()]]),events=[],context={game,roster,SengokuEngine,staffBaseId:'kyoto_gosho',user:{id:'fixture_actor',name:'検証領主'},document:{hidden:false},navigator:{onLine:true},shared,
    syncAccess:{linked:true,ready:true,writable:true,reason:'writer',leaseExpiresAt:new Date(Date.now()+60000).toISOString()},startPending:false,saveEnabled:true,saveWarning:'',worldCatchingUp:false,fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,worldSettlementPending:false,roleEpoch:0,strategyEpoch:0,strategyRun:null,staffBaseReady:true,localWalkingContext:null,saveKey:'save',settingsKey:'settings',saveWrites:0,failAt:0,flushes:0,fieldCalls:0,walkingCalls:0,
    state:()=>context.game.state,$:()=>null,Date,JSON,URLSearchParams,Math,performance:{now:()=>0},CustomEvent:class{constructor(type){this.type=type;}},toast:()=>{},renderHeader:()=>{},render:()=>{},refreshLiveControls:()=>{},refreshActiveModal:()=>{},preserveInteraction:(_host,fn)=>fn(),queueWorldProgress:()=>{},processWorldClock:()=>{},staffConstructionReady:()=>context.staffBaseReady,
    localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>{if(key==='save'){context.saveWrites++;if(context.failAt===context.saveWrites)throw Error('local storage full');}stored.set(key,value);},removeItem:key=>stored.delete(key)},
  };
  context.window={crypto:require('node:crypto').webcrypto,dispatchEvent:event=>events.push(event.type),SengokuSocial:{getUser:()=>context.user,fieldRequest:async()=>{context.fieldCalls++;return{ok:true};},walkingRequest:async()=>{context.walkingCalls++;return{ok:true};}},SengokuWorldClock:{snapshot:()=>shared,refresh:async()=>shared},SengokuCloudSync:{flush:async()=>{context.flushes++;return context.flush?context.flush(context.flushes):{ok:true};},getStatus:()=>({...context.syncAccess,revision:1}),getDevice:()=>({id:'fixture_device'})},SengokuStrategy:{refreshAccess:()=>{}}};
  vm.createContext(context);vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','save','getWalkingAccess','retireLocalWalkingContext','localWalkingOperation','requestWalking','requestField','strategyScope','getStrategyAccess','strategyDecisionView','previewStrategy','beginStrategy','stopStrategy','stepStrategy'].map(method).join('\n'),context);
  const begin=()=>{const result=context.beginStrategy('堅実に弱い城を攻める。3回まで。兵1000を残す。');assert.equal(result.ok,true,result.message);return result.runId;};
  return{c:context,stored,events,begin};
}
const tests=[];function test(name,run){tests.push({name,run});}

test('walking, field and strategy use one mutation lock; a second attack cannot overlap a pending flush',async()=>{
  const h=setup(),{c}=h,id=h.begin(),wait=deferred();c.flush=()=>wait.promise;const first=c.stepStrategy(id);await drain();assert.equal(c.strategyActionPending,true);assert.equal(c.getWalkingAccess().canCount,true);assert.equal(c.getWalkingAccess().canClaim,false);
  assert.equal((await c.stepStrategy(id)).waiting,true);assert.equal(c.flushes,1);await assert.rejects(c.requestWalking('/walking/start',{campaignId:c.game.state.walking.campaignId}),e=>e.code==='WALKING_WAIT');await assert.rejects(c.requestField('/field/attack',{method:'POST',data:{targetPlayerId:'target',troops:300,tactic:'balanced'}}));assert.equal(c.fieldCalls,0);assert.equal(c.walkingCalls,0);
  c.stopStrategy(id);wait.resolve({ok:true});const result=await first;assert.equal(result.stop,true);assert.equal(c.game.state.stats.battles,0);assert.equal(c.strategyActionPending,false);
});

test('both an existing walking transaction and one appearing during pre-attack flush leave AI waiting',async()=>{
  for(const during of [false,true]){const {c,begin}=setup(),id=begin(),before=JSON.stringify(c.game.state);if(!during)c.walkingActionPending=true;else c.flush=async()=>{c.walkingActionPending=true;return{ok:true};};const result=await c.stepStrategy(id);assert.equal(result.waiting,true);assert.equal(result.executed,false);assert.equal(JSON.stringify(c.game.state),before);assert.equal(c.strategyRun.active,true);assert.equal(c.strategyActionPending,false);}
});

test('hidden, pause, follower, offline, cycle, role and account changes during await retire the old command',async()=>{
  const changes={hidden:c=>c.document.hidden=true,title:c=>c.window.SENGOKU_AT_TITLE=true,paused:c=>c.shared.clock.running=false,follower:c=>{c.syncAccess.writable=false;c.syncAccess.reason='follower';},offline:c=>c.navigator.onLine=false,cycle:c=>c.game.state.cycle.index++,settlement:c=>c.worldSettlementPending=true,role:c=>c.roleEpoch++,account:c=>c.user={id:'different_actor'},campaign:c=>c.game.state.walking.campaignId='different_campaign',import:c=>c.retireLocalWalkingContext()};
  for(const [name,change]of Object.entries(changes)){const {c,begin}=setup(),id=begin(),wait=deferred();c.flush=()=>wait.promise;const operation=c.stepStrategy(id);await drain();change(c);const changed=JSON.stringify(c.game.state);wait.resolve({ok:true});const result=await operation;assert.equal(result.stop,true,name);assert.equal(c.game.state.stats.battles,0,name);assert.equal(JSON.stringify(c.game.state),changed,name);assert.equal(c.strategyRun.active,false,name);assert.equal(c.strategyActionPending,false,name);}
});

test('clock catchup and own snapshot application are temporary and cannot consume a stale decision',async()=>{
  for(const reason of ['catchup','applying']){const {c,begin}=setup(),id=begin(),before=JSON.stringify(c.game.state);c.flush=async()=>{if(reason==='catchup')c.shared.clock.confirmedElapsedMs=1000;else{c.syncAccess.reason='applying';c.syncAccess.writable=false;}return{ok:true};};const result=await c.stepStrategy(id);assert.equal(result.waiting,true,reason);assert.equal(c.game.state.stats.battles,0,reason);assert.equal(JSON.stringify(c.game.state),before,reason);assert.equal(c.strategyRun.active,true,reason);assert.equal(c.strategyActionPending,false,reason);}
});

test('a local durable-save failure rolls back resources, army, random seed, capture and battle count together',async()=>{
  const {c,stored,begin}=setup(),id=begin(),before=JSON.stringify(c.game.state),oldSave=stored.get('save');c.failAt=2;const result=await c.stepStrategy(id);assert.equal(result.executed,false);assert.equal(result.stop,true);assert.equal(JSON.stringify(c.game.state),before);assert.deepEqual(JSON.parse(stored.get('save')).state,JSON.parse(oldSave).state);assert.equal(c.saveEnabled,false);assert.equal(c.strategyRun.active,false);assert.equal(c.strategyActionPending,false);
});

test('a post-save sync failure preserves the committed battle once and stops all following attacks',async()=>{
  const {c,stored,begin}=setup(),id=begin();c.flush=async count=>({ok:count===1});const result=await c.stepStrategy(id);assert.equal(result.ok,false);assert.equal(result.executed,true);assert.equal(result.confirmed,false);assert.equal(result.pendingSync,true);assert.equal(result.stop,true);assert.equal(c.game.state.stats.battles,1);assert.equal(JSON.parse(stored.get('save')).state.stats.battles,1);assert.equal(c.strategyRun.active,false);const after=JSON.stringify(c.game.state);const retry=await c.stepStrategy(id);assert.equal(retry.stop,true);assert.equal(JSON.stringify(c.game.state),after);assert.equal(c.flushes,2);
});

test('staff without the shared source and clients without a current lease cannot begin a run',async()=>{
  for(const change of [c=>{c.game.setRoleAccess({isStaff:true});c.staffBaseReady=false;},c=>c.syncAccess.leaseExpiresAt=new Date(Date.now()-1000).toISOString(),c=>c.shared.ready=false,c=>c.document.hidden=true,c=>c.worldSettlementPending=true]){const {c}=setup();change(c);const before=JSON.stringify(c.game.state),result=c.beginStrategy('弱い城から攻める');assert.equal(result.ok,false);assert.equal(JSON.stringify(c.game.state),before);assert.equal(c.strategyRun,null);assert.equal(c.flushes,0);}
});

test('a conflict that restores the canonical pre-battle save cannot report a committed victory or retry an attack',async()=>{
  const {c,stored,begin}=setup(),id=begin(),canonical=JSON.parse(JSON.stringify(c.game.state));
  c.flush=async count=>{if(count===1)return{ok:true};c.game.state=JSON.parse(JSON.stringify(canonical));stored.set('save',c.game.exportSave());return{ok:false,conflict:true};};
  const result=await c.stepStrategy(id);assert.equal(result.ok,false);assert.equal(result.stop,true);assert.equal(c.game.state.stats.battles,0);assert.equal(JSON.parse(stored.get('save')).state.stats.battles,0);assert.equal(c.strategyRun.active,false);assert.equal(result.executed,false,'canonical rejected/replaced the battle; it must not be reported as executed');assert.equal(result.battle,undefined,'a discarded battle must not be displayed as a confirmed victory');assert.doesNotMatch(result.message,/この端末に保存しました/);
  const retry=await c.stepStrategy(id);assert.equal(retry.stop,true);assert.equal(c.game.state.stats.battles,0);assert.equal(c.flushes,2);
});

test('a normal snapshot replacement followed by an unchanged successful flush cannot confirm the discarded attack',async()=>{
  const {c,stored,begin}=setup(),clone=value=>JSON.parse(JSON.stringify(value)),preflight=deferred(),refresh=deferred(),requests=[];
  const env={Date,JSON,Math,URL,URLSearchParams,crypto:require('node:crypto').webcrypto,localStorage:c.localStorage,sessionStorage:c.localStorage,navigator:c.navigator,document:c.document,addEventListener(){},setTimeout:()=>1,clearTimeout(){}};env.window=env;vm.createContext(env);vm.runInContext(fs.readFileSync(path.join(__dirname,'../cloud-sync.js'),'utf8'),env);
  const server={save:JSON.parse(c.game.exportSave()),revision:1,writer:null,until:0};let holdPut=false,holdGet=false,putEntered=false,getEntered=false;
  const snapshot=()=>({ok:true,user:{...c.user,isAdmin:false,isStaff:false},save:clone(server.save),revision:server.revision,writerDeviceId:server.writer,leaseExpiresAt:server.until?new Date(server.until).toISOString():null,serverTime:new Date().toISOString(),writable:!!server.writer});
  const bridge={hasStarted:()=>true,getSave:()=>JSON.parse(c.game.exportSave()),setSyncAccess:status=>{c.syncAccess={...status};c.window.SengokuStrategy.refreshAccess();},setRoleAccess:()=>{},getRoleAccess:()=>({isAdmin:false,isStaff:false,epoch:0}),applyCloudSave:save=>{c.game=SengokuEngine.fromSave(JSON.stringify(save),roster);stored.set('save',c.game.exportSave());return{ok:true};}};
  const sync=env.SengokuCloudSync.create({device:{id:'race_fixture',name:'隔離テスト端末'},bridge:()=>bridge,setTimeout:()=>1,clearTimeout:()=>{},storage:c.localStorage});c.window.SengokuCloudSync=sync;c.window.dispatchEvent=event=>{if(event.type==='sengoku:game-saved')sync.notifySave();};
  const request=async(route,options={})=>{requests.push({route,method:options.method||'GET'});if(route==='/presence')return{ok:true};if(route.startsWith('/sync?')){if(holdGet){getEntered=true;await refresh.promise;}return snapshot();}if(route==='/sync/lease'){server.writer=options.data.deviceId;server.until=Date.now()+30000;return snapshot();}if(route==='/sync/release'){server.writer=null;return snapshot();}if(route==='/sync'&&options.method==='PUT'){assert.equal(options.data.revision,server.revision);server.save=clone(options.data.save);server.revision++;const result=snapshot();if(holdPut){putEntered=true;holdPut=false;await preflight.promise;}return result;}throw Error('Unexpected isolated route '+route);};
  try{
    await sync.start({id:c.user.id,request});const id=begin();c.game.state.resources.gold++;holdPut=true;const operation=c.stepStrategy(id);for(let i=0;i<10;i++)await drain();assert.equal(putEntered,true);
    // The real coordinator queues a normal refresh behind preflight. It can
    // receive a newer authoritative save after the local attack was calculated.
    holdGet=true;const polling=sync.refresh();preflight.resolve();for(let i=0;i<10;i++)await drain();assert.equal(getEntered,true);assert.equal(c.game.state.stats.battles,1);
    server.save.state.resources.gold+=37;server.revision++;refresh.resolve();const [result]=await Promise.all([operation,polling]);
    assert.equal(c.game.state.stats.battles,0);assert.equal(server.save.state.stats.battles,0);assert.equal(result.executed,false,'successful flush alone is not proof that this exact attack survived reconciliation');assert.equal(result.stop,true);assert.equal(result.battle,undefined);assert.equal(c.strategyRun.active,false);assert.equal((await c.stepStrategy(id)).stop,true);assert.equal(requests.filter(r=>r.method==='PUT').length,1,'only the preflight snapshot was uploaded');
  }finally{preflight.resolve();refresh.resolve();sync.stop();}
});

test('the actual controller and bridge retain the terminal one-battle victory and its completion reason',async()=>{
  const h=setup(),{controller,timers,fire}=attachController(h);try{
    assert.equal((await controller.start('堅実に弱い城を攻める。1回まで。兵1000を残す。')).ok,true);await fire();const result=controller.getState();
    assert.equal(h.c.game.state.stats.battles,1);assert.equal(result.active,false);assert.equal(result.pending,false);assert.equal(result.phase,'complete');assert.equal(result.history.length,1);assert.equal(result.history[0].won,true);assert.match(result.message,/回数|上限/);assert.doesNotMatch(result.message,/STRATEGY_|defeat/);assert.equal(timers.size,0);assert.equal(h.c.flushes,2);
  }finally{controller.dispose();}
});

test('the actual controller and bridge retain a deterministic loss and stop without a second attack',async()=>{
  const h=setup();let losingSeed=0;for(let seed=1;seed<100000;seed++){let x=seed;x^=x<<13;x^=x>>>17;x^=x<<5;if((x>>>0)/4294967296>.995){losingSeed=seed;break;}}assert(losingSeed);h.c.game.state.seed=losingSeed;
  const {controller,timers,fire}=attachController(h);try{
    assert.equal((await controller.start('堅実に弱い城を攻める。3回まで。兵1000を残す。')).ok,true);await fire();const result=controller.getState();
    assert.equal(h.c.game.state.stats.battles,1);assert.equal(result.active,false);assert.equal(result.pending,false);assert.equal(result.history.length,1);assert.equal(result.history[0].won,false);assert.match(result.message,/敗|撤退/);assert.doesNotMatch(result.message,/STRATEGY_|defeat/);assert.equal(timers.size,0);assert.equal(h.c.flushes,2);
  }finally{controller.dispose();}
});

(async()=>{const selected=process.argv[2]?tests.filter(t=>t.name.includes(process.argv[2])):tests;assert(selected.length,'at least one test matched');for(const {name,run}of selected){await run();console.log('PASS '+name);}console.log(`${selected.length} independent app-bridge interlock and rollback groups passed. No network requests were made.`);})().catch(error=>{console.error(error);process.exitCode=1;});
