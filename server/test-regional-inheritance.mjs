import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture as courtFixture,post,row,save,updateSave} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const CYCLE=672*60000,REGIONS=globalThis.SENGOKU_DATA.regionConquest.regions;
const ids=names=>REGIONS.filter(region=>names.includes(region.region)).flatMap(region=>region.castleIds);
const owned=state=>Object.entries(state.castles).filter(([,castle])=>castle.owner===state.clan).map(([id])=>id).sort();
const fields=(payload,player)=>payload.targets.filter(target=>target.playerId===player.user.id).map(target=>target.targetCastleId).sort();
const at=(h,elapsed)=>h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=1,speed=1 WHERE id='world-v1'").run(elapsed,h.now);
const put=(h,p,value,expected=200)=>h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected});
const settle=(h,p,revision=row(h,p).revision)=>h.api('/sync/settle',post(p,{deviceId:p.deviceId,revision}));
const receipts=(h,p)=>h.sql.prepare('SELECT * FROM cycle_receipts WHERE user_id=? ORDER BY cycle_index').all(p.user.id);
async function fixture(h,name,regions,{home='kiyosu',extra=[],prepare=null}={}){
 await h.api('/world-clock');at(h,CYCLE-1000);h.resetRates();
 const player=await h.session(name);player.deviceId='regional-'+player.user.id;
 await h.api('/sync/lease',post(player,{deviceId:player.deviceId}));
 const value=h.fresh(home),s=value.state;s.turn=671;s.realtime.elapsed=59;s.worldClock={id:'world-v1',elapsedMs:CYCLE-1000};
 s.resources={gold:900000,rice:900000,wood:900000,stone:900000};
  for(const key of ['farm','market','lumber','quarry'])s.buildings[key]=32;
 for(const id of [...ids(regions),...extra])s.castles[id].owner=s.clan;
  prepare?.(s);
 const snapshot=(await put(h,player,value)).data;
 return{...player,snapshot};
}
let checks=0,calls=0,maxBindings=0;
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const statement of statements){maxBindings=Math.max(maxBindings,statement.params.length);assert(statement.params.length<=100);}return batch(statements);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Regional tests must not contact production');};
try{
 await scope('complete regions retain the same public holdings before and after settlement, with development and branches',async h=>{
  const p=await fixture(h,'東海四国を引き継ぐ領主',['東海','四国'],{extra:['nijo'],prepare:s=>{s.buildings.keep=16;s.castles.inabayama.level=7;s.castles.inabayama.wall=5;s.castles.inabayama.troops=4321;s.jobs=[{kind:'castle',id:'inabayama',targetLevel:8,total:3,remaining:3,totalSeconds:180,remainingSeconds:180},{kind:'castle',id:'nijo',targetLevel:2,total:3,remaining:3,totalSeconds:180,remainingSeconds:180}];}});
  for(const parentCastleId of ['nagoya','nijo']){
   const status=(await h.api('/branches?deviceId='+p.deviceId,{token:p.token})).data;
   await h.api('/branches/build',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:status.revision,campaignId:status.campaignId,sequence:status.sequence,parentCastleId,direction:'north'}));
  }
  const guild=(await h.api('/guild',post(p,{name:'地域を引き継ぐ軍団'}))).data.guild;
  const before=row(h,p),expected=ids(['東海','四国']).sort();at(h,CYCLE);
  const full=(await h.api('/field?limit=100',{token:p.token})).data,compact=(await h.api('/field?view=owners&limit=100',{token:p.token})).data;
  assert.deepEqual(fields(full,p),expected);assert.deepEqual(fields(compact,p),expected);
  const nagoya=full.targets.find(target=>target.playerId===p.user.id&&target.targetCastleId==='nagoya');assert.equal(nagoya.branches.length,1);
  assert.equal(row(h,p).revision,before.revision);assert.equal(row(h,p).save_json,before.save_json,'Public projections never settle a writer');
  assert.equal((await h.api('/guild/rankings')).data.guilds.find(g=>g.id===guild.id).ownedCastles,expected.length);
  const projected=structuredClone(JSON.parse(before.save_json).state);projected.castles.nijo.owner='在地衆';
  assert.deepEqual(full.players.find(target=>target.playerId===p.user.id).evaluation,GameEngine.publicEvaluation(projected,{officers:GAME_OFFICERS}));
  const result=(await settle(h,p)).data,s=result.save.state;
  assert.deepEqual(s.cycle.retainedRegions,['東海','四国']);assert.deepEqual(owned(s),expected);
  assert.equal(s.castles.inabayama.level,7);assert.equal(s.castles.inabayama.wall,5);assert.equal(s.castles.inabayama.troops,4321);
  assert(s.jobs.some(job=>job.kind==='castle'&&job.id==='inabayama'));assert(!s.jobs.some(job=>job.id==='nijo'));
  assert.deepEqual(s.branches.map(branch=>branch.id),['nagoya_north']);assert(s.jobs.some(job=>job.kind==='branch'&&job.id==='nagoya_north'));
  assert.equal(receipts(h,p).length,1);assert.equal(receipts(h,p)[0].captured,expected.length,'Closing reward includes all 24 retained non-home castles and the surrendered Nijo');
  assert(expected.every(id=>s.captureRewards.includes(id)),'Retained castles cannot earn another first-capture reward');
  assert.deepEqual(fields((await h.api('/field?limit=100',{token:p.token})).data,p),expected);
  assert.deepEqual(fields((await h.api('/field?view=owners&limit=100',{token:p.token})).data,p),expected);
  assert.equal((await h.api('/config')).data.features.regionalInheritance,true);
 });
 await scope('protected cities do not prevent regional completion or grant forbidden ownership',async h=>{
  const p=await fixture(h,'保護城を除いて制覇',['関東','近畿','九州']);at(h,CYCLE);
  const result=(await settle(h,p)).data,s=result.save.state;
  assert.deepEqual(s.cycle.retainedRegions,['関東','近畿','九州']);
  assert.deepEqual(owned(s),['kiyosu',...ids(['関東','近畿','九州'])].sort());
  for(const id of ['edo','kyoto_gosho','kagoshima'])assert.notEqual(s.castles[id].owner,s.clan);
  assert.deepEqual(fields((await h.api('/field?limit=100',{token:p.token})).data,p),fields((await h.api('/field?view=owners&limit=100',{token:p.token})).data,p));
 });
 await scope('inheriting all nine regions preserves server-normalized unification and its proof',async h=>{
  const p=await fixture(h,'全地方を受け継ぐ領主',REGIONS.map(region=>region.region));at(h,CYCLE);
  const result=(await settle(h,p)).data;
  assert.equal(result.save.state.won,true);assert.equal(owned(result.save.state).length,126);assert.equal(result.save.state.cycle.retainedRegions.length,9);
  assert.equal(GameEngine.fromSave(result.save,GAME_OFFICERS).getUnificationProof().achieved,true);
  const persisted=(await put(h,p,result.save)).data;assert.equal(persisted.save.state.won,true);assert.equal(GameEngine.fromSave(persisted.save,GAME_OFFICERS).getUnificationProof().achieved,true);
  assert.equal(fields((await h.api('/field?limit=100',{token:p.token})).data,p).length,126);
  assert.equal(fields((await h.api('/field?view=owners&limit=100',{token:p.token})).data,p).length,126);
 });
 await scope('an inherited metropolitan garrison remains the named event defender while settlement is pending',async h=>{
  const owner=await fixture(h,'近畿を守る領主',['近畿']),admin=await h.session('継承地の合戦主催者');
  await h.api('/admin/claim',{method:'POST',token:admin.token,body:{key:h.env.SENGOKU_ADMIN_KEY}});
  const draft=(await h.api('/admin/events/generate',post(admin,{battleId:'castle:nijo',durationDays:1,requestId:crypto.randomUUID()}))).data;
  const published=(await h.api('/admin/events/'+draft.event.id+'/publish',post(admin,{requestId:crypto.randomUUID()}))).data;at(h,CYCLE);
  const before=row(h,owner).save_json,event=(await h.api('/events/'+published.event.id,{token:owner.token})).data;
  assert.equal(event.event.opponent.castleOwnerId,owner.user.id);assert.equal(event.event.opponent.castleId,'nijo');
  const field=(await h.api('/field?limit=100',{token:owner.token})).data.targets.find(target=>target.playerId===owner.user.id&&target.targetCastleId==='nijo');
  assert.equal(event.event.opponent.defensePower,field.defensePower);assert.equal(row(h,owner).save_json,before);
 });
 await scope('a retainer with a conquered region remains in both paginated field directories at the boundary',async h=>{
  const lord=await fixture(h,'本拠の城主',[]),retainer=await fixture(h,'地方を治める家臣',['四国']);at(h,CYCLE);
  assert.equal(h.sql.prepare('SELECT lord_user_id FROM castle_seats WHERE castle_id=?').get('kiyosu').lord_user_id,lord.user.id);
  const full=(await h.api('/field?limit=100',{token:lord.token})).data,compact=(await h.api('/field?view=owners&limit=100',{token:lord.token})).data;
  assert.equal(full.total,2);assert.equal(new Set(compact.targets.map(target=>target.playerId)).size,2);assert.deepEqual(fields(full,retainer),ids(['四国']).sort());assert.deepEqual(fields(compact,retainer),fields(full,retainer));
  const first=(await h.api('/field?view=owners&limit=1',{token:lord.token})).data;assert(first.nextCursor);
  const second=(await h.api('/field?view=owners&limit=1&cursor='+first.nextCursor,{token:lord.token})).data;
  assert.equal(second.nextCursor,null);assert.deepEqual([...first.targets,...second.targets].map(target=>target.playerId+':'+target.targetCastleId).sort(),compact.targets.map(target=>target.playerId+':'+target.targetCastleId).sort());
 });
 await scope('old clients cannot erase the inherited map, while normal territorial loss remains possible',async h=>{
  const p=await fixture(h,'古い保存に戻さない領主',['東海']);at(h,CYCLE);const result=(await settle(h,p)).data;
  const legacy=structuredClone(result.save);delete legacy.state.cycle.retainedRegions;
  for(const [id,castle]of Object.entries(legacy.state.castles))if(id!==legacy.state.home&&castle.owner===legacy.state.clan)castle.owner='在地衆';
  const previous=row(h,p).save_json,rejected=await put(h,p,legacy,409);assert.equal(rejected.data.error.code,'REGION_INHERITANCE_REQUIRED');assert.equal(row(h,p).save_json,previous);
  const forged=structuredClone(result.save);forged.state.cycle.retainedRegions=[];assert.equal((await put(h,p,forged,409)).data.error.code,'REGION_INHERITANCE_REQUIRED');
  const lost=structuredClone(result.save);lost.state.castles.inabayama.owner='斎藤家';const accepted=(await put(h,p,lost)).data;
  assert.equal(accepted.save.state.castles.inabayama.owner,'斎藤家');assert.deepEqual(accepted.save.state.cycle.retainedRegions,['東海']);assert.equal(receipts(h,p).length,1);
  const stale=await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:accepted.revision,save:p.snapshot.save},expected:409});assert(['CLOCK_REWIND','CYCLE_SETTLEMENT_REQUIRED'].includes(stale.data.error.code));
 });
 await scope('regional settlement commits exactly once under concurrent requests and rolls back atomically on failure',async h=>{
  const p=await fixture(h,'同時精算する領主',['四国']);at(h,CYCLE);const revision=row(h,p).revision;let entered=0,release;const barrier=new Promise(resolve=>{release=resolve;});
  h.beforeBatch=async statements=>{if(statements[0]?.sql.includes('NOT EXISTS(SELECT 1 FROM cycle_receipts')){entered++;if(entered===2)release();await barrier;}};
  const [a,b]=await Promise.all([settle(h,p,revision),settle(h,p,revision)]);h.beforeBatch=null;
  assert.equal(entered,2);assert.deepEqual(a.data.save,b.data.save);assert.equal(receipts(h,p).length,1);assert.deepEqual(a.data.save.state.cycle.retainedRegions,['四国']);
  const q=await fixture(h,'精算障害から復帰',['東海']);at(h,CYCLE);const old=row(h,q).save_json;
  h.sql.exec("CREATE TRIGGER reject_regional_cycle BEFORE INSERT ON cycle_receipts BEGIN SELECT RAISE(ABORT,'regional settlement unavailable'); END");
  await h.api('/sync/settle',post(q,{deviceId:q.deviceId,revision:row(h,q).revision},500));assert.equal(row(h,q).save_json,old);assert.equal(receipts(h,q).length,0);
  h.sql.exec('DROP TRIGGER reject_regional_cycle');assert.deepEqual((await settle(h,q)).data.save.state.cycle.retainedRegions,['東海']);
 });
 await scope('multi-cycle catch-up pays each inherited region once per completed cycle without replay grants',async h=>{
  const p=await fixture(h,'長期不在の領主',['四国']),admin=await h.session('周回を守る管理者');
  await h.api('/admin/claim',{method:'POST',token:admin.token,body:{key:h.env.SENGOKU_ADMIN_KEY}});
  h.sql.prepare('INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) VALUES(?,?,?,?,?)').run('chunagon',p.user.id,crypto.randomUUID(),admin.user.id,h.now);
  h.now+=31000;at(h,CYCLE*5);let current=(await h.api('/sync',{token:p.token})).data;
  assert(current.save.state.cycle.index<=2,'One catch-up is bounded to two cycles');
  for(let i=0;i<5&&current.save.state.cycle.index<5;i++)current=(await h.api('/sync',{token:p.token})).data;
  assert.equal(current.save.state.cycle.index,5);assert.deepEqual(current.save.state.cycle.retainedRegions,['四国']);
  const ledger=receipts(h,p);assert.equal(ledger.length,5);assert.deepEqual(ledger.map(receipt=>receipt.cycle_index),[0,1,2,3,4]);assert(ledger.every(receipt=>receipt.captured===ids(['四国']).length&&receipt.gold===10000&&receipt.magatama===1000));
  const revision=current.revision;await h.api('/sync',{token:p.token});assert.equal(row(h,p).revision,revision);assert.equal(receipts(h,p).length,5);
 });
 await scope('voluntary Kyoto admission surrenders inherited holdings and blocks their retired campaign from returning',async h=>{
  await courtFixture(h,'継承放棄の受入責任者',{admin:true});const p=await courtFixture(h,'領地を放棄して入る領主',{score:35000});
  updateSave(h,p,s=>{for(const id of ids(['東海']))s.castles[id].owner=s.clan;s.cycle.retainedRegions=['東海'];});
  const old=save(h,p),details=(await h.api('/court/membership',{token:p.token})).data.membership;
  const joined=(await h.api('/court/membership',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:details.expectedRevision,expectedHomeCastleId:details.homeCastleId,confirmed:true}))).data;
  assert.deepEqual(joined.save.state.cycle.retainedRegions,[]);assert.deepEqual(owned(joined.save.state),['kyoto_gosho']);
  const backup=JSON.parse(h.sql.prepare('SELECT save_json FROM staff_campaign_backups WHERE user_id=?').get(p.user.id).save_json);assert.deepEqual(backup.state.cycle.retainedRegions,[]);
  for(const view of ['/field?limit=100','/field?view=owners&limit=100'])assert.deepEqual(fields((await h.api(view,{token:p.token})).data,p),['kyoto_gosho']);
  assert.equal((await put(h,p,old,409)).data.error.code,'CAMPAIGN_RELOCATED');
 });
 console.log(JSON.stringify({ok:true,checks,calls,maxBindings}));
}finally{globalThis.fetch=originalFetch;}
