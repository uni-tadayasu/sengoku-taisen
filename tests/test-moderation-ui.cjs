'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {createController,cleanTarget,confirmationMarkup}=require('../moderation.js');
const OWNER='u_operator',TARGET='u_target';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const error=(message,status,code)=>Object.assign(Error(message),{status,code});
const copy=value=>JSON.parse(JSON.stringify(value));
const tests=[];const test=(name,run)=>tests.push({name,run});
function target(id=TARGET,active=false){return{player:{id,name:id===TARGET?'対象の領主':'既にBAN中の領主',isAdmin:false,isStaff:false},ban:{active,revision:active?1:0,reason:active?'確認済みの理由':'',bannedAt:active?'2026-11-21T10:00:00Z':null,bannedBy:active?OWNER:null,updatedAt:'2026-11-21T10:00:00Z'},counts:{chatMessages:active?0:3,letterMessages:active?0:2,pendingTrades:active?0:1},canBan:!active,canUnban:active,canExpel:!active,expulsion:{revision:0,pending:false,castleId:'kiyosu',castleName:'清洲城',role:'lord',lordEpoch:2,expelledAt:null,reason:'',blockedReason:''},contentRevision:0};}
function setup({storage=new Map(),server,user={id:OWNER,name:'運営',isAdmin:true,isStaff:false}}={}){
  const data=server||{targets:new Map([[TARGET,target()],[ 'u_banned',target('u_banned',true)]]),receipts:new Map(),contentRevision:0,mutations:0};
  let actor=user,epoch=1,privilege=1,serial=0,handler=null;
  const calls=[],changes=[],storageAPI={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const view=id=>{const item=copy(data.targets.get(id));if(!item)throw error('対象なし',404,'PLAYER_NOT_FOUND');item.contentRevision=data.contentRevision;return item;};
  const base=async(route,options={method:'GET'})=>{
    const url=new URL(route,'https://local.invalid');
    if(url.pathname==='/admin/moderation/players')return{ok:true,players:[...data.targets.values()].map(item=>({...item.player,banned:item.ban.active}))};
    if(url.pathname==='/admin/moderation/target')return{ok:true,...view(url.searchParams.get('playerId'))};
    if(url.pathname==='/admin/moderation/bans')return{ok:true,bans:[...data.targets.values()].filter(item=>item.ban.active).map(item=>({player:copy(item.player),ban:copy(item.ban)})),nextCursor:null,contentRevision:data.contentRevision};
    if(route==='/admin/moderation/expel'&&options.method==='POST'){
      const {requestId,targetPlayerId,expectedRevision,expectedCastleId,expectedLordEpoch,reason}=options.data,prior=data.receipts.get(requestId);if(prior)return{ok:true,...view(targetPlayerId),receipt:copy(prior),idempotent:true};
      const item=data.targets.get(targetPlayerId),ex=item.expulsion;
      if(!item.canExpel||ex.revision!==expectedRevision||ex.castleId!==expectedCastleId||ex.lordEpoch!==expectedLordEpoch)throw error('拠点の所属が変わりました。確認し直してください。',409,'EXPULSION_CHANGED');
      const receipt={action:'expel',requestId,actorPlayerId:actor.id,targetPlayerId,castleId:ex.castleId,castleName:ex.castleName,role:ex.role,released:ex.role==='lord',reason};
      item.expulsion={...ex,revision:ex.revision+1,pending:true,role:null};item.canExpel=false;data.mutations++;data.receipts.set(requestId,receipt);
      return{ok:true,...view(targetPlayerId),receipt:copy(receipt),idempotent:false};
    }
    if(route==='/admin/moderation'&&options.method==='POST'){
      const {requestId,targetPlayerId,action,expectedRevision,reason}=options.data,prior=data.receipts.get(requestId);if(prior)return{ok:true,...view(targetPlayerId),receipt:copy(prior),idempotent:true};
      const item=data.targets.get(targetPlayerId);if(item.ban.revision!==expectedRevision)throw error('対象の状態が更新されました。',409,'MODERATION_REVISION_CONFLICT');
      const deleted={chatMessages:action==='ban'?item.counts.chatMessages:0,letterMessages:action==='ban'?item.counts.letterMessages:0},cancelledTrades=action==='ban'?item.counts.pendingTrades:0;
      if(action==='ban'){item.counts={chatMessages:0,letterMessages:0,pendingTrades:0};data.contentRevision++;}
      item.ban={...item.ban,active:action==='ban',revision:item.ban.revision+1,reason,bannedAt:action==='ban'?'2026-11-21T11:00:00Z':item.ban.bannedAt};item.canBan=!item.ban.active;item.canUnban=item.ban.active;data.mutations++;
      const receipt={id:'mo_'+(++serial),requestId,action,targetPlayerId,targetName:item.player.name,actorPlayerId:actor.id,reason,moderationRevision:item.ban.revision,contentRevision:data.contentRevision,deleted,cancelledTrades,createdAt:'2026-11-21T11:00:00Z'};data.receipts.set(requestId,receipt);
      return{ok:true,...view(targetPlayerId),receipt:copy(receipt),idempotent:false};
    }
    throw Error('Unexpected local moderation route '+route);
  };
  const options={getUser:()=>actor,getContext:()=>({epoch,privilegeEpoch:privilege}),storage:storageAPI,uuid:()=> 'request_'+(++serial),onChange:value=>changes.push(value),request:async(route,value={method:'GET'})=>{calls.push({route,options:copy(value)});return handler?handler(route,value,base):base(route,value);}};
  const controller=createController(options);
  return{controller,options,data,storage,storageAPI,calls,changes,base,setHandler:value=>handler=value,setUser:value=>{actor=value;privilege++;},newSession:()=>epoch++,posts:()=>calls.filter(call=>call.options.method==='POST')};
}

test('staff and ordinary users have no moderation data or outgoing requests',async()=>{
  for(const user of [{id:OWNER,isAdmin:false,isStaff:true},{id:OWNER,isAdmin:false,isStaff:false},null]){
    const h=setup({user});assert.equal(await h.controller.open(),false);h.controller.setQuery('対象');await h.controller.search();await h.controller.select(TARGET);await h.controller.loadBans();
    assert.equal(h.calls.length,0);const state=h.controller.getState();assert.equal(state.authorized,false);assert.equal(state.target,null);assert.equal(state.results.length,0);assert.equal(state.bans.length,0);h.controller.dispose();
  }
});
test('candidate browsing starts with known players, verifies the selected ID, and sends no moderation action',async()=>{
  const h=setup(),online=deferred();let picker;
  global.SengokuInputList={open:config=>{picker=config;}};
  global.SengokuSocial={getKnownPlayers:()=>[{id:OWNER,name:'運営'},{id:TARGET,name:'同じ名前'},{id:'u_other',name:'同じ名前'}],getOnlineCandidates:()=>online.promise};
  try{
    await h.controller.open();h.controller.openCandidates({});
    assert.deepEqual(picker.options.map(row=>row.value),[TARGET,'u_other']);
    assert.notEqual(picker.options[0].detail,picker.options[1].detail);
    assert.deepEqual(await picker.load('一'),[]);assert.equal(h.calls.length,0);
    const filtered=await picker.load('対象');assert(filtered.some(row=>row.value===TARGET));
    await picker.onSelect(filtered.find(row=>row.value===TARGET));
    assert.equal(h.controller.getState().query,TARGET);assert.equal(h.controller.getState().target.player.id,TARGET);
    assert.equal(h.controller.getState().confirm,null);assert.equal(h.posts().length,0);
    h.controller.openCandidates({});const loading=picker.load('');
    h.setUser({id:'u_staff',isStaff:true});online.resolve([{id:'u_new',name:'接続中'}]);
    assert.deepEqual(await loading,[]);assert.equal(picker.valid(),false);
    const before=h.calls.length;await picker.onSelect({value:'u_new'});assert.equal(h.calls.length,before);
    picker=null;h.controller.openCandidates({});assert.equal(picker,null);
  }finally{h.controller.dispose();delete global.SengokuSocial;delete global.SengokuInputList;}
});

test('BAN requires a fresh immutable target preview and a separate explicit confirmation',async()=>{
  const h=setup();await h.controller.open();h.controller.setQuery('対象');await h.controller.search();assert.equal(h.controller.getState().results.length,2);
  await h.controller.select(TARGET);h.controller.setReason('繰り返し確認した投稿');h.data.targets.get(TARGET).counts.chatMessages=7;
  await h.controller.prepare('ban');const confirm=h.controller.getState().confirm;assert.equal(confirm.target.counts.chatMessages,7);assert.equal(confirm.data.expectedRevision,0);assert.equal(h.posts().length,0);
  const html=confirmationMarkup(confirm);assert(html.includes(TARGET));assert(html.includes('本文の削除は取り消せません'));assert(html.includes('書状本文を削除'));assert(html.includes('ほかの人が送った本文は保持'));
  h.controller.setReason('裏から変えた理由');assert.equal(h.controller.getState().confirm.data.reason,'繰り返し確認した投稿');
  assert(await h.controller.confirm());assert.equal(h.posts().length,1);assert.equal(h.data.mutations,1);assert.equal(h.data.targets.get(TARGET).ban.active,true);assert.equal(h.data.targets.get(TARGET).counts.chatMessages,0);assert.equal(h.controller.getState().view,'bans');assert.equal(h.storage.size,0);h.controller.dispose();
});
test('unban preserves the same player identity and explicitly leaves deleted content absent',async()=>{
  const h=setup();await h.controller.open('bans');await h.controller.select('u_banned');await h.controller.prepare('unban');
  const confirm=h.controller.getState().confirm;assert.equal(confirm.data.targetPlayerId,'u_banned');assert(confirmationMarkup(confirm).includes('復元されません'));assert.equal(h.posts().length,0);
  assert(await h.controller.confirm());assert.equal(h.data.targets.get('u_banned').ban.active,false);assert.equal(h.data.targets.get('u_banned').counts.chatMessages,0);assert.equal(h.data.targets.get('u_banned').counts.letterMessages,0);assert(h.controller.getState().status.includes('同じ領主で利用を再開'));h.controller.dispose();
});
test('unban offers a name and a definite duplicate rejection keeps the draft editable under a new receipt',async()=>{
  const h=setup();await h.controller.open('bans');await h.controller.select('u_banned');await h.controller.prepare('unban');
  const first=h.controller.getState().confirm;assert.equal(first.data.name,'既にBAN中の領主');assert(confirmationMarkup(first).includes('id="moderation-restore-name"'));
  let attempts=0;h.setHandler(async(route,options,base)=>{if(options.method==='POST'){attempts++;if(attempts===1)throw error('この名前は使用中です。新しい名前を入力してください。',409,'NAME_TAKEN');assert.equal(options.data.name,'葛\u{E0100}西');}return base(route,options);});
  assert.equal(await h.controller.confirm(),false);let state=h.controller.getState();assert.equal(state.pending,null);assert.equal(state.confirm.data.name,first.data.name);assert.notEqual(state.confirm.data.requestId,first.data.requestId);assert.equal(h.data.mutations,0);assert.equal(h.data.targets.get('u_banned').ban.active,true);
  h.controller.setRestoreName('  葛\u{E0100}西  ');assert(await h.controller.confirm());assert.equal(h.posts()[1].options.data.targetPlayerId,'u_banned');assert.equal(h.posts()[1].options.data.expectedRevision,first.data.expectedRevision);assert.notEqual(h.posts()[1].options.data.requestId,h.posts()[0].options.data.requestId);assert.equal(h.data.mutations,1);h.controller.dispose();
});
test('an uncertain unban preserves its exact chosen name and request across reload',async()=>{
  const h=setup();await h.controller.open('bans');await h.controller.select('u_banned');await h.controller.prepare('unban');h.controller.setRestoreName('復帰Cafe\u0301');
  h.setHandler(async(route,options,base)=>{const result=await base(route,options);if(options.method==='POST')throw Error('reply lost');return result;});
  assert.equal(await h.controller.confirm(),false);const pending=h.controller.getState().pending;assert.equal(pending.data.name,'復帰Cafe\u0301');h.controller.setRestoreName('別の名前');assert.equal(h.controller.getState().pending.data.name,pending.data.name);h.controller.dispose();
  const resumed=setup({storage:h.storage,server:h.data});await resumed.controller.open();assert(await resumed.controller.retry());assert.deepEqual(resumed.posts()[0].options.data,pending.data);assert.equal(h.data.mutations,1);resumed.controller.dispose();
});
test('unban for an expelled player leaves the name selection to readmission and rejects invalid name drafts locally',async()=>{
  const h=setup();h.data.targets.get('u_banned').expulsion.pending=true;await h.controller.open('bans');await h.controller.select('u_banned');await h.controller.prepare('unban');h.controller.setRestoreName('まだ予約しない');
  const record=h.controller.getState().confirm;assert(!Object.hasOwn(record.data,'name'));assert(!confirmationMarkup(record).includes('id="moderation-restore-name"'));assert(confirmationMarkup(record).includes('再入城する際'));assert(await h.controller.confirm());assert(!Object.hasOwn(h.posts()[0].options.data,'name'));h.controller.dispose();
  const other=setup();await other.controller.open('bans');await other.controller.select('u_banned');await other.controller.prepare('unban');
  for(const value of ['', '字'.repeat(25), '葛\u{E0100}'.repeat(13), '名\u0000前']){other.controller.setRestoreName(value);assert.equal(await other.controller.confirm(),false);assert.equal(other.posts().length,0);assert(other.controller.getState().confirm);assert.match(other.controller.getState().error,/1〜24文字/);}
  other.controller.setRestoreName('🏯'.repeat(24));assert(await other.controller.confirm());assert.equal(other.posts()[0].options.data.name,'🏯'.repeat(24));other.controller.dispose();
});
test('moderation reviews explain name release and escape editable restoration names',()=>{
  const chosen=target();for(const action of ['ban','expel']){const html=confirmationMarkup({target:chosen,data:{action,expectedCastleId:'kiyosu'}});assert(html.includes('これまでの領主名は他のプレイヤーが使える'));assert(html.includes('処分履歴と公開IDは残り'));}
  const html=confirmationMarkup({target:target('u_banned',true),data:{action:'unban',name:'\"><img src=x>'}});assert(!html.includes('<img'));assert(html.includes('&quot;&gt;&lt;img'));assert(!html.includes('maxlength="24"'));
});
test('self and the primary operator are protected even if a malformed preview enables BAN',async()=>{
  const h=setup();h.data.targets.set(OWNER,{...target(OWNER),player:{id:OWNER,name:'自分',isAdmin:false},canBan:true});
  h.data.targets.set('u_other_admin',{...target('u_other_admin'),player:{id:'u_other_admin',name:'運営',isAdmin:true},canBan:true});
  await h.controller.open();for(const id of [OWNER,'u_other_admin']){await h.controller.select(id);await h.controller.prepare('ban');assert.equal(h.controller.getState().confirm,null);}
  assert.equal(h.posts().length,0);h.controller.dispose();
});
test('a changed target revision cancels the old review without an automatic retry',async()=>{
  const h=setup();await h.controller.open();await h.controller.select(TARGET);await h.controller.prepare('ban');h.data.targets.get(TARGET).ban.revision++;
  assert.equal(await h.controller.confirm(),false);assert.equal(h.controller.getState().confirm,null);assert.equal(h.controller.getState().pending,null);assert.equal(h.data.mutations,0);assert.equal(h.posts().length,1);
  await h.controller.prepare('ban');assert.equal(h.controller.getState().confirm.data.expectedRevision,1);assert(await h.controller.confirm());assert.equal(h.data.mutations,1);h.controller.dispose();
});
test('durable storage is required before any destructive request is sent',async()=>{
  const h=setup();await h.controller.open();await h.controller.select(TARGET);await h.controller.prepare('ban');h.storageAPI.setItem=()=>{throw Error('storage blocked');};
  assert.equal(await h.controller.confirm(),false);assert.equal(h.posts().length,0);assert(h.controller.getState().confirm);assert.match(h.controller.getState().error,/保存できません/);h.controller.dispose();
});
test('an unknown result survives reload and resumes the identical request without a second deletion',async()=>{
  const h=setup(),wait=deferred();await h.controller.open();await h.controller.select(TARGET);await h.controller.prepare('ban');
  h.setHandler(async(route,options,base)=>{const result=await base(route,options);return options.method==='POST'?wait.promise:result;});
  const sending=h.controller.confirm();await drain();assert.equal(await h.controller.confirm(),false);assert.equal(h.posts().length,1);wait.reject(Error('reply lost'));assert.equal(await sending,false);
  const pending=h.controller.getState().pending;assert(pending);assert.equal(h.data.mutations,1);h.controller.dispose();
  const resumed=setup({storage:h.storage,server:h.data});await resumed.controller.open();assert(resumed.controller.getState().pending);assert(await resumed.controller.retry());
  assert.deepEqual(resumed.posts()[0].options.data,pending.data);assert.equal(h.data.mutations,1);assert.equal(resumed.controller.getState().pending,null);resumed.controller.dispose();
});
test('role loss, identity changes, and a new session discard private results and queued mutations',async()=>{
  const h=setup(),read=deferred();await h.controller.open();h.setHandler((route,options,base)=>route.startsWith('/admin/moderation/target')?read.promise:base(route,options));
  const choosing=h.controller.select(TARGET);h.setUser({id:OWNER,isAdmin:false,isStaff:true});h.controller.refreshIdentity();read.resolve({ok:true,...target()});await choosing;
  assert.equal(h.controller.getState().target,null);assert.equal(h.controller.getState().open,false);assert.equal(h.controller.getState().results.length,0);h.controller.dispose();
  const next=setup();await next.controller.open();await next.controller.select(TARGET);await next.controller.prepare('ban');const sending=next.controller.confirm();next.newSession();next.controller.refreshIdentity();
  assert.equal(await sending,false);assert.equal(next.posts().length,0);assert.equal(next.data.mutations,0);next.controller.dispose();
});
test('a late mutation result cannot expose an old operator target to a replacement user',async()=>{
  const h=setup(),wait=deferred();await h.controller.open();await h.controller.select(TARGET);await h.controller.prepare('ban');let committed;
  h.setHandler(async(route,options,base)=>{const result=await base(route,options);if(options.method==='POST'){committed=result;return wait.promise;}return result;});
  const sending=h.controller.confirm();await drain();h.setUser({id:'u_new',name:'別の領主',isAdmin:false});h.controller.refreshIdentity();wait.resolve(committed);assert.equal(await sending,false);
  const state=h.controller.getState();assert.equal(state.target,null);assert.equal(state.pending,null);assert.equal(state.bans.length,0);assert.equal(state.status,'');assert(h.storage.has('sengoku-moderation-pending-v1:'+OWNER));h.controller.dispose();
});
test('an unrelated receipt cannot dismiss an uncertain administrative operation',async()=>{
  const h=setup();await h.controller.open();await h.controller.select(TARGET);await h.controller.prepare('ban');
  h.setHandler(async(route,options,base)=>{const result=await base(route,options);if(options.method==='POST')result.receipt.actorPlayerId='u_someone_else';return result;});
  assert.equal(await h.controller.confirm(),false);assert(h.controller.getState().pending);assert.match(h.controller.getState().error,/結果を確認/);h.controller.dispose();
});
test('names, reasons and count data are validated and escaped in the destructive review',async()=>{
  assert.equal(cleanTarget({...target(),counts:{chatMessages:-1,letterMessages:1,pendingTrades:0}}),null);
  const chosen=target();chosen.player.name='<img src=x onerror="attack()">';const html=confirmationMarkup({target:chosen,data:{action:'ban',reason:'<script>bad()</script>'}});
  assert(!html.includes('<img'));assert(!html.includes('<script>'));assert(html.includes('&lt;img'));assert(html.includes('&lt;script&gt;'));assert(html.includes('未成立の交易を取消'));
});

test('expulsion reviews the current base and sends a separate action without deleting posts or banning',async()=>{
  const h=setup();await h.controller.open();await h.controller.select(TARGET);
  h.data.targets.get(TARGET).expulsion={...h.data.targets.get(TARGET).expulsion,castleId:'himeji',castleName:'姫路城',lordEpoch:8};
  h.controller.setReason('長期未利用による拠点整理');await h.controller.prepare('expel');const record=h.controller.getState().confirm;
  assert.equal(record.data.expectedCastleId,'himeji');assert.equal(record.data.expectedLordEpoch,8);assert.equal(record.data.expectedRevision,0);assert.equal(h.posts().length,0);
  const markup=confirmationMarkup(record);assert(markup.includes('姫路城'));assert(markup.includes('他のプレイヤーがこの城を選べる'));assert(markup.includes('資産は現在残高と開始時の額の少ない方'));assert(markup.includes('施設・研究・戦役は初期化'));assert(!markup.includes('BANして投稿を削除'));
  assert.equal(await h.controller.confirm(),true);assert.equal(h.posts()[0].route,'/admin/moderation/expel');assert(!Object.hasOwn(h.posts()[0].options.data,'action'));
  const result=h.data.targets.get(TARGET);assert.equal(result.ban.active,false);assert.equal(result.counts.chatMessages,3);assert.equal(result.counts.letterMessages,2);assert.equal(result.expulsion.pending,true);assert.equal(h.controller.getState().view,'search');assert.match(h.controller.getState().status,/他のプレイヤーが選べる/);h.controller.dispose();
});
test('retainer expulsion explicitly preserves the current lord and other retainers',async()=>{
  const h=setup();h.data.targets.get(TARGET).expulsion.role='retainer';await h.controller.open();await h.controller.select(TARGET);await h.controller.prepare('expel');
  assert.match(confirmationMarkup(h.controller.getState().confirm),/現在の領主と他の家臣はそのまま/);assert(await h.controller.confirm());assert.match(h.controller.getState().status,/対象の家臣を除籍/);assert(!h.controller.getState().status.includes('領主枠を空け'));h.controller.dispose();
});
test('expulsion rejects a changed lord tenure and requires renewed review',async()=>{
  const h=setup();await h.controller.open();await h.controller.select(TARGET);await h.controller.prepare('expel');h.data.targets.get(TARGET).expulsion.lordEpoch++;
  assert.equal(await h.controller.confirm(),false);assert.equal(h.controller.getState().pending,null);assert.equal(h.controller.getState().confirm,null);assert.equal(h.data.mutations,0);
  await h.controller.prepare('expel');assert.equal(h.controller.getState().confirm.data.expectedLordEpoch,3);assert(await h.controller.confirm());h.controller.dispose();
});
test('an uncertain expulsion reloads and retries the same reviewed base without a second mutation',async()=>{
  const h=setup();await h.controller.open();await h.controller.select(TARGET);await h.controller.prepare('expel');
  h.setHandler(async(route,options,base)=>{const result=await base(route,options);if(options.method==='POST')throw Error('reply lost');return result;});
  assert.equal(await h.controller.confirm(),false);const pending=h.controller.getState().pending;assert(pending);assert.equal(h.data.mutations,1);h.controller.dispose();
  const next=setup({storage:h.storage,server:h.data});await next.controller.open();assert(await next.controller.retry());assert.equal(h.data.mutations,1);
  const expected={...pending.data};delete expected.action;assert.deepEqual(next.posts()[0].options.data,expected);assert.equal(next.controller.getState().pending,null);next.controller.dispose();
});
test('shared court and deputy roles cannot be expelled even when a malformed response enables the action',async()=>{
  for(const role of ['isAdmin','isStaff','isDeputy']){
    const h=setup();h.data.targets.get(TARGET).player[role]=true;await h.controller.open();await h.controller.select(TARGET);await h.controller.prepare('expel');assert.equal(h.controller.getState().confirm,null);assert.equal(h.posts().length,0);h.controller.dispose();
  }
  const item=target();item.expulsion.castleName='<img src=x onerror=attack()>';
  assert(!confirmationMarkup({target:item,data:{action:'expel',expectedCastleId:'kiyosu'}}).includes('<img'));
  item.expulsion.lordEpoch=-1;assert.equal(cleanTarget(item).canExpel,false);
});

function socialHarness(){
  const requests=[],storage=new Map(),revisions=[],events={suspended:0,invalidated:0,letters:0,tradeDisposed:0,roles:[]},TOKEN='a'.repeat(64);let handler=async()=>({ok:true}),t;
  const context={console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,crypto:crypto.webcrypto,document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},SENGOKU_API_BASE:'https://api.example.invalid',fetch:async(url,options)=>{requests.push({url,options});const result=await handler(url,options);return{ok:!result.__status,status:result.__status||200,json:async()=>result};},SengokuBridge:{setRoleAccess(value){events.roles.push(value);},setSyncAccess(){},toast(){}},SengokuLetters:{refreshIdentity(){events.letters++;},observeContentRevision:value=>revisions.push(value)},SengokuTrade:{dispose(){events.tradeDisposed++;},refreshIdentity(){}},SengokuModeration:{refreshIdentity(){}},SengokuCloudSync:{stop(){},start(){},invalidateAccountAccess(){events.invalidated++;t.acceptUser(null,{fromSync:true});},suspendAccount(value){events.suspended++;t.acceptUser({id:value.playerId,isBanned:true,isAdmin:false,isStaff:false},{fromSync:true});}}};
  context.window=context;vm.createContext(context);let source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8');source=source.replace('global.SengokuSocial={open','global.__moderationSocial={s,api,loadChat,renderMessages,acceptUser,markAccountBanned,observeContentRevision,adminView,tabs,setUI:value=>{dialog=value;}};global.SengokuSocial={open');vm.runInContext(source,context);t=context.__moderationSocial;t.s.identity={id:OWNER,token:TOKEN};t.s.user={id:OWNER,name:'運営',isAdmin:true,isStaff:false,guildId:null};storage.set('sengoku-online-identity-v1',JSON.stringify(t.s.identity));
  return{context,t,requests,storage,revisions,events,TOKEN,setHandler:value=>handler=value};
}
test('ordinary and staff-only players cannot use the operational management entrance or transport',async()=>{
  const h=socialHarness();assert(h.t.adminView().includes('プレイヤー管理'));assert(h.t.adminView().includes('data-id="moderation"'));
  await h.context.SengokuSocial.moderationRequest('/admin/moderation/target?playerId='+TARGET);assert.equal(h.requests.length,1);
  for(const user of [{id:OWNER,isAdmin:false,isStaff:true},{id:OWNER,isAdmin:false,isStaff:false}]){h.t.acceptUser(user);assert(!h.t.adminView().includes('プレイヤー管理'));assert.throws(()=>h.context.SengokuSocial.moderationRequest('/admin/moderation/bans'),/運営権限/);}
  assert.equal(h.requests.length,1);assert.throws(()=>h.context.SengokuSocial.moderationRequest('/admin/mail',{method:'POST'}),/操作/);
});
test('a moderation revision clears every cached room and replaces the current delta with safe server messages',async()=>{
  const h=socialHarness();h.t.s.tab='world';h.t.observeContentRevision(1);h.t.s.chats.set('world:',{messages:[{id:1,userId:TARGET,name:'対象',text:'削除対象'}],after:1,rendered:true});h.t.s.chats.set('friend:u_other',{messages:[{id:2,userId:TARGET,text:'別室の削除対象'}],after:2});
  h.setHandler(async()=>({ok:true,contentRevision:2,reset:true,messages:[{id:3,userId:'u_innocent',name:'ほかの領主',text:'残す本文',createdAt:'2026-11-21T00:00:00Z'}],nextAfter:3}));
  await h.t.loadChat();assert.equal(h.t.s.chats.has('friend:u_other'),false);assert.equal(h.t.s.chats.get('world:').messages.length,1);assert.equal(h.t.s.chats.get('world:').messages[0].text,'残す本文');assert.equal(h.t.s.chats.get('world:').after,3);
  assert(new URL(h.requests[0].url).searchParams.get('contentRevision')==='1');assert.equal(h.revisions.at(-1),2);
});
test('a late old chat success cannot revive posts after a newer deletion revision',async()=>{
  const h=socialHarness(),wait=deferred();h.t.s.tab='world';h.t.observeContentRevision(3);h.setHandler(()=>wait.promise);
  const reading=h.t.loadChat();h.t.observeContentRevision(4);wait.resolve({ok:true,contentRevision:3,messages:[{id:1,text:'削除済み本文'}],nextAfter:1});
  await assert.rejects(reading,error=>error.code==='STALE_CONTENT');assert.equal(h.t.s.chats.size,0);assert.equal(h.t.s.contentRevision,4);assert.equal(h.t.observeContentRevision(2),false);
});
test('chat DOM signatures include content changes when message identities remain the same',async()=>{
  const h=socialHarness(),list={innerHTML:'',dataset:{},scrollHeight:100,clientHeight:100,scrollTop:0};h.t.setUI({querySelector:selector=>selector==='#social-message-list'?list:null,querySelectorAll:()=>[]});h.t.s.tab='world';
  const cached={messages:[{id:1,userId:TARGET,name:'対象',text:'元の本文',createdAt:'2026-11-21T00:00:00Z'}],after:1};h.t.s.chats.set('world:',cached);h.t.renderMessages();assert(list.innerHTML.includes('元の本文'));
  cached.messages[0].text='削除済み';h.t.renderMessages();assert(!list.innerHTML.includes('元の本文'));assert(list.innerHTML.includes('削除済み'));
});
test('ACCOUNT_BANNED preserves authentication, suspends sync once, rejects old responses, and permits verified unban recovery',async()=>{
  const h=socialHarness(),late=deferred(),before=h.context.SengokuSocial.getModerationContext().epoch;
  h.t.s.chats.set('world:',{messages:[{id:1,text:'private'}],after:1});h.t.s.mail=[{body:'private mail'}];h.t.s.friends=[{id:TARGET}];
  h.setHandler((url)=>url.endsWith('/mail')?late.promise:Promise.resolve({__status:403,ok:false,error:{code:'ACCOUNT_BANNED',message:'運営による利用停止'}}));
  const old=h.t.api('/mail');await assert.rejects(h.t.api('/chat',{method:'POST',data:{text:'送信'}}),error=>error.code==='ACCOUNT_BANNED');
  assert.equal(h.events.suspended,1);assert.equal(h.t.s.user.isBanned,true);assert.equal(h.t.s.chats.size,0);assert.equal(h.t.s.mail.length,0);assert.equal(h.t.s.friends.length,0);assert.equal(h.context.SengokuSocial.getModerationContext().epoch,before);
  assert.equal(h.t.s.identity.token,h.TOKEN);assert.equal(JSON.parse(h.storage.get('sengoku-online-identity-v1')).token,h.TOKEN);assert(h.events.tradeDisposed>0);
  late.resolve({ok:true,mail:[{body:'stale private body'}]});await assert.rejects(old,error=>error.code==='STALE_IDENTITY');
  const count=h.requests.length;await assert.rejects(h.t.api('/chat',{method:'POST',data:{text:'再投稿'}}),error=>error.code==='ACCOUNT_BANNED');await assert.rejects(h.t.api('/sync/lease',{method:'POST',data:{deviceId:'device'}}),error=>error.code==='ACCOUNT_BANNED');assert.equal(h.requests.length,count);
  h.setHandler(async()=>({ok:true,user:{id:OWNER,name:'運営',isAdmin:true,isStaff:false}}));const recovery=await h.t.api('/sync?deviceId=device');h.t.acceptUser(recovery.user,{fromSync:true});
  assert.equal(h.t.s.accountBanned,null);assert.equal(h.t.s.user.isBanned,false);assert.equal(h.context.SengokuSocial.getModerationContext().epoch,before);await h.t.api('/sync/lease',{method:'POST',data:{deviceId:'device'}});assert.equal(h.requests.length,count+2);assert.equal(h.events.suspended,1);
});

test('non-sync ACCOUNT_ACCESS_CHANGED invalidates older responses and suspends writes without assuming a ban',async()=>{
  const h=socialHarness(),late=deferred(),before=h.context.SengokuSocial.getModerationContext().epoch;
  h.t.s.chats.set('world:',{messages:[{id:1,text:'previous private body'}],after:1});h.t.s.mail=[{body:'private mail'}];
  h.setHandler(url=>url.includes('/sync?')?late.promise:Promise.resolve({__status:409,ok:false,error:{code:'ACCOUNT_ACCESS_CHANGED',message:'利用状態を再確認してください。'}}));
  const oldSync=h.t.api('/sync?deviceId=device');
  await assert.rejects(h.t.api('/chat',{method:'POST',data:{text:'投稿'}}),error=>error.code==='ACCOUNT_ACCESS_CHANGED');
  assert.equal(h.events.invalidated,1);assert.equal(h.events.suspended,0);assert.equal(h.t.s.accountBanned,null);assert(h.t.s.accountAccessPending);assert.equal(h.t.s.user,null);assert.equal(h.t.s.chats.size,0);assert.equal(h.t.s.mail.length,0);
  late.resolve({ok:true,user:{id:OWNER,isAdmin:true},save:{private:'older save'}});await assert.rejects(oldSync,error=>error.code==='STALE_IDENTITY');
  const count=h.requests.length;await assert.rejects(h.t.api('/sync/lease',{method:'POST',data:{}}),error=>error.code==='ACCOUNT_ACCESS_CHANGED');assert.equal(h.requests.length,count);assert.equal(h.context.SengokuSocial.getModerationContext().epoch,before);assert.equal(h.t.s.identity.token,h.TOKEN);
  h.setHandler(async()=>({ok:true,user:{id:OWNER,name:'運営',isAdmin:true}}));const latest=await h.t.api('/sync?deviceId=device');h.t.acceptUser(latest.user,{fromSync:true});
  assert.equal(h.t.s.accountAccessPending,null);await h.t.api('/sync/lease',{method:'POST',data:{deviceId:'device'}});assert.equal(h.requests.length,count+2);
});

test('BASE_EXPELLED invalidates a stale gameplay request without suspending the account',async()=>{
  const h=socialHarness();h.setHandler(async()=>({__status:409,ok:false,error:{code:'BASE_EXPELLED',message:'拠点を選び直してください。'}}));
  await assert.rejects(h.t.api('/sync',{method:'PUT',data:{save:{}}}),error=>error.code==='ACCOUNT_ACCESS_CHANGED');assert.equal(h.events.invalidated,1);assert.equal(h.events.suspended,0);assert.equal(h.t.s.accountBanned,null);assert.equal(h.t.s.identity.token,h.TOKEN);
});
test('deputy transport remains primary-only and rejects a late result after role loss',async()=>{
  const h=socialHarness(),gate=deferred();assert(h.t.adminView().includes('サブ運営'));
  await h.context.SengokuSocial.deputyRequest('/admin/deputy');assert(h.requests.at(-1).url.endsWith('/admin/deputy'));
  assert.throws(()=>h.context.SengokuSocial.deputyRequest('/admin/deputy?all=1'),/操作/);
  h.setHandler(()=>gate.promise);const task=h.context.SengokuSocial.deputyRequest('/admin/deputy',{method:'POST',data:{}});h.t.acceptUser({id:OWNER,name:'別役職',isAdmin:false,isDeputy:false});gate.resolve({ok:true,revision:1,deputy:null});await assert.rejects(task,error=>error.code==='STALE_IDENTITY');
  h.t.acceptUser({id:OWNER,name:'サブ運営',isAdmin:false,isDeputy:true},{fromSync:true});h.t.acceptUser({id:OWNER,name:'サブ運営',isAdmin:false,isDeputy:true});
  assert.equal(h.context.SengokuSocial.getUser().isDeputy,true);assert.equal(h.events.roles.at(-1).isDeputy,true);assert.equal(h.events.roles.at(-1).isAdmin,false);assert.equal(h.events.roles.at(-1).isStaff,false);
  assert.throws(()=>h.context.SengokuSocial.deputyRequest('/admin/deputy'),/運営権限/);h.setHandler(async()=>({ok:true,bans:[]}));await h.context.SengokuSocial.moderationRequest('/admin/moderation/bans');assert.equal(h.context.SengokuSocial.getUser().isAdmin,false);assert.equal(h.context.SengokuSocial.getUser().canOperate,true);
  h.t.acceptUser({id:OWNER,name:'解任',isDeputy:false});assert.equal(h.events.invalidated,1);assert.equal(h.t.s.user,null);
});
test('the real deputy controller sends appointment and dismissal JSON through the social transport',async()=>{
  const h=socialHarness(),Deputy=require('../deputy-operator.js'),person=target().player;let revision=0,deputy=null;
  h.setHandler(async(url,options)=>{
    const route=new URL(url).pathname.replace(/^\/api\/v1(?=\/)/,'');
    if(route==='/admin/moderation/players')return{ok:true,players:[person]};
    assert.equal(route,'/admin/deputy');
    if(options.method==='POST'){
      const body=JSON.parse(options.body);assert.equal(body.targetPlayerId,TARGET);assert.equal(body.expectedRevision,revision);assert.equal(typeof body.requestId,'string');assert(['appoint','dismiss'].includes(body.action));
      revision++;deputy=body.action==='appoint'?{...person,isDeputy:true}:null;return{ok:true,revision,deputy,action:body.action,idempotent:false};
    }
    return{ok:true,revision,deputy};
  });
  const social=h.context.SengokuSocial,controller=Deputy.create({storage:h.context.localStorage,getUser:()=>social.getUser(),getContext:()=>social.getModerationContext(),uuid:()=> 'transport-operation-'+revision,request:(route,options)=>route==='/admin/deputy'?social.deputyRequest(route,options):social.moderationRequest(route,options)});
  assert(await controller.mount(null),controller.getState().error);controller.setQuery('対象');assert(await controller.search());assert(controller.prepare('appoint',TARGET));assert(await controller.confirm());assert.equal(controller.getState().deputy.id,TARGET);
  assert(controller.prepare('dismiss'));assert(await controller.confirm());assert.equal(controller.getState().deputy,null);assert.equal(revision,2);assert.equal(h.requests.filter(row=>row.options.method==='POST').length,2);controller.dispose();
});

(async()=>{for(const {name,run}of tests){await run();console.log('PASS '+name);}console.log(tests.length+' moderation, privacy, deletion and suspension UI checks passed. No network requests were made.');})().catch(error=>{console.error(error);process.exitCode=1;});
