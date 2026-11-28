import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {harness,syncFieldWriter} from './test-support.mjs';
import {fixture,post,appoint,row,save,count,makeImperial} from './test-court-support.mjs';

const UI=createRequire(import.meta.url)('../court.js'),DAY=86400000,publishedVersion=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version;
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function family(h){const admin=await fixture(h,'認証する太政大臣',{admin:true}),emperor=await fixture(h,'後継を指名する天皇',{staff:true}),target=await fixture(h,'指名される御所担当',{staff:true}),other=await fixture(h,'別の御所担当',{staff:true}),ordinary=await fixture(h,'一般拠点の領主',{startCastle:'inuyama'});await appoint(h,emperor);makeImperial(h,target);makeImperial(h,other);return{admin,emperor,target,other,ordinary};}
async function directory(h,actor,isAdmin=false){const data=(await h.api(isAdmin?'/admin/court/succession':'/court/succession',{token:actor.token})).data;assert.doesNotThrow(()=>isAdmin?UI.cleanSuccessionReview(data):UI.cleanSuccession(data));return data;}
async function intent(h,actor,target,requestId=crypto.randomUUID()){const d=await directory(h,actor);return{requestId,targetPlayerId:target.user.id,targetTermId:d.candidates.find(p=>p.id===target.user.id)?.termId||'ineligible',sourceAppointmentToken:d.sourceAppointmentToken};}
async function nominate(h,actor,body,expected=200){const result=await h.api('/court/succession',post(actor,body,expected));if(result.response.status===200)assert.doesNotThrow(()=>UI.cleanSuccessionResult(result.data,{kind:'succession',data:body},actor.user.id));return{...result,body};}
async function decide(h,actor,nomination,action,extra={},expected=200){const n=nomination.nomination||nomination,body={requestId:crypto.randomUUID(),expectedRevision:n.revision,...extra},route=(action==='cancel'?'/court/succession/':'/admin/court/succession/')+n.id+'/'+action,result=await h.api(route,post(actor,body,expected));if(result.response.status===200)assert.doesNotThrow(()=>UI.cleanSuccessionResult(result.data,{kind:action==='cancel'?'succession-cancel':'succession-review',action,nominationId:n.id,targetPlayerId:n.successor.id,data:body},actor.user.id));return{...result,body};}
const coreTables=['court_leader','staff_members','staff_campaign_backups','player_saves','court_retired_emperors','court_succession_requests','court_regent','court_office_appointments'];
const tableState=(h,tables)=>Object.fromEntries(tables.map(table=>[table,h.sql.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all()]));
const core=h=>tableState(h,coreTables),all=h=>tableState(h,[...coreTables,'court_succession_nominations','court_succession_nomination_requests']);
const isApproval=statements=>statements.some(s=>s.sql.includes('INSERT INTO court_succession_requests('));
const isNomination=statements=>statements.some(s=>s.sql.includes('INSERT INTO court_succession_nominations('));
async function makeRegent(h,f,target){const d=(await h.api('/admin/court/regent',{token:f.admin.token})).data;await h.api('/admin/court/regent',post(f.admin,{action:'appoint',targetPlayerId:target.user.id,expectedRevision:d.revision,requestId:crypto.randomUUID()}));}

