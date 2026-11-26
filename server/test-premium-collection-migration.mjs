import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

// Exercise the upgrade against existing paid and revoked orders, with foreign
// keys enabled for every statement. No production account or database is used.
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
const base=new URL('./drizzle/',import.meta.url);
const statements=tag=>readFileSync(new URL(tag+'.sql',base),'utf8').split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean);
const journal=JSON.parse(readFileSync(new URL('meta/_journal.json',base)));
for(const entry of journal.entries.filter(entry=>entry.idx<35)) for(const command of statements(entry.tag)) sql.exec(command);
sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run('u_collection_fixture','移行確認','移行確認','織田家','fixture_token_hash',1,1);
for(const [n,product,slot,amount] of [[1,'gold-banner','nameplate',480],[2,'moonlit-castle','town',980],[3,'supporter','badge',780]]){
 sql.prepare('INSERT INTO premium_orders VALUES(?,?,?,?)').run('pr_fixture_'+n,'u_collection_fixture',product,1);
 sql.prepare('INSERT INTO premium_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('cs_fixture_'+n,'pr_fixture_'+n,product,n===3?'subscription':'payment',n===3?'cus_fixture':null,n!==3?'pi_fixture_'+n:null,n===3?'sub_fixture':null,amount,'jpy',1,1);
 if(n!==3)sql.prepare('INSERT INTO premium_charges VALUES(?,?,?,?,?,?)').run('ch_fixture_'+n,'pi_fixture_'+n,amount,'jpy',1,1);
}
sql.prepare('INSERT INTO premium_appearances VALUES(?,?,?,?,?)').run('u_collection_fixture','gold-banner','moonlit-castle','supporter',1);
sql.prepare('INSERT INTO premium_events VALUES(?,?,?,?,?,?,?,?,?)').run('evt_fixture','refund.created','re_fixture','fixture_hash','accepted','refunded',1,1,'fixture_commit');
sql.prepare('INSERT INTO premium_blocks VALUES(?,?,?,?,?,?,?,?)').run('payment_intent','pi_fixture_2','evt_fixture','refunded',1,1,1,0);
const tableNames=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'premium_%' ORDER BY name").all().map(row=>row.name);
const snapshot=()=>Object.fromEntries(tableNames.map(name=>[name,sql.prepare('SELECT * FROM '+name+' ORDER BY 1').all()]));
const before=snapshot(),grants=sql.prepare('SELECT * FROM premium_grants ORDER BY 1,2').all();
assert.equal(grants.length,1);assert.equal(grants[0].product_id,'gold-banner');
sql.exec('BEGIN IMMEDIATE');
try{for(const command of statements('0035_premium_collection'))sql.exec(command);sql.exec('COMMIT');}catch(error){sql.exec('ROLLBACK');throw error;}
assert.deepEqual(snapshot(),before,'Every existing order, captured payment, event, refund hold, and selection is preserved');
assert.deepEqual(sql.prepare('SELECT * FROM premium_grants ORDER BY 1,2').all(),grants,'Migration does not grant revoked purchases or remove valid ownership');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
assert.equal(sql.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
for(const [product,slot] of [['vermilion-banner','nameplate'],['silver-banner','nameplate'],['phoenix-medallion','badge'],['sakura-town','town'],['snow-town','town']]){
 sql.prepare('INSERT INTO premium_orders VALUES(?,?,?,?)').run('pr_fixture_'+product,'u_collection_fixture',product,2);
 sql.prepare('UPDATE premium_appearances SET '+slot+'=? WHERE user_id=?').run(product,'u_collection_fixture');
}
assert.throws(()=>sql.prepare('INSERT INTO premium_orders VALUES(?,?,?,?)').run('pr_fixture_unknown','u_collection_fixture','unapproved-product',2));
assert.throws(()=>sql.prepare('UPDATE premium_appearances SET badge=?').run('snow-town'));
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
sql.close();
console.log('PASS paid collection migration preserves existing evidence and enforces all eight approved products and their slots');
