import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {readCourtProtection} from './court-protection.js';
import {messageRegister} from './message-addressing.js';
import {courtRetirementStatus} from './retirement.js';
import {courtImperialFamilySql} from './court-lineage.js';
import {fixture,post,appoint,makeImperial,nominateSuccessor,certifySuccessor,row,save,count} from './test-court-support.mjs';

let checks=0,calls=0,maxBindings=0;
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const statement of statements){maxBindings=Math.max(maxBindings,statement.params.length);assert(statement.params.length<=100,'D1 bind limit');}return batch(statements);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function family(h,n=3){const admin=await fixture(h,'皇統を認証する太政大臣',{admin:true}),people=[];for(let i=0;i<n;i++){const person=await fixture(h,'皇族の継承者'+i,{staff:true});makeImperial(h,person);people.push(person);}await appoint(h,people[0]);return{admin,people};}
async function retire(h,emperor,target){const nomination=await nominateSuccessor(h,emperor,target);return certifySuccessor(h,h.operator,nomination.nomination);}
const state=async(h,p)=>(await h.api('/court/retirement',{token:p.token})).data.retirement;
const ordination=async(h,p)=>{const current=await state(h,p);return{requestId:crypto.randomUUID(),expectedRevision:current.revision,successionId:current.successionId,confirmed:true};};
const ordain=(h,p,body,expected=200)=>h.api('/court/retirement/ordain',post(p,body,expected));
const holders=h=>h.sql.prepare('SELECT user_id,kind FROM court_retirement_holders ORDER BY kind,user_id').all();
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Imperial retirement tests must not contact real services');};
try{
 await scope('royal ancestry is required in the directory, direct appointment, nomination and approval',async h=>{
  const{admin,people:[emperor]}=await family(h,1),ordinary=await fixture(h,'皇族ではない御所員',{staff:true}),outsider=await fixture(h,'御所未加入の皇族');makeImperial(h,outsider);
  const d=(await h.api('/court/succession',{token:emperor.token})).data;assert(!d.candidates.some(p=>p.id===ordinary.user.id||p.id===outsider.user.id));
  const rejected=await h.api('/admin/court/leader',post(admin,{requestId:crypto.randomUUID(),targetPlayerId:ordinary.user.id},400));assert.equal(rejected.data.error.code,'COURT_IMPERIAL_FAMILY_REQUIRED');
  const body={requestId:crypto.randomUUID(),targetPlayerId:ordinary.user.id,targetTermId:h.sql.prepare('SELECT term_id FROM staff_members WHERE user_id=?').get(ordinary.user.id).term_id,sourceAppointmentToken:d.sourceAppointmentToken};
  assert.equal((await h.api('/court/succession',post(emperor,body,400))).data.error.code,'COURT_IMPERIAL_FAMILY_REQUIRED');
  makeImperial(h,ordinary);const n=(await h.api('/court/succession',post(emperor,body))).data.nomination;
  h.sql.prepare('UPDATE court_lineages SET imperial_house_name=NULL,imperial_house_key=NULL WHERE user_id=?').run(ordinary.user.id);
  await h.api('/admin/court/succession/'+n.id+'/approve',post(admin,{requestId:crypto.randomUUID(),expectedRevision:0},409));
  makeImperial(h,ordinary);const review=(await h.api('/admin/court/succession',{token:admin.token})).data;assert.equal(review.pending.length,0);assert.equal(review.history[0].status,'invalidated');assert.equal(count(h,'court_succession_requests'),0);
 });
 await scope('nomination commit rechecks the royal lineage instead of trusting its earlier candidate read',async h=>{
  const{people:[emperor,target]}=await family(h,2),d=(await h.api('/court/succession',{token:emperor.token})).data,candidate=d.candidates.find(p=>p.id===target.user.id);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_succession_nominations')))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM court_lineages WHERE user_id=?').run(target.user.id);};
  await h.api('/court/succession',post(emperor,{requestId:crypto.randomUUID(),targetPlayerId:target.user.id,targetTermId:candidate.termId,sourceAppointmentToken:d.sourceAppointmentToken},409));
  assert.equal(count(h,'court_succession_nominations'),0);assert.equal(count(h,'court_succession_nomination_requests'),0);
 });
 await scope('certified abdication leaves Kyoto for the fixed Sento palace and preserves the royal house',async h=>{
  const{people:[emperor,target]}=await family(h,2),house=h.sql.prepare('SELECT * FROM court_lineages WHERE user_id=?').get(emperor.user.id),result=await retire(h,emperor,target);
  assert.deepEqual(result.receipt.retirement,{kind:'retired-emperor',title:'上皇'});assert.deepEqual(result.nomination.retirement,result.receipt.retirement);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM staff_members WHERE user_id=?').get(emperor.user.id).n,0);const retired=await state(h,emperor);assert.equal(retired.canRelocate,false);assert.deepEqual(retired.base,{id:'sento_gosho',name:'仙洞御所',fixed:true});
  await h.api('/sync/lease',post(emperor,{deviceId:emperor.deviceId}));assert.equal(save(h,emperor).state.home,'sento_gosho');
  const fixed=await h.api('/castles/residency/relocate',post(emperor,{requestId:crypto.randomUUID(),deviceId:emperor.deviceId,revision:row(h,emperor).revision,castleId:'himeji'},403));assert.equal(fixed.data.error.code,'RESIDENCY_PROTECTED');
  assert.equal(save(h,emperor).state.home,'sento_gosho');assert.equal((await state(h,emperor)).title,'上皇');assert.equal((await state(h,emperor)).shogunateIndependent,true);assert.deepEqual(h.sql.prepare('SELECT * FROM court_lineages WHERE user_id=?').get(emperor.user.id),house);
 });
 await scope('retained-home royal members enter palace service on coronation and leave both memberships when they abdicate',async h=>{
  const{admin,people:[emperor,target]}=await family(h,2),retained=await fixture(h,'本拠を保持する皇族',{score:35000,startCastle:'inuyama'});
  h.sql.prepare("INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) VALUES('sadaijin',?,?,?,?)").run(retained.user.id,crypto.randomUUID(),admin.user.id,h.now);
  const preview=(await h.api('/court/membership',{token:retained.token})).data.membership;assert.equal(preview.joinMode,'retained-base');
  await h.api('/court/membership',post(retained,{requestId:crypto.randomUUID(),deviceId:retained.deviceId,expectedRevision:preview.expectedRevision,expectedHomeCastleId:preview.homeCastleId,expectedJoinMode:preview.joinMode,expectedOfficeToken:preview.officeAppointmentToken,houseId:'kujo',confirmed:true}));makeImperial(h,retained);
  const home=save(h,retained).state.home,d=(await h.api('/court/succession',{token:emperor.token})).data,candidate=d.candidates.find(p=>p.id===retained.user.id);assert.equal(candidate.memberKind,'retained-base');assert.equal(candidate.homeCastleId,home);
  await retire(h,emperor,retained);await h.api('/sync/lease',post(retained,{deviceId:retained.deviceId}));assert.equal((await h.api('/court',{token:retained.token})).data.self.isCourtEmperor,true);assert.equal(save(h,retained).state.home,'kyoto_gosho');
  await ordain(h,emperor,await ordination(h,emperor));const returned=await retire(h,retained,target);assert.equal(returned.receipt.retirement.kind,'imperial');
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_retained_memberships WHERE user_id=?').get(retained.user.id).n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM staff_members WHERE user_id=?').get(retained.user.id).n,0);
  await h.api('/sync/lease',post(retained,{deviceId:retained.deviceId}));assert.equal(save(h,retained).state.home,home);assert.equal((await state(h,retained)).canRelocate,true);
 });
 await scope('ordination is self-confirmed, immutable, idempotent and does not modify a personal campaign',async h=>{
  const{admin,people:[emperor,target]}=await family(h,2);await retire(h,emperor,target);await h.api('/sync/lease',post(emperor,{deviceId:emperor.deviceId}));const before=row(h,emperor),body=await ordination(h,emperor);
  await ordain(h,emperor,{...body,confirmed:false},400);await ordain(h,admin,body,403);await ordain(h,target,body,403);
  const accepted=(await ordain(h,emperor,body)).data;assert.equal(accepted.retirement.title,'法皇');assert.equal(accepted.retirement.isRetiredEmperor,true);assert.equal(accepted.retirement.shogunateIndependent,true);assert.equal(accepted.retirement.canRelocate,false);assert.equal(accepted.retirement.capacity.retired.available,false);assert.equal(accepted.retirement.capacity.cloistered.count,1);assert.deepEqual({...accepted.capacity.shared,holder:Object.fromEntries(['id','name','kind','title'].map(key=>[key,accepted.capacity.shared.holder[key]]))},{limit:1,count:1,available:false,holder:{id:emperor.user.id,name:emperor.user.name,kind:'cloistered-emperor',title:'法皇'}});assert.deepEqual(row(h,emperor),before);assert.equal(save(h,emperor).state.home,'sento_gosho');
  const replay=(await ordain(h,emperor,body)).data;assert.equal(replay.idempotent,true);assert.deepEqual(replay.receipt,accepted.receipt);assert.equal(count(h,'court_ordination_requests'),1);
  await ordain(h,emperor,{...body,expectedRevision:1},409);assert.equal(count(h,'court_cloistered_emperors'),1);
  const profile=(await h.api('/players?q='+encodeURIComponent(emperor.user.name))).data.players.find(p=>p.id===emperor.user.id);assert.deepEqual(profile.courtOffice,{title:'法皇',kind:'cloistered-emperor'});
  assert.equal((await readCourtProtection(h.db,emperor.user.id)).protected,true);assert.deepEqual((await h.api('/court/estate',{token:emperor.token})).data.courtEstate.role,{id:'cloistered-emperor',title:'法皇'});
  const speaker=await fixture(h,'法皇への謁見者'),register=await messageRegister(h.db,speaker.user,{kind:'person',id:emperor.user.id},h.now,async ids=>new Map(ids.map(id=>[id,0])),(status,code,message)=>{throw Object.assign(Error(message),{status,code});});assert.equal(await register.write('ここで待って'),'ここで待っていただけますか');
 });
 await scope('one shared retired-or-cloistered seat returns every other abdicator to royalty without inherited immunity',async h=>{
  const{people:[a,b,c,d]}=await family(h,4);await retire(h,a,b);await ordain(h,a,await ordination(h,a));await retire(h,b,c);
  const full=await state(h,b);assert.equal(full.kind,'imperial');assert.equal(full.canOrdain,false);assert.equal(full.capacity.cloistered.count,1);assert.equal(full.capacity.retired.count,0);assert.equal((await ordain(h,b,await ordination(h,b),403)).data.error.code,'COURT_RETIRED_EMPEROR_REQUIRED');
  // An older reigning Emperor need not have a house. Their actual completed
  // reign supplies royal ancestry without inventing a family or palace name.
  h.sql.prepare('DELETE FROM court_lineages WHERE user_id=?').run(c.user.id);
  const external=await fixture(h,'皇族復帰でも官職を失わない領主');h.sql.prepare("INSERT INTO court_contributions VALUES(?,?,?,'castle','kyoto_gosho',50,50,0,?)").run(crypto.randomUUID(),c.user.id,h.sql.prepare('SELECT term_id FROM staff_members WHERE user_id=?').get(c.user.id).term_id,h.now);
  h.sql.prepare("INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) VALUES('chunagon',?,?,?,?)").run(external.user.id,crypto.randomUUID(),h.operator.user.id,h.now);const office=h.sql.prepare('SELECT * FROM court_office_appointments WHERE user_id=?').get(external.user.id);
  const accepted=await retire(h,c,d);assert.deepEqual(accepted.receipt.retirement,{kind:'imperial',title:'皇族'});assert.equal(holders(h).length,1);
  assert.deepEqual(h.sql.prepare('SELECT * FROM court_office_appointments WHERE user_id=?').get(external.user.id),office);
  const returned=await state(h,c);assert.equal(returned.kind,'imperial');assert.equal(returned.canRelocate,true);assert.equal(returned.canOrdain,false);assert.equal(returned.shogunateIndependent,false);assert(returned.successionId);assert.equal(returned.retiredAt,h.now);
  const me=(await h.api('/me',{token:c.token})).data.user;assert.equal(me.courtLineage.class,'imperial');assert.equal(me.courtLineage.imperialHouseName,null);assert.equal((await h.api('/court',{token:c.token})).data.self.isReturnedImperial,true);
  await h.api('/sync/lease',post(c,{deviceId:c.deviceId}));await h.api('/castles/residency/relocate',post(c,{requestId:crypto.randomUUID(),deviceId:c.deviceId,revision:row(h,c).revision,castleId:'himeji'}));assert.equal(save(h,c).state.home,'himeji');
 });
 await scope('ordination during a pending succession does not vacate the shared retirement seat',async h=>{
  const{people:[a,b,c]}=await family(h,3);await retire(h,a,b);const n=await nominateSuccessor(h,b,c),before=(await h.api('/court/succession',{token:b.token})).data;assert.equal(before.retirementPreview.kind,'imperial');
  await ordain(h,a,await ordination(h,a));const accepted=await certifySuccessor(h,h.operator,n.nomination);assert.equal(accepted.receipt.retirement.kind,'imperial');assert.equal((await state(h,b)).title,'皇族');assert.deepEqual(holders(h).map(r=>[r.user_id,r.kind]),[[a.user.id,'cloistered-emperor']]);
 });
 await scope('approval rechecks the shared slot inside its transaction after a vacant preview',async h=>{
  const{people:[a,b]}=await family(h,2),other=await fixture(h,'直前に復帰した在位者'),n=await nominateSuccessor(h,a,b);assert.equal(n.nomination.retirement.kind,'retired-emperor');
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_succession_requests')))return;h.beforeBatch=null;const commit=crypto.randomUUID();h.sql.prepare('INSERT INTO court_succession_requests VALUES(?,?,?,?,?,?,?,?)').run(other.user.id,crypto.randomUUID(),b.user.id,'concurrent-fixture',commit,crypto.randomUUID(),'{}',h.now);h.sql.prepare('INSERT INTO court_retired_emperors VALUES(?,?,?,?)').run(other.user.id,commit,b.user.id,h.now);};
  const accepted=await certifySuccessor(h,h.operator,n.nomination);assert.equal(accepted.receipt.retirement.kind,'imperial');assert.equal((await state(h,a)).kind,'imperial');assert.deepEqual(holders(h).map(r=>r.user_id),[other.user.id]);
 });
 await scope('a returning former Emperor exchanges the shared seat with the outgoing Emperor atomically',async h=>{
  const{admin,people:[a,b]}=await family(h,2);await retire(h,a,b);await ordain(h,a,await ordination(h,a));
  await h.api('/admin/staff',post(admin,{action:'appoint',targetPlayerId:a.user.id,requestId:crypto.randomUUID()}));
  const candidates=(await h.api('/court/succession',{token:b.token})).data.candidates;assert.equal(candidates.find(p=>p.id===a.user.id).homeCastleId,'sento_gosho');
  const nominated=await nominateSuccessor(h,b,a);assert.equal(nominated.nomination.retirement.kind,'retired-emperor');assert.equal((await h.api('/admin/court/succession',{token:admin.token})).data.retirementPreview.kind,'retired-emperor');
  const accepted=await certifySuccessor(h,admin,nominated.nomination);assert.equal(accepted.receipt.retirement.kind,'retired-emperor');assert.equal((await state(h,a)).kind,'none');assert.equal((await state(h,b)).title,'上皇');assert.equal(count(h,'court_cloistered_emperors'),0);assert.equal(count(h,'court_ordination_requests'),1);assert.deepEqual(holders(h).map(r=>[r.user_id,r.kind]),[[b.user.id,'retired-emperor']]);
  await h.api('/sync/lease',post(a,{deviceId:a.deviceId}));await h.api('/sync/lease',post(b,{deviceId:b.deviceId}));assert.equal(save(h,a).state.home,'kyoto_gosho');assert.equal(save(h,b).state.home,'sento_gosho');
 });
 await scope('concurrent ordination requests commit once and historical receipts cannot restore a title after coronation',async h=>{
  const{people:[a,b]}=await family(h,2);await retire(h,a,b);const body=await ordination(h,a),responses=await Promise.all([ordain(h,a,body),ordain(h,a,body)]);assert.equal(responses.filter(r=>r.data.idempotent).length,1);assert.equal(count(h,'court_cloistered_emperors'),1);assert.equal(count(h,'court_ordination_requests'),1);
  await h.api('/admin/staff',post(h.operator,{action:'appoint',targetPlayerId:a.user.id,requestId:crypto.randomUUID()}));await appoint(h,a);assert.equal(holders(h).length,0);
  const replay=(await ordain(h,a,body)).data;assert.equal(replay.idempotent,true);assert.equal(replay.retirement.kind,'none');assert.equal(replay.receipt.title,'法皇');assert.equal(count(h,'court_cloistered_emperors'),0);
 });
 await scope('failed ordination batches roll back completely and lost responses replay the original committed receipt',async h=>{
  const{people:[a,b]}=await family(h,2);await retire(h,a,b);const body=await ordination(h,a);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_ordination_requests')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_ordination_fixture SET value=1'));};
  await ordain(h,a,body,500);assert.equal(count(h,'court_cloistered_emperors'),0);assert.equal(count(h,'court_ordination_requests'),0);assert.equal((await state(h,a)).title,'上皇');
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_ordination_requests')))return;h.afterBatch=null;throw Error('fixture lost ordination response');};
  await ordain(h,a,body,500);const stored=JSON.parse(h.sql.prepare('SELECT result_json FROM court_ordination_requests').get().result_json),replayed=(await ordain(h,a,body)).data;
  assert.equal(replayed.idempotent,true);assert.deepEqual(replayed.receipt,stored);assert.equal(replayed.retirement.title,'法皇');assert.equal(count(h,'court_cloistered_emperors'),1);assert.equal(count(h,'court_ordination_requests'),1);
 });
 await scope('ordination commit rejects a changed retirement and never grants a title to forged client data',async h=>{
  const{people:[a,b]}=await family(h,2);await retire(h,a,b);const body=await ordination(h,a);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_ordination_requests')))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM court_retired_emperors WHERE user_id=?').run(a.user.id);};
  await ordain(h,a,body,403);assert.equal(count(h,'court_cloistered_emperors'),0);assert.equal(count(h,'court_ordination_requests'),0);assert.equal((await state(h,a)).kind,'imperial');
 });
 await scope('database seat constraints reject any second holder before and after the incumbent ordains',async h=>{
  const{people:[a,b]}=await family(h,2);await retire(h,a,b);
  const extra=await fixture(h,'定員外の退位者'),commit=crypto.randomUUID();h.sql.prepare('INSERT INTO court_succession_requests VALUES(?,?,?,?,?,?,?,?)').run(extra.user.id,crypto.randomUUID(),b.user.id,'fixture',commit,crypto.randomUUID(),'{}',h.now);
  const duplicate=()=>h.sql.prepare('INSERT INTO court_retired_emperors VALUES(?,?,?,?)').run(extra.user.id,commit,b.user.id,h.now);
  assert.throws(duplicate,/COURT_RETIRED_EMPEROR_OCCUPIED/);await ordain(h,a,await ordination(h,a));assert.throws(duplicate,/COURT_RETIRED_EMPEROR_OCCUPIED/);
  assert.throws(()=>h.sql.prepare('INSERT INTO court_cloistered_emperors(user_id,succession_id,ordained_at) VALUES(?,?,?)').run(extra.user.id,commit,h.now),/COURT_CLOISTERED_EMPEROR_OCCUPIED/);assert.equal(holders(h).length,1);
 });
 for(const action of ['dismiss-crown','dismiss-staff','replace-term'])await scope('a legacy former retirement never revives after '+action,async h=>{
  const{admin,people:[emperor,next]}=await family(h,2),retired=await fixture(h,'現在の上皇');
  for(const actor of [emperor,retired]){const commit=crypto.randomUUID();h.sql.prepare('INSERT INTO court_succession_requests VALUES(?,?,?,?,?,?,?,?)').run(actor.user.id,crypto.randomUUID(),next.user.id,'legacy',commit,'older-crown-'+actor.user.id,'{}',h.now);h.sql.prepare('INSERT INTO court_retired_emperors VALUES(?,?,?,?)').run(actor.user.id,commit,next.user.id,h.now);}
  assert.equal(holders(h).length,1);
  if(action==='dismiss-crown')await h.api('/admin/court/leader',post(admin,{requestId:crypto.randomUUID(),targetPlayerId:null}));
  else if(action==='dismiss-staff')await h.api('/admin/staff',post(admin,{requestId:crypto.randomUUID(),action:'dismiss',targetPlayerId:emperor.user.id}));
  else h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run(crypto.randomUUID(),emperor.user.id);
  assert.equal(holders(h).length,1);assert.equal(holders(h)[0].user_id,retired.user.id);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_retired_emperors WHERE user_id=?').get(emperor.user.id).n,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_succession_requests WHERE actor_id=?').get(emperor.user.id).n,1);
 });
}finally{globalThis.fetch=network;}

