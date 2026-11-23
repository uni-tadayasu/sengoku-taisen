import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

// Actual Worker routes and transactional SQLite, entirely local. Include the
// escrow and delivery ledgers in conservation checks; no soldier is clipped.
const ASSETS=['gold','rice','wood','stone','magatama','troops'];
const STOCK_CAP=100000000;
const LEGACY=ASSETS.filter(key=>key!=='troops');
const vector=(value={},keys=ASSETS)=>Object.fromEntries(keys.map(key=>[key,value[key]??0]));
const balances=save=>vector({...save.state.resources,magatama:save.state.magatama,troops:save.state.troops});
const add=(...values)=>Object.fromEntries(ASSETS.map(key=>[key,values.reduce((sum,value)=>sum+(value[key]??0),0)]));
const subtract=(value,paid)=>Object.fromEntries(ASSETS.map(key=>[key,(value[key]??0)-(paid[key]??0)]));
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const saved=(h,p)=>JSON.parse(row(h,p).save_json);
const cap=(h,p)=>GameEngine.fromSave(saved(h,p),GAME_OFFICERS).availableTroopCapacity();
const escrow=(h,id)=>h.sql.prepare('SELECT * FROM trades WHERE id=?').get(id);
const delivery=(h,id)=>h.sql.prepare('SELECT * FROM trade_deliveries WHERE trade_id=?').get(id);
const tables=h=>Object.fromEntries(['trades','trade_requests','trade_deliveries'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all().map(value=>JSON.stringify(value)).sort()]));
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const envelope=(h,p,extra={})=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:Number(row(h,p).revision),...extra});
const propose=(h,a,b,offer,want={},extra={},expected=200)=>h.api('/trades',post(a,{targetPlayerId:b.user.id,offer,want,...envelope(h,a,extra)},expected));
const act=(h,p,id,action,extra={},expected=200)=>h.api('/trades/'+id+'/'+action,post(p,envelope(h,p,extra),expected));
const tradeBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO trade_requests'));
function change(h,p,edit){const save=saved(h,p);edit(save.state);h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(save),p.user.id);}
function barrier(h){let arrived=0,release;const gate=new Promise(resolve=>release=resolve);h.beforeBatch=async statements=>{if(!tradeBatch(statements))return;if(++arrived===2){h.beforeBatch=null;release();}await gate;};}
async function fixture(h,name,troops=2000){
  const p=await h.session(name);p.deviceId=p.user.id+'-writer';
  const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,save=h.fresh(),s=save.state;
  s.troops=troops;s.resources={gold:100000,rice:100000,wood:100000,stone:100000};s.magatama=100000;
  s.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};s.turn=Math.floor(lease.clock.elapsedMs/60000);s.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
  await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save}});return p;
}
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;calls+=h.calls;console.log('PASS '+name);}finally{h.close();}}

await scope('troop-only exports debit the main army into escrow and import once without changing garrisons',async h=>{
  const a=await fixture(h,'兵士輸出',2000),b=await fixture(h,'兵士輸入',1500),other=await fixture(h,'兵士第三者');
  const beforeA=saved(h,a),beforeB=saved(h,b),bRow=row(h,b),total=add(balances(beforeA),balances(beforeB));
  const created=(await propose(h,a,b,{troops:400})).data,id=created.trade.id;
  assert.equal(created.save.state.troops,1600);assert.equal(created.save.state.resources.troops,undefined);assert.deepEqual(row(h,b),bRow);
  assert.deepEqual(created.save.state.castles,beforeA.state.castles);assert.deepEqual(created.save.state.stats,beforeA.state.stats);assert.equal(created.save.state.command,beforeA.state.command);
  assert.deepEqual(add(balances(saved(h,a)),balances(saved(h,b)),created.trade.offer),total);
  await act(h,a,id,'accept',{},403);await act(h,other,id,'accept',{},404);await h.api('/trades/'+id,{token:other.token,expected:404});
  const sender=row(h,a),accepted=(await act(h,b,id,'accept')).data;
  assert.equal(accepted.save.state.troops,1900);assert.equal(accepted.trade.delivery,null);assert.equal(delivery(h,id),undefined);assert.deepEqual(row(h,a),sender);
  assert.deepEqual(accepted.save.state.castles,beforeB.state.castles);assert.deepEqual(add(balances(saved(h,a)),balances(saved(h,b))),total);
  await act(h,b,id,'accept',{},409);assert.equal(saved(h,b).state.troops,1900);
});

