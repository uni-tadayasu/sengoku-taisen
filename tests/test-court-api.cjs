/* Real authenticated court facade, with local HTTP responses and identity races. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../social.js'),'utf8');
const PLAYER='u_'+'1'.repeat(32),TOKEN='a'.repeat(64),THREAD='ca_'+'b'.repeat(32),copy=value=>JSON.parse(JSON.stringify(value));
const payload={requestId:'00000000-0000-4000-8000-000000000001',text:'御所への言葉'};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function harness({guest=false,admin=false,staff=false}={}){
 const calls=[],authority=[];let transport=async()=>({data:{ok:true,self:{isCourtEmperor:false}}});
 const scope={console,URL,URLSearchParams,AbortController,Date,Intl,setTimeout,clearTimeout,
  document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://fixture.invalid',
  SengokuBridge:{setRoleAccess(){},applyCourtAccess:(value,context)=>authority.push({value:copy(value),context:context?copy(context):null})},
  SengokuCloudSync:{getStatus:()=>({linked:true,ready:true,writable:false})},
  fetch:async(url,options)=>{calls.push({url,method:options.method,headers:copy(options.headers),body:options.body?JSON.parse(options.body):null});const response=await transport(url,options),status=response.status||200;return{ok:status>=200&&status<300,status,json:async()=>response.data};}
 };
 scope.window=scope;vm.createContext(scope);
 vm.runInContext(source.replace('global.SengokuSocial={open','global.__courtApiTest={s,changeIdentity(){authEpoch++;s.identity={id:"other-player",token:"b".repeat(64)};s.user={id:"other-player",name:"別の領主",isAdmin:false,isStaff:false};},changeRole(){privilegeEpoch++;s.user.isStaff=!s.user.isStaff;},pending(){accountEpoch++;s.accountAccessPending={};},hold(){recoveryHeld=true;},clear(){clearAdminData();}};global.SengokuSocial={open'),scope);
 const control=scope.__courtApiTest;if(!guest){control.s.identity={id:PLAYER,token:TOKEN};control.s.user={id:PLAYER,name:'参内領主',isAdmin:admin,isStaff:staff,evaluation:{score:999999,rankName:'正一位'}};}
 return{api:scope.SengokuSocial,control,calls,authority,setTransport:value=>transport=value};
}
const tests=[],test=(name,run)=>tests.push([name,run]);

test('all court requests use the current bearer and follower devices can talk without game-resource writes',async()=>{
 for(const roles of [{},{staff:true},{admin:true}]){
  const h=harness(roles);assert.equal(typeof h.api.courtRequest,'function');assert.equal(h.api.getCourtContext().user.id,PLAYER);
  await h.api.courtRequest('/court/chat',{method:'POST',data:payload,auth:false,token:'forged-token'});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].url,'https://fixture.invalid/api/v1/court/chat');assert.equal(h.calls[0].headers.Authorization,'Bearer '+TOKEN);assert.deepEqual(h.calls[0].body,payload);
 }
});
test('exact read, pagination and private-audience routes are accepted',async()=>{
 const h=harness();for(const route of ['/court','/court/chat?after=42&contentRevision=3&limit=50','/court/audiences?cursor=local-cursor&limit=30','/court/audiences/'+THREAD+'?before=50&limit=20'])await h.api.courtRequest(route);
 await h.api.courtRequest('/court/audiences',{method:'POST',data:{...payload,title:'願い'}});await h.api.courtRequest('/court/audiences/'+THREAD+'/replies',{method:'POST',data:payload});assert.equal(h.calls.length,6);assert(h.calls.every(call=>call.headers.Authorization==='Bearer '+TOKEN));
});
test('unrelated routes, traversal, duplicate or foreign query keys and invalid page sizes never reach HTTP',async()=>{
 const h=harness();for(const [route,method]of [['/admin/staff','GET'],['/court/../admin/court/leader','POST'],['/court?playerId=other','GET'],['/court/chat?after=1&after=2','GET'],['/court/chat?after=1?limit=1','GET'],['/court/chat?after=-1','GET'],['/court/chat?limit=51','GET'],['/court/audiences?limit=0','GET'],['/court/audiences/../../me','GET'],['/court/audiences/'+THREAD+'/replies','GET'],['/court/chat?after=1','POST'],['/court#private','GET'],['/court/chat','DELETE'],['/court','POST']])await assert.rejects(h.api.courtRequest(route,{method,data:payload}),error=>error.status===400);
 assert.equal(h.calls.length,0);
});
test('guest, unverified, suspended, mismatched and recovering identities cannot read private court content',async()=>{
 for(const scenario of ['guest','unverified','mismatched','banned','pending','hold']){
  const h=harness({guest:scenario==='guest'});if(scenario==='unverified')h.control.s.user=null;else if(scenario==='mismatched')h.control.s.user.id='another';else if(scenario==='banned')h.control.s.accountBanned={playerId:PLAYER};else if(['pending','hold'].includes(scenario))h.control[scenario]();
  for(const [route,options]of [['/court',{}],['/court/chat',{method:'POST',data:payload}],['/court/audiences/'+THREAD,{}]])await assert.rejects(h.api.courtRequest(route,options),error=>error.status===403);assert.equal(h.calls.length,0);
 }
});
test('roster is private to staff and operator; appointment is operator-only even with a forged title',async()=>{
 const visitor=harness();visitor.control.s.user.title='太政大臣';for(const [route,options]of [['/staff/court',{}],['/admin/court/leader',{method:'POST',data:{...payload,targetPlayerId:PLAYER}}]])await assert.rejects(visitor.api.courtRequest(route,options),error=>error.status===403);assert.equal(visitor.calls.length,0);
 const staff=harness({staff:true});await staff.api.courtRequest('/staff/court');await assert.rejects(staff.api.courtRequest('/admin/court/leader',{method:'POST',data:{...payload,targetPlayerId:PLAYER}}),error=>error.status===403);assert.equal(staff.calls.length,1);
 const admin=harness({admin:true});await admin.api.courtRequest('/staff/court');await admin.api.courtRequest('/admin/court/leader',{method:'POST',data:{requestId:payload.requestId,targetPlayerId:null}});assert.equal(admin.calls.length,2);
});
test('external court office reads and writes require the operator and use the verified bearer',async()=>{
 const options={method:'POST',data:{requestId:payload.requestId,action:'appoint',officeId:'chunagon',targetPlayerId:'u_other',expectedRevision:7}};
 for(const roles of [{},{staff:true}]){const h=harness(roles);h.control.s.user.title='太政大臣';for(const [route,args]of [['/admin/court/offices?q=葛西&limit=20',{}],['/admin/court/offices',options]])await assert.rejects(h.api.courtRequest(route,args),error=>error.status===403);assert.equal(h.calls.length,0);}
 const h=harness({admin:true});await h.api.courtRequest('/admin/court/offices?q='+encodeURIComponent('葛󠄀西 & 国主')+'&limit=20');await h.api.courtRequest('/admin/court/offices',options);assert.equal(h.calls.length,2);assert(h.calls.every(row=>row.headers.Authorization==='Bearer '+TOKEN));assert.deepEqual(h.calls[1].body,options.data);
});
test('office search validates bounded query keys and does not allow writes with a query',async()=>{
 const h=harness({admin:true});for(const [route,method]of [['/admin/court/offices?q=x&q=y','GET'],['/admin/court/offices?q='+encodeURIComponent('a'.repeat(81)),'GET'],['/admin/court/offices?q=%00','GET'],['/admin/court/offices?role=admin','GET'],['/admin/court/offices?limit=0','GET'],['/admin/court/offices?limit=51','GET'],['/admin/court/offices?q=x','POST'],['/admin/court/offices/leader','GET'],['/admin/court/offices','DELETE']])await assert.rejects(h.api.courtRequest(route,{method,data:payload}),error=>error.status===400);assert.equal(h.calls.length,0);
});
test('a role change discards a delayed external court office response',async()=>{
 const h=harness({admin:true}),pause=deferred();h.setTransport(()=>pause.promise);const request=h.api.courtRequest('/admin/court/offices?q=&limit=20');h.control.changeRole();pause.resolve({data:{ok:true,offices:[{id:'sangi',holder:{id:'secret-person',name:'private'}}]}});await assert.rejects(request,error=>error.code==='STALE_IDENTITY');
});
test('identity, role or account changes discard delayed private reads, sends and appointments',async()=>{
 for(const change of ['changeIdentity','changeRole','pending','hold'])for(const [route,options]of [['/court',{}],['/court/chat',{method:'POST',data:payload}],['/admin/court/leader',{method:'POST',data:{requestId:payload.requestId,targetPlayerId:PLAYER}}]]){
  const h=harness({admin:true}),pause=deferred();h.setTransport(()=>pause.promise);const request=h.api.courtRequest(route,options);h.control[change]();pause.resolve({data:{ok:true,self:{isCourtEmperor:true}}});await assert.rejects(request,error=>error.code==='STALE_IDENTITY');assert.equal(h.authority.length,0);
 }
});
test('only a verified admission read feeds the transient Emperor authority, and invalidation clears it',async()=>{
 const h=harness({staff:true});h.setTransport(async()=>({data:{ok:true,self:{isCourtEmperor:true}}}));await h.api.courtRequest('/court');assert.equal(h.authority.length,1);assert.equal(h.authority[0].value.isCourtEmperor,true);assert.equal(h.authority[0].context.playerId,PLAYER);
 await h.api.courtRequest('/court/chat',{method:'POST',data:payload});assert.equal(h.authority.length,1);
 h.setTransport(async()=>({data:{ok:true,self:{title:'天皇',isCourtEmperor:'true'}}}));await h.api.courtRequest('/court');assert.equal(h.authority.at(-1).value.isCourtEmperor,false);h.control.clear();assert.equal(h.authority.at(-1).value,null);
});
test('an older admission response cannot restore Emperor access after a newer response revoked it',async()=>{
 const h=harness({staff:true}),old=deferred(),latest=deferred();let number=0;h.setTransport(()=>++number===1?old.promise:latest.promise);const first=h.api.courtRequest('/court'),second=h.api.courtRequest('/court');latest.resolve({data:{ok:true,self:{isCourtEmperor:false}}});await second;old.resolve({data:{ok:true,self:{isCourtEmperor:true}}});await first;assert.equal(h.authority.length,1);assert.equal(h.authority[0].value.isCourtEmperor,false);
});
test('server admission and appointment errors retain their authoritative codes and do not grant access',async()=>{
 const h=harness();h.setTransport(async()=>({status:403,data:{ok:false,error:{code:'COURT_RANK_REQUIRED',message:'従五位から参内できます。'}}}));await assert.rejects(h.api.courtRequest('/court/chat',{method:'POST',data:payload}),error=>error.status===403&&error.code==='COURT_RANK_REQUIRED');assert.equal(h.authority.length,0);
});

(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' real social court transport checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
