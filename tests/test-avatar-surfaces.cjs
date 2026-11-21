'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),copy=value=>JSON.parse(JSON.stringify(value));
const FIRST='a'.repeat(64),SECOND='b'.repeat(64),ME='u_me',PEER='u_peer',THREAD='lt_'+'1'.repeat(32);
const evaluation={version:1,score:22000,maxScore:100000,rankIndex:4,rankId:'rank-four',rankName:'正七位'};
const premium=require('../premium-runtime.js'),rank=require('../player-evaluation.js');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The shared avatar renderer is tested separately. This adapter records each
// surface's semantic player/version inputs without fetching image bytes.
const avatar={markup:(user,size)=>`<span class="test-avatar ${esc(size)}" data-player-avatar="${esc(user.id)}" data-avatar-version="${esc(user.avatarVersion||'')}"></span>`};
const count=html=>[...html.matchAll(/data-player-avatar=/g)].length;
global.SengokuAvatar=avatar;global.SengokuEvaluationUI=rank;global.SengokuPremiumRuntime=premium;
const field=require('../field.js'),trade=require('../trade.js');
const tests=[];const test=(name,run)=>tests.push({name,run});

test('field rows use one owner portrait and markers retain castle art and levels',()=>{
  const [player]=field.normalizePlayers([{playerId:PEER,name:'相手の領主',avatarVersion:FIRST,evaluation,homeCastleId:'kiyosu',homeCastleName:'清洲城',level:4,keepLevel:3}]);
  const saved=JSON.stringify(player),html=field.publicRow(player);
  assert.equal(count(html),1);assert(html.includes(FIRST));assert(html.indexOf('data-player-avatar')<html.indexOf('data-premium-player'));assert.equal(JSON.stringify(player),saved);
  const marker=field.groupBases([player],{kiyosu:{lon:136.84,lat:35.21}})[0],art=field.markerAppearance(marker).html;
  assert.equal(count(art),1);assert(art.includes(FIRST));assert(art.includes('field-castle-visual'));assert(art.includes('field-castle-level'));assert(art.includes('field-map-owner-avatar'));assert.equal(marker.displayPlayerAvatarVersion,FIRST);
  const standard=field.publicRow({...player,avatarVersion:null});assert.equal(count(standard),1);assert(!standard.includes(FIRST));assert(standard.includes('data-avatar-version=""'));
});

test('battle reports bind attacker and defender avatars to their own public IDs',()=>{
  const battle={id:'battle',battleMode:'raid',won:true,attackerPlayerId:ME,attackerName:'攻撃側',attackerAvatarVersion:FIRST,attackerEvaluation:evaluation,defenderPlayerId:PEER,defenderName:'守備側',defenderAvatarVersion:SECOND,defenderEvaluation:evaluation};
  const before=JSON.stringify(battle),html=field.battleReportHtml(battle,ME);
  assert.equal(count(html),2);assert(html.includes(`data-player-avatar="${ME}" data-avatar-version="${FIRST}"`));assert(html.includes(`data-player-avatar="${PEER}" data-avatar-version="${SECOND}"`));assert.equal(JSON.stringify(battle),before);
});

const baseTrade=()=>({id:'tr_'+'2'.repeat(32),status:'pending',sender:{playerId:PEER,name:'相手の領主',avatarVersion:FIRST,evaluation:{...evaluation,privateSave:'private'},appearance:{nameplate:null,town:null,badge:null,ownedProducts:['gold-banner']}},recipient:{playerId:ME,name:'自分',avatarVersion:SECOND},offer:{gold:1},want:{},canAccept:true});
test('trade parties preserve only public rank and avatar fields and render them beside the matching name',()=>{
  const item=trade.cleanTrade(baseTrade()),state={ownerId:ME,access:{writable:true},balances:{gold:10},rules:{balanceLimit:999999999}};
  assert.equal(item.sender.avatarVersion,FIRST);assert.deepEqual(item.sender.evaluation,evaluation);assert(!JSON.stringify(item).includes('private'));
  for(const html of [trade.tradeCard(item,state),trade.confirmationMarkup({action:'accept',target:item.sender,give:{},receive:{gold:1}})]){
    assert.equal(count(html),1);assert(html.includes(FIRST));assert(html.includes('data-evaluation-rank="rank-four"'));assert(html.includes('data-premium-product="gold-banner"'));assert(html.indexOf('data-player-avatar')<html.indexOf('data-premium-player'));assert(html.indexOf('data-premium-player')<html.indexOf('data-evaluation-rank'));
  }
  const invalid=baseTrade();invalid.sender.avatarVersion='" onerror="bad';invalid.sender.evaluation={...evaluation,score:-1};const cleaned=trade.cleanTrade(invalid);assert.equal(cleaned.sender.avatarVersion,null);assert.equal(cleaned.sender.evaluation,null);assert(!trade.tradeCard(cleaned,state).includes('onerror'));
});

