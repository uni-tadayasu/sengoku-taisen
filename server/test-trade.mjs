import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

// Actual Worker and all journal migrations, with one local SQLite transaction
// per D1 batch. No request or player data leaves this process.
const ASSETS=['gold','rice','wood','stone','magatama'];
const LIMIT=999999999;
const vector=value=>Object.fromEntries(ASSETS.map(key=>[key,value?.[key]||0]));
const balance=save=>({...save.state.resources,magatama:save.state.magatama});
const add=(...values)=>Object.fromEntries(ASSETS.map(key=>[key,values.reduce((sum,value)=>sum+(value?.[key]||0),0)]));
const negate=value=>Object.fromEntries(ASSETS.map(key=>[key,-(value?.[key]||0)]));
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const saved=(h,p)=>JSON.parse(row(h,p).save_json);
const revision=(h,p)=>Number(row(h,p).revision);
const tradeRow=(h,id)=>h.sql.prepare('SELECT * FROM trades WHERE id=?').get(id);
const deliveryRow=(h,id)=>h.sql.prepare('SELECT * FROM trade_deliveries WHERE trade_id=?').get(id);
const count=(h,table)=>Number(h.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n);
const tables=h=>Object.fromEntries(['trades','trade_requests','trade_deliveries'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all().map(value=>JSON.stringify(value)).sort()]));
const envelope=(h,p,extra={})=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:revision(h,p),...extra});
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const propose=(h,a,b,offer={gold:100},want={rice:50},extra={},expected=200)=>h.api('/trades',post(a,{targetPlayerId:b.user.id,offer,want,...envelope(h,a,extra)},expected));
const act=(h,p,id,action,extra={},expected=200)=>h.api('/trades/'+id+'/'+action,post(p,envelope(h,p,extra),expected));
const detail=async(h,p,id)=>(await h.api('/trades/'+id,{token:p.token})).data.trade;
const tradeBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO trade_requests'));

async function fixture(h,name,options={}){
  const p=await h.session(name,options.clan||'織田家');p.deviceId=p.user.id+'-writer';
  const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
  const save=h.fresh(),s=save.state;
  s.resources={gold:100000,rice:100000,wood:100000,stone:100000,...options.resources};s.magatama=options.magatama??100000;
  s.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};s.turn=Math.floor(lease.clock.elapsedMs/60000);s.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
  await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save}});
  return p;
}
function putSaved(h,p,save){h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(save),p.user.id);}
function setAssets(h,p,values){const save=saved(h,p);for(const [key,value]of Object.entries(values))if(key==='magatama')save.state.magatama=value;else save.state.resources[key]=value;putSaved(h,p,save);}
function barrier(h){
  let arrived=0,release;const gate=new Promise(resolve=>release=resolve);
  h.beforeBatch=async statements=>{if(!tradeBatch(statements))return;if(++arrived===2){h.beforeBatch=null;release();}await gate;};
}
function failNextCommit(h,hook){h.beforeBatch=statements=>{if(tradeBatch(statements)){h.beforeBatch=null;hook();}};}
function losesNextResponse(h){h.afterBatch=statements=>{if(tradeBatch(statements)){h.afterBatch=null;throw Error('local trade response loss');}};}
function assertSnapshot(result,p){
  assert.equal(result.ok,true);assert.equal(result.user.id,p.user.id);assert(result.save?.state);assert(Number.isSafeInteger(result.revision));assert(result.clock?.id);assert.equal(typeof result.idempotent,'boolean');
  assert(result.receipt?.id);assert.equal(result.receipt.playerId,p.user.id);assert.equal(result.receipt.tradeId,result.trade.id);
}
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;calls+=h.calls;console.log('PASS '+name);}finally{h.close();}}