// Older worlds also receive exactly one shared seat. Normalization changes
// active titles only, retaining imperial ancestry, history and personal assets.
{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');const journal=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8'));
 const apply=tag=>{for(const sql of readFileSync(new URL('./drizzle/'+tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.exec(sql);};
 try{for(const entry of journal.entries.filter(e=>e.idx<64))apply(entry.tag);for(const id of ['first','second','third','reigning','successor'])db.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,1,1)').run(id,id,id,'織田家',id);
  db.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,0)').run('reigning','successor',1,'current-term');db.prepare('INSERT INTO court_leader(id,user_id,term_id,appointment_token,appointed_by,updated_at) VALUES(1,?,?,?,?,1)').run('reigning','current-term','current-crown','successor');
  for(const [id,at] of [['first',20],['second',10],['third',10],['reigning',1]]){
   db.prepare('INSERT INTO court_succession_requests VALUES(?,?,?,?,?,?,?,?)').run(id,id,'successor',id,'commit-'+id,'older-crown-'+id,'{}',at);db.prepare('INSERT INTO court_retired_emperors VALUES(?,?,?,?)').run(id,'commit-'+id,'successor',at);
   if(id!=='third')db.prepare("INSERT INTO court_lineages(user_id,house_id,original_clan,imperial_house_name,imperial_house_key,revision,created_at,updated_at) VALUES(?,'konoe','織田家',?,?,1,1,1)").run(id,id+'宮',id+'宮');
   db.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,1,1)').run(id,JSON.stringify({state:{home:'kiyosu',resources:{gold:12345},personalMarker:id}}));
  }
  const preserved=['court_succession_requests','court_lineages','player_saves'],before=preserved.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());apply('0064_imperial_retirement');
  assert.deepEqual(db.prepare('SELECT user_id FROM court_retirement_holders').all().map(row=>row.user_id),['second']);assert.deepEqual(db.prepare('SELECT user_id FROM court_retired_emperors').all().map(row=>row.user_id),['second']);assert.deepEqual(preserved.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()),before);
  const d1={prepare:sql=>({bind:(...params)=>({first:async()=>db.prepare(sql).get(...params)||null,all:async()=>({results:db.prepare(sql).all(...params)})})})};
  for(const id of ['first','third']){const status=await courtRetirementStatus({db:d1,user:{id}});assert.equal(status.kind,'imperial');assert.equal(status.isReturnedImperial,true);assert.equal(status.isRetiredEmperor,false);assert.equal(status.shogunateIndependent,false);assert.equal(status.canRelocate,true);assert.equal(status.base,null);assert.equal(db.prepare('SELECT '+courtImperialFamilySql('u.id')+' AS royal FROM users u WHERE u.id=?').get(id).royal,1);}
  assert.equal((await courtRetirementStatus({db:d1,user:{id:'second'}})).title,'上皇');assert.equal((await courtRetirementStatus({db:d1,user:{id:'reigning'}})).kind,'none');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);checks++;console.log('PASS legacy migration keeps the earliest single seat and returns later holders to royalty with history, lineage and assets intact');
 }finally{db.close();}
}
console.log(JSON.stringify({ok:true,checks,calls,maxBindings,productionRequests:0}));
