// Worker-level troop depot conservation, privacy, vacancy races and receipts.
import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const reports=[],clone=value=>structuredClone(value);
const STOCK_CAP=100000000;
const depots=(h,p)=>h.sql.prepare('SELECT * FROM vacant_garrisons WHERE actor_id=? ORDER BY campaign_id,castle_id').all(p.user.id);
const receipts=(h,p)=>h.sql.prepare('SELECT * FROM vacant_garrison_requests WHERE actor_id=? ORDER BY request_id').all(p.user.id);
const movement=(h,p)=>h.sql.prepare('SELECT * FROM troop_transfer_states WHERE actor_id=? ORDER BY campaign_id').all(p.user.id);
const stable=(h,p)=>clone({save:row(h,p),depots:depots(h,p),receipts:receipts(h,p),movement:movement(h,p)});
const status=async(h,p)=>(await h.api('/troop-garrisons?deviceId='+p.deviceId,{token:p.token})).data;
const body=(h,p,castleId,troops)=>({castleId,troops,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId});
const command=async(h,p,action,request,expected=200)=>(await h.api('/troop-garrisons/'+action,post(p,request,expected))).data;
const put=(h,p,value,expected=200)=>h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected});
const stationed=(h,p,id)=>depots(h,p).filter(row=>row.campaign_id===save(h,p).state.walking.campaignId&&row.castle_id===id).reduce((n,row)=>n+row.troops,0);
async function resident(h,name,castleId){
 const p=await h.session(name);p.deviceId='garrison-resident-'+p.user.id;
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 await h.api('/castles/residency/start',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,revision:lease.revision,castleId,mode:'lord',clan:'織田家',difficulty:'normal'}));return p;
}
function atCommit(h,run){h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO vacant_garrison_requests'))return;h.beforeBatch=null;await run();};}
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);let maxBindings=0;h.db.batch=statements=>{for(const statement of statements){maxBindings=Math.max(maxBindings,statement.params.length);assert(statement.params.length<=100,'D1 binding limit exceeded');}return batch(statements);};try{await run(h);reports.push({name,calls:h.calls,maxBindings});console.log('PASS '+name);}finally{h.close();}}