await scope('five assets stay conserved through escrow, approval and one sender claim without touching the other save',async h=>{
  const a=await fixture(h,'輸出する領主'),b=await fixture(h,'輸入する領主');
  const offer={gold:101,rice:202,wood:303,stone:404,magatama:505},want={gold:51,rice:52,wood:53,stone:54,magatama:55};
  const beforeA=saved(h,a),beforeB=saved(h,b),bRow=row(h,b),total=add(balance(beforeA),balance(beforeB)),aRevision=revision(h,a);
  const created=(await propose(h,a,b,offer,want)).data;assertSnapshot(created,a);const id=created.trade.id;
  assert.equal(created.trade.status,'pending');assert.equal(created.trade.canCancel,true);assert.equal(created.revision,aRevision+1);
  assert.deepEqual(created.trade.offer,offer);assert.deepEqual(created.trade.want,want);assert.deepEqual(balance(created.save),add(balance(beforeA),negate(offer)));
  assert.deepEqual(row(h,b),bRow,'Escrow does not rewrite the recipient save or lease');
  assert.equal(created.save.state.command,beforeA.state.command);assert.equal(deliveryRow(h,id),undefined);
  const received=await detail(h,b,id);assert(received.canAccept&&received.canReject);assert.equal(received.canClaim,false);
  const senderAtAccept=row(h,a),accepted=(await act(h,b,id,'accept')).data;assertSnapshot(accepted,b);
  assert.equal(accepted.trade.status,'accepted');assert.equal(accepted.revision,Number(bRow.revision)+1);assert.deepEqual(balance(accepted.save),add(balance(beforeB),negate(want),offer));
  assert.equal(accepted.save.state.command,beforeB.state.command);assert.deepEqual(row(h,a),senderAtAccept,'Approval cannot discard online sender actions or extend its lease');
  const waiting=await detail(h,a,id);assert.equal(waiting.delivery.kind,'proceeds');assert.equal(waiting.delivery.recipientPlayerId,a.user.id);assert.deepEqual(waiting.delivery.assets,want);assert.equal(waiting.delivery.claimedAt,null);assert.equal(waiting.canClaim,true);
  assert.deepEqual(add(balance(saved(h,a)),balance(saved(h,b)),waiting.delivery.assets),total);
  const recipientAtClaim=row(h,b),claimed=(await act(h,a,id,'claim')).data;assertSnapshot(claimed,a);
  assert.equal(claimed.revision,aRevision+2);assert(claimed.trade.delivery.claimedAt);assert.equal(claimed.trade.canClaim,false);
  assert.deepEqual(add(balance(saved(h,a)),balance(saved(h,b))),total);assert.deepEqual(row(h,b),recipientAtClaim);
  assert.equal(count(h,'trade_requests'),3);assert.equal(count(h,'trade_deliveries'),1);
});

await scope('authentication, private reads, exact recipient and participant action rights are enforced',async h=>{
  const a=await fixture(h,'権限送信'),b=await fixture(h,'権限受信'),other=await fixture(h,'第三者'),empty=await h.session('本拠未保存');
  for(const route of ['/trades','/trades/recipient?playerId='+b.user.id])await h.api(route,{expected:401});
  await h.api('/trades',{method:'POST',body:{},expected:401});
  const recipient=(await h.api('/trades/recipient?playerId='+b.user.id,{token:a.token})).data;assert.equal(recipient.user?.id||recipient.recipient?.id||recipient.player?.id,b.user.id);
  await h.api('/trades/recipient?playerId='+empty.user.id,{token:a.token,expected:404});
  await propose(h,a,a,{gold:1},{}, {},400);await propose(h,a,{user:{id:'missing-player'}},{gold:1},{},{},404);
  const id=(await propose(h,a,b)).data.trade.id;
  await h.api('/trades/'+id,{token:other.token,expected:404});
  const baseline=tables(h),aRow=row(h,a),bRow=row(h,b);
  for(const action of ['accept','cancel','reject','claim'])await act(h,other,id,action,{},404);
  for(const [p,action]of [[a,'accept'],[a,'reject'],[b,'cancel'],[b,'claim']])await act(h,p,id,action,{},403);
  assert.deepEqual(tables(h),baseline);assert.deepEqual(row(h,a),aRow);assert.deepEqual(row(h,b),bRow);
  const list=(await h.api('/trades?box=history',{token:other.token})).data;assert.deepEqual(list.trades,[]);
  const visible=JSON.stringify((await h.api('/trades?box=incoming',{token:b.token})).data);
  for(const forbidden of ['save_json','request_hash','commit_token','token_hash','writer_device_id'])assert(!visible.includes(forbidden));
});

