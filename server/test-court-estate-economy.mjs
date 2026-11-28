import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,appoint,nominateSuccessor,certifySuccessor} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {COURT_OFFICES} from './court-offices.js';

let checks=0,calls=0,maxBindings=0;
const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Court estate economy tests must remain local');};
async function scope(name,run){const h=harness(),statement=h.db.statement;h.db.statement=function(sql,args){maxBindings=Math.max(maxBindings,args.length);assert(args.length<=100,'D1 parameter limit');return statement.call(this,sql,args);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function setup(h){const admin=await fixture(h,'領地効果の太政大臣',{admin:true}),p=await fixture(h,'一般城の役職者',{startCastle:'inuyama'});return{admin,p};}
async function regent(h,p,action='appoint'){const current=(await h.api('/admin/court/regent',{token:h.operator.token})).data;return h.api('/admin/court/regent',post(h.operator,{requestId:crypto.randomUUID(),action,targetPlayerId:p.user.id,expectedRevision:current.revision}));}
async function office(h,p,officeId='chunagon',action='appoint'){const current=(await h.api('/admin/court/offices',{token:h.operator.token})).data;return h.api('/admin/court/offices',post(h.operator,{requestId:crypto.randomUUID(),action,officeId,targetPlayerId:p.user.id,expectedRevision:current.revision}));}
const snapshot=async(h,p)=>(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
const lease=async(h,p)=>(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
const ledger=(h,p)=>h.sql.prepare('SELECT * FROM court_estate_accounts WHERE user_id=?').get(p.user.id);
function engine(s,projection=s.courtEstateProjection){return GameEngine.fromSave(s.save,GAME_OFFICERS,{isAdmin:s.user.isAdmin,isStaff:s.user.isStaff,isDeputy:s.user.isDeputy,isCourtProtected:!!s.entitlements.courtProtected,staffBase:s.staffBase,maintenanceAuthority:s.maintenanceAuthority,courtEstateProjection:projection});}
async function catchUp(h,p){const s=await lease(h,p),g=engine(s),result=g.applyWorldClock(s.clock);assert(result.ok&&!result.pending&&!result.courtEstatePending);return{snapshot:s,game:g,body:{deviceId:p.deviceId,revision:s.revision,maintenanceRevision:s.maintenanceAuthority.revision,courtEstateProof:s.courtEstateProjection?.proof,save:JSON.parse(g.exportSave())}};}
const economy=g=>({gross:g.income().gross,baseRice:g.income().rankRiceBonus.baseRice,upkeep:g.maintenance().facilityUpkeep,capacity:g.troopCapacity(),cost:g.costs('farm'),commandMax:g.commandMax(),slots:g.constructionSlots()});

try{
 await scope('ordinary role has exactly one normal castle economy and no extra facility set or private ownership',async h=>{
  const{p}=await setup(h),before=structuredClone(save(h,p).state);assert.equal((await snapshot(h,p)).courtEstateProjection,null);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_estate_accounts').get().n,0);
  await regent(h,p);const s=await snapshot(h,p),g=engine(s),ordinary=engine(s,null),reference=engine(s,null),extra=globalThis.SENGOKU_DATA.castles.find(c=>!['edo','kyoto_gosho','kagoshima'].includes(c.id)&&reference.state.castles[c.id].owner!==reference.state.clan);
  reference.state.castles[extra.id]={...reference.state.castles[extra.id],owner:reference.state.clan,level:1,troops:0};
  const actual=economy(g),expected=economy(reference);assert.deepEqual(actual.gross,expected.gross);assert.equal(actual.baseRice,expected.baseRice);assert.deepEqual(actual.upkeep,expected.upkeep);assert.equal(actual.capacity,expected.capacity);assert.deepEqual(actual.cost,expected.cost);assert.equal(actual.commandMax,ordinary.commandMax());assert.equal(actual.slots,ordinary.constructionSlots());
  assert.deepEqual(g.courtEstateEffects(),{active:true,castleId:'kyoto_gosho',castleLevel:1,holdingCount:1,baseIncome:{gold:100,rice:170,wood:40,stone:30},baseTroopCapacity:500,facilityUpkeep:{gold:2,rice:61,wood:1,stone:1}});
  assert.equal(g.upgradeCastleCount(),ordinary.upgradeCastleCount()+1);assert.deepEqual(g.ownedCastleIds(),ordinary.ownedCastleIds());assert(!g.ownedCastleIds().includes('kyoto_gosho'));assert.deepEqual(g.state.buildings,before.buildings);assert.equal(g.state.home,before.home);assert.equal(g.state.clan,before.clan);
  const exported=JSON.parse(g.exportSave());assert.deepEqual(exported.state.castles,before.castles);assert(!Object.hasOwn(exported.state,'courtEstateProjection'));assert(!JSON.stringify(exported).includes(s.courtEstateProjection.proof));
  const dto=(await h.api('/court/estate',{token:p.token})).data;assert.deepEqual(dto.courtEstate.effects,g.courtEstateEffects());assert.equal(dto.courtEstateProjection.proof,s.courtEstateProjection.proof);
 });
 await scope('appointment and revocation record exact world intervals while the holder stays offline',async h=>{
  const{p}=await setup(h);h.now+=30000;await regent(h,p);assert.equal(ledger(h,p).last_effective_elapsed_ms,30000);assert.equal(JSON.parse(h.sql.prepare("SELECT state_json FROM staff_base WHERE id='kyoto_gosho'").get().state_json).createdElapsedMs,30000);
  h.now+=30000;const first=await snapshot(h,p),proof=first.courtEstateProjection.proof;assert.deepEqual(first.courtEstateProjection.accessWindows,[{fromElapsedMs:30000,toElapsedMs:null}]);
  h.now+=30000;await regent(h,p,'dismiss');assert.equal(ledger(h,p).last_effective_elapsed_ms,90000);
  h.now+=60000;await regent(h,p);h.now+=30000;const last=await snapshot(h,p),projection=last.courtEstateProjection;
  assert.deepEqual(projection.accessWindows,[{fromElapsedMs:30000,toElapsedMs:90000},{fromElapsedMs:150000,toElapsedMs:null}]);assert.notEqual(projection.proof,proof);assert.equal(projection.revision,3);assert.equal(projection.asOfElapsedMs,180000);
  const game=engine(last);for(const[at,active]of [[0,false],[29999,false],[30000,true],[89999,true],[90000,false],[149999,false],[150000,true],[180000,true]]){game.state.turn=Math.floor(at/60000);game.state.realtime.elapsed=at%60000/1000;game.state.worldClock.elapsedMs=at;assert.equal(game.courtEstateEffects().active,active,'interval at '+at);}
  const again=await snapshot(h,p);assert.equal(again.courtEstateProjection.proof,projection.proof);assert.equal(ledger(h,p).revision,3,'reads do not create appointment revisions');
 });
 await scope('paused world changes roles at one game-time boundary without elapsed-time earnings',async h=>{
  const{p}=await setup(h);h.now+=10000;const clock=(await h.api('/world-clock')).data.clock;await h.api('/world-clock',{...post(h.operator,{running:false,speed:1,revision:clock.revision}),method:'PATCH'});
  await regent(h,p);h.now+=100000;await regent(h,p,'dismiss');assert.equal(ledger(h,p).last_effective_elapsed_ms,10000);assert.deepEqual((await snapshot(h,p)).courtEstateProjection.accessWindows,[]);
 });
 await scope('all six external offices, appointed deputy and retired Emperor reuse the same economic grant',async h=>{
  const{admin,p}=await setup(h);for(const def of COURT_OFFICES){h.resetRates();await office(h,p,def.id);assert.equal(engine(await snapshot(h,p)).courtEstateEffects().active,true,def.id);await office(h,p,def.id,'dismiss');assert.equal(engine(await snapshot(h,p)).courtEstateEffects().active,false,def.id);}
  const deputy=(await h.api('/admin/deputy',{token:admin.token})).data;await h.api('/admin/deputy',post(admin,{requestId:crypto.randomUUID(),action:'appoint',targetPlayerId:p.user.id,expectedRevision:deputy.revision}));await office(h,p);const appointed=await snapshot(h,p);assert.equal(appointed.user.isDeputy,true);assert.equal(engine(appointed).courtEstateEffects().active,true);
  const emperor=await fixture(h,'領地効果の天皇',{staff:true}),successor=await fixture(h,'領地効果の後継',{staff:true});await appoint(h,emperor);const nominated=await nominateSuccessor(h,emperor,successor);await certifySuccessor(h,admin,nominated.nomination);const retired=await snapshot(h,emperor);assert.equal(retired.user.isStaff,false);assert.equal(engine(retired).courtEstateEffects().active,true);assert.equal(ledger(h,emperor).active,1);
 });
 await scope('Kyoto membership ends the extra ordinary grant without double counting the canonical palace',async h=>{
  const{admin,p}=await setup(h);await regent(h,p);h.now+=5000;await h.api('/admin/staff',post(admin,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));assert.equal(ledger(h,p).active,0);const s=await snapshot(h,p),game=engine(s);game.applyWorldClock(s.clock);assert.equal(game.isStaff,true);assert.equal(game.courtEstateEffects().active,false);assert(game.ownedCastleIds().includes('kyoto_gosho'));assert.deepEqual(s.courtEstateProjection.accessWindows,[{fromElapsedMs:0,toElapsedMs:5000}]);assert.equal((await h.api('/court/estate',{token:admin.token})).data.courtEstate.effects.active,false);
 });
 await scope('shared castle completion changes ordinary-level effects while shared facility growth stays separate',async h=>{
  const{p}=await setup(h);await regent(h,p);let view=(await h.api('/court/estate',{token:p.token})).data;
  const quote=view.courtEstate.actions.find(a=>a.kind==='castle'),before=structuredClone(save(h,p).state),result=(await h.api('/court/estate/upgrade',post(p,{requestId:crypto.randomUUID(),kind:'castle',id:'kyoto_gosho',baseRevision:view.courtEstate.base.revision,accessStamp:view.courtEstate.accessStamp,deviceId:p.deviceId,expectedRevision:row(h,p).revision}))).data;
  assert.deepEqual(result.receipt.cost,quote.cost);assert.equal(result.receipt.completesElapsedMs-result.receipt.startedElapsedMs,60000);for(const key of ['gold','rice','wood','stone'])assert.equal(save(h,p).state.resources[key],before.resources[key]-quote.cost[key]);assert.deepEqual(save(h,p).state.buildings,before.buildings);assert.equal(result.courtEstate.effects.castleLevel,1);
  h.now+=60000;view=(await h.api('/court/estate',{token:p.token})).data;assert.equal(view.courtEstate.effects.castleLevel,2);assert.deepEqual(view.courtEstate.effects.baseIncome,{gold:115,rice:190,wood:45,stone:35});assert.deepEqual(view.courtEstate.effects.facilityUpkeep,{gold:4,rice:62,wood:2,stone:2});assert.equal(save(h,p).state.castles.kyoto_gosho.level,before.castles.kyoto_gosho.level);
  const caught=await catchUp(h,p);await h.api('/sync',{method:'PUT',token:p.token,body:caught.body});view=(await h.api('/court/estate',{token:p.token})).data;const effect=structuredClone(view.courtEstate.effects);await h.api('/court/estate/upgrade',post(p,{requestId:crypto.randomUUID(),kind:'building',id:'farm',baseRevision:view.courtEstate.base.revision,accessStamp:view.courtEstate.accessStamp,deviceId:p.deviceId,expectedRevision:row(h,p).revision}));h.now+=60000;assert.deepEqual((await h.api('/court/estate',{token:p.token})).data.courtEstate.effects,effect);assert.equal(save(h,p).state.buildings.farm,before.buildings.farm);
 });
 await scope('missing and stale sync proofs cannot persist stale-role balances, and fresh history can settle',async h=>{
  const{p}=await setup(h);await regent(h,p);const active=await lease(h,p),before=row(h,p);h.now+=5000;await regent(h,p,'dismiss');const submitted={deviceId:p.deviceId,revision:active.revision,maintenanceRevision:active.maintenanceAuthority.revision,courtEstateProof:active.courtEstateProjection.proof,save:active.save};
  const stale=(await h.api('/sync',{method:'PUT',token:p.token,rawBody:JSON.stringify(submitted),expected:409})).data;assert.equal(stale.error.code,'COURT_ESTATE_REFRESH_REQUIRED');assert.deepEqual(row(h,p),before);
  delete submitted.courtEstateProof;assert.equal((await h.api('/sync',{method:'PUT',token:p.token,rawBody:JSON.stringify(submitted),expected:409})).data.error.code,'COURT_ESTATE_REFRESH_REQUIRED');assert.deepEqual(row(h,p),before);
  h.now+=5000;const current=await catchUp(h,p);assert.deepEqual(current.snapshot.courtEstateProjection.accessWindows,[{fromElapsedMs:0,toElapsedMs:5000}]);assert.equal(current.game.courtEstateEffects().active,false);const accepted=(await h.api('/sync',{method:'PUT',token:p.token,body:current.body})).data;assert.equal(accepted.revision,before.revision+1);assert.equal(accepted.save.state.home,'inuyama');assert(accepted.courtEstateProjection);assert.equal(accepted.entitlements.courtProtected,false);
 });
 await scope('revocation during sync commit rolls back the complete submitted personal save',async h=>{
  const{p}=await setup(h);await regent(h,p);const prepared=await catchUp(h,p),before=row(h,p);prepared.body.save.state.resources.gold-=1;let fired=false;
  h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.startsWith('UPDATE player_saves SET save_json=')&&s.sql.includes('writer_device_id')))return;h.beforeBatch=null;fired=true;await regent(h,p,'dismiss');};
  const rejected=(await h.api('/sync',{method:'PUT',token:p.token,body:prepared.body,expected:409})).data;assert(fired);assert.equal(rejected.error.code,'COURT_ESTATE_REFRESH_REQUIRED');assert.deepEqual(row(h,p),before);assert.equal(ledger(h,p).active,0);
 });
 await scope('ordinary income proof binds the prior campaign while deliberate fresh campaigns get new authority',async h=>{
  const{p}=await setup(h);await regent(h,p);const prior=await lease(h,p),game=new GameEngine({officers:GAME_OFFICERS,startCastle:'inuyama'});game.applyWorldClock(prior.clock);const fresh=JSON.parse(game.exportSave());assert.notEqual(fresh.state.walking.campaignId,prior.save.state.walking.campaignId);
  const result=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:prior.revision,maintenanceRevision:prior.maintenanceAuthority.revision,courtEstateProof:prior.courtEstateProjection.proof,save:fresh}})).data;
  assert.equal(result.courtEstateProjection.campaignId,fresh.state.walking.campaignId);assert.notEqual(result.courtEstateProjection.proof,prior.courtEstateProjection.proof);assert.equal(result.courtEstateProjection.revision,prior.courtEstateProjection.revision);assert.equal(engine(result).courtEstateEffects().active,true);
 });
 await scope('a Kyoto merit promotion closes a conflicting external grant in the completion transaction',async h=>{
  const{p}=await setup(h),member=await fixture(h,'功績が昇進する京都領主',{staff:true});
  h.sql.prepare("INSERT INTO court_contributions(job_id,actor_id,staff_term,kind,target_id,target_level,points,completed_elapsed_ms,created_at) VALUES(?,?,NULL,'castle','kyoto_gosho',49,49,0,?)").run('synthetic_merit',member.user.id,h.now);
  await office(h,p,'chunagon');const shared=(await h.api('/staff/base',{token:member.token})).data.staffBase;await h.api('/staff/base/upgrade',post(member,{requestId:crypto.randomUUID(),kind:'building',id:'farm',baseRevision:shared.revision,deviceId:member.deviceId,expectedRevision:row(h,member).revision}));
  h.now+=60000;await h.api('/staff/base',{token:member.token});assert.equal(ledger(h,p).active,0);assert.equal(ledger(h,p).last_effective_elapsed_ms,60000);h.now+=60000;const later=await snapshot(h,p);assert.deepEqual(later.courtEstateProjection.accessWindows,[{fromElapsedMs:0,toElapsedMs:60000}]);assert.equal(later.entitlements.courtProtected,false);
 });
 await scope('BAN closes the ordinary grant atomically with appointment removal',async h=>{
  const{admin,p}=await setup(h);await regent(h,p);h.now+=1000;await h.api('/admin/moderation',post(admin,{targetPlayerId:p.user.id,action:'ban',reason:'local fixture',requestId:crypto.randomUUID(),expectedRevision:0}));assert.equal(ledger(h,p).active,0);assert.equal(ledger(h,p).last_effective_elapsed_ms,1000);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_regent').get().n,0);
 });
 for(const preserveBase of [false,true])await scope('nonempty migration starts existing roles at activation and '+(preserveBase?'preserves':'initializes')+' the canonical base',async h=>{
  const{p}=await setup(h);await regent(h,p);const priorBase=h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get(),priorSave=row(h,p);
  h.sql.exec('DROP TABLE court_estate_snapshots; DROP TABLE court_estate_accounts; DROP TABLE court_estate_policy; DROP VIEW court_estate_current');if(!preserveBase)h.sql.exec('DELETE FROM staff_base');h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=120000,anchor_real_ms=?,running=0,revision=revision+1 WHERE id='world-v1'").run(h.now);
  for(const part of readFileSync(new URL('./drizzle/0055_court_estate_economy.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(v=>v.trim()).filter(Boolean))h.sql.exec(part);
  assert.deepEqual(row(h,p),priorSave);assert.equal(ledger(h,p).activated_elapsed_ms,120000);assert.equal(ledger(h,p).revision,1);if(preserveBase)assert.deepEqual(h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get(),priorBase);
  const s=await snapshot(h,p);assert.deepEqual(s.courtEstateProjection.accessWindows,[{fromElapsedMs:120000,toElapsedMs:null}]);const actual=engine(s),plain=engine(s,null);assert.equal(actual.courtEstateEffects().active,false);actual.applyWorldClock(s.clock);plain.applyWorldClock(s.clock);assert.deepEqual(actual.state.resources,plain.state.resources);assert.equal(actual.courtEstateEffects().active,true);assert.deepEqual(h.sql.prepare('PRAGMA foreign_key_check').all(),[]);
 });
 console.log(JSON.stringify({ok:true,checks,calls,maxBindings,productionRequests:0},null,2));
}finally{globalThis.fetch=fetch;}
