'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {SengokuEngine:E}=require('../engine.js'),rosterScope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),rosterScope);const officers=rosterScope.window.SENGOKU_OFFICERS;
const copy=value=>JSON.parse(JSON.stringify(value)),source=fs.readFileSync(path.join(__dirname,'../cloud-sync.js'),'utf8');
const memory=()=>{const map=new Map();return{getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)};};
const record=(castle,current,at=0)=>({version:1,current,max:E.durabilityMax({castleId:castle,level:1,wall:castle==='kiyosu'?1:2}),updatedElapsedMs:at});
function withoutCondition(save){const value=copy(save);for(const castle of Object.values(value.state.castles))delete castle.durability;return value.state;}
async function harness(){
 let game=new E({officers,seed:17}),stored,revision=1,writer=null,timer=0;game.state.worldClock={id:'durability-test',elapsedMs:0};game.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};stored=JSON.parse(game.exportSave());
 const time=2000000000000,storage=memory(),applied=[],h={hook:null,server:copy(stored)},scope={console,Date,Math,JSON,Promise,crypto:crypto.webcrypto,SengokuEngine:E,localStorage:memory(),sessionStorage:memory(),navigator:{onLine:true,userAgent:'test'},document:{hidden:false,addEventListener(){}},addEventListener(){},setTimeout:()=>++timer,clearTimeout(){}};scope.window=scope;vm.runInNewContext(source,scope);
 const bridge={hasStarted:()=>true,getState:()=>game.state,getSave:()=>JSON.parse(game.exportSave()),getStoredSave:()=>copy(stored),getRoleAccess:()=>({isAdmin:false,isStaff:false,pending:false}),setRoleAccess(){},setSyncAccess(){},applyCloudSave(save,meta){applied.push(copy(meta));game=E.fromSave(save,officers);stored=copy(save);return{ok:true};},beginUpkeepSync(){const current=game,finish=game.beginUpkeepTracking();return()=>({...finish(),current:current===game});}};
 const sync=scope.SengokuCloudSync.create({device:{id:'test',name:'test'},bridge:()=>bridge,storage,now:()=>time,hidden:()=>false,online:()=>true,setTimeout:()=>++timer,clearTimeout(){}});
 const snapshot=()=>({ok:true,user:{id:'player',isAdmin:false,isStaff:false},save:copy(h.server),revision,serverTime:new Date(time).toISOString(),writerDeviceId:writer,leaseExpiresAt:new Date(time+30000).toISOString(),writable:writer===sync.getDevice().id});
 await sync.start({id:'player',onUser(){},request:async(route,options={})=>{
  if(route==='/presence')return{ok:true};if(route.startsWith('/sync?'))return snapshot();if(route==='/sync/lease'){writer=options.data.deviceId;return snapshot();}if(route==='/sync/release'){writer=null;return snapshot();}
  if(route==='/sync'&&options.method==='PUT'){assert.equal(options.data.revision,revision);h.server=copy(options.data.save);revision++;const result=snapshot();if(h.hook)await h.hook(result);h.server=copy(result.save);return result;}throw Error('Unexpected local route '+route);
 }});
 return Object.assign(h,{sync,storage,applied,get game(){return game;},read:()=>JSON.parse(game.exportSave()),mutate(fn){fn(game);stored=JSON.parse(game.exportSave());sync.notifySave();}});
}
let checks=0;async function scope(name,run){const h=await harness();try{await run(h);checks++;console.log('PASS '+name);}finally{h.sync.stop();}}
(async()=>{
 await scope('a delayed canonical correction preserves newer resource, construction, army and random-state actions',async h=>{
  h.mutate(g=>{g.state.resources.gold++;});let expected;
  h.hook=result=>{result.save.state.castles.kiyosu.durability=record('kiyosu',3000);h.mutate(g=>{g.state.resources.rice+=17;assert(g.upgrade('farm').ok);g.state.army.reverse();g.state.castles.kiyosu.troops-=13;g.random();});expected=withoutCondition(h.read());};
  const flushed=await h.sync.flush();assert(flushed.ok,JSON.stringify({flushed,status:h.sync.getStatus()}));assert.deepEqual(withoutCondition(h.read()),expected);assert.deepEqual(h.read().state.castles.kiyosu.durability,record('kiyosu',3000));assert(h.applied.some(row=>row.reason==='durability-canonical'));assert.deepEqual(JSON.parse(h.storage.getItem('sengoku-sync-pending-v1')).snapshot.state,h.read().state);
  h.hook=null;assert((await h.sync.flush()).ok);assert.deepEqual(h.server.state,h.read().state);assert.equal(h.storage.getItem('sengoku-sync-pending-v1'),null);
 });
 await scope('a later local hit is retained and overlapping CPU damage is never subtracted twice',async h=>{
  for(const [local,at,expected]of [[1000,30000,1000],[3000,0,3000],[6000,30000,3000]]){
   h.mutate(g=>{delete g.state.castles.kiyosu.durability;g.state.worldClock.elapsedMs=0;g.state.turn=0;g.state.realtime.elapsed=0;g.state.resources.gold++;});
   h.hook=result=>{result.save.state.castles.kiyosu.durability=record('kiyosu',3000);h.mutate(g=>{g.state.castles.kiyosu.durability=record('kiyosu',local,at);g.state.worldClock.elapsedMs=at;g.state.realtime.elapsed=at/1000;g.state.resources.wood+=7;});};
   assert((await h.sync.flush()).ok);const state=h.read().state,view=E.durabilityView(state.castles.kiyosu.durability,{castleId:'kiyosu',level:1,wall:1,elapsedMs:at});assert.equal(view.current,expected);assert.equal(state.worldClock.elapsedMs,at);
   h.hook=null;await h.sync.flush();
  }
 });
 await scope('an old acknowledgement cannot transfer condition into another campaign, world, cycle or owner',async h=>{
  for(const kind of ['campaign','clock','cycle','owner']){
   const before=h.read();h.mutate(g=>{g.state.resources.gold++;});let latest;
   h.hook=result=>{result.save.state.castles.inuyama.durability=record('inuyama',1000);h.mutate(g=>{if(kind==='campaign')g.state.walking.campaignId+='-new';if(kind==='clock')g.state.worldClock.id+='-new';if(kind==='cycle'){g.state.cycle.index++;g.state.turn+=672;g.state.worldClock.elapsedMs+=672*60000;}if(kind==='owner')g.state.castles.inuyama.owner=g.state.clan;g.state.resources.stone++;});latest=h.read();};
   assert((await h.sync.flush()).ok);assert.deepEqual(h.read().state,latest.state);h.hook=null;await h.sync.flush();
  }
 });
 await scope('joining retainers during a save preserves canonical damage and later paid repair at the larger maximum',async h=>{
  const id='kiyosu',condition=(current,max,at=0)=>({version:1,current,max,updatedElapsedMs:at});
  h.mutate(g=>{g.state.retainerSupport={castleId:id,count:1};g.state.castles[id].durability=condition(4500,15000);g.state.resources.gold++;});
  h.hook=result=>{
   result.save.state.castles[id].durability=condition(2500,15000);
   h.mutate(g=>{
    g.state.retainerSupport.count=2;
    const atAdmission=g.castle(id).durability;assert.equal(atAdmission.current,9500);
    g.state.castles[id].durability=condition(atAdmission.current,atAdmission.max);
    g._advanceRealtime(60);g.state.worldClock.elapsedMs=60000;
   });
  };
  assert((await h.sync.flush()).ok);
  const state=h.read().state,view=state.castles[id].durability;
  assert.equal(state.retainerSupport.count,2);assert.equal(view.max,20000);
  assert.equal(view.current,9500);assert.equal(state.repair.recovered.castles[id],2000);
 });
 await scope('a restored branch repair completes at full durability during a delayed response',async h=>{
  h.mutate(g=>{g.state.castles.nijo.owner=g.state.clan;g.state.resources.gold++;});
  h.hook=result=>{result.save.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:true,durability:{version:1,current:0,max:6500,updatedElapsedMs:0}}];result.save.state.jobs=[{kind:'branch',id:'nijo_north',repair:true,targetLevel:2,total:1,totalSeconds:60,remaining:1,remainingSeconds:60,completesElapsedMs:60000}];h.mutate(g=>{g.state.worldClock.elapsedMs=90000;g.state.turn=1;g.state.realtime.elapsed=30;g.state.resources.gold+=9;});};
  assert((await h.sync.flush()).ok);const state=h.read().state,branch=state.branches[0];assert(branch&&!branch.fallen);assert.equal(branch.durability,undefined);assert.equal(state.jobs.length,0);assert.equal(E.durabilityView(branch.durability,{castleId:'nijo',level:2,branch:true,elapsedMs:90000}).current,6500);
 });
 await scope('condition reconciliation also preserves ordinary actions when a troop upkeep correction shares the reply',async h=>{
  const original=h.read().state.troops;h.mutate(g=>{g.state.resources.gold++;});let gold;
  h.hook=result=>{const state=result.save.state,before={army:state.troops,castles:Object.fromEntries(Object.entries(state.castles).filter(([,castle])=>castle.owner===state.clan).map(([id,castle])=>[id,castle.troops])),branches:{}};state.troops-=10;result.upkeepAdjustment={version:1,committedRevision:result.revision,removed:10,before,after:{...copy(before),army:state.troops},allocations:[{kind:'army',id:'army',removed:10}]};state.castles.kiyosu.durability=record('kiyosu',2000);h.mutate(g=>{g.state.resources.gold+=11;});gold=h.read().state.resources.gold;};
  assert((await h.sync.flush()).ok);assert.equal(h.read().state.troops,original-10);assert.equal(h.read().state.resources.gold,gold);assert.equal(h.read().state.castles.kiyosu.durability.current,2000);
 });
 await scope('a paid recovery after sending survives a delayed castle damage correction',async h=>{
  h.mutate(g=>{g.state.castles.kiyosu.durability=record('kiyosu',6000);g.state.resources.gold++;});let expected;
  h.hook=result=>{result.save.state.castles.kiyosu.durability=record('kiyosu',3000);h.mutate(g=>{g._advanceRealtime(60);g.state.worldClock.elapsedMs=60000;});expected=copy(h.read().state.resources);};
  assert((await h.sync.flush()).ok);const state=h.read().state;assert.equal(state.castles.kiyosu.durability.current,4000);assert.deepEqual(state.resources,expected);assert.equal(state.repair.recovered.castles.kiyosu,1000);assert.equal(state.repair.spent.wood,50);
  h.hook=null;assert((await h.sync.flush()).ok);
 });
 await scope('a paid branch recovery does not block or vanish under a delayed damage correction',async h=>{
  h.mutate(g=>{g.state.castles.nijo.owner=g.state.clan;g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,durability:{version:1,current:2000,max:5000,updatedElapsedMs:0}}];g.state.resources.gold++;});let expected;
  h.hook=result=>{result.save.state.branches[0].durability.current=1000;h.mutate(g=>{g._advanceRealtime(60);g.state.worldClock.elapsedMs=60000;});expected=copy(h.read().state.resources);};
  assert((await h.sync.flush()).ok);const state=h.read().state;assert.equal(state.branches[0].durability.current,1500);assert.deepEqual(state.resources,expected);assert.equal(state.repair.recovered.branches.nijo_north,500);
 });
 await scope('a material adjustment is applied once while a newer construction and income are preserved',async h=>{
  h.mutate(g=>{g.state.turn=1;g.state.worldClock.elapsedMs=60000;g.state.castles.kiyosu.durability=record('kiyosu',5000);g.state.resources.gold++;});let expected;
  h.hook=result=>{const before=copy(result.save.state.repair),after={version:1,settledTurn:1,spent:{wood:50,stone:40},credit:{wood:0,stone:0},recovered:{castles:{kiyosu:1000},branches:{}}};result.save.state.repair=after;result.save.state.resources.wood-=50;result.save.state.resources.stone-=40;result.save.state.castles.kiyosu.durability=record('kiyosu',6000,60000);result.repairAdjustment={version:1,committedRevision:result.revision,before,after:copy(after),resources:{wood:-50,stone:-40}};h.mutate(g=>{assert(g.upgrade('farm').ok);g.state.resources.wood+=7;});expected=copy(h.read().state.resources);expected.wood-=50;expected.stone-=40;};
  assert((await h.sync.flush()).ok);assert.deepEqual(h.read().state.resources,expected);assert(h.read().state.jobs.some(job=>job.id==='farm'));assert.equal(h.read().state.repair.spent.wood,50);assert(h.applied.some(meta=>meta.reason==='repair-canonical'));
  h.hook=null;assert((await h.sync.flush()).ok);assert.deepEqual(h.read().state.resources,expected);
 });
 await scope('fractional prepaid credits remain tied to the recovered HP across a corrected receipt',async h=>{
  h.mutate(g=>{g.state.turn=1;g.state.worldClock.elapsedMs=60000;g.state.repair={version:1,settledTurn:1,spent:{wood:1,stone:1},credit:{wood:95,stone:96},recovered:{castles:{kiyosu:1},branches:{}}};g.state.castles.kiyosu.durability=record('kiyosu',9999,60000);g.state.resources.gold++;});let expected;
  h.hook=result=>{const before=copy(result.save.state.repair),after=E.normalizeRepairState(undefined,1);result.save.state.repair=copy(after);result.save.state.resources.wood++;result.save.state.resources.stone++;result.save.state.castles.kiyosu.durability=record('kiyosu',9998,60000);result.repairAdjustment={version:1,committedRevision:result.revision,before,after:copy(after),resources:{wood:1,stone:1}};h.mutate(g=>{g._advanceRealtime(60);g.state.worldClock.elapsedMs=120000;});expected=copy(h.read().state.resources);};
  assert((await h.sync.flush()).ok);const state=h.read().state;assert.deepEqual(state.resources,expected,'the same prepaid material now funds the later HP; no second refund');assert.equal(state.repair.recovered.castles.kiyosu,1);assert.equal(state.repair.spent.wood,1);assert.equal(state.repair.credit.wood,95);assert.equal(state.castles.kiyosu.durability.current,9999);
 });
 await scope('a paid recovery followed by a separate local hit preserves a runtime backup when damage histories are ambiguous',async h=>{
  h.mutate(g=>{g.state.castles.kiyosu.durability=record('kiyosu',6000);g.state.resources.gold++;});let canonical;
  h.hook=result=>{result.save.state.castles.kiyosu.durability=record('kiyosu',3000);canonical=copy(result.save.state);h.mutate(g=>{
   g._advanceRealtime(60);g.state.worldClock.elapsedMs=60000;assert.equal(g.state.repair.recovered.castles.kiyosu,1000);
   const hit=g._damageCastleDurability('kiyosu',{won:false,ratio:0});assert.equal(hit.damage,1000);assert.equal(g.state.castles.kiyosu.durability.current,6000);
  });};
  assert((await h.sync.flush()).ok);const state=h.read().state;
  assert.equal(state.castles.kiyosu.durability.current,3000,'An ambiguous late hit must not be silently lost by adding recovery and choosing the smaller HP');
  assert.deepEqual(state.repair,canonical.repair);assert.deepEqual(state.resources,canonical.resources);
  assert(h.applied.some(meta=>meta.backup===true&&meta.backupRuntime===true),'Keep the complete in-flight state before selecting the canonical history');
 });
 await scope('a canonical paid recovery survives a wall completion and keeps the new capacity without charging for lost HP',async h=>{
  h.mutate(g=>{g.state.turn=1;g.state.worldClock.elapsedMs=60000;g.state.castles.kiyosu.durability=record('kiyosu',5000);g.state.jobs=[{kind:'building',id:'wall',targetLevel:2,total:1,totalSeconds:60,remaining:1,remainingSeconds:30}];g.state.resources.gold++;});let expected;
  h.hook=result=>{
   const before=copy(result.save.state.repair),after={version:1,settledTurn:1,spent:{wood:50,stone:40},credit:{wood:0,stone:0},recovered:{castles:{kiyosu:1000},branches:{}}};
   result.save.state.repair=after;result.save.state.resources.wood-=50;result.save.state.resources.stone-=40;result.save.state.castles.kiyosu.durability=record('kiyosu',6000,60000);
   result.repairAdjustment={version:1,committedRevision:result.revision,before,after:copy(after),resources:{wood:-50,stone:-40}};
   h.mutate(g=>{g._advanceRealtime(30);g.state.worldClock.elapsedMs=90000;});expected=copy(h.read().state.resources);expected.wood-=50;expected.stone-=40;
   assert.equal(h.read().state.castles.kiyosu.durability.current,5500);
  };
  assert((await h.sync.flush()).ok);const state=h.read().state,condition=E.durabilityView(state.castles.kiyosu.durability,{castleId:'kiyosu',level:1,wall:2,elapsedMs:90000});
  assert.equal(state.buildings.wall,2);assert.equal(state.castles.kiyosu.wall,2);assert.equal(state.jobs.length,0);
  assert.equal(condition.max,10500);assert.equal(condition.current,6500,'1000 paid HP and the 500 newly built capacity must both remain');
  assert.deepEqual(state.resources,expected);assert.equal(state.repair.recovered.castles.kiyosu,1000);assert.equal(state.repair.spent.wood,50);assert.equal(state.worldClock.elapsedMs,90000);
 });
 await scope('a canonical refund discarded at the asset cap is not revived after an in-flight material expense',async h=>{
  h.mutate(g=>{g.state.turn=1;g.state.worldClock.elapsedMs=60000;g.state.resources.wood=E.ASSET_CAP;g.state.resources.stone=E.ASSET_CAP;g.state.repair={version:1,settledTurn:1,spent:{wood:50,stone:40},credit:{wood:0,stone:0},recovered:{castles:{kiyosu:1000},branches:{}}};g.state.castles.kiyosu.durability=record('kiyosu',6000,60000);g.state.resources.gold++;});let expected;
  h.hook=result=>{const before=copy(result.save.state.repair),after=E.normalizeRepairState(undefined,1);result.save.state.repair=after;result.save.state.castles.kiyosu.durability=record('kiyosu',5000,60000);
   result.repairAdjustment={version:1,committedRevision:result.revision,before,after:copy(after),resources:{wood:0,stone:0}};
   h.mutate(g=>{g.state.resources.wood-=100;g.state.resources.stone-=100;});expected=copy(h.read().state.resources);
  };
  assert((await h.sync.flush()).ok);assert.deepEqual(h.read().state.resources,expected);assert.equal(h.read().state.resources.wood,99999900);assert.equal(h.read().state.resources.stone,99999900);
  assert.deepEqual(h.read().state.repair.spent,{wood:0,stone:0});
  h.hook=null;assert((await h.sync.flush()).ok);assert.deepEqual(h.read().state.resources,expected);
 });
 await scope('an overlapping settlement of the same month keeps a backup and never adds the same paid HP twice',async h=>{
  h.mutate(g=>{g.state.turn=1;g.state.worldClock.elapsedMs=60000;g.state.castles.kiyosu.durability=record('kiyosu',5000);g.state.resources.gold++;});let canonical;
  h.hook=result=>{
   const before=copy(result.save.state.repair),after={version:1,settledTurn:1,spent:{wood:50,stone:40},credit:{wood:0,stone:0},recovered:{castles:{kiyosu:1000},branches:{}}};
   result.save.state.repair=after;result.save.state.resources.wood-=50;result.save.state.resources.stone-=40;result.save.state.castles.kiyosu.durability=record('kiyosu',6000,60000);
   result.repairAdjustment={version:1,committedRevision:result.revision,before,after:copy(after),resources:{wood:-50,stone:-40}};canonical=copy(result.save.state);
   h.mutate(g=>{const repair=g.settleMonthlyRepairs();assert.equal(repair.repairedHP,1000);assert.deepEqual(repair.cost,{gold:0,rice:0,wood:50,stone:40});});
  };
  assert((await h.sync.flush()).ok);const state=h.read().state;
  assert.equal(state.repair.recovered.castles.kiyosu,1000);assert.deepEqual(state.repair.spent,{wood:50,stone:40});assert.equal(state.castles.kiyosu.durability.current,6000);
  assert.deepEqual(state.resources,canonical.resources);assert(h.applied.some(meta=>meta.backup===true&&meta.backupRuntime===true));
 });
 await scope('a canonical branch capacity increase preserves the repair paid while its reply was in flight',async h=>{
  h.mutate(g=>{g.state.castles.nijo.owner=g.state.clan;g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,durability:{version:1,current:2000,max:5000,updatedElapsedMs:0}}];g.state.resources.gold++;});let expected;
  h.hook=result=>{
   const branch=result.save.state.branches[0];branch.level=2;branch.durability={version:1,current:3500,max:6500,updatedElapsedMs:0};
   h.mutate(g=>{g._advanceRealtime(60);g.state.worldClock.elapsedMs=60000;});expected=copy(h.read().state.resources);
   assert.equal(h.read().state.repair.recovered.branches.nijo_north,500);assert.equal(h.game.branch('nijo_north').durability.current,2500);
  };
  assert((await h.sync.flush()).ok);const state=h.read().state,branch=state.branches.find(row=>row.id==='nijo_north'),condition=E.durabilityView(branch.durability,{castleId:'nijo',level:branch.level,branch:true,elapsedMs:state.worldClock.elapsedMs});
  assert.equal(branch.level,2);assert.equal(condition.max,6500);assert.equal(condition.current,4000,'The capacity increase preserves absolute damage and the later 500 paid HP');
  assert.deepEqual(state.resources,expected);assert.equal(state.repair.recovered.branches.nijo_north,500);assert.deepEqual(state.repair.spent,{wood:25,stone:20});
  assert(!h.applied.some(meta=>meta.backup===true&&meta.backupRuntime===true));
 });
 await scope('a paid recovery on a branch removed by canonical ownership loss keeps a backup and cannot leave an orphaned charge',async h=>{
  h.mutate(g=>{g.state.castles.nijo.owner=g.state.clan;g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,durability:{version:1,current:2000,max:5000,updatedElapsedMs:0}}];g.state.resources.gold++;});let canonical;
  h.hook=result=>{
   result.save.state.castles.nijo.owner='在地衆';result.save.state.castles.nijo.durability=record('nijo',5125,30000);result.save.state.branches=[];canonical=copy(result.save.state);
   h.mutate(g=>{g._cpuTurn=()=>[];g._advanceRealtime(60);g.state.worldClock.elapsedMs=60000;});
   assert.equal(h.read().state.repair.recovered.branches.nijo_north,500);assert.deepEqual(h.read().state.repair.spent,{wood:25,stone:20});
  };
  assert((await h.sync.flush()).ok);const state=h.read().state;
  assert.equal(state.castles.nijo.owner,'在地衆');assert.deepEqual(state.branches,[]);
  assert.deepEqual(state.repair,canonical.repair);assert.deepEqual(state.resources,canonical.resources);
  assert.equal(state.repair.recovered.branches.nijo_north,undefined);
  assert(h.applied.some(meta=>meta.backup===true&&meta.backupRuntime===true),'Keep the in-flight state before replacing a repair whose target is no longer eligible');
 });
 console.log(checks+' canonical durability / real coordinator integration groups passed. No live requests.');
})().catch(error=>{console.error(error);process.exitCode=1;});