await scope('asset vectors and mutation envelopes reject malformed, excessive and forged values atomically',async h=>{
  const a=await fixture(h,'検証送信'),b=await fixture(h,'検証受信'),before=row(h,a);
  const invalid=[{offer:{}},{offer:{gold:0}},{offer:{gold:-1}},{offer:{gold:1.5}},{offer:{gold:'1'}},{offer:{gold:1000001}},{offer:{gold:Number.MAX_SAFE_INTEGER+1}},{offer:{civilians:1}},{offer:[]},{offer:null},{want:{gold:-1}},{want:{unknown:1}},{senderId:b.user.id},{requestId:null},{deviceId:null},{expectedRevision:-1}];
  for(const extra of invalid){h.resetRates();await h.api('/trades',post(a,{targetPlayerId:b.user.id,offer:{gold:1},want:{},...envelope(h,a),...extra},400));}
  assert.deepEqual(row(h,a),before);assert.equal(count(h,'trades'),0);assert.equal(count(h,'trade_requests'),0);
  await propose(h,a,b,{gold:1000000},{},{},409);assert.deepEqual(row(h,a),before);
  setAssets(h,a,{gold:1000000});const valid=(await propose(h,a,b,{gold:1000000},{})).data;assert.equal(valid.save.state.resources.gold,0);assert.deepEqual(valid.trade.offer,vector({gold:1000000}));
  const accepted=(await act(h,b,valid.trade.id,'accept')).data;assert.equal(accepted.trade.delivery,null);assert.equal((await detail(h,a,valid.trade.id)).canClaim,false);assert.equal(count(h,'trade_deliveries'),0,'Free exports need no empty claim');
});

await scope('cancel and reject retain full refunds in the sender ledger until explicit receipt',async h=>{
  const a=await fixture(h,'返金送信'),b=await fixture(h,'返金受信');
  for(const action of ['cancel','reject']){
    const start=balance(saved(h,a)),id=(await propose(h,a,b,{gold:120,magatama:30},{rice:50})).data.trade.id;
    const aRow=row(h,a),bRow=row(h,b),result=(await act(h,action==='cancel'?a:b,id,action)).data;
    assert.equal(result.trade.status,action==='cancel'?'cancelled':'rejected');assert.deepEqual(row(h,a),aRow);assert.deepEqual(row(h,b),bRow);
    const trade=await detail(h,a,id);assert.equal(trade.delivery.kind,'refund');assert.deepEqual(trade.delivery.assets,vector({gold:120,magatama:30}));assert(trade.canClaim);
    await act(h,b,id,'accept',{},409);const claim=(await act(h,a,id,'claim')).data;assert.deepEqual(balance(claim.save),start);
    const before=row(h,a);await act(h,a,id,'claim',{},409);assert.deepEqual(row(h,a),before);
  }
});

await scope('affordability and balance caps never clip assets or consume a still-pending offer or delivery',async h=>{
  const a=await fixture(h,'上限送信'),b=await fixture(h,'上限受信');
  let id=(await propose(h,a,b,{gold:50},{rice:100001})).data.trade.id,baseline=tables(h),aRow=row(h,a),bRow=row(h,b);
  assert.equal((await act(h,b,id,'accept',{},409)).data.error.code,'INSUFFICIENT_ASSETS');assert.deepEqual(tables(h),baseline);assert.deepEqual(row(h,a),aRow);assert.deepEqual(row(h,b),bRow);
  id=(await propose(h,a,b,{gold:1},{rice:50})).data.trade.id;setAssets(h,b,{gold:LIMIT});baseline=tables(h);bRow=row(h,b);
  assert.equal((await act(h,b,id,'accept',{},409)).data.error.code,'ASSET_LIMIT');assert.equal(tradeRow(h,id).status,'pending');assert.deepEqual(tables(h),baseline);assert.deepEqual(row(h,b),bRow);
  setAssets(h,b,{gold:LIMIT-1});await act(h,b,id,'accept');setAssets(h,a,{rice:LIMIT});const pending=await detail(h,a,id);baseline=tables(h);aRow=row(h,a);
  assert.equal((await act(h,a,id,'claim',{},409)).data.error.code,'ASSET_LIMIT');assert.deepEqual(row(h,a),aRow);assert.deepEqual(tables(h),baseline);assert.equal((await detail(h,a,id)).delivery.claimedAt,null);assert.deepEqual((await detail(h,a,id)).delivery.assets,pending.delivery.assets);
  setAssets(h,a,{rice:LIMIT-50});await act(h,a,id,'claim');assert.equal(saved(h,a).state.resources.rice,LIMIT);
  // Matching resources are a net exchange: being at the cap cannot reject a
  // valid payment which makes room for exactly the received quantity.
  setAssets(h,b,{gold:LIMIT});id=(await propose(h,a,b,{gold:7},{gold:7})).data.trade.id;await act(h,b,id,'accept');assert.equal(saved(h,b).state.resources.gold,LIMIT);
  // A cancellation can always preserve a refund even when a new inflow has
  // filled the sender's wallet; receiving waits until there is room.
  id=(await propose(h,a,b,{stone:20},{})).data.trade.id;setAssets(h,a,{stone:LIMIT});await act(h,a,id,'cancel');await act(h,a,id,'claim',{},409);assert.equal(deliveryRow(h,id).claimed_at,null);setAssets(h,a,{stone:LIMIT-20});await act(h,a,id,'claim');assert.equal(saved(h,a).state.resources.stone,LIMIT);
});