await scope('all six assets are conserved and sender proceeds can be claimed when the normal troop capacity is full',async h=>{
  const a=await fixture(h,'混合輸出',2200),b=await fixture(h,'混合輸入',1700);
  const offer={gold:101,rice:202,wood:303,stone:404,magatama:505,troops:400},want={gold:51,rice:52,wood:53,stone:54,magatama:55,troops:150};
  const normalCapacity=cap(h,a);change(h,a,s=>s.troops=normalCapacity+offer.troops);
  const beforeA=balances(saved(h,a)),beforeB=balances(saved(h,b)),total=add(beforeA,beforeB);
  const created=(await propose(h,a,b,offer,want)).data,id=created.trade.id;
  assert.deepEqual(balances(created.save),subtract(beforeA,offer));assert.deepEqual(created.trade.offer,offer);
  const untouched=row(h,a),accepted=(await act(h,b,id,'accept')).data;
  assert.deepEqual(balances(accepted.save),add(subtract(beforeB,want),offer));assert.deepEqual(row(h,a),untouched);
  assert.deepEqual(JSON.parse(delivery(h,id).assets_json),want);assert.deepEqual(add(balances(saved(h,a)),balances(saved(h,b)),want),total);
  const recipient=row(h,b),claimed=(await act(h,a,id,'claim')).data;
  assert.equal(claimed.save.state.troops,normalCapacity+want.troops);assert.deepEqual(row(h,b),recipient);assert.deepEqual(add(balances(saved(h,a)),balances(saved(h,b))),total);
  assert(delivery(h,id).claimed_at!==null);
});

await scope('troop quantities reject null, strings, fractions, negatives and out-of-range values atomically',async h=>{
  const a=await fixture(h,'兵数検証送信'),b=await fixture(h,'兵数検証受信'),before=row(h,a),ledger=tables(h);
  for(const value of [null,'1',-1,1.5,1000001,Number.MAX_SAFE_INTEGER+1])for(const side of ['offer','want']){
    h.resetRates();const body={targetPlayerId:b.user.id,offer:{gold:1},want:{},...envelope(h,a),[side]:{troops:value}};
    const result=(await h.api('/trades',post(a,body,400))).data;assert.equal(result.error.code,'INVALID_INPUT');
  }
  await propose(h,a,b,{troops:0},{},{},400);
  assert.deepEqual(row(h,a),before);assert.deepEqual(tables(h),ledger);
});

await scope('insufficient troop exports and troop payment reject the entire mixed operation',async h=>{
  const a=await fixture(h,'兵不足輸出',100),b=await fixture(h,'兵不足輸入',50),before=row(h,a);
  const unavailable=(await propose(h,a,b,{troops:101,gold:20},{},{},409)).data;
  assert.equal(unavailable.error.code,'INSUFFICIENT_ASSETS');assert.deepEqual(row(h,a),before);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trades').get().n,0);
  const id=(await propose(h,a,b,{troops:25,wood:30},{troops:51,gold:20})).data.trade.id,receiver=row(h,b),ledger=tables(h);
  const result=(await act(h,b,id,'accept',{},409)).data;assert.equal(result.error.code,'INSUFFICIENT_ASSETS');assert.deepEqual(row(h,b),receiver);assert.deepEqual(tables(h),ledger);
  assert.equal(escrow(h,id).status,'pending');assert.equal(saved(h,a).state.troops,75);
});

await scope('imports accept the exact net payment above full building and governor capacity without altering either capacity',async h=>{
  const a=await fixture(h,'上限兵輸出',3000),b=await fixture(h,'上限兵輸入'),limit=cap(h,b);
  change(h,b,s=>s.troops=limit);
  const total=add(balances(saved(h,a)),balances(saved(h,b))),castles=saved(h,b).state.castles;
  const id=(await propose(h,a,b,{troops:200,wood:30},{troops:100,gold:20})).data.trade.id;
  await act(h,b,id,'accept');assert.equal(saved(h,b).state.troops,limit+100);assert.equal(cap(h,b),limit);assert.deepEqual(saved(h,b).state.castles,castles);
  assert.deepEqual(add(balances(saved(h,a)),balances(saved(h,b)),JSON.parse(delivery(h,id).assets_json)),total);
  const governed=(await propose(h,a,b,{troops:1})).data.trade.id;
  change(h,b,s=>{s.governors.barracks=s.officers.find(id=>!s.army.includes(id));});assert(cap(h,b)>limit,'governor must change the actual engine capacity');
  const governedCapacity=cap(h,b);change(h,b,s=>s.troops=governedCapacity);
  await act(h,b,governed,'accept');assert.equal(saved(h,b).state.troops,governedCapacity+1);assert.equal(cap(h,b),governedCapacity);
});

