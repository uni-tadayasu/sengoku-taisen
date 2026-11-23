'use strict';
// Mounted production renderers and deterministic DOM only; all reads stay local.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup:dom}=require('./helpers/dom-model.cjs'),stable=require('../stable-dom.js');
const events=require('../events.js'),eventFixtures=require('./test-events-ui.cjs');
const tests=[],test=(name,run)=>tests.push([name,run]);
const clone=value=>JSON.parse(JSON.stringify(value));
const sameNode=(actual,expected)=>assert(actual===expected,'the mounted DOM node must be retained');
function socialFixture(){
 const {doc}=dom();doc.hidden=false;
 const dialog=doc.createElement('dialog');dialog.open=true;doc.body.appendChild(dialog);
 dialog.innerHTML='<nav id="social-tabs"></nav><span id="social-connection"></span><small id="social-online-count"></small><div id="social-dialog-body"></div><div id="social-confirm-host"></div>';
 const body=dialog.querySelector('#social-dialog-body'),mounts={avatar:[],voice:[]},actor={id:'actor',name:'本人',clan:'織田家',isAdmin:false,isStaff:false,guildId:null};
 let handler=async()=>({ok:true,user:clone(actor),friends:[],requests:[]});
 const scope={console,URL,URLSearchParams,AbortController,Date,Intl,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},document:doc,
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://fixture.invalid',SengokuStableDOM:stable,
  SengokuBridge:{setAdminAccess(){},setRoleAccess(){},setSyncAccess(){},toast(){}},SengokuCloudSync:{start(){},stop(){},getStatus:()=>({linked:true,ready:true,writable:true}),getDevice:()=>({id:'device',name:'試験端末'})},
  SengokuAvatar:{markup:user=>`<span data-avatar-owner="${user?.id||''}"></span>`,mount(host,options){const input=doc.createElement('input');host.appendChild(input);const item={host,input,options,destroyed:false};mounts.avatar.push(item);return{update(){},destroy(){item.destroyed=true;host.textContent='';}};}},
  SengokuVoice:{refreshAccess(){},leave(){},mount(host){const input=doc.createElement('button');host.appendChild(input);const item={host,input,disposed:false};mounts.voice.push(item);return{dispose(){item.disposed=true;host.textContent='';}};}},
  fetch:async(url,options)=>({ok:true,status:200,json:async()=>handler(url,options)})};
 scope.window=scope;vm.createContext(scope);
 const source=fs.readFileSync(require.resolve('../social.js'),'utf8').replace('global.SengokuSocial={open','global.__pollTest={s,render,loadStaff,refreshFriendsView,acceptUser,installIdentity,setUI:(d,b)=>{dialog=d;body=b;}};global.SengokuSocial={open');
 vm.runInContext(source,scope);const t=scope.__pollTest;t.setUI(dialog,body);t.s.identity={id:actor.id,token:'a'.repeat(64)};t.s.user=clone(actor);t.s.open=true;t.s.configLoaded=true;
 return{scope,doc,dialog,body,mounts,actor,t,setHandler:fn=>handler=fn,$:selector=>dialog.querySelector(selector)};
}
test('staff polls retain loaded row portraits and focused controls, while additions update the real roster',async()=>{
 const f=socialFixture();f.t.s.user.isAdmin=true;f.t.s.tab='admin';f.t.s.adminSection='staff';
 const staff=id=>({id,name:'スタッフ'+id,isStaff:true,isAdmin:false,clan:'德川家'});let list=[staff('first'),staff('second')];
 f.setHandler(async()=>({ok:true,staff:clone(list)}));f.t.render();await f.t.loadStaff();
 const first=f.$('[data-stable-key="staff-first"]'),portrait=first.querySelector('[data-avatar-owner]'),button=first.querySelector('button');portrait.setAttribute('data-loaded','1');button.focus();f.body.scrollTop=160;
 for(let i=0;i<5;i++)await f.t.loadStaff();sameNode(f.$('[data-stable-key="staff-first"]'),first);sameNode(f.doc.activeElement,button);assert.equal(portrait.getAttribute('data-loaded'),'1');
 list=[staff('new'),{...list[1],name:'更新されたスタッフ'},list[0]];await f.t.loadStaff();
 sameNode(f.$('[data-stable-key="staff-first"]'),first);sameNode(first.querySelector('[data-avatar-owner]'),portrait);assert.equal(f.$('#social-staff-count').textContent,'3人');assert.match(f.$('[data-stable-key="staff-second"]').textContent,/更新された/);sameNode(f.doc.activeElement,button);assert.equal(f.body.scrollTop,160);
 f.t.acceptUser({...f.t.s.user,isAdmin:false});f.t.render();assert.equal(f.$('#social-staff-roster'),null);assert.equal(first.isConnected,false);
});
test('friend list refreshes preserve chat drafts, loaded messages and counters but an account change clears private nodes',()=>{
 const f=socialFixture(),friend=id=>({id,name:'友人'+id,clan:'武田家',online:false});f.t.s.tab='friends';f.t.s.friends=[friend('one'),friend('two')];f.t.s.friendId='one';
 f.t.s.chats.set('friend:one',{messages:[{id:1,userId:'one',name:'友人one',text:'読んでいる便り',createdAt:'2026-11-23T00:00:00Z'}],after:1});f.t.render();
 const draft=f.$('#social-chat-input'),message=f.$('[data-stable-key="1"]'),friendRow=f.$('[data-stable-key="friend-one"]');draft.value='送信前の下書き';draft.focus();draft.setSelectionRange(2,5);message.setAttribute('data-loaded','1');
 f.t.s.friends=[friend('three'),{...friend('two'),online:true},friend('one')];f.t.s.unreadMail=3;f.t.render();f.t.refreshFriendsView();
 sameNode(f.$('#social-chat-input'),draft);sameNode(f.doc.activeElement,draft);assert.equal(draft.value,'送信前の下書き');assert.equal(draft.selectionStart,2);assert.equal(draft.selectionEnd,5);sameNode(f.$('[data-stable-key="1"]'),message);assert.equal(message.getAttribute('data-loaded'),'1');sameNode(f.$('[data-stable-key="friend-one"]'),friendRow);assert.match(f.$('#social-friend-list').textContent,/3/);assert.equal(f.$('[data-social-tab="mail"] .social-tab-count').textContent,'3');
 f.t.installIdentity({id:'other',token:'b'.repeat(64)},{...f.actor,id:'other',name:'別の領主'});f.t.render();assert.equal(draft.isConnected,false);assert.equal(message.isConnected,false);assert(!f.body.textContent.includes('読んでいる便り'));
});
test('same-context profile and voice refreshes keep mounted widgets, with explicit teardown across role and guild changes',()=>{
 const f=socialFixture();f.t.s.tab='profile';f.t.render();const avatar=f.mounts.avatar[0];avatar.input.value='編集中';avatar.input.focus();
 for(let i=0;i<4;i++)f.t.render();assert.equal(f.mounts.avatar.length,1);sameNode(f.$('#social-avatar-editor'),avatar.host);assert.equal(avatar.input.value,'編集中');sameNode(f.doc.activeElement,avatar.input);
 f.t.acceptUser({...f.t.s.user,isStaff:true});f.t.render();assert(avatar.destroyed);assert.equal(avatar.host.isConnected,false);assert.equal(f.mounts.avatar.length,2);
 f.t.acceptUser({...f.t.s.user,guildId:'g-one',guildName:'第一同盟',guildRole:'member'});f.t.s.tab='guild';f.t.s.guildSection='chat';f.t.render();const voice=f.mounts.voice[0];voice.input.focus();
 for(let i=0;i<4;i++)f.t.render();assert.equal(f.mounts.voice.length,1);sameNode(f.$('#social-voice-room'),voice.host);sameNode(f.doc.activeElement,voice.input);
 f.t.acceptUser({...f.t.s.user,guildId:'g-two',guildName:'第二同盟'});f.t.render();assert(voice.disposed);assert.equal(voice.host.isConnected,false);assert.equal(f.mounts.voice.length,2);
});
async function eventFixture(settings,run){
 const f=eventFixtures.setup(settings),{doc}=dom();doc.hidden=false;f.controller.dispose();
 const old={stable:global.SengokuStableDOM,avatar:global.SengokuAvatar};global.SengokuStableDOM=stable;global.SengokuAvatar={markup:user=>`<span data-avatar-owner="${user.id}"></span>`};
 const ui=events.createUI({...f.options,document:doc,autoPoll:false});
 try{await ui.open();await run({...f,ui,doc,$:selector=>doc.querySelector(selector)});}finally{ui.dispose();global.SengokuStableDOM=old.stable;global.SengokuAvatar=old.avatar;}
}
test('event polls patch forecast numbers and keyed ranking order without replacing selected controls or loaded portraits',async()=>{
 const event=eventFixtures.catalogEventFixture(),progress=eventFixtures.advisedProgressFixture(event);
 await eventFixture({events:[event],progress},async f=>{
  const tactic=f.$('#events-tactic'),adviser=f.$('[data-events="advice"]'),ranking=f.$('.events-ranking li'),portrait=ranking.querySelector('[data-avatar-owner]'),card=f.$('[data-events="select"]');portrait.setAttribute('data-loaded','1');tactic.focus();
  f.server.progress.points=321;f.server.progress.advisers[0].options.find(option=>option.tactic===tactic.value).playerPower=2222;
  f.server.leaderboard=[{...eventFixtures.rankFixture()[0],rank:1,playerId:'u_'+'3'.repeat(32),name:'新たな領主'}, {...eventFixtures.rankFixture()[0],rank:2,points:900}];
  await f.ui.refresh({quiet:true});sameNode(f.$('#events-tactic'),tactic);sameNode(f.doc.activeElement,tactic);sameNode(f.$('[data-events="advice"]'),adviser);sameNode(f.$('[data-events="select"]'),card);sameNode(f.$('.events-ranking').querySelectorAll('li')[1],ranking);sameNode(ranking.querySelector('[data-avatar-owner]'),portrait);assert.equal(portrait.getAttribute('data-loaded'),'1');assert.match(f.$('[data-event-adviser]').textContent,/2,222/);assert.match(f.$('[data-event-progress]').textContent,/321/);
  f.server.events[0].status='ended';f.server.events[0].endedAt='2026-11-22T03:00:00Z';await f.ui.refresh({quiet:true});sameNode(f.$('#events-tactic'),tactic);sameNode(f.$('.events-ranking').querySelectorAll('li')[1],ranking);
  const context=f.context();f.setContext({...context,epoch:context.epoch+1,playerId:'u_'+'4'.repeat(32),user:{...context.user,id:'u_'+'4'.repeat(32)}});await f.ui.refreshAccess();assert.equal(tactic.isConnected,false);
 });
});
test('a loaded empty event list never flashes a loading placeholder during its next background request',async()=>{
 await eventFixture({events:[]},async f=>{
  const title=f.$('.events-empty h2'),text=title.textContent;let resolve;const wait=new Promise(done=>resolve=done);f.setHandler((route,settings,base)=>route==='/events'?wait:base(route,settings));
  const pending=f.ui.refresh({quiet:true});sameNode(f.$('.events-empty h2'),title);assert.equal(title.textContent,text);assert(!title.textContent.includes('確認中'));
  resolve({ok:true,serverNow:'2026-11-22T03:00:00Z',events:[]});await pending;sameNode(f.$('.events-empty h2'),title);assert.equal(title.textContent,text);
 });
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' mounted polling stability groups passed. No network or persistent changes.');})().catch(error=>{console.error(error);process.exitCode=1;});
