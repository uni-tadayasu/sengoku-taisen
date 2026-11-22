import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

// Actual Worker routes and transactional SQLite, entirely local. Include the
// escrow and delivery ledgers in conservation checks; no soldier is clipped.
const ASSETS=['gold','rice','wood','stone','magatama','troops'];
const LEGACY=ASSETS.filter(key=>key!=='troops');
const vector=(value={},keys=ASSETS)=>Object.fromEntries(keys.map(key=>[key,value[key]??0]));
const balances=save=>vector({...save.state.resources,magatama:save.state.magatama,troops:save.state.troops});
const add=(...values)=>Object.fromEntries(ASSETS.map(key=>[key,values.reduce((sum,value)=>sum+(value[key]??0),0)]));
const subtract=(value,paid)=>Object.fromEntries(ASSETS.map(key=>[key,(value[key]??0)-(paid[key]??0)]));
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const saved=(h,p)=>JSON.parse(row(h,p).save_json);
const cap=(h,p)=>Math.min(1000000,GameEngine.fromSave(saved(h,p),GAME_OFFICERS).troopCapacity());
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

await scope('all six assets including soldiers are conserved through mixed payment and explicit proceeds claim',async h=>{
  const a=await fixture(h,'混合輸出',2200),b=await fixture(h,'混合輸入',1700);
  const offer={gold:101,rice:202,wood:303,stone:404,magatama:505,troops:400},want={gold:51,rice:52,wood:53,stone:54,magatama:55,troops:150};
  const beforeA=balances(saved(h,a)),beforeB=balances(saved(h,b)),total=add(beforeA,beforeB);
  const created=(await propose(h,a,b,offer,want)).data,id=created.trade.id;
  assert.deepEqual(balances(created.save),subtract(beforeA,offer));assert.deepEqual(created.trade.offer,offer);
  const untouched=row(h,a),accepted=(await act(h,b,id,'accept')).data;
  assert.deepEqual(balances(accepted.save),add(subtract(beforeB,want),offer));assert.deepEqual(row(h,a),untouched);
  assert.deepEqual(JSON.parse(delivery(h,id).assets_json),want);assert.deepEqual(add(balances(saved(h,a)),balances(saved(h,b)),want),total);
  const recipient=row(h,b),claimed=(await act(h,a,id,'claim')).data;
  assert.equal(claimed.save.state.troops,1950);assert.deepEqual(row(h,b),recipient);assert.deepEqual(add(balances(saved(h,a)),balances(saved(h,b))),total);
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

await scope('imports honor the exact live building and governor capacity and net troop payment',async h=>{
  const a=await fixture(h,'上限兵輸出',3000),b=await fixture(h,'上限兵輸入'),limit=cap(h,b);
  change(h,b,s=>s.troops=limit-99);
  const id=(await propose(h,a,b,{troops:200,wood:30},{troops:100,gold:20})).data.trade.id,before=row(h,b),ledger=tables(h);
  assert.equal((await act(h,b,id,'accept',{},409)).data.error.code,'TROOP_LIMIT');assert.deepEqual(row(h,b),before);assert.deepEqual(tables(h),ledger);
  change(h,b,s=>s.troops=limit-100);await act(h,b,id,'accept');assert.equal(saved(h,b).state.troops,limit);
  const governed=(await propose(h,a,b,{troops:1})).data.trade.id;
  assert.equal((await act(h,b,governed,'accept',{},409)).data.error.code,'TROOP_LIMIT');
  change(h,b,s=>{s.governors.barracks=s.officers.find(id=>!s.army.includes(id));});assert(cap(h,b)>limit,'governor must change the actual engine capacity');
  await act(h,b,governed,'accept');assert.equal(saved(h,b).state.troops,limit+1);
});

await scope('cancelled and rejected troop exports preserve complete refunds until capacity permits receipt',async h=>{
  const a=await fixture(h,'兵士返還元',2200),b=await fixture(h,'兵士返還先');
  for(const action of ['cancel','reject']){
    const id=(await propose(h,a,b,{troops:400,gold:30},{rice:100})).data.trade.id,beforeA=row(h,a),beforeB=row(h,b);
    await act(h,action==='cancel'?a:b,id,action);assert.deepEqual(row(h,a),beforeA);assert.deepEqual(row(h,b),beforeB);
    assert.equal(delivery(h,id).kind,'refund');assert.equal(JSON.parse(delivery(h,id).assets_json).troops,400);
    await act(h,b,id,'claim',{},403);
    const limit=cap(h,a);change(h,a,s=>s.troops=limit-399);const beforeClaim=row(h,a),ledger=tables(h);
    assert.equal((await act(h,a,id,'claim',{},409)).data.error.code,'TROOP_LIMIT');assert.deepEqual(row(h,a),beforeClaim);assert.deepEqual(tables(h),ledger);assert.equal(delivery(h,id).claimed_at,null);
    change(h,a,s=>s.troops=limit-400);const gold=saved(h,a).state.resources.gold;await act(h,a,id,'claim');assert.equal(saved(h,a).state.troops,limit);assert.equal(saved(h,a).state.resources.gold,gold+30);
    const received=row(h,a);await act(h,a,id,'claim',{},409);assert.deepEqual(row(h,a),received);
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

await scope('reduced capacity still allows exports and net troop reductions, while the 100-million-soldier save limit is enforced',async h=>{
  const a=await fixture(h,'兵最大送信',1000000),b=await fixture(h,'兵最大受信',10000),limit=cap(h,b);assert(limit<10000);
  const net=(await propose(h,a,b,{troops:100},{troops:200})).data.trade.id;await act(h,b,net,'accept');assert.equal(saved(h,b).state.troops,9900);
  const remaining=saved(h,a).state.troops,id=(await propose(h,a,b,{troops:remaining},{})).data.trade.id;assert.equal(saved(h,a).state.troops,0);
  const receiver=row(h,b);assert.equal((await act(h,b,id,'accept',{},409)).data.error.code,'TROOP_LIMIT');assert.deepEqual(row(h,b),receiver);
  await act(h,a,id,'cancel');assert.equal(JSON.parse(delivery(h,id).assets_json).troops,remaining);
  const invalid=saved(h,a);invalid.state.troops=100000001;await h.api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:Number(row(h,a).revision),save:invalid},expected:400});assert.equal(saved(h,a).state.troops,0);
});

await scope('staff imports use projected shared-base capacity instead of personal saved buildings',async h=>{
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
  change(h,b,s=>s.troops=projected-100);const id=(await propose(h,a,b,{troops:100})).data.trade.id;
  await act(h,b,id,'accept');assert.equal(saved(h,b).state.troops,projected);
  const overflow=(await propose(h,a,b,{troops:1})).data.trade.id;assert.equal((await act(h,b,overflow,'accept',{},409)).data.error.code,'TROOP_LIMIT');
});

await scope('capacity-changing save races cannot import soldiers against an obsolete revision',async h=>{
  const a=await fixture(h,'兵変更元'),b=await fixture(h,'兵変更先'),limit=cap(h,b);change(h,b,s=>s.troops=limit-100);
  const id=(await propose(h,a,b,{troops:100})).data.trade.id,ledger=tables(h),before=saved(h,b).state.troops;
  h.beforeBatch=statements=>{if(!tradeBatch(statements))return;h.beforeBatch=null;change(h,b,s=>s.buildings.barracks=1);h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(b.user.id);};
  const result=(await act(h,b,id,'accept',{},409)).data;assert.equal(result.error.code,'REVISION_CONFLICT');assert.equal(saved(h,b).state.troops,before);assert.deepEqual(tables(h),ledger);assert.equal(escrow(h,id).status,'pending');
});

console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0,coverage:['troop-only and six-asset conservation','main army only, no remote-save writes','numeric and affordability rejection','live building, governor and shared staff capacity','whole refunds and proceeds retained on overflow','parallel and lost-response idempotency','legacy hashes and zero-troop retries','capacity-changing revision races']},null,2));