await scope('parallel duplicate proposal, approval and claim apply once and replay with a replacement device',async h=>{
  const a=await fixture(h,'重複送信'),b=await fixture(h,'重複受信'),body={targetPlayerId:b.user.id,offer:{gold:123},want:{rice:77},...envelope(h,a)};
  const before=revision(h,a);barrier(h);const twins=await Promise.all([h.api('/trades',post(a,body)),h.api('/trades',post(a,body))]);
  assert.deepEqual(twins.map(value=>value.data.idempotent).sort(),[false,true]);assert.equal(twins[0].data.trade.id,twins[1].data.trade.id);assert.equal(revision(h,a),before+1);assert.equal(count(h,'trades'),1);
  const id=twins[0].data.trade.id;
  for(const [p,action]of [[b,'accept'],[a,'claim']]){
    const request=envelope(h,p),prior=revision(h,p);barrier(h);
    const results=await Promise.all([act(h,p,id,action,request),act(h,p,id,action,request)]);assert.deepEqual(results.map(value=>value.data.idempotent).sort(),[false,true]);assert.equal(results[0].data.receipt.id,results[1].data.receipt.id);assert.equal(revision(h,p),prior+1);
    const replay=(await act(h,p,id,action,{...request,deviceId:'new-device',expectedRevision:0})).data;assert(replay.idempotent);assert.equal(replay.receipt.id,results[0].data.receipt.id);assert.equal(replay.writable,false);assert.equal(revision(h,p),prior+1);
  }
  const replay=(await h.api('/trades',post(a,{...body,deviceId:'new-device',expectedRevision:0}))).data;assert(replay.idempotent);assert.equal(replay.trade.status,'accepted');
  for(const changed of [{offer:{gold:124}},{want:{rice:78}},{targetPlayerId:a.user.id}])assert.equal((await h.api('/trades',post(a,{...body,...changed},409))).data.error.code,'REQUEST_ID_REUSED');
  assert.equal(count(h,'trade_requests'),3);assert.equal(count(h,'trade_deliveries'),1);
});

await scope('accept versus cancel or reject has one winner and preserves exactly one settlement',async h=>{
  const a=await fixture(h,'競合送信'),b=await fixture(h,'競合受信');
  for(const competing of ['cancel','reject']){
    h.resetRates();const total=add(balance(saved(h,a)),balance(saved(h,b))),id=(await propose(h,a,b,{gold:333},{rice:111})).data.trade.id;
    const acceptBody=envelope(h,b),other=competing==='cancel'?a:b,otherBody=envelope(h,other);barrier(h);
    const results=await Promise.all([act(h,b,id,'accept',acceptBody,null),act(h,other,id,competing,otherBody,null)]);
    assert.deepEqual(results.map(result=>result.response.status).sort(),[200,409]);const trade=await detail(h,a,id);
    assert(['accepted',competing==='cancel'?'cancelled':'rejected'].includes(trade.status));assert.equal(trade.delivery.kind,trade.status==='accepted'?'proceeds':'refund');
    assert.deepEqual(add(balance(saved(h,a)),balance(saved(h,b)),trade.delivery.assets),total);
    await act(h,a,id,'claim');assert.deepEqual(add(balance(saved(h,a)),balance(saved(h,b))),total);
    await act(h,b,id,'accept',{},409);await act(h,a,id,'cancel',{},409);
  }
});