const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Vacant garrison tests must not contact real services');};
try{
 await scope('finite send, refill and partial/full recall preserve total soldiers, castle ownership, receipts and sync replay protection',async h=>{
  await h.api('/troop-garrisons',{expected:401});await h.api('/troop-garrisons/send',{method:'POST',body:{},expected:401});
  const p=await fixture(h,'兵を預ける領主',{startCastle:'himeji'}),before=save(h,p),initial=await status(h,p);assert(initial.availableCastles.some(c=>c.castleId==='inuyama'));assert.equal(initial.commandCost,1);assert.equal(initial.army.troops,before.state.troops);assert.equal(initial.army.transportCapacity,STOCK_CAP);assert.equal(initial.army.recallCapacity,STOCK_CAP-before.state.troops);
  const request=body(h,p,'inuyama',600),sent=await command(h,p,'send',request);assert.equal(sent.idempotent,false);assert.equal(sent.result.requestId,request.requestId);assert.equal(sent.result.action,'send');assert.equal(sent.result.armyBefore-sent.result.armyAfter,600);assert.equal(sent.result.garrisonAfter-sent.result.garrisonBefore,600);
  assert.equal(sent.save.state.troops+stationed(h,p,'inuyama'),before.state.troops);assert.equal(sent.save.state.command,before.state.command-1);assert.deepEqual(sent.save.state.resources,before.state.resources);assert.deepEqual(sent.save.state.castles,before.state.castles);assert.equal(sent.save.state.home,before.state.home);assert.equal(h.sql.prepare('SELECT lord_user_id FROM castle_seats WHERE castle_id=?').get('inuyama').lord_user_id,null);
  const committed=stable(h,p),replay=await command(h,p,'send',request);assert(replay.idempotent);assert.deepEqual(replay.result,sent.result);assert.deepEqual(stable(h,p),committed);
  const conflict=await command(h,p,'send',{...request,troops:601},409);assert.equal(conflict.error.code,'REQUEST_ID_REUSED');assert.deepEqual(stable(h,p),committed);
  const rejected=await put(h,p,before,409);assert.equal(rejected.data.error.code,'TROOP_STATE_CHANGED');assert.deepEqual(stable(h,p),committed,'an old cloud snapshot cannot recreate the debited army');
  const partial=await command(h,p,'recall',body(h,p,'inuyama',200));assert.equal(partial.garrisons[0].troops,400);assert.equal(partial.save.state.troops+stationed(h,p,'inuyama'),before.state.troops);
  const refilled=await command(h,p,'send',body(h,p,'inuyama',300));assert.equal(refilled.garrisons[0].troops,700);assert.equal(refilled.save.state.troops+stationed(h,p,'inuyama'),before.state.troops);
  const recalled=await command(h,p,'recall',body(h,p,'inuyama',700));assert.deepEqual(recalled.garrisons,[]);assert.equal(recalled.save.state.troops,before.state.troops);assert.equal(recalled.save.state.troopTransferSequence,4);assert.equal(receipts(h,p).length,4);assert.equal(movement(h,p)[0].sequence,4);
  await put(h,p,recalled.save);assert.equal(stationed(h,p,'inuyama'),0);assert.equal(save(h,p).state.troops,before.state.troops);
 });
 await scope('private own depots block other senders, new lords block refills, and recall plus historic receipts remain available',async h=>{
  const a=await fixture(h,'配置する領主',{startCastle:'himeji'}),b=await fixture(h,'別の領主',{startCastle:'okazaki'}),request=body(h,a,'inuyama',500),sent=await command(h,a,'send',request);
  const other=await status(h,b);assert.deepEqual(other.garrisons,[]);assert(!other.availableCastles.some(c=>c.castleId==='inuyama'));assert(!JSON.stringify(other.garrisons).includes(a.user.id));
  const beforeOther=stable(h,b),blocked=await command(h,b,'send',body(h,b,'inuyama',1),409);assert.equal(blocked.error.code,'GARRISON_CASTLE_RESERVED');assert.deepEqual(stable(h,b),beforeOther);
  const lord=await resident(h,'後から入城する領主','inuyama'),lordBefore=clone(row(h,lord));
  const occupied=await status(h,a),own=occupied.garrisons.find(g=>g.castleId==='inuyama');assert.equal(own.canSend,false);assert.equal(own.maxSend,0);assert.equal(own.maxRecall,500);assert(!occupied.availableCastles.some(c=>c.castleId==='inuyama'));
  const beforeRefill=stable(h,a),denied=await command(h,a,'send',body(h,a,'inuyama',1),409);assert.equal(denied.error.code,'GARRISON_CASTLE_OCCUPIED');assert.deepEqual(stable(h,a),beforeRefill);
  const replay=await command(h,a,'send',request);assert(replay.idempotent);assert.deepEqual(replay.result,sent.result);assert.deepEqual(stable(h,a),beforeRefill);
  const back=await command(h,a,'recall',body(h,a,'inuyama',500));assert.equal(back.garrisons.length,0);assert.deepEqual(clone(row(h,lord)),lordBefore,'recall cannot borrow or alter the new lord\'s soldiers');
 });
 await scope('major cities use real holder checks including ambiguous claimants and designated protected-base roles without saves',async h=>{
  const p=await fixture(h,'大都市へ配置する領主',{startCastle:'himeji'}),empty=await status(h,p);for(const id of ['nijo','osaka','nagoya','edo','kyoto_gosho'])assert(empty.availableCastles.some(c=>c.castleId===id),id+' starts vacant');
  const sent=await command(h,p,'send',body(h,p,'nijo',300));assert.equal(sent.garrisons.find(g=>g.castleId==='nijo').majorCity,true);assert.equal(sent.save.state.castles.nijo.owner,save(h,p).state.castles.nijo.owner);
  const owner=await fixture(h,'大都市の保有者',{startCastle:'okazaki',holdings:['osaka']}),owner2=await fixture(h,'重なる大都市保有者',{startCastle:'inuyama',holdings:['osaka']});
  const disputed=await command(h,p,'send',body(h,p,'osaka',1),409);assert.equal(disputed.error.code,'GARRISON_CASTLE_OCCUPIED');assert(!JSON.stringify(disputed).includes(owner.user.id));assert(!JSON.stringify(disputed).includes(owner2.user.id));
  const admin=await h.session('保存前の運営');await h.api('/admin/claim',post(admin,{key:h.env.SENGOKU_ADMIN_KEY}));
  const staff=await h.session('保存前のスタッフ');await h.api('/admin/staff',post(admin,{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}));
  const reserved=await status(h,p);assert(!reserved.availableCastles.some(c=>c.castleId==='edo'));assert(!reserved.availableCastles.some(c=>c.castleId==='kyoto_gosho'));
  for(const id of ['edo','kyoto_gosho'])assert.equal((await command(h,p,'send',body(h,p,id,1),409)).error.code,'GARRISON_CASTLE_OCCUPIED');
 });
 await scope('vacancy or another sender changing at commit rejects the entire transport while concurrent senders have one winner',async h=>{
  const a=await fixture(h,'空城競合A',{startCastle:'himeji'}),b=await fixture(h,'空城競合B',{startCastle:'okazaki'}),before=stable(h,a);let joined=false;
  atCommit(h,async()=>{await resident(h,'確定直前の領主','inuyama');joined=true;});
  const denied=await command(h,a,'send',body(h,a,'inuyama',100),409);assert(joined);assert.equal(denied.error.code,'GARRISON_STATE_CHANGED');assert.deepEqual(stable(h,a),before);
  let arrived=0,release;const barrier=new Promise(resolve=>release=resolve);
  h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO vacant_garrison_requests'))return;if(++arrived===2){h.beforeBatch=null;release();}await barrier;};
  const attempts=await Promise.all([a,b].map(p=>h.api('/troop-garrisons/send',post(p,body(h,p,'takaya',100),null))));
  assert.deepEqual(attempts.map(r=>r.response.status).sort(),[200,409]);assert.equal(stationed(h,a,'takaya')+stationed(h,b,'takaya'),100);assert.equal(receipts(h,a).length+receipts(h,b).length,1);
  assert.equal(save(h,a).state.troops+save(h,b).state.troops+stationed(h,a,'takaya')+stationed(h,b,'takaya'),20000);
 });
 await scope('normal full capacity allows recall, absolute capacity and other invalid moves remain atomic, and inactive campaigns release castles',async h=>{
  const a=await fixture(h,'容量を確認する領主',{startCastle:'himeji'}),b=await fixture(h,'旧物語の次の領主',{startCastle:'okazaki'}),before=stable(h,a);
  for(const troops of [0,-1,1.5,100000001])await command(h,a,'send',body(h,a,'inuyama',troops),400);
  assert.deepEqual(stable(h,a),before);assert.equal((await command(h,a,'send',body(h,a,'inuyama',10001),409)).error.code,'INSUFFICIENT_TROOPS');assert.deepEqual(stable(h,a),before);
  const request=body(h,a,'inuyama',500),sent=await command(h,a,'send',request);
  const game=GameEngine.fromSave(save(h,a),GAME_OFFICERS);updateSave(h,a,s=>{s.troops=game.availableTroopCapacity();});
  const recallRequest=body(h,a,'inuyama',1),normalFull=save(h,a),allowed=await command(h,a,'recall',recallRequest);assert.equal(allowed.save.state.troops,normalFull.state.troops+1);assert.equal(allowed.army.capacity,STOCK_CAP);assert.equal(allowed.army.recruitmentCapacity,game.availableTroopCapacity());assert.equal(allowed.army.transportCapacity,STOCK_CAP);assert.equal(allowed.army.recallCapacity,STOCK_CAP-allowed.army.troops);assert.equal(allowed.garrisons[0].maxRecall,499);assert.equal(allowed.save.state.troops+stationed(h,a,'inuyama'),normalFull.state.troops+500);
  const afterRecall=stable(h,a),replayed=await command(h,a,'recall',recallRequest);assert(replayed.idempotent);assert.deepEqual(replayed.result,allowed.result);assert.deepEqual(stable(h,a),afterRecall);
  updateSave(h,a,s=>{s.troops=STOCK_CAP;});
  const full=stable(h,a),denied=await command(h,a,'recall',body(h,a,'inuyama',1),409);assert.equal(denied.error.code,'TROOP_CAPACITY');assert.deepEqual(stable(h,a),full);
  updateSave(h,a,s=>{s.command=0;});const exhausted=stable(h,a);assert.equal((await command(h,a,'send',body(h,a,'takaya',1),409)).error.code,'NO_COMMANDS');assert.deepEqual(stable(h,a),exhausted);
  const oldCampaign=save(h,a).state.walking.campaignId,newStory=new GameEngine({officers:GAME_OFFICERS,startCastle:'himeji'});newStory.applyWorldClock((await h.api('/world-clock')).data.clock);await put(h,a,JSON.parse(newStory.exportSave()));
  const current=await status(h,a);assert.deepEqual(current.garrisons,[]);assert(current.availableCastles.some(c=>c.castleId==='inuyama'));
  const wrong=body(h,a,'inuyama',1);wrong.campaignId=oldCampaign;assert.equal((await command(h,a,'recall',wrong,409)).error.code,'GARRISON_SCOPE_CHANGED');
  const newSender=await command(h,b,'send',body(h,b,'inuyama',100));assert.equal(newSender.garrisons[0].troops,100);
  const currentBefore=stable(h,a),historic=await command(h,a,'send',request);assert(historic.idempotent);assert.deepEqual(historic.result,sent.result);assert.deepEqual(stable(h,a),currentBefore);
 });
 await scope('recall reserves returning march troops at the independent ceiling and replays committed partial returns without clipping',async h=>{
  const p=await fixture(h,'帰還枠を残す領主',{startCastle:'kiyosu'});await command(h,p,'send',body(h,p,'inuyama',500));
  const departure={kind:'castle',targetId:'inabayama',tactic:'balanced',troops:1000,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId};
  const marched=(await h.api('/marches/campaign',post(p,departure))).data;assert(marched.marching);assert.equal(marched.save.state.march.troops,1000);
  updateSave(h,p,s=>{s.troops=STOCK_CAP-1000-499;});const available=await status(h,p);assert.equal(available.army.transportCapacity,STOCK_CAP-1000);assert.equal(available.army.recallCapacity,499);assert.equal(available.garrisons[0].maxRecall,499);assert.equal(available.army.capacity,available.army.transportCapacity);assert(available.army.recruitmentCapacity<available.army.troops);assert(available.army.recallCapacity<=available.army.capacity,'cached clients must accept the existing capacity field');
  const fullRequest=body(h,p,'inuyama',500),before=stable(h,p),total=save(h,p).state.troops+save(h,p).state.march.troops+stationed(h,p,'inuyama');
  const denied=await command(h,p,'recall',fullRequest,409);assert.equal(denied.error.code,'TROOP_CAPACITY');assert.deepEqual(stable(h,p),before,'a rejected whole recall must keep the entire depot and movement marker');
  const request=body(h,p,'inuyama',499),recalled=await command(h,p,'recall',request);assert.equal(recalled.save.state.troops,STOCK_CAP-1000);assert.equal(recalled.save.state.march.troops,1000);assert.equal(recalled.garrisons[0].troops,1);assert.equal(recalled.garrisons[0].maxRecall,0);assert.equal(recalled.army.recallCapacity,0);assert.equal(recalled.save.state.troops+recalled.save.state.march.troops+stationed(h,p,'inuyama'),total);assert.equal(recalled.save.state.command,JSON.parse(before.save.save_json).state.command-1);
  const committed=stable(h,p);assert.equal((await command(h,p,'recall',body(h,p,'inuyama',1),409)).error.code,'TROOP_CAPACITY');assert.deepEqual(stable(h,p),committed);
  const replay=await command(h,p,'recall',request);assert(replay.idempotent);assert.deepEqual(replay.result,recalled.result);assert.deepEqual(stable(h,p),committed);assert.equal(movement(h,p)[0].sequence,2);assert.equal(receipts(h,p).length,2);
 });
 await scope('writer, role and clock races never leave a partial debit, depot or movement marker',async h=>{
  const operator=await h.session('輸送競合を検証する運営');await h.api('/admin/claim',post(operator,{key:h.env.SENGOKU_ADMIN_KEY}));
  for(const kind of ['writer','role','clock']){
   const p=await fixture(h,'輸送の競合'+kind,{startCastle:kind==='writer'?'himeji':kind==='role'?'okazaki':'inuyama'}),request=body(h,p,'takaya',100);let changed;
   atCommit(h,async()=>{if(kind==='writer')h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run('another-writer',p.user.id);else if(kind==='role')await h.api('/admin/staff',post(operator,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));else h.sql.prepare("UPDATE world_clock SET revision=revision+1 WHERE id='world-v1'").run();changed=stable(h,p);});
   const rejected=await command(h,p,'send',request,409);assert(changed);assert.equal(rejected.error.code,kind==='writer'?'LEASE_REQUIRED':'GARRISON_STATE_CHANGED');assert.deepEqual(stable(h,p),changed);
  }
 });
 await scope('a branch transfer and a vacant-castle send sharing one revision can debit the same army only once',async h=>{
  const p=await fixture(h,'二経路を同時に使う領主',{startCastle:'himeji'}),before=save(h,p),send=body(h,p,'inuyama',100),branch={from:'army',to:'castle:himeji',troops:100,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:send.expectedRevision,campaignId:send.campaignId,sequence:0};
  let arrived=0,release;const barrier=new Promise(resolve=>release=resolve);
  h.beforeBatch=async statements=>{if(!/INSERT INTO (vacant_garrison_requests|branch_deployment_requests)/.test(statements[0]?.sql||''))return;if(++arrived===2){h.beforeBatch=null;release();}await barrier;};
  const attempts=await Promise.all([h.api('/troop-garrisons/send',post(p,send,null)),h.api('/branches/transfer-troops',post(p,branch,null))]);
  assert.deepEqual(attempts.map(r=>r.response.status).sort(),[200,409]);
  const after=save(h,p);assert.equal(after.state.troops+after.state.castles.himeji.troops+stationed(h,p,'inuyama'),before.state.troops+before.state.castles.himeji.troops);assert.equal(after.state.command,before.state.command-1);assert.equal(after.state.troopTransferSequence,1);assert.equal(movement(h,p)[0].sequence,1);
  assert.equal(receipts(h,p).length+h.sql.prepare('SELECT COUNT(*) n FROM branch_deployment_requests WHERE actor_id=?').get(p.user.id).n,1);
 });
 console.log(JSON.stringify({ok:true,groups:reports.length,calls:reports.reduce((n,r)=>n+r.calls,0),reports,productionRequests:0},null,2));
}finally{globalThis.fetch=originalFetch;}
