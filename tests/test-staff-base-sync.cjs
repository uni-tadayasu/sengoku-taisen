/* Real coordinator and engine, with a deterministic in-memory cloud service. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {SengokuEngine}=require('../engine.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster=scope.window.SENGOKU_OFFICERS,clone=v=>JSON.parse(JSON.stringify(v));
const memory=()=>{const map=new Map();return{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};};
function deferred(){let resolve;return{promise:new Promise(done=>{resolve=done;}),resolve};}
async function until(fn){for(let i=0;i<80;i++){if(fn())return;await Promise.resolve();}assert(fn(),'Expected asynchronous checkpoint');}
function fixture(revision=1){const g=new SengokuEngine({officers:roster,seed:12}),buildings=clone(g.state.buildings);buildings.farm=5;return{id:'kyoto_gosho',revision,castleLevel:1,buildings,initial:{castleLevel:1,buildings:clone(buildings)},history:[],jobs:[],updatedElapsedMs:100000,accessSinceElapsedMs:0,personalClan:'伊達家',protected:true};}
function harness(){
 const time=2000000000000,timers=new Map(),localStorage=memory();let timerId=0,epoch=0,ready=false,game=new SengokuEngine({clan:'伊達家',startCastle:'himeji',officers:roster,seed:14});
 const log=[],applied=[],bases=[],roles=[],server={role:{isAdmin:false,isStaff:true},save:JSON.parse(SengokuEngine.fromSave(game.exportSave(),roster,{isStaff:true}).exportSave()),revision:10,base:fixture(),writer:null,until:0,hook:null};
 const bridge={
  getRoleAccess:()=>({isAdmin:game.isAdmin,isStaff:game.isStaff,epoch}),
  setRoleAccess:role=>{if(role.isAdmin!==game.isAdmin||role.isStaff!==game.isStaff){epoch++;ready=false;}roles.push({...role});return game.setRoleAccess(role);},
  hasStarted:()=>true,getSave:()=>JSON.parse(game.exportSave()),setSyncAccess(){},
  applyCloudSave:(save,meta)=>{applied.push({save:clone(save),meta:clone(meta)});game=SengokuEngine.fromSave(save,roster,meta);ready=Boolean(game.getStaffBase());return{ok:true};},
  applyStaffBase:base=>{bases.push({base:clone(base),gold:game.state.resources.gold});if(!base){ready=false;return{ok:true};}const result=game.applyStaffBase(base);ready=result.ok;return result;}
 };
 const context={window:null,Date,Math,JSON,URL,URLSearchParams,crypto:crypto.webcrypto,localStorage,sessionStorage:memory(),navigator:{onLine:true},document:{hidden:false,addEventListener(){}},addEventListener(){},setTimeout:()=>1,clearTimeout(){},SengokuBridge:bridge};context.window=context;
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../cloud-sync.js'),'utf8'),context);
 function snapshot(device){return{ok:true,user:{id:'staff-a',name:'スタッフA',clan:server.role.isAdmin||server.role.isStaff?'德川家':server.save.state.clan,...server.role},save:clone(server.save),staffBase:clone(server.base),revision:server.revision,serverTime:new Date(time).toISOString(),writerDeviceId:server.writer,writerDeviceName:'test',leaseExpiresAt:server.until?new Date(server.until).toISOString():null,writable:server.writer===device};}
 async function request(route,options={}){
  const method=options.method||'GET',data=options.data||{},device=data.deviceId||new URL('https://test.invalid'+route).searchParams.get('deviceId'),call={route,method,data:clone(data)};log.push(call);let result;
  if(route==='/presence')result={ok:true};
  else if(route.startsWith('/sync?'))result=snapshot(device);
  else if(route==='/sync/lease'){server.writer=device;server.until=time+30000;result=snapshot(device);}
  else if(route==='/sync/release'){if(server.writer===device){server.writer=null;server.until=0;}result={ok:true};}
  else if(route==='/sync'&&method==='PUT'){assert.equal(data.revision,server.revision);assert.equal(device,server.writer);server.save=clone(data.save);server.revision++;result=snapshot(device);}
  else throw Error('Unexpected test API '+route);
  return server.hook?server.hook(call,result):result;
 }
 const sync=context.SengokuCloudSync.create({bridge:()=>bridge,storage:localStorage,device:{id:'staff-tab',name:'test'},now:()=>time,hidden:()=>false,online:()=>true,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 return{sync,server,bridge,log,applied,bases,roles,timers,game:()=>game,ready:()=>ready,start:()=>sync.start({id:'staff-a',request,onUser(){}}),puts:()=>log.filter(c=>c.method==='PUT')};
}
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
await test('staff role and source arrive together, and a base-only revision never writes the personal save',async()=>{
 const h=harness();await h.start();assert.equal(h.game().isStaff,true);assert.equal(h.game().state.home,'kyoto_gosho');assert.equal(h.game().state.buildings.farm,5);
 assert.equal(h.game().isAdmin,false);assert.equal(h.game().state.clan,'德川家');assert.equal(h.game().castle('kyoto_gosho').owner,'德川家');assert.equal(h.game().canOwnCastle('edo'),false);assert.equal(h.game().ownsVariant('of_b0616adde162','U'),false);
 const count=h.applied.length,puts=h.puts().length,personal=clone(h.bridge.getSave().state);
 h.server.base=fixture(2);h.server.base.initial.buildings.farm=6;h.server.base.buildings.farm=6;await h.sync.refresh();
 assert.equal(h.game().state.buildings.farm,6);assert.equal(h.applied.length,count);assert.equal(h.puts().length,puts);assert.deepEqual(clone(h.bridge.getSave().state),personal);
 assert.equal(h.applied[0].meta.isStaff,true);assert.equal(h.applied[0].meta.isAdmin,false);assert.equal(h.applied[0].meta.staffBase.id,'kyoto_gosho');h.sync.stop();
});
await test('same-revision shared growth preserves dirty personal resource changes before flushing them',async()=>{
 const h=harness();await h.start();const applied=h.applied.length,before=h.game().state.resources.gold,personalFarm=h.bridge.getSave().state.buildings.farm;
 h.game().state.resources.gold+=77;h.sync.notifySave();h.server.base=fixture(2);h.server.base.initial.buildings.farm=7;h.server.base.buildings.farm=7;
 await h.sync.refresh();assert.equal(h.applied.length,applied);assert.equal(h.bases.find(b=>b.base?.revision===2).gold,before+77);assert.equal(h.game().state.resources.gold,before+77);
 assert.equal(h.server.save.state.resources.gold,before+77);assert.equal(h.server.save.state.buildings.farm,personalFarm);assert.equal(h.game().state.buildings.farm,7);h.sync.stop();
});
await test('a canonical PUT reply projects the shared base while preserving personal actions made during the request',async()=>{
 const h=harness();await h.start();const gate=deferred();let reached=false;
 h.server.base=fixture(2);h.server.base.initial.buildings.farm=8;h.server.base.buildings.farm=8;
 h.server.hook=async(call,result)=>{if(call.method==='PUT'&&!reached){reached=true;await gate.promise;}return result;};
 h.game().state.resources.gold+=50;h.sync.notifySave();const task=h.sync.flush();await until(()=>reached);h.game().state.resources.gold+=25;const latest=h.game().state.resources.gold;h.sync.notifySave();gate.resolve();await task;
 assert.equal(h.game().state.resources.gold,latest);assert.equal(h.game().state.buildings.farm,8);await h.sync.flush();assert.equal(h.server.save.state.resources.gold,latest);h.sync.stop();
});
await test('an old staff poll arriving after verified revocation cannot regrant the role or shared view',async()=>{
 const h=harness();await h.start();const gate=deferred();let reached=false;
 h.server.hook=async(call,result)=>{if(call.route.startsWith('/sync?')&&!reached){reached=true;await gate.promise;}return result;};
 const task=h.sync.refresh();await until(()=>reached);h.bridge.setRoleAccess({isAdmin:false,isStaff:false});h.server.role.isStaff=false;
 h.server.save=JSON.parse(SengokuEngine.fromSave(h.server.save,roster,{isStaff:false}).exportSave());h.server.revision++;h.server.base=null;
 const count=h.bases.length;gate.resolve();const result=await task;assert.equal(result.ok,false);assert.equal(h.game().isStaff,false);assert.equal(h.game().isAdmin,false);assert.equal(h.game().state.clan,'伊達家');assert.equal(h.game().getStaffBase(),null);assert.equal(h.bases.length,count);
 h.server.hook=null;await h.sync.refresh();assert.equal(h.game().isStaff,false);assert.equal(h.sync.getStatus().writable,true);h.sync.stop();
});
await test('operator metadata takes precedence and never projects a staff source; disconnect clears staff access',async()=>{
 const h=harness();h.server.role={isAdmin:true,isStaff:true};h.server.save=JSON.parse(SengokuEngine.fromSave(h.server.save,roster,{isAdmin:true,isStaff:true}).exportSave());
 await h.start();assert.equal(h.game().isAdmin,true);assert.equal(h.game().isStaff,false);assert.equal(h.game().state.home,'edo');assert.equal(h.bases.length,0);
 h.sync.stop();assert.equal(h.game().isAdmin,false);assert.equal(h.game().isStaff,false);assert.equal(h.game().getStaffBase(),null);
});
await test('bounded staff transition checkpoints retry automatically and remain read-only until synchronization completes',async()=>{
 for(const initialized of [false,true]){
  const h=harness();if(initialized)await h.start();
  // A separately verified /me may revoke access while /sync catches up the
  // former staff term. No private staff state is regranted during its retries.
  h.server.role.isStaff=false;h.server.base=null;h.server.save=JSON.parse(SengokuEngine.fromSave(h.server.save,roster,{isStaff:false}).exportSave());h.server.revision++;
  h.bridge.setRoleAccess({isAdmin:false,isStaff:false});let checkpoint=0;
  h.server.hook=async(call,result)=>{if(call.route.startsWith('/sync?')&&checkpoint++<2)throw Object.assign(Error('staff term catch-up pending'),{code:'STAFF_TRANSITION_PENDING',status:409});return result;};
  const first=initialized?await h.sync.refresh():await h.start();assert.equal(first.ok,false);assert.equal(h.sync.getStatus().linked,true);assert.equal(h.sync.getStatus().writable,false);assert.equal(h.game().isStaff,false);
  for(let expected=2;expected<=3;expected++){
    const timer=[...h.timers].find(([,task])=>task.ms===5000);assert(timer,'A five-second retry is scheduled after a partial checkpoint');h.timers.delete(timer[0]);timer[1].fn();
    await until(()=>checkpoint>=expected&&[...h.timers].some(([,task])=>task.ms===5000));
    if(expected===2){assert.equal(h.sync.getStatus().writable,false);assert.equal(h.game().isStaff,false);}
  }
  assert.equal(h.sync.getStatus().ready,true);assert.equal(h.sync.getStatus().writable,true);assert.equal(h.game().isStaff,false);assert.equal(h.game().getStaffBase(),null);h.sync.stop();
 }
});
console.log(`${count} shared staff-base coordinator scenarios passed. No external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
