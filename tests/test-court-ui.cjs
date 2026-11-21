/* Authoritative court admission, durable-in-flight intents, and mounted DOM. */
'use strict';
const assert=require('node:assert/strict');
const Court=require('../court.js'),stable=require('../stable-dom.js'),{setup}=require('./helpers/dom-model.cjs');
const clone=value=>JSON.parse(JSON.stringify(value)),THREAD='ca_'+'a'.repeat(32),OTHER='ca_'+'b'.repeat(32),tests=[],test=(name,run)=>tests.push([name,run]);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function until(condition){for(let i=0;i<100;i++){if(condition())return;await Promise.resolve();}assert(condition(),'async checkpoint');}
const message=(seq,text='内容 '+seq,author={kind:'visitor',id:'visitor-one',name:'参内した領主'})=>({id:'cc_'+String(seq).padStart(32,'0'),seq,text,createdAt:'2026-11-22T10:00:00Z',author,own:false});
function fixture({admin=false,staff=false,eligible=true,section='overview'}={}){
 let context={epoch:1,accountEpoch:1,privilegeEpoch:1,playerId:'visitor-one',user:{id:'visitor-one',name:'参内した領主',isAdmin:admin,isStaff:staff,evaluation:{score:999999,rankName:'正一位'}}},time=1000,uuid=0,hook=null;
 const info={ok:true,eligible,requirement:{rankId:'court-7',rankName:'従五位',minScore:35000},evaluation:{score:eligible?35000:34999,rankName:eligible?'従五位':'正六位'},accessStamp:'access-one',self:{id:'visitor-one',name:'参内した領主',title:admin?'太政大臣':staff?'参議':'従五位',merit:0,canRespond:admin||staff,canAppoint:admin},palace:{id:'kyoto_gosho',name:'京都御所',level:100,maxLevel:128,buildings:{keep:32},jobCount:2},features:{conversation:eligible,audience:eligible,roster:admin||staff},thresholds:[{title:'参議',minMerit:0},{title:'左大臣',minMerit:2000}],contentRevision:1};
 const thread={id:THREAD,title:'御所に届ける願い',status:'open',messageCount:1,createdAt:'2026-11-22T10:00:00Z',updatedAt:'2026-11-22T10:00:00Z',requester:{id:'visitor-one',name:'参内した領主'},canReply:true};
 const data={chat:[message(1)],threads:[thread],messages:[message(1)],roster:[{id:'staff-one',name:'朝廷の担当者',title:'参議',merit:2,completedUpgrades:2,isLeader:false,termId:'term-one'}]},calls=[],frames=[];
 const options={getContext:()=>context,now:()=>time,uuid:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`,initialSection:section,onChange:s=>frames.push(s),request:async(route,args={})=>{calls.push({route,...clone(args)});if(hook)return hook(route,args);return respond(route,args);}};
 function respond(route,args={}){
  if(args.method==='POST')return{ok:true,message:message(2,args.data.text||''),thread:clone(thread),roster:clone(data.roster)};
  if(route==='/court')return clone(info);
  if(route.startsWith('/court/chat'))return{ok:true,messages:clone(data.chat),contentRevision:info.contentRevision,reset:false};
  if(route.startsWith('/court/audiences/'+THREAD))return{ok:true,thread:clone(thread),messages:clone(data.messages),contentRevision:info.contentRevision,hasOlder:false,nextBefore:null};
  if(route.startsWith('/court/audiences?'))return{ok:true,threads:clone(data.threads),nextCursor:null,contentRevision:info.contentRevision};
  if(route==='/staff/court')return{ok:true,roster:clone(data.roster),leaderId:data.leaderId||null};
  throw Error('Unexpected fixture route '+route);
 }
 const controller=Court.createController(options);
 return{controller,options,info,data,thread,calls,frames,respond,get context(){return context;},set context(value){context=value;},set hook(value){hook=value;},advance:ms=>time+=ms};
}
test('server eligibility controls admission even when the client reports the highest rank',async()=>{
 const h=fixture({eligible:false});await h.controller.load();assert.equal(h.controller.snapshot().info.eligible,false);assert.equal(h.controller.selectSection('chat'),false);h.controller.update('chat','hello');assert.equal(await h.controller.submit('chat'),false);assert.equal(h.calls.filter(c=>c.method==='POST').length,0);const html=Court.markup(h.controller.snapshot());assert.match(html,/従五位から参内/);assert.doesNotMatch(html,/data-court-form/);
 h.info.eligible=true;h.info.features.conversation=true;h.info.accessStamp='admitted';await h.controller.load();assert.equal(h.controller.selectSection('chat'),true);await until(()=>h.controller.snapshot().chatLoaded);assert.equal(h.controller.snapshot().chat.length,1);
});
test('guests and pending identities make no court requests and see no private records',async()=>{
 const h=fixture({section:'audiences'});h.context={...h.context,user:null,pending:true};h.controller.refresh();await h.controller.load();assert.equal(h.calls.length,0);assert.match(Court.markup(h.controller.snapshot()),/領主の接続を確認/);assert.equal(h.controller.snapshot().threads.length,0);
});
test('court authors use neutral aliases and all visitor-authored content is escaped',async()=>{
 const h=fixture({section:'chat'});h.data.chat=[message(1,'<img src=x>',{kind:'court',id:'SECRET_OPERATOR_ID',name:'SECRET_OPERATOR_NAME',avatarVersion:'a'.repeat(64)}),message(2,'<script>alert(1)</script>',{kind:'visitor',id:'visitor-two',name:'<visitor>'})];await h.controller.load();const html=Court.markup(h.controller.snapshot());assert.match(html,/朝廷/);assert.doesNotMatch(html,/SECRET_OPERATOR|<img src=x>|<script>alert/);assert.match(html,/&lt;visitor&gt;/);assert.match(html,/&lt;script&gt;/);assert.equal(h.controller.snapshot().chat[0].author.id,null);
});
test('quiet polling preserves drafts and does not toggle loading after the first snapshot',async()=>{
 const h=fixture({section:'chat'});await h.controller.load();h.controller.update('chat','書いている途中');h.frames.length=0;const pause=deferred();h.hook=(route,args)=>route==='/court'?pause.promise:h.respond(route,args);h.advance(15000);h.controller.refresh();assert.equal(h.controller.snapshot().loading,false);assert.equal(h.controller.snapshot().drafts.chat,'書いている途中');pause.resolve(clone(h.info));await until(()=>h.frames.length>=3);assert(h.frames.every(s=>!s.loading));assert.equal(h.controller.snapshot().drafts.chat,'書いている途中');
});
test('uncertain sends retry one UUID and payload, prevent edits, and clear only the submitted draft after success',async()=>{
 const h=fixture({section:'chat'});await h.controller.load();h.controller.update('chat','同じ受付番号で届ける');let attempts=0;h.hook=(route,args)=>{if(args.method==='POST'&&++attempts===1)throw Object.assign(Error('response lost'),{status:503});return h.respond(route,args);};assert.equal(await h.controller.submit('chat'),false);const pending=h.controller.snapshot().pending;assert(pending);assert.equal(h.controller.update('chat','別の内容'),false);assert.equal(h.controller.selectSection('audiences'),false);assert.equal(await h.controller.submit(),true);const posts=h.calls.filter(c=>c.method==='POST');assert.equal(posts.length,2);assert.deepEqual(posts[0].data,posts[1].data);assert.equal(h.controller.snapshot().drafts.chat,'');assert.equal(h.controller.snapshot().pending,null);
});
test('late account responses cannot restore private audiences or an old draft',async()=>{
 const h=fixture({section:'audiences'}),pause=deferred();h.hook=()=>pause.promise;const task=h.controller.load();h.context={...h.context,epoch:2,playerId:'another',user:{id:'another',name:'別の領主'},pending:true};h.controller.refresh();pause.resolve(clone(h.info));assert.equal(await task,false);assert.equal(h.controller.snapshot().info,null);assert.equal(h.controller.snapshot().threads.length,0);assert.equal(h.controller.snapshot().drafts.body,'');
});
test('server admission revocation clears public talk, private threads, drafts and controls',async()=>{
 const h=fixture({section:'audiences'});await h.controller.load();h.controller.update('body','private unfinished letter');h.info.eligible=false;h.info.accessStamp='revoked';await h.controller.load({background:true});const s=h.controller.snapshot();assert.equal(s.section,'overview');assert.equal(s.threads.length,0);assert.equal(s.drafts.body,'');assert.doesNotMatch(Court.markup(s),/private unfinished|data-court-form/);
});
test('audience creation, private replies and server thread permissions use their intended routes',async()=>{
 const h=fixture({section:'audiences'});await h.controller.load();h.controller.update('title','相談');h.controller.update('body','相談の本文');assert.equal(await h.controller.submit('audience'),true);await until(()=>!!h.controller.snapshot().thread);assert.equal(h.calls.find(c=>c.method==='POST').route,'/court/audiences');h.controller.update('reply','追記します');assert.equal(await h.controller.submit('reply'),true);assert.equal(h.calls.filter(c=>c.method==='POST')[1].route,'/court/audiences/'+THREAD+'/replies');await until(()=>!h.controller.snapshot().loading);h.thread.canReply=false;await h.controller.load({background:true});h.controller.update('reply','送信しない');const before=h.calls.length;assert.equal(await h.controller.submit('reply'),false);assert.equal(h.calls.length,before);
});
test('only private authorized management loads a roster and leader assignment requires confirmation',async()=>{
 const visitor=fixture();await visitor.controller.load();assert.equal(visitor.controller.selectSection('management'),false);assert(!visitor.calls.some(c=>c.route==='/staff/court'));
 const staff=fixture({staff:true,section:'management'});await staff.controller.load();assert.equal(staff.controller.confirmLeader(),false);assert.doesNotMatch(Court.markup(staff.controller.snapshot()),/court-leader-select/);
 const admin=fixture({admin:true,section:'management'});await admin.controller.load();admin.controller.update('leader','staff-one');assert.equal(await admin.controller.submit('leader'),false);assert(admin.controller.confirmLeader());assert.equal(await admin.controller.submit('leader'),true);const post=admin.calls.find(c=>c.method==='POST');assert.equal(post.route,'/admin/court/leader');assert.equal(post.data.targetPlayerId,'staff-one');
});
test('an untouched appointment selects the current leader while a deliberate draft survives later polls',async()=>{
 const h=fixture({admin:true,section:'management'});h.data.leaderId='staff-one';h.data.roster[0].isLeader=true;await h.controller.load();assert.equal(h.controller.snapshot().drafts.leader,'staff-one');assert.match(Court.markup(h.controller.snapshot()),/<option value="staff-one" selected>/);
 h.data.roster.push({id:'staff-two',name:'新しい担当者',title:'天皇',merit:100,completedUpgrades:10,isLeader:true,termId:'term-two'});h.data.leaderId='staff-two';await h.controller.load({background:true});assert.equal(h.controller.snapshot().drafts.leader,'staff-two');
 h.controller.update('leader','');await h.controller.load({background:true});assert.equal(h.controller.snapshot().drafts.leader,'','An explicit vacancy choice is not overwritten by the current leader');
 h.controller.update('leader','staff-one');await h.controller.load({background:true});assert.equal(h.controller.snapshot().drafts.leader,'staff-one');
 h.context={...h.context,epoch:2};await h.controller.load({background:true});assert.equal(h.controller.snapshot().drafts.leader,'staff-two','A new identity context receives the current verified leader');
});
test('the permanent operator is roster-only and an ended staff term cannot be appointed',async()=>{
 const h=fixture({admin:true,section:'management'});h.data.roster.push({id:'operator-one',name:'御所の太政大臣',title:'太政大臣',merit:0,completedUpgrades:0,isLeader:false,termId:null});await h.controller.load();
 const html=Court.markup(h.controller.snapshot());assert.match(html,/court-roster-operator-one/);assert.doesNotMatch(html,/<option value="operator-one"/);h.controller.update('leader','operator-one');assert.equal(h.controller.confirmLeader(),false);
 h.controller.update('leader','staff-one');assert(h.controller.confirmLeader());h.data.roster[0].termId='new-term';await h.controller.load({background:true});assert.equal(await h.controller.submit('leader'),false);assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
});
test('permission changes invalidate a delayed appointment without showing its old response',async()=>{
 const h=fixture({admin:true,section:'management'});await h.controller.load();h.controller.update('leader','staff-one');h.controller.confirmLeader();const pause=deferred();h.hook=(route,args)=>args.method==='POST'?pause.promise:h.respond(route,args);const task=h.controller.submit('leader');h.context={...h.context,privilegeEpoch:2,user:{...h.context.user,isAdmin:false},pending:true};h.controller.refresh();pause.resolve({ok:true,roster:clone(h.data.roster)});assert.equal(await task,false);const s=h.controller.snapshot();assert.equal(s.roster,null);assert.equal(s.confirmation,null);assert.equal(s.pending,null);assert.doesNotMatch(Court.markup(s),/staff-one|朝廷の担当者/);
});
test('content revision changes remove moderated messages while keeping the unsent draft',async()=>{
 const h=fixture({section:'chat'});await h.controller.load();h.controller.update('chat','keep draft');h.info.contentRevision=2;h.data.chat=[message(2,'remaining')];await h.controller.load({background:true});assert.deepEqual(h.controller.snapshot().chat.map(m=>m.seq),[2]);assert.equal(h.controller.snapshot().drafts.chat,'keep draft');
});
test('moderation between admission and thread reads purges earlier cached messages',async()=>{
 const h=fixture({section:'audiences'});await h.controller.load();h.controller.openThread(THREAD);await until(()=>!!h.controller.snapshot().thread);h.controller.update('reply','keep private draft');
 h.hook=(route,args)=>route.startsWith('/court/audiences/'+THREAD)?{ok:true,thread:clone(h.thread),messages:[message(2,'remaining reply')],contentRevision:2,hasOlder:false,nextBefore:null}:h.respond(route,args);
 await h.controller.load({background:true});const s=h.controller.snapshot();assert.deepEqual(s.messages.map(m=>m.seq),[2]);assert.equal(s.info.contentRevision,2);assert.equal(s.drafts.reply,'keep private draft');
});
test('a background read started before a send cannot clear its pinned retry or replace the new result',async()=>{
 const h=fixture({section:'chat'});await h.controller.load();h.controller.update('chat','send after polling starts');const pause=deferred();h.hook=(route,args)=>route==='/court'?pause.promise:args.method==='POST'?Promise.reject(Object.assign(Error('lost response'),{status:503})):h.respond(route,args);
 const read=h.controller.load({background:true});assert.equal(await h.controller.submit('chat'),false);const pending=h.controller.snapshot().pending;assert(pending);pause.resolve({...clone(h.info),accessStamp:'outdated-read'});assert.equal(await read,false);assert.deepEqual(h.controller.snapshot().pending,pending);assert.equal(h.controller.snapshot().loading,false);
});
test('opening older audience messages retains their history during quiet latest-page polling',async()=>{
 const h=fixture({section:'audiences'});await h.controller.load();h.hook=(route,args)=>route.startsWith('/court/audiences/'+THREAD)?{ok:true,thread:clone(h.thread),messages:route.includes('before=')?[message(1),message(2)]:[message(3),message(4)],contentRevision:1,hasOlder:!route.includes('before='),nextBefore:route.includes('before=')?null:3}:h.respond(route,args);
 h.controller.openThread(THREAD);await until(()=>!!h.controller.snapshot().thread);assert.equal(h.controller.snapshot().hasOlder,true);await h.controller.load({older:true});assert.deepEqual(h.controller.snapshot().messages.map(m=>m.seq),[1,2,3,4]);assert.equal(h.controller.snapshot().hasOlder,false);await h.controller.load({background:true});assert.deepEqual(h.controller.snapshot().messages.map(m=>m.seq),[1,2,3,4]);assert.equal(h.controller.snapshot().hasOlder,false);
});
test('mounted live updates retain controls, IME draft, caret, messages and scroll; identity resets detach them',async()=>{
 const h=fixture({section:'chat'}),{host,doc,$}=setup();global.SengokuStableDOM=stable;const mounted=Court.mount(host,h.options);await until(()=>mounted.controller.snapshot().chatLoaded);const input=$('#court-chat-input'),row=$('.court-message'),list=$('.court-message-list'),removed=[];input.focus();input.value='変換中の文字';input.setSelectionRange(1,4);host.scrollTop=317;list.scrollTop=29;doc.onRemove=node=>removed.push(node);
 h.info.palace.level++;h.data.chat.push(message(2));h.advance(15000);mounted.refresh();await until(()=>mounted.controller.snapshot().chat.length===2);assert.strictEqual($('#court-chat-input'),input);assert.strictEqual($('.court-message'),row);assert.strictEqual(doc.activeElement,input);assert.equal(input.value,'変換中の文字');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,4);assert.equal(host.scrollTop,317);assert.equal(list.scrollTop,29);assert.equal(removed.length,0);
 input.value='実際の入力';input.dispatchEvent({type:'input'});assert.equal(mounted.controller.snapshot().drafts.chat,'実際の入力');h.context={...h.context,epoch:2,playerId:'next',user:null,pending:true};mounted.refresh();assert.equal(input.isConnected,false);assert.equal(row.isConnected,false);assert.equal($('#court-chat-input'),null);mounted.dispose();
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' court UI, privacy, admission and mounted DOM checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
