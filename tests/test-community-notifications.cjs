/* Exercise the production community UI with local responses only. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
async function until(check){for(let n=0;n<80;n++){if(check())return;await Promise.resolve();}assert(check(),'Async checkpoint was not reached');}
const frame=(top=0,bottom=700,left=0,right=700)=>({top,bottom,left,right,width:right-left,height:bottom-top});
const message=(id,text='受信した会話')=>({id,text,userId:'friend-a',name:'相手領主',createdAt:'2026-11-28T00:00:00Z'});
const notice=(id='n1',destination='friends')=>({id,seq:1,kind:'friend-request',title:'フレンド申請が届きました',body:'交流から申請を確認できます。',destination,createdAt:'2026-11-28T00:00:00Z'});
function fixture(){
 const {doc}=setup(),requests=[],timers=new Map(),toasts=[],refreshes=[];let timerId=0,overlays=0,handler=async()=>({ok:true}),focused=true;
 doc.hidden=false;doc.hasFocus=()=>focused;doc.getElementById=id=>doc.querySelector('#'+id);
 const dialog=doc.createElement('dialog');dialog.innerHTML='<nav id="social-tabs"></nav><div id="social-connection"></div><div id="social-online-count"></div><div id="social-feedback" hidden></div><div id="social-dialog-body"></div><div id="social-confirm-host"></div>';doc.body.appendChild(dialog);
 const body=dialog.querySelector('#social-dialog-body'),launcher=doc.createElement('button');launcher.innerHTML='<span class="social-unread"></span>';doc.body.appendChild(launcher);
 dialog.getBoundingClientRect=()=>frame();body.getBoundingClientRect=()=>frame(70,600);body.clientHeight=530;body.scrollHeight=1500;
 const user={id:'player-a',name:'確認領主',guildId:'guild-a',guildName:'同盟',guildRole:'member',isAdmin:false,isStaff:false};
 const c={document:doc,console,URL,URLSearchParams,AbortController,Date,Intl,Map,Set,Promise,innerHeight:800,innerWidth:900,
  setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://example.invalid',SengokuStableDOM:require('../stable-dom.js'),
  SengokuLoading:{begin(){return ++overlays;},end(){}},SengokuCloudSync:{start(){},stop(){}},
  SengokuBridge:{setRoleAccess(){},setSyncAccess(){},toast:(message,error)=>toasts.push({message,error})},
  fetch:async(url,options)=>{requests.push({url,options});const r=await handler(url,options);return{ok:!r.__status,status:r.__status||200,json:async()=>r};}
 };
 c.window=c;vm.createContext(c);
 const expose='global.__communityTest={s,header,render,renderTabs,renderMessages,loadChat,loadMe,loadConfig,refreshMailStatus,applySocialSummary,acknowledgeVisibleChat,visibleChatReceipt,readSocialNotification,notificationsView,chatScroll,click,acceptUser,installIdentity,setUI:(d,b,l)=>{dialog=d;body=b;launcher=l;},stubViewRefresh:fn=>{refresh=fn;}};global.SengokuSocial={open';
 assert(source.includes('global.SengokuSocial={open'));vm.runInContext(source.replace('global.SengokuSocial={open',expose),c);
 const t=c.__communityTest;t.setUI(dialog,body,launcher);t.s.identity={id:user.id,token:'a'.repeat(64)};t.s.user={...user};t.s.friends=[{id:'friend-a',name:'相手領主'}];t.s.configLoaded=true;t.s.config.features={};t.renderTabs();
 const response=(changes={})=>({ok:true,user:{...user},friends:[{id:'friend-a',name:'相手領主'}],requests:[],unreadMail:0,unreadChat:{world:0,guild:0,admin:0,friends:{},total:0,latestId:0},unreadSocial:{friends:0,guild:0,trade:0,total:0,latestId:0},socialNotifications:[],...changes});
 const setSummary=changes=>{t.applySocialSummary(response(changes));t.header();};
 function showChat({channel='world',lastId=10,scrollTop=700,rendered=true}={}){
  t.s.tab=channel==='friend'?'friends':channel;t.s.friendId=channel==='friend'?'friend-a':null;t.s.guildSection='chat';t.s.adminSection='chat';t.s.open=true;dialog.open=true;
  body.innerHTML='<div id="social-message-list"></div><textarea id="social-chat-input">書きかけの下書き</textarea>';
  const list=body.querySelector('#social-message-list'),key=channel+':'+(channel==='friend'?'friend-a':channel==='guild'?'guild-a':'');
  list.clientHeight=300;list.scrollHeight=1000;let top=scrollTop;Object.defineProperty(list,'scrollTop',{get:()=>top,set:value=>{top=Math.min(700,Math.max(0,value));},configurable:true});list.getBoundingClientRect=()=>frame(100,400,20,680);
  t.s.chats.set(key,{messages:[message(lastId)],after:lastId,rendered});
  // Paint before attaching measurable row geometry, just as a browser layout follows DOM work.
  t.renderMessages();const row=list.querySelector('#social-chat-message-'+lastId);row.getBoundingClientRect=()=>frame(300,380,40,660);
  const input=body.querySelector('#social-chat-input');input.focus();input.setSelectionRange(3,7);return{list,row,input,key,cache:t.s.chats.get(key)};
 }
 const command=(action,id)=>{const button=doc.createElement('button');button.dataset.social=action;if(id)button.dataset.id=id;return t.click({target:button});};
 const badge=tab=>dialog.querySelector('[data-social-tab="'+tab+'"] .social-tab-count')?.textContent;
 return{c,t,doc,dialog,body,launcher,user,requests,timers,toasts,refreshes,response,setSummary,showChat,command,badge,setHandler:fn=>handler=fn,setFocused:value=>focused=value,get overlays(){return overlays;}};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('the existing closed-community poll reports every unread area without loading conversations or replacing the body',async()=>{
 const f=fixture();f.t.s.user.isStaff=true;f.t.renderTabs();f.t.s.unreadLetters=6;f.body.innerHTML='<textarea id="keep-draft">保持する下書き</textarea><span data-friend-unread="friend-a"></span>';const input=f.body.querySelector('textarea');input.focus();input.setSelectionRange(1,4);f.body.scrollTop=180;
 f.setHandler(async()=>f.response({user:{...f.user,isStaff:true},unreadMail:5,unreadChat:{world:2,guild:3,admin:4,friends:{'friend-a':7},latestId:100},unreadSocial:{friends:1,guild:2,trade:3,latestId:10},socialNotifications:[notice()]}));
 await f.t.refreshMailStatus();assert.equal(f.t.s.open,false);assert.equal(f.launcher.querySelector('.social-unread').textContent,'33');assert.match(f.launcher.getAttribute('aria-label'),/未読 33 件/);
 for(const [tab,count] of [['world','2'],['guild','5'],['admin','4'],['friends','8'],['trade','3'],['notifications','6'],['mail','5'],['letters','6']])assert.equal(f.badge(tab),count,tab);
 assert.equal(f.body.querySelector('[data-friend-unread]').textContent,'7');assert.equal(f.body.querySelector('textarea'),input);assert.equal(f.doc.activeElement,input);assert.equal(input.value,'保持する下書き');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,4);assert.equal(f.body.scrollTop,180);assert.deepEqual(f.requests.map(r=>new URL(r.url).pathname),['/api/v1/me']);assert.equal(f.overlays,0);assert.equal(f.toasts.length,0);
});
test('new sequence IDs notify once even when the count is unchanged and do not insert an inline status row',()=>{
 const f=fixture(),summary={unreadChat:{world:1,latestId:40},unreadSocial:{friends:1,latestId:7},socialNotifications:[notice()]};f.setSummary(summary);assert.equal(f.toasts.length,0);
 f.setSummary({...summary,unreadChat:{world:1,latestId:41}});assert.equal(f.toasts.length,1);f.setSummary({...summary,unreadChat:{world:1,latestId:41}});assert.equal(f.toasts.length,1);
 f.setSummary({...summary,unreadChat:{world:1,latestId:42},unreadSocial:{friends:1,latestId:8}});assert.equal(f.toasts.length,2);assert.match(f.toasts[1].message,/会話と交流/);assert.equal(f.dialog.querySelector('#social-feedback').textContent,'');
 f.doc.hidden=true;f.setSummary({...summary,unreadChat:{world:1,latestId:43}});assert.equal(f.toasts.length,2);assert.equal(f.badge('world'),'1');
});
test('manual chat delivery does not acknowledge messages while the community is closed',async()=>{
 const f=fixture();f.setSummary({unreadChat:{world:2,latestId:11}});f.setHandler(async()=>({ok:true,messages:[message(10),message(11)],nextAfter:11}));await f.t.loadChat();
 assert.equal(f.requests.length,1);assert.equal(new URL(f.requests[0].url).searchParams.get('read'),'manual');assert.equal(f.requests[0].options.method,'GET');assert.equal(f.t.s.chats.get('world:').messages.length,2);assert.equal(f.badge('world'),'2');
});
test('only a focused, visible conversation at its rendered bottom is acknowledged, with duplicate receipts coalesced',async()=>{
 const f=fixture(),pending=deferred();f.setSummary({unreadChat:{world:3,latestId:10}});const {input,cache,list}=f.showChat();f.setHandler(()=>pending.promise);
 const task=f.t.acknowledgeVisibleChat();const duplicate=f.t.acknowledgeVisibleChat();assert.equal(f.requests.length,1);assert.equal(f.overlays,0);assert.deepEqual(JSON.parse(f.requests[0].options.body),{channel:'world',lastId:10});assert.equal(f.badge('world'),'3');
 pending.resolve({ok:true,lastId:10});await Promise.all([task,duplicate]);assert.equal(cache.ackAfter,10);assert.equal(f.badge('world'),'');assert.equal(f.doc.activeElement,input);assert.equal(input.value,'書きかけの下書き');assert.equal(input.selectionStart,3);assert.equal(list.scrollTop,700);assert.equal(f.requests.length,1);
});
test('hidden, unfocused, covered, scrolled-up, and offscreen conversations all retain their unread count',async()=>{
 const guards=[f=>{f.doc.hidden=true;},f=>f.setFocused(false),f=>{f.t.s.open=false;},f=>{f.dialog.open=false;},f=>{f.t.s.confirm={};},(f,v)=>{v.list.scrollTop=400;},(f,v)=>{v.list.clientHeight=0;},(f,v)=>{v.row.getBoundingClientRect=()=>frame(450,510);},(f,v)=>{v.row.getBoundingClientRect=()=>frame(20,50);},f=>{f.c.visualViewport={offsetTop:0,height:250,width:900};}];
 for(const guard of guards){const f=fixture();f.setSummary({unreadChat:{world:1,latestId:10}});const v=f.showChat();guard(f,v);await f.t.acknowledgeVisibleChat();assert.equal(f.requests.length,0);assert.equal(f.badge('world'),'1');}
});
test('a foreground profile or other dialog prevents the covered conversation from becoming read',async()=>{
 const f=fixture();f.setSummary({unreadChat:{world:2,latestId:10}});const {input}=f.showChat();const foreground=f.doc.createElement('dialog'),close=f.doc.createElement('button');foreground.appendChild(close);f.doc.body.appendChild(foreground);foreground.open=true;close.focus();
 await f.t.acknowledgeVisibleChat();assert.equal(f.requests.length,0);assert.equal(f.badge('world'),'2');
 foreground.remove();input.focus();f.setHandler(async()=>({ok:true,lastId:10}));await f.t.acknowledgeVisibleChat();assert.equal(f.requests.length,1);assert.equal(f.badge('world'),'');
});
test('scrolling to the actual message bottom acknowledges the friend room only',async()=>{
 const f=fixture();f.setSummary({unreadChat:{world:2,guild:3,friends:{'friend-a':4,'friend-b':5},latestId:10}});const {list}=f.showChat({channel:'friend',scrollTop:200});f.setHandler(async()=>({ok:true,lastId:10}));
 f.t.chatScroll({target:list});assert.equal(f.requests.length,0);list.scrollTop=700;f.t.chatScroll({target:list});await until(()=>f.t.s.unreadChat.friends['friend-a']===0);assert.deepEqual(JSON.parse(f.requests[0].options.body),{channel:'friend',target:'friend-a',lastId:10});assert.equal(f.t.s.unreadChat.world,2);assert.equal(f.t.s.unreadChat.guild,3);assert.equal(f.t.s.unreadChat.friends['friend-b'],5);
});
test('an acknowledgement never clears unseen messages from a newer summary',async()=>{
 const f=fixture(),pending=deferred();f.setSummary({unreadChat:{world:1,latestId:10}});f.showChat();f.setHandler(()=>pending.promise);const task=f.t.acknowledgeVisibleChat();f.setSummary({unreadChat:{world:2,latestId:11}});pending.resolve({ok:true,lastId:10});await task;assert.equal(f.badge('world'),'2');assert.equal(f.t.s.chats.get('world:').ackAfter,10);
});
test('a later cursor read on another device cannot advance this view beyond the messages it displayed',async()=>{
 const f=fixture();f.setSummary({unreadChat:{world:2,latestId:12}});const {cache}=f.showChat();f.setHandler(async()=>({ok:true,lastId:12}));await f.t.acknowledgeVisibleChat();assert.equal(cache.ackAfter,10);assert.equal(f.badge('world'),'2');
 f.setHandler(async()=>f.response());await f.t.loadMe();assert.equal(f.badge('world'),'');assert.equal(f.requests.length,2);
});
test('an older pending summary cannot resurrect a count after confirmed visible reading',async()=>{
 const f=fixture(),old=deferred();f.setSummary({unreadChat:{world:2,latestId:10}});f.showChat();f.setHandler(url=>url.endsWith('/me')?old.promise:Promise.resolve({ok:true,lastId:10}));
 const summary=f.t.loadMe();await f.t.acknowledgeVisibleChat();assert.equal(f.badge('world'),'');old.resolve(f.response({unreadChat:{world:2,latestId:10}}));await summary;assert.equal(f.badge('world'),'');
});
test('failed and partial chat receipts stay unread and can be retried',async()=>{
 const f=fixture();f.setSummary({unreadChat:{world:3,latestId:10}});const {cache}=f.showChat();f.setHandler(async()=>({ok:false,__status:503,error:{code:'TEMPORARY',message:'offline'}}));await f.t.acknowledgeVisibleChat();assert.equal(f.badge('world'),'3');assert.equal(cache.ackAfter,undefined);
 f.setHandler(async()=>({ok:true,lastId:8}));await f.t.acknowledgeVisibleChat();assert.equal(f.badge('world'),'3');assert.equal(cache.ackAfter,8);f.setHandler(async()=>({ok:true,lastId:10}));await f.t.acknowledgeVisibleChat();assert.equal(f.badge('world'),'');assert.equal(f.requests.length,3);
});
test('newly rendered messages queue one further visible receipt after the current one completes',async()=>{
 const f=fixture(),first=deferred();f.setSummary({unreadChat:{world:2,latestId:11}});const {cache,list}=f.showChat();f.setHandler((url,options)=>JSON.parse(options.body).lastId===10?first.promise:Promise.resolve({ok:true,lastId:11}));const task=f.t.acknowledgeVisibleChat();
 cache.messages.push(message(11));cache.after=11;f.t.renderMessages();list.querySelector('#social-chat-message-11').getBoundingClientRect=()=>frame(300,380,40,660);assert.equal(f.requests.length,1);first.resolve({ok:true,lastId:10});await task;await until(()=>cache.ackAfter===11);assert.equal(f.requests.length,2);assert.equal(f.badge('world'),'');
});
test('listing lifecycle notifications does not consume them and confirming an item acknowledges its exact ID only',async()=>{
 const f=fixture(),pending=deferred();f.setSummary({unreadSocial:{friends:1,guild:1,trade:1,latestId:3},socialNotifications:[notice('n1'),notice('n2','guild'),notice('n3','trade')]});f.t.s.open=true;f.dialog.open=true;f.t.s.tab='notifications';f.t.render();assert.equal(f.requests.length,0);assert.match(f.body.textContent,/フレンド申請/);
 f.setHandler(()=>pending.promise);const a=f.t.readSocialNotification('n2'),b=f.t.readSocialNotification('n2');assert.equal(f.requests.length,1);assert.equal(f.overlays,0);assert.deepEqual(JSON.parse(f.requests[0].options.body),{ids:['n2']});assert.equal(f.t.s.socialNotifications.length,3);
 pending.resolve({ok:true,readIds:['n2']});await Promise.all([a,b]);assert.deepEqual(Array.from(f.t.s.socialNotifications,n=>n.id),['n1','n3']);assert.equal(f.t.s.unreadSocial.guild,0);assert.equal(f.t.s.unreadSocial.friends,1);assert.equal(f.t.s.unreadSocial.trade,1);assert.equal(f.badge('notifications'),'2');
});
test('missing or failed lifecycle acknowledgements retain the notification and allow retry',async()=>{
 const f=fixture();f.setSummary({unreadSocial:{friends:1,latestId:1},socialNotifications:[notice()]});f.setHandler(async()=>({ok:true,readIds:[]}));await f.t.readSocialNotification('n1');assert.equal(f.t.s.socialNotifications.length,1);assert.equal(f.badge('notifications'),'1');
 f.setHandler(async()=>({ok:false,__status:503,error:{code:'TEMPORARY',message:'offline'}}));await assert.rejects(f.t.readSocialNotification('n1'));assert.equal(f.t.s.socialNotifications.length,1);f.setHandler(async()=>({ok:true,readIds:['n1']}));await f.t.readSocialNotification('n1');assert.equal(f.t.s.socialNotifications.length,0);assert.equal(f.badge('notifications'),'');
});
test('opening a notification destination remains immediate while the read receipt is pending',async()=>{
 const f=fixture(),pending=deferred();f.t.stubViewRefresh(async options=>f.refreshes.push(options));f.setSummary({unreadSocial:{friends:1,latestId:1},socialNotifications:[notice()]});f.t.s.open=true;f.t.s.tab='notifications';f.dialog.open=true;f.t.render();f.setHandler(()=>pending.promise);
 const task=f.command('notification-open','n1');assert.equal(f.t.s.tab,'friends');assert.match(f.body.textContent,/フレンドを選ぶ/);assert.equal(f.requests.length,1);assert.equal(f.refreshes.length,1);assert.equal(f.overlays,0);pending.resolve({ok:true,readIds:['n1']});await task;assert.equal(f.t.s.tab,'friends');assert.equal(f.t.s.socialNotifications.length,0);
});
test('alliance lifecycle notices open the actual application or treasury screen before their receipt finishes',async()=>{
 for(const [kind,tab]of [['guild-invitation','members'],['guild-application','members'],['guild-approved','members'],['treasury-request','policy'],['treasury-approved','policy']]){
  const f=fixture(),pending=deferred(),opened=[];f.c.SengokuBridge.openAlliance=value=>opened.push(value);f.setSummary({unreadSocial:{guild:1,latestId:1},socialNotifications:[{...notice('n1','guild'),kind}]});f.t.s.open=true;f.t.s.tab='notifications';f.dialog.open=true;f.t.render();assert.match(f.body.textContent,tab==='members'?/加入申請・招待を開く/:/金庫管理を開く/);f.setHandler(()=>pending.promise);
  const task=f.command('notification-open','n1');assert.deepEqual(opened,[tab]);assert.equal(f.t.s.open,false);assert.equal(f.dialog.open,false);assert.equal(f.requests.length,1);pending.resolve({ok:true,readIds:['n1']});await task;
 }
});
test('notification receipts and summaries from a previous identity cannot mutate a replacement account',async()=>{
 for(const kind of ['chat','notice','summary']){
  const f=fixture(),pending=deferred();f.setSummary({unreadChat:{world:1,latestId:10},unreadSocial:{friends:1,latestId:1},socialNotifications:[notice()]});if(kind==='chat')f.showChat();f.setHandler(()=>pending.promise);
  const task=kind==='chat'?f.t.acknowledgeVisibleChat():kind==='notice'?f.t.readSocialNotification('n1'):f.t.loadMe();const settled=Promise.resolve(task).catch(e=>{assert.equal(e.code,'STALE_IDENTITY');});
  f.t.installIdentity({id:'player-b',token:'b'.repeat(64)},{id:'player-b',name:'別領主'});f.t.s.open=false;f.dialog.open=false;f.setSummary({unreadChat:{world:4,latestId:20},unreadSocial:{friends:2,latestId:2},socialNotifications:[notice('n1'),notice('n2')]});
  pending.resolve(kind==='chat'?{ok:true,lastId:10}:kind==='notice'?{ok:true,readIds:['n1']}:f.response());await settled;assert.equal(f.t.s.user.id,'player-b');assert.equal(f.t.s.unreadChat.world,4);assert.equal(f.t.s.unreadSocial.friends,2);assert.equal(f.t.s.socialNotifications.length,2);
 }
});
test('notification text is escaped and room summaries respect current guild and staff access',()=>{
 const f=fixture();f.t.s.user.guildId=null;f.setSummary({unreadChat:{world:1,guild:9,admin:9,friends:{'friend-a':2},latestId:20},socialNotifications:[{...notice(),title:'<img src=x onerror=bad()>',body:'<script>bad()</script>'}]});
 const html=f.t.notificationsView();assert.match(html,/&lt;img/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img src=x/);assert.equal(f.t.s.unreadChat.guild,0);assert.equal(f.t.s.unreadChat.admin,0);assert.equal(f.t.s.unreadChat.world,1);assert.equal(f.t.s.unreadChat.friends['friend-a'],2);
});
test('long transaction notification IDs remain reviewable and are sent intact',async()=>{
 const f=fixture(),id='alliance:'+('a'.repeat(90))+':'+('b'.repeat(90))+':'+('c'.repeat(90));f.setSummary({unreadSocial:{guild:1,latestId:1},socialNotifications:[notice(id,'guild')]});assert.equal(f.t.s.socialNotifications.length,1);f.setHandler(async()=>({ok:true,readIds:[id]}));await f.t.readSocialNotification(id);assert.deepEqual(JSON.parse(f.requests[0].options.body),{ids:[id]});assert.equal(f.t.s.socialNotifications.length,0);
});
test('court negotiation notices contribute unread counts, open the negotiation screen and acknowledge only their own area',async()=>{
 const f=fixture(),pending=deferred(),opened=[];f.c.SengokuBridge.openCourtNegotiations=()=>opened.push('negotiations');f.dialog.close=()=>{f.dialog.open=false;};
 f.setSummary({unreadSocial:{friends:1,court:2,latestId:3},socialNotifications:[notice('friend','friends'),{...notice('negotiation','courtNegotiations'),kind:'court-negotiation-offer',title:'主従交渉の提案が届きました'}]});f.t.s.open=true;f.t.s.tab='notifications';f.dialog.open=true;f.t.render();assert.equal(f.badge('notifications'),'3');assert.equal(f.launcher.querySelector('.social-unread').textContent,'3');assert.match(f.body.textContent,/武家との交渉を開く/);assert.match(f.body.querySelector('[data-social="notification-area"][data-id="courtNegotiations"]').textContent,/2/);
 f.setHandler(()=>pending.promise);const task=f.command('notification-open','negotiation');assert.deepEqual(opened,['negotiations']);assert.equal(f.t.s.open,false);assert.equal(f.t.s.unreadSocial.court,2);pending.resolve({ok:true,readIds:['negotiation']});await task;assert.equal(f.t.s.unreadSocial.court,1);assert.equal(f.t.s.unreadSocial.friends,1);assert.equal(f.badge('notifications'),'2');assert.equal(f.t.s.socialNotifications[0].id,'friend');
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(`${tests.length} community notification UI checks passed; all responses were local fixtures.`);})().catch(error=>{console.error(error);process.exitCode=1;});