await scope('different offers cannot double-spend the same writer revision or final balance',async h=>{
  const a=await fixture(h,'同時輸出',{resources:{gold:100}}),b=await fixture(h,'同時輸入一'),c=await fixture(h,'同時輸入二'),rev=revision(h,a);
  barrier(h);const results=await Promise.all([propose(h,a,b,{gold:100},{},{expectedRevision:rev},null),propose(h,a,c,{gold:100},{},{expectedRevision:rev},null)]);
  assert.deepEqual(results.map(result=>result.response.status).sort(),[200,409]);assert.equal(saved(h,a).state.resources.gold,0);assert.equal(revision(h,a),rev+1);assert.equal(count(h,'trades'),1);assert.equal(count(h,'trade_requests'),1);
});

await scope('rollback includes offer, payer save, delivery and receipt at every monetary stage',async h=>{
  const a=await fixture(h,'原子送信'),b=await fixture(h,'原子受信');
  let baseline=tables(h),aRow=row(h,a),bRow=row(h,b);
  h.sql.exec("CREATE TEMP TRIGGER reject_trade_save BEFORE UPDATE ON player_saves BEGIN SELECT RAISE(ABORT,'local trade save failure'); END");
  await propose(h,a,b,{gold:30},{rice:20},{},500);h.sql.exec('DROP TRIGGER reject_trade_save');
  assert.deepEqual(tables(h),baseline);assert.deepEqual(row(h,a),aRow);assert.deepEqual(row(h,b),bRow);
  const id=(await propose(h,a,b,{gold:30},{rice:20})).data.trade.id;baseline=tables(h);aRow=row(h,a);bRow=row(h,b);
  h.sql.exec("CREATE TEMP TRIGGER reject_trade_delivery BEFORE INSERT ON trade_deliveries BEGIN SELECT RAISE(ABORT,'local trade delivery failure'); END");
  await act(h,b,id,'accept',{},500);h.sql.exec('DROP TRIGGER reject_trade_delivery');
  assert.deepEqual(tables(h),baseline);assert.deepEqual(row(h,a),aRow);assert.deepEqual(row(h,b),bRow);
  await act(h,b,id,'accept');baseline=tables(h);aRow=row(h,a);bRow=row(h,b);
  h.sql.exec("CREATE TEMP TRIGGER reject_trade_claim BEFORE UPDATE ON trade_deliveries BEGIN SELECT RAISE(ABORT,'local trade claim failure'); END");
  await act(h,a,id,'claim',{},500);h.sql.exec('DROP TRIGGER reject_trade_claim');
  assert.deepEqual(tables(h),baseline);assert.deepEqual(row(h,a),aRow);assert.deepEqual(row(h,b),bRow);await act(h,a,id,'claim');
});

await scope('response loss after commit recovers all three monetary actions without repeat debits or credits',async h=>{
  const a=await fixture(h,'切断送信'),b=await fixture(h,'切断受信'),body={targetPlayerId:b.user.id,offer:{gold:70},want:{rice:40},...envelope(h,a)},before=revision(h,a);
  losesNextResponse(h);await h.api('/trades',post(a,body,500));assert.equal(revision(h,a),before+1);
  let result=(await h.api('/trades',post(a,{...body,deviceId:'replacement',expectedRevision:0}))).data;assert(result.idempotent);const id=result.trade.id;
  for(const [p,action]of [[b,'accept'],[a,'claim']]){
    const request=envelope(h,p),rev=revision(h,p);losesNextResponse(h);await act(h,p,id,action,request,500);assert.equal(revision(h,p),rev+1);
    result=(await act(h,p,id,action,{...request,deviceId:'replacement',expectedRevision:0})).data;assert(result.idempotent);assert.equal(revision(h,p),rev+1);
  }
  assert.equal(count(h,'trade_requests'),3);assert.equal(saved(h,a).state.resources.gold,99930);assert.equal(saved(h,a).state.resources.rice,100040);assert.equal(saved(h,b).state.resources.gold,100070);assert.equal(saved(h,b).state.resources.rice,99960);
});

