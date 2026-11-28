'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),evaluationSource=fs.readFileSync(path.join(root,'player-evaluation.js'),'utf8');
const currentFavicon=JSON.parse(fs.readFileSync(path.join(root,'site-metadata.json'),'utf8')).faviconSmall.path;
const evaluation={version:1,score:1200,maxScore:100000,rankId:'rank-one',rankName:'従八位下',rankIndex:2};
const promoted={version:1,score:22000,maxScore:100000,rankId:'rank-two',rankName:'従五位上',rankIndex:9};
const copy=value=>JSON.parse(JSON.stringify(value));
const premium=require('../premium-runtime.js'),noAppearance={nameplate:null,town:null,badge:null,ownedProducts:[]},allOwned={...noAppearance,ownedProducts:['gold-banner','moonlit-castle','supporter']};
const premiumUI=()=>({nameMarkup:premium.nameMarkup,cleanAppearance:premium.cleanAppearance,ownershipLabel:premium.ownershipLabel,getAppearance:()=>copy(noAppearance)});
const purchaseCount=html=>[...html.matchAll(/data-premium-product=/g)].length;
function node(){let html='';return{htmlWrites:0,get innerHTML(){return html;},set innerHTML(value){html=String(value);this.htmlWrites++;},textContent:'',value:'',hidden:false,disabled:false,inert:false,isConnected:true,dataset:{},scrollTop:0,scrollHeight:1000,clientHeight:300,selectionStart:0,selectionEnd:0,focusCount:0,classList:{toggle(){}},setAttribute(){},focus(){this.focusCount++;},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}};}
function noNestedButtons(html){for(const [,inside]of html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g))assert(!/<button\b/.test(inside),'Player badges must be non-interactive inside existing buttons');}
function badgeCount(html){return [...html.matchAll(/class="player-evaluation-badge"/g)].length;}
function social(){
  const nodes=new Map(),slots=[],requests=[],editors=[],actor={id:'actor',name:'本人',clan:'織田家',isAdmin:false,isStaff:false,isDeputy:false,guildId:null,evaluation:copy(evaluation)};let handler=async()=>({ok:true}),openedEvaluation=0;
  for(const id of ['social-tabs','social-confirm-host','social-avatar-editor','social-profile-avatar','social-message-list','social-chat-input','social-friend-list','social-friend-requests','social-identity-file'])nodes.set('#'+id,node());
  nodes.set('[data-social-chat-title]',node());
  const body=node(),dialog={open:true,querySelector:selector=>nodes.get(selector)||null,querySelectorAll:selector=>selector==='[data-player-evaluation]'?slots:[],close(){this.open=false;},remove(){}};
  const scope={console,URL,URLSearchParams,AbortController,Intl,Date,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},document:{readyState:'loading',hidden:false,activeElement:null,addEventListener(){},removeEventListener(){}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://fixture.invalid',
    SengokuPremiumRuntime:premiumUI(),SengokuBridge:{setRoleAccess(){},showEvaluation(){openedEvaluation++;}},SengokuCloudSync:{stop(){},start(){}},
    SengokuAvatar:{markup:()=>'<span class="social-avatar"></span>',mount:(host,options)=>{const editor={host,updates:[],destroyed:false};editors.push(editor);return{update(user){editor.updates.push(user);},destroy(){editor.destroyed=true;}};}},
    fetch:async(url,options)=>{requests.push({url,options});return{ok:true,status:200,json:async()=>handler(url,options)};}};
  scope.window=scope;vm.createContext(scope);vm.runInContext(evaluationSource,scope);
  const exposed='global.__evaluationTest={s,render,refresh,refreshFriendsView,loadMe,loadChat,loadMail,acceptUser,cleanAchievement,achievementRows,onlineView,playerCards,friendRequestRows,friendsView,guildView,guildRankingRows,guildLedgerRows,staffCards,recentLoginRows,profileView,syncView,mailView,chatView,renderMessages,click,setUI:(d,b)=>{dialog=d;body=b;}};';
  vm.runInContext(fs.readFileSync(path.join(root,'social.js'),'utf8').replace('global.SengokuSocial={open',exposed+'global.SengokuSocial={open'),scope);
  const test=scope.__evaluationTest;test.setUI(dialog,body);test.s.identity={id:'actor',token:'a'.repeat(64)};test.s.user=copy(actor);test.s.open=true;test.s.tab='profile';test.s.configLoaded=true;
  return{scope,test,nodes,slots,body,dialog,actor,requests,editors,setHandler:fn=>handler=fn,openedEvaluation:()=>openedEvaluation};
}
const tests=[];const test=(name,run)=>tests.push({name,run});
test('social DTO boundaries retain only public evaluation fields and unknown evaluations stay unbadged',()=>{
  const h=social();h.test.s.user.evaluation={...evaluation,privateSave:'DO NOT EXPOSE'};
  const user=h.scope.SengokuSocial.getUser();assert.deepEqual(copy(user.evaluation),evaluation);assert(!JSON.stringify(user).includes('DO NOT EXPOSE'));assert(!JSON.stringify(user).includes('a'.repeat(64)));
  const event=h.test.cleanAchievement({id:'event',playerId:'other',playerName:'領主',title:'城郭を拡張',occurredAt:'2026-11-21T00:00:00Z',playerEvaluation:{...promoted,privateSave:'secret'}});
  assert.equal(event.playerId,'other');assert.deepEqual(copy(event.playerEvaluation),promoted);assert(!JSON.stringify(event).includes('secret'));
  for(const invalid of [undefined,null,{...evaluation,version:2},{...evaluation,score:NaN},{...evaluation,rankName:''}])assert.equal(badgeCount(h.test.playerCards([{id:'other',name:'未確認',evaluation:invalid}],'friend')),0);
  const html=h.test.playerCards([{id:'other',name:'<img onerror="bad">',evaluation:{...evaluation,rankName:'<b>位階</b>'}}],'friend');assert(html.includes('&lt;img'));assert(html.includes('&lt;b&gt;'));assert.equal((html.match(/<img\b/g)||[]).length,1);assert(html.includes('src="'+currentFavicon+'"'));assert(!/<img\b[^>]*\bonerror\s*=/.test(html));assert(!html.includes('<b>位階'));
});
test('search, friends, guild people, treasury, staff, achievements and profile show the supplied player rank',()=>{
  const h=social(),t=h.test,p={id:'other',name:'相手',clan:'伊達家',evaluation:promoted,isStaff:true,online:true};
  t.s.onlinePlayers=[p];t.s.staff=[p];t.s.staffCandidates=[p];t.s.friends=[p];t.s.friendId=p.id;t.s.requests=[{...p,direction:'incoming'}];t.s.members=[p];t.s.recentLogins.players=[{...p,lastSeen:'2026-11-21T00:00:00Z'}];t.s.guildTreasury.ledger=[{id:'tx',playerId:p.id,name:p.name,playerEvaluation:promoted,direction:'deposit',resource:'gold',amount:1,createdAt:'2026-11-21T00:00:00Z'}];
  t.s.guilds=[{id:'guild',name:'位階のないギルド名',ownerId:p.id,ownerName:p.name,ownerEvaluation:promoted,memberCount:1,maxMembers:50}];t.s.guildRankings.guilds=t.s.guilds;
  t.s.achievements.events=[t.cleanAchievement({id:'e',playerId:p.id,playerName:p.name,playerEvaluation:promoted,title:'城郭を拡張',occurredAt:'2026-11-21T00:00:00Z'})];
  const surfaces=[t.onlineView(),t.playerCards([p],'friend'),t.friendRequestRows(),t.guildLedgerRows(),t.staffCards([p]),t.recentLoginRows(),t.achievementRows(),t.profileView(),t.syncView(),t.guildView(),t.guildRankingRows()];
  t.s.tab='friends';surfaces.push(t.friendsView());t.s.user.guildId='guild';t.s.user.guildName='位階のないギルド名';t.s.guildSection='members';surfaces.push(t.guildView());
  for(const html of surfaces){assert(badgeCount(html)>0);noNestedButtons(html);}
  const guildHtml=surfaces[9];assert(guildHtml.includes('<h3>位階のないギルド名</h3>'));assert.equal(badgeCount(guildHtml),1,'The guild owner is ranked; the guild name is not');
  assert(t.profileView().includes('data-social="evaluation-open"'));assert(!t.profileView().includes('初回運営登録'));
});
test('a zero-message chat poll updates existing authors by player ID without losing draft, reading position or duplicates',async()=>{
  const h=social(),t=h.test,list=h.nodes.get('#social-message-list'),input=h.nodes.get('#social-chat-input');t.s.tab='world';
  const message={id:17,userId:'other',name:'相手',evaluation:copy(evaluation),text:'既存の発言',createdAt:'2026-11-21T00:00:00Z'};
  t.s.chats.set('world:',{messages:[message],after:17,rendered:true});list.scrollTop=137;input.value='日本語を変換中';input.selectionStart=3;input.selectionEnd=5;input.isComposing=true;h.scope.document.activeElement=input;t.renderMessages();
  h.setHandler(async()=>({ok:true,messages:[],nextAfter:17,playerEvaluations:[{playerId:'other',evaluation:promoted},{playerId:'unrelated',evaluation:null}]}));await t.loadChat();
  assert.equal(t.s.chats.get('world:').messages.length,1);assert.equal(message.text,'既存の発言');assert.deepEqual(copy(message.evaluation),promoted);assert(list.innerHTML.includes(promoted.rankName));assert(!list.innerHTML.includes('>'+evaluation.rankName+'<'));assert.equal(list.scrollTop,137);assert.equal(input.value,'日本語を変換中');assert.equal(input.selectionStart,3);assert.equal(input.selectionEnd,5);assert.equal(h.scope.document.activeElement,input);
  const writes=list.htmlWrites;await t.loadChat();assert.equal(list.htmlWrites,writes,'An unchanged evaluation does not rebuild the message list');
  h.setHandler(async()=>({ok:true,messages:[],nextAfter:17,playerEvaluations:[{playerId:'other',evaluation:null}]}));await t.loadChat();assert.equal(badgeCount(list.innerHTML),0,'A failed authoritative evaluation is unknown, not an invented zero rank');
});
test('profile rank updates preserve an active avatar editor and import file input, and the detail button opens the game evaluation',async()=>{
  const h=social(),t=h.test;t.render();const slot=node();slot.dataset={playerEvaluation:'actor',evaluationKey:h.scope.SengokuEvaluationUI.key(evaluation)};slot.innerHTML=h.scope.SengokuEvaluationUI.badge(evaluation);h.slots.push(slot);
  const file=h.nodes.get('#social-identity-file');file.files=[{name:'backup.json'}];h.scope.document.activeElement=file;const writes=h.body.htmlWrites;
  h.setHandler(async()=>({ok:true,user:{...h.actor,evaluation:promoted},friends:[],requests:[]}));await t.loadMe();
  assert(slot.innerHTML.includes(promoted.rankName));assert.equal(h.body.htmlWrites,writes);assert.equal(h.editors.length,1);assert.equal(h.editors[0].destroyed,false);assert.equal(h.nodes.get('#social-identity-file'),file);assert.equal(file.files[0].name,'backup.json');assert.equal(h.scope.document.activeElement,file);
  await t.click({target:{closest:selector=>selector==='[data-social]'?{dataset:{social:'evaluation-open'}}:null}});assert.equal(h.openedEvaluation(),1);assert.equal(h.dialog.open,false);
});
test('same-friend rank changes update the sidebar and conversation heading while keeping the composing form mounted',async()=>{
  const h=social(),t=h.test,friend={id:'other',name:'友',clan:'伊達家',evaluation:copy(evaluation)};t.s.friends=[friend];t.s.friendId='other';t.s.tab='friends';t.render();t.refreshFriendsView();
  const input=h.nodes.get('#social-chat-input');input.value='返信を入力しています';input.selectionStart=4;input.selectionEnd=7;input.isComposing=true;h.scope.document.activeElement=input;const writes=h.body.htmlWrites;
  h.setHandler(async url=>new URL(url).pathname.endsWith('/me')?{ok:true,user:h.actor,friends:[{...friend,evaluation:promoted}],requests:[]}:{ok:true,messages:[],nextAfter:0,playerEvaluations:[{playerId:'other',evaluation:promoted}]});await t.refresh({silent:true});
  assert(h.nodes.get('#social-friend-list').innerHTML.includes(promoted.rankName));assert(h.nodes.get('[data-social-chat-title]').innerHTML.includes(promoted.rankName));assert.equal(h.body.htmlWrites,writes);assert.equal(input.value,'返信を入力しています');assert.equal(input.selectionStart,4);assert.equal(input.selectionEnd,7);assert.equal(h.scope.document.activeElement,input);
});
test('system mail ranks actual combatants and leaves the system sender, body and reward controls unchanged',()=>{
  const h=social(),t=h.test;t.s.mail=[{id:'mail',source:'system',title:'合戦の通知',body:'報酬は反映済みです。',createdAt:'2026-11-21T00:00:00Z',gift:null,participants:[{playerId:'actor',name:'本人',side:'attacker',evaluation},{playerId:'other',name:'相手',side:'defender',evaluation:promoted}]}];t.s.openedMail='mail';const html=t.mailView();
  assert.equal(badgeCount(html),2);assert.match(html,/<div class="social-letter-date">システムからの自動通知 · [^<]+<\/div>/);assert(html.includes('攻撃側：'));assert(html.includes('守備側：'));assert(html.includes('報酬は反映済みです。'));assert(!html.includes('data-social="mail-claim"'));
});
function letters(){
  const nodes=new Map(),events=[],requests=[],THREAD='lt_'+'1'.repeat(32),user={id:'actor',name:'本人'},data={name:'相手',evaluation:copy(evaluation),appearance:copy(noAppearance),refresh:false};
  const dialog=node();dialog.open=false;dialog.querySelector=selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);};dialog.showModal=function(){this.open=true;};dialog.close=function(){this.open=false;};
  const doc={body:{append(){}},hidden:false,readyState:'loading',activeElement:null,createElement:()=>dialog,addEventListener(){}};
  const scope={console,URL,Intl,Date,SengokuPremiumRuntime:premiumUI(),setTimeout:()=>1,clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){},document:doc,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>events.push(event)};scope.window=scope;vm.createContext(scope);vm.runInContext(evaluationSource,scope);
  vm.runInContext(fs.readFileSync(path.join(root,'letters.js'),'utf8').replace('const api={createController','const api={createView,threadTitle,threadParticipants,createController'),scope);
  const api=scope.SengokuLetters,store=new Map();let view;
  const controller=api.createController({getUser:()=>user,storage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},request:async route=>{requests.push(route);if(route==='/letters/summary')return{unreadCount:2,unreadThreads:1};return{thread:{id:THREAD,kind:'player',title:'相手',peer:{id:'other',name:'相手',evaluation},lastSeq:2,canReply:true},messages:data.refresh?[]:[1,2].map(seq=>({id:'msg-'+seq,seq,authorId:'other',authorName:'相手',authorEvaluation:evaluation,text:'既存の書状'+seq,createdAt:'2026-11-21T00:00:00Z'})),playerEvaluations:[{playerId:'other',name:data.name,evaluation:data.evaluation,appearance:data.appearance}],hasOlder:false,hasNewer:false};},setTimeout:()=>1,clearTimeout(){},onChange:state=>view?.render(state)});
  view=api.createView(doc,controller);return{api,controller,view,nodes,doc,data,THREAD,requests};
}
test('letter polling refreshes old authors and the peer with no new message, preserving IME text, scroll and thread shell',async()=>{
  const h=letters();await h.controller.openThread(h.THREAD);h.controller.setDraft('書状を変換中');const input=h.nodes.get('textarea'),scroll=h.nodes.get('[data-letter-scroll]'),main=h.nodes.get('[data-letter-main]');input.selectionStart=2;input.selectionEnd=4;input.isComposing=true;h.doc.activeElement=input;scroll.scrollTop=137;const writes=main.htmlWrites,focuses=input.focusCount;
  h.data.refresh=true;h.data.evaluation=promoted;await h.controller.refresh();const state=h.controller.getState();
  assert.equal(state.messages.length,2);assert.deepEqual(copy(state.messages.map(m=>m.authorEvaluation)),[promoted,promoted]);assert.deepEqual(copy(state.thread.peer.evaluation),promoted);assert(h.nodes.get('[data-letter-thread-heading]').innerHTML.includes(promoted.rankName));assert.equal(badgeCount(h.nodes.get('[data-letter-messages]').innerHTML),2);assert.equal(input.value,'書状を変換中');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,4);assert.equal(input.focusCount,focuses);assert.equal(main.htmlWrites,writes);assert.equal(scroll.scrollTop,137);assert.equal(h.doc.activeElement,input);assert(h.requests.some(route=>route.endsWith('after=2')));
  h.data.evaluation=null;await h.controller.refresh();assert.equal(badgeCount(h.nodes.get('[data-letter-messages]').innerHTML),0);assert.equal(badgeCount(h.nodes.get('[data-letter-thread-heading]').innerHTML),0);h.controller.dispose();
});
test('guild letter titles rank the sender but never the guild itself or historical names in the message text',()=>{
  const h=letters(),thread={kind:'guild',guild:{name:'同盟の旗'},sender:{id:'other',name:'送り主',evaluation:promoted},contextPlayer:{id:'context',name:'本拠の領主',evaluation}};
  const title=h.api.threadTitle(thread,'actor');assert.equal(badgeCount(title),1);assert(title.replace(/<[^>]*>/g,'').endsWith(' → 同盟の旗'));assert.equal(h.api.threadTitle(thread,'other').replace(/<[^>]*>/g,''),'同盟の旗');assert.equal(badgeCount(h.api.threadParticipants(thread)),2);noNestedButtons(title);
  h.controller.dispose();
});
test('field rows, battle parties and marker descriptions use the matching DTO and never modify formations or outcomes',()=>{
  global.SengokuEvaluationUI=require('../player-evaluation.js');const field=require('../field.js');
  const [player]=field.normalizePlayers([{playerId:'other',name:'相手',homeCastleId:'kiyosu',homeCastleName:'清洲城',level:4,keepLevel:3,evaluation,armySummary:{officerCount:2}}]);const before=JSON.stringify(player);
  const row=field.publicRow(player);assert.equal(badgeCount(row),1);noNestedButtons(row);assert.equal(JSON.stringify(player),before);
  const group=field.groupBases([player],{kiyosu:{lon:136.84,lat:35.21}})[0];assert(field.markerAppearance(group).label.includes(evaluation.rankName));
  const battle={id:'b',battleMode:'raid',won:true,attackerPlayerId:'actor',attackerName:'本人',attackerEvaluation:promoted,defenderPlayerId:'other',defenderName:'相手',defenderEvaluation:evaluation,troops:500,attackerLost:30,defenderLost:{troops:40,garrison:0},loot:{gold:10},rewards:{}};const saved=JSON.stringify(battle),html=field.battleReportHtml(battle,'actor');assert.equal(badgeCount(html),2);assert(html.includes('襲撃に成功'));assert.equal(JSON.stringify(battle),saved);assert.equal(badgeCount(field.publicRow({...player,evaluation:null})),0);
});
test('non-equipped purchases appear across social people, friends, guilds, news, ranks and mail without role badges',()=>{
  const h=social(),t=h.test,p={id:'other',name:'長い領主の名前・<甲斐の城主>',clan:'德川家',evaluation,appearance:copy(allOwned),isAdmin:true,isStaff:true,online:true};
  t.s.onlinePlayers=[p];t.s.friends=[p];t.s.friendId=p.id;t.s.requests=[{...p,direction:'incoming'}];t.s.members=[p];
  t.s.guildTreasury.ledger=[{id:'tx',playerId:p.id,name:p.name,playerEvaluation:evaluation,appearance:copy(allOwned),direction:'deposit',resource:'gold',amount:1,createdAt:'2026-11-21T00:00:00Z'}];
  t.s.guilds=[{id:'guild',name:'旗の仲間',ownerId:p.id,ownerName:p.name,ownerEvaluation:evaluation,ownerAppearance:copy(allOwned),memberCount:1,maxMembers:50}];t.s.guildRankings.guilds=t.s.guilds;
  t.s.achievements.events=[t.cleanAchievement({id:'e',playerId:p.id,playerName:p.name,playerEvaluation:evaluation,playerAppearance:copy(allOwned),title:'城郭を拡張',occurredAt:'2026-11-21T00:00:00Z'})];
  t.s.mail=[{id:'mail',source:'system',title:'贈り物',body:'利用者の本文を保持します。',gift:{gold:1},createdAt:'2026-11-21T00:00:00Z',participants:[{playerId:p.id,name:p.name,side:'defender',evaluation,appearance:copy(allOwned)}]}];t.s.openedMail='mail';
  const surfaces=[t.onlineView(),t.playerCards([p],'friend'),t.friendRequestRows(),t.friendsView(),t.guildView(),t.guildRankingRows(),t.guildLedgerRows(),t.achievementRows(),t.mailView(),t.chatView({player:p,caption:'本文'})];
  t.s.user.guildId='guild';t.s.user.guildName='旗の仲間';t.s.guildSection='members';surfaces.push(t.guildView());
  for(const html of surfaces){assert(purchaseCount(html)>=3);assert(!html.includes('class="social-role'));assert(html.includes('&lt;甲斐の城主&gt;'));noNestedButtons(html);}
  // The server's public projection supplies the operator house name when roles are visible (v5.14.0).
  assert(surfaces[1].includes('<p>德川家</p>'),'the supplied public house name is displayed unchanged');
  h.scope.SengokuPremiumRuntime.getAppearance=()=>copy(allOwned);assert.equal(purchaseCount(t.profileView()),3);
  assert.equal(purchaseCount(t.playerCards([{...p,appearance:undefined}],'friend')),0,'A role alone must not create a purchase indicator');
});
test('empty chat deltas add and remove all purchase icons on old posts while preserving drafts and scroll',async()=>{
  const h=social(),t=h.test,list=h.nodes.get('#social-message-list'),input=h.nodes.get('#social-chat-input');t.s.tab='world';
  const message={id:17,userId:'other',name:'領主',evaluation,text:'運営という言葉を含む利用者の投稿です。',createdAt:'2026-11-21T00:00:00Z',appearance:copy(noAppearance),isAdmin:true,isStaff:true};
  t.s.chats.set('world:',{messages:[message],after:17,rendered:true});input.value='返信を変換中';input.selectionStart=2;input.selectionEnd=4;h.scope.document.activeElement=input;list.scrollTop=137;t.renderMessages();
  let appearance=copy(allOwned);h.setHandler(async()=>({ok:true,messages:[],nextAfter:17,playerEvaluations:[{playerId:'other',name:'改名した領主',appearance}]}));await t.loadChat();
  assert.equal(purchaseCount(list.innerHTML),3);assert(list.innerHTML.includes('改名した領主'));assert.equal(message.name,'改名した領主');assert(list.innerHTML.includes(message.text));assert(!list.innerHTML.includes('class="social-role'));assert.equal(list.scrollTop,137);assert.equal(input.value,'返信を変換中');assert.equal(h.scope.document.activeElement,input);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,4);
  const writes=list.htmlWrites;await t.loadChat();assert.equal(list.htmlWrites,writes);
  appearance=copy(noAppearance);await t.loadChat();assert.equal(purchaseCount(list.innerHTML),0);assert.equal(t.s.chats.get('world:').messages.length,1);assert.equal(message.text,'運営という言葉を含む利用者の投稿です。');assert.equal(list.scrollTop,137);
});
test('empty letter deltas refresh current ownership on old authors and peers without replacing the composing form',async()=>{
  const h=letters();h.data.appearance=copy(allOwned);await h.controller.openThread(h.THREAD);h.controller.setDraft('本文を変換しています');
  const input=h.nodes.get('textarea'),main=h.nodes.get('[data-letter-main]'),scroll=h.nodes.get('[data-letter-scroll]');input.selectionStart=2;input.selectionEnd=5;input.isComposing=true;h.doc.activeElement=input;scroll.scrollTop=137;const writes=main.htmlWrites;
  assert.equal(purchaseCount(h.nodes.get('[data-letter-messages]').innerHTML),6);assert.equal(purchaseCount(h.nodes.get('[data-letter-thread-heading]').innerHTML),3);
  h.data.refresh=true;h.data.name='書状の新しい領主名';h.data.appearance=copy(noAppearance);await h.controller.refresh();
  assert.equal(purchaseCount(h.nodes.get('[data-letter-messages]').innerHTML),0);assert(h.nodes.get('[data-letter-messages]').innerHTML.includes('書状の新しい領主名'));assert(h.nodes.get('[data-letter-thread-heading]').innerHTML.includes('書状の新しい領主名'));assert(h.controller.getState().messages.every(message=>message.authorName==='書状の新しい領主名'));assert.equal(purchaseCount(h.nodes.get('[data-letter-thread-heading]').innerHTML),0);assert.equal(h.controller.getState().messages.length,2);assert.equal(main.htmlWrites,writes);assert.equal(input.value,'本文を変換しています');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);assert.equal(h.doc.activeElement,input);assert.equal(scroll.scrollTop,137);h.controller.dispose();
});
test('field and trade show current server ownership for parties and ignore role flags when rendering a name',()=>{
  global.SengokuPremiumRuntime={...premiumUI(),getAppearance:()=>copy(noAppearance)};global.SengokuEvaluationUI=require('../player-evaluation.js');const field=require('../field.js'),trade=require('../trade.js');
  const [p]=field.normalizePlayers([{playerId:'other',name:'相手',clan:'德川家',homeCastleId:'kiyosu',homeCastleName:'清洲城',level:4,evaluation,appearance:copy(allOwned),isAdmin:true,isStaff:true}]);
  const row=field.publicRow(p);assert.equal(purchaseCount(row),3);assert(!/運営|スタッフ/.test(row));assert(row.includes('<small>德川家</small>'),'the supplied public house name is displayed unchanged');noNestedButtons(row);
  const marker=field.groupBases([p],{kiyosu:{lon:136.84,lat:35.21}})[0];assert(field.markerAppearance(marker).label.includes('月影の城下を所有'));
  const battle={attackerPlayerId:'actor',attackerName:'本人',attackerAppearance:copy(noAppearance),defenderPlayerId:'other',defenderName:'相手',defenderAppearance:copy(allOwned),won:true,battleMode:'raid'};
  assert.equal(purchaseCount(field.battleReportHtml(battle,'actor')),3);
  const item=trade.cleanTrade({id:'tr_'+'1'.repeat(32),status:'pending',sender:{playerId:'other',name:'相手',appearance:copy(allOwned)},recipient:{playerId:'actor',name:'本人'},offer:{gold:1},want:{},canAccept:true});
  const state={ownerId:'actor',access:{writable:true},balances:{gold:100},rules:{balanceLimit:999999999}};assert.equal(purchaseCount(trade.tradeCard(item,state)),3);assert.equal(purchaseCount(trade.confirmationMarkup({action:'accept',target:item.sender,give:{},receive:{gold:1}})),3);
  item.sender.appearance=copy(noAppearance);assert.equal(purchaseCount(trade.tradeCard(item,state)),0);
});
test('a selected older field report picks up refreshed player evaluations',async()=>{
  const nodes=new Map(),listeners=new Map(),doc={hidden:false,activeElement:null,addEventListener(){},removeEventListener(){}},host={ownerDocument:doc,contains:value=>Boolean(value),querySelector:selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener(){}};
  const scope={document:doc,setTimeout:()=>1,clearTimeout(){},SengokuWorldMap:{mount:()=>({update(){},destroy(){}})}};scope.window=scope;vm.createContext(scope);vm.runInContext(evaluationSource,scope);vm.runInContext(fs.readFileSync(path.join(root,'field.js'),'utf8'),scope);
  let current=evaluation;const battle=()=>({id:'battle',battleMode:'raid',won:true,attackerPlayerId:'actor',attackerName:'本人',attackerEvaluation:evaluation,defenderPlayerId:'other',defenderName:'相手',defenderEvaluation:current,troops:500,attackerLost:30,defenderLost:{troops:40,garrison:0},loot:{gold:10},rewards:{}});
  const controller=scope.SengokuField.mount(host,{stateKey:'evaluated-field',identity:{id:'actor'},request:async route=>route.startsWith('/field/me')?{relationships:[],battles:[battle()]}:{players:[{playerId:'other',name:'相手',homeCastleId:'kiyosu',homeCastleName:'清洲城',level:3,evaluation:current}],total:1}});
  const click=async data=>listeners.get('click')({target:{closest:()=>({dataset:{fieldAction:data.action,...data}})},stopPropagation(){}});
  try{await controller.refresh();await click({action:'tab',tab:'reports'});await click({action:'report',battleId:'battle'});assert(nodes.get('[data-field-detail]').innerHTML.includes(evaluation.rankName));current=promoted;await controller.refresh();assert(nodes.get('[data-field-detail]').innerHTML.includes(promoted.rankName));assert(nodes.get('[data-field-detail]').innerHTML.includes('襲撃に成功'));}finally{controller.destroy();}
});
(async()=>{for(const {name,run}of tests){await run();console.log('PASS '+name);}console.log(`${tests.length} evaluation surface and continuity checks passed. No network requests were made.`);})().catch(error=>{console.error(error);process.exitCode=1;});
