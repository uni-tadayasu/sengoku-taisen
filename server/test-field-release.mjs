import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const CASTLES=globalThis.SENGOKU_DATA.castles,CYCLE=672*60000;
let checks=0,calls=0,maxBindings=0;
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100,'D1 bind limit: '+s.params.length);}return batch(statements);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const body=(h,p,castleId,extra={})=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,castleId,confirmed:true,...extra});
const release=(h,p,request,expected=200,query='')=>h.api('/field/release'+query,post(p,request,expected));
const count=h=>h.sql.prepare('SELECT COUNT(*) AS n FROM field_release_requests').get().n;
const branchRow=(h,p)=>h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,save(h,p).state.walking.campaignId);
async function branch(h,p,parentCastleId){return h.api('/branches/build',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId,sequence:branchRow(h,p)?.sequence||0,parentCastleId,direction:'north'}));}
const snapshot=h=>JSON.stringify(['field_release_requests','player_saves','branch_states','covert_states','staff_campaign_backups','vacant_garrisons'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all()]));
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Release tests must not contact real services');};
try{
 await scope('release requires authentication, explicit confirmation, ownership and a non-home ordinary holding',async h=>{
  await h.api('/field/release',{method:'POST',body:{},expected:401});const p=await fixture(h,'返還資格の領主',{holdings:['nijo']});
  const request=body(h,p,'nijo');
  for(const bad of [{...request,confirmed:false},{...request,confirmed:undefined},{...request,castleId:'missing'},{...request,castleId:'__proto__'},{...request,cost:0},{...request,expectedRevision:-1},{...request,deviceId:'bad/device'}])await release(h,p,bad,400);
  assert.equal((await release(h,p,body(h,p,'kiyosu'),409)).data.error.code,'FIELD_RELEASE_HOME');
  assert.equal((await release(h,p,body(h,p,'odani'),409)).data.error.code,'FIELD_RELEASE_NOT_OWNED');
  for(const castleId of ['edo','kyoto_gosho','kagoshima'])assert.equal((await release(h,p,body(h,p,castleId),409)).data.error.code,'FIELD_RELEASE_PROTECTED');
  const before=snapshot(h);await release(h,p,request,404,'?receipt=1');assert.equal(snapshot(h),before);assert.equal(count(h),0);
 });
 await scope('major holding release removes only its castle and branch jobs and pays no refund or reward',async h=>{
  const p=await fixture(h,'大都市を手放す領主',{holdings:['nijo','osaka']});
  await branch(h,p,'nijo');await branch(h,p,'osaka');
  updateSave(h,p,s=>{s.castles.nijo={owner:s.clan,troops:1234,level:8,wall:6};s.castles.osaka.level=7;s.captureRewards=[...new Set([...s.captureRewards,'nijo'])];s.jobs.push({kind:'castle',id:'nijo',targetLevel:9,total:1,remaining:1,totalSeconds:60,remainingSeconds:47},{kind:'castle',id:'osaka',targetLevel:8,total:1,remaining:1,totalSeconds:60,remainingSeconds:47});});
  const before=save(h,p),request=body(h,p,'nijo'),result=(await release(h,p,request)).data,after=result.save,def=CASTLES.find(c=>c.id==='nijo');
  assert.deepEqual(after.state.castles.nijo,{owner:def.clan===after.state.clan?'在地衆':def.clan,troops:def.initialTroops,wall:def.wall,level:1});
  assert.equal(result.release.castleId,'nijo');assert.equal(result.release.removedBranchCount,1);assert.equal(result.release.lostTroops,1234);assert.equal(result.release.idempotent,false);
  assert.deepEqual(after.state.resources,before.state.resources);assert.equal(after.state.magatama,before.state.magatama);assert.equal(after.state.troops,before.state.troops);assert.deepEqual(after.state.captureRewards,before.state.captureRewards);
  assert.equal(after.state.home,before.state.home);assert.equal(after.state.castles.osaka.owner,after.state.clan);assert(after.state.jobs.some(j=>j.kind==='castle'&&j.id==='osaka'));assert(after.state.branches.some(b=>b.parentCastleId==='osaka'));
  assert(!after.state.jobs.some(j=>j.id==='nijo'||j.id==='nijo_north'));assert(!JSON.parse(branchRow(h,p).state_json).branches.some(b=>b.parentCastleId==='nijo'));assert.deepEqual(after.state.cycle.releasedCastles,['nijo']);
  const committed=snapshot(h);assert.equal((await release(h,p,request,200,'?receipt=1')).data.release.idempotent,true);assert.equal(snapshot(h),committed);
  await release(h,p,{...request,castleId:'osaka'},409);assert.equal(count(h),1);
 });
 await scope('releasing a protected castle keeps every other protected holding through sync and the next cycle',async h=>{
  const region=globalThis.SENGOKU_DATA.regionConquest.regions.find(r=>r.region==='九州'),p=await fixture(h,'保護地域を返還する領主',{holdings:region.castleIds}),target=region.castleIds.find(id=>id!=='kagoshima'),before=save(h,p);
  const result=(await release(h,p,body(h,p,target))).data;assert.deepEqual(result.save.state.cycle.protectedRegions,['九州']);assert.deepEqual(result.save.state.cycle.releasedCastles,[target]);
  for(const id of region.castleIds)assert.equal(result.save.state.castles[id].owner===result.save.state.clan,id!==target,id);
  const put=(value,expected)=>h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected});
  await put(before,409);
  for(const change of [s=>s.cycle.releasedCastles=[],s=>s.cycle.releasedCastles.push('azuchi'),s=>s.castles[target].owner=s.clan]){const fake=structuredClone(result.save);change(fake.state);await put(fake,409);}
  const map=(await h.api('/field?limit=100',{token:p.token})).data.targets.filter(t=>t.playerId===p.user.id);assert(!map.some(t=>t.targetCastleId===target));assert(map.filter(t=>region.castleIds.includes(t.targetCastleId)).every(t=>t.regionProtected));
  h.now+=31000;h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1 WHERE id='world-v1'").run(CYCLE,h.now);
  await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));const settled=(await h.api('/sync/settle',post(p,{deviceId:p.deviceId,revision:row(h,p).revision}))).data;
  assert(settled.save.state.cycle.releasedCastles.includes(target));assert.notEqual(settled.save.state.castles[target].owner,settled.save.state.clan);for(const id of region.castleIds.filter(id=>id!==target))assert.equal(settled.save.state.castles[id].owner,settled.save.state.clan,id);
 });
 await scope('unassigned covert reserves and the owner depot are lost once without leaving a second troop balance',async h=>{
  const p=await fixture(h,'城兵と足軽の返還者',{holdings:['nijo']}),campaignId=save(h,p).state.walking.campaignId,covert=GameEngine.normalizeCovertState(undefined,campaignId);covert.sequence=1;covert.reserves.nijo=200;
  h.sql.prepare('INSERT INTO covert_states(actor_id,campaign_id,sequence,state_json,updated_at) VALUES(?,?,?,?,?)').run(p.user.id,campaignId,1,JSON.stringify(covert),h.now);
  h.sql.prepare('INSERT INTO vacant_garrisons(actor_id,campaign_id,castle_id,troops,sequence,updated_at) VALUES(?,?,?,?,1,?)').run(p.user.id,campaignId,'nijo',300,h.now);
  const request=body(h,p,'nijo'),troops=save(h,p).state.castles.nijo.troops,result=(await release(h,p,request)).data;
  assert.equal(result.release.lostTroops,troops+500);assert.equal(result.save.state.covert.reserves.nijo,0);assert.equal(result.save.state.covert.sequence,2);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM vacant_garrisons WHERE actor_id=?').get(p.user.id).n,0);
  assert.equal(JSON.parse(h.sql.prepare('SELECT state_json FROM covert_states WHERE actor_id=?').get(p.user.id).state_json).reserves.nijo,0);
  const stored=snapshot(h);await release(h,p,request);assert.equal(snapshot(h),stored);
 });
 await scope('related stationed units block a release, including a unit appearing immediately before commit',async h=>{
  const owner=await fixture(h,'援軍を送る領主'),p=await fixture(h,'援軍のいる城主',{holdings:['nijo']}),request=body(h,p,'nijo');
  const add=()=>h.sql.prepare("INSERT INTO alliance_units(id,guild_id,owner_id,owner_epoch,target_id,target_epoch,castle_id,kind,state,troops,sent,expires_at,created_at) VALUES(?,?,?,0,?,0,'nijo','aid','stationed',100,100,?,?)").run(crypto.randomUUID(),'fixture-guild',owner.user.id,p.user.id,h.now+60000,h.now);
  add();assert.equal((await release(h,p,request,409)).data.error.code,'FIELD_RELEASE_UNITS_PENDING');assert.equal(count(h),0);
  h.sql.prepare('DELETE FROM alliance_units').run();h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO field_release_requests')))return;h.beforeBatch=null;add();};
  assert.equal((await release(h,p,request,409)).data.error.code,'FIELD_RELEASE_UNITS_PENDING');assert.equal(count(h),0);assert.equal(save(h,p).state.castles.nijo.owner,save(h,p).state.clan);
 });
 await scope('writer, revision, role, branch and account races never release a castle',async h=>{
  const admin=await fixture(h,'返還の監査者',{admin:true});
  for(const kind of ['revision','role','branch','ban']){
   const p=await fixture(h,'返還競合'+kind,{holdings:['nijo']});if(kind==='branch')await branch(h,p,'nijo');const request=body(h,p,'nijo'),beforeCount=count(h);
   h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO field_release_requests')))return;h.beforeBatch=null;
    if(kind==='revision')updateSave(h,p,s=>{s.resources.gold--;});
    if(kind==='role')h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,0)').run(p.user.id,admin.user.id,h.now,crypto.randomUUID());
    if(kind==='branch')h.sql.prepare('UPDATE branch_states SET sequence=sequence+1 WHERE actor_id=?').run(p.user.id);
    if(kind==='ban')h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?)').run(p.user.id,admin.user.id,h.now,h.now);
   };
   await release(h,p,request,kind==='ban'?403:409);assert.equal(count(h),beforeCount);assert.equal(save(h,p).state.castles.nijo.owner,save(h,p).state.clan);
  }
  const p=await fixture(h,'別端末の城主',{holdings:['nijo']}),request=body(h,p,'nijo');await release(h,p,{...request,deviceId:'other-device'},409);await release(h,p,{...request,expectedRevision:0},409);
 });
 await scope('receipt failures and duplicate confirmations preserve atomic ownership changes',async h=>{
  const p=await fixture(h,'原子返還の城主',{holdings:['nijo']}),request=body(h,p,'nijo'),before=snapshot(h);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO field_release_requests')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_release_table SET value=1'));};
  await release(h,p,request,500);assert.equal(snapshot(h),before);
  let entered=0,releaseBarrier;const barrier=new Promise(resolve=>releaseBarrier=resolve);h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO field_release_requests')))return;if(++entered===2){h.beforeBatch=null;releaseBarrier();}await barrier;};
  const results=await Promise.all([release(h,p,request),release(h,p,request)]);assert.deepEqual(results.map(r=>r.data.release.idempotent).sort(),[false,true]);assert.equal(count(h),1);
 });
 await scope('lost responses recover and old receipts cannot release a later recaptured campaign',async h=>{
  const p=await fixture(h,'応答復元の城主',{holdings:['nijo']}),request=body(h,p,'nijo');
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO field_release_requests')))return;h.afterBatch=null;throw Error('release response lost');};
  await release(h,p,request,500);assert.equal(count(h),1);assert.equal((await release(h,p,request,200,'?receipt=1')).data.release.idempotent,true);
  updateSave(h,p,s=>{s.walking.campaignId=crypto.randomUUID();s.castles.nijo.owner=s.clan;s.cycle.releasedCastles=[];s.covert=GameEngine.normalizeCovertState(undefined,s.walking.campaignId);s.roaming=GameEngine.normalizeRoamingState(undefined,s.walking.campaignId);});
  const before=save(h,p),replay=(await release(h,p,request,200,'?receipt=1')).data;assert.equal(replay.release.idempotent,true);assert.deepEqual(save(h,p),before);assert.equal(replay.save.state.castles.nijo.owner,replay.save.state.clan);
 });
 await scope('a Kyoto member can release its former personal home without restoring it from the return backup',async h=>{
  const admin=await fixture(h,'御所返還の責任者',{admin:true}),p=await fixture(h,'元の城を手放す公家',{startCastle:'inuyama',holdings:['nijo'],staff:true});
  assert.equal(save(h,p).state.home,'kyoto_gosho');const request=body(h,p,'inuyama'),result=(await release(h,p,request)).data;
  assert.notEqual(result.save.state.castles.inuyama.owner,result.save.state.clan);assert(result.save.state.cycle.releasedCastles.includes('inuyama'));
  const backup=JSON.parse(h.sql.prepare('SELECT save_json FROM staff_campaign_backups WHERE user_id=?').get(p.user.id).save_json);assert.notEqual(backup.state.home,'inuyama');assert.notEqual(backup.state.castles.inuyama.owner,backup.state.clan);assert(backup.state.cycle.releasedCastles.includes('inuyama'));
  await h.api('/admin/staff',post(admin,{requestId:crypto.randomUUID(),targetPlayerId:p.user.id,action:'dismiss'}));const restored=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
  assert.equal(restored.user.isStaff,false);assert.notEqual(restored.save.state.home,'inuyama');assert.notEqual(restored.save.state.castles.inuyama.owner,restored.save.state.clan);assert(restored.save.state.cycle.releasedCastles.includes('inuyama'));
 });
 await scope('an incoming siege cancels after the owner releases its target without creating a defender battle',async h=>{
  const a=await fixture(h,'返還城へ向かう領主',{startCastle:'inuyama'}),d=await fixture(h,'到着前に返還する領主',{holdings:['nijo']});
  const departure=(await h.api('/field/attack',post(a,{requestId:crypto.randomUUID(),deviceId:a.deviceId,expectedRevision:row(h,a).revision,targetPlayerId:d.user.id,targetCastleId:'nijo',troops:3000,tactic:'balanced'}))).data;
  await release(h,d,body(h,d,'nijo'));h.now+=departure.march.remainingMs;
  const arrived=(await h.api('/marches?deviceId='+a.deviceId,{token:a.token})).data,receipt=arrived.history.find(r=>r.id===departure.march.id);
  assert.equal(receipt.status,'cancelled');assert.equal(receipt.battle,null);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM field_battles').get().n,0);assert.notEqual(save(h,d).state.castles.nijo.owner,save(h,d).state.clan);
 });
 console.log(`Field release: ${checks} scenarios, ${calls} API calls, max ${maxBindings} D1 bindings`);
}finally{globalThis.fetch=originalFetch;}