await scope('cancelled and rejected refunds ignore normal capacity and remain complete until the independent stock ceiling permits receipt',async h=>{
  const a=await fixture(h,'兵士返還元',2200),b=await fixture(h,'兵士返還先');
  for(const action of ['cancel','reject']){
    const id=(await propose(h,a,b,{troops:400,gold:30},{rice:100})).data.trade.id,beforeA=row(h,a),beforeB=row(h,b);
    await act(h,action==='cancel'?a:b,id,action);assert.deepEqual(row(h,a),beforeA);assert.deepEqual(row(h,b),beforeB);
    assert.equal(delivery(h,id).kind,'refund');assert.equal(JSON.parse(delivery(h,id).assets_json).troops,400);
    await act(h,b,id,'claim',{},403);
    const normalCapacity=cap(h,a);change(h,a,s=>s.troops=normalCapacity);const request=envelope(h,a),goldBefore=saved(h,a).state.resources.gold;
    await act(h,a,id,'claim',request);assert.equal(saved(h,a).state.troops,normalCapacity+400);assert.equal(saved(h,a).state.resources.gold,goldBefore+30);
    const received=row(h,a),replay=(await act(h,a,id,'claim',request)).data;assert(replay.idempotent);assert.deepEqual(row(h,a),received);
    const overflow=(await propose(h,a,b,{troops:400,gold:30},{rice:100})).data.trade.id;await act(h,action==='cancel'?a:b,overflow,action);
    change(h,a,s=>s.troops=STOCK_CAP-399);const beforeClaim=row(h,a),ledger=tables(h);
    assert.equal((await act(h,a,overflow,'claim',{},409)).data.error.code,'TROOP_LIMIT');assert.deepEqual(row(h,a),beforeClaim);assert.deepEqual(tables(h),ledger);assert.equal(delivery(h,overflow).claimed_at,null);
    change(h,a,s=>s.troops=STOCK_CAP-400);const gold=saved(h,a).state.resources.gold;await act(h,a,overflow,'claim');assert.equal(saved(h,a).state.troops,STOCK_CAP);assert.equal(saved(h,a).state.resources.gold,gold+30);
    const complete=row(h,a);await act(h,a,overflow,'claim',{},409);assert.deepEqual(row(h,a),complete);
  }
});

await scope('parallel soldier proposals, accepts and claims replay once with unchanged request identities',async h=>{
  const a=await fixture(h,'兵重複送信',3000),b=await fixture(h,'兵重複受信',2000),originalTotal=add(balances(saved(h,a)),balances(saved(h,b)));
  const body={targetPlayerId:b.user.id,offer:{troops:400,gold:10},want:{troops:200,rice:20},...envelope(h,a)};
  barrier(h);const proposed=await Promise.all([h.api('/trades',post(a,body)),h.api('/trades',post(a,body))]);
  const id=proposed[0].data.trade.id;assert.equal(proposed[1].data.trade.id,id);assert.deepEqual(proposed.map(r=>r.data.idempotent).sort(),[false,true]);assert.equal(saved(h,a).state.troops,2600);
  const changed=(await h.api('/trades',post(a,{...body,offer:{troops:401,gold:10}},409))).data;assert.equal(changed.error.code,'REQUEST_ID_REUSED');
  const accept=envelope(h,b);barrier(h);const accepted=await Promise.all([act(h,b,id,'accept',accept),act(h,b,id,'accept',accept)]);assert.deepEqual(accepted.map(r=>r.data.idempotent).sort(),[false,true]);assert.equal(saved(h,b).state.troops,2200);
  const claim=envelope(h,a);barrier(h);const claimed=await Promise.all([act(h,a,id,'claim',claim),act(h,a,id,'claim',claim)]);assert.deepEqual(claimed.map(r=>r.data.idempotent).sort(),[false,true]);assert.equal(saved(h,a).state.troops,2800);
  const before=row(h,a),replayed=(await act(h,a,id,'claim',{...claim,deviceId:'replacement-device',expectedRevision:0})).data;assert.equal(replayed.idempotent,true);assert.deepEqual(row(h,a),before);
  assert.deepEqual(add(balances(saved(h,a)),balances(saved(h,b))),originalTotal);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_requests').get().n,3);
});

