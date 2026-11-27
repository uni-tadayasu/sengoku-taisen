'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Chat = require('../social-chat.js');
const {setup: dom} = require('./helpers/dom-model.cjs');
const source = fs.readFileSync(path.join(__dirname, '../social.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(__dirname, '../social-chat.js'), 'utf8');
const other = {userId:'u_other',name:'織田信長'}, third = {userId:'u_third',name:'武田信玄'};
const message = {id:12,userId:other.userId,name:other.name,text:'合戦の支度をお願いします。'};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise,resolve}; };
function controllerRig(options = {}) {
  const {doc,host} = dom(); let current = {key:'actor:world:',channel:'world',actorId:'actor'};
  const notices = [], features = {chatReplies:true,chatMentions:true}, rows = [other,third];
  const controller = Chat.create({context:()=>current,capabilities:()=>features,candidates:()=>rows,message:id=>Number(id)===message.id?message:null,notice:(text,error)=>notices.push({text,error}),...options});
  function mount() {
    host.innerHTML = `<section class="social-chat"><div id="social-message-list"><article id="social-chat-message-12" tabindex="-1"><button data-chat-action="reply" data-chat-message="12">返信</button></article></div>${controller.form()}</section>`;
    controller.attach(host);
  }
  const $ = selector => host.querySelector(selector);
  function type(text,cursor=text.length) { const input=$('#social-chat-input');input.value=text;input.setSelectionRange(cursor,cursor);input.dispatchEvent({type:'input'});return input; }
  function click(selector) { const node=$(selector);assert(node,selector);node.dispatchEvent({type:'click'}); }
  function key(key,extra={}) {const event={target:$('#social-chat-input'),key,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra};return {handled:controller.keydown(event),event};}
  function switchTo(next) {current={actorId:'actor',...next};mount();}
  mount();return {doc,host,$,controller,notices,features,rows,type,click,key,switchTo,mount};
}
function socialRig() {
  const {doc,host} = dom(), requests = [], feedback = [], sounds = [], timers = new Map();let timerId=0, handler=async()=>({ok:true,features:{chatReplies:true,chatMentions:true},messages:[],nextAfter:0}),coarse=false;
  doc.getElementById = id => doc.body.querySelector('#'+id);
  const context = {console,URL,URLSearchParams,AbortController,Intl,Date,crypto:require('node:crypto').webcrypto,document:doc,
    setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    matchMedia:()=>({matches:coarse}),localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://api.example.invalid',
    FormData:class {constructor(form){this.form=form;}get(name){return this.form.querySelector('[name="'+name+'"]')?.value??null;}},
    SengokuStableDOM:require('../stable-dom.js'),SengokuBridge:{setAdminAccess(){},setSyncAccess(){},playInterfaceSound:kind=>sounds.push(kind),toast:(text,error)=>feedback.push({text,error})},
    SengokuCloudSync:{start(){},stop(){}},
    fetch:async(url,options)=>{requests.push({url,options});const state=context.__chatTest?.s,result=new URL(url).pathname.endsWith('/me')?{ok:true,user:state.user,friends:state.friends,requests:[]}:await handler(url,options);return {ok:!result.__status,status:result.__status||200,json:async()=>result};}
  };
  context.window=context;vm.createContext(context);vm.runInContext(chatSource,context);
  vm.runInContext(source.replace('global.SengokuSocial={open','global.__chatTest={s,init,render,renderMessages,submit,loadConfig,clearPrivate,clearGuildData,clearAdminData,chatEnhancements,acceptUser,installIdentity};global.SengokuSocial={open'),context);
  const t=context.__chatTest;t.init();
  t.s.identity={id:'actor',token:'a'.repeat(64)};t.s.user={id:'actor',name:'本人',isAdmin:false,guildId:'g1',guildName:'一門'};t.s.open=true;t.s.tab='world';t.s.config.features={chatReplies:true,chatMentions:true};t.s.configLoaded=true;
  t.s.friends=[{id:other.userId,name:other.name},{id:third.userId,name:third.name}];t.s.members=[{id:'actor',name:'本人'},...t.s.friends];
  t.s.chats.set('world:',{messages:[message],after:12});t.render();
  const dialog=doc.getElementById('community-modal'),$=selector=>dialog.querySelector(selector);dialog.open=true;
  function type(text,cursor=text.length) {const input=$('#social-chat-input');input.value=text;input.setSelectionRange(cursor,cursor);input.dispatchEvent({type:'input'});return input;}
  function click(selector) {const node=$(selector);assert(node,selector);node.dispatchEvent({type:'click'});}
  async function send() {const form=$('#social-chat-form');await t.submit({target:form,submitter:form.querySelector('[type="submit"]'),preventDefault(){}});}
  function key(key,extra={}) {const event={type:'keydown',key,...extra};$('#social-chat-input').dispatchEvent(event);return event;}
  function switchTo(tab,target) {t.s.tab=tab;if(target)t.s.friendId=target;t.render();}
  return {t,context,doc,host,dialog,$,requests,feedback,sounds,timers,type,click,send,key,switchTo,setHandler:fn=>handler=fn,setCoarse:value=>coarse=value};
}
let count=0;async function test(name,run) {await run();count++;console.log('PASS '+name);}
(async()=>{
await test('list choices populate a search field or one scoped mention without taking the next action',async()=>{
  const b=socialRig();let picker;
  b.context.SengokuInputList={open:config=>{picker=config;}};
  b.context.Event=class {constructor(type){this.type=type;}};
  b.switchTo('friends',other.userId);
  const input=b.type('届けます');
  b.click('[data-chat-action="mention-open"]');
  assert.equal(input.value,'届けます');
  assert.equal(picker.options.length,1);assert.equal(picker.options[0].value,other.userId);
  assert.equal(picker.load,undefined,'Private rooms never request public mention candidates');
  picker.onSelect(picker.options[0]);
  assert.equal(input.value,'届けます @織田信長 ');
  assert.deepEqual(Array.from(b.t.chatEnhancements().prepare().mentionIds),[other.userId]);
  b.click('[data-social="player-list"]');
  assert.equal(picker.options.filter(row=>row.value===other.userId).length,1);
  assert.deepEqual(Object.keys(b.context.SengokuSocial.getKnownPlayers()[0]).sort(),['id','name']);
  picker.onSelect(picker.options[0]);assert.equal(b.$('#social-player-query').value,other.userId);
  b.switchTo('world');assert.equal(picker.valid(),false);
  assert(!b.requests.some(item=>item.options.method==='POST'),'Choosing never sends a request or a message');
});
await test('operator mail selects the exact ID among identical names and retains the draft and gifts',()=>{
 const b=socialRig();let picker;
 b.context.SengokuInputList={open:value=>{picker=value;}};b.context.Event=class {constructor(type){this.type=type;}};
 b.t.s.user.isAdmin=true;b.t.s.adminSection='mail';
 b.t.s.onlinePlayers=[{id:'u_alpha',name:'同名',guildId:null},{id:'u_beta',name:'同名',guildId:'g_2'}];
 b.switchTo('admin');
 const input=b.$('#social-mail-body'),gift=b.$('[name=gold]');input.value='本文の下書き';gift.value='100';
 b.click('[data-list-purpose="target"]');const choice=picker.options.find(row=>row.value==='u_beta');
 assert.equal(choice.label,'同名');picker.onSelect(choice);
 assert.equal(b.$('#social-mail-target').value,'u_beta');
 assert.equal(input.value,'本文の下書き');assert.equal(gift.value,'100');assert(!b.t.s.confirm);
 assert.deepEqual(Array.from(b.context.SengokuSocial.getKnownPlayers({unguildedOnly:true}),p=>p.id),['u_alpha']);
 assert(!b.requests.some(item=>item.options.method==='POST'));
});
await test('untrusted text, recipient names and quoted parents remain plain text',()=>{
  assert.deepEqual(Chat.people([{id:'x',name:'初名'},{userId:'x',name:'更新名'},null,{id:{},name:'無効'}]),[{userId:'x',name:'更新名'}]);
  const malicious={userId:'u_" onclick="bad',name:'<img onerror=bad>'};
  const html=Chat.textMarkup('<script>bad()</script> @'+malicious.name,[malicious])+Chat.messageDetails({replyTo:{id:3,name:'<b>領主</b>',text:'<img src=x>'},mentions:[malicious]},malicious.userId);
  assert(!html.includes('<script>'));assert(!html.includes('<img'));assert(!html.includes('<b>'));assert(!html.includes(' onclick="bad'));
  assert.match(html,/&lt;script&gt;/);assert.match(html,/あなた宛て/);
  assert.equal(Chat.textMarkup('@領主[a]+へ',[{id:'x',name:'領主[a]+'}]),'<mark class="social-chat-mention-text">@領主[a]+</mark>へ');
  assert.match(Chat.messageDetails({replyTo:{id:1,unavailable:true}},'actor'),/返信先の発言は表示できません/);
  assert.equal(Chat.messageDetails({text:'従来の投稿'},'actor'),'');
  assert.deepEqual(Chat.mentionToken('こんにちは @武田',10),{start:6,end:9,query:'武田'});
  assert.equal(Chat.mentionToken('name@example.com',16),null);
});
await test('reply selection and cancellation retain the text and do not silently mention its author',()=>{
  const b=controllerRig();b.type('返信を書いています');b.click('[data-chat-action="reply"]');
  assert.equal(b.$('#social-chat-reply-preview').hidden,false);assert.match(b.$('#social-chat-reply-preview').textContent,/織田信長への返信/);
  assert.equal(b.$('.social-chat-reply-draft').getAttribute('aria-label'),'返信先：織田信長');assert.match(b.$('.social-chat-reply-draft').getAttribute('title'),/合戦の支度をお願いします/);
  const prepared=b.controller.prepare();assert.equal(prepared.replyToId,12);assert.deepEqual(prepared.mentionIds,[]);
  assert.strictEqual(b.doc.activeElement,b.$('#social-chat-input'));
  b.click('[data-chat-action="reply-clear"]');assert.equal(b.controller.prepare().replyToId,null);assert.equal(b.$('#social-chat-input').value,'返信を書いています');
  b.controller.destroy();
});
await test('candidate keyboard selection is distinct from sending and pointer selection keeps textarea focus',()=>{
  const b=controllerRig(),input=b.type('@');input.focus();
  const menu=b.$('#social-chat-mention-menu');assert.strictEqual(menu.parentElement,b.host,'picker is outside the clipped chat column');
  const first=b.$('[data-chat-action="mention-pick"]'),pointer={type:'pointerdown'};first.dispatchEvent(pointer);assert(pointer.defaultPrevented);assert.strictEqual(b.doc.activeElement,input);
  assert.equal(b.key('ArrowDown').handled,true);assert.equal(input.getAttribute('aria-activedescendant'),'social-chat-mention-1');
  const enter=b.key('Enter');assert(enter.handled&&enter.event.defaultPrevented);assert.equal(input.value,'@武田信玄 ');assert.deepEqual(b.controller.prepare().mentionIds,[third.userId]);assert(menu.hidden);
  assert.equal(input.selectionStart,input.value.length);assert.strictEqual(b.doc.activeElement,input);
  b.click('[data-chat-action="mention-remove"]');assert.deepEqual(b.controller.prepare().mentionIds,[]);assert.equal(input.value,'@武田信玄 ');
  b.type('@織田');assert.equal(b.key('Escape').handled,true);assert(menu.hidden);assert.equal(input.value,'@織田');b.controller.destroy();
});
await test('IME confirmation and Shift+Enter never choose or submit a mention',()=>{
  const b=controllerRig();b.type('@');
  assert(b.key('Enter',{isComposing:true}).handled);assert.equal(b.$('#social-chat-input').value,'@');
  assert(b.key('Enter',{keyCode:229}).handled);assert.equal(b.$('#social-chat-input').value,'@');
  const shifted=b.key('Enter',{shiftKey:true});assert.equal(shifted.handled,false);assert(!shifted.event.defaultPrevented);
  b.$('#social-chat-input').dispatchEvent({type:'compositionstart'});assert(b.$('#social-chat-mention-menu').hidden);assert(b.key('Enter').handled);
  b.$('#social-chat-input').dispatchEvent({type:'compositionend'});assert.equal(b.$('#social-chat-mention-menu').hidden,false);
  b.$('#social-chat-input').dispatchEvent({type:'compositionstart'});b.switchTo({key:'actor:friend:u_other',channel:'friend'});b.type('@');b.key('Enter');
  assert.equal(b.$('#social-chat-input').value,'@織田信長 ','removing the old composing input must not leave the new room stuck in IME mode');b.controller.destroy();
});
await test('drafts and reply recipients stay scoped to conversation and identity; only the sent revision clears',()=>{
  const b=controllerRig();b.type('@');b.key('Enter');b.click('[data-chat-action="reply"]');const sent=b.controller.prepare();
  b.switchTo({key:'actor:friend:u_third',channel:'friend'});assert.equal(b.$('#social-chat-input').value,'');b.type('別のフレンドへの下書き');b.controller.sent(sent);assert.equal(b.$('#social-chat-input').value,'別のフレンドへの下書き');
  b.switchTo({key:'actor:world:',channel:'world'});assert.equal(b.$('#social-chat-input').value,'');assert.equal(b.$('#social-chat-reply-preview').hidden,true);
  b.type('最初の送信');const original=b.controller.prepare();b.type('送信待ちの間に書いた次の文');b.controller.sent(original);assert.equal(b.$('#social-chat-input').value,'送信待ちの間に書いた次の文');
  b.switchTo({key:'actor:guild:g1',channel:'guild'});b.type('同盟の下書き');b.controller.clear('guild');
  b.switchTo({key:'actor:world:',channel:'world'});assert.equal(b.$('#social-chat-input').value,'送信待ちの間に書いた次の文');
  b.switchTo({key:'actor:guild:g1',channel:'guild'});assert.equal(b.$('#social-chat-input').value,'');
  b.switchTo({key:'new-actor:world:',channel:'world',actorId:'new-actor'});assert.equal(b.$('#social-chat-input').value,'');b.controller.destroy();
});
await test('removing mention text removes the recipient and old feature sets keep ordinary chat available',()=>{
  const b=controllerRig();b.type('@');b.key('Enter');assert.deepEqual(b.controller.prepare().mentionIds,[other.userId]);
  b.type('宛先なしの文');assert.deepEqual(b.controller.prepare().mentionIds,[]);
  b.features.chatMentions=false;b.features.chatReplies=false;b.controller.updateDecorations();assert(b.$('[data-chat-action="mention-open"]').hidden);
  b.click('[data-chat-action="reply"]');assert.equal(b.controller.prepare().replyToId,null);b.type('@織田');assert(b.$('#social-chat-mention-menu').hidden);assert.equal(b.controller.prepare().text,'@織田');b.controller.destroy();
});
await test('recipient limits and stale remote search results cannot cross conversations',async()=>{
  const b=controllerRig();b.rows.splice(0,b.rows.length,...Array.from({length:10},(_,i)=>({id:'u_'+i,name:'領主'+i})));
  for(let i=0;i<8;i++){b.click('[data-chat-action="mention-open"]');b.key('Enter');}
  assert.equal(b.controller.prepare().mentionIds.length,8);assert.equal(new Set(b.controller.prepare().mentionIds).size,8);
  b.click('[data-chat-action="mention-open"]');b.key('Enter');assert.equal(b.controller.prepare().mentionIds.length,8);assert(b.notices.some(n=>n.error&&n.text.includes('8人')));b.controller.destroy();
  const pending=deferred(),searched=deferred(),remote=controllerRig({search:query=>{searched.resolve(query);return pending.promise;}});
  remote.type('@遠方');assert.equal(await searched.promise,'遠方');
  remote.switchTo({key:'actor:friend:u_other',channel:'friend'});remote.type('別室の下書き');pending.resolve([{id:'far',name:'遠方の領主'}]);await new Promise(resolve=>setImmediate(resolve));
  assert(remote.$('#social-chat-mention-menu').hidden);assert.equal(remote.$('#social-chat-input').value,'別室の下書き');assert.deepEqual(remote.controller.prepare().mentionIds,[]);remote.controller.destroy();
});
await test('real chat submits stable reply and mention IDs; failed sends preserve the complete draft',async()=>{
  const b=socialRig();await Promise.resolve();b.t.s.config.features={chatReplies:true,chatMentions:true};
  b.type('@');b.key('Enter');b.click('[data-chat-action="reply"]');
  b.setHandler(async(url,options)=>options.method==='POST'?{ok:false,__status:400,error:{code:'CHAT_REPLY_UNAVAILABLE',message:'返信先が削除されました。'}}:{ok:true,messages:[],nextAfter:12});
  await b.send();const failed=JSON.parse(b.requests.find(r=>r.options.method==='POST').options.body);
  assert.deepEqual(failed,{channel:'world',text:'@織田信長',replyToId:12,mentionIds:[other.userId]});
  assert.equal(b.$('#social-chat-input').value,'@織田信長 ');assert.equal(b.t.chatEnhancements().prepare().replyToId,12);assert.equal(b.$('[type="submit"]').disabled,false);
  assert(b.feedback.some(f=>f.error&&f.text.includes('削除')));assert.deepEqual(b.sounds,['error']);
  b.click('[data-chat-action="reply-clear"]');b.setHandler(async()=>({ok:true,messages:[],nextAfter:12}));await b.send();
  assert.equal(b.$('#social-chat-input').value,'');assert.equal(b.$('#social-chat-selected-mentions').hidden,true);assert.deepEqual(b.sounds,['error','message']);
});
await test('a delayed world send cannot clear or redirect the selected friend draft',async()=>{
  const b=socialRig(),pending=deferred();b.type('世界への投稿');b.click('[data-chat-action="reply"]');
  b.setHandler((url,options)=>options.method==='POST'?pending.promise:{ok:true,messages:[],nextAfter:0});const send=b.send();
  b.switchTo('friends',third.userId);b.type('信玄さんへの別の文');
  pending.resolve({ok:true});await send;assert.equal(b.$('#social-chat-input').value,'信玄さんへの別の文');
  const posted=b.requests.filter(r=>r.options.method==='POST');assert.equal(posted.length,1);assert.equal(JSON.parse(posted[0].options.body).channel,'world');assert(!JSON.parse(posted[0].options.body).target);
  b.switchTo('world');assert.equal(b.$('#social-chat-input').value,'');assert(b.$('#social-chat-reply-preview').hidden);
});
await test('an in-flight send preserves new typing, and server content updates preserve draft and DOM focus',async()=>{
  const b=socialRig(),pending=deferred();b.type('先の文');b.setHandler((url,options)=>options.method==='POST'?pending.promise:{ok:true,messages:[],nextAfter:12});const send=b.send();
  const input=b.type('次の文を入力中');input.focus();input.setSelectionRange(2,4);pending.resolve({ok:true});await send;
  assert.equal(input.value,'次の文を入力中');assert.strictEqual(b.$('#social-chat-input'),input);assert.strictEqual(b.doc.activeElement,input);
  b.t.s.chats.get('world:').messages[0]={...message,replyTo:{id:11,unavailable:true},mentions:[{userId:'actor',name:'本人'}]};b.t.renderMessages();
  assert.strictEqual(b.$('#social-chat-input'),input);assert.equal(input.value,'次の文を入力中');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,4);
  assert.match(b.$('#social-message-list').textContent,/返信先の発言は表示できません/);assert.match(b.$('#social-message-list').textContent,/あなた宛て/);
});
await test('real delegated key handler permits mobile newlines and IME while desktop Enter sends once',()=>{
  const b=socialRig(),input=b.type('ひと言'),form=b.$('#social-chat-form');let submits=0;
  input.form=form;form.requestSubmit=()=>{submits++;};
  b.key('Enter',{isComposing:true});b.key('Enter',{keyCode:229});b.key('Enter',{shiftKey:true});assert.equal(submits,0);
  b.setCoarse(true);b.key('Enter');assert.equal(submits,0);
  b.setCoarse(false);const enter=b.key('Enter');assert.equal(submits,1);assert(enter.defaultPrevented);
});
await test('disabling a focused Send button returns focus after success without stealing a later deliberate focus',async()=>{
  const b=socialRig(),button=b.$('[type="submit"]');
  Object.defineProperty(button,'disabled',{get(){return this.hasAttribute('disabled');},set(value){if(value){this.setAttribute('disabled','');if(b.doc.activeElement===this)b.doc.activeElement=b.doc.body;}else this.removeAttribute('disabled');}});
  b.type('送信して続ける');button.focus();const first=deferred();b.setHandler((url,options)=>options.method==='POST'?first.promise:{ok:true,messages:[],nextAfter:12});const sent=b.send();
  assert.strictEqual(b.doc.activeElement,b.doc.body,'browser blur when the pressed button becomes disabled');first.resolve({ok:true});await sent;assert.strictEqual(b.doc.activeElement,b.$('#social-chat-input'));
  b.type('別の操作へ移る');button.focus();const next=deferred();b.setHandler((url,options)=>options.method==='POST'?next.promise:{ok:true,messages:[],nextAfter:12});const pending=b.send();
  const another=b.$('[data-social-tab="profile"]');another.focus();next.resolve({ok:true});await pending;assert.strictEqual(b.doc.activeElement,another);
});
await test('identity replacement clears private drafts and makes an old send response harmless',async()=>{
  const b=socialRig(),pending=deferred();b.type('以前の領主の下書き');b.setHandler((url,options)=>options.method==='POST'?pending.promise:{ok:true,messages:[],nextAfter:0});const send=b.send();
  b.t.installIdentity({id:'next',token:'b'.repeat(64)},{id:'next',name:'別の領主'});b.t.render();b.type('新しい領主の文');pending.resolve({ok:true});await send;
  assert.deepEqual(b.sounds,[]);assert.equal(b.$('#social-chat-input').value,'新しい領主の文');assert.equal(b.t.chatEnhancements().prepare().replyToId,null);
});
console.log(`${count} chat UI checks passed. Requests used an isolated mock API.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
