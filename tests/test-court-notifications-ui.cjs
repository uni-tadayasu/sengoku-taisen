/* Court notification navigation uses fresh authoritative admission and no payload IDs. */
'use strict';
const assert=require('node:assert/strict'),Court=require('../court.js'),{setup}=require('./helpers/dom-model.cjs');
const clone=value=>JSON.parse(JSON.stringify(value)),THREAD='ca_'+'a'.repeat(32),tests=[],test=(name,run)=>tests.push([name,run]);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
async function until(check){for(let i=0;i<100;i++){if(check())return;await Promise.resolve();}assert(check(),'async checkpoint');}
function fixture(section='overview'){
 let context={epoch:1,accountEpoch:1,privilegeEpoch:1,playerId:'visitor',user:{id:'visitor',name:'参内者',isAdmin:false,isStaff:false}},hook=null,serial=0;
 const info={ok:true,eligible:true,requirement:{rankId:'court-7',rankName:'従五位',minScore:35000},evaluation:{score:35000,rankName:'従五位'},accessStamp:'entry-one',self:{id:'visitor',name:'参内者',title:'従五位',merit:0,canRespond:false,canAppoint:false,isCourtEmperor:false},palace:{id:'kyoto_gosho',name:'京都御所',level:20,maxLevel:128,buildings:{},jobCount:0},features:{conversation:true,audience:true,roster:false},thresholds:[],contentRevision:1};
 const thread={id:THREAD,title:'以前の相談',status:'open',messageCount:1,createdAt:'2026-11-28T00:00:00Z',updatedAt:'2026-11-28T00:00:00Z',requester:{id:'visitor',name:'参内者'},canReply:true};
 const message={id:'cc_'+'a'.repeat(32),seq:1,text:'以前に開いた私的な返信',createdAt:'2026-11-28T00:00:00Z',author:{kind:'court',id:null,name:'朝廷'},own:false};
 const calls=[],frames=[];
 const respond=(route,args={})=>{
  if(args.method==='POST')return{ok:true,message:clone(message)};
  if(route==='/court')return clone(info);
  if(route.startsWith('/court/chat?'))return{ok:true,messages:[{...clone(message),text:'新しい談話'}],contentRevision:1,reset:true};
  if(route.startsWith('/court/audiences?'))return{ok:true,threads:[clone(thread)],nextCursor:null,contentRevision:1};
  if(route.startsWith('/court/audiences/'+THREAD))return{ok:true,thread:clone(thread),messages:[clone(message)],hasOlder:false,nextBefore:null,contentRevision:1};
  throw Error('Unexpected route '+route);
 };
 const options={initialSection:section,getContext:()=>context,now:()=>1000,uuid:()=>`notification-test-${++serial}`,storage:{getItem:()=>null,setItem(){},removeItem(){}},onChange:s=>frames.push(s),request:async(route,args={})=>{calls.push({route,...clone(args)});return hook?hook(route,args):respond(route,args);}};
 const controller=Court.createController(options);
 return{controller,options,info,thread,message,calls,frames,respond,get context(){return context;},set context(value){context=value;},set hook(value){hook=value;}};
}
test('a court talk notification hides stale content until fresh admission succeeds',async()=>{
 const h=fixture('chat');await h.controller.load();h.controller.update('chat','保存した談話の下書き');const pause=deferred(),before=h.calls.length;h.hook=(route,args)=>route==='/court'?pause.promise:h.respond(route,args);
 assert.equal(h.controller.openNotification('courtChat'),true);assert.deepEqual(h.calls.slice(before).map(c=>c.route),['/court']);assert.equal(h.controller.snapshot().chat.length,0);
 const waiting=Court.markup(h.controller.snapshot());assert.match(waiting,/参内資格を確認しています/);assert.doesNotMatch(waiting,/保存した談話の下書き|data-court-form/);assert.equal(await h.controller.submit('chat'),false);
 pause.resolve(clone(h.info));await until(()=>h.controller.snapshot().chatLoaded);assert.equal(h.controller.snapshot().section,'chat');assert.equal(h.controller.snapshot().drafts.chat,'保存した談話の下書き');assert.match(Court.markup(h.controller.snapshot()),/新しい談話/);
});
test('an audience notification opens the current list and clears only the previous thread reply draft',async()=>{
 const h=fixture('audiences');await h.controller.load();assert(h.controller.openThread(THREAD));await until(()=>!!h.controller.snapshot().thread);h.controller.update('reply','以前の相手への返信下書き');h.controller.update('title','新しい相談の件名');h.controller.update('body','まだ送っていない新しい相談');h.controller.update('chat','別の談話下書き');
 const before=h.calls.length;assert(h.controller.openNotification('courtAudiences'));assert.equal(h.controller.snapshot().threadId,'');assert.equal(h.controller.snapshot().thread,null);assert.equal(h.controller.snapshot().messages.length,0);assert.equal(h.controller.snapshot().drafts.reply,'');await until(()=>h.controller.snapshot().threadsLoaded);
 assert.deepEqual(h.calls.slice(before).map(c=>c.route),['/court','/court/audiences?limit=30']);assert.equal(h.controller.snapshot().drafts.title,'新しい相談の件名');assert.equal(h.controller.snapshot().drafts.body,'まだ送っていない新しい相談');assert.equal(h.controller.snapshot().drafts.chat,'別の談話下書き');assert.doesNotMatch(Court.markup(h.controller.snapshot()),/以前に開いた私的な返信|以前の相手への返信下書き/);
});
test('revoked server admission cannot be overridden by a court notification',async()=>{
 const h=fixture('chat');await h.controller.load();h.controller.update('chat','以前の下書き');h.info.eligible=false;h.info.features.conversation=false;h.info.features.audience=false;h.info.accessStamp='revoked';const before=h.calls.length;
 assert(h.controller.openNotification('courtChat'));await until(()=>!h.controller.snapshot().loading);assert.deepEqual(h.calls.slice(before).map(c=>c.route),['/court']);assert.equal(h.controller.snapshot().section,'overview');assert.equal(h.controller.snapshot().drafts.chat,'');assert.doesNotMatch(Court.markup(h.controller.snapshot()),/data-court-form|以前の下書き/);
});
test('a failed admission refresh keeps old private content hidden and offers an explicit retry',async()=>{
 const h=fixture('chat');await h.controller.load();h.controller.update('chat','公開しない下書き');h.hook=()=>{throw Error('接続できませんでした');};assert(h.controller.openNotification('courtChat'));await until(()=>!h.controller.snapshot().loading);
 const html=Court.markup(h.controller.snapshot());assert.match(html,/参内資格を確認できませんでした/);assert.doesNotMatch(html,/公開しない下書き|data-court-form/);assert.equal(await h.controller.submit('chat'),false);
 h.hook=null;await h.controller.load();assert.equal(h.controller.snapshot().chatLoaded,true);assert.equal(h.controller.snapshot().drafts.chat,'公開しない下書き');
});
test('an account change while notification admission is pending discards the old result',async()=>{
 const h=fixture(),pause=deferred();h.hook=()=>pause.promise;assert(h.controller.openNotification('courtAudiences'));h.context={...h.context,epoch:2,playerId:'next',user:{id:'next'},pending:true};h.controller.refresh();pause.resolve(clone(h.info));await Promise.resolve();await Promise.resolve();
 assert.equal(h.controller.snapshot().info,null);assert.equal(h.controller.snapshot().threads.length,0);assert.deepEqual(h.calls.map(c=>c.route),['/court']);assert.doesNotMatch(Court.markup(h.controller.snapshot()),/以前の相談/);
});
test('a late old thread read cannot reopen that thread after an audience notification',async()=>{
 const h=fixture('audiences');await h.controller.load();const pause=deferred();h.hook=(route,args)=>route.startsWith('/court/audiences/'+THREAD)?pause.promise:h.respond(route,args);assert(h.controller.openThread(THREAD));await until(()=>h.calls.some(c=>c.route.startsWith('/court/audiences/'+THREAD)));
 assert(h.controller.openNotification('courtAudiences'));await until(()=>h.controller.snapshot().threadsLoaded);pause.resolve({ok:true,thread:clone(h.thread),messages:[clone(h.message)],contentRevision:1});await Promise.resolve();await Promise.resolve();assert.equal(h.controller.snapshot().threadId,'');assert.equal(h.controller.snapshot().thread,null);assert.equal(h.controller.snapshot().messages.length,0);
});
test('guests, pending and banned accounts and unsupported destinations do not request court data',()=>{
 for(const changes of [{user:null},{pending:true},{banned:true}]){const h=fixture();h.context={...h.context,...changes};assert.equal(h.controller.openNotification('courtAudiences'),false);assert.equal(h.calls.length,0);assert.equal(h.controller.snapshot().threads.length,0);}
 const h=fixture();for(const destination of ['management','chat',THREAD,'/court/audiences/'+THREAD,'https://example.invalid',null,{}])assert.equal(h.controller.openNotification(destination),false);assert.equal(h.calls.length,0);h.controller.dispose();assert.equal(h.controller.openNotification('courtChat'),false);assert.equal(h.calls.length,0);
});
test('an uncertain message send is preserved and cannot be displaced by notification navigation',async()=>{
 const h=fixture('chat');await h.controller.load();h.controller.update('chat','送信結果が未確認の内容');h.hook=(route,args)=>{if(args.method==='POST')throw Object.assign(Error('response lost'),{status:503});return h.respond(route,args);};assert.equal(await h.controller.submit('chat'),false);const before=clone(h.controller.snapshot().pending),count=h.calls.length;assert(before);
 assert.equal(h.controller.openNotification('courtAudiences'),false);assert.deepEqual(h.controller.snapshot().pending,before);assert.equal(h.controller.snapshot().section,'chat');assert.equal(h.controller.snapshot().drafts.chat,'送信結果が未確認の内容');assert.equal(h.calls.length,count);
});
test('module notification entry delegates to the current mounted controller and releases it on disposal',async()=>{
 assert.equal(Court.openNotification('courtChat'),false);const h=fixture(),{host}=setup(),mounted=Court.mount(host,h.options);try{assert.equal(Court.openNotification('courtAudiences'),true);await until(()=>mounted.controller.snapshot().threadsLoaded);assert.equal(mounted.controller.snapshot().section,'audiences');assert.match(host.textContent,/あなたの拝謁/);}finally{mounted.dispose();}assert.equal(Court.openNotification('courtAudiences'),false);
});
(async()=>{let failed=0;for(const[name,run]of tests){try{await run();console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}console.log(`${tests.length-failed}/${tests.length} court notification scenarios passed.`);if(failed)process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
