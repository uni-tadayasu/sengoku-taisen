/* Actual engine + actual coordinator, with deterministic held PUT responses. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {SengokuEngine:E}=require('../engine.js'),rosterScope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),rosterScope);
const officers=JSON.parse(JSON.stringify(rosterScope.window.SENGOKU_OFFICERS)),copy=value=>JSON.parse(JSON.stringify(value));
const memory=()=>{const data=new Map();return{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
const context={console,Date,JSON,Math,URL,URLSearchParams,crypto:crypto.webcrypto,SengokuEngine:E,localStorage:memory(),sessionStorage:memory(),navigator:{onLine:true},document:{hidden:false,addEventListener(){}},addEventListener(){},setTimeout,clearTimeout};
context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../cloud-sync.js'),'utf8'),context);
const app=fs.readFileSync(require.resolve('../app.js'),'utf8'),start=app.indexOf('  function beginUpkeepSync('),end=app.indexOf('\n  function ',start+1),bridgeTracking=app.slice(start,end);
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function fixture(options={}){
 const g=new E({officers,seed:77,...options});g.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};g.state.buildings.barracks=10;
 const farmer=officers.filter(o=>o.skill==='farmer'&&g.canOwnOfficerVariant(o.id,'SSS')).sort((a,b)=>b.politics-a.politics)[0];assert(farmer);g._grantOfficerVariant(farmer.id,'SSS');
 g.state.army=g.state.army.filter(id=>id!==farmer.id);g.state.governors={};return{g,farmer:farmer.id};
}
function staffFixture(){
 const f=fixture({clan:'豊臣家'}),p=f.g,buildings=copy(p.state.buildings),home=p.state.home;
 const base={id:'kyoto_gosho',revision:1,castleLevel:1,initial:{castleLevel:1,buildings},buildings,jobs:[],history:[],createdElapsedMs:0,updatedElapsedMs:0,accessSinceElapsedMs:0,clanSinceElapsedMs:0,personalClan:p.state.clan,personalHome:home,personalCycleHome:home,personalBaseCastle:copy(p.state.castles.kyoto_gosho),personalHomeCastle:copy(p.state.castles[home])};
 return{...f,g:E.fromSave(p.exportSave(),officers,{isStaff:true,staffBase:base}),base,home};
}
async function setup(initial,{base=null,prepare=null}={}){
 const now=2000000000000,device='test-device',applied=[],tracks=[],timers=new Map(),live={game:initial,roleEpoch:0};let timerId=0,hold=null,closed=0;
 const state={save:JSON.parse(initial.exportSave()),revision:1,user:{id:'owner',isAdmin:initial.isAdmin,isStaff:initial.isStaff},base:copy(base),writer:null};
 const snapshot=()=>({ok:true,user:copy(state.user),save:copy(state.save),revision:state.revision,staffBase:copy(state.base),serverTime:new Date(now).toISOString(),leaseExpiresAt:new Date(now+30000).toISOString(),writerDeviceId:state.writer,writable:Boolean(state.writer)});
 const trackingContext={get game(){return live.game;},get roleEpoch(){return live.roleEpoch;}};vm.createContext(trackingContext);vm.runInContext(bridgeTracking,trackingContext);
 const bridge={getSave:()=>JSON.parse(live.game.exportSave()),getState:()=>live.game.state,hasStarted:()=>true,setSyncAccess(){},getRoleAccess:()=>({isAdmin:live.game.isAdmin,isStaff:live.game.isStaff,epoch:live.roleEpoch}),setRoleAccess:role=>{if(live.game.isAdmin!==role.isAdmin||live.game.isStaff!==role.isStaff){live.roleEpoch++;live.game.setRoleAccess(role);}},beginUpkeepSync:()=>{const finish=trackingContext.beginUpkeepSync();let done=false;return()=>{const result=finish();if(!done){done=true;closed++;tracks.push(result);}return result;};},applyCloudSave:(save,meta)=>{applied.push({save:copy(save),meta:copy(meta)});live.game=E.fromSave(save,officers,{isAdmin:meta.isAdmin,isStaff:meta.isStaff,staffBase:meta.staffBase});return{ok:true};},applyStaffBase:value=>live.game.applyStaffBase(value)};
 async function request(route,opts={}){
  if(route==='/presence'||route==='/sync/release')return{ok:true};
  if(route.startsWith('/sync?'))return snapshot();
  if(route==='/sync/lease'){state.writer=opts.data.deviceId;return snapshot();}
  assert.equal(route,'/sync');assert.equal(opts.method,'PUT');assert.equal(opts.data.revision,state.revision);
  const gate=hold;hold=null;
  if(gate?.failure){await gate.promise;throw Error('network failed');}
  const game=E.fromSave(opts.data.save,officers,{isAdmin:state.user.isAdmin,isStaff:state.user.isStaff,staffBase:state.base});
  prepare?.(game);const before=game.upkeepTroopSnapshot(),balance=game.rebalanceTroopsForUpkeep();
  state.save=JSON.parse(game.exportSave());state.revision++;if(game.isStaff)state.base=game.getStaffBase();
  const result=snapshot();if(balance.changed)result.upkeepAdjustment={version:1,removed:balance.removed,allocations:balance.allocations,before,after:game.upkeepTroopSnapshot(),committedRevision:state.revision};
  if(gate){gate.result=copy(result);gate.balance=copy(balance);gate.committed=game;await gate.promise;}
  return result;
 }
 const sync=context.SengokuCloudSync.create({device:{id:device,name:'test'},bridge:()=>bridge,now:()=>now,hidden:()=>false,online:()=>true,storage:memory(),setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id)});
 await sync.start({id:'owner',request,onUser(){}});assert(sync.getStatus().writable,JSON.stringify(sync.getStatus()));
 return{sync,bridge,state,applied,tracks,get game(){return live.game;},get closed(){return closed;},mutate(fn){const result=fn(live.game);if(result?.ok!==undefined)assert(result.ok,result.message);sync.notifySave();return result;},hold(failure=false){assert(!hold);const gate={failure};gate.promise=new Promise(resolve=>{gate.release=resolve;});hold=gate;return gate;},stop(){sync.stop();}};
}
let checks=0;async function test(name,run){await run();checks++;console.log('PASS '+name);}
(async()=>{
 await test('governor assignment cannot revive server-committed reductions, including ordinary Tokugawa Edo',async()=>{
  for(const clan of [undefined,'徳川家']){const f=fixture({clan}),c=await setup(f.g);c.mutate(g=>g.recruitTroops(6000));const gate=c.hold(),flight=c.sync.flush();await settle();assert(gate.balance.removed>0);const canonical=gate.result.save.state.troops;
   c.mutate(g=>g.assignGovernor('farm',f.farmer));const army=copy(c.game.state.army),edo=c.game.state.castles.edo.troops;gate.release();assert((await flight).ok);
   assert.equal(c.game.state.troops,canonical);assert.equal(c.game.state.governors.farm,f.farmer);assert.deepEqual(c.game.state.army,army);assert.equal(c.game.state.castles.edo.troops,edo);assert(!c.applied.some(row=>row.meta.reason==='upkeep-conflict'));
   assert((await c.sync.flush()).ok);assert.equal(c.state.save.state.troops,canonical);c.stop();
  }
 });
 await test('the same local automatic reduction during PUT is applied once',async()=>{
  const f=fixture(),c=await setup(f.g);c.mutate(g=>g.recruitTroops(6000));const gate=c.hold(),flight=c.sync.flush();await settle();
  c.mutate(g=>g._advanceRealtime(.25));c.mutate(g=>g.assignGovernor('farm',f.farmer));const expected=c.game.state.troops,resources=copy(c.game.state.resources);assert.equal(expected,gate.result.save.state.troops);gate.release();assert((await flight).ok);
  assert.equal(c.game.state.troops,expected);assert.deepEqual(c.game.state.resources,resources);assert.equal(c.tracks.at(-1).records.length,1);assert.equal(c.tracks.at(-1).current,true);assert(!c.applied.some(row=>row.meta.reason==='upkeep-conflict'));c.stop();
 });
 await test('ordinary recruitment, spending, army and governor changes survive a server reduction',async()=>{
  const f=fixture(),c=await setup(f.g);c.mutate(g=>g.recruitTroops(6000));const gate=c.hold(),flight=c.sync.flush();await settle();
  c.mutate(g=>g.assignGovernor('farm',f.farmer));c.mutate(g=>g.recruitTroops(1000));c.mutate(g=>{g.state.army.reverse();});const resources=copy(c.game.state.resources),army=copy(c.game.state.army);gate.release();assert((await flight).ok);
  assert.equal(c.game.state.troops,gate.result.save.state.troops+1000);assert.deepEqual(c.game.state.resources,resources);assert.deepEqual(c.game.state.army,army);assert.equal(c.game.state.governors.farm,f.farmer);assert((await c.sync.flush()).ok);assert.equal(c.state.save.state.troops,gate.result.save.state.troops+1000);c.stop();
 });
 await test('multiple local reductions replay as limits around legitimate recruitment',async()=>{
  const f=fixture(),c=await setup(f.g);c.mutate(g=>g.recruitTroops(6000));const gate=c.hold(),flight=c.sync.flush();await settle();
  c.mutate(g=>g.rebalanceTroopsForUpkeep());c.mutate(g=>g.recruitTroops(1000));c.mutate(g=>g.rebalanceTroopsForUpkeep());c.mutate(g=>g.assignGovernor('farm',f.farmer));c.mutate(g=>g.recruitTroops(100));const expected=c.game.state.troops;gate.release();assert((await flight).ok);assert.equal(c.game.state.troops,expected);assert.equal(c.tracks.at(-1).records.length,2);c.stop();
 });
 await test('branch canonical correction and a concurrent local reduction do not reduce branches twice',async()=>{
  const f=fixture();f.g.state.troops=0;f.g.state.castles[f.g.state.home].troops=0;f.g.state.castles.nijo.owner=f.g.state.clan;f.g.state.castles.nijo.troops=0;f.g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,stationedTroops:20000}];
  const c=await setup(f.g);c.mutate(g=>{g.state.resources.gold++;});const gate=c.hold(),flight=c.sync.flush();await settle();assert(gate.balance.reductions.branches>0);
  c.mutate(g=>g.rebalanceTroopsForUpkeep());c.mutate(g=>g.assignGovernor('farm',f.farmer));const expected=c.game.state.branches[0].stationedTroops;gate.release();assert((await flight).ok);assert.equal(c.game.state.branches[0].stationedTroops,expected);assert.equal(expected,gate.result.save.state.branches[0].stationedTroops);assert(!c.applied.some(row=>row.meta.reason==='upkeep-conflict'));c.stop();
 });
 await test('authoritative pre-reduction pool corrections are distinct from the actual reduction',async()=>{
  const f=fixture(),c=await setup(f.g,{prepare:g=>{if(g.state.troops>9000)g.state.castles[g.state.home].troops+=300;}});c.mutate(g=>g.recruitTroops(6000));const gate=c.hold(),flight=c.sync.flush();await settle();
  c.mutate(g=>g.rebalanceTroopsForUpkeep());c.mutate(g=>g.assignGovernor('farm',f.farmer));gate.release();assert((await flight).ok);assert.equal(c.game.state.troops,gate.result.save.state.troops);assert.equal(c.game.state.castles[c.game.state.home].troops,gate.result.save.state.castles[c.game.state.home].troops);c.stop();
 });
 await test('staff personal-home correction survives reload and demotion while shared Kyoto stays protected',async()=>{
  const f=staffFixture();f.g.state.troops=0;f.g.state.castles[f.home].troops=20000;f.g.state.castles.kyoto_gosho.troops=9000000;const c=await setup(f.g,{base:f.base});c.mutate(g=>{g.state.resources.gold++;});const gate=c.hold(),flight=c.sync.flush();await settle();assert(gate.balance.reductions.home>0);
  c.mutate(g=>g.rebalanceTroopsForUpkeep());c.mutate(g=>g.assignGovernor('farm',f.farmer));const expected=c.game.state.castles[f.home].troops;gate.release();assert((await flight).ok);assert.equal(c.game.state.castles[f.home].troops,expected);assert.equal(c.game.getStaffPersonalProgress().castle.troops,expected);assert.equal(c.game.state.castles.kyoto_gosho.troops,9000000);assert(!c.applied.some(row=>row.meta.reason==='upkeep-conflict'));
  const restored=E.fromSave(c.game.exportSave(),officers,{isStaff:true,staffBase:c.game.getStaffBase()});assert.equal(restored.state.castles[f.home].troops,expected);restored.setRoleAccess({isAdmin:false,isStaff:false});assert.equal(restored.state.castles[f.home].troops,expected);c.stop();
 });
 await test('a role change in the response invalidates the in-flight journal',async()=>{
  const f=fixture(),c=await setup(f.g);c.mutate(g=>g.recruitTroops(6000));c.state.user.isAdmin=true;const gate=c.hold(),flight=c.sync.flush();await settle();c.mutate(g=>g.assignGovernor('farm',f.farmer));gate.release();assert((await flight).ok);assert.equal(c.tracks.at(-1).current,false);assert.equal(c.game.isAdmin,true);assert(c.applied.some(row=>row.meta.reason==='upkeep-conflict'&&row.meta.backupRuntime));assert.equal(c.game.state.troops,gate.result.save.state.troops);c.stop();
 });
 await test('a response without server reduction cannot revive a local staff-home reduction in its backup',async()=>{
  const f=staffFixture();f.g.state.troops=0;f.g.state.castles[f.home].troops=0;
  const capacity=()=>{const income=f.g.income();return Math.min((income.gross.gold-income.facilityUpkeep.gold)*25,Math.floor((income.gross.rice-income.facilityUpkeep.rice)*25/3));};
  const lower=capacity();assert(f.g.assignGovernor('farm',f.farmer).ok);const upper=capacity();assert(upper>lower);const initial=Math.floor((lower+upper)/2);f.g.state.castles[f.home].troops=initial;f.base.personalHomeCastle.troops=initial;
  const c=await setup(f.g,{base:f.base});c.mutate(g=>{g.state.resources.gold++;});const gate=c.hold(),flight=c.sync.flush();await settle();assert.equal(gate.result.upkeepAdjustment,undefined);
  c.mutate(g=>g.assignGovernor('farm',null));c.mutate(g=>g.rebalanceTroopsForUpkeep());const expected=c.game.state.castles[f.home].troops;assert(expected<initial);gate.release();assert((await flight).ok);assert.equal(c.game.getStaffPersonalProgress().castle.troops,expected);assert.equal(JSON.parse(c.game.exportSave()).state.staffService.personalHomeCastle.troops,expected);
  const restored=E.fromSave(c.game.exportSave(),officers,{isStaff:true,staffBase:c.game.getStaffBase()});restored.setRoleAccess({isAdmin:false,isStaff:false});assert.equal(restored.state.castles[f.home].troops,expected);c.stop();
 });
 await test('an impossible transfer source never creates destination soldiers through clamping',async()=>{
  const f=fixture(),c=await setup(f.g);c.mutate(g=>g.recruitTroops(6000));const gate=c.hold(),flight=c.sync.flush();await settle();c.mutate(g=>g.transferTroops('army','castle:'+g.state.home,8000));gate.release();assert((await flight).ok);assert(c.applied.some(row=>row.meta.reason==='upkeep-conflict'&&row.meta.backupRuntime));assert.deepEqual(c.game.upkeepTroopSnapshot(),gate.committed.upkeepTroopSnapshot());c.stop();
 });
 await test('request failure releases tracking and completed windows cannot accumulate more records',async()=>{
  const f=fixture(),c=await setup(f.g);c.mutate(g=>g.recruitTroops(6000));const gate=c.hold(true),flight=c.sync.flush();await settle();c.mutate(g=>g.rebalanceTroopsForUpkeep());const closed=c.closed;gate.release();assert.equal((await flight).ok,false);assert.equal(c.closed,closed+1);const track=c.tracks.at(-1),count=track.records.length;c.game.state.troops+=1000;c.game.rebalanceTroopsForUpkeep();assert.equal(track.records.length,count);c.stop();
 });
 await test('long requests have a bounded nonpersistent journal and recover with a backup',async()=>{
  const f=fixture(),c=await setup(f.g);c.mutate(g=>g.recruitTroops(6000));const gate=c.hold(),flight=c.sync.flush();await settle();for(let i=0;i<130;i++){c.game.state.troops+=1000;c.game.rebalanceTroopsForUpkeep();}c.sync.notifySave();assert(!c.game.exportSave().includes('overflow'));gate.release();assert((await flight).ok);assert.equal(c.tracks.at(-1).overflow,true);assert.equal(c.tracks.at(-1).records.length,0);assert(c.applied.some(row=>row.meta.reason==='upkeep-conflict'&&row.meta.backupRuntime));c.stop();
 });
 console.log(checks+' real-engine cloud upkeep checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
