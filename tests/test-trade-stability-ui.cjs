'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const stable=require('../stable-dom.js'),{setup,Node}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(path.join(__dirname,'../trade.js'),'utf8'),ID='tr_'+'1'.repeat(32),copy=value=>JSON.parse(JSON.stringify(value));
const drain=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function fixture(){
 const {doc}=setup(),descriptor=Object.getOwnPropertyDescriptor(Node.prototype,'innerHTML');
 function decorate(node){if(node.classList)node.classList.toggle=(token,force)=>{const next=force??!node.classList.contains(token);node.classList[next?'add':'remove'](token);return next;};for(const child of node.childNodes||[])decorate(child);}
 Object.defineProperty(Node.prototype,'innerHTML',{...descriptor,set(value){descriptor.set.call(this,value);decorate(this.localName==='template'?this.content:this);}});
 const create=doc.createElement.bind(doc);doc.createElement=name=>{const node=create(name);decorate(node);if(name==='dialog'){node.showModal=()=>{node.open=true;};node.close=()=>{node.open=false;node.dispatchEvent({type:'close',bubbles:false});};}return node;};
 doc.contains=node=>doc.body.contains(node);doc.removeEventListener=()=>{};
 let user={id:'u_me',name:'自分'},onSync=()=>{},timer=0,gameReady=true,connectionChecks=0;const saved=new Map(),timers=new Map(),writes=[];
 const row={id:ID,revision:1,status:'pending',sender:{playerId:'u_peer',name:'輸出する領主'},recipient:{playerId:'u_me',name:'自分'},offer:{gold:0,rice:0,wood:150,stone:0,magatama:0},want:{gold:0,rice:200,wood:0,stone:0,magatama:0},createdAt:'2026-11-23T12:00:00Z',updatedAt:'2026-11-23T12:00:00Z',delivery:null,canAccept:true,canReject:true,canCancel:false,canClaim:false};
 const assets={gold:5000,rice:5000,wood:5000,stone:5000,magatama:1000,troops:1200000};
 const request=async route=>{const url=new URL(route,'https://local.invalid');if(url.pathname==='/trades')return{ok:true,trades:url.searchParams.get('box')==='incoming'?[copy(row)]:[],nextCursor:null,summary:{incomingPending:1,outgoingPending:0,claimable:0},rules:{maxAmount:1000000,balanceLimit:100000000,maxPending:20}};if(url.pathname==='/trades/recipient')return{ok:true,player:{playerId:'u_peer',name:'交易先の領主'}};if(url.pathname==='/trades/'+ID)return{ok:true,trade:copy(row)};throw Error('Unexpected isolated read '+route);};
 const window={document:doc,SengokuStableDOM:stable,SengokuSocial:{getUser:()=>user,tradeRequest:request,close:()=>{}},SengokuCloudSync:{getStatus:()=>({linked:true,ready:true,writable:true,message:''}),refresh:async()=>{connectionChecks++;gameReady=true;return{ok:true};},subscribe:callback=>{onSync=callback;return()=>{};}},SengokuBridge:{hasStarted:()=>true,canReceiveGifts:()=>gameReady,spendableAssets:()=>assets,troopTransportCapacity:()=>100000000,tradeRequest:(...args)=>{writes.push(args);throw Error('This render test never submits trades.');}},localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)},crypto:{randomUUID:()=> 'request_review'},setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(source,{window,console,URL});const api=window.SengokuTrade;
 return{doc,api,row,assets,window,writes,get connectionChecks(){return connectionChecks;},refresh:async()=>{onSync();await drain();},setGameReady:value=>{gameReady=value;},tickAccess:async()=>{const scheduled=[...timers].find(([,job])=>job.ms===1000);assert(scheduled,'open forms schedule a local access recheck');timers.delete(scheduled[0]);scheduled[1].fn();await drain();},setUser:value=>{user=value;},dispose:()=>{api.dispose();Object.defineProperty(Node.prototype,'innerHTML',descriptor);}};
}
(async()=>{
 const h=fixture();
 try{
  await h.api.openBox('incoming');
  const main=h.doc.querySelector('.trade-main'),card=h.doc.querySelector('[data-trade-row]'),accept=card.querySelector('[data-kind="accept"]');
  const artwork=h.doc.createElement('span');artwork.classList.add('item-icon');accept.append(artwork);accept.focus();main.scrollTop=280;h.row.sender.name='更新後の領主名';
  await h.refresh();assert.strictEqual(h.doc.querySelector('[data-trade-row]'),card);assert.strictEqual(card.querySelector('[data-kind="accept"]'),accept);assert.strictEqual(h.doc.activeElement,accept);assert(artwork.isConnected);assert.equal(main.scrollTop,280);assert.match(card.textContent,/更新後の領主名/);
  console.log('PASS background trade refresh retains row, focused action, artwork and scroll');
  await h.api.openCompose({playerId:'u_peer'});const input=h.doc.querySelector('#trade-offer-amount');input.value='137';input.dispatchEvent({type:'input'});input.focus();input.setSelectionRange(1,2);main.scrollTop=216;
  await h.refresh();assert.strictEqual(h.doc.querySelector('#trade-offer-amount'),input);assert.strictEqual(h.doc.activeElement,input);assert.equal(input.value,'137');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,2);assert.equal(main.scrollTop,216);
  h.doc.querySelector('[data-trade-form="compose"]').dispatchEvent({type:'submit'});const confirm=h.doc.querySelector('[data-trade="confirm"]');assert(h.api.getState().confirm);confirm.focus();main.scrollTop=100;await h.refresh();assert.strictEqual(h.doc.querySelector('[data-trade="confirm"]'),confirm);assert.strictEqual(h.doc.activeElement,confirm);assert.equal(main.scrollTop,100);
  h.setUser({id:'u_other',name:'次の領主'});await h.refresh();assert(!input.isConnected);assert(!confirm.isConnected);assert.equal(h.api.getState().ownerId,'u_other');
  console.log('PASS draft selection and confirmation survive refresh, and account changes reset prior controls');
  const own={id:'u_other',name:'次の領主'},known={id:'u_peer',name:'同名の領主'},online={id:'u_online',name:'同名の領主'};
  const social=h.window.SengokuSocial;
  social.getKnownPlayers=()=>[own,known];
  social.getOnlineCandidates=async()=>[own,online];
  const read=social.tradeRequest,seen=[];
  social.tradeRequest=async route=>{
   seen.push(route);
   if(route==='/players?q='+encodeURIComponent(known.name))return{ok:true,players:[own,known,online]};
   return read(route);
  };
  let picker;
  h.window.SengokuInputList={open:options=>{picker=options;}};
  await h.api.openCompose();
  const listButton=h.doc.querySelector('[data-trade="recipient-list"]');
  listButton.dispatchEvent({type:'click',bubbles:true});
  assert.equal(picker.trigger,listButton);assert(picker.valid());
  assert.deepEqual(copy(picker.options),[{value:known.id,label:known.name,detail:known.id}]);
  const signal=new AbortController().signal;
  assert.deepEqual(copy(await picker.load('',signal)).map(row=>row.value),[online.id]);
  assert.deepEqual(copy(await picker.load(known.name,signal)).map(row=>row.value),[known.id,online.id]);
  assert.equal(h.api.getState().target,null);
  picker.onSelect(picker.options[0]);await drain();
  assert.equal(h.api.getState().target.playerId,known.id);
  assert.deepEqual(seen,['/players?q='+encodeURIComponent(known.name),'/trades/recipient?playerId='+known.id]);
  assert.equal(h.api.getState().confirm,null);
  h.setUser({id:'u_next',name:'交代'});assert(!picker.valid());
  picker.onSelect(picker.options[0]);await drain();assert.equal(seen.length,2);
  console.log('PASS trade recipient list preserves distinct IDs, excludes self, verifies choices and rejects stale account selection');
  await h.api.openCompose({playerId:'u_peer'});h.setGameReady(false);await h.refresh();
  const review=h.doc.querySelector('[data-trade-prepare]'),offerAsset=h.doc.querySelector('#trade-offer-asset'),offerAmount=h.doc.querySelector('#trade-offer-amount'),wantAmount=h.doc.querySelector('#trade-want-amount');
  assert.equal(review.disabled,false,'temporary game readiness does not lock a non-mutating review');assert.match(h.doc.querySelector('[data-trade-prepare-status]').textContent,/条件の確認はできます/);
  offerAsset.value='troops';offerAmount.value='321';wantAmount.value='259';
  h.doc.querySelector('[data-trade-form="compose"]').dispatchEvent({type:'submit'});
  const checked=h.api.getState().confirm,send=h.doc.querySelector('[data-trade="confirm"]');assert.equal(checked.give.troops,321);assert.equal(checked.receive.rice,259);assert.equal(send.disabled,true);assert.match(h.doc.querySelector('[data-trade-confirm-access]').textContent,/共通時刻/);
  send.dispatchEvent({type:'click',bubbles:true});await drain();assert.equal(h.writes.length,0,'a disabled final action cannot send during catch-up');
  send.focus();main.scrollTop=180;h.setGameReady(true);await h.tickAccess();assert.strictEqual(h.doc.querySelector('[data-trade="confirm"]'),send);assert.equal(send.disabled,false);assert.strictEqual(h.doc.activeElement,send);assert.equal(main.scrollTop,180);assert.equal(h.connectionChecks,0,'automatic access rechecks do not make sync requests');
  h.setGameReady(false);await h.tickAccess();const reconnect=h.doc.querySelector('[data-trade-confirm] [data-trade="access-check"]');assert.equal(reconnect.hidden,false);reconnect.dispatchEvent({type:'click',bubbles:true});await drain();assert.equal(h.connectionChecks,1);assert.equal(send.disabled,false);assert.equal(h.writes.length,0);
  console.log('PASS temporary readiness cannot strand proposal review; actual visible values, final-send guards and local recovery remain intact');
  h.doc.querySelector('[data-trade="confirm-back"]').dispatchEvent({type:'click',bubbles:true});await h.api.openCompose();
  const query=h.doc.querySelector('#trade-recipient-query');query.value='名前だけ入力';query.dispatchEvent({type:'input'});
  assert.equal(h.doc.querySelector('[data-trade-prepare]').disabled,false);
  h.doc.querySelector('[data-trade-form="compose"]').dispatchEvent({type:'submit'});
  assert.equal(h.api.getState().confirm,null);assert.equal(h.api.getState().target,null);assert.match(h.doc.querySelector('[data-trade-prepare-status]').textContent,/領主名の入力だけでは宛先は確定しません/);assert.strictEqual(h.doc.activeElement,query);assert(query.scrollIntoViewCalls>0);assert.equal(h.writes.length,0);
  console.log('PASS a missing recipient has visible guidance beside review and focuses the chooser without guessing or sending');
  console.log('5 actual trade stability UI checks passed. No live requests.');
 }finally{h.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
