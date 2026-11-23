// Real Worker routes and transactional local SQLite. No production services.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness,settleFieldMarch} from './test-support.mjs';
import {fixture,post,row,save} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {maintenanceContext,externalTroopSnapshotStatements} from './maintenance.js';

const reports=[],copy=value=>structuredClone(value);
const account=(h,p)=>h.sql.prepare('SELECT * FROM external_troop_accounts WHERE user_id=?').get(p.user.id);
const history=(h,p)=>h.sql.prepare('SELECT * FROM external_troop_snapshots WHERE user_id=? ORDER BY revision').all(p.user.id);
const currentClock=h=>{const c=h.sql.prepare("SELECT * FROM world_clock WHERE id='world-v1'").get();return{id:c.id,elapsedMs:c.base_elapsed_ms+(c.running?Math.max(0,h.now-c.anchor_real_ms)*c.speed:0),revision:c.revision,running:!!c.running,speed:c.speed};};
const snapshot=async(h,p)=>(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
const envelope=(h,p,more={})=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,...more});
const propose=async(h,a,b,troops,want=0,more={},expected=200)=>(await h.api('/trades',post(a,envelope(h,a,{targetPlayerId:b.user.id,offer:{troops},want:want?{troops:want}:{},...more}),expected))).data;
const tradeAction=async(h,p,id,action,more={},expected=200)=>(await h.api('/trades/'+id+'/'+action,post(p,envelope(h,p,more),expected))).data;
const put=async(h,p,value,more={},expected=200)=>(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value,...more},expected})).data;
const totalResource=(game,key)=>game.state.resources[key]+Number(game.state.realtime.incomeRemainders[key]||0);
const near=(a,b,message)=>assert(Math.abs(a-b)<1e-6,message+': '+a+' vs '+b);
const localState=(h,p)=>copy({save:row(h,p),trades:h.sql.prepare('SELECT * FROM trades ORDER BY id').all(),deliveries:h.sql.prepare('SELECT * FROM trade_deliveries ORDER BY trade_id').all(),requests:h.sql.prepare('SELECT * FROM trade_requests ORDER BY id').all(),account:account(h,p),history:history(h,p)});
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);let maxBindings=0;h.db.batch=statements=>{for(const statement of statements){maxBindings=Math.max(maxBindings,statement.params.length);assert(statement.params.length<=100,'D1 binding limit: '+statement.params.length);}return batch(statements);};try{await run(h);reports.push({name,calls:h.calls,maxBindings});console.log('PASS '+name);}finally{h.close();}}
function insertUnit(h,p,id,troops,{state='returning',retired=0}={}){h.sql.prepare("INSERT INTO alliance_units(id,guild_id,owner_id,owner_epoch,castle_id,kind,state,troops,sent,expires_at,created_at,campaign_retired) VALUES(?,'fixture-guild',?,0,'himeji','aid',?,?,?,?,?,?)").run(id,p.user.id,state,troops,Math.max(1,troops),h.now+3600000,h.now,retired);}