await scope('lost soldier settlement responses recover all escrow, import and proceeds without duplicate movements',async h=>{
  const a=await fixture(h,'兵再送元',2500),b=await fixture(h,'兵再送先',1500),total=add(balances(saved(h,a)),balances(saved(h,b)));
  const lose=()=>{h.afterBatch=statements=>{if(tradeBatch(statements)){h.afterBatch=null;throw Error('local soldier trade reply loss');}};};
  const body={targetPlayerId:b.user.id,offer:{troops:300},want:{troops:100},...envelope(h,a)};
  lose();await h.api('/trades',post(a,body,500));const exported=row(h,a),created=(await h.api('/trades',post(a,body))).data,id=created.trade.id;assert(created.idempotent);assert.deepEqual(row(h,a),exported);
  const acceptance=envelope(h,b);lose();await act(h,b,id,'accept',acceptance,500);const imported=row(h,b);assert((await act(h,b,id,'accept',acceptance)).data.idempotent);assert.deepEqual(row(h,b),imported);
  const claim=envelope(h,a);lose();await act(h,a,id,'claim',claim,500);const received=row(h,a);assert((await act(h,a,id,'claim',claim)).data.idempotent);assert.deepEqual(row(h,a),received);
  assert.deepEqual(add(balances(saved(h,a)),balances(saved(h,b))),total);
});

await scope('historical five-asset hashes and zero-troop retries remain identical and preserve existing armies',async h=>{
  const a=await fixture(h,'旧交易送信',9000),b=await fixture(h,'旧交易受信',10000),offer=vector({gold:10},LEGACY),want=vector({rice:5},LEGACY),body={targetPlayerId:b.user.id,offer,want,...envelope(h,a)};
  const oldDigest=createHash('sha256').update(JSON.stringify(['propose',b.user.id,offer,want])).digest('hex');
  const created=(await h.api('/trades',post(a,body))).data,id=created.trade.id,receipt=h.sql.prepare('SELECT * FROM trade_requests WHERE actor_id=? AND request_id=?').get(a.user.id,body.requestId);
  assert.equal(receipt.request_hash,oldDigest);assert.deepEqual(created.trade.offer,offer);assert.deepEqual(created.trade.want,want);
  const before=row(h,a),replayed=(await h.api('/trades',post(a,{...body,offer:{...offer,troops:0},want:{...want,troops:0}}))).data;
  assert(replayed.idempotent);assert.deepEqual(row(h,a),before);
  assert.equal((await h.api('/trades',post(a,{...body,offer:{...offer,troops:1}},409))).data.error.code,'REQUEST_ID_REUSED');
  await act(h,b,id,'accept');await act(h,a,id,'claim');assert.equal(saved(h,a).state.troops,9000);assert.equal(saved(h,b).state.troops,10000);
  const legacyRefund=(await propose(h,a,b,{wood:10},{})).data.trade.id;await act(h,a,legacyRefund,'cancel');await act(h,a,legacyRefund,'claim');assert.equal(saved(h,a).state.troops,9000);
});

await scope('imports can cross one million soldiers while exports, net reductions and the absolute save limit stay intact',async h=>{
  const a=await fixture(h,'兵最大送信',1000000),b=await fixture(h,'兵最大受信',10000),limit=cap(h,b);assert(limit<10000);
  const net=(await propose(h,a,b,{troops:100},{troops:200})).data.trade.id;await act(h,b,net,'accept');assert.equal(saved(h,b).state.troops,9900);
  const remaining=saved(h,a).state.troops,id=(await propose(h,a,b,{troops:remaining},{})).data.trade.id;assert.equal(saved(h,a).state.troops,0);
  const receiver=saved(h,b).state.troops;await act(h,b,id,'accept');assert.equal(saved(h,b).state.troops,receiver+remaining);assert(saved(h,b).state.troops>1000000);
  const invalid=saved(h,a);invalid.state.troops=100000001;await h.api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:Number(row(h,a).revision),save:invalid},expected:400});assert.equal(saved(h,a).state.troops,0);
});

await scope('staff imports exceed both the projected shared-base and personal building capacities',async h=>{
  const operator=await h.session('兵交易運営');await h.api('/admin/claim',post(operator,{key:h.env.SENGOKU_ADMIN_KEY}));
  const a=await fixture(h,'兵共同輸出',50000),b=await fixture(h,'兵共同輸入',0);
  await h.api('/admin/staff',post(operator,{targetPlayerId:b.user.id,action:'appoint',requestId:crypto.randomUUID()}));
  await h.api('/sync?deviceId='+b.deviceId,{token:b.token});
  const base=JSON.parse(h.sql.prepare("SELECT state_json FROM staff_base WHERE id='kyoto_gosho'").get().state_json);
  base.initial.buildings.barracks=16;base.buildings.barracks=16;
  h.sql.prepare("UPDATE staff_base SET state_json=?,revision=revision+1 WHERE id='kyoto_gosho'").run(JSON.stringify(base));
  const snapshot=(await h.api('/sync?deviceId='+b.deviceId,{token:b.token})).data;
  const personal=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isStaff:true}).troopCapacity(),projected=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isStaff:true,staffBase:snapshot.staffBase}).troopCapacity();
  assert(projected>personal,'the shared barracks must provide capacity absent from the personal save');
  change(h,b,s=>s.troops=projected);const id=(await propose(h,a,b,{troops:100})).data.trade.id;
  await act(h,b,id,'accept');assert.equal(saved(h,b).state.troops,projected+100);
  const overflow=(await propose(h,a,b,{troops:1})).data.trade.id;await act(h,b,overflow,'accept');assert.equal(saved(h,b).state.troops,projected+101);
});

