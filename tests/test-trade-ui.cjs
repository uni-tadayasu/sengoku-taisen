'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createController,cleanTrade,tradeCard,confirmationMarkup,escape}=require('../trade.js');
const ME='u_me',PEER='u_peer',ID='tr_'+'1'.repeat(32);
const zero=()=>({gold:0,rice:0,wood:0,stone:0,magatama:0});
const basket=values=>({...zero(),...values});
const trade=(extra={})=>({id:ID,revision:1,status:'pending',sender:{playerId:PEER,name:'輸出する領主'},recipient:{playerId:ME,name:'自分'},offer:basket({wood:150}),want:basket({rice:200}),createdAt:'2026-11-21T12:00:00Z',updatedAt:'2026-11-21T12:00:00Z',delivery:null,canAccept:true,canReject:true,canCancel:false,canClaim:false,...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const tests=[];const test=(name,run)=>tests.push({name,run});
function setup({storage=new Map(),records=[trade()],writable=true}={}){
  let user={id:ME,name:'自分'},serial=0,handler=null,writeHandler=null,canWrite=writable,timer=0;
  const balances=basket({gold:5000,rice:5000,wood:5000,stone:5000,magatama:1000}),calls=[],changes=[],timers=new Map(),receipts=new Map();
  const base=async(route,options={})=>{
    const url=new URL(route,'https://local.invalid');
    if(url.pathname==='/players')return{ok:true,players:[{id:PEER,name:'名前が同じ領主'},{id:'u_peer2',name:'名前が同じ領主'},{id:ME,name:'自分'}]};
    if(url.pathname==='/trades/recipient')return{ok:true,player:{id:url.searchParams.get('playerId'),name:'確認した相手',clan:'伊達家'}};
    if(options.method==='POST'){
      const saved=receipts.get(options.data.requestId);if(saved)return structuredClone(saved);
      const action=route==='/trades'?'propose':route.split('/').at(-1);
      let value=records.find(item=>route.includes(item.id));
      if(action==='propose'){value=trade({sender:{playerId:user.id,name:user.name},recipient:{playerId:options.data.targetPlayerId,name:'確認した相手'},offer:options.data.offer,want:options.data.want,canAccept:false,canReject:false,canCancel:true});records.push(value);}
      else if(action==='accept')Object.assign(value,{status:'accepted',canAccept:false,canReject:false,delivery:{kind:'proceeds',recipientPlayerId:value.sender.playerId,assets:value.want,claimedAt:null}});
      else if(action==='cancel'||action==='reject')Object.assign(value,{status:action==='cancel'?'cancelled':'rejected',canAccept:false,canReject:false,canCancel:false,canClaim:action==='cancel',delivery:{kind:'refund',recipientPlayerId:value.sender.playerId,assets:value.offer,claimedAt:null}});
      else if(action==='claim'){value.delivery.claimedAt='2026-11-21T12:10:00Z';value.canClaim=false;}
      const result={ok:true,revision:8,trade:structuredClone(value),receipt:{tradeId:value.id,playerId:user.id,action,requestId:options.data.requestId}};receipts.set(options.data.requestId,result);return structuredClone(result);
    }
    if(url.pathname==='/trades'){
      const box=url.searchParams.get('box'),rows=records.filter(item=>box==='incoming'?item.recipient.playerId===user?.id:box==='outgoing'?item.sender.playerId===user?.id:box==='claimable'?item.delivery?.recipientPlayerId===user?.id&&!item.delivery.claimedAt:[item.sender.playerId,item.recipient.playerId].includes(user?.id));
      return{ok:true,trades:structuredClone(rows),nextCursor:null,summary:{incomingPending:1,outgoingPending:0,claimable:0},rules:{maxAmount:1000000,balanceLimit:999999999,maxPending:20}};
    }
    if(url.pathname==='/trades/'+ID)return{ok:true,trade:structuredClone(records.find(item=>item.id===ID))};
    throw Error('Unexpected local route: '+route);
  };
  const storageAPI={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const options={getUser:()=>user,getAccess:()=>({writable:canWrite,message:'別の端末を操作中です。'}),getAssets:()=>balances,storage:storageAPI,uuid:()=> 'request_'+(++serial),onChange:value=>changes.push(value),setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timers.delete(id),request:async(route,value)=>{calls.push({route,options:structuredClone(value)});return handler?handler(route,value,base):base(route,value);},mutate:(route,value)=>{calls.push({route,options:structuredClone(value)});return writeHandler?writeHandler(route,value,base):base(route,value);}};
  const controller=createController(options);
  return{controller,options,storage,storageAPI,balances,calls,changes,records,receipts,timers,base,setUser:value=>user=value,setWritable:value=>canWrite=value,setRead:fn=>handler=fn,setWrite:fn=>writeHandler=fn,posts:()=>calls.filter(call=>call.options.method==='POST')};
}

test('a proposal requires a verified recipient and an explicit immutable confirmation',async()=>{
  const h=setup(),before=structuredClone(h.balances);await h.controller.openCompose();
  h.controller.prepareCreate();assert.match(h.controller.getState().error,/交易先/);assert.equal(h.posts().length,0);
  await h.controller.selectRecipient(PEER);h.controller.setDraft('offerAsset','magatama');h.controller.setDraft('offerAmount','149');h.controller.setDraft('wantAsset','none');
  h.controller.prepareCreate();const confirm=h.controller.getState().confirm;
  assert.equal(confirm.target.playerId,PEER);assert.deepEqual(confirm.give,basket({magatama:149}));assert.deepEqual(confirm.receive,zero());assert.equal(h.posts().length,0);
  h.controller.setDraft('offerAmount','1');assert.equal(h.controller.getState().draft.offerAmount,'149','confirmation terms cannot be edited behind the review');
  assert(await h.controller.confirm());assert.equal(h.posts().length,1);assert.deepEqual(h.posts()[0].options.data.offer,basket({magatama:149}));assert.deepEqual(h.posts()[0].options.data.want,zero());
  assert.deepEqual(h.balances,before,'only the application bridge and server may settle balances');assert.equal(h.controller.getState().view,'outgoing');h.controller.dispose();
});
test('name search requires choosing a specific public ID and never chooses a duplicate name implicitly',async()=>{
  const h=setup();await h.controller.openCompose();h.controller.setQuery('同じ');await h.controller.searchRecipients();
  assert.equal(h.controller.getState().searchResults.length,2);assert.equal(h.controller.getState().target,null);
  h.controller.prepareCreate();assert.equal(h.controller.getState().confirm,null);
  await h.controller.selectRecipient('u_peer2');assert.equal(h.controller.getState().target.playerId,'u_peer2');assert(h.calls.some(call=>call.route==='/trades/recipient?playerId=u_peer2'));
  h.controller.setQuery('u_'+'a'.repeat(32));await h.controller.searchRecipients();assert.equal(h.controller.getState().target.playerId,'u_'+'a'.repeat(32));h.controller.dispose();
});
test('guests, followers, self targets, invalid integers, and insufficient assets cannot propose',async()=>{
  const h=setup();h.setUser(null);await h.controller.openBox();await h.controller.openCompose({playerId:PEER});assert.equal(h.calls.length,0);
  h.setUser({id:ME,name:'自分'});await h.controller.openCompose({playerId:ME});assert.equal(h.calls.length,0);assert.match(h.controller.getState().error,/自分以外/);
  await h.controller.selectRecipient(PEER);h.setWritable(false);h.controller.prepareCreate();assert.match(h.controller.getState().error,/別の端末/);
  h.setWritable(true);for(const quantity of ['0','-1','1.5','1000001','9007199254740992','6000']){h.controller.setDraft('offerAmount',quantity);h.controller.prepareCreate();assert.equal(h.controller.getState().confirm,null);}
  assert.equal(h.posts().length,0);h.controller.dispose();
});
test('accepting freshly reads the terms and confirms both directions before spending',async()=>{
  const h=setup(),before=structuredClone(h.balances);await h.controller.openBox();h.records[0].want.rice=321;
  await h.controller.prepareAction(ID,'accept');const confirm=h.controller.getState().confirm;
  assert.deepEqual(confirm.give,basket({rice:321}));assert.deepEqual(confirm.receive,basket({wood:150}));assert.equal(h.posts().length,0);
  assert(await h.controller.confirm());assert.equal(h.posts()[0].route,'/trades/'+ID+'/accept');assert.deepEqual(h.balances,before);h.controller.dispose();
});
test('stale capabilities and insufficient payment refuse acceptance without a mutation',async()=>{
  const h=setup();await h.controller.openBox();h.records[0].canAccept=false;await h.controller.prepareAction(ID,'accept');assert.equal(h.controller.getState().confirm,null);assert.match(h.controller.getState().error,/更新/);
  h.records[0].canAccept=true;h.records[0].want.rice=5001;await h.controller.prepareAction(ID,'accept');assert.equal(h.controller.getState().confirm,null);assert.match(h.controller.getState().error,/不足/);assert.equal(h.posts().length,0);h.controller.dispose();
});
test('cancel and reject review the original offer, while refunds remain explicitly claimable',async()=>{
  for(const action of ['cancel','reject']){
    const own=action==='cancel',h=setup({records:[trade({sender:{playerId:own?ME:PEER,name:'送信側'},recipient:{playerId:own?PEER:ME,name:'受信側'},canAccept:!own,canReject:!own,canCancel:own})]});
    await h.controller.openBox(own?'outgoing':'incoming');await h.controller.prepareAction(ID,action);
    assert.equal(h.posts().length,0);assert(confirmationMarkup(h.controller.getState().confirm).includes('申出の提供資産'));assert(await h.controller.confirm());
    assert.equal(h.posts().length,1);assert.equal(h.records[0].delivery.claimedAt,null,'refunds are never collected implicitly');h.controller.dispose();
  }
});
test('claiming enforces the exact balance boundary and never discards an overflowing delivery',async()=>{
  const delivery={kind:'proceeds',recipientPlayerId:ME,assets:basket({gold:50}),claimedAt:null};
  const h=setup({records:[trade({sender:{playerId:ME,name:'自分'},recipient:{playerId:PEER,name:'相手'},status:'accepted',delivery,canAccept:false,canReject:false,canClaim:true})]});h.balances.gold=999999950;
  await h.controller.openBox('history');await h.controller.prepareAction(ID,'claim');assert.equal(h.controller.getState().confirm,null);assert.match(h.controller.getState().error,/上限/);assert.equal(h.records[0].delivery.claimedAt,null);assert.equal(h.posts().length,0);
  const card=tradeCard(cleanTrade(h.records[0]),h.controller.getState());assert.match(card,/未受取の資産は保管/);assert.match(card,/data-kind="claim" disabled/);
  h.balances.gold=999999949;await h.controller.prepareAction(ID,'claim');assert.deepEqual(h.controller.getState().confirm.receive,basket({gold:50}));assert(await h.controller.confirm());assert.equal(h.posts().length,1);h.controller.dispose();
});
test('a storage failure sends no mutation and retains the review for another attempt',async()=>{
  const h=setup();await h.controller.openCompose({playerId:PEER});h.controller.prepareCreate();h.storageAPI.setItem=()=>{throw Error('storage unavailable');};
  assert.equal(await h.controller.confirm(),false);assert.equal(h.posts().length,0);assert(h.controller.getState().confirm);assert.match(h.controller.getState().error,/保存できません/);h.controller.dispose();
});
test('a lost reply persists the exact operation and a reload retries the same request once',async()=>{
  const h=setup({records:[]}),wait=deferred();await h.controller.openCompose({playerId:PEER});h.controller.prepareCreate();
  h.setWrite(async(route,options,base)=>{await base(route,options);return wait.promise;});const first=h.controller.confirm();await drain();assert.equal(await h.controller.confirm(),false);assert.equal(h.posts().length,1);
  wait.reject(Error('reply lost'));assert.equal(await first,false);const pending=h.controller.getState().pending;assert(pending);h.controller.dispose();
  const resumed=setup({storage:h.storage,records:h.records});resumed.setWrite((route,options)=>{assert.deepEqual(options.data,pending.data);return structuredClone(h.receipts.get(options.data.requestId));});
  await resumed.controller.openBox();assert.equal(resumed.controller.getState().pending.data.requestId,pending.data.requestId);assert(await resumed.controller.retry());assert.equal(resumed.posts().length,1);assert.equal(resumed.storage.size,0);resumed.controller.dispose();
});
test('bridge recovery can return an older request ID for the same verified trade terms',async()=>{
  const h=setup({records:[]});await h.controller.openCompose({playerId:PEER});h.controller.prepareCreate();
  h.setWrite(async(route,options,base)=>{const result=await base(route,options);result.receipt.requestId='older_bridge_request';return result;});
  assert(await h.controller.confirm());assert.equal(h.controller.getState().pending,null);assert.equal(h.storage.size,0);h.controller.dispose();
});
test('an unrelated successful response cannot clear a pending proposal',async()=>{
  const h=setup({records:[]});await h.controller.openCompose({playerId:PEER});h.controller.prepareCreate();
  h.setWrite(async(route,options,base)=>{const result=await base(route,options);result.trade.offer.gold++;return result;});
  assert.equal(await h.controller.confirm(),false);assert(h.controller.getState().pending);assert.match(h.controller.getState().error,/結果を確認/);h.controller.dispose();
});
test('a synchronous bridge failure remains recoverable and does not strand the busy guard',async()=>{
  const h=setup();await h.controller.openCompose({playerId:PEER});h.controller.prepareCreate();h.setWrite(()=>{throw Error('bridge unavailable');});
  assert.equal(await h.controller.confirm(),false);assert.equal(h.controller.getState().sending,false);h.setWrite(null);assert(await h.controller.retry());assert.equal(h.posts().length,2);h.controller.dispose();
});
test('an identity change ignores late recipient and transaction results without leaking the old ledger',async()=>{
  const h=setup(),search=deferred();h.setRead((route,options,base)=>route.startsWith('/trades/recipient')?search.promise:base(route,options));
  const choosing=h.controller.openCompose({playerId:PEER});h.setUser({id:'u_new',name:'別の領主'});h.controller.refreshIdentity();search.resolve({ok:true,player:{id:PEER,name:'旧宛先'}});await choosing;assert.equal(h.controller.getState().ownerId,'u_new');assert.equal(h.controller.getState().target,null);assert.equal(h.controller.getState().trades.length,0);h.controller.dispose();
  const old=setup({records:[]}),writing=deferred();await old.controller.openCompose({playerId:PEER});old.controller.prepareCreate();old.setWrite(()=>writing.promise);const operation=old.controller.confirm();await drain();
  const record=old.controller.getState().pending;old.setUser({id:'u_new',name:'別の領主'});old.controller.refreshIdentity();writing.resolve({ok:true,trade:trade(),receipt:{requestId:record.data.requestId,playerId:ME,tradeId:ID,action:'propose'}});assert.equal(await operation,false);assert.equal(old.controller.getState().pending,null);assert.equal(old.controller.getState().confirm,null);assert.equal(old.controller.getState().status,'');assert(old.storage.has('sengoku-trade-ui-pending-v1:'+ME));old.controller.dispose();
});
test('a synchronous identity change immediately after confirmation stops the queued mutation',async()=>{
  const h=setup();await h.controller.openCompose({playerId:PEER});h.controller.prepareCreate();const sending=h.controller.confirm();
  h.setUser({id:'u_new',name:'別の領主'});h.controller.refreshIdentity();assert.equal(await sending,false);assert.equal(h.posts().length,0,'the old terms never reach the bridge under the replacement identity');assert.equal(h.controller.getState().pending,null);h.controller.dispose();
});
test('pagination appends without duplicates and periodic refresh preserves loaded older pages',async()=>{
  const rows=Array.from({length:40},(_,i)=>trade({id:'tr_'+(i+1).toString(16).padStart(32,'0')}));
  const h=setup();h.setRead(route=>{const url=new URL(route,'https://local.invalid'),more=url.searchParams.has('cursor');return Promise.resolve({ok:true,trades:more?rows.slice(19):rows.slice(0,20),nextCursor:more?null:'older',summary:{incomingPending:40,outgoingPending:0,claimable:0}});});
  await h.controller.openBox();assert.equal(h.controller.getState().trades.length,20);await h.controller.loadMore();assert.equal(h.controller.getState().trades.length,40);await h.controller.refresh();assert.equal(h.controller.getState().trades.length,40);assert.equal(h.controller.getState().nextCursor,null);h.controller.dispose();
});
test('the dedicated collection tab finds older deliveries and removes externally claimed pages on refresh',async()=>{
  const rows=Array.from({length:42},(_,i)=>trade({id:'tr_'+(i+1).toString(16).padStart(32,'0'),sender:{playerId:ME,name:'自分'},recipient:{playerId:PEER,name:'相手'},status:'accepted',canAccept:false,canReject:false,canClaim:true,delivery:{kind:'proceeds',recipientPlayerId:ME,assets:basket({rice:10}),claimedAt:null}}));
  const h=setup();let stage=0;h.setRead(route=>{
    const url=new URL(route,'https://local.invalid');assert.equal(url.searchParams.get('box'),'claimable');
    const more=url.searchParams.has('cursor');return Promise.resolve({ok:true,trades:stage===1?[rows[41]]:more?rows.slice(20,40):rows.slice(0,20),nextCursor:stage===1?null:more?'page3':'page2',summary:{incomingPending:0,outgoingPending:0,claimable:stage===1?1:42}});
  });
  await h.controller.openBox('claimable');assert.equal(h.controller.getState().summary.claimable,42);await h.controller.loadMore();assert.equal(h.controller.getState().trades.length,40);
  stage=1;await h.controller.refresh();const state=h.controller.getState();assert.equal(state.trades.length,1);assert.equal(state.trades[0].id,rows[41].id,'the oldest unclaimed assets are available without paging through full history');assert.equal(state.nextCursor,null);assert.equal(state.summary.claimable,1);h.controller.dispose();
});
test('sync refresh preserves an unfinished compose form and selected recipient',async()=>{
  const h=setup();await h.controller.openCompose({playerId:PEER});h.controller.setDraft('offerAmount','149');h.controller.setDraft('wantAsset','stone');h.controller.setQuery('別の検索文字');
  const before=h.controller.getState();await h.controller.refresh();const after=h.controller.getState();assert.deepEqual(after.draft,before.draft);assert.deepEqual(after.target,before.target);assert.equal(after.query,before.query);assert.equal(h.posts().length,0);h.controller.dispose();
});
test('hostile names and invalid asset keys cannot become executable trade markup',async()=>{
  assert.equal(cleanTrade(trade({offer:{gold:1,unknown:5}})),null);assert.equal(cleanTrade(trade({want:{gold:1.2}})),null);
  const h=setup(),value=cleanTrade(trade({sender:{playerId:PEER,name:'<img src=x onerror="bad()">'}}));await h.controller.openBox();const html=tradeCard(value,h.controller.getState());
  assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert.equal(escape('<script>'), '&lt;script&gt;');h.controller.dispose();
});
test('social transport permits only trade endpoints and authenticated player-name reads',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8'),match=source.match(/function tradeRequest\(route,options=\{\}\)\{[\s\S]*?\n\}/);assert(match);
  const calls=[],context={s:{user:null},api:(route,options)=>{calls.push({route,options});return{ok:true};}};vm.createContext(context);vm.runInContext(match[0]+';globalThis.request=tradeRequest;',context);
  assert.throws(()=>context.request('/players?q=name'),/登録/);assert.equal(calls.length,0);context.s.user={id:ME};
  for(const route of ['/trades?box=incoming&limit=20','/trades/'+ID,'/trades/recipient?playerId='+PEER,'/players?q=name'])assert(context.request(route).ok);
  for(const route of ['/trades','/trades/'+ID+'/accept','/trades/'+ID+'/cancel','/trades/'+ID+'/reject','/trades/'+ID+'/claim'])assert(context.request(route,{method:'POST',data:{requestId:'a'}}).ok);
  for(const [route,method] of [['/players?q=name','POST'],['/players','GET'],['/trades/'+ID+'/accept','GET'],['/trades/recipient','POST'],['/mail/claim','POST'],['/trades','DELETE'],['https://other.invalid/trades','GET']])assert.throws(()=>context.request(route,{method}),/操作/);
  assert(calls.every(call=>call.options.background));context.s.user=null;assert.throws(()=>context.request('/trades'),/登録/);
});

(async()=>{for(const item of tests){await item.run();console.log('PASS '+item.name);}console.log(tests.length+' trade UI tests passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
