/* Notification routes exercise the real social dialog and its access guards.
 * Only background refresh is replaced; no network or private endpoint is used. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8');
function fixture(){
 const {doc}=setup(),dialog=doc.createElement('dialog'),body=doc.createElement('div'),refreshes=[],letters=[];
 dialog.innerHTML='<nav id="social-tabs"></nav><div id="social-confirm-host"></div>';
 dialog.appendChild(body);doc.body.appendChild(dialog);
 const context={document:doc,console,URL,URLSearchParams,AbortController,setTimeout:()=>0,clearTimeout(){},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SengokuStableDOM:require('../stable-dom.js'),SengokuLetters:{openInbox:()=>letters.push('inbox')},__refreshes:refreshes};
 context.window=context;vm.createContext(context);
 const expose='global.__notificationSocial={s,channel,setUI:(d,b)=>{dialog=d;body=b;}};refresh=async options=>global.__refreshes.push(options);global.SengokuSocial={open';
 assert(source.includes('global.SengokuSocial={open'));
 vm.runInContext(source.replace('global.SengokuSocial={open',expose),context);
 const t=context.__notificationSocial;t.setUI(dialog,body);t.s.identity={id:'actor',token:'local-fixture-token'};t.s.user={id:'actor',name:'領主',guildId:'guild-a',guildName:'同盟',guildRole:'member',isAdmin:false,isStaff:false};t.s.configLoaded=true;t.s.config.features={};
 return{api:context.SengokuSocial,s:t.s,channel:t.channel,body,dialog,refreshes,letters};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('a guild notification opens chat even after the treasury was last used',()=>{
 const f=fixture();f.s.guildSection='treasury';f.api.open('guild');assert.equal(f.s.guildSection,'treasury');assert(f.body.querySelector('#social-guild-resource'));
 f.api.openNotification('guild');assert.equal(f.channel().channel,'guild');assert(f.body.querySelector('#social-chat-form'));assert.equal(f.body.querySelector('#social-guild-resource'),null);assert.equal(f.dialog.open,true);
});
test('an authorized private-room notification leaves a previously open mail-composition page',()=>{
 const f=fixture();f.s.user.isAdmin=true;f.s.adminSection='mail';f.api.open('admin');assert(f.body.querySelector('#social-admin-mail-form'));
 f.api.openNotification('admin');assert.equal(f.channel().channel,'admin');assert(f.body.querySelector('#social-chat-form'));assert.equal(f.body.querySelector('#social-admin-mail-form'),null);
});
test('a friend notification opens the list without presenting a stale unrelated conversation',()=>{
 const f=fixture();f.s.friends=[{id:'old-friend',name:'以前の相手'}];f.s.friendId='old-friend';f.s.chats.set('friend:old-friend',{messages:[{id:1,text:'以前の相手の会話本文',name:'以前の相手',userId:'old-friend',createdAt:'2026-11-28T00:00:00Z'}]});f.api.open('friends');assert.match(f.body.textContent,/以前の相手の会話本文/);
 f.api.openNotification('friends');assert.equal(f.s.friendId,null);assert.equal(f.channel(),null);assert.match(f.body.textContent,/フレンドを選ぶ/);assert.doesNotMatch(f.body.textContent,/以前の相手の会話本文/);
});
test('a mail notification returns to the inbox instead of an earlier selected letter',()=>{
 const f=fixture();f.s.mail=[{id:'old-mail',title:'以前の便り',body:'以前に開いた本文',createdAt:'2026-11-28T00:00:00Z'}];f.s.openedMail='old-mail';f.api.open('mail');assert.match(f.body.textContent,/以前に開いた本文/);
 f.api.openNotification('mail');assert.equal(f.s.openedMail,null);assert.match(f.body.textContent,/届いた便り/);assert.doesNotMatch(f.body.textContent,/以前に開いた本文/);
});
test('notification routing retains the actual open path for letters and whitelists destinations',()=>{
 const f=fixture();f.api.openNotification('letters');assert.deepEqual(f.letters,['inbox']);
 for(const destination of ['world','news']){f.api.openNotification(destination);assert.equal(f.s.tab,destination);}
 for(const destination of ['moderation','promotion','trade','https://example.invalid',null,{}]){f.api.openNotification(destination);assert.equal(f.s.tab,'mail');}
 assert.deepEqual(f.letters,['inbox']);
});
test('notification entry keeps authorization, ban and pending-access guards',()=>{
 const f=fixture();f.s.adminSection='mail';f.api.openNotification('admin');assert.equal(f.s.tab,'world');assert.equal(f.channel().channel,'world');assert.equal(f.body.querySelector('#social-admin-mail-form'),null);
 f.s.accountBanned={message:'利用停止中'};f.api.openNotification('letters');assert.equal(f.s.tab,'profile');assert.equal(f.letters.length,0);assert.equal(f.body.querySelector('#social-chat-form'),null);
 f.s.accountBanned=null;f.s.accountAccessPending={message:'確認中'};f.api.openNotification('guild');assert.equal(f.s.tab,'profile');assert.equal(f.body.querySelector('#social-chat-form'),null);
 f.s.accountAccessPending=null;f.s.user=null;f.api.openNotification('admin');assert.equal(f.s.tab,'world');assert.match(f.body.textContent,/領主の登録・引き継ぎ/);assert.equal(f.body.querySelector('#social-chat-form'),null);
});
let failed=0;for(const[name,run]of tests){try{run();console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}
console.log(`${tests.length-failed}/${tests.length} social notification routes passed.`);if(failed)process.exitCode=1;
