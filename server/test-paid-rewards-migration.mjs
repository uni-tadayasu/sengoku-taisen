import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

// Upgrade a nonempty version-0039 database. Foreign keys remain enabled for
// every statement; all fixtures are local and contain no production data.
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const base=new URL('./drizzle/',import.meta.url),journal=JSON.parse(readFileSync(new URL('meta/_journal.json',base)));
const statements=tag=>readFileSync(new URL(tag+'.sql',base),'utf8').split('--> statement-breakpoint').map(value=>value.trim()).filter(Boolean);
for(const entry of journal.entries.filter(entry=>entry.idx<40))for(const command of statements(entry.tag))sql.exec(command);
const now=Date.now(),user='u_reward_migration',start=now-10*86400000,end=now+20*86400000;
sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(user,'0040移行確認','0040移行確認','織田家','local_migration_hash',now,now);
const products=[['gold-banner',480],['moonlit-castle',980],['supporter',780],['vermilion-banner',580],['silver-banner',580],['phoenix-medallion',780],['sakura-town',980],['snow-town',980]];
for(const [index,[product,amount]]of products.entries()){
  const n=index+1,subscription=product==='supporter';
  sql.prepare('INSERT INTO premium_orders VALUES(?,?,?,?)').run('pr_rewards_'+n,user,product,start);
  sql.prepare('INSERT INTO premium_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('cs_rewards_'+n,'pr_rewards_'+n,product,subscription?'subscription':'payment',subscription?'cus_rewards':null,subscription?null:'pi_rewards_'+n,subscription?'sub_rewards':null,amount,'jpy',1,start);
  sql.prepare('INSERT INTO premium_charges VALUES(?,?,?,?,?,?)').run('ch_rewards_'+n,'pi_rewards_'+n,amount,'jpy',1,start);
}
sql.prepare('INSERT INTO premium_invoices VALUES(?,?,?,?,?,?,?,?)').run('in_rewards','sub_rewards','cus_rewards',780,'jpy',start,end,start);
sql.prepare('INSERT INTO premium_invoice_payments VALUES(?,?,?,?,?,?)').run('inpay_rewards','in_rewards','pi_rewards_3',780,'jpy',start);
sql.prepare('INSERT INTO premium_events VALUES(?,?,?,?,?,?,?,?,?)').run('evt_rewards','charge.refunded','ch_rewards_2','fixture_hash','accepted','charge_refunded',now,now,'fixture_nonce');
sql.prepare('INSERT INTO premium_blocks VALUES(?,?,?,?,?,?,?,?)').run('payment_intent','pi_rewards_2','evt_rewards','charge_refunded',now,now,1,0);
sql.prepare('INSERT INTO premium_reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run('prv_rewards',user,'review_rewards','fixture_review_hash','payment_intent','pi_rewards_2',1,'evt_rewards','local history-preservation fixture',now);
sql.prepare('INSERT INTO premium_subscription_ends VALUES(?,?,?)').run('sub_rewards',end,'evt_rewards');
sql.prepare('INSERT INTO premium_appearances VALUES(?,?,?,?,?)').run(user,'vermilion-banner','snow-town','phoenix-medallion',now);
const names=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'premium_%' ORDER BY name").all().map(row=>row.name);
const snapshot=()=>Object.fromEntries(names.map(name=>[name,sql.prepare('SELECT * FROM '+name+' ORDER BY 1').all()]));
const before=snapshot(),beforeGrants=sql.prepare('SELECT * FROM premium_grants ORDER BY 1,2,3').all();
assert.equal(beforeGrants.length,7);assert(beforeGrants.some(row=>row.product_id==='supporter'));assert(!beforeGrants.some(row=>row.product_id==='moonlit-castle'));
sql.exec('BEGIN IMMEDIATE');
try{for(const command of statements('0040_paid_rewards'))sql.exec(command);sql.exec('COMMIT');}catch(error){sql.exec('ROLLBACK');throw error;}
assert.deepEqual(snapshot(),before,'Every existing premium table retains every row and field');
assert.deepEqual(sql.prepare('SELECT * FROM premium_grants ORDER BY 1,2,3').all(),beforeGrants,'Existing valid and refunded ownership is unchanged');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sql.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
assert(sql.prepare('SELECT starts_at FROM premium_reward_program WHERE id=1').get().starts_at>0);
for(const name of ['premium_pass_receipts','premium_supporter_periods','premium_supporter_choices','reward_accounts','reward_campaigns','reward_requests','gacha_draws','gacha_daily_usage','login_bonus_claims','premium_daily_events','premium_daily_visitors'])assert.equal(sql.prepare('SELECT COUNT(*) n FROM '+name).get().n,0,name+' starts empty');
sql.prepare('INSERT INTO premium_orders VALUES(?,?,?,?)').run('pr_rewards_pass',user,'reroll-pass-30d',now);
for(const slot of ['nameplate','town','badge'])assert.throws(()=>sql.prepare('UPDATE premium_appearances SET '+slot+'=? WHERE user_id=?').run('reroll-pass-30d',user),'A pass cannot be equipped in '+slot);
sql.prepare('UPDATE premium_appearances SET nameplate=? WHERE user_id=?').run('supporter-202611-flower',user);
assert.throws(()=>sql.prepare('INSERT INTO premium_orders VALUES(?,?,?,?)').run('pr_rewards_bad',user,'not-approved',now));
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
const preservedRows=Object.values(before).reduce((sum,values)=>sum+values.length,0);sql.close();
console.log(JSON.stringify({passed:true,migration:'0040_paid_rewards',existingTables:names.length,preservedRows,existingGrants:beforeGrants.length,foreignKeysEnabled:true,foreignKeyViolations:0,externalRequests:0,productionWrites:0}));