function node(){let html='';return{writes:0,get innerHTML(){return html;},set innerHTML(value){html=String(value);this.writes++;},textContent:'',value:'',hidden:false,disabled:false,isConnected:true,dataset:{},scrollTop:0,scrollHeight:1000,clientHeight:300,selectionStart:0,selectionEnd:0,focusCount:0,classList:{toggle(){}},setAttribute(){},focus(){this.focusCount++;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}};}
function letters(){
  const nodes=new Map(),dialog=node(),user={id:ME,name:'本人',avatarVersion:SECOND},data={version:FIRST,refresh:false};dialog.open=false;dialog.querySelector=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;};
  const doc={body:{append(){}},hidden:false,readyState:'loading',activeElement:null,createElement:()=>dialog,addEventListener(){}},scope={console,URL,Intl,Date,SengokuAvatar:avatar,SengokuPremiumRuntime:premium,SengokuEvaluationUI:rank,setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},document:doc,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent(){}};scope.window=scope;vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(root,'letters.js'),'utf8').replace('const api={createController','const api={createView,threadTitle,threadParticipants,createController'),scope);
  const api=scope.SengokuLetters,stored=new Map();let view;
  const controller=api.createController({getUser:()=>user,storage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},request:async route=>route==='/letters/summary'?{unreadCount:1,unreadThreads:1,playerEvaluations:[{playerId:PEER,avatarVersion:data.version}]}:{thread:{id:THREAD,kind:'player',title:'相手',peer:{id:PEER,name:'相手',avatarVersion:FIRST,evaluation},lastSeq:1,canReply:true},messages:data.refresh?[]:[{id:'message',seq:1,authorId:PEER,authorName:'相手',authorAvatarVersion:FIRST,authorEvaluation:evaluation,text:'変わらない本文',createdAt:'2026-11-21T00:00:00Z'}],playerEvaluations:[{playerId:PEER,avatarVersion:data.version}],hasOlder:false,hasNewer:false},setTimeout:()=>1,clearTimeout(){},onChange:state=>view?.render(state)});
  view=api.createView(doc,controller);return{api,controller,view,nodes,doc,data};
}
test('empty letter deltas replace and remove old author avatars while preserving the message, draft and reading position',async()=>{
  const h=letters();await h.controller.openThread(THREAD);h.controller.setDraft('返信を変換中');const input=h.nodes.get('textarea'),scroll=h.nodes.get('[data-letter-scroll]'),main=h.nodes.get('[data-letter-main]');input.selectionStart=2;input.selectionEnd=4;input.isComposing=true;h.doc.activeElement=input;scroll.scrollTop=137;const writes=main.writes;
  for(const version of [SECOND,null]){
    h.data.refresh=true;h.data.version=version;await h.controller.refresh();const state=h.controller.getState();assert.equal(state.messages.length,1);assert.equal(state.messages[0].authorAvatarVersion,version);assert.equal(state.thread.peer.avatarVersion,version);assert.equal(state.messages[0].text,'変わらない本文');
    const body=h.nodes.get('[data-letter-messages]').innerHTML,heading=h.nodes.get('[data-letter-thread-heading]').innerHTML;assert.equal(count(body),1);assert.equal(count(heading),1);assert(!body.includes(FIRST));assert(body.includes(`data-avatar-version="${version||''}"`));assert(heading.includes(`data-avatar-version="${version||''}"`));assert.equal(input.value,'返信を変換中');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,4);assert.equal(h.doc.activeElement,input);assert.equal(scroll.scrollTop,137);assert.equal(main.writes,writes);
  }
  h.controller.dispose();
});
test('guild letter titles and participant lists show portraits only for people',()=>{
  const h=letters(),thread={kind:'guild',guild:{name:'同盟の旗'},sender:{id:PEER,name:'送り主',avatarVersion:FIRST,evaluation},contextPlayer:{id:'u_context',name:'本拠の領主',avatarVersion:SECOND,evaluation}};
  assert.equal(count(h.api.threadTitle(thread,ME)),1);assert.equal(h.api.threadTitle(thread,PEER).replace(/<[^>]*>/g,''),'同盟の旗');const participants=h.api.threadParticipants(thread);assert.equal(count(participants),2);assert(participants.includes(FIRST));assert(participants.includes(SECOND));h.controller.dispose();
});

(async()=>{for(const {name,run}of tests){await run();console.log('PASS '+name);}console.log(`${tests.length} avatar surface checks passed. Synthetic data only; no network or production mutations.`);})().catch(error=>{console.error(error);process.exitCode=1;});
