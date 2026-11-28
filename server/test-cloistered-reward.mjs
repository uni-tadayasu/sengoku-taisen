import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,appoint,makeImperial,nominateSuccessor,certifySuccessor,row,save} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {readCloisteredReward} from './cloistered-reward.js';

const ID='special_goshirakawa_hoo',PAIR=ID+':U',clone=value=>JSON.parse(JSON.stringify(value));
const snapshot=async(h,p)=>(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
const status=async(h,p)=>(await h.api('/court/retirement',{token:p.token})).data.retirement;
const input=async(h,p)=>{const s=await status(h,p);return{requestId:crypto.randomUUID(),expectedRevision:s.revision,successionId:s.successionId,confirmed:true};};
const ordain=(h,p,body,expected=200)=>h.api('/court/retirement/ordain',post(p,body,expected));
async function family(h){
 const admin=await fixture(h,'法皇褒賞の認証者',{admin:true}),a=await fixture(h,'法皇褒賞の前天皇',{staff:true}),b=await fixture(h,'法皇褒賞の後継者',{staff:true});
 makeImperial(h,a);makeImperial(h,b);await appoint(h,a);const n=await nominateSuccessor(h,a,b);await certifySuccessor(h,admin,n.nomination);
 await h.api('/sync/lease',post(a,{deviceId:a.deviceId}));return{admin,a,b};
}
function hasReward(snapshot){
 assert.equal(snapshot.cloisteredReward?.earned,true);assert.equal(snapshot.cloisteredReward.officerId,ID);const s=snapshot.save.state;assert.equal(s.officers.filter(id=>id===ID).length,1);assert.equal(s.officerVariants.filter(pair=>pair===PAIR).length,1);
 const g=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isSento:!!snapshot.entitlements.sentoGosho,isAdmin:snapshot.user.isAdmin,isStaff:snapshot.user.isStaff,isDeputy:snapshot.user.isDeputy,courtEstateProjection:snapshot.courtEstateProjection});
 const officer=g.officer(ID);assert.deepEqual(['lead','valor','intellect','politics'].map(key=>officer[key]),[100,100,100,100]);assert.equal(officer.rank,'U');assert.equal(officer.cloisteredReward,true);return g;
}
const upload=(h,p,snapshot,imported=snapshot.save,expected=200)=>h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:snapshot.revision,save:imported},expected});
let checks=0,calls=0;
async function scenario(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Cloistered reward tests must not contact live services');};
try{
 await scenario('ordinary players and retired Emperors cannot forge the exclusive award or buy it',async h=>{
  const{a,b}=await family(h),ordinary=await fixture(h,'褒賞の未取得者');
  for(const p of [ordinary,a,b]){
   const current=await snapshot(h,p);assert(!current.save.state.officers.includes(ID));assert.equal((await readCloisteredReward(h.db,p.user.id)).earned,false);
   const forged=clone(current.save);forged.state.officers.push(ID);forged.state.officerVariants.push(PAIR);forged.state.officerHealth.values[ID]=100;
   forged.state.isCloisteredEmperor=true;forged.cloisteredReward=true;
   const denied=await upload(h,p,current,forged,409);assert.equal(denied.data.error.code,'CLOISTERED_REWARD_REQUIRED');
   forged.state.officerVariants[forged.state.officerVariants.length-1]=ID+':SSS';await upload(h,p,current,forged,400);
   assert(!save(h,p).state.officers.includes(ID));
  }
  await h.api('/court/nobles/exchange',post(a,{deviceId:a.deviceId,expectedRevision:row(h,a).revision,requestId:crypto.randomUUID(),officerId:ID},400));
 });
 await scenario('ordination grants one all-100 U character, preserves assets and duplicate retries never heal or duplicate',async h=>{
  const{a}=await family(h),before=clone(save(h,a).state),body=await input(h,a),responses=await Promise.all([ordain(h,a,body),ordain(h,a,body)]);
  assert.equal(responses.filter(r=>r.data.idempotent).length,1);for(const r of responses){assert.equal(r.data.retirement.reward.earned,true);assert.equal(r.data.receipt.reward.officerId,ID);}
  const current=await snapshot(h,a),game=hasReward(current);for(const key of ['resources','magatama','army','gachaHistory','stats'])assert.deepEqual(current.save.state[key],before[key],key);
  assert.equal(game.assignArmy([ID]).ok,true);game.state.officerHealth.values[ID]=63;
  const written=(await upload(h,a,current,JSON.parse(game.exportSave()))).data;hasReward(written);assert.equal(written.save.state.officerHealth.values[ID],63);
  await ordain(h,a,body);const repeated=await snapshot(h,a);hasReward(repeated);assert.equal(repeated.save.state.officerHealth.values[ID],63);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_ordination_requests WHERE actor_id=?').get(a.user.id).n,1);
  const publicProfile=(await h.api('/players/'+a.user.id+'/profile')).data;assert.equal(publicProfile.player.commander.officerId,ID);assert.equal(publicProfile.player.commander.rank,'U');
 });
 await scenario('an existing cloistered Emperor recovers the award from historical ordination without another action',async h=>{
  const{a}=await family(h),body=await input(h,a);await ordain(h,a,body);
  // A pre-feature receipt contains no character fields. The accepted
  // ordination and its actor's succession remain the sole entitlement.
  const record=h.sql.prepare('SELECT * FROM court_ordination_requests WHERE actor_id=?').get(a.user.id),legacy=JSON.parse(record.result_json);delete legacy.reward;
  h.sql.prepare('UPDATE court_ordination_requests SET result_json=? WHERE actor_id=?').run(JSON.stringify(legacy),a.user.id);
  const persisted=clone(row(h,a)),current=await snapshot(h,a);hasReward(current);assert.deepEqual(clone(row(h,a)),persisted,'read-only recovery keeps the stored revision');
  const old=clone(current.save);old.state.officers=old.state.officers.filter(id=>id!==ID);old.state.officerVariants=old.state.officerVariants.filter(pair=>pair!==PAIR);delete old.state.officerHealth.values[ID];
  const restored=(await upload(h,a,current,old)).data;hasReward(restored);assert(save(h,a).state.officers.includes(ID));
  const forged=clone(restored.save);forged.state.stats.gachaDraws++;forged.state.gachaHistory.push({officerId:ID,rank:'U',isNew:true,isNewOfficer:true,upgraded:false,duplicateRefund:0,turn:forged.state.turn});
  const denied=await upload(h,a,restored,forged,409);assert.equal(denied.data.error.code,'CLOISTERED_REWARD_REQUIRED');
 });
 await scenario('the character survives later coronation, the end of the role and a new server-created campaign',async h=>{
  const{admin,a}=await family(h),body=await input(h,a);await ordain(h,a,body);
  await h.api('/admin/staff',post(admin,{action:'appoint',targetPlayerId:a.user.id,requestId:crypto.randomUUID()}));await appoint(h,a);
  assert.equal((await status(h,a)).kind,'none');assert.equal((await status(h,a)).reward.earned,true);hasReward(await snapshot(h,a));
  await appoint(h,null);await h.api('/admin/staff',post(admin,{action:'dismiss',targetPlayerId:a.user.id,requestId:crypto.randomUUID()}));
  const lease=(await h.api('/sync/lease',post(a,{deviceId:a.deviceId}))).data;hasReward(lease);
  const next=(await h.api('/castles/residency/start',post(a,{requestId:crypto.randomUUID(),deviceId:a.deviceId,revision:lease.revision,castleId:'inuyama',mode:'lord',clan:'織田家',difficulty:'normal'}))).data;
  hasReward(next);assert(save(h,a).state.officers.includes(ID));assert.equal((await ordain(h,a,body)).data.retirement.kind,'imperial');
 });
 await scenario('reward-managed fresh imports preserve the earned character and cannot manufacture another rank',async h=>{
  const{admin,a}=await family(h);await ordain(h,a,await input(h,a));
  await h.api('/admin/staff',post(admin,{action:'appoint',targetPlayerId:a.user.id,requestId:crypto.randomUUID()}));await appoint(h,a);await appoint(h,null);await h.api('/admin/staff',post(admin,{action:'dismiss',targetPlayerId:a.user.id,requestId:crypto.randomUUID()}));
  const current=(await h.api('/sync/lease',post(a,{deviceId:a.deviceId}))).data;h.sql.prepare('INSERT OR IGNORE INTO reward_accounts(user_id,started_at) VALUES(?,?)').run(a.user.id,h.now);
  const fresh=new GameEngine({officers:GAME_OFFICERS,clan:current.save.state.clan,startCastle:current.save.state.home,seed:17});fresh.applyWorldClock(current.clock);
  const created=(await upload(h,a,current,JSON.parse(fresh.exportSave()))).data;hasReward(created);assert.notEqual(created.save.state.walking.campaignId,current.save.state.walking.campaignId);
 });
 await scenario('a failed ordination transaction grants nothing; a lost response recovers the same single reward',async h=>{
  const{a}=await family(h),body=await input(h,a);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_ordination_requests')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE absent_ordination_reward_fixture SET value=1'));};
  await ordain(h,a,body,500);assert.equal((await status(h,a)).reward.earned,false);assert(!(await snapshot(h,a)).save.state.officers.includes(ID));
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_ordination_requests')))return;h.afterBatch=null;throw Error('lost ordination response');};
  await ordain(h,a,body,500);const replay=(await ordain(h,a,body)).data;assert.equal(replay.idempotent,true);assert.equal(replay.retirement.reward.earned,true);hasReward(await snapshot(h,a));
 });
}finally{globalThis.fetch=network;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
