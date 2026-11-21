/* Real browser avatar adapter under out-of-order API replies and local DOM updates. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../avatar.js'),'utf8');
const VERSION_A='a'.repeat(64),VERSION_B='b'.repeat(64),VERSION_C='c'.repeat(64);
const decode=value=>value.replace(/&(?:amp|lt|gt|quot|#39);/g,entity=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[entity]));
function setup(){
  const listeners=new Map(),nodes=[],requests=[],writes=[],storage=new Map();
  const draft={value:'書状を入力中・変換中',selectionStart:3,selectionEnd:7,isComposing:true},scroll={scrollTop:157},editor={crop:'unchanged',zoom:1.5};
  const document={readyState:'complete',hidden:false,activeElement:draft,addEventListener:(name,handler)=>listeners.set(name,handler),querySelectorAll:selector=>selector==='[data-player-avatar]'?nodes:[],
    set innerHTML(_value){throw Error('An icon update must not replace the document');}};
  const scope={document,console,URL,SENGOKU_API_BASE:'https://game.example/api/v1',fetch:async(...args)=>{requests.push(args);throw Error('Registry checks must never fetch');},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{writes.push(key);storage.set(key,value);}}};
  scope.window=scope;vm.createContext(scope);vm.runInContext(source,scope);
  function node(user,size='inline'){
    const html=scope.SengokuAvatar.markup(user,size),start=/^<span\b([^>]*)>/.exec(html)[1],dataset={},classes=new Set((/class="([^"]*)"/.exec(start)?.[1]||'').split(' '));
    for(const match of start.matchAll(/data-([a-z-]+)="([^"]*)"/g)){const key=match[1].replace(/-([a-z])/g,(_x,c)=>c.toUpperCase());dataset[key]=decode(match[2]);}
    let inner=html.slice(start.length+6,-7),htmlWrites=0;
    const result={dataset,get innerHTML(){return inner;},set innerHTML(value){inner=String(value);htmlWrites++;},get htmlWrites(){return htmlWrites;},
      classList:{toggle(name,enabled){if(enabled)classes.add(name);else classes.delete(name);},remove:name=>classes.delete(name),contains:name=>classes.has(name)},
      matches:selector=>selector==='[data-player-avatar]',querySelectorAll:()=>[]};nodes.push(result);return result;
  }
  return{api:scope.SengokuAvatar,scope,document,nodes,node,draft,scroll,editor,listeners,requests,writes};
}
const tests=[];function test(name,run){tests.push({name,run});}
function hasVersion(html,version){return html.includes('?v='+version);}
test('accepted ordinary and compound participant DTOs share current icons in every rendering size',()=>{
  const h=setup(),fields=[['id','name','avatarVersion'],['userId','name','avatarVersion'],['playerId','name','avatarVersion'],['playerId','playerName','playerAvatarVersion'],['ownerId','ownerName','ownerAvatarVersion'],['authorId','authorName','authorAvatarVersion'],['targetPlayerId','targetName','targetAvatarVersion'],['attackerPlayerId','attackerName','attackerAvatarVersion'],['defenderPlayerId','defenderName','defenderAvatarVersion']];
  const people=fields.map(([id,name,version],i)=>({[id]:'u_person_'+i,[name]:'領主'+i,[version]:VERSION_A}));
  const payload={friends:people.slice(0,3),history:{rows:people.slice(3)}};assert.equal(h.api.observe(payload),payload);
  fields.forEach((_fields,i)=>{for(const size of ['','small','inline','profile']){const html=h.api.markup({id:'u_person_'+i,name:'古い名前'},size);assert(hasVersion(html,VERSION_A),'participant '+i+' / '+size);assert(html.includes('data-player-avatar-name="領主'+i+'"'));}});
  h.api.observe({messages:[{id:91,userId:'u_speaker',name:'発言者',avatarVersion:VERSION_B}],events:[{id:'event_42',playerId:'u_achiever',playerName:'達成した領主',avatarVersion:VERSION_C}]});
  assert(hasVersion(h.api.markup({id:'u_speaker'}),VERSION_B));assert(hasVersion(h.api.markup({id:'u_achiever'}),VERSION_C));assert(!h.api.markup({id:'event_42'}).includes('<img'),'a receipt ID must not take ownership of its participant photo');
  assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
});
test('a missing avatar field keeps an icon while explicit null removes every mounted and future copy',()=>{
  const h=setup(),person={id:'u_delete',name:'葵の領主',avatarVersion:VERSION_A};h.api.observe(person);
  const rows=[h.node(person),h.node(person,'profile'),h.node(person,'small')];
  h.api.observe({id:person.id,name:'読み込み途中'});for(const row of rows){assert(hasVersion(row.innerHTML,VERSION_A));assert(row.classList.contains('has-photo'));}
  h.api.observe({playerEvaluations:[{playerId:person.id,name:person.name,avatarVersion:null}]});
  for(const row of rows){assert(!row.innerHTML.includes('<img'));assert(!row.classList.contains('has-photo'));assert.equal(row.dataset.avatarVersion,'');assert(row.innerHTML.includes('>葵</span>'));}
  assert(!h.api.markup(person).includes('<img'),'a cached old DTO cannot revive a removed image');
  h.api.observe({id:person.id,name:person.name,avatarVersion:VERSION_B});for(const row of rows)assert(hasVersion(row.innerHTML,VERSION_B));
});
test('a response started before the latest response cannot restore an older photo or overwrite a deletion',()=>{
  const h=setup(),id='u_race',oldRequest=h.api.beginRequest(),newRequest=h.api.beginRequest();assert(newRequest>oldRequest);
  h.api.observe({user:{id,name:'新しい名前',avatarVersion:VERSION_B}},{requestSequence:newRequest});
  const delayed={messages:[{userId:id,name:'古い名前',avatarVersion:VERSION_A}],playerEvaluations:[{playerId:id,name:'古い名前',avatarVersion:VERSION_A}]};h.api.observe(delayed,{requestSequence:oldRequest});
  assert.equal(delayed.messages[0].avatarVersion,VERSION_B);assert.equal(delayed.playerEvaluations[0].avatarVersion,VERSION_B);assert(hasVersion(h.api.markup({id}),VERSION_B));assert(h.api.markup({id}).includes('新しい名前'));
  const removal=h.api.beginRequest();h.api.observe({id,name:'新しい名前',avatarVersion:null},{requestSequence:removal});
  const staleBattle={attackerPlayerId:id,attackerName:'古い名前',attackerAvatarVersion:VERSION_B};h.api.observe(staleBattle,{requestSequence:newRequest});assert.equal(staleBattle.attackerAvatarVersion,null);assert(!h.api.markup({id,avatarVersion:VERSION_A}).includes('<img'));
});
test('a completed local upload or reset remains pinned across a reply that captured the old account photo',()=>{
  const h=setup(),id='u_self',oldRequest=h.api.beginRequest();h.api.observe({id,name:'本人',avatarVersion:VERSION_C});
  const stale={user:{id,name:'本人',avatarVersion:VERSION_A},battle:{defenderPlayerId:id,defenderName:'本人',defenderAvatarVersion:VERSION_A}};
  h.api.observe(stale,{requestSequence:oldRequest,pinnedUser:{id,name:'本人',avatarVersion:VERSION_C}});assert.equal(stale.user.avatarVersion,VERSION_C);assert.equal(stale.battle.defenderAvatarVersion,VERSION_C);assert(hasVersion(h.api.markup({id}),VERSION_C));
  const deleteRequest=h.api.beginRequest(),reset={id,name:'本人',avatarVersion:null};h.api.observe(reset);
  h.api.observe({user:{id,name:'本人',avatarVersion:VERSION_C}},{requestSequence:deleteRequest,pinnedUser:reset});assert(!h.api.markup({id}).includes('<img'));
});
test('pinning the current owner also keeps the renamed standard icon initial when a historical participant reply arrives',()=>{
  const h=setup(),id='u_renamed',oldRequest=h.api.beginRequest(),current={id,name:'葵の領主',avatarVersion:null};h.api.observe(current);
  h.api.observe({battle:{defenderPlayerId:id,defenderName:'旧名の領主',defenderAvatarVersion:VERSION_A}},{requestSequence:oldRequest,pinnedUser:current});
  const html=h.api.markup({id});assert(!html.includes('<img'));assert(html.includes('data-player-avatar-name="葵の領主"'),'a stale participant label must not replace the pinned owner name');assert(html.includes('>葵</span>'),'the reset avatar keeps the new name initial');
});
test('avatar-only DOM replacement keeps writing, IME selection, focus, scrolling, other players and the crop editor intact',()=>{
  const h=setup(),person={id:'u_local',name:'綾の領主',avatarVersion:VERSION_A},other={id:'u_other',name:'別の領主',avatarVersion:VERSION_B};h.api.observe({people:[person,other]});
  const primary=h.node(person),second=h.node(person,'small'),untouched=h.node(other),before={draft:JSON.stringify(h.draft),scroll:JSON.stringify(h.scroll),editor:JSON.stringify(h.editor),focus:h.document.activeElement,other:untouched.innerHTML,writes:untouched.htmlWrites};
  h.api.observe({authorId:person.id,authorName:'綾の領主',authorAvatarVersion:VERSION_C});
  assert(hasVersion(primary.innerHTML,VERSION_C));assert(hasVersion(second.innerHTML,VERSION_C));assert.equal(primary.htmlWrites,1);assert.equal(second.htmlWrites,1);assert.equal(untouched.innerHTML,before.other);assert.equal(untouched.htmlWrites,before.writes);
  assert.equal(JSON.stringify(h.draft),before.draft);assert.equal(JSON.stringify(h.scroll),before.scroll);assert.equal(JSON.stringify(h.editor),before.editor);assert.equal(h.document.activeElement,before.focus);
  h.api.refresh();h.api.refresh(primary);assert.equal(primary.htmlWrites,1,'same metadata does not rebuild even the avatar');assert.equal(second.htmlWrites,1);
  const detached=h.node({id:person.id,name:person.name,avatarVersion:VERSION_A});detached.dataset.avatarVersion=VERSION_A;h.nodes.pop();h.api.refresh(detached);assert(hasVersion(detached.innerHTML,VERSION_C),'an explicit avatar root also refreshes');
});
test('standard avatars use a complete first Unicode character, escape user text and reject injected image versions',()=>{
  const h=setup();for(const [name,letter]of [['🏯小城','🏯'],['葵の領主','葵'],['<img onerror="bad">','&lt;'],['','領']]){const html=h.api.markup({id:'u_standard',name,avatarVersion:null},'inline');assert(html.includes('>'+letter+'</span>'));assert(!html.includes('<img'));assert(!html.includes('<script'));}
  for(const [i,version]of ['javascript:alert(1)','" onerror="alert(1)','a'.repeat(63),'A'.repeat(64),{},42,undefined].entries()){
    const id='u_bad_'+i,payload={id,name:'<悪意&"名>',avatarVersion:version};h.api.observe(payload);assert.equal(payload.avatarVersion,null);const html=h.api.markup({id});assert(!html.includes('<img'));assert(!html.includes('<悪意'));assert(html.includes('&lt;悪意&amp;&quot;名&gt;'));
  }
  h.api.observe({id:'u_safe',name:'安全',avatarVersion:VERSION_A});h.scope.SENGOKU_API_BASE='https://secret@example.com';assert(!h.api.markup({id:'u_safe'}).includes('<img'));h.scope.SENGOKU_API_BASE='javascript:alert(1)';assert(!h.api.markup({id:'u_safe'}).includes('<img'));
});
test('nested save data and payment state cannot supply an avatar and cyclic public DTOs do not loop',()=>{
  const h=setup(),hidden={id:'u_hidden',name:'保存内だけ',avatarVersion:VERSION_A};h.api.observe({save:hidden,state:hidden,appearance:hidden,entitlements:hidden});assert(!h.api.markup({id:hidden.id}).includes('<img'));
  const payload={id:'u_public',name:'公開領主',avatarVersion:VERSION_B};payload.self=payload;h.api.observe(payload);assert(hasVersion(h.api.markup({id:payload.id}),VERSION_B));assert.equal(h.requests.length,0);assert.equal(h.writes.length,0);
});
let passed=0;for(const {name,run}of tests){run();passed++;console.log('PASS '+name);}console.log(`${passed} avatar registry groups passed. Real avatar.js in a window/document VM; no network or persistent writes.`);
