/* Real transport, synthetic identities and responses. Never contacts production. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../social.js'),'utf8');
const EVENT='ev_'+'a'.repeat(32),PLAYER='u_'+'1'.repeat(32);
const copy=x=>JSON.parse(JSON.stringify(x));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function harness({admin=false,staff=false,guest=false}={}){
 const calls=[];let transport=async()=>({ok:true,events:[]}),flushing=async()=>({ok:true}),flushes=0,writable=false;
 const scope={console,URL,URLSearchParams,AbortController,Date,Intl,setTimeout,clearTimeout,
  document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://fixture.invalid',
  SengokuBridge:{hasStarted:()=>true,setRoleAccess(){},getEventAccess:()=>({current:2,max:3,cost:1,ready:true,writable,message:'出陣に指令を1消費します。'})},
  SengokuCloudSync:{getStatus:()=>({linked:true,ready:true,writable,revision:7}),getDevice:()=>({id:'event-tab'}),flush:async()=>{flushes++;return flushing();}},
  fetch:async(url,options)=>{calls.push({url,method:options.method,headers:copy(options.headers),body:options.body?JSON.parse(options.body):null});const result=await transport(url,options);return{ok:true,status:200,json:async()=>result};}
 };
 scope.window=scope;vm.createContext(scope);
 vm.runInContext(source.replace('global.SengokuSocial={open','global.__eventApi={s,mailView,changeIdentity(id){authEpoch++;s.identity=id?{id,token:"b".repeat(64)}:null;s.user=id?{id,name:"交代した領主",isAdmin:false}:null;},revoke(){privilegeEpoch++;s.user.isAdmin=false;},pending(){accountEpoch++;s.accountAccessPending={};},hold(){recoveryHeld=true;}};global.SengokuSocial={open'),scope);
 const t=scope.__eventApi;
 if(!guest){t.s.identity={id:PLAYER,token:'a'.repeat(64)};t.s.user={id:PLAYER,name:'試験領主',isAdmin:admin,isStaff:staff};}
 return{scope,t,api:scope.SengokuSocial,calls,setTransport:f=>transport=f,setFlush:f=>flushing=f,setWritable:v=>writable=v,flushes:()=>flushes};
}
const tests=[];const test=(name,run)=>tests.push({name,run});
test('visitors can read public events without credentials and cannot create or battle',async()=>{
 const h=harness({guest:true});await h.api.eventRequest('/events');assert.equal(h.calls[0].headers.Authorization,undefined);
 await h.api.eventRequest('/events/'+EVENT);await h.api.eventRequest('/events/catalog');assert.equal(h.calls.length,3);assert.equal(h.calls[2].headers.Authorization,undefined);
 await assert.rejects(h.api.eventRequest('/admin/events'),/接続中/);
 await assert.rejects(h.api.eventRequest('/events/'+EVENT+'/battle',{method:'POST',data:{}}),/接続中/);
 assert.equal(h.calls.length,3);
});
test('only the confirmed primary operator can use administrative event routes',async()=>{
 for(const config of [{},{staff:true}]){const h=harness(config);await assert.rejects(h.api.eventRequest('/admin/events/generate',{method:'POST',data:{}}),/運営権限/);assert.equal(h.calls.length,0);}
 const h=harness({admin:true}),data={battleId:'history:sekigahara',durationDays:7,requestId:'same-operation'};
 await h.api.eventRequest('/admin/events/generate',{method:'POST',data,auth:false,token:'ignored'});
 assert.equal(h.calls[0].headers.Authorization,'Bearer '+'a'.repeat(64));assert.deepEqual(h.calls[0].body,data);
 assert.equal(h.api.getEventContext().isAdmin,true);
});
test('the facade rejects unrelated or malformed routes and methods before transport',async()=>{
 const h=harness({admin:true});for(const [route,method] of [['/admin/mail','POST'],['/events/'+EVENT+'?private=true','GET'],['/admin/events/../staff','POST'],['/events/'+EVENT+'/battle','DELETE'],['/admin/events/generate','GET'],['/events/ev_bad','GET']])await assert.rejects(h.api.eventRequest(route,{method}),/操作を確認/);
 assert.equal(h.calls.length,0);
});
test('an identity switch discards public and private responses',async()=>{
 for(const route of ['/events','/admin/events']){const h=harness({admin:true}),wait=deferred();h.setTransport(()=>wait.promise);const task=h.api.eventRequest(route);h.t.changeIdentity('u_'+'2'.repeat(32));wait.resolve({ok:true,events:[]});await assert.rejects(task,e=>e.code==='STALE_IDENTITY');}
});
test('role revocation and account access changes discard an administrative result',async()=>{
 for(const change of ['revoke','pending']){const h=harness({admin:true}),wait=deferred();h.setTransport(()=>wait.promise);const task=h.api.eventRequest('/admin/events/'+EVENT+'/publish',{method:'POST',data:{requestId:'publish'}});h.t[change]();wait.resolve({ok:true,event:{id:EVENT}});await assert.rejects(task,e=>e.code==='STALE_IDENTITY');}
});
test('a prepared battle uses the current writer revision without a second flush',async()=>{
 const h=harness();h.setWritable(true);
 const data={requestId:'battle-one',stageId:'stage-1',tactic:'balanced',deviceId:'event-tab',expectedRevision:7};
 await h.api.eventRequest('/events/'+EVENT+'/battle',{method:'POST',data});
 assert.equal(h.flushes(),0);assert.deepEqual(h.calls[0].body,data);
});
test('old UI, stale writer metadata, follower access and an unstarted campaign cannot send a battle',async()=>{
 const h=harness();h.setWritable(true);
 for(const data of [{},{deviceId:'wrong',expectedRevision:7},{deviceId:'event-tab',expectedRevision:6},{deviceId:'event-tab',expectedRevision:'7'}])await assert.rejects(h.api.eventRequest('/events/'+EVENT+'/battle',{method:'POST',data}),e=>e.code==='EVENT_SYNC_REQUIRED');
 h.setWritable(false);await assert.rejects(h.api.eventRequest('/events/'+EVENT+'/battle',{method:'POST',data:{deviceId:'event-tab',expectedRevision:7}}),e=>e.code==='EVENT_SYNC_REQUIRED');
 h.scope.SengokuBridge.hasStarted=()=>false;await assert.rejects(h.api.eventRequest('/events/'+EVENT+'/battle',{method:'POST',data:{}}),/本拠を選び/);assert.equal(h.calls.length,0);
});
test('an identity switch cannot receive the previous lord battle result',async()=>{
 const h=harness(),wait=deferred();h.setWritable(true);h.setTransport(()=>wait.promise);
 const task=h.api.eventRequest('/events/'+EVENT+'/battle',{method:'POST',data:{requestId:'battle-one',stageId:'stage-1',tactic:'balanced',deviceId:'event-tab',expectedRevision:7}});
 h.t.changeIdentity('u_'+'3'.repeat(32));wait.resolve({ok:true,battle:{won:true}});await assert.rejects(task,e=>e.code==='STALE_IDENTITY');
});
test('command availability belongs to the confirmed current identity and is copied',()=>{
 const h=harness();h.setWritable(true);const first=h.api.getEventContext().commands;
 assert.equal(first.current,2);assert.equal(first.max,3);assert.equal(first.cost,1);assert.equal(first.writable,true);first.current=99;assert.equal(h.api.getEventContext().commands.current,2);
 h.t.pending();assert.equal(h.api.getEventContext().commands,null);assert.equal(harness({guest:true}).api.getEventContext().commands,null);
});
test('recovery or account revalidation cannot use confirmed-player operations',async()=>{
 for(const change of ['pending','hold']){const h=harness({admin:true});h.t[change]();assert.equal(h.api.getEventContext().pending,true);assert.equal(h.api.getEventContext().isAdmin,false);await assert.rejects(h.api.eventRequest('/admin/events'),/接続中/);assert.equal(h.calls.length,0);}
});
test('event gift mail has the right label and retains the existing claim flow',()=>{
 const h=harness();h.t.s.mail=[{id:'mail-event',title:'期間限定合戦の褒賞',body:'戦功達成',source:'system',event:{kind:'timed-event'},gift:{gold:100},claimed:false,createdAt:'2026-11-22T00:00:00Z'}];
 assert.match(h.t.mailView(),/期間限定合戦 · 報酬あり/);h.t.s.openedMail='mail-event';assert.match(h.t.mailView(),/data-social="mail-claim"/);
 h.t.s.openedMail=null;h.t.s.mail[0].claimed=true;assert.match(h.t.mailView(),/期間限定合戦 · 報酬は受取済み/);
});
(async()=>{for(const {name,run} of tests){await run();console.log('PASS '+name);}console.log('PASS '+tests.length+' event transport and mail checks');})().catch(error=>{console.error(error);process.exitCode=1;});

