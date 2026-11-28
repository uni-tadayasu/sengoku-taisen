import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

// Exercise the live upgrade shape with nonempty financial records, including
// seasonal choices, a paid pass and a refunded cosmetic. No external writes.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const base=new URL('./drizzle/',import.meta.url),journal=JSON.parse(readFileSync(new URL('meta/_journal.json',base)));
const statements=tag=>readFileSync(new URL(tag+'.sql',base),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean);
for(const entry of journal.entries.filter(e=>e.idx<52))for(const command of statements(entry.tag))sql.exec(command);
const now=Date.now(),user='u_heritage_migration',start=now-86400000,end=now+29*86400000;
sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(user,'名城移行確認','名城移行確認','織田家','fixture-only-hash',start,now);
const products=[['gold-banner',480],['moonlit-castle',980],['supporter',780],['vermilion-banner',580],['silver-banner',580],['phoenix-medallion',780],['sakura-town',980],['snow-town',980],['reroll-pass-30d',480]];
for(const [index,[product,amount]]of products.entries()){
  const n=index+1,subscription=product==='supporter';
  sql.prepare('INSERT INTO premium_orders VALUES(?,?,?,?)').run('pr_heritage_'+n,user,product,start);
  sql.prepare('INSERT INTO premium_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('cs_heritage_'+n,'pr_heritage_'+n,product,subscription?'subscription':'payment',subscription?'cus_heritage':null,subscription?null:'pi_heritage_'+n,subscription?'sub_heritage':null,amount,'jpy',1,start);
  sql.prepare('INSERT INTO premium_charges VALUES(?,?,?,?,?,?)').run('ch_heritage_'+n,'pi_heritage_'+n,amount,'jpy',1,start);
}
sql.prepare('INSERT INTO premium_invoices VALUES(?,?,?,?,?,?,?,?)').run('in_heritage','sub_heritage','cus_heritage',780,'jpy',start,end,start);
sql.prepare('INSERT INTO premium_invoice_payments VALUES(?,?,?,?,?,?)').run('inpay_heritage','in_heritage','pi_heritage_3',780,'jpy',start);
sql.prepare('INSERT INTO premium_supporter_periods VALUES(?,?,?,?,?,?,?)').run('period_heritage',user,'sub_heritage',start,end,'202611',start);
sql.prepare('INSERT INTO premium_supporter_choices VALUES(?,?,?,?,?,?,?)').run('period_heritage',user,'supporter-202611-flower','choice_fixture','hash_fixture','nonce_fixture',start);
sql.prepare('INSERT INTO premium_pass_receipts VALUES(?,?,?,?,?,?)').run('cs_heritage_9',user,'pi_heritage_9',start,start+2592000000,start);
sql.prepare('INSERT INTO premium_events VALUES(?,?,?,?,?,?,?,?,?)').run('evt_heritage','charge.refunded','ch_heritage_2','fixture_hash','accepted','refunded',now,now,'fixture_nonce');
sql.prepare('INSERT INTO premium_blocks VALUES(?,?,?,?,?,?,?,?)').run('payment_intent','pi_heritage_2','evt_heritage','refund',now,now,1,0);
sql.prepare('INSERT INTO premium_appearances VALUES(?,?,?,?,?)').run(user,'supporter-202611-flower','snow-town','phoenix-medallion',now);
const names=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'premium_%' ORDER BY name").all().map(row=>row.name);
const snapshot=()=>Object.fromEntries(names.map(name=>[name,sql.prepare('SELECT * FROM '+name+' ORDER BY 1').all()]));
const before=snapshot(),grants=sql.prepare('SELECT * FROM premium_grants ORDER BY 1,2,3').all();
assert(grants.some(row=>row.product_id==='reroll-pass-30d'));assert(grants.some(row=>row.product_id==='supporter-202611-flower'));assert(!grants.some(row=>row.product_id==='moonlit-castle'));
sql.exec('BEGIN IMMEDIATE');
try{for(const command of statements('0052_castle_heritage'))sql.exec(command);sql.exec('COMMIT');}catch(error){sql.exec('ROLLBACK');throw error;}
assert.deepEqual(snapshot(),before,'Existing orders, receipts, selections, choices and holds keep every field');
assert.deepEqual(sql.prepare('SELECT * FROM premium_grants ORDER BY 1,2,3').all(),grants,'Migration neither grants revoked purchases nor removes valid rights');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
sql.prepare('INSERT INTO premium_orders VALUES(?,?,?,?)').run('pr_heritage_new',user,'castle-heritage',now);
sql.prepare('INSERT INTO premium_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('cs_heritage_new','pr_heritage_new','castle-heritage','payment',null,'pi_heritage_new',null,980,'jpy',1,now);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM premium_grants WHERE product_id='castle-heritage'").get().n,0);
sql.prepare('INSERT INTO premium_charges VALUES(?,?,?,?,?,?)').run('ch_heritage_new','pi_heritage_new',980,'jpy',1,now);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM premium_grants WHERE product_id='castle-heritage'").get().n,1);
sql.prepare('UPDATE premium_appearances SET town=? WHERE user_id=?').run('castle-heritage',user);
assert.throws(()=>sql.prepare('UPDATE premium_appearances SET badge=? WHERE user_id=?').run('castle-heritage',user));
assert.throws(()=>sql.prepare('INSERT INTO premium_orders VALUES(?,?,?,?)').run('pr_invalid',user,'unapproved-product',now));
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
console.log(JSON.stringify({passed:true,migration:'0052_castle_heritage',preservedRows:Object.values(before).reduce((n,rows)=>n+rows.length,0),existingGrants:grants.length,foreignKeyViolations:0,externalRequests:0}));
sql.close();
