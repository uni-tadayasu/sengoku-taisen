/* Exercise the real exported social transport. All responses stay local. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../social.js'),'utf8');
const PLAYER='u_'+'1'.repeat(32),TOKEN='a'.repeat(64),copy=value=>JSON.parse(JSON.stringify(value));
const body={sourceCastleId:'edo',count:10,requestId:'covert-request',campaignId:'campaign-one',sequence:0,deviceId:'covert-tab',expectedRevision:7};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function harness({guest=false,admin=false,staff=false}={}){
 const calls=[];
 let transport=async()=>({data:{ok:true,battle:{requestId:body.requestId},revision:8}}),started=true,flushes=0;
 const status={linked:true,ready:true,writable:true,revision:7};
 const scope={console,URL,URLSearchParams,AbortController,Date,Intl,setTimeout,clearTimeout,
  document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://fixture.invalid',
  SengokuBridge:{hasStarted:()=>started,setRoleAccess(){}},
  SengokuCloudSync:{getStatus:()=>({...status}),getDevice:()=>({id:'covert-tab'}),flush:async()=>{flushes++;return{ok:true};}},
  fetch:async(url,options)=>{
   calls.push({url,method:options.method,headers:copy(options.headers),body:options.body?JSON.parse(options.body):null});
   const response=await transport(url,options),code=response.status||200;
   return{ok:code>=200&&code<300,status:code,json:async()=>response.data};
  }
 };
 scope.window=scope;vm.createContext(scope);
 vm.runInContext(source.replace('global.SengokuSocial={open','global.__covertApiTest={s,changeIdentity(){authEpoch++;s.identity={id:"other-player",token:"b".repeat(64)};s.user={id:"other-player",name:"交代した領主",isAdmin:false,isStaff:false};},changeRole(){privilegeEpoch++;s.user.isStaff=!s.user.isStaff;},pending(){accountEpoch++;s.accountAccessPending={};},hold(){recoveryHeld=true;}};global.SengokuSocial={open'),scope);
 const test=scope.__covertApiTest;
 if(!guest){test.s.identity={id:PLAYER,token:TOKEN};test.s.user={id:PLAYER,name:'試験領主',isAdmin:admin,isStaff:staff};}
 return{api:scope.SengokuSocial,test,calls,status,setTransport:value=>transport=value,setStarted:value=>started=value,flushes:()=>flushes};
}
const tests=[];const test=(name,run)=>tests.push({name,run});

test('the real exported facade sends authenticated covert battles for ordinary, staff and admin players',async()=>{
 for(const roles of [{},{staff:true},{admin:true}]){
  const h=harness(roles);assert.equal(typeof h.api.covertRequest,'function');
  const result=await h.api.covertRequest('/covert/hire',{method:'POST',data:body,auth:false,token:'forged-token'});
  assert.equal(result.battle.requestId,body.requestId);assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].url,'https://fixture.invalid/api/v1/covert/hire');
  assert.equal(h.calls[0].headers.Authorization,'Bearer '+TOKEN);assert.deepEqual(h.calls[0].body,body);
  assert.equal(h.flushes(),0,'The campaign bridge already owns flush and reconciliation');
 }
});
test('history is private but available to authenticated follower devices',async()=>{
 const h=harness();h.status.writable=false;h.setTransport(async()=>({data:{ok:true,battles:[]}}));
 await h.api.covertRequest('/covert');await h.api.covertRequest('/covert?cursor=lord-b&limit=100');assert.equal(h.calls[0].headers.Authorization,'Bearer '+TOKEN);
 const guest=harness({guest:true});
 for(const [route,options]of [['/covert',{}],['/covert/hire',{method:'POST',data:body}]])await assert.rejects(guest.api.covertRequest(route,options),e=>e.status===403);
 assert.equal(guest.calls.length,0);
});
test('route and method allowlists reject unrelated, malformed and traversal requests',async()=>{
 const h=harness();
 for(const [route,method]of [['/admin/mail','POST'],['/covert?playerId=other','GET'],['/covert/../admin/staff','POST'],['/covert/hire','GET'],['/covert/hire','DELETE'],['/covert','POST']])await assert.rejects(h.api.covertRequest(route,{method,data:body}),e=>e.status===400);
 assert.equal(h.calls.length,0);
});
test('missing or stale writer metadata cannot bypass the transaction bridge',async()=>{
 for(const data of [{},{...body,deviceId:'other-tab'},{...body,expectedRevision:6},{...body,expectedRevision:'7'}]){
  const h=harness();await assert.rejects(h.api.covertRequest('/covert/hire',{method:'POST',data}),e=>e.code==='COVERT_SYNC_REQUIRED'&&e.retryable===true);assert.equal(h.calls.length,0);
 }
 for(const key of ['linked','ready','writable']){
  const h=harness();h.status[key]=false;await assert.rejects(h.api.covertRequest('/covert/hire',{method:'POST',data:body}),e=>e.code==='COVERT_SYNC_REQUIRED'&&e.retryable===true);assert.equal(h.calls.length,0);
 }
 const h=harness();h.setStarted(false);await assert.rejects(h.api.covertRequest('/covert/hire',{method:'POST',data:body}),/本拠を選び/);assert.equal(h.calls.length,0);
});
test('unverified, mismatched, recovering, suspended and revalidating players cannot send',async()=>{
 for(const scenario of ['unverified','mismatched','hold','banned','pending']){
  const h=harness();
  if(scenario==='unverified')h.test.s.user=null;
  else if(scenario==='mismatched')h.test.s.user.id='another-player';
  else if(scenario==='banned')h.test.s.accountBanned={playerId:PLAYER};
  else h.test[scenario]();
  await assert.rejects(h.api.covertRequest('/covert/hire',{method:'POST',data:body}),e=>e.status===403);assert.equal(h.calls.length,0);
 }
});
test('identity, privilege or account changes discard in-flight history and battle responses',async()=>{
 for(const change of ['changeIdentity','changeRole','pending','hold'])for(const [route,options]of [['/covert',{}],['/covert/hire',{method:'POST',data:body}]]){
  const h=harness(),wait=deferred();h.setTransport(()=>wait.promise);
  const request=h.api.covertRequest(route,options);h.test[change]();wait.resolve({data:{ok:true,battle:{requestId:body.requestId},revision:8}});
  await assert.rejects(request,e=>e.code==='STALE_IDENTITY');
 }
});
test('server conflict codes survive transport so the controller can reconcile its pending operation',async()=>{
 const h=harness();h.setTransport(async()=>({status:409,data:{ok:false,error:{code:'COVERT_STATE_CHANGED',message:'最新の本拠を確認してください。'}}}));
 await assert.rejects(h.api.covertRequest('/covert/hire',{method:'POST',data:body}),e=>e.status===409&&e.code==='COVERT_STATE_CHANGED');
 assert.equal(h.calls.length,1);
});

(async()=>{for(const {name,run}of tests){await run();console.log('PASS '+name);}console.log(tests.length+' real social covert transport checks passed; no live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