const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Maintenance tests must not contact real services');};
try{
 await scope('deployment baseline seeds offline owners and counts every external ownership pool once',async h=>{
  const a=await fixture(h,'維持費の導入',{startCastle:'himeji'}),b=await fixture(h,'導入時の交易先',{startCastle:'okazaki'}),campaign=save(h,a).state.walking.campaignId;
  await propose(h,a,b,400);
  const refund=await propose(h,a,b,250);await tradeAction(h,a,refund.trade.id,'cancel');
  h.sql.prepare('INSERT INTO vacant_garrisons VALUES(?,?,?,?,?,?)').run(a.user.id,campaign,'inuyama',300,1,h.now);
  h.sql.prepare('INSERT INTO vacant_garrisons VALUES(?,?,?,?,?,?)').run(a.user.id,'old-campaign','takaya',900,1,h.now);
  insertUnit(h,a,'live-unit',500,{state:'stationed'});insertUnit(h,a,'returned-unit',200);insertUnit(h,a,'retired-unit',800,{retired:1});insertUnit(h,a,'claimed-unit',700,{state:'claimed'});
  h.sql.exec('DROP TABLE external_troop_snapshots; DROP TABLE external_troop_accounts; DROP VIEW external_troop_current_counts;');
  h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=7777,anchor_real_ms=?,running=0 WHERE id='world-v1'").run(h.now);
  for(const sql of readFileSync(new URL('./drizzle/0033_external_troop_upkeep.sql',import.meta.url),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))h.sql.exec(sql);
  const baseline=account(h,a);assert.equal(baseline.activated_elapsed_ms,7777);assert.equal(baseline.vacant_troops,300);assert.equal(baseline.trade_troops,650);assert.equal(baseline.alliance_troops,700);assert.equal(history(h,a).length,1);
  const context=await maintenanceContext(h.db,a.user.id,save(h,a),{...currentClock(h),elapsedMs:20000}),g=GameEngine.fromSave(save(h,a),GAME_OFFICERS,{maintenanceAuthority:context.authority});
  assert.equal(g.maintenance().troops.external,0,'rollout is never retroactive');g.applyWorldClock({...currentClock(h),elapsedMs:7777});assert.equal(g.maintenance().troops.external,1650);
  assert(!JSON.stringify(g.exportSave()).includes('maintenanceAuthority'));
 });

 await scope('trade intervals charge escrow and unclaimed proceeds, while transfer checkpoints conserve ownership',async h=>{
  const a=await fixture(h,'交易履歴の領主',{startCastle:'himeji'}),b=await fixture(h,'交易を承認する領主',{startCastle:'okazaki'});
  const sent=await propose(h,a,b,3000,1000),before=save(h,a),senderRow=copy(row(h,a));assert.equal(sent.maintenanceAuthority.baseline.trade,3000);
  h.now+=10000;const accepted=await tradeAction(h,b,sent.trade.id,'accept');assert.equal(accepted.save.state.worldClock.elapsedMs,10000);assert.deepEqual(copy(row(h,a)),senderRow,'a foreign accept does not write the sender save');
  assert.equal(account(h,a).trade_troops,1000);assert.equal(history(h,a).at(-1).effective_elapsed_ms,10000);
  h.now+=15000;const snap=await snapshot(h,a),authority=snap.maintenanceAuthority;
  assert.equal(authority.baseline.trade,3000);assert.deepEqual(authority.changes,[{elapsedMs:10000,vacant:0,trade:1000,alliance:0}]);
  const withExternal=GameEngine.fromSave(before,GAME_OFFICERS,{maintenanceAuthority:authority}),withoutExternal=GameEngine.fromSave(before,GAME_OFFICERS);
  withExternal.applyWorldClock(snap.clock);withoutExternal.applyWorldClock(snap.clock);
  near(totalResource(withoutExternal,'gold')-totalResource(withExternal,'gold'),(3000*10+1000*15)*.04/60,'gold integrates actual holding intervals');
  near(totalResource(withoutExternal,'rice')-totalResource(withExternal,'rice'),(3000*10+1000*15)*.12/60,'rice integrates actual holding intervals');
  await put(h,a,JSON.parse(withExternal.exportSave()),{maintenanceRevision:authority.revision});
  const claimBody=envelope(h,a),claimed=await tradeAction(h,a,sent.trade.id,'claim',claimBody);assert.equal(claimed.save.state.worldClock.elapsedMs,history(h,a).at(-1).effective_elapsed_ms);assert.equal(account(h,a).trade_troops,0);
  const stable=localState(h,a),replayed=await tradeAction(h,a,sent.trade.id,'claim',claimBody);assert(replayed.idempotent);assert.deepEqual(localState(h,a),stable);assert.deepEqual(replayed.maintenanceAuthority,claimed.maintenanceAuthority);
 });

 await scope('stale or missing authority, old checkpoints and forged external counts cannot overwrite canonical state',async h=>{
  const a=await fixture(h,'旧情報の書込',{startCastle:'himeji'}),b=await fixture(h,'外部変更の相手',{startCastle:'okazaki'}),sent=await propose(h,a,b,500),old=copy(sent);
  h.now+=1000;await tradeAction(h,b,sent.trade.id,'accept');const canonical=copy(row(h,a));
  const rejected=await put(h,a,old.save,{maintenanceRevision:old.maintenanceAuthority.revision},409);assert.equal(rejected.error.code,'MAINTENANCE_REFRESH_REQUIRED');assert.deepEqual(copy(row(h,a)),canonical);
  const missing=await h.api('/sync',{method:'PUT',token:a.token,rawBody:JSON.stringify({deviceId:a.deviceId,revision:row(h,a).revision,save:old.save}),expected:409});assert.equal(missing.data.error.code,'MAINTENANCE_REFRESH_REQUIRED');assert(missing.data.error.message.includes('再読み込み'));
  const current=await snapshot(h,a),g=GameEngine.fromSave(current.save,GAME_OFFICERS,{maintenanceAuthority:current.maintenanceAuthority});g.applyWorldClock(current.clock);
  const forged=JSON.parse(g.exportSave());forged.maintenanceAuthority={revision:0};forged.state.maintenanceAuthority={baseline:{trade:0}};forged.state.externalTroops=999999;forged.state.maintenance={external:0};
  const written=await put(h,a,forged,{maintenanceRevision:current.maintenanceAuthority.revision});assert(!Object.hasOwn(written.save,'maintenanceAuthority'));for(const key of ['maintenanceAuthority','externalTroops','maintenance'])assert(!Object.hasOwn(written.save.state,key));
  const beforeRewind=copy(row(h,a)),rewind=await put(h,a,old.save,{maintenanceRevision:written.maintenanceAuthority.revision},409);assert.equal(rewind.error.code,'CLOCK_REWIND');assert.deepEqual(copy(row(h,a)),beforeRewind);
 });

 await scope('seal-only races reject a prepared own transfer and a retry charges the complete pre-transfer interval',async h=>{
  const a=await fixture(h,'時計確定の競合',{startCastle:'himeji'}),b=await fixture(h,'競合時の交易先',{startCastle:'okazaki'}),before=copy(row(h,a)),revision=account(h,a).revision;
  h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO trade_requests'))return;h.beforeBatch=null;h.now+=1000;await maintenanceContext(h.db,a.user.id,save(h,a),currentClock(h));};
  const blocked=await propose(h,a,b,500,0,{},409);assert.equal(blocked.error.code,'TRADE_CHANGED');assert.equal(account(h,a).revision,revision,'a horizon-only change does not fake a count revision');assert.equal(account(h,a).sealed_elapsed_ms,1000);assert.deepEqual(copy(row(h,a)),before);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trades').get().n,0);
  const retry=await propose(h,a,b,500);assert.equal(retry.save.state.worldClock.elapsedMs,1000);assert.equal(history(h,a).at(-1).effective_elapsed_ms,1000);assert.equal(account(h,a).trade_troops,500);
  const context=await maintenanceContext(h.db,a.user.id,JSON.parse(before.save_json),currentClock(h)),control=GameEngine.fromSave(JSON.parse(before.save_json),GAME_OFFICERS,{maintenanceAuthority:context.authority});control.applyWorldClock(currentClock(h));
  assert.deepEqual(retry.save.state.resources,control.state.resources,'all original troops pay until the transfer boundary');
 });

 await scope('a sender seal race retries troop ownership transfer at one shared checkpoint without gaps or overlap',async h=>{
  const a=await fixture(h,'送信者の確定時計',{startCastle:'himeji'}),b=await fixture(h,'受信者の受渡時計',{startCastle:'okazaki'}),sent=await propose(h,a,b,500,200),beforeA=copy(row(h,a)),beforeB=copy(row(h,b)),oldHistory=copy(history(h,a)),requestId=crypto.randomUUID();
  h.now+=1000;
  h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO trade_requests'))return;h.beforeBatch=null;h.now+=1000;await maintenanceContext(h.db,a.user.id,save(h,a),currentClock(h));};
  const blocked=await tradeAction(h,b,sent.trade.id,'accept',{requestId},409);assert.equal(blocked.error.code,'TRADE_CHANGED');assert.deepEqual(copy(row(h,a)),beforeA);assert.deepEqual(copy(row(h,b)),beforeB);assert.deepEqual(copy(history(h,a)),oldHistory);assert.equal(account(h,a).sealed_elapsed_ms,2000);assert.equal(account(h,a).trade_troops,500);assert.equal(h.sql.prepare('SELECT status FROM trades WHERE id=?').get(sent.trade.id).status,'pending');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_deliveries').get().n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_requests').get().n,1);
  const retry=await tradeAction(h,b,sent.trade.id,'accept',{requestId});assert.equal(retry.idempotent,false);assert.equal(retry.save.state.worldClock.elapsedMs,2000);assert.equal(retry.save.state.troops,JSON.parse(beforeB.save_json).state.troops+300);assert.equal(account(h,a).trade_troops,200);assert.equal(history(h,a).at(-1).effective_elapsed_ms,2000);assert.deepEqual(copy(row(h,a)),beforeA,'the offline sender is never overwritten');
  const receiver=GameEngine.fromSave(JSON.parse(beforeB.save_json),GAME_OFFICERS,{maintenanceAuthority:retry.maintenanceAuthority});receiver.applyWorldClock(currentClock(h));assert.deepEqual(retry.save.state.resources,receiver.state.resources,'newly received troops start costing only after the common transfer boundary');
  const ownerSnapshot=await snapshot(h,a),owner=GameEngine.fromSave(ownerSnapshot.save,GAME_OFFICERS,{maintenanceAuthority:ownerSnapshot.maintenanceAuthority}),withoutExternal=GameEngine.fromSave(ownerSnapshot.save,GAME_OFFICERS);owner.applyWorldClock(ownerSnapshot.clock);withoutExternal.applyWorldClock(ownerSnapshot.clock);near(totalResource(withoutExternal,'gold')-totalResource(owner,'gold'),500*.04*2/60,'sender pays the complete two-second escrow interval');near(totalResource(withoutExternal,'rice')-totalResource(owner,'rice'),500*.12*2/60,'sender rice uses the identical transfer boundary');
  const stable=localState(h,b);assert.equal((await tradeAction(h,b,sent.trade.id,'accept',{requestId})).idempotent,true);assert.deepEqual(localState(h,b),stable);
 });

 await scope('concurrent foreign accepts aggregate the final database state and same-time revisions coalesce',async h=>{
  const a=await fixture(h,'並行承認の所有者',{startCastle:'himeji'}),b=await fixture(h,'並行承認の相手一',{startCastle:'okazaki'}),c=await fixture(h,'並行承認の相手二',{startCastle:'inuyama'});
  const one=await propose(h,a,b,500),two=await propose(h,a,c,700),before=copy(row(h,a)),revision=account(h,a).revision;h.now+=1000;
  let arrived=0,release;const barrier=new Promise(resolve=>release=resolve);h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO trade_requests'))return;if(++arrived===2){h.beforeBatch=null;release();}await barrier;};
  await Promise.all([tradeAction(h,b,one.trade.id,'accept'),tradeAction(h,c,two.trade.id,'accept')]);assert.deepEqual(copy(row(h,a)),before);assert.equal(account(h,a).trade_troops,0);assert.equal(account(h,a).revision,revision+2);
  const snap=await snapshot(h,a);assert.deepEqual(snap.maintenanceAuthority.changes,[{elapsedMs:1000,vacant:0,trade:0,alliance:0}]);
  const atTime=history(h,a).filter(e=>e.effective_elapsed_ms===1000);assert.equal(atTime.length,2);assert.equal(atTime.at(-1).trade_troops,0);
 });

 await scope('source updates and upkeep snapshots roll back together, and a failed receipt remains retryable',async h=>{
  const a=await fixture(h,'履歴取引の巻戻し',{startCastle:'himeji'}),b=await fixture(h,'巻戻し時の交易先',{startCastle:'okazaki'}),before=localState(h,a),requestId=crypto.randomUUID();
  h.sql.exec("CREATE TRIGGER fail_maintenance BEFORE INSERT ON external_troop_snapshots WHEN NOT EXISTS(SELECT 1 FROM external_troop_snapshots WHERE user_id=NEW.user_id AND revision=NEW.revision) BEGIN SELECT RAISE(ABORT,'fixture maintenance rollback'); END");
  await propose(h,a,b,500,0,{requestId},500);assert.deepEqual(localState(h,a),before);h.sql.exec('DROP TRIGGER fail_maintenance');
  const retry=await propose(h,a,b,500,0,{requestId});assert.equal(retry.idempotent,false);assert.equal(account(h,a).trade_troops,500);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM trade_requests').get().n,1);
 });

 await scope('vacant troops follow the active campaign and relocation retires alliance troops while retaining trade escrow',async h=>{
  const a=await fixture(h,'拠点移転の維持費',{startCastle:'himeji'}),b=await fixture(h,'移転後も続く交易',{startCastle:'okazaki'}),campaign=save(h,a).state.walking.campaignId;
  await h.api('/troop-garrisons/send',post(a,envelope(h,a,{campaignId:campaign,castleId:'inuyama',troops:300})));await propose(h,a,b,400);insertUnit(h,a,'retire-at-move',500);
  const depleted=save(h,a);depleted.state.resources.gold=1;depleted.state.resources.rice=1;h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(depleted),a.user.id);h.sql.prepare('UPDATE vacant_garrisons SET troops=1000000 WHERE actor_id=?').run(a.user.id);
  h.sql.prepare('INSERT INTO walking_accounts(user_id,total_steps) VALUES(?,12345) ON CONFLICT(user_id) DO UPDATE SET total_steps=12345').run(a.user.id);
  const original=await snapshot(h,a);assert.deepEqual(original.maintenanceAuthority.baseline,{elapsedMs:0,vacant:1000000,trade:400,alliance:500});h.now+=1000;
  const moved=(await h.api('/castles/residency/relocate',post(a,{requestId:crypto.randomUUID(),deviceId:a.deviceId,revision:row(h,a).revision,castleId:'takaya'}))).data;
  assert.equal(moved.save.state.resources.gold,0,'relocation settles old troop costs before capping new assets');assert.equal(moved.save.state.resources.rice,0);assert.equal(moved.save.state.walking.serverSteps,12345);assert.notEqual(moved.save.state.walking.campaignId,campaign);assert.equal(moved.maintenanceAuthority.campaignId,moved.save.state.walking.campaignId);assert.equal(account(h,a).vacant_troops,0);assert.equal(account(h,a).alliance_troops,0);assert.equal(account(h,a).trade_troops,400);assert.equal(h.sql.prepare('SELECT campaign_retired FROM alliance_units WHERE id=?').get('retire-at-move').campaign_retired,1);
  const denied=await put(h,a,original.save,{maintenanceRevision:moved.maintenanceAuthority.revision},409);assert(['CAMPAIGN_RELOCATED','CLOCK_REWIND'].includes(denied.error.code));assert.equal(account(h,a).trade_troops,400);
 });

 await scope('long timelines return explicit resumable horizons instead of dropping fee intervals',async h=>{
  const a=await fixture(h,'長い兵数履歴',{startCastle:'himeji'}),start=account(h,a),count=10005,campaign=save(h,a).state.walking.campaignId;
  h.sql.exec('BEGIN');const insert=h.sql.prepare('INSERT INTO external_troop_snapshots VALUES(?,?,?,?,?,?,?)');for(let i=1;i<=count;i++)insert.run(a.user.id,start.revision+i,i,campaign,0,i%2,0);h.sql.prepare('UPDATE external_troop_accounts SET revision=?,last_effective_elapsed_ms=?,sealed_elapsed_ms=?,trade_troops=? WHERE user_id=?').run(start.revision+count,count,count,count%2,a.user.id);h.sql.exec('COMMIT');
  // Match the source projection to the final fixture count so a read does not
  // add a repair event. The timeline rows are deliberate historical fixtures.
  const b=await fixture(h,'長い履歴の交易先',{startCastle:'okazaki'});h.sql.prepare("INSERT INTO trades(id,sender_id,recipient_id,sender_name,recipient_name,offer_json,want_json,status,revision,created_at,updated_at) VALUES('tr_long_history',?,?,?,?,'{\"troops\":1}','{}','pending',1,?,?)").run(a.user.id,b.user.id,'履歴元','履歴先',h.now,h.now);
  const clock={...currentClock(h),elapsedMs:count+100},context=await maintenanceContext(h.db,a.user.id,save(h,a),clock);assert(context.authority.hasMore);assert.equal(context.authority.changes.length,10000);assert.equal(context.authority.asOfElapsedMs,10000);
  const g=GameEngine.fromSave(save(h,a),GAME_OFFICERS,{maintenanceAuthority:context.authority}),advanced=g.applyWorldClock(clock);assert(advanced.maintenancePending);assert.equal(g.state.worldClock.elapsedMs,10000);
  const rest=await maintenanceContext(h.db,a.user.id,JSON.parse(g.exportSave()),clock);assert.equal(rest.authority.hasMore,undefined);assert.equal(rest.authority.baseline.elapsedMs,10000);assert.equal(rest.authority.changes.length,5);assert.equal(rest.authority.asOfElapsedMs,count+100);assert.equal(history(h,a).length,count+2);
 });

 await scope('staff dismissal preserves its active backup across a partial maintenance checkpoint and restores the personal realm only after the final charged interval',async h=>{
  const operator=await fixture(h,'長期履歴の退任管理',{admin:true}),staff=await fixture(h,'分割処理で退任する領主',{staff:true,startCastle:'himeji'}),initial=await snapshot(h,staff),before=copy(row(h,staff)),start=account(h,staff),count=10005,campaign=initial.save.state.walking.campaignId;
  const backup=()=>h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(staff.user.id),initialBackup=copy(backup()),initialHistoryCount=history(h,staff).length,point=i=>({elapsedMs:i,vacant:0,trade:i%2,alliance:0});
  assert.equal(initial.save.state.home,'kyoto_gosho');assert.equal(initialBackup.active,1);assert.equal(JSON.parse(initialBackup.save_json).state.home,'himeji');
  h.sql.exec('BEGIN');const insert=h.sql.prepare('INSERT INTO external_troop_snapshots VALUES(?,?,?,?,?,?,?)');for(let i=1;i<=count;i++)insert.run(staff.user.id,start.revision+i,i,campaign,0,i%2,0);h.sql.prepare('UPDATE external_troop_accounts SET revision=?,last_effective_elapsed_ms=?,sealed_elapsed_ms=?,trade_troops=? WHERE user_id=?').run(start.revision+count,count,count,count%2,staff.user.id);h.sql.exec('COMMIT');
  h.sql.prepare("INSERT INTO trades(id,sender_id,recipient_id,sender_name,recipient_name,offer_json,want_json,status,revision,created_at,updated_at) VALUES('tr_staff_long_history',?,?,?,?,'{\"troops\":1}','{}','pending',1,?,?)").run(staff.user.id,operator.user.id,'退任前の履歴元','履歴の相手',h.now,h.now);
  h.now+=count+100;const target=currentClock(h),revision=start.revision+count,baseline={elapsedMs:start.activated_elapsed_ms,vacant:start.vacant_troops,trade:start.trade_troops,alliance:start.alliance_troops};
  // An independent staff engine charges the same two history chunks. Private
  // income must not be substituted for the still-unprocessed staff interval.
  const firstAuthority={version:1,campaignId:campaign,activatedElapsedMs:start.activated_elapsed_ms,revision,asOfElapsedMs:10000,baseline,changes:Array.from({length:10000},(_,i)=>point(i+1)),hasMore:true};
  const control=GameEngine.fromSave(initial.save,GAME_OFFICERS,{isStaff:true,staffBase:initial.staffBase,maintenanceAuthority:firstAuthority});assert(control.applyWorldClock(target).maintenancePending);assert.equal(control.state.worldClock.elapsedMs,10000);
  await h.api('/admin/staff',post(operator,{targetPlayerId:staff.user.id,action:'dismiss',requestId:crypto.randomUUID()}));assert.equal(backup().left_elapsed_ms,target.elapsedMs);assert.equal(backup().active,1);assert.equal(save(h,staff).state.home,'kyoto_gosho');
  const pending=(await h.api('/sync?deviceId='+staff.deviceId,{token:staff.token,expected:409})).data;assert.equal(pending.error.code,'STAFF_TRANSITION_PENDING');
  const partial=save(h,staff),partialRow=copy(row(h,staff));assert.equal(partialRow.revision,before.revision+1);assert.equal(partial.state.worldClock.elapsedMs,10000);assert.equal(partial.state.home,'kyoto_gosho');assert.equal(partial.state.clan,initial.save.state.clan);assert.equal(backup().active,1);assert.equal(backup().term_id,initialBackup.term_id);assert.equal(JSON.parse(backup().save_json).state.home,'himeji');assert.deepEqual(partial.state.resources,control.state.resources);
  for(const key of ['gold','rice','wood','stone'])near(partial.state.realtime.incomeRemainders[key],control.state.realtime.incomeRemainders[key],key+' partial carry');
  const rest={...firstAuthority,asOfElapsedMs:target.elapsedMs,baseline:point(10000),changes:Array.from({length:5},(_,i)=>point(10001+i))};delete rest.hasMore;assert(control.setMaintenanceAuthority(rest).ok);assert(control.applyWorldClock(target).changed);
  const restored=await snapshot(h,staff);assert.equal(restored.user.isStaff,false);assert.equal(restored.save.state.home,'himeji');assert.equal(restored.save.state.worldClock.elapsedMs,target.elapsedMs);assert.equal(backup().active,0);assert.equal(backup().left_elapsed_ms,target.elapsedMs);assert.equal(restored.maintenanceAuthority.hasMore,undefined);assert.deepEqual(restored.save.state.resources,control.state.resources,'every remaining millisecond is charged using the staff economy before restoration');
  for(const key of ['gold','rice','wood','stone'])near(restored.save.state.realtime.incomeRemainders[key],control.state.realtime.incomeRemainders[key],key+' final carry');
  assert.equal(history(h,staff).length,initialHistoryCount+count);const stable=copy(row(h,staff)),settledBackup=copy(backup());await snapshot(h,staff);assert.deepEqual(copy(row(h,staff)),stable,'a further GET cannot charge or restore the term twice');assert.deepEqual(copy(backup()),settledBackup);
 });

 await scope('ordinary GET projections preserve the old branch level until its actual completion boundary',async h=>{
  const a=await fixture(h,'完成前の支拠点費',{startCastle:'himeji',holdings:['nijo']}),before=save(h,a),campaign=before.state.walking.campaignId;
  const branch={id:'nijo_north',parentCastleId:'nijo',direction:'north',level:0,fallen:false},job={kind:'branch',id:branch.id,targetLevel:1,total:1,totalSeconds:60,completesElapsedMs:10000};
  h.sql.prepare('INSERT INTO branch_states VALUES(?,?,1,?,0,?)').run(a.user.id,campaign,JSON.stringify({branches:[branch],jobs:[job]}),h.now);
  const oldRow=copy(row(h,a));h.now+=15000;
  for(const path of ['/sync?deviceId=','/branches?deviceId=']){
   const snap=(await h.api(path+a.deviceId,{token:a.token})).data;assert.equal(snap.save.state.worldClock.elapsedMs,0);assert.equal(snap.save.state.branches[0].level,0);assert.equal(snap.save.state.jobs.find(j=>j.kind==='branch').completesElapsedMs,10000);
   const game=GameEngine.fromSave(snap.save,GAME_OFFICERS,{maintenanceAuthority:snap.maintenanceAuthority}),control=GameEngine.fromSave(before,GAME_OFFICERS,{maintenanceAuthority:snap.maintenanceAuthority});game.applyWorldClock(snap.clock);control.applyWorldClock(snap.clock);
   assert.equal(game.state.branches[0].level,1);near(totalResource(control,'gold')-totalResource(game,'gold'),2*5/60,'only five seconds of completed branch gold upkeep');near(totalResource(control,'wood')-totalResource(game,'wood'),5/60,'only five seconds of completed branch wood upkeep');
  }
  await h.api('/field/me?deviceId='+a.deviceId,{token:a.token});assert.deepEqual(copy(row(h,a)),oldRow,'read-only defense projection never replaces a fee checkpoint');
 });

 await scope('alliance aid, casualties, returning troops and claims keep the original owner charged exactly once',async h=>{
  const owner=await fixture(h,'援軍の所有者',{startCastle:'himeji'}),defender=await fixture(h,'援軍の駐屯先',{startCastle:'kiyosu'}),attacker=await fixture(h,'援軍との戦闘',{startCastle:'inuyama'});
  const guild=(await h.api('/guild',post(owner,{name:'維持費の援軍同盟'}))).data.guild.id;await h.api('/guild/join',post(defender,{guildId:guild}));
  const sent=(await h.api('/alliance/reinforcements/send',post(owner,envelope(h,owner,{targetPlayerId:defender.user.id,castleId:'kiyosu',troops:600,hours:6})))).data;assert.equal(account(h,owner).alliance_troops,600);assert.equal(account(h,defender).alliance_troops,0);
  const departure=(await h.api('/field/attack',post(attacker,envelope(h,attacker,{targetPlayerId:defender.user.id,targetCastleId:'kiyosu',troops:3000,tactic:'balanced'})))).data;
  const battle=await settleFieldMarch(h,attacker,departure),remaining=h.sql.prepare('SELECT troops FROM alliance_units WHERE id=?').get(sent.result.unitId).troops;assert(remaining<600);assert.equal(account(h,owner).alliance_troops,remaining);assert.equal(history(h,owner).at(-1).effective_elapsed_ms,battle.occurredElapsedMs);
  const stable=copy(account(h,owner)),revision=stable.revision;await h.api('/alliance/units/recall',post(owner,envelope(h,owner,{unitId:sent.result.unitId})));assert.equal(account(h,owner).revision,revision,'returning troops still belong to their owner');
  const leased=(await h.api('/sync/lease',post(owner,{deviceId:owner.deviceId}))).data,g=GameEngine.fromSave(leased.save,GAME_OFFICERS,{maintenanceAuthority:leased.maintenanceAuthority});g.applyWorldClock(leased.clock);await put(h,owner,JSON.parse(g.exportSave()));
  // Claim capacity remains the alliance API's existing recruitment rule.
  const value=save(h,owner);value.state.troops=0;h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(value),owner.user.id);
  const claimed=(await h.api('/alliance/units/claim',post(owner,envelope(h,owner,{unitId:sent.result.unitId})))).data;assert.equal(claimed.result.receivedTroops,remaining);assert.equal(account(h,owner).alliance_troops,0);assert.equal(history(h,owner).at(-1).effective_elapsed_ms,claimed.save.state.worldClock.elapsedMs);
 });

 await scope('a damaging field battle settles the defender with old troop counts before applying losses and replays once',async h=>{
  const a=await fixture(h,'維持費の攻撃側',{startCastle:'inuyama'}),b=await fixture(h,'維持費の防御側',{startCastle:'kiyosu'}),before=save(h,b);
  const departure=(await h.api('/field/attack',post(a,envelope(h,a,{targetPlayerId:b.user.id,targetCastleId:'kiyosu',troops:3000,tactic:'balanced'})))).data;
  const due={...departure.clock,elapsedMs:departure.march.arrivesAtMs},authority=(await maintenanceContext(h.db,b.user.id,before,due)).authority,control=GameEngine.fromSave(before,GAME_OFFICERS,{maintenanceAuthority:authority});control.applyWorldClock(due,{maxSeconds:86400,deferCycleSettlement:true});
  const battle=await settleFieldMarch(h,a,departure),after=save(h,b);assert.equal(after.state.worldClock.elapsedMs,battle.occurredElapsedMs);assert.equal(after.state.troops,control.state.troops-battle.defenderLost.troops);
  for(const key of ['gold','rice','wood','stone'])assert.equal(after.state.resources[key],control.state.resources[key]-battle.loot[key],key+' charges before casualties');
  const stable=copy(row(h,b));await h.api('/marches?deviceId='+a.deviceId,{token:a.token});assert.deepEqual(copy(row(h,b)),stable);
 });
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({ok:true,groups:reports.length,calls:reports.reduce((n,r)=>n+r.calls,0),reports,productionRequests:0},null,2));