await scope('the independent ceiling reserves active march troops and preserves pending imports, proceeds and exact retries at the boundary',async h=>{
  const a=await fixture(h,'輸送上限の送り主',3000),b=await fixture(h,'帰還枠の受け取り主',5000),initial=saved(h,b);
  const departed=(await h.api('/marches/campaign',post(b,{kind:'castle',targetId:'inabayama',tactic:'balanced',troops:1000,campaignId:initial.state.walking.campaignId,...envelope(h,b)}))).data;
  assert(departed.marching);assert.equal(departed.save.state.march.troops,1000);
  const transportCapacity=STOCK_CAP-1000;change(h,b,s=>s.troops=transportCapacity-99);
  const id=(await propose(h,a,b,{troops:200,gold:5},{troops:100,rice:5})).data.trade.id,before=row(h,b),ledger=tables(h);
  const rejected=(await act(h,b,id,'accept',{},409)).data;assert.equal(rejected.error.code,'TROOP_LIMIT');assert.match(rejected.error.message,/別枠/);assert.deepEqual(row(h,b),before);assert.deepEqual(tables(h),ledger);assert.equal(escrow(h,id).status,'pending');
  change(h,b,s=>s.troops=transportCapacity-100);const accept=envelope(h,b),accepted=(await act(h,b,id,'accept',accept)).data;
  assert.equal(accepted.save.state.troops,transportCapacity);assert.equal(accepted.save.state.troops+accepted.save.state.march.troops,STOCK_CAP);
  const imported=row(h,b),importLedger=tables(h),retried=(await act(h,b,id,'accept',accept)).data;assert(retried.idempotent);assert.deepEqual(retried.receipt,accepted.receipt);assert.deepEqual(row(h,b),imported);assert.deepEqual(tables(h),importLedger);
  change(h,a,s=>s.troops=STOCK_CAP-99);const beforeClaim=row(h,a),pending=tables(h);assert.equal((await act(h,a,id,'claim',{},409)).data.error.code,'TROOP_LIMIT');assert.deepEqual(row(h,a),beforeClaim);assert.deepEqual(tables(h),pending);assert.equal(delivery(h,id).claimed_at,null);assert.equal(JSON.parse(delivery(h,id).assets_json).troops,100);
  change(h,a,s=>s.troops=STOCK_CAP-100);const claim=envelope(h,a),claimed=(await act(h,a,id,'claim',claim)).data;assert.equal(claimed.save.state.troops,STOCK_CAP);
  const settled=row(h,a),settledLedger=tables(h),claimReplay=(await act(h,a,id,'claim',claim)).data;assert(claimReplay.idempotent);assert.deepEqual(claimReplay.receipt,claimed.receipt);assert.deepEqual(row(h,a),settled);assert.deepEqual(tables(h),settledLedger);
});

await scope('capacity-changing save races cannot import soldiers against an obsolete revision',async h=>{
  const a=await fixture(h,'兵変更元'),b=await fixture(h,'兵変更先'),limit=cap(h,b);change(h,b,s=>s.troops=limit-100);
  const id=(await propose(h,a,b,{troops:100})).data.trade.id,ledger=tables(h),before=saved(h,b).state.troops;
  h.beforeBatch=statements=>{if(!tradeBatch(statements))return;h.beforeBatch=null;change(h,b,s=>s.buildings.barracks=1);h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(b.user.id);};
  const result=(await act(h,b,id,'accept',{},409)).data;assert.equal(result.error.code,'REVISION_CONFLICT');assert.equal(saved(h,b).state.troops,before);assert.deepEqual(tables(h),ledger);assert.equal(escrow(h,id).status,'pending');
});

console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0,coverage:['troop-only and six-asset conservation','main army only, no remote-save writes','numeric and affordability rejection','imports independent of building, governor and shared staff capacity','whole refunds and proceeds retained at stock ceiling','reserved march room and exact boundary receipts','parallel and lost-response idempotency','legacy hashes and zero-troop retries','capacity-changing revision races']},null,2));
