/* Real app authority boundary, cloud coordinator and engine. Memory service only. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {SengokuEngine:E}=require('../engine.js'),assets={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),assets);
const roster=assets.window.SENGOKU_OFFICERS,copy=value=>JSON.parse(JSON.stringify(value));
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),coordinator=fs.readFileSync(path.join(__dirname,'../cloud-sync.js'),'utf8');
function fn(name){const start=app.indexOf('  function '+name+'(');assert(start>=0,name);const line=app.indexOf('\n',start);if(app.slice(start,line).endsWith('}'))return app.slice(start,line);const end=app.indexOf('\n  }',start);assert(end>start,name);return app.slice(start,end+4);}
function memory(){const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function deferred(){let resolve;return{promise:new Promise(done=>{resolve=done;}),resolve};}
async function until(check){for(let i=0;i<100;i++){if(check())return;await Promise.resolve();}assert(check(),'Expected asynchronous checkpoint');}
function harness({protectedOffice=false,writer=false,courtProjection=null}={}){
 const initial=new E({officers:roster,clan:'伊達家',startCastle:'himeji',seed:31}),storage=memory(),time=2000000000000,timers=new Map();
 const save=JSON.parse(initial.exportSave()),applied=[],requests=[],clockReads=[],protectionCalls=[],effects={stops:0};let who='court-player-a',timer=0;
 const server={save:copy(save),revision:10,protectedOffice,courtProjection:typeof courtProjection==='function'?courtProjection(save.state.walking.campaignId):courtProjection,writer:writer?null:'other-device',until:time+30000,hook:null,beforeRequest:null};
 const c={console,Date,Math,JSON,URL,URLSearchParams,Promise,crypto:crypto.webcrypto,SengokuEngine:E,roster,game:initial,staffBaseId:'kyoto_gosho',saveKey:'save',backupKey:'backups',localStorage:storage,sessionStorage:memory(),navigator:{onLine:true},document:{hidden:false,addEventListener(){}},performance:{now:()=>1000},addEventListener(){},dispatchEvent(){},CustomEvent:class{constructor(type){this.type=type;}},setTimeout:(callback,delay)=>{timers.set(++timer,{callback,delay});return timer;},clearTimeout:id=>timers.delete(id),
  syncAccess:{linked:true,ready:false,writable:false,rolePending:false},saveEnabled:true,saveWarning:'',worldCatchingUp:false,worldSettlementPending:false,fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,startPending:false,staffBaseReady:false,pendingRoleSave:null,roleEpoch:0,evaluationOwnerId:'',selectedCastle:'',lastRealtime:0,saveCounter:0,importedGame:null,activeModal:'',currentView:'town',
  $:()=>null,toast(){},render(){},renderHeader(){},refreshLiveControls(){},refreshEvaluationUI(){},refreshActiveModal(){},preserveInteraction(){},closeModal(){},updateBattlePreview(){},stopStrategy(){effects.stops++;},retireLocalWalkingContext(){},queueWorldProgress(){},fetch(){throw Error('Court protection tests must never contact a real service');}};
 c.window=c;c.state=()=>c.game.state;c.SengokuSocial={getUser:()=>who?{id:who,isAdmin:false,isStaff:false,isDeputy:false}:null};
 let clock={id:'court-protection-clock',elapsedMs:0,confirmedElapsedMs:0,running:true,speed:1,revision:1};
 c.SengokuWorldClock={snapshot:()=>({ready:true,clock}),accept(value){clock={...copy(value),confirmedElapsedMs:value.elapsedMs};clockReads.push({protected:c.game.isCourtProtected,epoch:c.roleEpoch,estate:c.game.getCourtEstateStatus?.(),estateActive:c.game.courtEstateEffects?.().active});}};
 storage.setItem('save',initial.exportSave());vm.createContext(c);
 vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','backupCurrentSave','trustedBranchAuthority','applyBranchAuthority','trustedMaintenanceAuthority','applyMaintenanceAuthority','trustedCourtProtection','applyCourtProtection','trustedCourtEstateProjection','applyCourtEstateProjection','applyCloudSave','prepareRecoverySave','applyRecoverySave','setSyncAccess','setRoleAccess'].map(fn).join('\n'),c);
 const bridge={getState:()=>c.game.state,getSave:()=>JSON.parse(c.game.exportSave()),getStoredSave:()=>JSON.parse(storage.getItem('save')),hasStarted:()=>true,getRoleAccess:()=>({isAdmin:c.game.isAdmin,isStaff:c.game.isStaff,isDeputy:c.game.isDeputy,isCourtProtected:c.game.isCourtProtected,pending:c.syncAccess.rolePending,epoch:c.roleEpoch}),setRoleAccess:c.setRoleAccess,setSyncAccess:c.setSyncAccess,
  applyCloudSave(value,meta){applied.push(copy(meta));return c.applyCloudSave(value,meta);},applyCourtProtection(meta){protectionCalls.push(copy(meta));return c.applyCourtProtection(meta);},applyBranchAuthority:c.applyBranchAuthority,applyMaintenanceAuthority:c.applyMaintenanceAuthority,applyCourtEstateProjection:c.applyCourtEstateProjection,getCourtEstateProjection:()=>c.game.getCourtEstateProjection?.()||null,courtEstateProjectionRequiresReplay:(projection,options)=>c.game.courtEstateProjectionRequiresReplay?.(projection,options)??true};
 c.SengokuBridge=bridge;vm.runInContext(coordinator,c);
 function snapshot(id=who,device='other-device'){return{ok:true,user:{id,name:id,isAdmin:false,isStaff:false,isDeputy:false},save:copy(server.save),revision:server.revision,entitlements:{courtProtected:server.protectedOffice,courtEstate:server.protectedOffice},courtEstateProjection:copy(server.courtProjection),branchResolvedElapsedMs:0,clock:{id:'court-protection-clock',elapsedMs:0,running:true,speed:1,revision:1},serverTime:new Date(time).toISOString(),writerDeviceId:server.writer,writerDeviceName:'test',leaseExpiresAt:new Date(server.until).toISOString(),writable:server.writer===device};}
 async function request(id,route,options={}){
  const method=options.method||'GET',data=options.data||{},device=data.deviceId||new URL(route,'https://unit.invalid').searchParams.get('deviceId'),call={id,route,method,data:copy(data)};requests.push(call);if(server.beforeRequest)await server.beforeRequest(call);let result;
  if(route==='/presence'||route==='/sync/release')result={ok:true};
  else if(route.startsWith('/sync?'))result=snapshot(id,device);
  else if(route==='/sync/lease'){server.writer=device;result=snapshot(id,device);}
  else if(route==='/sync'&&method==='PUT'){assert.equal(data.revision,server.revision);server.save=copy(data.save);server.revision++;result=snapshot(id,device);}
  else throw Error('Unexpected test route '+route);
  return server.hook?server.hook(call,result):result;
 }
 const sync=c.SengokuCloudSync.create({bridge:()=>bridge,storage,device:{id:'court-protection-tab',name:'test'},now:()=>time,hidden:()=>false,online:()=>true,setTimeout:c.setTimeout,clearTimeout:c.clearTimeout});c.SengokuCloudSync=sync;
 return{c,server,sync,bridge,storage,applied,requests,clockReads,protectionCalls,effects,snapshot,start(id='court-player-a'){who=id;return sync.start({id,request:(route,options)=>request(id,route,options),onUser(){}});},meta(value=true){return{source:'cloud',playerId:who,entitlements:{courtProtected:value}};},setIdentity(id){who=id;}};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('the initial private grant reaches the engine before clock catch-up without granting account privileges',async()=>{
 const h=harness({protectedOffice:true});try{
  assert((await h.start()).ok);assert.equal(h.c.game.isCourtProtected,true);assert(h.clockReads.length);assert(h.clockReads.every(row=>row.protected));
  assert.equal(h.applied[0].source,'cloud');assert.equal(h.applied[0].playerId,'court-player-a');assert.equal(h.applied[0].entitlements.courtProtected,true);
  assert.equal(h.c.game.isAdmin,false);assert.equal(h.c.game.isStaff,false);assert.equal(h.c.game.isDeputy,false);assert.equal(h.c.game.state.home,'himeji');
  assert.equal(h.requests.filter(row=>row.method==='PUT').length,0);
 }finally{h.sync.stop();}
});
test('same-save-revision grants and dismissals update transient authority while preserving unsaved progress',async()=>{
 const h=harness();try{
  await h.start();const game=h.c.game,applied=h.applied.length,revision=h.server.revision,stored=h.storage.getItem('save');
  game.state.resources.gold+=137;h.sync.notifySave();const progress=copy(game.state);
  for(const protectedOffice of [true,false,true]){
   const epoch=h.c.roleEpoch;h.server.protectedOffice=protectedOffice;assert((await h.sync.refresh()).ok);
   assert.strictEqual(h.c.game,game);assert.equal(game.isCourtProtected,protectedOffice);assert(h.c.roleEpoch>epoch,'Protection changes invalidate pending gameplay scope');
   assert.deepEqual(copy(game.state),progress);assert.equal(h.applied.length,applied);assert.equal(h.server.revision,revision);assert.equal(h.storage.getItem('save'),stored);
   const currentEpoch=h.c.roleEpoch;await h.sync.refresh();assert.equal(h.c.roleEpoch,currentEpoch,'An unchanged poll keeps the current gameplay scope');
  }
  assert.equal(h.requests.filter(row=>row.method==='PUT').length,0);
 }finally{h.sync.stop();}
});
test('file flags, role-like fields, invalid values and foreign metadata cannot manufacture protection',async()=>{
 const h=harness();try{
  await h.start();const forged=copy(h.bridge.getSave());Object.assign(forged,{isCourtProtected:true,courtProtected:true,entitlements:{courtProtected:true}});Object.assign(forged.state,{isCourtProtected:true,courtProtected:true,entitlements:{courtProtected:true},courtOffice:{title:'左大臣',kind:'official',jurisdiction:'kyoto'}});
  const metadata=[{},null,{isCourtProtected:true},{...h.meta(),source:'file'},{...h.meta(),playerId:'foreign-player'},{...h.meta(),entitlements:{courtProtected:1}},{...h.meta(),entitlements:{courtProtected:'true'}},{source:'cloud',playerId:'court-player-a',courtProtected:true}];
  for(const meta of metadata){h.c.game.setCourtProtection(false);h.c.applyCloudSave(forged,meta);assert.equal(h.c.game.isCourtProtected,false);}
  assert.equal(E.fromSave(forged,roster).isCourtProtected,false);
  const recovery=h.c.prepareRecoverySave(forged,{isCourtProtected:true,entitlements:{courtProtected:true}});assert(recovery.ok);assert.equal(E.fromSave(recovery.save,roster).isCourtProtected,false);
  h.setIdentity(null);h.c.applyCourtProtection(h.meta());assert.equal(h.c.game.isCourtProtected,false);
 }finally{h.sync.stop();}
});
test('confirmed protection is absent from export and reload requires another private confirmation',async()=>{
 const h=harness({protectedOffice:true});try{
  await h.start();const exported=JSON.parse(h.c.game.exportSave());
  assert.equal(exported.isCourtProtected,undefined);assert.equal(exported.courtProtected,undefined);assert.equal(exported.state.isCourtProtected,undefined);assert.equal(exported.state.courtProtected,undefined);
  assert.equal(E.fromSave(exported,roster).isCourtProtected,false);
  const before=h.c.game.state.resources.gold;h.c.game=E.fromSave(exported,roster);assert((await h.sync.refresh()).ok);assert.equal(h.c.game.isCourtProtected,true);assert.equal(h.c.game.state.resources.gold,before);
 }finally{h.sync.stop();}
});
test('disconnect, identity revalidation and suspension clear protection immediately',async()=>{
 for(const action of ['disconnect','pending','ban']){
  const h=harness({protectedOffice:true});try{
   await h.start();assert.equal(h.c.game.isCourtProtected,true);const before=h.c.roleEpoch;
   if(action==='disconnect')h.sync.stop();else if(action==='pending')h.sync.invalidateAccountAccess({playerId:'court-player-a'});else h.sync.suspendAccount({playerId:'court-player-a'});
   assert.equal(h.c.game.isCourtProtected,false,action);if(action!=='disconnect')assert(h.c.roleEpoch>before,action+' invalidates pending gameplay scope');
   h.c.applyCourtProtection(h.meta());assert.equal(h.c.game.isCourtProtected,false,'A paused or disconnected account cannot reapply private flags');
  }finally{h.sync.stop();}
 }
});
test('wrong-account snapshots and public or incomplete notifications cannot replace private authority',async()=>{
 const h=harness();try{
  await h.start();const current=h.c.game;
  assert.equal(h.sync.observeBranchSnapshot({...h.snapshot('foreign-player'),entitlements:{courtProtected:true}}).ok,false);
  assert.equal((await h.sync.acceptSnapshot({...h.snapshot('foreign-player'),entitlements:{courtProtected:true}})).ok,false);
  assert.equal(h.sync.observeBranchSnapshot({user:{id:'court-player-a'},courtProtected:true}).ok,false);
  assert.strictEqual(h.c.game,current);assert.equal(current.isCourtProtected,false);
  h.server.hook=(call,result)=>call.route.startsWith('/sync?')?{...result,user:{...result.user,id:'foreign-player'},entitlements:{courtProtected:true}}:result;
  assert.equal((await h.sync.refresh()).ok,false);assert.equal(h.c.game.isCourtProtected,false);
 }finally{h.sync.stop();}
});
test('a delayed poll cannot reverse a separately confirmed appointment or dismissal at the same save revision',async()=>{
 for(const initial of [false,true]){
  const h=harness({protectedOffice:initial});try{
   await h.start();const gate=deferred();let reached=false;
   h.server.hook=async(call,result)=>{if(call.route.startsWith('/sync?')&&!reached){reached=true;await gate.promise;}return result;};
   const poll=h.sync.refresh();await until(()=>reached);h.server.protectedOffice=!initial;
   assert(h.sync.observeBranchSnapshot(h.snapshot()).ok);assert.equal(h.c.game.isCourtProtected,!initial);
   gate.resolve();await poll;assert.equal(h.c.game.isCourtProtected,!initial,'Old response must not reinstate or remove the current protection');
   h.server.hook=null;assert((await h.sync.refresh()).ok);assert.equal(h.c.game.isCourtProtected,!initial);
  }finally{h.sync.stop();}
 }
});
test('a stopped identity cannot regrant protection after a different player connects',async()=>{
 const h=harness({protectedOffice:true});try{
  const gate=deferred();let reached=false;h.server.hook=async(call,result)=>{if(call.id==='court-player-a'&&call.route.startsWith('/sync?')&&!reached){reached=true;await gate.promise;}return result;};
  const prior=h.start();await until(()=>reached);h.server.protectedOffice=false;assert((await h.start('court-player-b')).ok);const current=h.c.game;
  gate.resolve();await prior;assert.strictEqual(h.c.game,current);assert.equal(current.isCourtProtected,false);assert.equal(h.applied.at(-1).playerId,'court-player-b');
 }finally{h.sync.stop();}
});
if(require.main===module)(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' court protection / real cloud / app authority groups passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});

module.exports={harness,deferred,until};