await scope('writer lease, save revision, role and clock changes are checked at the atomic commit',async h=>{
  const a=await fixture(h,'確定直前送信'),b=await fixture(h,'確定直前受信');
  for(const kind of ['revision','lease','role','clock']){
    const id=(await propose(h,a,b,{gold:10},{rice:5})).data.trade.id,request=envelope(h,b),baseline=tables(h),beforeBalance=balance(saved(h,b));
    failNextCommit(h,()=>{
      if(kind==='revision')h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(b.user.id);
      if(kind==='lease')h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run('replacement-writer',b.user.id);
      if(kind==='role')h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at) VALUES(?,?,?)').run(b.user.id,a.user.id,h.now);
      if(kind==='clock')h.sql.exec('UPDATE world_clock SET revision=revision+1');
    });
    const result=await act(h,b,id,'accept',request,409);assert(['REVISION_CONFLICT','LEASE_REQUIRED','AUTHORITY_CHANGED','WORLD_CLOCK_CHANGED','TRADE_CHANGED'].includes(result.data.error.code),result.data.error.code);
    assert.deepEqual(tables(h),baseline);assert.deepEqual(balance(saved(h,b)),beforeBalance);assert.equal(tradeRow(h,id).status,'pending');
    if(kind==='role')h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(b.user.id);
    if(kind==='lease')h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run(b.deviceId,b.user.id);
  }
  const before=tables(h),aRow=row(h,a);await propose(h,a,b,{gold:1},{},{deviceId:'follower'},409);await propose(h,a,b,{gold:1},{},{expectedRevision:0},409);assert.deepEqual(tables(h),before);assert.deepEqual(row(h,a),aRow);
  h.now+=15001;const stale=(await propose(h,a,b,{gold:1},{},{},409)).data;assert.equal(stale.error.code,'CLOCK_STALE');assert.deepEqual(tables(h),before);
});

await scope('offline sender and queued gameplay are untouched until its own explicit synced claim',async h=>{
  const a=await fixture(h,'未保存送信'),b=await fixture(h,'未保存受信'),created=(await propose(h,a,b,{wood:50},{stone:25})).data,id=created.trade.id;
  const queued=saved(h,a);queued.state.buildings.farm+=1;queued.state.resources.gold-=123;const senderRevision=revision(h,a),senderRow=row(h,a);
  await act(h,b,id,'accept');assert.deepEqual(row(h,a),senderRow,'An accepted offer cannot overwrite the sender with queued gameplay');
  await h.api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:senderRevision,save:queued}});
  const claim=(await act(h,a,id,'claim')).data;assert.equal(claim.save.state.buildings.farm,queued.state.buildings.farm);assert.equal(claim.save.state.resources.gold,queued.state.resources.gold);assert.equal(claim.save.state.resources.stone,queued.state.resources.stone+25);
  // The old pre-claim save can no longer overwrite received assets.
  const oldRevision=claim.revision-1;const rejected=(await h.api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:oldRevision,save:queued},expected:409})).data;assert.equal(rejected.error.code,'REVISION_CONFLICT');
  const second=(await propose(h,a,b,{wood:10},{stone:5})).data.trade.id;
  await h.api('/sync/release',post(a,{deviceId:a.deviceId}));const offlineRow=row(h,a);await act(h,b,second,'accept');assert.deepEqual(row(h,a),offlineRow);
  const linked=(await h.api('/devices/pair-code',post(a,{}))).data;
  const remote=(await h.api('/devices/link',{method:'POST',body:{code:linked.code,deviceName:'交易別端末'}})).data;remote.deviceId='new-linked-trade-writer';
  await h.api('/sync/lease',post(remote,{deviceId:remote.deviceId}));await act(h,remote,second,'claim');assert.equal((await detail(h,a,second)).canClaim,false);
});

