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
  for(const [local,at,expected]of [[1000,30000,1000],[3000,0,3000],[6000,30000,3500]]){
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
 console.log(checks+' canonical durability / real coordinator integration groups passed. No live requests.');
})().catch(error=>{console.error(error);process.exitCode=1;});
