import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {harness} from './test-support.mjs';
import {fixture,post,save,appoint,updateSave} from './test-court-support.mjs';
import {NOBLE_HOUSES} from './court-lineage.js';

let checks=0,calls=0,maxBindings=0;
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100,'D1 bind limit');}return batch(statements);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const status=async(h,p)=>(await h.api('/court',{token:p.token})).data.lineage;
const request=async(h,p,extra={})=>{const current=await status(h,p);return{requestId:crypto.randomUUID(),expectedRevision:current.revision,termId:current.termId,confirmed:true,...extra};};
const choose=async(h,p,houseId='konoe')=>(await h.api('/court/house',post(p,await request(h,p,{houseId})))).data;
function merit(h,p,points){
 const term=h.sql.prepare("SELECT COALESCE((SELECT term_id FROM court_retained_memberships WHERE user_id=?),(SELECT COALESCE(term_id,'legacy:'||appointed_at) FROM staff_members WHERE user_id=?)) AS id").get(p.user.id,p.user.id).id;
 h.sql.prepare('DELETE FROM court_contributions WHERE actor_id=?').run(p.user.id);
 while(points>0){const value=Math.min(points,128);h.sql.prepare("INSERT INTO court_contributions VALUES(?,?,?,'castle','kyoto_gosho',?,?,0,?)").run(crypto.randomUUID(),p.user.id,term,value,value,h.now);points-=value;}
}
const lineage=h=>h.sql.prepare('SELECT * FROM court_lineages ORDER BY user_id').all();
const receipts=h=>h.sql.prepare('SELECT * FROM court_lineage_requests ORDER BY actor_id,request_id').all();
async function membership(h,p,houseId='konoe'){
 const d=(await h.api('/court/membership',{token:p.token})).data.membership;
 return{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:d.expectedRevision,expectedHomeCastleId:d.homeCastleId,confirmed:true,houseId};
}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Lineage tests must not contact real services');};
try{
 await scope('formal admission requires one of five explicit families and binds the family to the receipt',async h=>{
  await fixture(h,'家柄の受入責任者',{admin:true});const p=await fixture(h,'家柄を選ぶ加入者',{score:35000}),body=await membership(h,p,'ichijo'),originalClan=save(h,p).state.clan;
  const {houseId,...missing}=body;
  for(const bad of [missing,{...body,houseId:'tokugawa'},{...body,houseId:'__proto__'}])await h.api('/court/membership',post(p,bad,400));
  assert.equal(lineage(h).length,0);
  const admitted=(await h.api('/court/membership',post(p,body))).data;
  assert.equal(admitted.admission.houseId,'ichijo');assert.deepEqual(admitted.user.courtLineage,{class:'kuge',houseId:'ichijo',houseName:'一条家',imperialHouseName:null,originalClan,needsHouseSelection:false});
  const replay=(await h.api('/court/membership?receipt=1',post(p,body))).data;assert.equal(replay.admission.idempotent,true);
  assert.equal((await h.api('/court/membership?receipt=1',post(p,{...body,houseId:'nijo'},409))).data.error.code,'REQUEST_ID_REUSED');
  assert.equal((await h.api('/court/membership?receipt=1',post(p,missing,409))).data.error.code,'REQUEST_ID_REUSED');
  assert.equal(lineage(h).length,1);assert.equal(lineage(h)[0].revision,1);
 });
 await scope('existing members choose exactly once without an automatic migration choice or clan change',async h=>{
  await fixture(h,'家柄選択の運営',{admin:true});
  for(const house of NOBLE_HOUSES){
   const p=await fixture(h,'未選択の'+house.name,{staff:true}),before=await status(h,p),clan=save(h,p).state.clan;
   assert.equal(before.class,'kuge');assert.equal(before.houseId,null);assert.equal(before.needsHouseSelection,true);assert.equal(before.canChooseHouse,true);assert.equal(before.revision,0);
   const body=await request(h,p,{houseId:house.id}),selected=(await h.api('/court/house',post(p,body))).data;
   assert.equal(selected.lineage.houseName,house.name);assert.equal(selected.receipt.revision,1);assert.equal(selected.lineage.needsHouseSelection,false);assert.equal(save(h,p).state.clan,clan);assert.equal(selected.lineage.originalClan,'織田家');
   assert.equal((await h.api('/court/house?receipt=1',post(p,body))).data.idempotent,true);
   await h.api('/court/house',post(p,{...body,houseId:house.id==='konoe'?'kujo':'konoe'},409));
   await h.api('/court/house',post(p,await request(h,p,{houseId:house.id}),409));
  }
  const outsider=await fixture(h,'未加入の家柄希望者',{score:35000});assert.equal((await status(h,outsider)).class,null);
  await h.api('/court/house',post(outsider,{requestId:crypto.randomUUID(),expectedRevision:0,termId:'forged-term',confirmed:true,houseId:'konoe'},409));
  const unknown=await fixture(h,'出身不明の公家',{staff:true});h.sql.prepare('DELETE FROM staff_campaign_backups WHERE user_id=?').run(unknown.user.id);
  assert.equal((await choose(h,unknown)).lineage.originalClan,null,'An absent canonical backup must not be replaced with the current staff clan');
 });
 await scope('old house-less membership receipts recover without assigning or replacing a family',async h=>{
  await fixture(h,'旧受付復元の責任者',{admin:true});const p=await fixture(h,'旧受付の加入者',{score:35000}),body=await membership(h,p);
  await h.api('/court/membership',post(p,body));
  const oldHash=createHash('sha256').update(JSON.stringify(['kyoto-membership-v1',body.expectedHomeCastleId,true])).digest('hex');
  h.sql.prepare('UPDATE court_membership_requests SET request_hash=?,house_id=NULL WHERE actor_id=? AND request_id=?').run(oldHash,p.user.id,body.requestId);
  h.sql.prepare('DELETE FROM court_lineages WHERE user_id=?').run(p.user.id);
  const {houseId,...legacy}=body,recovered=(await h.api('/court/membership?receipt=1',post(p,legacy))).data;
  assert.equal(recovered.admission.houseId,null);assert.equal(recovered.user.courtLineage.needsHouseSelection,true);assert.equal(lineage(h).length,0);
  await choose(h,p,'kujo');const before=lineage(h);
  await h.api('/court/membership?receipt=1',post(p,legacy));assert.deepEqual(lineage(h),before);
  await h.api('/court/membership',post(p,{...legacy,requestId:crypto.randomUUID()},400));
 });
 await scope('Kyoto merit qualifies at 2000, while office appointments without formal membership grant no imperial house',async h=>{
  const admin=await fixture(h,'身分確認の運営',{admin:true}),p=await fixture(h,'正規昇格の公家',{staff:true});await choose(h,p);merit(h,p,1999);
  assert.equal((await status(h,p)).canCreateImperialHouse,false);
  await h.api('/court/imperial-house',post(p,await request(h,p,{name:'桜宮'}),403));
  merit(h,p,2000);assert.equal((await status(h,p)).canCreateImperialHouse,true);
  const body=await request(h,p,{name:'桜宮'}),before=save(h,p),created=(await h.api('/court/imperial-house',post(p,body))).data;
  assert.equal(created.lineage.class,'imperial');assert.equal(created.lineage.imperialHouseName,'桜宮');assert.equal(created.receipt.revision,2);assert.equal(created.lineage.canCreateImperialHouse,false);assert.deepEqual(save(h,p),before);
  const me=(await h.api('/me',{token:p.token})).data.user,court=(await h.api('/court',{token:p.token})).data;
  assert.equal(me.isAdmin,false);assert.equal(me.isDeputy,false);assert.equal(me.canOperate,false);assert.equal(court.self.isCourtEmperor,false);assert.equal(court.self.canActForEmperor,false);assert.equal(court.self.title,'左大臣');
  const emperor=await fixture(h,'任命のみの天皇',{staff:true});await choose(h,emperor);await appoint(h,emperor);assert.equal((await status(h,emperor)).canCreateImperialHouse,false);await h.api('/court/imperial-house',post(emperor,await request(h,emperor,{name:'任命宮'}),403));
  merit(h,p,0); // Free the genuine external left-minister seat in this fixture.
  for(const person of [admin,await fixture(h,'外部左大臣',{score:35000})]){
   h.sql.prepare('INSERT INTO court_lineages(user_id,house_id,revision,created_at,updated_at) VALUES(?,\'nijo\',1,?,?)').run(person.user.id,h.now,h.now);merit(h,person,2000);
   if(person!==admin){h.sql.prepare('INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) VALUES(?,?,?,?,?)').run('sadaijin',person.user.id,crypto.randomUUID(),admin.user.id,h.now);assert.equal((await h.api('/court',{token:person.token})).data.self.title,'左大臣');}
   assert.equal((await status(h,person)).canCreateImperialHouse,false);await h.api('/court/imperial-house',post(person,{requestId:crypto.randomUUID(),expectedRevision:1,termId:'forged-term',confirmed:true,name:'別格宮'},409));
  }
  const regent=await fixture(h,'任命のみの摂政',{score:35000});h.sql.prepare('INSERT INTO court_lineages(user_id,house_id,revision,created_at,updated_at) VALUES(?,\'nijo\',1,?,?)').run(regent.user.id,h.now,h.now);merit(h,regent,2000);
  h.sql.prepare('INSERT INTO court_regent(id,user_id,appointment_token,appointed_by,appointed_at) VALUES(1,?,?,?,?)').run(regent.user.id,crypto.randomUUID(),admin.user.id,h.now);
  assert.equal((await h.api('/court',{token:regent.token})).data.self.title,'摂政');assert.equal((await status(h,regent)).canCreateImperialHouse,false);
  await h.api('/court/imperial-house',post(regent,{requestId:crypto.randomUUID(),expectedRevision:1,termId:'forged-term',confirmed:true,name:'摂政宮'},409));
 });
 await scope('imperial names normalize once, reject controls and enforce permanent unique names',async h=>{
  await fixture(h,'宮家名の運営',{admin:true});const p=await fixture(h,'宮家名第一',{staff:true}),q=await fixture(h,'宮家名第二',{staff:true});await choose(h,p);await choose(h,q);merit(h,p,2000);merit(h,q,2000);
  const body=await request(h,p,{name:'桜宮'});
  for(const name of ['', '宮','宮'.repeat(21),'桜\n宮','桜\t宮','桜\u2028宮','桜\u0000宮'])await h.api('/court/imperial-house',post(p,{...body,name},400));
  const normal=(await h.api('/court/imperial-house',post(p,{...body,name:'  ＡＢＣ宮  '}))).data;assert.equal(normal.lineage.imperialHouseName,'ABC宮');
  assert.equal((await h.api('/court/imperial-house',post(q,await request(h,q,{name:'abc宮'}),409))).data.error.code,'COURT_IMPERIAL_HOUSE_NAME_TAKEN');
  const emoji=(await h.api('/court/imperial-house',post(q,await request(h,q,{name:'🏯宮'})))).data;assert.equal(emoji.lineage.imperialHouseName,'🏯宮');
  await h.api('/court/imperial-house',post(q,await request(h,q,{name:'改名宮'}),403));
  assert.equal(lineage(h).filter(r=>r.imperial_house_name).length,2);
 });
 await scope('membership, moderation and earned merit are rechecked atomically at creation',async h=>{
  const admin=await fixture(h,'資格競合の運営',{admin:true});
  for(const kind of ['dismiss','term','ban','merit']){
   const p=await fixture(h,'資格競合'+kind,{staff:true});await choose(h,p);merit(h,p,2000);const body=await request(h,p,{name:'競合'+kind+'宮'}),before=receipts(h).length;
   h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_lineage_requests')))return;h.beforeBatch=null;
    if(kind==='dismiss')h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(p.user.id);
    if(kind==='term')h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run('replacement-term',p.user.id);
    if(kind==='ban')h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?)').run(p.user.id,admin.user.id,h.now,h.now);
    if(kind==='merit')merit(h,p,1999);
   };
   await h.api('/court/imperial-house',post(p,body,kind==='ban'||kind==='merit'?403:409));
   assert.equal(receipts(h).length,before);assert.equal(h.sql.prepare('SELECT imperial_house_name FROM court_lineages WHERE user_id=?').get(p.user.id).imperial_house_name,null);
  }
 });
 await scope('lost responses, competing retries and request reuse never create or rename a second house',async h=>{
  await fixture(h,'復元競合の運営',{admin:true});const p=await fixture(h,'復元対象の公家',{staff:true});await choose(h,p);merit(h,p,2000);const body=await request(h,p,{name:'復元宮'});
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_lineage_requests')))return;h.afterBatch=null;throw Error('lost lineage response');};
  await h.api('/court/imperial-house',post(p,body,500));const recovered=(await h.api('/court/imperial-house?receipt=1',post(p,body))).data;assert.equal(recovered.idempotent,true);assert.equal(recovered.receipt.revision,2);
  await h.api('/court/imperial-house?receipt=1',post(p,{...body,name:'別の宮'},409));
  await h.api('/court/imperial-house?receipt=1',post(p,{...body,requestId:crypto.randomUUID()},404));
  const q=await fixture(h,'同時確定の公家',{staff:true});await choose(h,q);merit(h,q,2000);const duplicate=await request(h,q,{name:'同時宮'});let entered=0,release;const barrier=new Promise(resolve=>release=resolve);
  h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_lineage_requests')))return;if(++entered===2){h.beforeBatch=null;release();}await barrier;};
  const results=await Promise.all([h.api('/court/imperial-house',post(q,duplicate)),h.api('/court/imperial-house',post(q,duplicate))]);assert.deepEqual(results.map(r=>r.data.idempotent).sort(),[false,true]);
  assert.equal(receipts(h).filter(r=>r.action==='create-imperial-house').length,2);
 });
 await scope('lineage survives dismissal and campaigns while public profiles carry no new privileges',async h=>{
  const admin=await fixture(h,'永続身分の運営',{admin:true}),p=await fixture(h,'永続する宮家',{staff:true});await choose(h,p,'takatsukasa');merit(h,p,2000);
  const body=await request(h,p,{name:'永続宮'});await h.api('/court/imperial-house',post(p,body));const persisted=lineage(h);
  await h.api('/admin/staff',post(admin,{requestId:crypto.randomUUID(),targetPlayerId:p.user.id,action:'dismiss'}));
  const snapshot=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
  assert.equal(snapshot.user.isStaff,false);assert.equal(snapshot.user.canOperate,false);assert.equal(snapshot.user.courtLineage.class,'imperial');assert.equal(snapshot.user.courtLineage.houseId,'takatsukasa');
  updateSave(h,p,s=>{s.walking.campaignId=crypto.randomUUID();s.courtLineage={class:'imperial',houseId:'kujo',imperialHouseName:'偽装宮'};});
  const me=(await h.api('/me',{token:p.token})).data.user;assert.equal(me.courtLineage.imperialHouseName,'永続宮');assert.equal(me.courtLineage.houseId,'takatsukasa');assert.deepEqual(lineage(h),persisted);
  const profile=(await h.api('/players/'+p.user.id+'/profile')).data.player;assert.deepEqual(profile.courtLineage,me.courtLineage);assert(!Object.hasOwn(profile,'canOperate'));assert(!Object.hasOwn(profile,'isStaff'));
  const receipt=(await h.api('/court/imperial-house?receipt=1',post(p,body))).data;assert.equal(receipt.idempotent,true);assert.equal(receipt.lineage.class,'imperial');assert.equal(receipt.lineage.canCreateImperialHouse,false);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM staff_members WHERE user_id=?').get(p.user.id).n,0);
 });
 await scope('retained-base membership is a family-selection proof without Kyoto service or imperial-creation power',async h=>{
  const p=await fixture(h,'本拠を保持する太政大臣',{admin:true,score:35000}),before=save(h,p),body=await membership(h,p,'kujo');
  const joined=(await h.api('/court/membership',post(p,body))).data;
  assert.equal(joined.admission.joinMode,'retained-base');assert.equal(joined.save.state.home,'edo');assert.equal(joined.user.isAdmin,true);assert.equal(joined.user.isStaff,false);assert.equal(joined.user.courtLineage.houseId,'kujo');assert.equal(joined.user.courtLineage.originalClan,before.state.clan);
  merit(h,p,2000);let current=await status(h,p);assert.equal(current.termId,joined.admission.termId);assert.equal(current.class,'kuge');assert.equal(current.canCreateImperialHouse,false);
  // Exercise the explicit unassigned-proof path without inventing an origin.
  h.sql.prepare('DELETE FROM court_lineages WHERE user_id=?').run(p.user.id);
  current=await status(h,p);assert.equal(current.canChooseHouse,true);assert.equal(current.needsHouseSelection,true);
  const selected=await choose(h,p,'kujo');assert.equal(selected.lineage.originalClan,null);assert.equal(selected.lineage.class,'kuge');assert.equal(selected.lineage.canCreateImperialHouse,false);
  await h.api('/court/imperial-house',post(p,await request(h,p,{name:'保持宮'}),403));
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM staff_members WHERE user_id=?').get(p.user.id).n,0);
  const me=(await h.api('/me',{token:p.token})).data.user;assert.equal(me.isAdmin,true);assert.equal(me.isStaff,false);assert.equal(me.courtLineage.houseId,'kujo');
 });
 await scope('a former appointed left minister starts at Sangi and earns imperial-house eligibility in the formal term',async h=>{
  const admin=await fixture(h,'任命加入の責任者',{admin:true}),p=await fixture(h,'正式加入する任命左大臣',{score:35000}),origin=save(h,p).state.home;
  h.sql.prepare('INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) VALUES(?,?,?,?,?)').run('sadaijin',p.user.id,crypto.randomUUID(),admin.user.id,h.now);
  assert.equal((await h.api('/court',{token:p.token})).data.self.title,'左大臣');assert.equal((await status(h,p)).canCreateImperialHouse,false);
  await h.api('/court/imperial-house',post(p,{requestId:crypto.randomUUID(),expectedRevision:0,termId:'not-enrolled',confirmed:true,name:'未加入宮'},409));assert.equal(lineage(h).length,0);
  const joined=(await h.api('/court/membership',post(p,await membership(h,p,'nijo')))).data;
  assert.equal(joined.admission.joinMode,'retained-base');assert.equal(joined.save.state.home,origin);assert.equal(joined.user.isStaff,false);assert.equal(joined.user.isAdmin,false);assert.equal(joined.user.courtLineage.houseId,'nijo');
  const current=await status(h,p);assert.equal(current.canCreateImperialHouse,false);assert.equal(current.class,'kuge');assert.equal((await h.api('/court',{token:p.token})).data.self.title,'参議');
  merit(h,p,1999);assert.equal((await status(h,p)).canCreateImperialHouse,false);merit(h,p,2000);assert.equal((await status(h,p)).canCreateImperialHouse,true);
  const body=await request(h,p,{name:'任命宮'}),created=(await h.api('/court/imperial-house',post(p,body))).data;assert.equal(created.lineage.class,'imperial');assert.equal(created.lineage.originalClan,'織田家');
  const court=(await h.api('/court',{token:p.token})).data;assert.equal(court.self.title,'左大臣');assert.equal(court.self.canRespond,true);assert.equal(court.self.officeJurisdiction,'kyoto');assert.equal(court.self.isCourtEmperor,false);assert.equal(court.self.canActForEmperor,false);
  h.sql.prepare('DELETE FROM court_office_appointments WHERE user_id=?').run(p.user.id);
  const replay=(await h.api('/court/imperial-house?receipt=1',post(p,body))).data;assert.equal(replay.idempotent,true);assert.equal(replay.lineage.class,'imperial');assert.equal(replay.lineage.imperialHouseName,'任命宮');
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM staff_members WHERE user_id=?').get(p.user.id).n,0);
 });
 await scope('retained formal merit and the exact current term are rechecked at imperial-house commit',async h=>{
  const admin=await fixture(h,'正式在任確認の責任者',{admin:true});
  for(const kind of ['dismiss','replace','merit','ban']){
   const p=await fixture(h,'正式在任失効'+kind,{score:35000});
   h.sql.prepare('INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) VALUES(?,?,?,?,?)').run('sadaijin',p.user.id,crypto.randomUUID(),admin.user.id,h.now);
   await h.api('/court/membership',post(p,await membership(h,p)));merit(h,p,2000);const body=await request(h,p,{name:'失効'+kind+'宮'}),before=receipts(h).length;
   h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_lineage_requests')))return;h.beforeBatch=null;
    if(kind==='dismiss')h.sql.prepare('DELETE FROM court_retained_memberships WHERE user_id=?').run(p.user.id);
    if(kind==='replace')h.sql.prepare('UPDATE court_retained_memberships SET term_id=? WHERE user_id=?').run(crypto.randomUUID(),p.user.id);
    if(kind==='merit')merit(h,p,1999);
    if(kind==='ban')h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?)').run(p.user.id,admin.user.id,h.now,h.now);
   };
   await h.api('/court/imperial-house',post(p,body,kind==='dismiss'||kind==='replace'?409:403));
   assert.equal(receipts(h).length,before);assert.equal(h.sql.prepare('SELECT imperial_house_name FROM court_lineages WHERE user_id=?').get(p.user.id).imperial_house_name,null);
   merit(h,p,0);
  }
 });
 console.log(`Court lineage: ${checks} scenarios, ${calls} API calls, max ${maxBindings} D1 bindings`);
}finally{globalThis.fetch=originalFetch;}