await scope('pending limits, private pagination and summaries remain accurate after cancellation',async h=>{
  const a=await fixture(h,'一覧送信'),b=await fixture(h,'一覧受信'),ids=[];
  for(let i=0;i<20;i++)ids.push((await propose(h,a,b,{gold:1},{})).data.trade.id);
  const before=row(h,a);assert.equal((await propose(h,a,b,{gold:1},{},{},409)).data.error.code,'TRADE_PENDING_LIMIT');assert.deepEqual(row(h,a),before);assert.equal(count(h,'trades'),20);
  let cursor='',seen=[];do{const page=(await h.api('/trades?box=incoming&limit=7'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{token:b.token})).data;assert.equal(page.summary.incomingPending,20);assert.equal(page.summary.outgoingPending,0);assert.equal(page.rules.maxPending,20);assert.equal(page.rules.balanceLimit,LIMIT);assert.equal(page.rules.maxAmount,1000000);assert.deepEqual([...page.rules.assets].sort(),[...ASSETS,'troops'].sort());assert.equal(page.rules.troopBalanceLimit,1000000);seen.push(...page.trades.map(t=>t.id));cursor=page.nextCursor;}while(cursor);
  assert.deepEqual([...new Set(seen)].sort(),ids.sort());assert.equal(seen.length,20);
  for(const suffix of ['limit=0','limit=51','limit=1.5','box=everyone','cursor=bad'])await h.api('/trades?'+suffix,{token:a.token,expected:400});
  await act(h,a,ids[0],'cancel');const summary=(await h.api('/trades?box=outgoing',{token:a.token})).data.summary;assert.equal(summary.outgoingPending,19);assert.equal(summary.claimable,1);await propose(h,a,b,{gold:1},{});
});

await scope('claimable finds old proceeds and refunds behind busy history, stays private and reflects another device claim',async h=>{
  const a=await fixture(h,'受取一覧送信'),b=await fixture(h,'受取一覧相手'),other=await fixture(h,'別領主の受取');
  const proceeds=(await propose(h,a,b,{wood:5},{stone:7})).data.trade.id;await act(h,b,proceeds,'accept');
  const refund=(await propose(h,a,b,{gold:11},{})).data.trade.id;await act(h,a,refund,'cancel');
  const claimed=(await propose(h,a,b,{rice:13},{})).data.trade.id;await act(h,b,claimed,'reject');await act(h,a,claimed,'claim');
  const pending=(await propose(h,a,b,{stone:17},{})).data.trade.id;
  const privateDelivery=(await propose(h,other,b,{gold:19},{rice:23})).data.trade.id;await act(h,b,privateDelivery,'accept');
  // New free exports create ordinary history with no sender delivery. Both
  // unclaimed deliveries are older than every row in history's first page.
  for(let i=0;i<21;i++){
    h.now++;h.resetRates();const id=(await propose(h,a,b,{gold:1},{})).data.trade.id;await act(h,b,id,'accept');
  }
  h.resetRates();
  const history=(await h.api('/trades?box=history&limit=20',{token:a.token})).data;
  assert.equal(history.trades.length,20);assert(history.nextCursor);assert.equal(history.summary.claimable,2);
  assert(!history.trades.some(trade=>[proceeds,refund].includes(trade.id)),'Old unclaimed deliveries really are outside the first history page');
  await h.api('/trades?box=claimable',{expected:401});
  const first=(await h.api('/trades?box=claimable&limit=1',{token:a.token})).data;
  assert.equal(first.trades.length,1);assert(first.nextCursor);assert.equal(first.summary.claimable,2);assert.equal(first.summary.outgoingPending,1);assert.equal(first.rules.balanceLimit,LIMIT);
  const second=(await h.api('/trades?box=claimable&limit=1&cursor='+encodeURIComponent(first.nextCursor),{token:a.token})).data;
  assert.equal(second.trades.length,1);assert.equal(second.nextCursor,null);
  const deliveries=[...first.trades,...second.trades];
  assert.deepEqual(deliveries.map(trade=>trade.id),[proceeds,refund].sort().reverse(),'Equal creation times use the stable descending ID tie-break');
  assert.deepEqual(deliveries.map(trade=>trade.delivery.kind).sort(),['proceeds','refund']);
  for(const trade of deliveries){assert(trade.canClaim);assert.equal(trade.delivery.recipientPlayerId,a.user.id);assert.equal(trade.delivery.claimedAt,null);}
  assert(!deliveries.some(trade=>[claimed,pending,privateDelivery].includes(trade.id)));
  const recipientList=(await h.api('/trades?box=claimable',{token:b.token})).data;
  assert.deepEqual(recipientList.trades,[]);assert.equal(recipientList.summary.claimable,0);
  const otherList=(await h.api('/trades?box=claimable',{token:other.token})).data;
  assert.deepEqual(otherList.trades.map(trade=>trade.id),[privateDelivery]);assert.equal(otherList.summary.claimable,1);
  for(const box of ['incoming','outgoing','history']){
    const wrong=(await h.api('/trades?box='+box+'&cursor='+encodeURIComponent(first.nextCursor),{token:a.token,expected:400})).data;
    assert.equal(wrong.error.code,'INVALID_CURSOR');
  }
  const wrongHistory=(await h.api('/trades?box=claimable&cursor='+encodeURIComponent(history.nextCursor),{token:a.token,expected:400})).data;
  assert.equal(wrongHistory.error.code,'INVALID_CURSOR');
  const pair=(await h.api('/devices/pair-code',post(a,{}))).data;
  const remote=(await h.api('/devices/link',{method:'POST',body:{code:pair.code,deviceName:'受取一覧の別端末'}})).data;remote.deviceId='claimable-linked-writer';
  await h.api('/sync/lease',post(remote,{deviceId:remote.deviceId,takeOver:true}));
  const firstId=first.trades[0].id,secondId=second.trades[0].id;await act(h,remote,firstId,'claim');
  const refreshed=(await h.api('/trades?box=claimable',{token:a.token})).data;
  assert.deepEqual(refreshed.trades.map(trade=>trade.id),[secondId]);assert.equal(refreshed.summary.claimable,1);
  const continued=(await h.api('/trades?box=claimable&limit=1&cursor='+encodeURIComponent(first.nextCursor),{token:a.token})).data;
  assert.deepEqual(continued.trades.map(trade=>trade.id),[secondId],'A consumed cursor row does not skip the remaining delivery');
  await act(h,remote,secondId,'claim');
  const empty=(await h.api('/trades?box=claimable',{token:a.token})).data;
  assert.deepEqual(empty.trades,[]);assert.equal(empty.nextCursor,null);assert.equal(empty.summary.claimable,0);
  assert.equal((await detail(h,a,firstId)).delivery.claimedAt!==null,true);
  assert.equal((await detail(h,a,secondId)).delivery.claimedAt!==null,true);
});

