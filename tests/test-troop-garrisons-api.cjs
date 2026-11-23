/* Real social transport; local responses only. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../social.js'),'utf8'),PLAYER='u_'+'2'.repeat(32),TOKEN='b'.repeat(64),copy=value=>JSON.parse(JSON.stringify(value));
const payload={castleId:'osaka',troops:200,requestId:'garrison-request',campaignId:'campaign-current',deviceId:'garrison-tab',expectedRevision:7};
const deferred=()=>{let resolve;return{promise:new Promise(r=>resolve=r),resolve};};
function harness({guest=false}={}){
 const calls=[],observed=[],refreshes=[];let transport=async()=>({data:{ok:true,revision:8}}),started=true,disposed=0;
 const status={linked:true,ready:true,writable:true,revision:7,message:''},access={ready:true,writable:true,message:''},state={walking:{campaignId:payload.campaignId}};
 const scope={console,URL,URLSearchParams,AbortController,Date,Intl,setTimeout,clearTimeout,document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://fixture.invalid',
  SengokuBridge:{hasStarted:()=>started,getState:()=>state,getEventAccess:()=>({...access}),getTroopGarrisonAccess:()=>({...access}),setRoleAccess(){}},
  SengokuCloudSync:{getStatus:()=>({...status}),getDevice:()=>({id:'garrison-tab'}),observeBranchSnapshot:result=>observed.push(copy(result))},
  SengokuTroopGarrisons:{refreshIdentity:()=>refreshes.push(true),dispose:()=>disposed++},
  fetch:async(url,options)=>{calls.push({url,method:options.method,headers:copy(options.headers),body:options.body?JSON.parse(options.body):null});const result=await transport(url,options),code=result.status||200;return{ok:code>=200&&code<300,status:code,json:async()=>result.data};}
 };
 scope.window=scope;vm.createContext(scope);vm.runInContext(source.replace('global.SengokuSocial={open','global.__garrisonApiTest={s,acceptUser,renderSyncStatus,changeIdentity(){authEpoch++;s.identity={id:"other-player",token:"c".repeat(64)};s.user={id:"other-player",name:"交代領主",isAdmin:false,isStaff:false};},changeRole(){privilegeEpoch++;s.user.isStaff=!s.user.isStaff;},pending(){accountEpoch++;s.accountAccessPending={};},hold(){recoveryHeld=true;}};global.SengokuSocial={open'),scope);
 const test=scope.__garrisonApiTest;if(!guest){test.s.identity={id:PLAYER,token:TOKEN};test.s.user={id:PLAYER,name:'試験領主',isAdmin:false,isStaff:false};}
 return{api:scope.SengokuSocial,test,calls,observed,status,state,access,refreshes,disposed:()=>disposed,setTransport:value=>transport=value,setStarted:value=>started=value};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('send and recall force current authentication, exact caller IDs and writer metadata without a branch sequence',async()=>{
 for(const action of ['send','recall']){const h=harness(),data={...payload,campaignId:'prior-campaign-receipt'};await h.api.troopGarrisonRequest('/troop-garrisons/'+action,{method:'POST',data,auth:false,token:'forged'});assert.equal(h.calls[0].url,'https://fixture.invalid/api/v1/troop-garrisons/'+action);assert.equal(h.calls[0].headers.Authorization,'Bearer '+TOKEN);assert.deepEqual(h.calls[0].body,data);assert(!Object.hasOwn(h.calls[0].body,'sequence'));}
});
test('private follower reads work while guests, pending identity and bans never reach HTTP',async()=>{
 const h=harness();h.status.writable=false;await h.api.troopGarrisonRequest('/troop-garrisons',{data:{ignored:'read-body'}});assert.equal(h.calls.length,1);assert.equal(h.calls[0].body,null);
 for(const kind of ['guest','pending','hold','banned']){const x=harness({guest:kind==='guest'});if(['pending','hold'].includes(kind))x.test[kind]();if(kind==='banned')x.test.s.accountBanned={};await assert.rejects(x.api.troopGarrisonRequest('/troop-garrisons'),e=>e.code==='TROOP_GARRISON_IDENTITY_REQUIRED');assert.equal(x.calls.length,0);}
});
test('the context publishes only current identity, campaign and read/write readiness',()=>{
 const h=harness(),context=copy(h.api.getTroopGarrisonContext());assert.equal(context.playerId,PLAYER);assert.equal(context.user.id,PLAYER);assert.equal(context.campaignId,payload.campaignId);assert(context.readable&&context.writable);assert(!JSON.stringify(context).includes(TOKEN));for(const key of ['epoch','accountEpoch','privilegeEpoch'])assert.equal(typeof context[key],'number');
 h.status.writable=false;assert(h.api.getTroopGarrisonContext().readable);assert(!h.api.getTroopGarrisonContext().writable);h.status.writable=true;h.access.writable=false;h.access.message='保存を確認中';assert.equal(h.api.getTroopGarrisonContext().reason,'保存を確認中');h.access.readable=false;assert(!h.api.getTroopGarrisonContext().readable);h.access.readable=true;h.status.ready=false;assert(!h.api.getTroopGarrisonContext().readable);h.status.ready=true;h.setStarted(false);assert(!h.api.getTroopGarrisonContext().readable);
});
test('exact path and method allowlists block query spoofing, traversal, suffixes and unrelated actions',async()=>{
 const h=harness();for(const [route,method]of [['/troop-garrisons?playerId=other','GET'],['/troop-garrisons/send?castleId=edo','POST'],['/troop-garrisons/send/extra','POST'],['/troop-garrisons/../admin','POST'],['/troop-garrisons/recall','GET'],['/troop-garrisons','POST'],['/troop-garrisons/send','DELETE'],['/troop-garrisons/remove','POST']])await assert.rejects(h.api.troopGarrisonRequest(route,{method,data:payload}),e=>e.status===400);assert.equal(h.calls.length,0);
});
test('write metadata and writable synchronized checkpoints are checked before the network',async()=>{
 for(const data of [{},{...payload,deviceId:'other'},{...payload,expectedRevision:6},{...payload,expectedRevision:'7'},{...payload,campaignId:''}]){const h=harness();await assert.rejects(h.api.troopGarrisonRequest('/troop-garrisons/send',{method:'POST',data}),e=>e.code==='TROOP_GARRISON_SYNC_REQUIRED'&&e.retryable);assert.equal(h.calls.length,0);}
 for(const key of ['linked','ready','writable']){const h=harness();h.status[key]=false;await assert.rejects(h.api.troopGarrisonRequest('/troop-garrisons/recall',{method:'POST',data:payload}),e=>e.code==='TROOP_GARRISON_SYNC_REQUIRED');assert.equal(h.calls.length,0);}
});
test('in-flight identity, privilege, recovery, account and campaign switches discard private replies',async()=>{
 for(const change of ['changeIdentity','changeRole','pending','hold','campaign'])for(const [route,options]of [['/troop-garrisons',{}],['/troop-garrisons/send',{method:'POST',data:payload}]]){const h=harness(),pause=deferred();h.setTransport(()=>pause.promise);const task=h.api.troopGarrisonRequest(route,options);if(change==='campaign')h.state.walking.campaignId='new-campaign';else h.test[change]();pause.resolve({data:{ok:true,revision:8}});await assert.rejects(task,e=>e.code==='STALE_IDENTITY');if(change!=='campaign')assert.equal(h.observed.length,0);}
});
test('authoritative conflict codes and successful snapshots remain intact for bridge reconciliation',async()=>{
 const h=harness();h.setTransport(async()=>({status:409,data:{ok:false,error:{code:'TROOP_STATE_CHANGED',message:'最新の兵を確認してください。'}}}));await assert.rejects(h.api.troopGarrisonRequest('/troop-garrisons/send',{method:'POST',data:payload}),e=>e.status===409&&e.code==='TROOP_STATE_CHANGED');
 const snapshot={ok:true,user:{id:PLAYER,isAdmin:false,isStaff:false},save:{state:{walking:{campaignId:payload.campaignId}}},revision:8};h.setTransport(async()=>({data:snapshot}));assert.deepEqual(copy(await h.api.troopGarrisonRequest('/troop-garrisons')),snapshot);assert.deepEqual(h.observed,[snapshot]);
});
test('actual role, identity and sync handlers refresh or dispose the garrison UI',async()=>{
 const h=harness();h.test.acceptUser({...h.test.s.user,isStaff:true});assert(h.refreshes.length>0);const before=h.refreshes.length;h.test.renderSyncStatus({...h.status,writable:false});assert(h.refreshes.length>before);h.test.acceptUser(null);assert.equal(h.api.getTroopGarrisonContext().readable,false);await h.api.dispose();assert.equal(h.disposed(),1);
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' real troop-garrison transport checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
