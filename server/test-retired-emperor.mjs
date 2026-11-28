import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {fixture,post,appoint,row,save,count,nominateSuccessor,makeImperial} from './test-court-support.mjs';
import {messageRegister} from './message-addressing.js';

let checks=0,calls=0;
async function scope(name,test){const h=harness();try{await test(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function family(h){
 const operator=await fixture(h,'皇位継承の太政大臣',{admin:true});
 const current=await fixture(h,'退位する天皇',{staff:true}),next=await fixture(h,'次代の御所担当',{staff:true}),other=await fixture(h,'別の御所担当',{staff:true}),ordinary=await fixture(h,'通常城の領主');
 await appoint(h,current);makeImperial(h,next);makeImperial(h,other);return{operator,current,next,other,ordinary};
}
const body=next=>({requestId:crypto.randomUUID(),targetPlayerId:next.user.id});
async function retire(h,current,operation,expected=200){
 h.retirementIntents||=new Map();const key=current.user.id+':'+operation.requestId;
 let intent=h.retirementIntents.get(key);
 const checked=response=>{if(expected!==null)assert.equal(response.response.status,expected,JSON.stringify(response.data.error));return response;};
 if(!intent){
  const directory=await h.api('/court/succession',{token:current.token,expected:null});if(directory.response.status!==200)return checked(directory);
  intent={...operation,targetTermId:directory.data.candidates.find(p=>p.id===operation.targetPlayerId)?.termId||'not-eligible',sourceAppointmentToken:directory.data.sourceAppointmentToken};h.retirementIntents.set(key,intent);
 }
 const submitted=await h.api('/court/succession',post(current,{...intent,targetPlayerId:operation.targetPlayerId},null));if(submitted.response.status!==200)return checked(submitted);
 return checked(await h.api('/admin/court/succession/'+submitted.data.nomination.id+'/approve',post(h.operator,{requestId:'certify-'+operation.requestId,expectedRevision:0},null)));
}
const effects=h=>Object.fromEntries(['court_leader','staff_members','staff_campaign_backups','player_saves','court_retired_emperors','court_succession_requests'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all()]));
const isSuccession=statements=>statements.some(s=>s.sql.includes('INSERT INTO court_succession_requests'));
const publicPerson=async(h,person)=>(await h.api('/players?q='+encodeURIComponent(person.user.name)+'&limit=50')).data.players.find(p=>p.id===person.user.id);
async function register(h,sender,audience){return messageRegister(h.db,sender.user,audience,h.now,async ids=>new Map(ids.map(id=>[id,0])),(status,code,message)=>{throw Object.assign(Error(message),{status,code});});}

// Upgrade a populated pre-succession database. Existing six-seat receipts and
// all role invalidation triggers must survive the new title projection.
{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const entries=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8')).entries;
 const apply=tag=>{for(const sql of readFileSync(new URL('./drizzle/'+tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.exec(sql);};
 try{
  for(const entry of entries.filter(e=>e.idx<44))apply(entry.tag);
  for(const id of ['u_migration_admin','u_migration_holder'])db.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(id,id,id,'織田家',id,1,1);
  db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId','u_migration_admin',1)").run();
  db.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,1,1)').run('u_migration_holder',JSON.stringify({state:{home:'kiyosu'}}));
  db.exec("INSERT INTO court_office_state VALUES(1,5); INSERT INTO court_office_appointments VALUES('sadaijin','u_migration_holder','old-token','u_migration_admin',1); INSERT INTO court_office_requests VALUES('u_migration_admin','old-request','appoint','sadaijin','u_migration_holder',5,'old-hash','old-commit',1)");
  const tables=['court_office_appointments','court_office_requests','court_office_state'],before=tables.map(table=>db.prepare('SELECT * FROM '+table).all());
  db.exec('BEGIN IMMEDIATE');apply('0044_retired_emperor');db.exec('COMMIT');
  assert.deepEqual(tables.map(table=>db.prepare('SELECT * FROM '+table).all()),before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM court_external_offices').get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'court_office_%'").get().n,20);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>db.prepare("UPDATE court_office_appointments SET office_id='joko'").run(),/CHECK/,'上皇 is acquired by abdication, never direct office appointment');
  checks++;console.log('PASS populated migration preserves existing appointments, receipts and constraints');
 }finally{db.close();}
}

const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Succession tests must not contact a real service');};
try{
 await scope('only the reigning Emperor sees current Kyoto successors and invalid targets are rejected',async h=>{
  const f=await family(h);await h.api('/court/succession',{expected:401});
  for(const p of [f.operator,f.next,f.ordinary])await h.api('/court/succession',{token:p.token,expected:403});
  const list=(await h.api('/court/succession',{token:f.current.token})).data;
  assert.equal(list.canNominate,true);assert.equal(list.canAbdicate,false);assert.equal(list.approvalRequired,true);assert.deepEqual(new Set(list.candidates.map(p=>p.id)),new Set([f.next.user.id,f.other.user.id]));
  for(const candidate of list.candidates){assert(candidate.termId);assert.equal(candidate.homeCastleId,'kyoto_gosho');}
  for(const p of [f.current,f.operator,f.ordinary])assert.equal((await retire(h,f.current,body(p),400)).data.error.code,'COURT_SUCCESSOR_REQUIRED');
  await retire(h,f.operator,body(f.next),403);
  assert.equal(count(h,'court_succession_requests'),0);assert.equal(count(h,'court_retired_emperors'),0);
 });
 await scope('abdication atomically moves the crown and moves the predecessor personal campaign to Sento on sync',async h=>{
  const f=await family(h),beforeSave=save(h,f.current),beforeNext=row(h,f.next),backup=h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(f.current.user.id);
  const result=(await retire(h,f.current,body(f.next))).data;
  assert.equal(result.idempotent,false);assert.equal(result.needsSync,false);assert.equal(result.user,undefined);assert.equal(result.nomination.status,'approved');
  assert.equal(result.receipt.targetPlayerId,f.next.user.id);assert.equal(result.receipt.resolvedAt,h.now);
  assert.equal(h.sql.prepare('SELECT user_id FROM court_leader').get().user_id,f.next.user.id);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM staff_members WHERE user_id=?').get(f.current.user.id).n,0);
  assert.equal(count(h,'court_retired_emperors'),1);assert.deepEqual(row(h,f.next),beforeNext);
  assert.equal(h.sql.prepare('SELECT save_json FROM staff_campaign_backups WHERE user_id=?').get(f.current.user.id).save_json,backup.save_json);
  assert.notEqual(h.sql.prepare('SELECT left_elapsed_ms FROM staff_campaign_backups WHERE user_id=?').get(f.current.user.id).left_elapsed_ms,null);
  const restored=(await h.api('/sync?deviceId='+f.current.deviceId,{token:f.current.token})).data;
  assert.equal(restored.user.isStaff,false);assert.equal(restored.save.state.home,'sento_gosho');assert.equal(restored.save.state.cycle.home,'sento_gosho');
  assert.equal(h.sql.prepare('SELECT save_json FROM staff_campaign_backups WHERE user_id=?').get(f.current.user.id).save_json,backup.save_json);
  for(const key of ['resources','officers','officerVariants'])assert.deepEqual(restored.save.state[key],beforeSave.state[key],key+' remains personal property');
  assert.equal((await h.api('/court',{token:f.current.token})).data.self.title,'上皇');
  const newCourt=(await h.api('/court',{token:f.next.token})).data;assert.equal(newCourt.self.title,'天皇');assert.equal(newCourt.self.isCourtEmperor,true);
  await h.api('/staff/court',{token:f.current.token,expected:403});await h.api('/court/succession',{token:f.current.token,expected:403});
  const rightId='sg_'+crypto.randomUUID().replaceAll('-','');
  h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at) VALUES(?,?,'event','succession-approval','皇位継承後の幕府',?)").run(rightId,f.ordinary.user.id,h.now);
  await h.api('/shogunate/open',post(f.ordinary,{requestId:crypto.randomUUID(),rightId}));
  assert.equal((await h.api('/shogunate',{token:f.current.token})).data.shogunate.canApprove,false);
  await h.api('/shogunate/approve',post(f.current,{requestId:crypto.randomUUID(),rightId},403));
  await h.api('/shogunate/approve',post(f.next,{requestId:crypto.randomUUID(),rightId}));
  assert.equal(h.sql.prepare('SELECT status FROM shogunate_approvals WHERE right_id=?').get(rightId).status,'approved');
  assert.deepEqual((await publicPerson(h,f.current)).courtOffice,{title:'上皇',kind:'retired-emperor'});
  assert.deepEqual((await publicPerson(h,f.next)).courtOffice,{title:'天皇',kind:'emperor'});
 });
 await scope('lost responses replay after staff removal without repeating succession or changing receipts',async h=>{
  const f=await family(h),operation=body(f.next);
  h.afterBatch=statements=>{if(!isSuccession(statements))return;h.afterBatch=null;throw Error('fixture response loss');};
  await retire(h,f.current,operation,500);const committed=effects(h),retry=(await retire(h,f.current,operation)).data;
  assert.equal(retry.idempotent,true);assert.equal(retry.user,undefined);assert.equal(retry.nomination.status,'approved');assert.deepEqual(effects(h),committed);
  await retire(h,f.current,{...operation,targetPlayerId:f.other.user.id},409);
  await retire(h,f.current,body(f.other),403);assert.deepEqual(effects(h),committed);
 });
 await scope('an invalid batch rolls back the crown, retirement, receipt and departure marker together',async h=>{
  const f=await family(h),before=effects(h);
  h.beforeBatch=statements=>{if(!isSuccession(statements))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE absent_succession_table SET value=1'));};
  await retire(h,f.current,body(f.next),500);assert.deepEqual(effects(h),before);
 });
 await scope('abdication never transiently revokes an unrelated external merit office',async h=>{
  const f=await family(h);
  h.sql.prepare("INSERT INTO court_contributions(job_id,actor_id,staff_term,kind,target_id,target_level,points,completed_elapsed_ms,created_at) VALUES(?,?,?,'castle','kyoto_gosho',50,50,0,?)").run('retirement-merit',f.current.user.id,h.sql.prepare('SELECT term_id FROM staff_members WHERE user_id=?').get(f.current.user.id).term_id,h.now);
  const catalog=(await h.api('/admin/court/offices',{token:f.operator.token})).data;
  await h.api('/admin/court/offices',post(f.operator,{requestId:crypto.randomUUID(),action:'appoint',officeId:'chunagon',targetPlayerId:f.ordinary.user.id,expectedRevision:catalog.revision}));
  const before=h.sql.prepare('SELECT * FROM court_office_appointments').all();
  await retire(h,f.current,body(f.next));assert.deepEqual(h.sql.prepare('SELECT * FROM court_office_appointments').all(),before);
 });
 for(const [label,mutate]of [
  ['Emperor replacement token',(h,f)=>h.sql.prepare('UPDATE court_leader SET appointment_token=?').run(crypto.randomUUID())],
  ['Emperor staff term',(h,f)=>h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run('replacement-term',f.current.user.id)],
  ['successor staff term',(h,f)=>h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run('replacement-term',f.next.user.id)],
  ['successor ban',(h,f)=>h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)').run(f.next.user.id,f.operator.user.id,h.now)]
 ])await scope('commit rejects a changed '+label,async h=>{
  const f=await family(h),saved=row(h,f.current).save_json;
  h.beforeBatch=statements=>{if(!isSuccession(statements))return;h.beforeBatch=null;mutate(h,f);};
  await retire(h,f.current,body(f.next),409);
  assert.equal(count(h,'court_retired_emperors'),0);assert.equal(count(h,'court_succession_requests'),0);assert.equal(row(h,f.current).save_json,saved);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM staff_members WHERE user_id=?').get(f.current.user.id).n,1);
 });
 await scope('competing certifications yield exactly one crown transfer',async h=>{
  const f=await family(h),submitted=await nominateSuccessor(h,f.current,f.next);let entered=0,release;const barrier=new Promise(resolve=>release=resolve);
  h.beforeBatch=async statements=>{if(!isSuccession(statements))return;if(++entered===2){h.beforeBatch=null;release();}await barrier;};
  const outcomes=await Promise.all([1,2].map(()=>h.api('/admin/court/succession/'+submitted.nomination.id+'/approve',post(f.operator,{requestId:crypto.randomUUID(),expectedRevision:0},null))));
  assert.deepEqual(outcomes.map(outcome=>outcome.response.status).sort(),[200,409]);
  assert.equal(count(h,'court_retired_emperors'),1);assert.equal(count(h,'court_succession_requests'),1);
  const winner=outcomes.find(outcome=>outcome.response.status===200).data.receipt.targetPlayerId;
  assert.equal(h.sql.prepare('SELECT user_id FROM court_leader').get().user_id,winner);
 });
 await scope('candidate responses are withdrawn if the Emperor loses authority during decoration',async h=>{
  const f=await family(h);
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('public-court-office')))return;h.afterBatch=null;h.sql.prepare('UPDATE court_leader SET appointment_token=?').run(crypto.randomUUID());};
  await h.api('/court/succession',{token:f.current.token,expected:409});
 });
 await scope('retired title grants courtesy but no staff audience and never becomes a seventh appointment slot',async h=>{
  const f=await family(h);await retire(h,f.current,body(f.next));await h.api('/sync?deviceId='+f.current.deviceId,{token:f.current.token});
  const prepared=await register(h,f.ordinary,{kind:'person',id:f.current.user.id});assert.equal(await prepared.write('ここで待って'),'ここで待っていただけますか');
  const publicAudience=await register(h,f.ordinary,{kind:'public'}),privateAudience=await register(h,f.ordinary,{kind:'officials'});
  const ids=value=>JSON.parse(value.guard.args.at(-1))[3].map(row=>row[0]);assert(ids(publicAudience).includes(f.current.user.id));assert(!ids(privateAudience).includes(f.current.user.id));
  const directory=(await h.api('/admin/court/offices',{token:f.operator.token})).data;assert.equal(directory.offices.length,6);assert(!directory.candidates.some(p=>p.id===f.current.user.id));
  await h.api('/admin/court/offices',post(f.operator,{requestId:crypto.randomUUID(),action:'appoint',officeId:'joko',targetPlayerId:f.ordinary.user.id,expectedRevision:directory.revision},400));
  await h.api('/chat',post(f.current,{channel:'admin',text:'御所の私信'},403));
 });
 await scope('reappointment preserves one title, while a new reign takes precedence over retirement history',async h=>{
  const f=await family(h);await retire(h,f.current,body(f.next));
  await h.api('/admin/staff',post(f.operator,{requestId:crypto.randomUUID(),targetPlayerId:f.current.user.id,action:'appoint'}));
  assert.deepEqual((await publicPerson(h,f.current)).courtOffice,{title:'上皇',kind:'retired-emperor'});
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_kyoto_offices WHERE user_id=?').get(f.current.user.id).n,0);
  await appoint(h,f.current);
  assert.deepEqual((await publicPerson(h,f.current)).courtOffice,{title:'天皇',kind:'emperor'});
  assert.equal(h.sql.prepare('SELECT office_id FROM court_kyoto_offices WHERE user_id=?').get(f.current.user.id).office_id,'emperor');
 });
}finally{globalThis.fetch=network;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
