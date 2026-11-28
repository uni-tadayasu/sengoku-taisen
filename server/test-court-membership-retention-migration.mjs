import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
const migration=name=>readFileSync(new URL('./drizzle/'+name+'.sql',import.meta.url),'utf8'),apply=(db,text)=>{for(const sql of text.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.exec(sql);};
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES(\'u_legacy\'),(\'u_lineage\'),(\'u_retained\');');
try{
 apply(db,migration('0056_court_membership'));apply(db,migration('0058_court_lineage'));
 const columns='actor_id,request_id,request_hash,commit_token,source_campaign_id,source_home,released_castle_count,term_id,created_at,house_id';
 const insert=db.prepare(`INSERT INTO court_membership_requests(${columns}) VALUES(?,?,?,?,?,?,?,?,?,?)`);
 insert.run('u_legacy','old-request','old-hash','old-commit','old-campaign','kiyosu',3,'old-shared-term',123,null);
 insert.run('u_lineage','family-request','family-hash','family-commit','family-campaign','inuyama',2,'old-shared-term',456,'kujo');
 const before=db.prepare(`SELECT ${columns} FROM court_membership_requests ORDER BY actor_id`).all();
 db.exec('BEGIN');apply(db,migration('0059_court_membership_retention'));db.exec('COMMIT');
 assert.deepEqual(db.prepare(`SELECT ${columns} FROM court_membership_requests ORDER BY actor_id`).all(),before,'No existing receipt column or family selection may change');
 for(const row of db.prepare('SELECT join_mode,destination_home,retained_castle_count FROM court_membership_requests').all())assert.deepEqual({...row},{join_mode:'kyoto',destination_home:'kyoto_gosho',retained_castle_count:0});
 const fresh=db.prepare(`INSERT INTO court_membership_requests(${columns},join_mode,destination_home,retained_castle_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
 fresh.run('u_retained','new-request','new-hash','new-commit','new-campaign','kiyosu',0,'new-term',789,'konoe','retained-base','kiyosu',1);
 db.prepare('INSERT INTO court_retained_memberships VALUES(?,?,?,?,?)').run('u_retained','new-request','new-term','kiyosu',789);
 assert.throws(()=>fresh.run('u_retained','negative','hash','commit','negative-campaign','kiyosu',-1,'term',999,'konoe','retained-base','kiyosu',1),/CHECK constraint failed/);
 assert.throws(()=>fresh.run('u_retained','new-request','hash','commit','another-campaign','kiyosu',0,'term',999,'konoe','retained-base','kiyosu',1),/UNIQUE constraint failed/);
 assert.throws(()=>fresh.run('u_retained','different-request','hash','commit','new-campaign','kiyosu',0,'term',999,'konoe','retained-base','kiyosu',1),/UNIQUE constraint failed/);
 assert.throws(()=>db.prepare('INSERT INTO court_retained_memberships VALUES(?,?,?,?,?)').run('u_lineage','missing-request','term','edo',999),/FOREIGN KEY constraint failed/);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 db.prepare('DELETE FROM users WHERE id=?').run('u_retained');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM court_retained_memberships').get().n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM court_membership_requests WHERE actor_id='u_retained'").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='court_membership_requests_next'").get().n,0);
 console.log('PASS 0059 preserves legacy and family-aware receipts, allows zero releases and keeps receipt uniqueness and foreign keys');
}finally{db.close();}
const h=harness();try{
 await h.api('/health');const triggers=h.sql.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name='court_retained_memberships'").all();h.sql.exec('DROP TABLE court_retained_memberships');await h.api('/health',{expected:503});
 apply(h.sql,migration('0059_court_membership_retention').split('--> statement-breakpoint').at(-1));await h.api('/health',{expected:503});for(const trigger of triggers)h.sql.exec(trigger.sql);await h.api('/health');
 console.log('PASS health requires the retained-membership migration before reporting ready');
}finally{h.close();}
