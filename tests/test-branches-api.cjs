/* Exercise the real exported social transport. All responses stay local. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../social.js'),'utf8');
const PLAYER='u_'+'1'.repeat(32),TOKEN='a'.repeat(64),copy=value=>JSON.parse(JSON.stringify(value));
const body={parentCastleId:'edo',direction:'north',requestId:'branch-request',campaignId:'campaign-one',sequence:0,deviceId:'branch-tab',expectedRevision:7};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function harness({guest=false,admin=false,staff=false}={}){
 const calls=[],observed=[];
 let transport=async()=>({data:{ok:true,result:{requestId:body.requestId},revision:8}}),started=true,flushes=0;
 const status={linked:true,ready:true,writable:true,revision:7};
 const scope={console,URL,URLSearchParams,AbortController,Date,Intl,setTimeout,clearTimeout,
  document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://fixture.invalid',
  SengokuBridge:{hasStarted:()=>started,setRoleAccess(){}},
  SengokuCloudSync:{getStatus:()=>({...status}),getDevice:()=>({id:'branch-tab'}),flush:async()=>{flushes++;return{ok:true};},observeBranchSnapshot:result=>observed.push(copy(result))},
  fetch:async(url,options)=>{
   calls.push({url,method:options.method,headers:copy(options.headers),body:options.body?JSON.parse(options.body):null});
   const response=await transport(url,options),code=response.status||200;
   return{ok:code>=200&&code<300,status:code,json:async()=>response.data};
  }
 };
 scope.window=scope;vm.createContext(scope);
 vm.runInContext(source.replace('global.SengokuSocial={open','global.__branchApiTest={s,changeIdentity(){authEpoch++;s.identity={id:"other-player",token:"b".repeat(64)};s.user={id:"other-player",name:"交代した領主",isAdmin:false,isStaff:false};},changeRole(){privilegeEpoch++;s.user.isStaff=!s.user.isStaff;},pending(){accountEpoch++;s.accountAccessPending={};},hold(){recoveryHeld=true;}};global.SengokuSocial={open'),scope);
 const test=scope.__branchApiTest;
 if(!guest){test.s.identity={id:PLAYER,token:TOKEN};test.s.user={id:PLAYER,name:'試験領主',isAdmin:admin,isStaff:staff};}
 return{api:scope.SengokuSocial,test,calls,status,observed,setTransport:value=>transport=value,setStarted:value=>started=value,flushes:()=>flushes};
}

const tests=[],test=(name,run)=>tests.push([name,run]);
test('the exported branch facade forces current authentication and exact paid payloads',async()=>{
 const h=harness({admin:true});await h.api.branchRequest('/branches/build',{method:'POST',data:body,auth:false,token:'forged'});assert.equal(h.calls[0].url,'https://fixture.invalid/api/v1/branches/build');assert.equal(h.calls[0].headers.Authorization,'Bearer '+TOKEN);assert.deepEqual(h.calls[0].body,body);assert.equal(h.flushes(),0);
});
test('follower reads are private and guest reads never reach the network',async()=>{
 const h=harness();h.status.writable=false;await h.api.branchRequest('/branches');assert.equal(h.calls.length,1);const guest=harness({guest:true});await assert.rejects(guest.api.branchRequest('/branches'),error=>error.code==='BRANCH_IDENTITY_REQUIRED');assert.equal(guest.calls.length,0);
});
test('route and method allowlists reject query spoofing, nested targets and traversal',async()=>{
 const h=harness();for(const [route,method]of [['/branches?playerId=other','GET'],['/branches/../admin','POST'],['/branches/build/extra','POST'],['/branches/repair','GET'],['/branches','POST'],['/branches/upgrade','DELETE']])await assert.rejects(h.api.branchRequest(route,{method,data:body}),error=>error.status===400);assert.equal(h.calls.length,0);
});
test('writer revision, device, campaign and branch sequence are required before HTTP',async()=>{
 for(const data of [{},{...body,deviceId:'other'},{...body,expectedRevision:6},{...body,campaignId:''},{...body,sequence:-1},{...body,sequence:'0'}]){const h=harness();await assert.rejects(h.api.branchRequest('/branches/build',{method:'POST',data}),error=>error.code==='BRANCH_SYNC_REQUIRED'&&error.retryable===true);assert.equal(h.calls.length,0);}
 for(const key of ['linked','ready','writable']){const h=harness();h.status[key]=false;await assert.rejects(h.api.branchRequest('/branches/repair',{method:'POST',data:body}),error=>error.code==='BRANCH_SYNC_REQUIRED');assert.equal(h.calls.length,0);}
});
test('account and role changes discard in-flight branch state and construction replies',async()=>{
 for(const change of ['changeIdentity','changeRole','pending','hold'])for(const [route,options]of [['/branches',{}],['/branches/upgrade',{method:'POST',data:body}]]){const h=harness(),pause=deferred();h.setTransport(()=>pause.promise);const task=h.api.branchRequest(route,options);h.test[change]();pause.resolve({data:{ok:true,revision:8,sequence:1}});await assert.rejects(task,error=>error.code==='STALE_IDENTITY');assert.equal(h.observed.length,0,'A stale transport must not forward branch authority');}
});
test('verified private snapshots reach the coordinator before the direct API promise resolves',async()=>{
 const h=harness(),snapshot={ok:true,user:{id:PLAYER,isAdmin:false,isStaff:false},save:{state:{walking:{campaignId:body.campaignId}}},branchResolvedElapsedMs:720000,revision:8};h.setTransport(async()=>({data:snapshot}));const result=await h.api.branchRequest('/branches');assert.deepEqual(h.observed,[snapshot]);assert.deepEqual(copy(result),snapshot);
});
test('authoritative branch conflict codes are retained for safe retry and reconciliation',async()=>{
 const h=harness();h.setTransport(async()=>({status:409,data:{ok:false,error:{code:'BRANCH_STATE_CHANGED',message:'支拠点の最新情報を確認してください。'}}}));await assert.rejects(h.api.branchRequest('/branches/build',{method:'POST',data:body}),error=>error.status===409&&error.code==='BRANCH_STATE_CHANGED');
});
test('facility routes send exact facility targets with authentication and the unchanged durable writer contract',async()=>{
 for(const action of ['build-facility','upgrade-facility']){
  const h=harness({admin:true}),payload={branchId:'edo_north',facilityId:'farm',requestId:'facility-order',campaignId:body.campaignId,sequence:3,deviceId:body.deviceId,expectedRevision:7};
  await h.api.branchRequest('/branches/'+action,{method:'POST',data:payload,auth:false,token:'forged'});assert.equal(h.calls[0].url,'https://fixture.invalid/api/v1/branches/'+action);assert.equal(h.calls[0].headers.Authorization,'Bearer '+TOKEN);assert.deepEqual(h.calls[0].body,payload);
  h.status.writable=false;await assert.rejects(h.api.branchRequest('/branches/'+action,{method:'POST',data:payload}),error=>error.code==='BRANCH_SYNC_REQUIRED');assert.equal(h.calls.length,1);
 }
});
test('facility command routes reject reads, suffixes and query injection before transport',async()=>{
 const h=harness();for(const[route,method]of [['/branches/build-facility','GET'],['/branches/build-facility/extra','POST'],['/branches/upgrade-facility?playerId=other','POST'],['/branches/remove-facility','POST']])await assert.rejects(h.api.branchRequest(route,{method,data:body}),error=>error.status===400);assert.equal(h.calls.length,0);
});
test('commander placement and removal use the same guarded durable branch transport',async()=>{
 for(const action of ['assign-commander','remove-commander']){const h=harness(),payload={branchId:'nijo_north',officerId:'officer-one',requestId:'commander-order',campaignId:body.campaignId,sequence:3,deviceId:body.deviceId,expectedRevision:7};await h.api.branchRequest('/branches/'+action,{method:'POST',data:payload,auth:false,token:'forged'});assert.deepEqual(h.calls[0].body,payload);assert.equal(h.calls[0].headers.Authorization,'Bearer '+TOKEN);await assert.rejects(h.api.branchRequest('/branches/'+action,{method:'GET'}),e=>e.status===400);h.status.writable=false;await assert.rejects(h.api.branchRequest('/branches/'+action,{method:'POST',data:payload}),e=>e.code==='BRANCH_SYNC_REQUIRED');assert.equal(h.calls.length,1);}
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' real branch transport checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
