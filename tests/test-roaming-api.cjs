/* Exercise the real exported social transport. All responses stay local. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../social.js'),'utf8');
const PLAYER='u_'+'1'.repeat(32),TOKEN='a'.repeat(64),copy=value=>JSON.parse(JSON.stringify(value));
const body={encounterId:'road_scouts',tactic:'balanced',troops:1000,requestId:'cpu-request',campaignId:'campaign-one',sequence:0,deviceId:'cpu-tab',expectedRevision:7};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function harness({guest=false,admin=false,staff=false}={}){
 const calls=[];
 let transport=async()=>({data:{ok:true,battle:{requestId:body.requestId},revision:8}}),started=true,flushes=0;
 const status={linked:true,ready:true,writable:true,revision:7};
 const scope={console,URL,URLSearchParams,AbortController,Date,Intl,setTimeout,clearTimeout,
  document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://fixture.invalid',
  SengokuBridge:{hasStarted:()=>started,setRoleAccess(){}},
  SengokuCloudSync:{getStatus:()=>({...status}),getDevice:()=>({id:'cpu-tab'}),flush:async()=>{flushes++;return{ok:true};}},
  fetch:async(url,options)=>{
   calls.push({url,method:options.method,headers:copy(options.headers),body:options.body?JSON.parse(options.body):null});
   const response=await transport(url,options),code=response.status||200;
   return{ok:code>=200&&code<300,status:code,json:async()=>response.data};
  }
 };
 scope.window=scope;vm.createContext(scope);
 vm.runInContext(source.replace('global.SengokuSocial={open','global.__roamingApiTest={s,changeIdentity(){authEpoch++;s.identity={id:"other-player",token:"b".repeat(64)};s.user={id:"other-player",name:"交代した領主",isAdmin:false,isStaff:false};},changeRole(){privilegeEpoch++;s.user.isStaff=!s.user.isStaff;},pending(){accountEpoch++;s.accountAccessPending={};},hold(){recoveryHeld=true;}};global.SengokuSocial={open'),scope);
 const test=scope.__roamingApiTest;
 if(!guest){test.s.identity={id:PLAYER,token:TOKEN};test.s.user={id:PLAYER,name:'試験領主',isAdmin:admin,isStaff:staff};}
 return{api:scope.SengokuSocial,test,calls,status,setTransport:value=>transport=value,setStarted:value=>started=value,flushes:()=>flushes};
}
const tests=[];const test=(name,run)=>tests.push({name,run});

test('the real exported facade sends authenticated CPU battles for ordinary, staff and admin players',async()=>{
 for(const roles of [{},{staff:true},{admin:true}]){
  const h=harness(roles);assert.equal(typeof h.api.roamingRequest,'function');
  const result=await h.api.roamingRequest('/roaming/battle',{method:'POST',data:body,auth:false,token:'forged-token'});
  assert.equal(result.battle.requestId,body.requestId);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].url,'https://fixture.invalid/api/v1/roaming/battle');
  assert.equal(h.calls[0].headers.Authorization,'Bearer '+TOKEN);assert.deepEqual(h.calls[0].body,body);
  assert.equal(h.flushes(),0,'The campaign bridge already owns flush and reconciliation');
 }
});
test('history is private but available to authenticated follower devices',async()=>{
 const h=harness();h.status.writable=false;h.setTransport(async()=>({data:{ok:true,battles:[]}}));
 await h.api.roamingRequest('/roaming/history');assert.equal(h.calls[0].headers.Authorization,'Bearer '+TOKEN);
 const guest=harness({guest:true});
 for(const [route,options]of [['/roaming/history',{}],['/roaming/battle',{method:'POST',data:body}]])await assert.rejects(guest.api.roamingRequest(route,options),e=>e.status===403);
 assert.equal(guest.calls.length,0);
});
test('route and method allowlists reject unrelated, malformed and traversal requests',async()=>{
 const h=harness();
 for(const [route,method]of [['/admin/mail','POST'],['/roaming/history?playerId=other','GET'],['/roaming/../admin/staff','POST'],['/roaming/battle','GET'],['/roaming/battle','DELETE'],['/roaming/history','POST']])await assert.rejects(h.api.roamingRequest(route,{method,data:body}),e=>e.status===400);
 assert.equal(h.calls.length,0);
});
test('missing or stale writer metadata cannot bypass the transaction bridge',async()=>{
 for(const data of [{},{...body,deviceId:'other-tab'},{...body,expectedRevision:6},{...body,expectedRevision:'7'}]){
  const h=harness();await assert.rejects(h.api.roamingRequest('/roaming/battle',{method:'POST',data}),e=>e.code==='ROAMING_SYNC_REQUIRED');assert.equal(h.calls.length,0);
 }
 for(const key of ['linked','ready','writable']){
  const h=harness();h.status[key]=false;await assert.rejects(h.api.roamingRequest('/roaming/battle',{method:'POST',data:body}),e=>e.code==='ROAMING_SYNC_REQUIRED');assert.equal(h.calls.length,0);
 }
 const h=harness();h.setStarted(false);await assert.rejects(h.api.roamingRequest('/roaming/battle',{method:'POST',data:body}),/本拠を選び/);assert.equal(h.calls.length,0);
});
test('unverified, mismatched, recovering, suspended and revalidating players cannot send',async()=>{
 for(const scenario of ['unverified','mismatched','hold','banned','pending']){
  const h=harness();
  if(scenario==='unverified')h.test.s.user=null;
  else if(scenario==='mismatched')h.test.s.user.id='another-player';
  else if(scenario==='banned')h.test.s.accountBanned={playerId:PLAYER};
  else h.test[scenario]();
  await assert.rejects(h.api.roamingRequest('/roaming/battle',{method:'POST',data:body}),e=>e.status===403);assert.equal(h.calls.length,0);
 }
});
test('identity, privilege or account changes discard in-flight history and battle responses',async()=>{
 for(const change of ['changeIdentity','changeRole','pending','hold'])for(const [route,options]of [['/roaming/history',{}],['/roaming/battle',{method:'POST',data:body}]]){
  const h=harness(),wait=deferred();h.setTransport(()=>wait.promise);
  const request=h.api.roamingRequest(route,options);h.test[change]();wait.resolve({data:{ok:true,battle:{requestId:body.requestId},revision:8}});
  await assert.rejects(request,e=>e.code==='STALE_IDENTITY');
 }
});
test('server conflict codes survive transport so the controller can reconcile its pending operation',async()=>{
 const h=harness();h.setTransport(async()=>({status:409,data:{ok:false,error:{code:'ROAMING_STATE_CHANGED',message:'最新の本拠を確認してください。'}}}));
 await assert.rejects(h.api.roamingRequest('/roaming/battle',{method:'POST',data:body}),e=>e.status===409&&e.code==='ROAMING_STATE_CHANGED');
 assert.equal(h.calls.length,1);
});

test('public national map can be read by guests without sending private authentication',async()=>{
 for(const roles of [{guest:true},{},{staff:true},{admin:true}]){const h=harness(roles);await h.api.roamingRequest('/roaming/deployment');await h.api.roamingRequest('/roaming/map?castleId=edo');assert.equal(h.calls.length,2);assert(h.calls.every(c=>!c.headers.Authorization));}
});
test('ordinary users cannot read proposals or attempt any management write',async()=>{
 const h=harness();for(const [route,method]of [['/staff/roaming','GET'],['/staff/roaming/proposals','POST'],['/admin/roaming/deployment','POST'],['/admin/roaming/proposals/rp_test/approve','POST'],['/staff/roaming/proposals/rp_test/cancel','POST']])await assert.rejects(h.api.roamingRequest(route,{method,data:{}}),e=>e.status===403);assert.equal(h.calls.length,0);
});
test('staff transport allows proposals and own-cancel route but never admin apply or approval',async()=>{
 const h=harness({staff:true});await h.api.roamingRequest('/staff/roaming');await h.api.roamingRequest('/staff/roaming/proposals',{method:'POST',data:{requestId:'proposal-one'}});await h.api.roamingRequest('/staff/roaming/proposals/rp_test/cancel',{method:'POST',data:{requestId:'cancel-one'}});for(const route of ['/admin/roaming/deployment','/admin/roaming/proposals/rp_test/approve','/admin/roaming/proposals/rp_test/reject'])await assert.rejects(h.api.roamingRequest(route,{method:'POST',data:{}}),e=>e.status===403);assert.equal(h.calls.length,3);assert(h.calls.every(c=>c.headers.Authorization==='Bearer '+TOKEN));
});
test('admin management uses verified actor and stale private results are discarded on demotion',async()=>{
 const h=harness({admin:true});await h.api.roamingRequest('/admin/roaming/deployment',{method:'POST',data:{requestId:'apply-one'}});assert.equal(h.calls.length,1);const wait=deferred();h.setTransport(()=>wait.promise);const read=h.api.roamingRequest('/staff/roaming');h.test.changeRole();h.test.s.user.isAdmin=false;wait.resolve({data:{ok:true,proposals:[{id:'private'}]}});await assert.rejects(read,e=>e.code==='STALE_IDENTITY');
});
test('map query and management method whitelist reject caller-selected arbitrary routes',async()=>{
 const h=harness({admin:true});for(const [route,method]of [['/roaming/map?castleId=edo&admin=true','GET'],['/roaming/map?castleId=../admin','GET'],['/staff/roaming','POST'],['/admin/roaming/deployment','GET'],['/admin/roaming/proposals/rp_test/apply','POST']])await assert.rejects(h.api.roamingRequest(route,{method,data:{}}),e=>e.status===400);assert.equal(h.calls.length,0);
});

(async()=>{for(const {name,run}of tests){await run();console.log('PASS '+name);}console.log(tests.length+' real social CPU transport checks passed; no live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
