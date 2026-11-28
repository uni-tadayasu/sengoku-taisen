/* Expulsion protocol and actual application bridge; all data stays in memory. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const memory=()=>{const map=new Map();return{map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)};};
const expulsion={pending:true,revision:1,castleId:'kiyosu',castleName:'清洲城',expelledAt:'2026-11-27T12:00:00Z'};
function harness({pending=false,bridgeFailure=false}={}){
  const storage=memory(),time=2e12,timers=new Map(),calls=[],applied=[],notices=[];let serial=0,started=true,rolePending=false,user={id:'u_target',isAdmin:false,isStaff:false};
  let local={state:{home:'kiyosu',clan:'織田家',walking:{campaignId:'campaign-old'},resources:{gold:333},officers:['retained']}};
  const server={save:copy(local),revision:3,expulsion:pending?copy(expulsion):null,writer:null,until:0,rejectWrites:false};
  const bridge={getRoleAccess:()=>({pending:rolePending,isAdmin:false,isStaff:false,epoch:0}),setRoleAccess:value=>{rolePending=value.pending===true;},getSave:()=>started?copy(local):null,getStoredSave:()=>copy(local),hasStarted:()=>started,setSyncAccess(){},applyCloudSave:(save,meta)=>{applied.push({save:copy(save),meta:copy(meta)});local=copy(save);started=true;return{ok:true};},applyExpulsion:(value,meta)=>{notices.push({value:copy(value),meta:copy(meta)});if(bridgeFailure)return{ok:false,message:'storage failed'};started=false;return{ok:true};}};
  const context={console,Date,JSON,Math,URL,URLSearchParams,crypto:crypto.webcrypto,localStorage:storage,sessionStorage:memory(),navigator:{onLine:true},document:{hidden:false,addEventListener(){}},addEventListener(){},setTimeout,clearTimeout};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../cloud-sync.js'),'utf8'),context);
  const snapshot=device=>({ok:true,user:copy(user),revision:server.revision,save:server.expulsion?.pending?null:copy(server.save),expulsion:copy(server.expulsion),residency:null,residencyRevision:4,serverTime:new Date(time).toISOString(),writerDeviceId:server.writer,leaseExpiresAt:server.until?new Date(server.until).toISOString():null,writable:server.writer===device});
  async function request(route,options={}){
    const data=options.data||{},method=options.method||'GET',device=data.deviceId||new URL(route,'https://local.invalid').searchParams.get('deviceId');calls.push({route,method,data:copy(data)});
    if(route==='/presence')return{ok:true};if(route.startsWith('/sync?'))return snapshot(device);
    if(route==='/sync/lease'){server.writer=device;server.until=time+30000;return snapshot(device);}
    if(route==='/sync/release'){server.writer=null;server.until=0;return{ok:true};}
    if(route==='/sync'&&method==='PUT'){
      if(server.expulsion?.pending||server.rejectWrites)throw Object.assign(Error('拠点を選び直してください。'),{status:409,code:'BASE_EXPELLED'});
      assert.equal(data.revision,server.revision);server.revision++;server.save=copy(data.save);return snapshot(device);
    }
    throw Error('Unexpected local request '+route);
  }
  const sync=context.SengokuCloudSync.create({device:{id:'test-device',name:'test'},storage,bridge:()=>bridge,now:()=>time,hidden:()=>false,online:()=>true,setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  return{sync,server,storage,calls,applied,notices,bridge,timers,start:()=>sync.start({id:user.id,request,onUser:value=>{if(value)user=copy(value);}}),mutate:()=>{local.state.resources.gold+=10;sync.notifySave();},snapshot:()=>snapshot(sync.getDevice().id),puts:()=>calls.filter(row=>row.method==='PUT'),started:()=>started};
}
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
await test('a confirmed expulsion supersedes old local progress and never uploads it at first connection',async()=>{
  const h=harness({pending:true});h.storage.setItem('sengoku-sync-pending-v1',JSON.stringify({id:'u_target',revision:3,snapshot:{state:{home:'kiyosu'}}}));
  await h.start();assert.equal(h.started(),false);assert.equal(h.puts().length,0);assert.equal(h.sync.getStatus().awaitingStart,true);assert.equal(h.sync.getStatus().writable,true);assert.equal(h.sync.getStatus().banned,false);assert.match(h.sync.getStatus().message,/拠点から追放/);assert.equal(h.storage.getItem('sengoku-sync-pending-v1'),null);
  await h.sync.flush();await h.sync.refresh();assert.equal(h.puts().length,0);assert(h.notices.every(row=>row.meta.playerId==='u_target'&&row.meta.source==='cloud'));h.sync.stop();
});
await test('expulsion during dirty play abandons the old queued save and supports authoritative readmission',async()=>{
  const h=harness();await h.start();h.mutate();assert(h.storage.getItem('sengoku-sync-pending-v1'));
  h.server.expulsion=copy(expulsion);h.server.revision++;h.server.writer=null;h.server.until=0;await h.sync.refresh();assert.equal(h.started(),false);assert.equal(h.puts().length,0);assert.equal(h.storage.getItem('sengoku-sync-pending-v1'),null);
  h.server.expulsion={...expulsion,pending:false};h.server.save={state:{home:'himeji',clan:'織田家',walking:{campaignId:'campaign-new'},resources:{gold:100},officers:['retained']}};h.server.revision++;
  assert.equal((await h.sync.acceptSnapshot(h.snapshot())).ok,true);assert.equal(h.started(),true);assert.equal(h.sync.getStatus().expulsion,null);assert.equal(h.applied.at(-1).save.state.home,'himeji');assert.deepEqual(h.applied.at(-1).save.state.officers,['retained']);
  await h.sync.flush();assert.equal(h.puts().length,0);h.sync.stop();
});
await test('failed expulsion screen preparation keeps gameplay and lease writes blocked',async()=>{
  const h=harness({pending:true,bridgeFailure:true});const result=await h.start();assert.equal(result.ok,false);assert.equal(h.sync.getStatus().writable,false);assert.equal(h.sync.getStatus().ready,false);assert.equal(h.puts().length,0);assert(!h.calls.some(row=>row.route==='/sync/lease'));h.sync.stop();
});
await test('BASE_EXPELLED from a stale PUT stops that session without treating it as a BAN',async()=>{
  const h=harness();await h.start();h.mutate();h.server.rejectWrites=true;await h.sync.flush();assert.equal(h.sync.getStatus().writable,false);assert.equal(h.sync.getStatus().reason,'access-changed');assert.equal(h.sync.getStatus().banned,false);
  h.server.expulsion=copy(expulsion);h.server.revision++;await h.sync.refresh();assert.equal(h.started(),false);assert.equal(h.puts().length,1);h.sync.stop();
});
await test('the application bridge backs up once, cancels old actions, and removes the previous active save',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),start=source.indexOf("  let expulsionContext='';"),end=source.indexOf('  function applyCloudSave(',start),storage=memory();let backups=0,stops=0,renders=0;
  storage.setItem('game','old save');storage.setItem('sengoku-residency-admission-v1:u_target','old admission');storage.setItem('sengoku-residency-relocation-v1:u_target','old move');
  const context={game:{setCourtEstateProjection(value){assert.equal(value,null);}},window:{SengokuSocial:{getUser:()=>({id:'u_target'})}},localStorage:storage,syncAccess:{linked:true},saveKey:'game',startPending:false,backupCurrentSave:()=>{backups++;},stopStrategy:()=>{stops++;},roleEpoch:2,interactionEpoch:3,newGameGeneration:1,importReadGeneration:1,pendingRoleSave:'old',saveEnabled:true,saveWarning:'',worldCatchingUp:true,worldSettlementPending:true,newStartCastle:'kiyosu',newResidencyDirectory:{},newResidencyMode:'retainer',newResidencyError:'',importedGame:{},importedScope:{},selectedCastle:'kiyosu',lastRealtime:0,saveCounter:10,performance:{now:()=>100},closeModal(){},render:()=>{renders++;}};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.apply=applyExpulsion;',context);
  assert.equal(context.apply(expulsion,{source:'cloud',playerId:'u_other'}).ok,false);assert.equal(backups,0);
  assert.equal(context.apply(expulsion,{source:'cloud',playerId:'u_target'}).ok,true);assert.equal(context.startPending,true);assert.equal(storage.getItem('game'),null);assert.equal(storage.getItem('sengoku-residency-admission-v1:u_target'),null);assert.equal(context.importedGame,null);assert.equal(context.roleEpoch,3);assert.equal(backups,1);assert.equal(stops,1);assert.equal(renders,1);
  assert.equal(context.apply(expulsion,{source:'cloud',playerId:'u_target'}).ok,true);assert.equal(backups,1);assert.equal(renders,1);
  const admissionKey='sengoku-residency-admission-v1:u_target',admission={playerId:'u_target',requestId:'new-admission',expulsionRevision:1,choice:{castleId:'himeji'}};storage.setItem(admissionKey,JSON.stringify(admission));
  vm.runInContext("expulsionContext='';",context);assert.equal(context.apply(expulsion,{source:'cloud',playerId:'u_target'}).ok,true);assert.deepEqual(JSON.parse(storage.getItem(admissionKey)),admission,'Reload preserves an uncertain readmission for the same expulsion');
  assert.equal(context.apply({...expulsion,revision:2},{source:'cloud',playerId:'u_target'}).ok,true);assert.equal(storage.getItem(admissionKey),null,'A later expulsion invalidates the earlier admission');
});
console.log(`${count} expulsion synchronization and reselection checks passed. No network requests were made.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
