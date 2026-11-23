/* Actual app bridge functions with a real engine and isolated local transport. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine}=require('../engine.js'),source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),rosterScope={window:{}};
vm.createContext(rosterScope);vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),rosterScope);const roster=rosterScope.window.SENGOKU_OFFICERS,clone=value=>JSON.parse(JSON.stringify(value));
function fn(name){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0,name);const firstEnd=source.indexOf('\n',start);if(source.slice(start,firstEnd).endsWith('}'))return source.slice(start,firstEnd);const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
function deferred(){let resolve,reject;return{promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),resolve,reject};}
async function until(predicate){for(let i=0;i<60;i++){if(predicate())return;await Promise.resolve();}assert(predicate(),'Async checkpoint not reached');}
function setup(){
 const stored=new Map(),posts=[],gets=[],trace=[],acceptedClocks=[];const game=new SengokuEngine({officers:roster,seed:17}),clock={id:'garrison-clock',elapsedMs:100000,confirmedElapsedMs:100000,running:true,speed:1,revision:1,calendar:{turn:1,year:1560,month:2,cycle:1,elapsed:40}};game.applyWorldClock(clock);stored.set('save',game.exportSave());
 const control={user:{id:'player-a',name:'領主A'},deviceId:'tab-a',status:{linked:true,ready:true,writable:true,revision:7,leaseExpiresAt:new Date(Date.now()+30000).toISOString()},clock,clockReady:true,flushes:0,refreshes:0,queued:0};let c;
 const social={getUser:()=>control.user?{...control.user}:null,troopGarrisonRequest:async(route,options)=>{const call={route,options:clone(options)};if(options.method==='GET'){gets.push(call);trace.push('read');return control.onGet?control.onGet(call):{ok:true,campaignId:c.game.state.walking.campaignId};}posts.push(call);trace.push('post');return control.onPost?control.onPost(call):{ok:true,revision:control.status.revision,result:{requestId:options.data.requestId}};}};
 const sync={getStatus:()=>({...control.status}),getDevice:()=>({id:control.deviceId}),flush:async()=>{control.flushes++;trace.push('flush');return control.onFlush?control.onFlush():{ok:true};},refresh:async()=>{control.refreshes++;trace.push('sync-refresh');return control.onRefresh?control.onRefresh():{ok:true};}};
 c={game,roster,SengokuEngine,Date,JSON,Math,Promise,URLSearchParams,state:()=>c.game.state,syncAccess:{...control.status},lastLocalSaveRaw:null,lastLocalSaveGame:null,localCampaignRefreshPending:false,saveKey:'save',saveEnabled:true,saveWarning:'',fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,startPending:false,roleEpoch:1,worldCatchingUp:false,worldSettlementPending:false,worldCatchupTimer:null,worldClockStatusKey:'',saveCounter:0,activeModal:'',
  localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>{if(control.storageError)throw Error('storage unavailable');stored.set(key,value);},removeItem:key=>stored.delete(key)},
  window:{SengokuSocial:social,SengokuCloudSync:sync,SengokuWorldClock:{snapshot:()=>({ready:control.clockReady,clock:control.clock,message:'clock'}),refresh:async()=>{trace.push('clock-refresh');return control.onClockRefresh?control.onClockRefresh():{ok:true};},accept:value=>{acceptedClocks.push(value);trace.push('clock-accept');control.clock=value;}},dispatchEvent:()=>trace.push('save')},
  CustomEvent:class{constructor(type){this.type=type;}},document:{hidden:false},$:()=>null,performance:{now:()=>1000},setTimeout:()=>1,clearTimeout(){},toast(){},render(){},renderHeader(){},refreshLiveControls(){},refreshJobTimers(){},refreshActiveModal(){},queueWorldProgress:()=>control.queued++,preserveInteraction(){},updateBattlePreview(){},syncMusic(){}
 };vm.createContext(c);vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','changedLocalCampaign','save','processWorldClock','getTroopGarrisonAccess','requestTroopGarrisons'].map(fn).join('\n'),c);
 return{c,control,stored,posts,gets,trace,acceptedClocks,payload:()=>({castleId:'osaka',troops:100,requestId:'ui-receipt-one',campaignId:c.game.state.walking.campaignId})};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('private GET is forwarded directly and exact caller request/campaign IDs survive verified writer metadata',async()=>{
 const h=setup(),before=clone(h.c.game.state);await h.c.requestTroopGarrisons('/troop-garrisons');assert.equal(h.gets.length,1);assert.equal(h.control.flushes,0);
 h.control.onPost=async()=>({ok:true,revision:9});h.control.onRefresh=async()=>{h.control.status.revision=9;return{ok:true};};const payload={...h.payload(),campaignId:'older-receipt-campaign',deviceId:'forged',expectedRevision:999};const result=await h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:payload});assert(result.ok);assert.deepEqual(h.posts[0].options.data,{...payload,deviceId:'tab-a',expectedRevision:7});assert(!Object.hasOwn(h.posts[0].options.data,'sequence'));assert(h.trace.indexOf('save')<h.trace.indexOf('flush')&&h.trace.indexOf('flush')<h.trace.indexOf('post'));assert.deepEqual(clone(h.c.game.state),before);assert.equal(h.c.fieldActionPending,false);assert.equal(h.control.queued,1);
});
test('unlinked, follower, unstarted and nondurable states stop before any troop POST',async()=>{
 for(const kind of ['unlinked','follower','unstarted','unsaved','storage']){const h=setup();if(kind==='unlinked')h.c.syncAccess.linked=false;if(kind==='follower'){h.c.syncAccess.writable=false;h.control.status.writable=false;}if(kind==='unstarted')h.c.startPending=true;if(kind==='unsaved')h.c.saveEnabled=false;if(kind==='storage')h.control.storageError=true;await assert.rejects(h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:h.payload()}));assert.equal(h.posts.length,0,kind);assert.equal(h.c.fieldActionPending,false);}
});
test('bad paths and missing durable caller receipts do not mutate, save or send',async()=>{
 const h=setup();for(const [route,method]of [['/troop-garrisons?owner=other','GET'],['/troop-garrisons/send/extra','POST'],['/troop-garrisons/../admin','POST'],['/troop-garrisons/recall','GET']])await assert.rejects(h.c.requestTroopGarrisons(route,{method,data:h.payload()}));for(const payload of [{},{...h.payload(),requestId:''},{...h.payload(),campaignId:''}])await assert.rejects(h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:payload}));assert.equal(h.posts.length,0);assert.equal(h.control.flushes,0);assert(!h.trace.includes('save'));
});
test('flush failures and writer loss leave the global mutation gate unlocked without posting',async()=>{
 for(const kind of ['failed','throws','writer']){const h=setup();h.control.onFlush=async()=>{if(kind==='throws')throw Error('flush unavailable');if(kind==='writer')h.control.status.writable=false;return{ok:kind!=='failed'};};await assert.rejects(h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:h.payload()}));assert.equal(h.posts.length,0);assert.equal(h.c.fieldActionPending,false);assert.equal(h.control.queued,1);}
});
test('completion waits for the committed save revision and leaves unconfirmed operations retryable',async()=>{
 const h=setup(),pause=deferred();let refreshes=0;h.control.onPost=async()=>({ok:true,revision:9});h.control.onRefresh=async()=>{if(++refreshes===1){h.control.status.revision=8;return{ok:true};}await pause.promise;h.control.status.revision=9;return{ok:true};};let complete=false;const task=h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:h.payload()}).then(result=>{complete=true;return result;});await until(()=>h.control.refreshes===2);assert(!complete&&h.c.fieldActionPending);pause.resolve();assert((await task).ok);assert(!h.c.fieldActionPending);
 const pending=setup();pending.control.onPost=async()=>({ok:true,revision:10});await assert.rejects(pending.c.requestTroopGarrisons('/troop-garrisons/recall',{method:'POST',data:pending.payload()}),e=>e.code==='TROOP_GARRISON_RECONCILE_PENDING'&&e.retryable);assert.equal(pending.c.fieldActionPending,false);assert.equal(pending.control.refreshes,3);assert.deepEqual([...pending.stored.keys()],['save'],'The UI owns the sole durable operation record');
});
test('acknowledged troop changes remain retryable when reconciliation returns 401 or 409',async()=>{
 for(const status of [401,409])for(const action of ['send','recall']){
  const h=setup(),payload=h.payload(),error=Object.assign(Error('reconciliation unavailable'),{status,code:status===401?'UNAUTHORIZED':'REVISION_CONFLICT',retryable:false});
  h.control.onPost=async()=>({ok:true,revision:9,result:{requestId:payload.requestId}});h.control.onRefresh=async()=>{throw error;};
  await assert.rejects(h.c.requestTroopGarrisons('/troop-garrisons/'+action,{method:'POST',data:payload}),e=>e===error&&e.status===status&&e.retryable===true);
  assert.equal(h.posts.length,1);assert.equal(h.control.refreshes,2);assert.equal(h.c.fieldActionPending,false);assert.equal(h.control.queued,1);
  h.control.onPost=async()=>({ok:true,revision:9,idempotent:true});h.control.onRefresh=async()=>{h.control.status.revision=9;return{ok:true};};
  assert((await h.c.requestTroopGarrisons('/troop-garrisons/'+action,{method:'POST',data:payload})).idempotent);assert.equal(h.posts[1].options.data.requestId,payload.requestId);
 }
});
test('a definite API rejection before acknowledgement does not become a retryable committed result',async()=>{
 for(const retryable of [undefined,false]){
  const h=setup(),error=Object.assign(Error('castle occupied'),{status:409,code:'CASTLE_OCCUPIED',...(retryable===undefined?{}:{retryable})});
  h.control.onPost=async()=>{throw error;};
  await assert.rejects(h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:h.payload()}),e=>e===error&&e.status===409&&e.code==='CASTLE_OCCUPIED'&&e.retryable===retryable);
  assert.equal(h.posts.length,1);assert.equal(h.control.refreshes,1);assert.equal(h.c.fieldActionPending,false);assert.equal(h.control.queued,1);
 }
});
test('a lost response is retried with the exact caller receipt and updated writer revision',async()=>{
 const h=setup(),payload=h.payload();h.control.onPost=async()=>{throw Error('lost troop reply');};await assert.rejects(h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:payload}),/lost troop reply/);assert.equal(h.c.fieldActionPending,false);h.control.status.revision=8;h.control.onPost=async()=>({ok:true,revision:8,idempotent:true});assert((await h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:payload})).idempotent);assert.equal(h.posts[0].options.data.requestId,h.posts[1].options.data.requestId);assert.equal(h.posts[1].options.data.campaignId,payload.campaignId);assert.equal(h.posts[1].options.data.expectedRevision,8);assert.deepEqual([...h.stored.keys()],['save']);
});
test('actor, role and campaign switches before sending stop the old request at clock and flush boundaries',async()=>{
 for(const stage of ['clock','flush'])for(const kind of ['actor','role','campaign']){const h=setup(),pause=deferred();if(stage==='clock')h.control.onClockRefresh=()=>pause.promise;else h.control.onFlush=()=>pause.promise;const task=h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:h.payload()});await until(()=>stage==='clock'?h.trace.includes('clock-refresh'):h.control.flushes>0);if(kind==='actor')h.control.user={id:'player-b'};if(kind==='role')h.c.roleEpoch++;if(kind==='campaign')h.c.game.state.walking.campaignId='replacement-campaign';pause.resolve({ok:true});await assert.rejects(task,e=>e.code==='STALE_IDENTITY');assert.equal(h.posts.length,0);assert.equal(h.c.fieldActionPending,false);assert.equal(h.acceptedClocks.length,0);}
});
test('actor, role and campaign switches after POST reject stale adoption and avoid recovery refresh in the new context',async()=>{
 for(const kind of ['actor','role','campaign']){const h=setup(),pause=deferred();h.control.onPost=()=>pause.promise;const task=h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:h.payload()});await until(()=>h.posts.length===1);if(kind==='actor')h.control.user={id:'player-b'};if(kind==='role')h.c.roleEpoch++;if(kind==='campaign')h.c.game.state.walking.campaignId='replacement-campaign';pause.resolve({ok:true,revision:9,clock:{...h.control.clock,revision:2}});await assert.rejects(task,e=>e.code==='STALE_IDENTITY');assert.equal(h.acceptedClocks.length,0);assert.equal(h.control.refreshes,0);assert.equal(h.c.fieldActionPending,false);}
});
test('one global pending gate prevents concurrent asset actions and is released after the original result',async()=>{
 const h=setup(),pause=deferred();h.control.onPost=()=>pause.promise;const task=h.c.requestTroopGarrisons('/troop-garrisons/send',{method:'POST',data:h.payload()});await until(()=>h.posts.length===1);assert(h.c.fieldActionPending);await assert.rejects(h.c.requestTroopGarrisons('/troop-garrisons/recall',{method:'POST',data:{...h.payload(),requestId:'second'}}));assert.equal(h.posts.length,1);assert(h.c.fieldActionPending);pause.resolve({ok:true,revision:7});await task;assert.equal(h.c.fieldActionPending,false);assert.equal(h.control.queued,1);
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' actual troop-garrison bridge checks passed. No live writes.');})().catch(error=>{console.error(error);process.exitCode=1;});
