import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

// Apply the additive migration to a populated pre-governance database.
// Every old table is compared, including roles, approvals, saves and receipts.
const journal=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8')).entries;
const name='0054_shogunate_governance',entry=journal.find(item=>item.tag===name);
assert(entry,'Governance migration is present in the real journal');
assert.equal(journal.filter(item=>item.tag===name).length,1);
assert.equal(new Set(journal.map(item=>item.idx)).size,journal.length);
assert.equal(new Set(journal.map(item=>item.tag)).size,journal.length);
const position=journal.indexOf(entry);assert(position>0);assert(entry.when>journal[position-1].when);
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
function apply(item){for(const sql of readFileSync(new URL('./drizzle/'+item.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.exec(sql);}
const rows=table=>db.prepare('SELECT * FROM "'+table.replaceAll('"','""')+'"').all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const at=Date.UTC(2026,10,28,3);
try{
 for(const item of journal.slice(0,position))apply(item);
 const users=[['gov-admin','検証大臣'],['gov-emperor','検証天皇'],['gov-lord','検証将軍']];
 for(const [id,label] of users)db.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(id,label,id,'織田家','local-fixture-'+id,at,at);
 db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)').run('adminUserId','gov-admin',at);
 db.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES(?,?,?,?)').run('gov-emperor','gov-admin',at,'existing-emperor-term');
 db.prepare('INSERT INTO court_leader(id,user_id,term_id,appointment_token,appointed_by,updated_at) VALUES(1,?,?,?,?,?)').run('gov-emperor','existing-emperor-term','existing-appointment','gov-admin',at);
 const saved=readFileSync(new URL('./fixtures/valid-save.json',import.meta.url),'utf8');
 db.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,?,?)').run('gov-lord',saved,17,at);
 const insertRight=db.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at,opened_at,government_name) VALUES(?,'gov-lord','event',?,'既存の天下統一',?,?,?)");
 insertRight.run('sg_legacy_fixture','source-legacy',at-10000,at-5000,'既存の幕府');
 insertRight.run('sg_pending_fixture','source-pending',at,null,'申請中の幕府');
 insertRight.run('sg_available_fixture','source-available',at,null,null);
 db.prepare("INSERT INTO shogunate_approvals(right_id,status,requested_at,deadline_at,updated_at) VALUES(?,'pending',?,?,?)").run('sg_pending_fixture',at,at+259200000,at);
 db.prepare('INSERT INTO shogunate_requests(user_id,request_id,right_id,request_hash,commit_token,result_json,created_at) VALUES(?,?,?,?,?,?,?)').run('gov-lord','existing-request','sg_pending_fixture','existing-hash','existing-token',JSON.stringify({status:'pending',deadlineAt:at+259200000}),at);
 const oldTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name),before=Object.fromEntries(oldTables.map(table=>[table,rows(table)]));
 apply(entry);
 const after=Object.fromEntries(oldTables.map(table=>[table,rows(table)]));assert.deepEqual(after,before,'Migration preserves every existing row');
 for(const table of ['shogunate_governance_accounts','shogunate_governance_requests'])assert.equal(rows(table).length,0,'Migration never enrolls or rewards existing players automatically');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);

 const account=db.prepare('INSERT INTO shogunate_governance_accounts(user_id,data_json,revision,commit_token,updated_at) VALUES(?,?,?,?,?)');
 const state=JSON.stringify({version:1,policyId:'balanced',policyChangedDay:null,renown:0,projects:{granary:0,roads:0,academy:0},lastDay:null});
 account.run('gov-lord',state,1,'account-token',at);
 assert.throws(()=>account.run('gov-lord',state,1,'duplicate',at),/UNIQUE/);
 assert.throws(()=>account.run('gov-emperor',state,0,'invalid-revision',at),/CHECK/);
 assert.throws(()=>account.run('missing-lord',state,1,'invalid-owner',at),/FOREIGN KEY/);
 const request=db.prepare('INSERT INTO shogunate_governance_requests(actor_id,request_id,claim_key,kind,request_hash,result_json,commit_token,created_at) VALUES(?,?,?,?,?,?,?,?)');
 const insert=(actor,id,key,kind='duty')=>request.run(actor,id,key,kind,'semantic-hash','{}','receipt-'+id,at);
 insert('gov-lord','accepted','duty:2026-11-28:audience');
 assert.throws(()=>insert('gov-lord','accepted','duty:2026-11-28:relief'),/UNIQUE/,'An operation number cannot be repurposed');
 assert.throws(()=>insert('gov-lord','another','duty:2026-11-28:audience'),/UNIQUE/,'Different requests cannot claim the same duty');
 insert('gov-emperor','different-user','duty:2026-11-28:audience');
 assert.throws(()=>insert('gov-lord','invalid-kind','x','arbitrary-credit'),/CHECK/);
 assert.throws(()=>insert('missing-lord','invalid-owner','y'),/FOREIGN KEY/);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log('PASS governance migration preserves '+oldTables.length+' populated/preexisting tables, creates empty ledgers, and enforces owner, receipt, claim and revision constraints.');
}finally{db.close();}