await scope('personally owned deliveries survive guild departure, campaign restart and calendar settlement',async h=>{
  const a=await fixture(h,'継続送信'),b=await fixture(h,'継続受信');
  const guild=(await h.api('/guild',post(a,{name:'交易引継試験'}))).data.guild;await h.api('/guild/join',post(b,{guildId:guild.id}));
  const id=(await propose(h,a,b,{magatama:25},{gold:37})).data.trade.id;await act(h,b,id,'accept');await h.api('/guild/leave',post(a,{guildId:guild.id}));
  const current=(await h.api('/sync',{token:a.token})).data,restarted=h.fresh();restarted.state.worldClock=current.save.state.worldClock;restarted.state.turn=current.save.state.turn;restarted.state.realtime.elapsed=current.save.state.realtime.elapsed;
  restarted.state.walking={...current.save.state.walking,campaignId:'restarted-trade-campaign'};
  await h.api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:current.revision,save:restarted}});
  assert.equal((await detail(h,a,id)).canClaim,true);assert.equal(deliveryRow(h,id).claimed_at,null);
  h.now+=40320001;
  let resumed=(await h.api('/sync/lease',post(a,{deviceId:a.deviceId,takeOver:true}))).data;
  resumed=(await h.api('/sync/settle',post(a,{deviceId:a.deviceId,revision:resumed.revision}))).data;
  const aligned=resumed.save;aligned.state.worldClock={id:resumed.clock.id,elapsedMs:resumed.clock.elapsedMs};aligned.state.turn=Math.floor(resumed.clock.elapsedMs/60000);aligned.state.realtime.elapsed=resumed.clock.elapsedMs%60000/1000;
  await h.api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:resumed.revision,save:aligned}});
  const prior=saved(h,a).state.resources.gold;const claim=(await act(h,a,id,'claim')).data;assert.equal(claim.save.state.resources.gold,prior+37);assert.equal(claim.trade.delivery.claimedAt!==null,true);
  await act(h,a,id,'claim',{},409);
});

console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0,coverage:['escrow and all five assets','no remote-save writes','idempotency and replay across linked devices','accept/cancel/reject races','affordability and caps without clipping','transaction rollback and lost responses','commit-time writer, role and clock guards','private pagination and bounded proposals','old unclaimed delivery discovery and linked-device receipt','guild/campaign/cycle continuity']},null,2));