// A populated 5.11.0 database retains its completed receipt, title, crown and
// six-seat appointments while the new pending workflow starts empty.
{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');const entries=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8')).entries;
 const apply=tag=>{for(const sql of readFileSync(new URL('./drizzle/'+tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.exec(sql);};
 try{
  for(const e of entries.filter(e=>e.idx<47))apply(e.tag);
  for(const id of ['u_previous','u_successor','u_admin'])db.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(id,id,id,'織田家',id,1,1);
  db.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES(?,?,1,?)').run('u_successor','u_admin','new-term');
  db.prepare('INSERT INTO court_leader(id,user_id,term_id,appointment_token,appointed_by,updated_at) VALUES(1,?,?,?,?,1)').run('u_successor','new-term','new-crown','u_previous');
  db.prepare('INSERT INTO court_succession_requests(actor_id,request_id,target_id,request_hash,commit_token,source_appointment_token,result_json,created_at) VALUES(?,?,?,?,?,?,?,1)').run('u_previous','old-request','u_successor','old-hash','old-commit','old-crown','{"retiredAt":1}');
  db.prepare('INSERT INTO court_retired_emperors VALUES(?,?,?,1)').run('u_previous','old-commit','u_successor');
  const tables=['court_leader','staff_members','court_retired_emperors','court_succession_requests'],before=tables.map(t=>db.prepare('SELECT * FROM '+t).all());db.exec('BEGIN IMMEDIATE');apply('0047_imperial_succession_approval');db.exec('COMMIT');
  assert.deepEqual(tables.map(t=>db.prepare('SELECT * FROM '+t).all()),before);assert.equal(db.prepare('SELECT COUNT(*) n FROM court_succession_nominations').get().n,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'court_succession_nomination_%'").get().n,9);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);checks++;console.log('PASS additive migration preserves completed crowns, retirements and legacy receipts');
 }finally{db.close();}
}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Succession certification tests must stay local');};
try{
 await scope('health requires both approval tables and every invalidation trigger before advertising the new feature',async h=>{
  const ready=(await h.api('/health')).data;assert.equal(ready.version,publishedVersion);assert.equal(ready.features.imperialSuccessionApproval,true);
  for(const table of ['court_succession_nominations','court_succession_nomination_requests']){h.sql.exec('ALTER TABLE '+table+' RENAME TO fixture_hidden_nomination');await h.api('/health',{expected:503});h.sql.exec('ALTER TABLE fixture_hidden_nomination RENAME TO '+table);}
  h.sql.exec('DROP TRIGGER court_succession_nomination_crown_delete');await h.api('/health',{expected:503});
 });
 await scope('only the Emperor may nominate and only the Chancellor may certify, including when a Regent is present',async h=>{
  const f=await family(h);await makeRegent(h,f,f.ordinary);const input=await intent(h,f.emperor,f.target);
  await h.api('/court/succession',{expected:401});await h.api('/admin/court/succession',{expected:401});
  for(const actor of [f.admin,f.target,f.other,f.ordinary]){await h.api('/court/succession',{token:actor.token,expected:403});await nominate(h,actor,{...input,requestId:crypto.randomUUID()},403);}
  for(const actor of [f.emperor,f.target,f.ordinary])await h.api('/admin/court/succession',{token:actor.token,expected:403});
  const submitted=(await nominate(h,f.emperor,input)).data;for(const actor of [f.emperor,f.target,f.ordinary]){await decide(h,actor,submitted,'approve',{},403);await decide(h,actor,submitted,'reject',{},403);}
  await decide(h,f.ordinary,submitted,'cancel',{},403);assert.equal((await directory(h,f.admin,true)).pending.length,1);assert.equal(count(h,'court_retired_emperors'),0);
 });
 await scope('old clients cannot perform a new instant abdication and cannot supply approval or plan fields',async h=>{
  const f=await family(h),before=core(h),old={requestId:crypto.randomUUID(),targetPlayerId:f.target.user.id};const legacy=await h.api('/court/succession',post(f.emperor,old,400));assert.equal(legacy.data.error.code,'COURT_SUCCESSION_APPROVAL_REQUIRED');
  const input=await intent(h,f.emperor,f.target);for(const extra of [{approved:true},{action:'approve'},{needsSync:true},{status:'approved'},{retiredAt:h.now},{user:f.admin.user}])await nominate(h,f.emperor,{...input,...extra,requestId:crypto.randomUUID()},400);
  for(const extra of [{targetTermId:''},{sourceAppointmentToken:''},{targetTermId:null},{sourceAppointmentToken:'x'.repeat(151)}])await nominate(h,f.emperor,{...input,...extra},400);
  await h.api('/court/succession?approve=1',{token:f.emperor.token,expected:400});assert.deepEqual(core(h),before);assert.equal(count(h,'court_succession_nominations'),0);
 });
 await scope('a nomination leaves roles, saves, bases and powers unchanged and never certifies itself after 72 hours',async h=>{
  const f=await family(h);await makeRegent(h,f,f.target);const input=await intent(h,f.emperor,f.target),before=core(h),submitted=(await nominate(h,f.emperor,input)).data;
  assert.equal(submitted.receipt.status,'pending');assert.equal(submitted.nomination.status,'pending');assert.equal(submitted.nomination.revision,0);assert.equal(submitted.nomination.resolvedAt,null);assert.equal(submitted.user,undefined);assert.equal(submitted.needsSync,false);assert.deepEqual(core(h),before);
  assert.equal((await h.api('/court',{token:f.emperor.token})).data.self.isCourtEmperor,true);assert.equal((await h.api('/court',{token:f.target.token})).data.self.isCourtRegent,true);assert.equal((await directory(h,f.emperor)).pending.id,submitted.nomination.id);
  h.now+=3*DAY+1;await h.api('/notifications/tick',{method:'POST'});assert.equal((await directory(h,f.admin,true)).pending[0].status,'pending');assert.deepEqual(core(h),before);
 });
 await scope('certification alone moves the crown and clears a successor regency using approval time while preserving assets',async h=>{
  const f=await family(h);await makeRegent(h,f,f.target);const input=await intent(h,f.emperor,f.target),submitted=(await nominate(h,f.emperor,input)).data,targetBefore=row(h,f.target),regentBefore=h.sql.prepare('SELECT * FROM court_regent').get();assert(regentBefore);
  h.now+=60000;const clock=(await h.api('/world-clock')).data.clock;await syncFieldWriter(h,f.emperor);const before=row(h,f.emperor),approved=(await decide(h,f.admin,submitted,'approve')).data;assert.equal(approved.receipt.action,'approve');assert.equal(approved.nomination.status,'approved');assert.equal(approved.nomination.resolvedBy.id,f.admin.user.id);assert.equal(approved.nomination.resolvedAt,h.now);assert.equal(approved.user,undefined);assert.equal(approved.needsSync,false);
  assert.equal(h.sql.prepare('SELECT user_id FROM court_leader').get().user_id,f.target.user.id);assert.equal(h.sql.prepare('SELECT * FROM court_regent').get(),undefined);assert.equal(count(h,'court_retired_emperors'),1);assert.equal(count(h,'court_succession_requests'),1);assert.equal(h.sql.prepare('SELECT left_elapsed_ms FROM staff_campaign_backups WHERE user_id=?').get(f.emperor.user.id).left_elapsed_ms,clock.elapsedMs);assert.deepEqual(row(h,f.target),targetBefore);assert.equal(row(h,f.emperor).save_json,before.save_json);
  const synced=(await h.api('/sync?deviceId='+f.emperor.deviceId,{token:f.emperor.token})).data;assert.equal(synced.user.isStaff,false);assert(!['edo','kyoto_gosho'].includes(synced.save.state.home));for(const key of ['resources','officers','officerVariants'])assert.deepEqual(synced.save.state[key],JSON.parse(before.save_json).state[key]);
  const replay=(await nominate(h,f.emperor,input)).data;assert.equal(replay.idempotent,true);assert.equal(replay.receipt.status,'pending');assert.equal(replay.nomination.status,'approved');assert.deepEqual(replay.receipt,submitted.receipt);
 });
 await scope('rejection and cancellation are terminal, do not transfer roles, and permit a fresh nomination in the same reign',async h=>{
  const f=await family(h),input=await intent(h,f.emperor,f.target),before=core(h),first=(await nominate(h,f.emperor,input)).data,rejected=await decide(h,f.admin,first,'reject');assert.equal(rejected.data.nomination.reason,'rejected');assert.deepEqual(core(h),before);assert.equal((await directory(h,f.admin,true)).pending.length,0);
  const again=await decide(h,f.admin,first,'reject',rejected.body);assert.equal(again.data.idempotent,true);assert.deepEqual(again.data.receipt,rejected.data.receipt);const old=(await nominate(h,f.emperor,input)).data;assert.deepEqual(old.receipt,first.receipt);assert.equal(old.nomination.status,'rejected');
  const second=(await nominate(h,f.emperor,await intent(h,f.emperor,f.other))).data,cancelled=await decide(h,f.emperor,second,'cancel');assert.equal(cancelled.data.nomination.reason,'cancelled');assert.equal(cancelled.data.nomination.resolvedBy.id,f.emperor.user.id);assert.deepEqual(core(h),before);assert.equal((await decide(h,f.emperor,second,'cancel',cancelled.body)).data.idempotent,true);
  await decide(h,f.admin,first,'approve',{},409);await decide(h,f.admin,second,'approve',{},409);const third=(await nominate(h,f.emperor,await intent(h,f.emperor,f.target))).data;assert.equal(third.nomination.status,'pending');assert.equal((await directory(h,f.emperor)).history.length,2);
 });
 await scope('same-request nomination retries converge and different concurrent successors cannot replace the pending choice',async h=>{
  const f=await family(h),input=await intent(h,f.emperor,f.target),same=await Promise.all([nominate(h,f.emperor,input),nominate(h,f.emperor,input)]);assert.equal(same.filter(r=>r.data.idempotent).length,1);assert.equal(count(h,'court_succession_nominations'),1);assert.deepEqual(same[0].data.receipt,same[1].data.receipt);
  await nominate(h,f.emperor,{...input,targetPlayerId:f.other.user.id},409);await nominate(h,f.emperor,await intent(h,f.emperor,f.other),409);await decide(h,f.emperor,same[0].data,'cancel');
  const one=await intent(h,f.emperor,f.target),two=await intent(h,f.emperor,f.other),outcomes=await Promise.all([nominate(h,f.emperor,one,null),nominate(h,f.emperor,two,null)]);assert.deepEqual(outcomes.map(r=>r.response.status).sort(),[200,409]);assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM court_succession_nominations WHERE status='pending'").get().n,1);assert.equal(count(h,'court_succession_requests'),0);
 });
 for(const competing of ['reject','cancel'])await scope('simultaneous certification and '+competing+' commit exactly one outcome',async h=>{
  const f=await family(h),n=(await nominate(h,f.emperor,await intent(h,f.emperor,f.target))).data;let entered=0,release;const barrier=new Promise(r=>release=r);
  h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_succession_nomination_requests')))return;if(++entered===2){h.beforeBatch=null;release();}await barrier;};
  const outcomes=await Promise.all([decide(h,f.admin,n,'approve',{},null),decide(h,competing==='cancel'?f.emperor:f.admin,n,competing,{},null)]);assert.deepEqual(outcomes.map(r=>r.response.status).sort(),[200,409]);const winner=outcomes.find(r=>r.response.status===200).data;assert.equal(count(h,'court_succession_nomination_requests'),2);assert.equal(count(h,'court_succession_requests'),winner.nomination.status==='approved'?1:0);assert.equal(h.sql.prepare('SELECT status FROM court_succession_nominations').get().status,winner.nomination.status);
 });
 await scope('a changed preview crown or successor term cannot submit a stale nomination',async h=>{
  const f=await family(h),input=await intent(h,f.emperor,f.target);h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run(crypto.randomUUID(),f.target.user.id);await nominate(h,f.emperor,input,409);const newer=await intent(h,f.emperor,f.target);await appoint(h,f.emperor);await nominate(h,f.emperor,newer,409);assert.equal(count(h,'court_succession_nominations'),0);
 });
 for(const [label,mutate]of [
  ['candidate departure and reappointment',async(h,f)=>{await h.api('/admin/staff',post(f.admin,{action:'dismiss',targetPlayerId:f.target.user.id,requestId:crypto.randomUUID()}));await h.api('/admin/staff',post(f.admin,{action:'appoint',targetPlayerId:f.target.user.id,requestId:crypto.randomUUID()}));}],
  ['candidate ban and unban',async(h,f)=>{h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)').run(f.target.user.id,f.admin.user.id,h.now);h.sql.prepare('UPDATE player_bans SET active=0,revision=2 WHERE user_id=?').run(f.target.user.id);}],
  ['candidate temporary operator promotion',async(h,f)=>{h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(f.target.user.id);h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(f.admin.user.id);}],
  ['Emperor removal and reappointment',async(h,f)=>{await appoint(h,null);await appoint(h,f.emperor);}]
 ])await scope(label+' permanently invalidates the old choice without retirement',async h=>{
  const f=await family(h),n=(await nominate(h,f.emperor,await intent(h,f.emperor,f.target))).data;await mutate(h,f);const d=await directory(h,f.admin,true);assert.equal(d.pending.length,0);assert.equal(d.history[0].status,'invalidated');assert.equal(d.history[0].revision,1);assert.equal(d.history[0].resolvedBy,null);await decide(h,f.admin,n,'approve',{},409);assert.equal(count(h,'court_retired_emperors'),0);assert.equal(count(h,'court_succession_requests'),0);assert.equal((await nominate(h,f.emperor,await intent(h,f.emperor,f.target))).data.nomination.status,'pending');
 });
 for(const [label,mutate]of [
  ['source appointment token',(h,f)=>h.sql.prepare('UPDATE court_leader SET appointment_token=?').run(crypto.randomUUID())],
  ['candidate staff term',(h,f)=>h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run(crypto.randomUUID(),f.target.user.id)],
  ['Chancellor authority',(h,f)=>h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(f.other.user.id)],
  ['approval world-clock revision',h=>h.sql.exec('UPDATE world_clock SET revision=revision+1')]
 ])await scope('certification commit rechecks '+label+' and creates no partial retirement',async h=>{
  const f=await family(h),n=(await nominate(h,f.emperor,await intent(h,f.emperor,f.target))).data,saves=h.sql.prepare('SELECT * FROM player_saves ORDER BY user_id').all();h.beforeBatch=statements=>{if(!isApproval(statements))return;h.beforeBatch=null;mutate(h,f);};await decide(h,f.admin,n,'approve',{},409);assert.equal(count(h,'court_retired_emperors'),0);assert.equal(count(h,'court_succession_requests'),0);assert.equal(count(h,'court_succession_nomination_requests'),1);assert.deepEqual(h.sql.prepare('SELECT * FROM player_saves ORDER BY user_id').all(),saves);assert(h.sql.prepare('SELECT * FROM staff_members WHERE user_id=?').get(f.emperor.user.id));
 });
 await scope('the nomination commit itself is fenced against a changed crown and candidate term',async h=>{
  const f=await family(h),input=await intent(h,f.emperor,f.target);h.beforeBatch=statements=>{if(!isNomination(statements))return;h.beforeBatch=null;h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run(crypto.randomUUID(),f.target.user.id);};await nominate(h,f.emperor,input,409);assert.equal(count(h,'court_succession_nomination_requests'),0);assert.equal(count(h,'court_succession_nominations'),0);
  const fresh=await intent(h,f.emperor,f.target);h.beforeBatch=statements=>{if(!isNomination(statements))return;h.beforeBatch=null;h.sql.prepare('UPDATE court_leader SET appointment_token=?').run(crypto.randomUUID());};await nominate(h,f.emperor,fresh,409);assert.equal(count(h,'court_succession_nominations'),0);
 });
 await scope('direct Chancellor appointments cannot bypass pending certification but dismissal and vacant-seat filling remain possible',async h=>{
  const f=await family(h),initial=h.sql.prepare('SELECT * FROM court_leader').get(),n=(await nominate(h,f.emperor,await intent(h,f.emperor,f.target))).data;
  for(const target of [f.target,f.other,f.emperor]){const blocked=await appoint(h,target,409);assert.equal(blocked.data.error.code,'COURT_SUCCESSION_PENDING');}assert.deepEqual(h.sql.prepare('SELECT * FROM court_leader').get(),initial);await appoint(h,null);assert.equal(h.sql.prepare('SELECT status FROM court_succession_nominations').get().status,'invalidated');await appoint(h,f.other);await decide(h,f.admin,n,'approve',{},409);assert.equal(count(h,'court_retired_emperors'),0);
 });
 await scope('a nomination committed during direct appointment preparation also blocks that alternate path',async h=>{
  const f=await family(h),input=await intent(h,f.emperor,f.target);h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes("SELECT ?,?,'leader'")))return;h.beforeBatch=null;await nominate(h,f.emperor,input);};const blocked=await appoint(h,f.other,409);assert.equal(blocked.data.error.code,'COURT_SUCCESSION_PENDING');assert.equal(h.sql.prepare('SELECT user_id FROM court_leader').get().user_id,f.emperor.user.id);
 });
 await scope('a failed certification batch rolls back approval status, receipt, retirement, crown and staff departure together',async h=>{
  const f=await family(h),n=(await nominate(h,f.emperor,await intent(h,f.emperor,f.target))).data,before=all(h),body={requestId:crypto.randomUUID(),expectedRevision:0};h.beforeBatch=statements=>{if(isApproval(statements))statements.push(h.db.prepare('UPDATE fixture_missing_succession SET value=1'));};await decide(h,f.admin,n,'approve',body,500);h.beforeBatch=null;assert.deepEqual(all(h),before);assert.equal((await decide(h,f.admin,n,'approve',body)).data.nomination.status,'approved');
 });
 await scope('lost nomination and certification responses recover with immutable receipts and no repeated transition',async h=>{
  const f=await family(h),input=await intent(h,f.emperor,f.target);h.afterBatch=statements=>{if(!isNomination(statements))return;h.afterBatch=null;throw Error('fixture nomination response loss');};await nominate(h,f.emperor,input,500);const n=(await nominate(h,f.emperor,input)).data;assert.equal(n.idempotent,true);assert.equal(count(h,'court_succession_nominations'),1);
  const body={requestId:crypto.randomUUID(),expectedRevision:0};h.afterBatch=statements=>{if(!isApproval(statements))return;h.afterBatch=null;throw Error('fixture approval response loss');};await decide(h,f.admin,n,'approve',body,500);const committed=all(h),again=(await decide(h,f.admin,n,'approve',body)).data;assert.equal(again.idempotent,true);assert.deepEqual(all(h),committed);assert.equal((await nominate(h,f.emperor,input)).data.nomination.status,'approved');await decide(h,f.admin,n,'reject',body,409);
 });
 await scope('private candidate and certification responses are withdrawn after final role or nomination changes',async h=>{
  const f=await family(h);await nominate(h,f.emperor,await intent(h,f.emperor,f.target));let changed=false;h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-court-office')))return;changed=true;h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(f.other.user.id);};const denied=await h.api('/admin/court/succession',{token:f.admin.token,expected:409});assert(changed);assert.equal(denied.data.pending,undefined);h.beforeBatch=null;h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(f.admin.user.id);
  h.now+=DAY;changed=false;h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('INSERT INTO player_activity_program')))return;changed=true;h.sql.prepare('UPDATE court_leader SET appointment_token=?').run(crypto.randomUUID());};const final=await h.api('/court/succession',{token:f.emperor.token,expected:409});assert(changed);assert.equal(final.data.candidates,undefined);h.beforeBatch=null;
 });
 await scope('history is bounded and own nomination replay remains available beyond the visible history',async h=>{
  const f=await family(h),firstInput=await intent(h,f.emperor,f.target),first=(await nominate(h,f.emperor,firstInput)).data;await decide(h,f.emperor,first,'cancel');
  for(let i=0;i<21;i++){h.now+=60001;const n=(await nominate(h,f.emperor,await intent(h,f.emperor,f.target))).data;await decide(h,f.emperor,n,'cancel');}
  for(const [actor,isAdmin]of [[f.emperor,false],[f.admin,true]]){const d=await directory(h,actor,isAdmin);assert.equal(d.history.length,20);assert.equal(d.historyHasMore,true);assert(!d.history.some(n=>n.id===first.nomination.id));}
  const replay=(await nominate(h,f.emperor,firstInput)).data;assert.equal(replay.nomination.status,'cancelled');assert.deepEqual(replay.receipt,first.receipt);assert.equal(count(h,'court_succession_requests'),0);
 });
 await scope('pre-upgrade completed receipts still replay explicitly as legacy without executing another abdication',async h=>{
  const f=await family(h),requestId=crypto.randomUUID(),source=h.sql.prepare('SELECT * FROM court_leader').get(),targetTerm=h.sql.prepare('SELECT term_id FROM staff_members WHERE user_id=?').get(f.target.user.id).term_id,commit=crypto.randomUUID(),receipt={retiredPlayerId:f.emperor.user.id,retiredPlayerName:f.emperor.user.name,successorPlayerId:f.target.user.id,successorPlayerName:f.target.user.name,retiredAt:h.now};
  h.sql.prepare('INSERT INTO court_succession_requests(actor_id,request_id,target_id,request_hash,commit_token,source_appointment_token,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(f.emperor.user.id,requestId,f.target.user.id,createHash('sha256').update(JSON.stringify(['abdicate',f.target.user.id])).digest('hex'),commit,source.appointment_token,JSON.stringify(receipt),h.now);
  h.sql.prepare('INSERT INTO court_retired_emperors VALUES(?,?,?,?)').run(f.emperor.user.id,commit,f.target.user.id,h.now);h.sql.prepare('UPDATE court_leader SET user_id=?,term_id=?,appointment_token=?,updated_at=?').run(f.target.user.id,targetTerm,commit,h.now);h.sql.prepare('UPDATE staff_campaign_backups SET left_elapsed_ms=0 WHERE user_id=?').run(f.emperor.user.id);h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(f.emperor.user.id);
  const before=all(h),result=(await h.api('/court/succession',post(f.emperor,{requestId,targetPlayerId:f.target.user.id}))).data;assert.equal(result.legacy,true);assert.equal(result.status,'legacy-approved');assert.equal(result.idempotent,true);assert.equal(result.needsSync,true);assert.equal(result.user.id,f.emperor.user.id);assert.equal(result.user.isStaff,false);for(const key of Object.keys(receipt))assert.equal(result.receipt[key],receipt[key]);assert.deepEqual(all(h),before);await h.api('/court/succession',post(f.emperor,{requestId,targetPlayerId:f.other.user.id},409));
 });
}finally{globalThis.fetch=network;}
console.log(`${checks} succession approval scenarios / ${calls} API calls passed.`);
