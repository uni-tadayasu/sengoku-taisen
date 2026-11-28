/* Real economy engine, cloud coordinator and app bridge. Isolated memory service only. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {SengokuEngine:E}=require('../engine.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster=scope.window.SENGOKU_OFFICERS,copy=v=>JSON.parse(JSON.stringify(v));
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),coordinator=fs.readFileSync(path.join(__dirname,'../cloud-sync.js'),'utf8');
function fn(name){const start=app.indexOf('  function '+name+'(');assert(start>=0,name);const line=app.indexOf('\n',start);if(app.slice(start,line).endsWith('}'))return app.slice(start,line);const end=app.indexOf('\n  }',start);assert(end>start,name);return app.slice(start,end+4);}
function memory(){const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};}
function fixture(){const g=new E({officers:roster,seed:17});g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};g.applyWorldClock({id:'maintenance-test-clock',elapsedMs:0,running:true,speed:1});return JSON.parse(g.exportSave());}
function authority(save,{revision=1,asOfElapsedMs=30000,hasMore=false,changes=[]}={}){return{version:1,campaignId:save.state.walking.campaignId,activatedElapsedMs:0,revision,asOfElapsedMs,baseline:{elapsedMs:0,vacant:5000,trade:250,alliance:750},changes,...(hasMore?{hasMore:true}:{})};}
function harness({writer=false,advance=false}={}){
 const save=fixture(),storage=memory(),events=[],applied=[],requests=[],clockReads=[],timers=new Map();let who='owner-a',timer=0;const time=2000000000000;
 const server={save:copy(save),revision:10,elapsedMs:30000,authority:authority(save),writer:writer?null:'other-device',until:time+30000,hook:null};
 const c={console,Date,Math,JSON,URL,URLSearchParams,Blob,Promise,crypto:crypto.webcrypto,SengokuEngine:E,roster,game:E.fromSave(save,roster),staffBaseId:'kyoto_gosho',saveKey:'save',backupKey:'backups',localStorage:storage,sessionStorage:memory(),navigator:{onLine:true},document:{hidden:false,addEventListener(){}},performance:{now:()=>1000},addEventListener(){},dispatchEvent:e=>events.push(e.type),CustomEvent:class{constructor(type){this.type=type;}},setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timers.delete(id),
  syncAccess:{linked:true,ready:false,writable:false,rolePending:false},saveEnabled:true,saveWarning:'',worldCatchingUp:false,worldSettlementPending:false,fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,startPending:false,staffBaseReady:false,pendingRoleSave:null,roleEpoch:0,evaluationOwnerId:'',renderedSyncBanner:'',selectedCastle:'',lastRealtime:0,saveCounter:0,importedGame:null,activeModal:'',currentView:'town',
  $:()=>null,toast(){},render(){},renderHeader(){},refreshLiveControls(){},refreshEvaluationUI(){},refreshActiveModal(){},syncBanner:()=>'',preserveInteraction(){},closeModal(){},updateBattlePreview(){},stopStrategy(){},retireLocalWalkingContext(){},queueWorldProgress(){}};
 c.window=c;c.state=()=>c.game.state;c.SengokuSocial={getUser:()=>who?{id:who,isAdmin:false,isStaff:false}:null};
 let currentClock={id:'maintenance-test-clock',elapsedMs:30000,confirmedElapsedMs:30000,running:true,speed:1,revision:1};
 c.SengokuWorldClock={snapshot:()=>({ready:true,clock:currentClock}),accept(clock){currentClock={...copy(clock),confirmedElapsedMs:clock.elapsedMs};clockReads.push({authority:c.game.getMaintenanceAuthority(),confirmed:c.confirmedWorldClock()});if(advance)c.game.applyWorldClock(c.confirmedWorldClock());}};
 storage.setItem('save',c.game.exportSave());vm.createContext(c);
 vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','backupCurrentSave','trustedBranchAuthority','applyBranchAuthority','trustedMaintenanceAuthority','applyMaintenanceAuthority','trustedCourtProtection','applyCourtProtection','trustedCourtEstateProjection','courtEstateHolding','applyCloudSave','prepareRecoverySave','applyRecoverySave','setSyncAccess','setRoleAccess'].map(fn).join('\n'),c);
 const bridge={getState:()=>c.game.state,getSave:()=>JSON.parse(c.game.exportSave()),getStoredSave:()=>JSON.parse(storage.getItem('save')),hasStarted:()=>true,getRoleAccess:()=>({isAdmin:c.game.isAdmin,isStaff:c.game.isStaff,pending:c.syncAccess.rolePending,epoch:c.roleEpoch}),setRoleAccess:c.setRoleAccess,setSyncAccess:c.setSyncAccess,applyCloudSave(save,meta){applied.push(copy(meta));return c.applyCloudSave(save,meta);},applyBranchAuthority:c.applyBranchAuthority,applyMaintenanceAuthority:c.applyMaintenanceAuthority,getMaintenanceAuthority:()=>c.game.getMaintenanceAuthority()};
 c.SengokuBridge=bridge;vm.runInContext(coordinator,c);
 function snapshot(id,device){return{ok:true,user:{id,name:id,isAdmin:false,isStaff:false},save:copy(server.save),revision:server.revision,branchResolvedElapsedMs:0,maintenanceAuthority:copy(server.authority),clock:{id:'maintenance-test-clock',elapsedMs:server.elapsedMs,running:true,speed:1,revision:1},serverTime:new Date(time).toISOString(),writerDeviceId:server.writer,writerDeviceName:'test',leaseExpiresAt:new Date(server.until).toISOString(),writable:server.writer===device};}
 async function request(id,route,options={}){const method=options.method||'GET',data=options.data||{},device=data.deviceId||new URL(route,'https://unit.invalid').searchParams.get('deviceId'),call={id,route,method,data:copy(data)};requests.push(call);let result;
  if(route==='/presence'||route==='/sync/release')result={ok:true};
  else if(route.startsWith('/sync?'))result=snapshot(id,device);
  else if(route==='/sync/lease'){server.writer=device;result=snapshot(id,device);}
  else if(route==='/sync'&&method==='PUT'){assert.equal(data.revision,server.revision);if(server.save&&data.maintenanceRevision!==server.authority.revision)throw Object.assign(Error('維持費の最新台帳を確認してください。'),{code:'MAINTENANCE_REFRESH_REQUIRED',status:409});server.save=copy(data.save);server.authority.campaignId=server.save.state.walking.campaignId;server.revision++;result=snapshot(id,device);}
  else throw Error('Unexpected route '+route);return server.hook?server.hook(call,result):result;
 }
 const sync=c.SengokuCloudSync.create({bridge:()=>bridge,storage,device:{id:'maintenance-test-device',name:'test'},now:()=>time,hidden:()=>false,online:()=>true,setTimeout:c.setTimeout,clearTimeout:c.clearTimeout});c.SengokuCloudSync=sync;
 return{c,server,sync,bridge,storage,events,applied,requests,clockReads,snapshot,start(id='owner-a'){who=id;return sync.start({id,request:(route,options)=>request(id,route,options),onUser(){}});},meta(value=server.authority){return{source:'cloud',playerId:who,maintenanceAuthority:copy(value)};},publicClock(elapsedMs){currentClock={...currentClock,elapsedMs,confirmedElapsedMs:elapsedMs};}};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('an empty cloud account can write its first campaign before a campaign-scoped maintenance authority exists',async()=>{
 const h=harness({writer:true});h.server.save=null;h.server.revision=0;h.server.authority={...h.server.authority,campaignId:'',baseline:{elapsedMs:0,vacant:0,trade:0,alliance:0}};
 assert((await h.start()).ok);assert(h.server.save?.state?.walking?.campaignId);assert(h.requests.some(row=>row.method==='PUT'&&row.data.maintenanceRevision===undefined));assert.equal(h.c.game.getMaintenanceAuthority().campaignId,h.server.save.state.walking.campaignId);h.sync.stop();
});
test('trusted troop history is installed before catch-up and produces the same balances as the authoritative engine',async()=>{
 const h=harness({advance:true}),control=E.fromSave(h.server.save,roster,{maintenanceAuthority:h.server.authority});control.applyWorldClock({id:'maintenance-test-clock',elapsedMs:30000,running:true,speed:1});
 await h.start();assert(h.applied[0].maintenanceAuthority);assert(h.clockReads.every(row=>row.authority?.revision===1));assert.deepEqual(copy(h.c.game.state.resources),control.state.resources);assert.equal(h.c.game.maintenance().troops.external,6000);assert.equal(h.c.game.state.worldClock.elapsedMs,30000);h.sync.stop();
});
test('public time cannot run past the private sealed horizon, and an unchanged GET extends it without replacing the engine',async()=>{
 const h=harness({advance:true});await h.start();const game=h.c.game,count=h.applied.length;h.publicClock(50000);assert.equal(h.c.confirmedWorldClock().elapsedMs,30000);assert(h.c.clockIsApplied());
 h.server.elapsedMs=50000;h.server.authority.asOfElapsedMs=50000;await h.sync.refresh();assert.strictEqual(h.c.game,game);assert.equal(h.applied.length,count);assert.equal(game.state.worldClock.elapsedMs,50000);assert.equal(h.c.confirmedWorldClock().elapsedMs,50000);h.sync.stop();
});
test('private direct replies update troop ownership, while a delayed older authority cannot rewind it',async()=>{
 const h=harness();await h.start();const old=copy(h.server.authority);h.server.authority=authority(h.server.save,{revision:2,asOfElapsedMs:40000,changes:[{elapsedMs:30000,vacant:5500,trade:250,alliance:750}]});h.server.elapsedMs=40000;
 const direct=h.snapshot('owner-a','other-device');assert(h.sync.observeBranchSnapshot(direct).ok);assert.equal(h.c.game.getMaintenanceAuthority().revision,2);
 h.server.authority=old;h.server.elapsedMs=30000;await h.sync.refresh();assert.equal(h.c.game.getMaintenanceAuthority().revision,2);assert.equal(h.c.game.getMaintenanceAuthority().asOfElapsedMs,40000);h.sync.stop();
});
test('writes carry the actual maintenance revision and a changed ledger recovers through a protected canonical refresh',async()=>{
 const h=harness({writer:true});await h.start();h.c.game.state.resources.gold+=7;h.sync.notifySave();assert((await h.sync.flush()).ok);assert.equal(h.requests.find(row=>row.method==='PUT').data.maintenanceRevision,1);
 h.server.authority=authority(h.server.save,{revision:2,asOfElapsedMs:40000,changes:[{elapsedMs:30000,vacant:4000,trade:250,alliance:750}]});h.server.elapsedMs=40000;
 h.c.game.state.resources.gold+=11;const before=h.c.game.state.resources.gold;h.sync.notifySave();const result=await h.sync.flush();assert(result.conflict);assert.equal(h.c.game.getMaintenanceAuthority().revision,2);const backups=JSON.parse(h.storage.getItem('backups'));assert(backups.some(row=>JSON.parse(row.save).state.resources.gold===before)||h.applied.some(meta=>meta.backup),'Unsaved changes remain recoverable');
 h.c.game.state.resources.gold+=2;h.sync.notifySave();assert((await h.sync.flush()).ok);assert.equal(h.requests.filter(row=>row.method==='PUT').at(-1).data.maintenanceRevision,2);h.sync.stop();
});
test('a successful command with a later canonical baseline waits for its save instead of becoming a transport error',async()=>{
 const h=harness({advance:true});await h.start();const original=h.c.game;h.server.revision++;h.server.elapsedMs=40000;
 const next=E.fromSave(h.server.save,roster,{maintenanceAuthority:{...h.server.authority,asOfElapsedMs:40000}});next.applyWorldClock({id:'maintenance-test-clock',elapsedMs:40000,running:true,speed:1});h.server.save=JSON.parse(next.exportSave());
 h.server.authority={...authority(h.server.save,{revision:2,asOfElapsedMs:40000}),baseline:{elapsedMs:40000,vacant:6500,trade:250,alliance:750}};
 assert.doesNotThrow(()=>assert(h.sync.observeBranchSnapshot(h.snapshot('owner-a','other-device')).ok));assert.strictEqual(h.c.game,original);assert.equal(h.c.game.getMaintenanceAuthority().revision,1);
 assert((await h.sync.refresh()).ok);assert.notStrictEqual(h.c.game,original);assert.equal(h.c.game.getMaintenanceAuthority().revision,2);assert.equal(h.c.game.state.worldClock.elapsedMs,40000);assert.equal(h.c.game.maintenance().troops.external,7500);h.sync.stop();
});
test('file fields, wrong identities and campaigns cannot supply private maintenance authority, and invalidation clears it',async()=>{
 const h=harness();await h.start();for(const extra of [{source:'file'},{playerId:'other'},{maintenanceAuthority:{...h.server.authority,campaignId:'other-campaign'}}])assert.equal(h.c.applyMaintenanceAuthority({...h.meta(),...extra}).ok,false);
 const forged=copy(h.bridge.getSave());forged.maintenanceAuthority=h.server.authority;forged.state.maintenanceAuthority=h.server.authority;assert(h.c.applyCloudSave(forged,{source:'file',maintenanceAuthority:h.server.authority}).ok);assert.equal(h.c.game.getMaintenanceAuthority(),null);
 assert(h.c.applyMaintenanceAuthority(h.meta()).ok);h.sync.invalidateAccountAccess({playerId:'owner-a'});assert.equal(h.c.game.getMaintenanceAuthority(),null);assert.equal(h.c.applyMaintenanceAuthority(h.meta()).ok,false);h.sync.stop();
});
test('a replacement engine without its private authority cannot borrow the cached revision to upload uncharged progress',async()=>{
 const h=harness({writer:true});await h.start();const count=h.requests.filter(row=>row.method==='PUT').length;
 h.c.game=E.fromSave(h.bridge.getSave(),roster);h.c.game.state.resources.gold+=80;h.sync.notifySave();const result=await h.sync.flush();
 assert(result.conflict);assert.equal(h.requests.filter(row=>row.method==='PUT').length,count,'No unverified balance was submitted');assert.equal(h.c.game.getMaintenanceAuthority().revision,1);h.sync.stop();
});
test('bounded history blocks ordinary operations while allowing its next safe checkpoint',async()=>{
 const h=harness({writer:true});h.server.authority.hasMore=true;await h.start();h.c.game.applyWorldClock(h.c.confirmedWorldClock());assert.equal(h.c.canMutate(),false);assert.equal(h.c.canMutate(true),true);assert.match(h.c.syncMessage(),/維持費/);assert.equal(h.c.game.getMaintenanceAuthority().hasMore,true);h.sync.stop();
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' maintenance / real cloud / bridge integration groups passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
