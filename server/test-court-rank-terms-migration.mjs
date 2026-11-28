import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
const entries=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url))).entries;
const apply=tag=>{for(const part of readFileSync(new URL('./drizzle/'+tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.exec(part);};
const addMerit=(id,term,total)=>{while(total>0){const n=Math.min(128,total);db.prepare("INSERT INTO court_contributions VALUES(?,?,?,'castle','kyoto_gosho',?,?,0,1)").run(crypto.randomUUID(),id,term,n,n);total-=n;}};
try{
 for(const entry of entries.filter(e=>e.idx<63))apply(entry.tag);
 for(const id of ['operator','legacy','retained','external','newcomer']){db.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,1,1)').run(id,id,id,'織田家',id);db.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,1,1)').run(id,JSON.stringify({state:{home:'kiyosu'}}));}
 db.exec("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId','operator',1); INSERT INTO court_office_state VALUES(1,0); INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES('legacy','operator',1,'old-legacy-term')");
 addMerit('legacy','earlier-legacy-term',2000);addMerit('retained',null,1000);addMerit('newcomer','prejoin-term',2000);
 db.exec("INSERT INTO court_membership_requests(actor_id,request_id,request_hash,commit_token,source_campaign_id,source_home,released_castle_count,term_id,created_at,house_id,join_mode,destination_home,retained_castle_count) VALUES('retained','join','hash','commit','campaign','kiyosu',0,'retained-term',2,'kujo','retained-base','kiyosu',1); INSERT INTO court_retained_memberships VALUES('retained','join','retained-term','kiyosu',2); INSERT INTO court_office_appointments VALUES('udaijin','retained','former-token','operator',2); INSERT INTO court_office_appointments VALUES('sangi','external','external-token','operator',2)");
 const names=['users','player_saves','staff_members','court_contributions','court_membership_requests','court_retained_memberships','court_office_appointments','court_office_state'],snapshot=()=>names.map(name=>db.prepare('SELECT * FROM '+name+' ORDER BY 1').all()),before=snapshot();
 db.exec('BEGIN IMMEDIATE');apply('0063_court_formal_rank_terms');db.exec('COMMIT');
 assert.deepEqual(snapshot(),before,'The schema-only migration must not rewrite any existing account, role, contribution, save or appointment');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM court_rank_terms').get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(db.prepare("SELECT office_id FROM court_kyoto_offices WHERE user_id='legacy'").get().office_id,'sadaijin');assert.equal(db.prepare("SELECT merit FROM court_rank_progress WHERE user_id='legacy'").get().merit,2000);
 assert.equal(db.prepare("SELECT office_id FROM court_kyoto_offices WHERE user_id='retained'").get().office_id,'sangi');assert.equal(db.prepare("SELECT merit FROM court_rank_progress WHERE user_id='retained'").get().merit,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM court_external_offices').get().n,0);assert.equal(db.prepare("SELECT authority_key FROM court_estate_current WHERE user_id='retained'").get().authority_key,'member:retained-term');
 addMerit('retained','retained-term',50);assert.equal(db.prepare("SELECT office_id FROM court_kyoto_offices WHERE user_id='retained'").get().office_id,'chunagon');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM court_office_appointments').get().n,0,'Neither the former appointment nor a previously hidden conflicting seat may revive after promotion');
 db.exec("UPDATE court_retained_memberships SET term_id='retained-new-term' WHERE user_id='retained'");assert.equal(db.prepare("SELECT merit FROM court_rank_progress WHERE user_id='retained'").get().merit,0);
 db.exec("INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES('newcomer','operator',3,'new-formal-term')");assert.equal(db.prepare("SELECT merit FROM court_rank_progress WHERE user_id='newcomer'").get().merit,0);assert.equal(db.prepare("SELECT office_id FROM court_kyoto_offices WHERE user_id='newcomer'").get().office_id,'sangi');
 db.exec("UPDATE staff_members SET appointed_by=appointed_by WHERE user_id='legacy'");assert.equal(db.prepare("SELECT merit FROM court_rank_progress WHERE user_id='legacy'").get().merit,2000);db.exec("UPDATE staff_members SET term_id='legacy-rejoined-term' WHERE user_id='legacy'");assert.equal(db.prepare("SELECT merit FROM court_rank_progress WHERE user_id='legacy'").get().merit,0);
 console.log('PASS populated0063 migration preserves data and established ranks, starts new terms at Sangi, and permanently retires obsolete seats');
}finally{db.close();}

// Each projection source is exercised at the real nonempty migration boundary.
// In particular, retiring a previously hidden seat must happen before a BAN,
// new Regent/Emperor or operator change removes the old formal Sangi row.
const membershipSql=id=>`INSERT INTO court_membership_requests(actor_id,request_id,request_hash,commit_token,source_campaign_id,source_home,released_castle_count,term_id,created_at,house_id,join_mode,destination_home,retained_castle_count) VALUES('${id}','join-${id}','hash','commit-${id}','campaign-${id}','kiyosu',0,'term-${id}',2,'kujo','retained-base','kiyosu',1);`;
const memberSql=id=>`INSERT INTO court_retained_memberships VALUES('${id}','join-${id}','term-${id}','kiyosu',2);`;
const staffSql="INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES('retained','operator',1,'term-retained');";
const banSql=id=>`INSERT INTO player_bans(user_id,active,revision,banned_by,banned_at,updated_at) VALUES('${id}',0,1,'operator',1,1);`;
const regentSql="INSERT INTO court_regent VALUES(1,'special','regent-token','operator',1);";
const leaderSql="INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES('special','operator',1,'special-term'); INSERT INTO court_contributions VALUES('special-merit','special','special-term','castle','kyoto_gosho',50,50,0,1); INSERT INTO court_leader(id,user_id,term_id,appointment_token,appointed_by,updated_at) VALUES(1,'special','inactive-term','leader-token','operator',1);";
const successionSql="INSERT INTO court_succession_requests VALUES('retained','succession-retained','successor','hash','retained-retirement','retained-crown','{}',1); INSERT INTO court_succession_requests VALUES('special','succession-special','successor','hash','special-retirement','special-crown','{}',1);";
const retirementSql=successionSql+"INSERT INTO court_retired_emperors VALUES('special','special-retirement','successor',1);";
const contributionSql="INSERT INTO court_contributions VALUES('previous-job','retained','term-retained','castle','kyoto_gosho',1,1,0,1);";
const transitions=[
 ['merit_insert','',"INSERT INTO court_contributions VALUES('new-job','retained','term-retained','castle','kyoto_gosho',50,50,0,1)"],
 ['merit_update',contributionSql,"UPDATE court_contributions SET target_level=50,points=50 WHERE job_id='previous-job'"],
 ['merit_delete',contributionSql,"DELETE FROM court_contributions WHERE job_id='previous-job'"],
 ['staff_insert','',staffSql],
 ['staff_update',staffSql,"UPDATE staff_members SET term_id='replacement' WHERE user_id='retained'"],
 ['staff_delete',staffSql,"DELETE FROM staff_members WHERE user_id='retained'"],
 ['retained_insert',membershipSql('special'),memberSql('special')],
 ['retained_update','',"UPDATE court_retained_memberships SET term_id='replacement' WHERE user_id='retained'"],
 ['retained_delete','',"DELETE FROM court_retained_memberships WHERE user_id='retained'"],
 ['ban_insert','',"INSERT INTO player_bans(user_id,active,revision,banned_by,banned_at,updated_at) VALUES('retained',1,1,'operator',1,1)"],
 ['ban_update',banSql('retained'),"UPDATE player_bans SET active=1 WHERE user_id='retained'"],
 ['ban_delete',banSql('external'),"DELETE FROM player_bans WHERE user_id='external'"],
 ['regent_insert','',"INSERT INTO court_regent VALUES(1,'retained','new-regent','operator',2)"],
 ['regent_update',regentSql,"UPDATE court_regent SET user_id='retained' WHERE id=1"],
 ['regent_delete',regentSql,'DELETE FROM court_regent'],
 ['retirement_insert',successionSql,"INSERT INTO court_retired_emperors VALUES('retained','retained-retirement','successor',1)"],
 ['retirement_update',retirementSql,"UPDATE court_retired_emperors SET user_id='retained',succession_id='retained-retirement' WHERE user_id='special'"],
 ['retirement_delete',retirementSql,"DELETE FROM court_retired_emperors WHERE user_id='special'"],
 ['leader_insert',staffSql,"INSERT INTO court_leader(id,user_id,term_id,appointment_token,appointed_by,updated_at) VALUES(1,'retained','term-retained','new-crown','operator',2)"],
 ['leader_update',staffSql+leaderSql,"UPDATE court_leader SET user_id='retained',term_id='term-retained' WHERE id=1"],
 ['leader_delete',leaderSql,'DELETE FROM court_leader'],
 ['operator_insert',"DELETE FROM settings WHERE key='adminUserId'", "INSERT INTO settings(key,value,updated_at) VALUES('adminUserId','retained',2)"],
 ['operator_update','',"UPDATE settings SET value='retained' WHERE key='adminUserId'"],
 ['operator_delete','',"DELETE FROM settings WHERE key='adminUserId'"]
];
for(const [label,prepare,change] of transitions){
 const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');
 const migrate=tag=>{for(const part of readFileSync(new URL('./drizzle/'+tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))database.exec(part);};
 try{
  for(const entry of entries.filter(e=>e.idx<63))migrate(entry.tag);
  for(const id of ['operator','retained','external','special','successor']){database.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,1,1)').run(id,id,id,'織田家',id);database.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,1,1)').run(id,JSON.stringify({state:{home:'kiyosu'}}));}
  database.exec("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId','operator',1); INSERT INTO court_office_state VALUES(1,0);"+membershipSql('retained')+memberSql('retained')+prepare);
  database.exec("INSERT INTO court_office_appointments VALUES('udaijin','retained','former-token','operator',2); INSERT INTO court_office_appointments VALUES('sangi','external','external-token','operator',2)");
  migrate('0063_court_formal_rank_terms');assert.equal(database.prepare("SELECT office_id FROM court_kyoto_offices WHERE user_id='retained'").get().office_id,'sangi',label+' starts with a formal Sangi');assert.equal(database.prepare('SELECT COUNT(*) AS n FROM court_external_offices').get().n,0);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM court_office_appointments').get().n,2);
  assert(database.prepare("SELECT sql FROM sqlite_master WHERE name=?").get('court_rank_'+label).sql.includes('BEFORE '));
  database.exec(change);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM court_office_appointments').get().n,0,label+' permanently consumes obsolete seats before changing the projection');assert.equal(database.prepare("SELECT COUNT(*) AS n FROM court_external_offices WHERE user_id='external'").get().n,0,label+' cannot revive the hidden Sangi');assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(),[]);
 }catch(error){error.message=label+': '+error.message;throw error;}finally{database.close();}
}
console.log('PASS all24 role, term and merit transitions permanently retire pre-migration hidden external seats');

const h=harness();try{await h.api('/health');h.sql.exec('DROP TRIGGER court_rank_merit_insert');await h.api('/health',{expected:503});console.log('PASS readiness requires the formal-rank transition guards');}finally{h.close();}
