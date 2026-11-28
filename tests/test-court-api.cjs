/* Real authenticated court facade, with local HTTP responses and identity races. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../social.js'),'utf8');
const PLAYER='u_'+'1'.repeat(32),TOKEN='a'.repeat(64),THREAD='ca_'+'b'.repeat(32),copy=value=>JSON.parse(JSON.stringify(value));
const payload={requestId:'00000000-0000-4000-8000-000000000001',text:'御所への言葉'};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function harness({guest=false,admin=false,staff=false}={}){
 const calls=[],authority=[],syncs=[],writer={linked:true,ready:true,writable:false,revision:12},device={id:'device-one'};let transport=async()=>({data:{ok:true,self:{isCourtEmperor:false}}});
 const scope={console,URL,URLSearchParams,AbortController,Date,Intl,setTimeout,clearTimeout,
  document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://fixture.invalid',
  SengokuBridge:{setRoleAccess(){},applyCourtAccess:(value,context)=>authority.push({value:copy(value),context:context?copy(context):null})},
  SengokuCloudSync:{getStatus:()=>writer,getDevice:()=>device,refresh:async()=>{syncs.push(true);return{ok:true};}},
  fetch:async(url,options)=>{calls.push({url,method:options.method,headers:copy(options.headers),body:options.body?JSON.parse(options.body):null});const response=await transport(url,options),status=response.status||200;return{ok:status>=200&&status<300,status,json:async()=>response.data};}
 };
 scope.window=scope;vm.createContext(scope);
 vm.runInContext(source.replace('global.SengokuSocial={open','global.__courtApiTest={s,changeIdentity(){authEpoch++;s.identity={id:"other-player",token:"b".repeat(64)};s.user={id:"other-player",name:"別の領主",isAdmin:false,isStaff:false};},changeRole(){privilegeEpoch++;s.user.isStaff=!s.user.isStaff;},pending(){accountEpoch++;s.accountAccessPending={};},hold(){recoveryHeld=true;},clear(){clearAdminData();}};global.SengokuSocial={open'),scope);
 const control=scope.__courtApiTest;if(!guest){control.s.identity={id:PLAYER,token:TOKEN};control.s.user={id:PLAYER,name:'参内領主',isAdmin:admin,isStaff:staff,evaluation:{score:999999,rankName:'正一位'}};}
 return{api:scope.SengokuSocial,control,calls,authority,syncs,writer,device,setTransport:value=>transport=value};
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


test('Emperor approval and succession routes use the current bearer without extending other routes',async()=>{
 const h=harness({staff:true});
 await h.api.expansionRequest('/shogunate/approve',{method:'POST',data:{rightId:'sg_'+'a'.repeat(32),requestId:payload.requestId}});
 await h.api.courtRequest('/court/succession');
 for(const route of ['/court/succession?target=x','/court/succession/other'])await assert.rejects(h.api.courtRequest(route),error=>error.status===400);
 assert.equal(h.calls.length,2);assert(h.calls.every(call=>call.headers.Authorization==='Bearer '+TOKEN));
});
const successionResponse=()=>({ok:true,idempotent:true,legacy:true,status:'legacy-approved',needsSync:true,user:{id:PLAYER,name:'上皇となった領主',isAdmin:false,isStaff:false},receipt:{retiredPlayerId:PLAYER,retiredPlayerName:'上皇となった領主',successorPlayerId:'u_successor',successorPlayerName:'後継者',retiredAt:1795700000000}});
const NOMINATION='csn_'+'c'.repeat(32),nominationBody={requestId:payload.requestId,targetPlayerId:'u_successor',targetTermId:'current-successor-term',sourceAppointmentToken:'current-emperor-token'};
const nominationResponse=()=>({ok:true,idempotent:false,needsSync:false,receipt:{action:'nominate',nominationId:NOMINATION,targetPlayerId:'u_successor',revision:0,status:'pending',nominatedAt:1795700000000,resolvedAt:null},nomination:{id:NOMINATION,status:'pending',revision:0,emperor:{id:PLAYER,name:'現在の天皇'},successor:{id:'u_successor',name:'後継者'},nominatedAt:1795700000000,resolvedAt:null,resolvedBy:null,reason:null}});
test('successor certification lists and decisions are chancellor-only with exact authenticated routes',async()=>{
 for(const roles of [{},{staff:true}]){const h=harness(roles);h.control.s.user.title='太政大臣';for(const [route,options]of [['/admin/court/succession',{}],['/admin/court/succession/'+NOMINATION+'/approve',{method:'POST',data:{requestId:payload.requestId,expectedRevision:0}}],['/admin/court/succession/'+NOMINATION+'/reject',{method:'POST',data:{requestId:payload.requestId,expectedRevision:0}}]])await assert.rejects(h.api.courtRequest(route,options),error=>error.status===403);assert.equal(h.calls.length,0);}
 const h=harness({admin:true});await h.api.courtRequest('/admin/court/succession');for(const action of ['approve','reject'])await h.api.courtRequest('/admin/court/succession/'+NOMINATION+'/'+action,{method:'POST',auth:false,data:{requestId:payload.requestId,expectedRevision:0}});assert.equal(h.calls.length,3);assert(h.calls.every(row=>row.headers.Authorization==='Bearer '+TOKEN));assert.deepEqual(h.calls[1].body,{requestId:payload.requestId,expectedRevision:0});
});
test('succession review and withdrawal routes reject queries, wrong methods and unrecognized nominations',async()=>{
 const h=harness({admin:true});for(const [route,method]of [['/admin/court/succession?limit=20','GET'],['/admin/court/succession','POST'],['/admin/court/succession/'+NOMINATION+'/approve','GET'],['/admin/court/succession/'+NOMINATION+'/approve?q=x','POST'],['/admin/court/succession/'+NOMINATION+'/cancel','POST'],['/admin/court/succession/csn_bad/approve','POST'],['/court/succession/'+NOMINATION+'/approve','POST'],['/court/succession/'+NOMINATION+'/cancel','GET'],['/court/succession/'+NOMINATION+'/cancel?x=1','POST']])await assert.rejects(h.api.courtRequest(route,{method,data:{requestId:payload.requestId,expectedRevision:0}}),error=>error.status===400);assert.equal(h.calls.length,0);
 const former=harness();await former.api.courtRequest('/court/succession/'+NOMINATION+'/cancel',{method:'POST',data:{requestId:payload.requestId,expectedRevision:0}});assert.equal(former.calls.length,1,'server checks the current role or an existing immutable withdrawal receipt');
});
test('a nomination receipt preserves the current Emperor user and cannot trigger legacy abdication adoption',async()=>{
 const h=harness({staff:true});h.setTransport(async()=>({data:nominationResponse()}));const result=await h.api.courtRequest('/court/succession',{method:'POST',data:nominationBody});assert.equal(h.api.getUser().isStaff,true);assert.equal(h.syncs.length,0);assert.equal(h.authority.length,0);assert.deepEqual(h.calls[0].body,nominationBody);await assert.rejects(h.api.acceptCourtSuccession(result),error=>error.code==='STALE_IDENTITY');assert.equal(h.api.getUser().isStaff,true);assert.equal(h.syncs.length,0);
});
test('certifying another Emperor never adopts the predecessor user or syncs the chancellor as a retired Emperor',async()=>{
 const h=harness({admin:true}),response=nominationResponse();Object.assign(response.receipt,{action:'approve',revision:1,status:'approved',resolvedAt:1795700001000});Object.assign(response.nomination,{revision:1,status:'approved',resolvedAt:1795700001000,resolvedBy:{id:PLAYER,name:'太政大臣'},emperor:{id:'prior-emperor',name:'前天皇'}});response.user={id:'prior-emperor',name:'上皇',isStaff:false};h.setTransport(async()=>({data:response}));const result=await h.api.courtRequest('/admin/court/succession/'+NOMINATION+'/approve',{method:'POST',data:{requestId:payload.requestId,expectedRevision:0}});assert.equal(h.api.getUser().id,PLAYER);assert.equal(h.api.getUser().isAdmin,true);assert.equal(h.syncs.length,0);await assert.rejects(h.api.acceptCourtSuccession(result),error=>error.code==='STALE_IDENTITY');
});
test('modern nomination and certification responses are discarded after role or account changes',async()=>{
 for(const change of ['changeRole','changeIdentity','pending'])for(const [route,options]of [['/court/succession',{method:'POST',data:nominationBody}],['/admin/court/succession',{}],['/admin/court/succession/'+NOMINATION+'/approve',{method:'POST',data:{requestId:payload.requestId,expectedRevision:0}}]]){const h=harness({admin:true}),pause=deferred();h.setTransport(()=>pause.promise);const task=h.api.courtRequest(route,options);h.control[change]();pause.resolve({data:nominationResponse()});await assert.rejects(task,error=>error.code==='STALE_IDENTITY');assert.equal(h.syncs.length,0);}
});
test('legacy adoption requires explicit legacy markers and an original v1 request body',async()=>{
 for(const modern of [false,true]){const h=harness({staff:true}),response=successionResponse();if(!modern){delete response.legacy;delete response.status;}h.setTransport(async()=>({data:response}));const result=await h.api.courtRequest('/court/succession',{method:'POST',data:modern?nominationBody:{requestId:payload.requestId,targetPlayerId:'u_successor'}});await assert.rejects(h.api.acceptCourtSuccession(result),error=>error.code==='STALE_IDENTITY');assert.equal(h.api.getUser().isStaff,true);assert.equal(h.syncs.length,0);}
});
test('an explicitly marked legacy abdication survives its own privilege loss and refreshes the ordinary campaign',async()=>{
 const h=harness({staff:true}),pause=deferred();h.setTransport(()=>pause.promise);
 const pending=h.api.courtRequest('/court/succession',{method:'POST',data:{requestId:payload.requestId,targetPlayerId:'u_successor'}});
 h.control.changeRole();pause.resolve({data:successionResponse()});const result=await pending;
 assert.equal(h.api.getUser().isStaff,false);await h.api.acceptCourtSuccession(result);
 assert.equal(h.api.getUser().isStaff,false);assert.equal(h.syncs.length,1);assert.equal(h.authority.at(-1).value,null);
 await assert.rejects(h.api.acceptCourtSuccession(result),error=>error.code==='STALE_IDENTITY');
});
test('abdication adoption rejects forged responses and responses belonging to another active account',async()=>{
 const forged=harness({staff:true});await assert.rejects(forged.api.acceptCourtSuccession(successionResponse()),error=>error.code==='STALE_IDENTITY');assert.equal(forged.syncs.length,0);
 const h=harness({staff:true});h.setTransport(async()=>({data:successionResponse()}));const result=await h.api.courtRequest('/court/succession',{method:'POST',data:{requestId:payload.requestId,targetPlayerId:'u_successor'}});h.control.changeIdentity();await assert.rejects(h.api.acceptCourtSuccession(result),error=>error.code==='STALE_IDENTITY');assert.equal(h.syncs.length,0);
});
test('ordinary former Emperor can retry an immutable legacy receipt but new candidate reads reject role races',async()=>{
 const former=harness();former.setTransport(async()=>({data:successionResponse()}));const result=await former.api.courtRequest('/court/succession',{method:'POST',data:{requestId:payload.requestId,targetPlayerId:'u_successor'}});await former.api.acceptCourtSuccession(result);assert.equal(former.syncs.length,1);
 const h=harness({staff:true}),pause=deferred();h.setTransport(()=>pause.promise);const read=h.api.courtRequest('/court/succession');h.control.changeRole();pause.resolve({data:{ok:true,canNominate:true,approvalRequired:true,candidates:[]}});await assert.rejects(read,error=>error.code==='STALE_IDENTITY');
});

test('regent appointment routes require the operator and validate exact query boundaries',async()=>{
 const options={method:'POST',data:{requestId:payload.requestId,action:'appoint',targetPlayerId:'u_other',expectedRevision:0}};
 for(const roles of [{},{staff:true}]){const h=harness(roles);h.control.s.user.title='太政大臣';await assert.rejects(h.api.courtRequest('/admin/court/regent'),error=>error.status===403);await assert.rejects(h.api.courtRequest('/admin/court/regent',options),error=>error.status===403);assert.equal(h.calls.length,0);}
 const h=harness({admin:true});await h.api.courtRequest('/admin/court/regent?q='+encodeURIComponent('一般の領主')+'&limit=20');await h.api.courtRequest('/admin/court/regent',options);assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1].body,options.data);
 for(const route of ['/admin/court/regent?q=x&q=y','/admin/court/regent?limit=51','/admin/court/regent?target=x','/admin/court/regent/other'])await assert.rejects(h.api.courtRequest(route),error=>error.status===400);
 await assert.rejects(h.api.courtRequest('/admin/court/regent?q=x',options),error=>error.status===400);
});
test('ordinary Regent duties use verified admission without changing staff status or granting appointments',async()=>{
 const h=harness();h.control.s.user.title='摂政';h.control.s.user.isCourtRegent=true;await assert.rejects(h.api.courtRequest('/staff/court'),error=>error.status===403);
 h.setTransport(async()=>({data:{ok:true,self:{id:PLAYER,isCourtEmperor:false,isCourtRegent:true}}}));await h.api.courtRequest('/court');assert.equal(h.api.getCourtContext().isCourtRegent,true);assert.equal(h.api.getUser().isStaff,false);assert.equal(h.authority.at(-1).value.isCourtRegent,true);assert.equal(h.authority.at(-1).value.isCourtEmperor,false);
 await h.api.courtRequest('/staff/court');await assert.rejects(h.api.courtRequest('/admin/court/regent'),error=>error.status===403);await assert.rejects(h.api.courtRequest('/admin/court/leader',{method:'POST',data:payload}),error=>error.status===403);
 h.setTransport(async()=>({data:{ok:true,self:{id:PLAYER,isCourtRegent:false}}}));await h.api.courtRequest('/court');assert.equal(h.api.getCourtContext().isCourtRegent,false);await assert.rejects(h.api.courtRequest('/staff/court'),error=>error.status===403);
});
test('older Regent admission and another account cannot restore delegated roster access',async()=>{
 const h=harness(),old=deferred(),latest=deferred();let number=0;h.setTransport(()=>++number===1?old.promise:latest.promise);const first=h.api.courtRequest('/court'),second=h.api.courtRequest('/court');latest.resolve({data:{ok:true,self:{id:PLAYER,isCourtRegent:false}}});await second;old.resolve({data:{ok:true,self:{id:PLAYER,isCourtRegent:true}}});await first;assert.equal(h.api.getCourtContext().isCourtRegent,false);
 h.setTransport(async()=>({data:{ok:true,self:{id:PLAYER,isCourtRegent:true}}}));await h.api.courtRequest('/court');h.control.changeIdentity();assert.equal(h.api.getCourtContext().isCourtRegent,false);await assert.rejects(h.api.courtRequest('/staff/court'),error=>error.status===403);
});

test('court event room transport accepts only duty members and exact room routes',async()=>{
 const ordinary=harness();ordinary.control.s.user.isCourtRegent=true;ordinary.control.s.user.title='天皇';await assert.rejects(ordinary.api.courtEventRequest('/court/events'),error=>error.status===403);assert.equal(ordinary.calls.length,0);
 for(const roles of [{admin:true},{staff:true}]){const h=harness(roles),eventId='ev_'+'a'.repeat(32);await h.api.courtEventRequest('/court/events');await h.api.courtEventRequest('/court/events/'+eventId);await h.api.courtEventRequest('/court/events/generate',{method:'POST',data:{requestId:payload.requestId,mode:'ai',prompt:'初心者向け'}});await h.api.courtEventRequest('/court/events/'+eventId+'/publish',{method:'POST',data:{requestId:payload.requestId,expectedRevision:1}});assert.equal(h.calls.length,4);assert(h.calls.every(c=>c.headers.Authorization==='Bearer '+TOKEN));for(const route of ['/court/events?q=x','/admin/events','/court/events/../leader','/court/events/'+eventId+'/battle'])await assert.rejects(h.api.courtEventRequest(route),error=>error.status===400);}
});
test('ordinary Regent can enter event room through verified authority and a denial clears stale duty access',async()=>{
 const h=harness();h.setTransport(async()=>({data:{ok:true,self:{id:PLAYER,isCourtRegent:true}}}));await h.api.courtRequest('/court');await h.api.courtEventRequest('/court/events');assert.equal(h.api.getUser().isStaff,false);
 h.setTransport(async()=>({status:403,data:{ok:false,error:{code:'COURT_EVENT_ROLE_REQUIRED',message:'役職が変更されました。'}}}));await assert.rejects(h.api.courtEventRequest('/court/events'),error=>error.status===403);assert.equal(h.api.getCourtContext().isCourtRegent,false);assert.equal(h.authority.at(-1).value,null);const before=h.calls.length;await assert.rejects(h.api.courtEventRequest('/court/events'),error=>error.status===403);assert.equal(h.calls.length,before);
});
test('a commit-time Regent revocation conflict removes cached event room authority',async()=>{
 const h=harness();h.setTransport(async()=>({data:{ok:true,self:{id:PLAYER,isCourtRegent:true}}}));await h.api.courtRequest('/court');assert.equal(h.api.getCourtContext().isCourtRegent,true);
 h.setTransport(async()=>({status:409,data:{ok:false,error:{code:'COURT_EVENT_ACCESS_CHANGED',message:'御所の任命が変わりました。'}}}));await assert.rejects(h.api.courtEventRequest('/court/events'),error=>error.code==='COURT_EVENT_ACCESS_CHANGED');assert.equal(h.api.getCourtContext().isCourtRegent,false);assert.equal(h.authority.at(-1).value,null);
});
test('delayed private room results are discarded after account or staff-role changes',async()=>{
 for(const change of ['changeIdentity','changeRole','pending','hold']){const h=harness({staff:true}),pause=deferred();h.setTransport(()=>pause.promise);const request=h.api.courtEventRequest('/court/events');h.control[change]();pause.resolve({data:{ok:true,events:[{name:'非公開の下書き'}]}});await assert.rejects(request,error=>error.code==='STALE_IDENTITY');}
});

test('formal membership requires explicit confirmation and the current writer but receipt lookup is read-only',async()=>{
 const h=harness(),data={requestId:'membership-request-one',deviceId:'device-one',expectedRevision:12,expectedHomeCastleId:'kiyosu',expectedJoinMode:'kyoto',expectedOfficeToken:null,houseId:'konoe',confirmed:true};
 await h.api.courtRequest('/court/membership');await assert.rejects(h.api.courtRequest('/court/membership',{method:'POST',data}),error=>error.code==='LOCAL_WRITER_CHANGED');
 h.writer.writable=true;await h.api.courtRequest('/court/membership',{method:'POST',data});assert.deepEqual(h.calls.at(-1).body,data);
 h.writer.writable=false;h.writer.revision=20;await h.api.courtRequest('/court/membership?receipt=1',{method:'POST',data});assert.deepEqual(h.calls.at(-1).body,data);assert.equal(h.calls.at(-1).headers.Authorization,'Bearer '+TOKEN);await h.api.courtRequest('/court/membership',{method:'POST',data,recoverMembership:true});assert.deepEqual(h.calls.at(-1).body,data);
});
test('membership confirmation, exact keys and receipt routes reject malformed or unreviewed commands',async()=>{
 const h=harness(),data={requestId:'membership-request-one',deviceId:'device-one',expectedRevision:12,expectedHomeCastleId:'kiyosu',expectedJoinMode:'kyoto',expectedOfficeToken:null,houseId:'konoe',confirmed:true};h.writer.writable=true;
 for(const invalid of [{...data,confirmed:false},{...data,expectedJoinMode:'other'},{...data,expectedOfficeToken:''},{...data,other:true},{...data,expectedRevision:-1},{...data,expectedHomeCastleId:'../kiyosu'}])await assert.rejects(h.api.courtRequest('/court/membership',{method:'POST',data:invalid}),error=>error.status===400);
 for(const route of ['/court/membership?receipt=0','/court/membership?receipt=1&receipt=1','/court/membership?other=1'])await assert.rejects(h.api.courtRequest(route,{method:'POST',data}),error=>error.status===400);
 await assert.rejects(h.api.courtRequest('/court/membership?receipt=1'),error=>error.status===400);assert.equal(h.calls.length,0);
});
test('an account change cannot apply a delayed formal-membership snapshot to the next player',async()=>{
 const h=harness(),pause=deferred(),data={requestId:'membership-request-one',deviceId:'device-one',expectedRevision:12,expectedHomeCastleId:'kiyosu',expectedJoinMode:'kyoto',expectedOfficeToken:null,houseId:'konoe',confirmed:true};h.writer.writable=true;h.setTransport(()=>pause.promise);
 const pending=h.api.courtRequest('/court/membership',{method:'POST',data});h.control.changeIdentity();pause.resolve({data:{ok:true,user:{id:PLAYER,isStaff:true},revision:13}});await assert.rejects(pending,error=>error.code==='STALE_IDENTITY');
});

test('legacy membership without a house can only look up a prior receipt',async()=>{
 const h=harness(),data={requestId:'legacy-membership-request',deviceId:'device-one',expectedRevision:12,expectedHomeCastleId:'kiyosu',confirmed:true};h.writer.writable=true;
 await assert.rejects(h.api.courtRequest('/court/membership',{method:'POST',data}),error=>error.status===400);
 await h.api.courtRequest('/court/membership?receipt=1',{method:'POST',data});assert.deepEqual(h.calls[0].body,data);
});
test('family and imperial-house commands use exact authenticated routes and read-only receipt recovery',async()=>{
 const h=harness({staff:true}),base={requestId:'lineage-request-one',expectedRevision:3,termId:'current-term',confirmed:true};
 for(const [route,extra]of [['/court/house',{houseId:'kujo'}],['/court/imperial-house',{name:'花霞宮'}]]){
  const data={...base,...extra};await h.api.courtRequest(route,{method:'POST',data});await h.api.courtRequest(route+'?receipt=1',{method:'POST',data});
  assert.deepEqual(h.calls.at(-1).body,data);assert.equal(h.calls.at(-1).headers.Authorization,'Bearer '+TOKEN);
 }
 assert.equal(h.writer.writable,false);assert.equal(h.calls.length,4);
});
test('invalid family choices, unconfirmed house names and broadened lineage routes never reach HTTP',async()=>{
 const h=harness({staff:true}),base={requestId:'lineage-request-one',expectedRevision:3,termId:'current-term',confirmed:true};
 for(const [route,data]of [['/court/house',{...base,houseId:'other'}],['/court/house',{...base,houseId:'konoe',confirmed:false}],['/court/house',{...base,houseId:'konoe',isAdmin:true}],['/court/imperial-house',{...base,name:'宮'}],['/court/imperial-house',{...base,name:'空白宮 '}],['/court/imperial-house',{...base,name:'改行\n宮'}],['/court/imperial-house',{...base,name:'宮'.repeat(21)}]])await assert.rejects(h.api.courtRequest(route,{method:'POST',data}),error=>error.status===400);
 for(const route of ['/court/house?receipt=0','/court/house?receipt=1&receipt=1','/court/imperial-house?playerId=other','/court/house/../imperial-house'])await assert.rejects(h.api.courtRequest(route,{method:'POST',data:{...base,houseId:'konoe'}}),error=>error.status===400);
 await assert.rejects(h.api.courtRequest('/court/house'),error=>error.status===400);assert.equal(h.calls.length,0);
});
test('lineage results cannot cross account or role changes and do not grant Emperor authority',async()=>{
 for(const change of ['changeIdentity','changeRole','pending','hold']){
  const h=harness({staff:true}),pause=deferred();h.setTransport(()=>pause.promise);const pending=h.api.courtRequest('/court/imperial-house',{method:'POST',data:{requestId:'imperial-request-one',expectedRevision:3,termId:'current-term',confirmed:true,name:'花霞宮'}});h.control[change]();pause.resolve({data:{ok:true,lineage:{class:'imperial',houseId:'konoe',imperialHouseName:'花霞宮'}}});await assert.rejects(pending,error=>error.code==='STALE_IDENTITY');assert.equal(h.authority.length,0);
 }
});

const NEGOTIATION='cn_'+'8'.repeat(32),TARGET='u_'+'2'.repeat(32),negotiationOffer={gold:800,rice:0,wood:30,stone:0},negotiationProposal={requestId:'negotiation-request-one',targetPlayerId:TARGET,offer:negotiationOffer,confirmed:true};
test('court negotiation reads, proposals and counters use private authentication without requiring a writer or rank',async()=>{
 const h=harness();h.control.s.user.evaluation={score:0};
 for(const route of ['/court/negotiations','/court/negotiations?box=history&limit=50&cursor=next_page','/court/negotiations/recipient?playerId='+TARGET,'/court/negotiations/'+NEGOTIATION])await h.api.courtNegotiationRequest(route);
 await h.api.courtNegotiationRequest('/court/negotiations',{method:'POST',data:negotiationProposal,auth:false,token:'forged'});
 for(const action of ['counter','reject','cancel'])await h.api.courtNegotiationRequest('/court/negotiations/'+NEGOTIATION+'/'+action,{method:'POST',data:{requestId:'negotiation-'+action,proposalRevision:2,confirmed:true,...(action==='counter'?{offer:negotiationOffer}:{})}});
 assert.equal(h.calls.length,8);assert(h.calls.every(call=>call.headers.Authorization==='Bearer '+TOKEN));assert.equal(h.authority.length,0);assert.equal(h.syncs.length,0);
});
test('negotiation acceptance requires the active writer while receipt lookup remains read-only on followers',async()=>{
 const h=harness(),data={requestId:'accept-negotiation',proposalRevision:3,confirmed:true,deviceId:'device-one',expectedRevision:12},route='/court/negotiations/'+NEGOTIATION+'/accept';
 await assert.rejects(h.api.courtNegotiationRequest(route,{method:'POST',data}),error=>error.code==='COURT_NEGOTIATION_SYNC_REQUIRED');assert.equal(h.calls.length,0);
 await h.api.courtNegotiationRequest(route+'?receipt=1',{method:'POST',data});assert.equal(h.calls.length,1);assert.equal(h.syncs.length,0);
 h.writer.writable=true;await h.api.courtNegotiationRequest(route,{method:'POST',data});assert.deepEqual(h.calls[1].body,data);
 for(const patch of [{expectedRevision:11},{deviceId:'other-device'}])await assert.rejects(h.api.courtNegotiationRequest(route,{method:'POST',data:{...data,...patch}}),error=>error.code==='COURT_NEGOTIATION_SYNC_REQUIRED');assert.equal(h.calls.length,2);
});
test('negotiation validation rejects route escapes, unknown resources, stale proposal shapes and unconfirmed terms',async()=>{
 const h=harness();for(const route of ['/court/negotiations?box=all','/court/negotiations?limit=0','/court/negotiations?limit=51','/court/negotiations?box=active&box=history','/court/negotiations?cursor=%00','/court/negotiations/recipient','/court/negotiations/recipient?playerId='+TARGET+'&role=admin','/court/negotiations/../admin','/court/negotiations#history'])await assert.rejects(h.api.courtNegotiationRequest(route),error=>error.status===400);
 for(const patch of [{confirmed:false},{targetPlayerId:PLAYER},{targetPlayerId:'../other'},{offer:{gold:0}},{offer:{iron:1}},{offer:{gold:1000001}},{offer:{gold:0.5}},{offer:{gold:1,stone:null}},{offer:[]},{isAdmin:true}])await assert.rejects(h.api.courtNegotiationRequest('/court/negotiations',{method:'POST',data:{...negotiationProposal,...patch}}),error=>error.status===400);
 for(const action of ['counter','accept','reject','cancel'])await assert.rejects(h.api.courtNegotiationRequest('/court/negotiations/'+NEGOTIATION+'/'+action,{method:'POST',data:{requestId:'invalid-revision',proposalRevision:0,confirmed:true}}),error=>error.status===400);
 await assert.rejects(h.api.courtNegotiationRequest('/court/negotiations?receipt=1&receipt=1',{method:'POST',data:negotiationProposal}),error=>error.status===400);assert.equal(h.calls.length,0);
});
test('all negotiation commands support exact receipt recovery without granting court privileges',async()=>{
 const h=harness(),base='/court/negotiations';await h.api.courtNegotiationRequest(base+'?receipt=1',{method:'POST',data:negotiationProposal});
 for(const action of ['counter','accept','reject','cancel'])await h.api.courtNegotiationRequest(base+'/'+NEGOTIATION+'/'+action+'?receipt=1',{method:'POST',data:{requestId:'receipt-'+action,proposalRevision:4,confirmed:true,...(action==='counter'?{offer:negotiationOffer}:action==='accept'?{deviceId:'device-one',expectedRevision:0}:{})}});
 assert.equal(h.calls.length,5);assert.equal(h.authority.length,0);assert(h.calls.every(call=>call.url.endsWith('?receipt=1')));
});
test('guest and stale account, role or verification transitions cannot receive another identity negotiation',async()=>{
 const guest=harness({guest:true});await assert.rejects(guest.api.courtNegotiationRequest('/court/negotiations'),error=>error.status===403);assert.equal(guest.calls.length,0);
 for(const change of ['changeIdentity','changeRole','pending','hold']){
  const h=harness(),pause=deferred();h.setTransport(()=>pause.promise);const pending=h.api.courtNegotiationRequest('/court/negotiations',{method:'POST',data:negotiationProposal});h.control[change]();pause.resolve({data:{ok:true,negotiation:{id:NEGOTIATION}}});await assert.rejects(pending,error=>error.code==='STALE_IDENTITY');assert.equal(h.authority.length,0);
 }
});

test('noble catalogue uses verified identity and exchange accepts only the current writer and server-priced officer id',async()=>{
 const h=harness(),data={officerId:'kuge_konoe_sakihisa',requestId:'court-noble-request-1',deviceId:'device-one',expectedRevision:12};
 await h.api.courtNobleRequest('/court/nobles',{auth:false,token:'forged'});
 await assert.rejects(h.api.courtNobleRequest('/court/nobles/exchange',{method:'POST',data}),error=>error.code==='COURT_NOBLE_SYNC_REQUIRED');
 h.writer.writable=true;await h.api.courtNobleRequest('/court/nobles/exchange',{method:'POST',data,auth:false,token:'forged'});
 assert.equal(h.calls.length,2);assert(h.calls.every(call=>call.headers.Authorization==='Bearer '+TOKEN));assert.deepEqual(h.calls[1].body,data);
 for(const invalid of [{...data,cost:0},{...data,rank:'U'},{...data,officerId:'admin_ieyasu'},{...data,deviceId:'other-device'},{...data,expectedRevision:11},{...data,requestId:'short'},{...data,expectedRevision:-1}])await assert.rejects(h.api.courtNobleRequest('/court/nobles/exchange',{method:'POST',data:invalid}));
 assert.equal(h.calls.length,2);
});
test('noble request boundary rejects unrelated routes, unauthenticated identities and delayed account responses',async()=>{
 const h=harness();
 for(const route of ['/court/nobles?playerId=other','/court/nobles/../offices','/court/nobles#x','/court/nobles/exchange'])await assert.rejects(h.api.courtNobleRequest(route),error=>error.status===400);
 await assert.rejects(h.api.courtNobleRequest('/court/nobles',{method:'POST'}),error=>error.status===400);
 await assert.rejects(h.api.courtNobleRequest('/court/nobles',{data:{}}),error=>error.status===400);assert.equal(h.calls.length,0);
 const guest=harness({guest:true});await assert.rejects(guest.api.courtNobleRequest('/court/nobles'),error=>error.status===403);assert.equal(guest.calls.length,0);
 for(const change of ['changeIdentity','changeRole','pending','hold']){
  const c=harness(),pause=deferred();c.setTransport(()=>pause.promise);const task=c.api.courtNobleRequest('/court/nobles');c.control[change]();pause.resolve({data:{ok:true,balance:99999,catalog:[]}});await assert.rejects(task,error=>error.code==='STALE_IDENTITY');
 }
});
test('town membership flag comes only from the current server boolean, never from a retained lineage',async()=>{
 const h=harness();h.control.s.user.courtLineage={houseId:'konoe',houseName:'近衛家'};assert.equal(h.api.getUser().courtMember,false);
 h.control.s.user.courtMember=true;assert.equal(h.api.getUser().courtMember,true);
 h.control.s.user.courtMember=false;assert.equal(h.api.getUser().courtMember,false);
 h.control.s.user.courtMember='true';assert.equal(h.api.getUser().courtMember,false);
});

test('retirement reads and confirmed ordination use authenticated exact routes without granting Emperor authority',async()=>{
 const h=harness(),command={requestId:payload.requestId,expectedRevision:0,successionId:'succession-one',confirmed:true};
 await h.api.courtRequest('/court/retirement');await h.api.courtRequest('/court/retirement/ordain',{method:'POST',data:command});assert.equal(h.calls.length,2);assert(h.calls.every(row=>row.headers.Authorization==='Bearer '+TOKEN));assert.deepEqual(h.calls[1].body,command);assert.equal(h.authority.length,0);
});
test('ordination rejects unconfirmed, broadened, malformed and queried commands before HTTP',async()=>{
 const h=harness(),command={requestId:payload.requestId,expectedRevision:0,successionId:'succession-one',confirmed:true};
 for(const data of [{...command,confirmed:false},{...command,expectedRevision:-1},{...command,successionId:'../other'},{...command,playerId:PLAYER},{...command,requestId:''}])await assert.rejects(h.api.courtRequest('/court/retirement/ordain',{method:'POST',data}),error=>error.status===400);
 for(const [route,method]of [['/court/retirement?playerId='+PLAYER,'GET'],['/court/retirement/ordain?receipt=1','POST'],['/court/retirement/ordain','GET'],['/court/retirement','POST']])await assert.rejects(h.api.courtRequest(route,{method,data:command}),error=>error.status===400);assert.equal(h.calls.length,0);
});
test('a delayed ordination result cannot be adopted by another identity',async()=>{
 const h=harness(),wait=deferred();h.setTransport(()=>wait.promise);const request=h.api.courtRequest('/court/retirement/ordain',{method:'POST',data:{requestId:payload.requestId,expectedRevision:0,successionId:'succession-one',confirmed:true}});h.control.changeIdentity();wait.resolve({data:{ok:true,retirement:{title:'法皇'}}});await assert.rejects(request,error=>error.code==='STALE_IDENTITY');assert.equal(h.authority.length,0);
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' real social court transport checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});

