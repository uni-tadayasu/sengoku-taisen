import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,save} from './test-court-support.mjs';
import {prepareResidencySuccession} from './residency.js';

const offer={gold:123,rice:45,wood:6,stone:7};
let checks=0,calls=0,maxBindings=0;
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100);}return batch(statements);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const relation=(h,p)=>h.sql.prepare('SELECT * FROM court_vassals WHERE vassal_id=?').get(p.user.id);
const endings=(h,id)=>h.sql.prepare('SELECT * FROM court_vassal_endings WHERE negotiation_id=?').all(id);
const notices=(h,id)=>h.sql.prepare("SELECT * FROM notification_social_events WHERE kind='court-vassal-ended' AND source_id=? ORDER BY user_id").all(id);
const fixed=(h,id)=>JSON.stringify(h.sql.prepare('SELECT * FROM court_negotiations WHERE id=?').get(id));
const wallets=(h,...players)=>players.map(p=>structuredClone(save(h,p).state.resources));
async function admission(h,p,houseId='konoe'){
 const d=(await h.api('/court/membership',{token:p.token})).data.membership;
 return{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:d.expectedRevision,expectedHomeCastleId:d.homeCastleId,confirmed:true,houseId,expectedJoinMode:d.joinMode,expectedOfficeToken:d.officeAppointmentToken};
}
async function setup(h,{patronStaff=true}={}){
 const admin=await fixture(h,'主従整合の太政大臣',{admin:true}),lord=await fixture(h,'主従整合の公家',{score:35000,startCastle:'ishikawa'});
 await h.api('/court/membership',post(lord,await admission(h,lord)));
 if(!patronStaff){await h.api('/admin/staff',post(admin,{targetPlayerId:lord.user.id,action:'dismiss',requestId:crypto.randomUUID()}));await h.api('/sync?deviceId='+lord.deviceId,{token:lord.token});}
 const warrior=await fixture(h,'主従整合の武家',{score:35000,startCastle:'kiyosu'});return{admin,lord,warrior};
}
async function contract(h,lord,warrior){
 const proposal=(await h.api('/court/negotiations',post(lord,{requestId:crypto.randomUUID(),targetPlayerId:warrior.user.id,offer,confirmed:true}))).data.negotiation;
 const accept={requestId:crypto.randomUUID(),proposalRevision:proposal.revision,deviceId:warrior.deviceId,expectedRevision:row(h,warrior).revision,confirmed:true};
 const before=wallets(h,lord,warrior),result=(await h.api('/court/negotiations/'+proposal.id+'/accept',post(warrior,accept))).data;
 assert.equal(result.negotiation.status,'accepted');for(const key of Object.keys(offer)){assert.equal(save(h,lord).state.resources[key],before[0][key]-offer[key]);assert.equal(save(h,warrior).state.resources[key],before[1][key]+offer[key]);}
 assert.equal(relation(h,warrior).lord_id,lord.user.id);return{id:proposal.id,accept,receipt:fixed(h,proposal.id)};
}
function ended(h,lord,warrior,agreement,reason){
 assert.equal(relation(h,warrior),undefined);const events=endings(h,agreement.id);assert.equal(events.length,1);assert.equal(events[0].reason,reason);assert.equal(events[0].lord_id,lord.user.id);assert.equal(events[0].vassal_id,warrior.user.id);assert.equal(fixed(h,agreement.id),agreement.receipt);
 const notifications=notices(h,agreement.id);assert.equal(notifications.length,2);assert.deepEqual(notifications.map(n=>n.user_id).sort(),[lord.user.id,warrior.user.id].sort());
 for(const n of notifications){assert.equal(n.destination,'courtNegotiations');assert.equal(n.source_revision,0);assert.equal(n.actor_id,n.user_id===lord.user.id?warrior.user.id:lord.user.id);assert.equal(n.push_eligible,1);}
}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Court integrity tests must not contact real services');};
try{
 await scope('formal admission ends a paid relationship once without a refund or blocking family choice',async h=>{
  const {admin,lord,warrior}=await setup(h),agreement=await contract(h,lord,warrior),before=wallets(h,lord,warrior),body=await admission(h,warrior,'kujo');
  const joined=(await h.api('/court/membership',post(warrior,body))).data;assert.equal(joined.user.courtLineage.houseId,'kujo');ended(h,lord,warrior,agreement,'court-membership');assert.deepEqual(wallets(h,lord,warrior),before);
  await h.api('/court/membership?receipt=1',post(warrior,body));ended(h,lord,warrior,agreement,'court-membership');assert.deepEqual(wallets(h,lord,warrior),before);
  const replay=(await h.api('/court/negotiations/'+agreement.id+'/accept?receipt=1',post(warrior,agreement.accept))).data;assert.equal(replay.idempotent,true);assert.equal(relation(h,warrior),undefined);assert.deepEqual(wallets(h,lord,warrior),before);
  const profile=(await h.api('/players/'+warrior.user.id+'/profile')).data.player;assert.equal(profile.courtRelations.suzerain,null);
  for(const p of [lord,warrior]){const inbox=(await h.api('/me',{token:p.token})).data.socialNotifications.filter(n=>n.kind==='court-vassal-ended');assert.equal(inbox.length,1);assert.equal(inbox[0].destination,'courtNegotiations');assert.deepEqual((await h.api('/notifications/read',post(admin,{ids:[inbox[0].id]}))).data.readIds,[]);}
 });
 await scope('forced staff and deputy appointments end only the incoming relationship and notify both once',async h=>{
  const {admin,lord,warrior}=await setup(h),agreement=await contract(h,lord,warrior),before=wallets(h,lord,warrior),body={targetPlayerId:warrior.user.id,action:'appoint',requestId:crypto.randomUUID()};
  await h.api('/admin/staff',post(admin,body));ended(h,lord,warrior,agreement,'staff-appointment');assert.deepEqual(wallets(h,lord,warrior),before);await h.api('/admin/staff',post(admin,body));ended(h,lord,warrior,agreement,'staff-appointment');
  const second=await fixture(h,'主従整合の副任命武家',{startCastle:'odani'}),next=await contract(h,lord,second),deputy={targetPlayerId:second.user.id,action:'appoint',requestId:crypto.randomUUID(),expectedRevision:(await h.api('/admin/deputy',{token:admin.token})).data.revision};
  const cash=wallets(h,lord,second);await h.api('/admin/deputy',post(admin,deputy));ended(h,lord,second,next,'deputy-appointment');assert.deepEqual(wallets(h,lord,second),cash);await h.api('/admin/deputy',post(admin,deputy));ended(h,lord,second,next,'deputy-appointment');
 });
 await scope('family selection and operator elevation are complete database boundaries with no payment reversal',async h=>{
  const {lord,warrior}=await setup(h),agreement=await contract(h,lord,warrior),before=wallets(h,lord,warrior);
  h.sql.prepare("INSERT INTO court_lineages(user_id,house_id,original_clan,revision,created_at,updated_at) VALUES(?,'ichijo',?,1,?,?)").run(warrior.user.id,save(h,warrior).state.clan,h.now,h.now);ended(h,lord,warrior,agreement,'court-house');assert.deepEqual(wallets(h,lord,warrior),before);
  const second=await fixture(h,'主従整合の運営後継',{startCastle:'odani'}),next=await contract(h,lord,second),cash=wallets(h,lord,second);
  h.sql.prepare("UPDATE settings SET value=?,updated_at=? WHERE key='adminUserId'").run(second.user.id,h.now);ended(h,lord,second,next,'operator-appointment');assert.deepEqual(wallets(h,lord,second),cash);
 });
 await scope('a vacant-castle relocation preserves service through its temporary succession, then occupied entry ends it',async h=>{
  const {lord,warrior}=await setup(h),heir=await fixture(h,'旧城を継ぐ家臣',{startCastle:'kiyosu'}),otherLord=await fixture(h,'他城の領主',{startCastle:'nanao'}),agreement=await contract(h,lord,warrior);
  const oldCampaign=save(h,warrior).state.walking.campaignId;
  await h.api('/castles/residency/relocate',post(warrior,{requestId:crypto.randomUUID(),deviceId:warrior.deviceId,revision:row(h,warrior).revision,castleId:'odani'}));
  assert.notEqual(save(h,warrior).state.walking.campaignId,oldCampaign);assert.equal(h.sql.prepare("SELECT lord_user_id FROM castle_seats WHERE castle_id='kiyosu'").get().lord_user_id,heir.user.id);assert.equal(relation(h,warrior).negotiation_id,agreement.id);assert.equal(endings(h,agreement.id).length,0);assert.equal(notices(h,agreement.id).length,0);
  const body={requestId:crypto.randomUUID(),deviceId:warrior.deviceId,revision:row(h,warrior).revision,castleId:'nanao'};const entered=(await h.api('/castles/residency/relocate',post(warrior,body))).data;assert.equal(entered.admission.mode,'retainer');assert.equal(entered.residency.lordPlayerId,otherLord.user.id);ended(h,lord,warrior,agreement,'residency-retainer');
  await h.api('/castles/residency/relocate?receipt=1',post(warrior,body));ended(h,lord,warrior,agreement,'residency-retainer');
 });
 await scope('a defeated castle lord ends negotiated service only when a successor makes it a retainer',async h=>{
  const {lord,warrior}=await setup(h),heir=await fixture(h,'敗戦後の後継家臣',{startCastle:'kiyosu'}),agreement=await contract(h,lord,warrior),before=wallets(h,lord,warrior);
  const succession=await prepareResidencySuccession(h.db,{userId:warrior.user.id,castleId:'kiyosu',battleId:'integrity-defeat',kind:'field',now:h.now});assert.equal(succession.succession.lordPlayerId,heir.user.id);
  await h.db.batch(succession.statements('1=1',[]));ended(h,lord,warrior,agreement,'residency-succession');assert.deepEqual(wallets(h,lord,warrior),before);assert.equal(h.sql.prepare("SELECT lord_user_id FROM castle_seats WHERE castle_id='kiyosu'").get().lord_user_id,heir.user.id);
  await h.db.batch(succession.statements('1=1',[]));ended(h,lord,warrior,agreement,'residency-succession');
 });
 await scope('name, independent new campaign, external office and patron retirement preserve the established relationship',async h=>{
  const {admin,lord,warrior}=await setup(h),agreement=await contract(h,lord,warrior);
  await h.api('/profile',{method:'PATCH',token:warrior.token,body:{name:'改名後の武家'}});assert.equal(relation(h,warrior).negotiation_id,agreement.id);
  await h.api('/castles/residency/start',post(warrior,{requestId:crypto.randomUUID(),deviceId:warrior.deviceId,revision:row(h,warrior).revision,castleId:'odani',mode:'lord',clan:'織田家',difficulty:'normal'}));assert.equal(relation(h,warrior).negotiation_id,agreement.id);
  const directory=(await h.api('/admin/court/offices',{token:admin.token})).data,office={requestId:crypto.randomUUID(),action:'appoint',officeId:'chunagon',targetPlayerId:warrior.user.id,expectedRevision:directory.revision};await h.api('/admin/court/offices',post(admin,office));assert.equal(relation(h,warrior).negotiation_id,agreement.id);
  await h.api('/admin/staff',post(admin,{targetPlayerId:lord.user.id,action:'dismiss',requestId:crypto.randomUUID()}));await h.api('/sync?deviceId='+lord.deviceId,{token:lord.token});assert.equal(relation(h,warrior).negotiation_id,agreement.id);assert.equal(endings(h,agreement.id).length,0);assert.equal(notices(h,agreement.id).length,0);
 });
 await scope('a failed role transaction rolls back termination and both notices before an exactly-once retry',async h=>{
  const {admin,lord,warrior}=await setup(h),agreement=await contract(h,lord,warrior),body={targetPlayerId:warrior.user.id,action:'appoint',requestId:crypto.randomUUID()},before=wallets(h,lord,warrior);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO staff_role_requests')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_integrity_table SET value=1'));};
  await h.api('/admin/staff',post(admin,body,500));assert.equal(relation(h,warrior).negotiation_id,agreement.id);assert.equal(endings(h,agreement.id).length,0);assert.equal(notices(h,agreement.id).length,0);assert.deepEqual(wallets(h,lord,warrior),before);
  await h.api('/admin/staff',post(admin,body));ended(h,lord,warrior,agreement,'staff-appointment');assert.deepEqual(wallets(h,lord,warrior),before);
 });
 await scope('final insertion rejects a newly ineligible target and rolls back every preceding payment statement',async h=>{
  const {lord,warrior}=await setup(h),id='cn_'+crypto.randomUUID().replaceAll('-',''),acceptedAt=h.now;
  h.sql.prepare("INSERT INTO court_negotiations(id,lord_id,warrior_id,offer_json,offered_by,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',2,?,?)").run(id,lord.user.id,warrior.user.id,JSON.stringify(offer),lord.user.id,acceptedAt,acceptedAt);
  h.sql.prepare("INSERT INTO court_lineages(user_id,house_id,revision,created_at,updated_at) VALUES(?,'nijo',1,?,?)").run(warrior.user.id,h.now,h.now);
  const before=wallets(h,lord,warrior);await assert.rejects(h.db.batch([
   h.db.prepare("UPDATE player_saves SET save_json=json_set(save_json,'$.state.resources.gold',json_extract(save_json,'$.state.resources.gold')-123) WHERE user_id=?").bind(lord.user.id),
   h.db.prepare("UPDATE player_saves SET save_json=json_set(save_json,'$.state.resources.gold',json_extract(save_json,'$.state.resources.gold')+123) WHERE user_id=?").bind(warrior.user.id),
   h.db.prepare('INSERT INTO court_vassals(vassal_id,lord_id,negotiation_id,created_at) VALUES(?,?,?,?)').bind(warrior.user.id,lord.user.id,id,h.now)
  ]),/COURT_VASSAL_INELIGIBLE/);assert.deepEqual(wallets(h,lord,warrior),before);assert.equal(relation(h,warrior),undefined);
 });
 await scope('deleting a participant removes active and ended references and missing integrity gates fail health readiness',async h=>{
  // The application has no player-deletion endpoint, and unrelated historical
  // ledgers deliberately restrict deletion. Test the new FK boundary using
  // minimal accounts so those independent retention rules stay unchanged.
  for(const remove of ['lord','warrior'])for(const endedFirst of [false,true]){
   const suffix=crypto.randomUUID(),lord='integrity-lord-'+suffix,warrior='integrity-warrior-'+suffix,id='cn_'+crypto.randomUUID().replaceAll('-','');
   for(const userId of [lord,warrior]){h.sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(userId,userId,userId,'織田家',userId,h.now,h.now);h.sql.prepare('INSERT INTO player_saves(user_id,save_json) VALUES(?,?)').run(userId,JSON.stringify(h.fresh('kiyosu')));}
   h.sql.prepare("INSERT INTO court_lineages(user_id,house_id,revision,created_at,updated_at) VALUES(?,'konoe',1,?,?)").run(lord,h.now,h.now);
   h.sql.prepare("INSERT INTO court_negotiations(id,lord_id,warrior_id,offer_json,offered_by,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,'accepted',2,?,?)").run(id,lord,warrior,JSON.stringify(offer),lord,h.now,h.now);
   h.sql.prepare('INSERT INTO court_vassals(vassal_id,lord_id,negotiation_id,created_at) VALUES(?,?,?,?)').run(warrior,lord,id,h.now);
   if(endedFirst)h.sql.prepare("INSERT INTO court_lineages(user_id,house_id,revision,created_at,updated_at) VALUES(?,'kujo',1,?,?)").run(warrior,h.now,h.now);
   h.sql.prepare('DELETE FROM users WHERE id=?').run(remove==='lord'?lord:warrior);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_vassals WHERE negotiation_id=?').get(id).n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_negotiations WHERE id=?').get(id).n,0);assert.equal(endings(h,id).length,0);
  }
  await h.api('/health');h.sql.exec('DROP TRIGGER court_vassal_insert_guard');await h.api('/health',{expected:503});
 });
 console.log(JSON.stringify({ok:true,checks,calls,maxBindings}));
}finally{globalThis.fetch=originalFetch;}
