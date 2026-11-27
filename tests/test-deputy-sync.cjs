/* Real coordinator and engine; role changes use only an in-memory service. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {SengokuEngine}=require('../engine.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster=scope.window.SENGOKU_OFFICERS,clone=value=>JSON.parse(JSON.stringify(value));
const memory=()=>{const map=new Map();return{getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
function deferred(){let resolve;return{promise:new Promise(done=>{resolve=done;}),resolve};}
async function until(check){for(let i=0;i<80;i++){if(check())return;await Promise.resolve();}assert(check(),'Expected asynchronous checkpoint');}
function harness(){
 const time=2e12,storage=memory(),calls=[],applied=[],roles=[],timers=new Map();let timerId=0,epoch=0,pending=false,game=new SengokuEngine({clan:'伊達家',startCastle:'himeji',officers:roster,seed:14});
 const personal=JSON.parse(game.exportSave()),server={role:{isAdmin:false,isStaff:false,isDeputy:true},save:JSON.parse(SengokuEngine.fromSave(personal,roster,{isDeputy:true}).exportSave()),revision:10,writer:null,until:0,hook:null};
 const bridge={getRoleAccess:()=>({isAdmin:game.isAdmin,isStaff:game.isStaff,isDeputy:game.isDeputy,pending,epoch}),setRoleAccess:role=>{if(role.pending!==pending||role.isAdmin!==game.isAdmin||role.isStaff!==game.isStaff||role.isDeputy!==game.isDeputy)epoch++;pending=role.pending===true;roles.push({...role});return game.setRoleAccess(role);},hasStarted:()=>true,getSave:()=>JSON.parse(game.exportSave()),setSyncAccess(){},applyCloudSave:(save,meta)=>{applied.push({save:clone(save),meta:clone(meta)});game=SengokuEngine.fromSave(save,roster,meta);return{ok:true};}};
 const context={Date,Math,JSON,URL,URLSearchParams,crypto:crypto.webcrypto,localStorage:storage,sessionStorage:memory(),navigator:{onLine:true},document:{hidden:false,addEventListener(){}},addEventListener(){},setTimeout:()=>1,clearTimeout(){}};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../cloud-sync.js'),'utf8'),context);
 const snapshot=device=>({ok:true,user:{id:'deputy-a',name:'サブ運営A',clan:server.save.state.clan,...server.role},save:clone(server.save),revision:server.revision,serverTime:new Date(time).toISOString(),writerDeviceId:server.writer,leaseExpiresAt:server.until?new Date(server.until).toISOString():null,writable:server.writer===device});
 async function request(route,options={}){
  const method=options.method||'GET',data=options.data||{},device=data.deviceId||new URL(route,'https://local.invalid').searchParams.get('deviceId'),call={route,method,data:clone(data)};calls.push(call);let result;
  if(route==='/presence')result={ok:true};else if(route.startsWith('/sync?'))result=snapshot(device);
  else if(route==='/sync/lease'){server.writer=device;server.until=time+30000;result=snapshot(device);}
  else if(route==='/sync/release'){server.writer=null;server.until=0;result={ok:true};}
  else if(route==='/sync'&&method==='PUT'){assert.equal(data.revision,server.revision);server.save=clone(data.save);server.revision++;result=snapshot(device);}
  else throw Error('Unexpected local request '+route);
  return server.hook?server.hook(call,result):result;
 }
 const sync=context.SengokuCloudSync.create({device:{id:'deputy-tab',name:'test'},storage,bridge:()=>bridge,now:()=>time,hidden:()=>false,online:()=>true,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
 return{sync,server,personal,bridge,calls,applied,roles,storage,game:()=>game,start:()=>sync.start({id:'deputy-a',request,onUser(){}}),puts:()=>calls.filter(row=>row.method==='PUT')};
}
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
await test('verified deputy metadata reaches the engine with its own clan and fixed Kagoshima home',async()=>{
 const h=harness();await h.start();assert.equal(h.game().isDeputy,true);assert.equal(h.game().isAdmin,false);assert.equal(h.game().isStaff,false);assert.equal(h.game().state.clan,'伊達家');assert.equal(h.game().state.home,'kagoshima');assert.equal(h.game().ownsVariant('of_b0616adde162','U'),false);assert.equal(h.applied[0].meta.isDeputy,true);assert.equal(h.applied[0].meta.isAdmin,false);assert.equal(h.applied[0].meta.isStaff,false);assert.equal(h.puts().length,0);h.sync.stop();assert.equal(h.game().isDeputy,false);
});
await test('an old deputy poll cannot regrant the role after a separately verified dismissal',async()=>{
 const h=harness();await h.start();const gate=deferred();let reached=false;h.server.hook=async(call,result)=>{if(call.route.startsWith('/sync?')&&!reached){reached=true;await gate.promise;}return result;};const task=h.sync.refresh();await until(()=>reached);
 h.bridge.setRoleAccess({isAdmin:false,isStaff:false,isDeputy:false,pending:false});h.server.role.isDeputy=false;h.server.save=clone(h.personal);h.server.revision++;
 const before=h.applied.length;gate.resolve();const result=await task;assert.equal(result.ok,false);assert.equal(h.game().isDeputy,false);assert.equal(h.applied.length,before);assert.equal(h.puts().length,0);
 h.server.hook=null;await h.sync.refresh();assert.equal(h.game().state.home,'himeji');assert.equal(h.sync.getStatus().writable,true);h.sync.stop();
});
await test('role revalidation suppresses dirty deputy progress until the restored canonical home arrives',async()=>{
 const h=harness();await h.start();h.game().state.resources.gold+=777;h.sync.notifySave();assert(h.storage.getItem('sengoku-sync-pending-v1'));
 assert(h.sync.invalidateAccountAccess({playerId:'deputy-a'}));assert.equal(h.sync.getStatus().writable,false);assert.equal(h.game().isDeputy,false);await h.sync.flush();assert.equal(h.puts().length,0);
 h.server.role.isDeputy=false;h.server.save=clone(h.personal);h.server.revision++;await h.sync.refresh();assert.equal(h.game().state.home,'himeji');assert.equal(h.game().state.resources.gold,h.personal.state.resources.gold);assert.equal(h.storage.getItem('sengoku-sync-pending-v1'),null);assert.equal(h.puts().length,0);assert.equal(h.sync.getStatus().writable,true);h.sync.stop();
});
await test('deputy flags cannot extend primary-operator or staff privileges',async()=>{
 for(const privileged of [{isAdmin:true,isStaff:false,isDeputy:true},{isAdmin:false,isStaff:true,isDeputy:true}]){
  const h=harness();h.server.role=privileged;h.server.save=JSON.parse(SengokuEngine.fromSave(h.personal,roster,privileged).exportSave());await h.start();assert.equal(h.game().isDeputy,false);assert.equal(h.applied[0].meta.isDeputy,false);assert.equal(h.roles.at(-1).isDeputy,false);h.sync.stop();
 }
});
console.log(`${count} deputy role synchronization checks passed. No external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
