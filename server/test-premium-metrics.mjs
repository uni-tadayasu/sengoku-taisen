import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {observePremiumPayments} from './premium-metrics.js';

// Exercise real Worker routes and SQLite migrations with local financial facts.
// Signature acceptance/rejection is covered by test-premium/test-rewards; no
// test here contacts Stripe, reads a live database, or creates a real payment.
const DAY=86400000,BASE=Date.UTC(2026,9,1,3);
const PRICES={'gold-banner':480,'moonlit-castle':980,supporter:780,'vermilion-banner':580,'silver-banner':580,'phoenix-medallion':780,'sakura-town':980,'snow-town':980,'reroll-pass-30d':480,'castle-heritage':980};
const id=prefix=>prefix+crypto.randomUUID().replaceAll('-','');
const one=(h,sql,...values)=>h.sql.prepare(sql).get(...values);
const run=(h,sql,...values)=>h.sql.prepare(sql).run(...values);
const all=(h,sql,...values)=>h.sql.prepare(sql).all(...values);
async function operator(h){const a=await h.session('集計運営');run(h,"INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?)",a.user.id,h.now);return a;}
const report=async(h,a,days=60)=>(await h.api('/admin/premium/metrics?days='+days,{token:a.token})).data;
const visit=(h,a)=>h.api('/me',{token:a.token});
function order(h,a,product){
  let row=one(h,'SELECT reference FROM premium_orders WHERE user_id=? AND product_id=?',a.user.id,product);
  if(!row){row={reference:'pr_'+crypto.randomUUID().replaceAll('-','').repeat(2)};run(h,'INSERT INTO premium_orders(reference,user_id,product_id,created_at) VALUES(?,?,?,?)',row.reference,a.user.id,product,h.now);}
  return row.reference;
}
function paid(h,a,product,{intent=id('pi_'),subscription=id('sub_'),customer=id('cus_'),start=h.now,end=start+30*DAY,chargedAt=h.now,paidFlag=1,captured=1,session=id('cs_'),invoice=id('in_')}={}){
  const reference=order(h,a,product),amount=PRICES[product],mode=product==='supporter'?'subscription':'payment',charge=id('ch_');
  run(h,'INSERT OR IGNORE INTO premium_sessions(session_id,reference,product_id,mode,customer_id,payment_intent_id,subscription_id,amount,currency,paid,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',session,reference,product,mode,mode==='subscription'?customer:null,mode==='payment'?intent:null,mode==='subscription'?subscription:null,amount,'jpy',paidFlag,h.now);
  run(h,'INSERT INTO premium_charges(charge_id,payment_intent_id,amount,currency,captured,created_at) VALUES(?,?,?,?,?,?)',charge,intent,amount,'jpy',captured,chargedAt);
  if(mode==='subscription'){
    run(h,'INSERT INTO premium_invoices(invoice_id,subscription_id,customer_id,amount,currency,period_start,period_end,created_at) VALUES(?,?,?,?,?,?,?,?)',invoice,subscription,customer,amount,'jpy',start,end,h.now);
    run(h,'INSERT INTO premium_invoice_payments(payment_id,invoice_id,payment_intent_id,amount,currency,created_at) VALUES(?,?,?,?,?,?)',id('inpay_'),invoice,intent,amount,'jpy',h.now);
  }
  return {product,intent,charge,session,invoice,subscription,customer,start,end,reference};
}
function block(h,payment,reason='refund'){
  const event=id('evt_');run(h,'INSERT INTO premium_events(event_id,event_type,object_id,payload_hash,disposition,reason,event_created,received_at,commit_token) VALUES(?,?,?,?,?,?,?,?,?)',event,'charge.refunded',payment.charge,'fixture-hash','accepted',reason,h.now,h.now,id('nonce_'));
  run(h,'INSERT INTO premium_blocks(scope,object_id,source_event_id,reason,created_at,updated_at) VALUES(?,?,?,?,?,?)','payment_intent',payment.intent,event,reason,h.now,h.now);
}
let passed=0,failed=0,calls=0,externalRequests=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{externalRequests++;throw Error('External requests are forbidden in this fixture');};
async function scope(name,test){const h=harness();h.now=BASE;try{await test(h);passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name);console.error(error);}finally{calls+=h.calls;h.close();}}

try{
await scope('empty reports are owner-only, read-only and show unknown observation rates',async h=>{
  const admin=await operator(h),guest=await h.session('未観測の領主');
  const first=await report(h,admin),second=await report(h,admin);
  assert.equal(first.revenue.byProduct.length,10);assert.deepEqual(first.revenue.byProduct.map(row=>row.productId),Object.keys(PRICES));assert.equal(first.revenue.validAmount,0);assert.equal(first.supporterRenewal.rate,null);assert.equal(first.supporterRenewal.observedSince,null);assert.equal(first.playerRetention.observedSince,null);
  for(const row of first.playerRetention.segments){assert.equal(row.observedAccounts,0);assert.equal(row.d1.rate,null);assert.equal(row.d30.rate,null);}
  for(const table of ['player_activity_program','player_activity_cohorts','player_activity_days','premium_metrics_program','premium_payment_observations'])assert.equal(one(h,'SELECT COUNT(*) n FROM '+table).n,0);
  assert.deepEqual(first.playerRetention,second.playerRetention);
  await h.api('/admin/premium/metrics',{token:guest.token,expected:403});await h.api('/admin/premium/metrics',{expected:401});
  await h.api('/health');await h.api('/config');await h.api('/not-a-route',{token:guest.token,expected:404});
  assert.equal(one(h,'SELECT COUNT(*) n FROM player_activity_cohorts').n,0);
});

await scope('all ten products use matched JPY payments, deduplicate joins and separate refunds or holds',async h=>{
  const admin=await operator(h),a=await h.session('全商品の領主'),payments=new Map();
  for(const key of Object.keys(PRICES))payments.set(key,paid(h,a,key));
  let result=await report(h,admin),sum=Object.values(PRICES).reduce((a,b)=>a+b,0);
  assert.equal(result.revenue.validPayments,10);assert.equal(result.revenue.validAmount,sum);assert.equal(result.revenue.currency,'JPY');assert.equal(result.revenue.taxIncluded,true);
  for(const row of result.revenue.byProduct)assert.deepEqual(row,{productId:row.productId,validAmount:PRICES[row.productId],validPayments:1,excludedAmount:0,excludedPayments:0});
  const gold=payments.get('gold-banner');paid(h,a,'gold-banner',{intent:gold.intent});
  const sub=payments.get('supporter');paid(h,a,'supporter',{intent:sub.intent,subscription:sub.subscription,customer:sub.customer,start:sub.start,end:sub.end});
  result=await report(h,admin);assert.equal(result.revenue.validPayments,10);assert.equal(result.revenue.validAmount,sum,'Duplicated sessions, charges and invoice-payment joins are one payment intent');
  block(h,gold);block(h,payments.get('snow-town'),'dispute_review');
  result=await report(h,admin);assert.equal(result.revenue.validPayments,8);assert.equal(result.revenue.validAmount,sum-480-980);assert.equal(result.revenue.excludedPayments,2);assert.equal(result.revenue.excludedAmount,1460);
  paid(h,a,'reroll-pass-30d',{paidFlag:0});paid(h,a,'moonlit-castle',{captured:0});
  result=await report(h,admin);assert.equal(result.revenue.validPayments,8);assert.equal(result.revenue.excludedPayments,2,'Incomplete evidence is not a valid or reversed confirmed payment');
  assert.match(result.revenue.definition,/純売上ではありません/);assert.match(result.revenue.dateBasis,/チャージ作成日/);
});

await scope('conflicting payment associations are excluded without assigning them to a guessed product',async h=>{
  const admin=await operator(h),a=await h.session('相関検証'),intent=id('pi_');
  paid(h,a,'vermilion-banner',{intent});paid(h,a,'silver-banner',{intent});
  const result=(await report(h,admin)).revenue;
  assert.equal(result.validPayments,0);assert.equal(result.excludedPayments,1);assert.equal(result.excludedAmount,580);
  assert.equal(result.unclassifiedExcludedPayments,1);assert.equal(result.unclassifiedExcludedAmount,580);assert(result.byProduct.every(row=>row.excludedPayments===0));
  const amountConflict=id('pi_');paid(h,a,'gold-banner',{intent:amountConflict});paid(h,a,'moonlit-castle',{intent:amountConflict});
  const after=(await report(h,admin)).revenue;
  assert.equal(after.validPayments,0);assert.equal(after.excludedPayments,1);assert.equal(after.excludedAmount,580,'A conflicting amount is unconfirmed, not a guessed minimum refund or exclusion');
  assert.equal(after.unclassifiedExcludedPayments,1);assert.equal(after.unclassifiedExcludedAmount,580);
});

await scope('revenue dates follow the common 05 JST boundary rather than notification arrival dates',async h=>{
  const admin=await operator(h),a=await h.session('日付検証');
  h.now=Date.UTC(2026,9,2,20,0,0);const cutoff=h.now;
  paid(h,a,'gold-banner',{chargedAt:cutoff-1});paid(h,a,'moonlit-castle',{chargedAt:cutoff});
  const today=(await report(h,admin,1)).revenue;assert.equal(today.validPayments,1);assert.equal(today.validAmount,980);
  assert.equal((await report(h,admin,2)).revenue.validAmount,1460);
});

await scope('shop conversion requires a post-view charge and a recorded complete payment confirmation',async h=>{
  const admin=await operator(h),a=await h.session('新規購入'),b=await h.session('過去購入の初確認');
  paid(h,b,'gold-banner',{chargedAt:BASE-1000});
  for(const actor of [a,b])await h.api('/premium/events',{method:'POST',token:actor.token,body:{event:'shop_view'}});
  h.now+=1000;paid(h,a,'moonlit-castle');let metrics=await report(h,admin);assert.equal(metrics.conversion.paidAfterViewAccounts,0,'A financial row without an observation is not reconstructed as a conversion');
  await observePremiumPayments(h.db,h.now);metrics=await report(h,admin);assert.equal(metrics.conversion.viewedAccounts,2);assert.equal(metrics.conversion.paidAfterViewAccounts,1);assert.equal(metrics.conversion.rate,.5);
});

await scope('activity observes real successful game connections once per day and crosses midnight only at 05 JST',async h=>{
  const admin=await operator(h),a=await h.session('日次接続');h.now=Date.UTC(2026,9,1,14,59,59);
  let observations=0;h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO player_activity_days')))observations++;};
  await visit(h,a);const first=one(h,'SELECT * FROM player_activity_cohorts WHERE user_id=?',a.user.id),start=one(h,'SELECT started_at FROM player_activity_program WHERE id=1').started_at;
  assert.equal(first.first_day,'2026-10-01');h.now+=2000;await visit(h,a);await visit(h,a);
  assert.equal(observations,1);assert.equal(one(h,'SELECT COUNT(*) n FROM player_activity_days').n,1);
  h.now=Date.UTC(2026,9,1,20);await visit(h,a);assert.equal(observations,2);assert.equal(one(h,'SELECT COUNT(*) n FROM player_activity_days').n,2);
  assert.equal(one(h,'SELECT started_at FROM player_activity_program WHERE id=1').started_at,start);
  const metrics=await report(h,admin);assert.equal(metrics.playerRetention.observedSince,new Date(start).toISOString());assert.equal(metrics.playerRetention.segments[0].d1.rate,null,'The return day is still open');
});

await scope('D1 and D30 use mature first-observation cohorts, preserve free/paid classification and need no reward claim',async h=>{
  const admin=await operator(h),freeReturn=await h.session('無料再訪'),freeLeave=await h.session('無料離脱'),paidReturn=await h.session('課金再訪'),paidLeave=await h.session('課金離脱');
  const p=paid(h,paidReturn,'gold-banner');paid(h,paidLeave,'gold-banner');
  for(const a of [freeReturn,freeLeave,paidReturn,paidLeave])await visit(h,a);
  assert.equal(one(h,'SELECT COUNT(*) n FROM login_bonus_claims').n,0);
  h.now=BASE+DAY;paid(h,freeReturn,'moonlit-castle');block(h,p);
  await visit(h,freeReturn);await visit(h,paidReturn);
  let result=await report(h,admin);assert(result.playerRetention.segments.every(s=>s.d1.rate===null));
  h.now=BASE+2*DAY;result=await report(h,admin);for(const s of result.playerRetention.segments){assert.equal(s.observedAccounts,2);assert.equal(s.d1.eligibleAccounts,2);assert.equal(s.d1.returnedAccounts,1);assert.equal(s.d1.rate,.5);}
  h.now=BASE+30*DAY;await visit(h,freeReturn);await visit(h,paidReturn);result=await report(h,admin);assert(result.playerRetention.segments.every(s=>s.d30.rate===null));
  h.now=BASE+31*DAY;result=await report(h,admin);for(const s of result.playerRetention.segments){assert.equal(s.d30.eligibleAccounts,2);assert.equal(s.d30.returnedAccounts,1);assert.equal(s.d30.rate,.5);}
  assert.equal(one(h,'SELECT segment FROM player_activity_cohorts WHERE user_id=?',freeReturn.user.id).segment,'free');assert.equal(one(h,'SELECT segment FROM player_activity_cohorts WHERE user_id=?',paidReturn.user.id).segment,'paid');
  if(process.env.METRICS_FIXTURE_PATH)writeFileSync(process.env.METRICS_FIXTURE_PATH,JSON.stringify(result,null,2));
});

await scope('supporter renewal includes cancellations, excludes immature periods and deduplicates the same service period',async h=>{
  const admin=await operator(h),a=await h.session('更新する領主'),b=await h.session('解約する領主'),old=await h.session('導入前の領主');
  const first=paid(h,a,'supporter'),ended=paid(h,b,'supporter');paid(h,old,'supporter',{start:BASE-60*DAY,end:BASE-30*DAY});
  await observePremiumPayments(h.db,h.now);const observed=one(h,'SELECT confirmed_at FROM premium_payment_observations WHERE payment_intent_id=?',first.intent).confirmed_at;
  const cancellation=id('evt_');run(h,'INSERT INTO premium_events(event_id,event_type,object_id,payload_hash,disposition,reason,event_created,received_at,commit_token) VALUES(?,?,?,?,?,?,?,?,?)',cancellation,'customer.subscription.deleted',ended.subscription,'fixture-cancel','accepted','verified_snapshot',h.now,h.now,id('nonce_'));
  run(h,'INSERT INTO premium_subscription_ends(subscription_id,ended_at,source_event_id) VALUES(?,?,?)',ended.subscription,ended.end,cancellation);
  h.now=BASE+30*DAY;paid(h,a,'supporter',{subscription:first.subscription,customer:first.customer,start:first.end,end:first.end+30*DAY});await observePremiumPayments(h.db,h.now);
  assert.equal(one(h,'SELECT confirmed_at FROM premium_payment_observations WHERE payment_intent_id=?',first.intent).confirmed_at,observed);
  h.now=BASE+37*DAY-1;let result=(await report(h,admin,90)).supporterRenewal;assert.equal(result.eligiblePeriods,0);assert.equal(result.rate,null);
  h.now++;result=(await report(h,admin,90)).supporterRenewal;assert.equal(result.eligiblePeriods,2);assert.equal(result.renewedPeriods,1);assert.equal(result.rate,.5);assert.equal(result.observedSince,new Date(BASE).toISOString());
  paid(h,a,'supporter',{subscription:first.subscription,customer:first.customer,start:first.start,end:first.end});await observePremiumPayments(h.db,h.now);
  result=(await report(h,admin,90)).supporterRenewal;assert.equal(result.eligiblePeriods,2,'Two financial invoices for one period remain one renewal opportunity');
});

await scope('renewal confirmation at seven days counts and one millisecond later does not, even for an older charge',async h=>{
  const admin=await operator(h),onTime=await h.session('猶予内'),late=await h.session('猶予超過'),p1=paid(h,onTime,'supporter'),p2=paid(h,late,'supporter');
  await observePremiumPayments(h.db,h.now);h.now=BASE+37*DAY;
  const timely=paid(h,onTime,'supporter',{subscription:p1.subscription,customer:p1.customer,start:p1.end,end:p1.end+30*DAY,chargedAt:BASE+30*DAY});await observePremiumPayments(h.db,h.now);
  h.now++;const delayed=paid(h,late,'supporter',{subscription:p2.subscription,customer:p2.customer,start:p2.end,end:p2.end+30*DAY,chargedAt:BASE+30*DAY});await observePremiumPayments(h.db,h.now);
  const result=(await report(h,admin)).supporterRenewal;assert.equal(result.eligiblePeriods,2);assert.equal(result.renewedPeriods,1);assert.equal(result.rate,.5);
  const confirmations=all(h,'SELECT payment_intent_id,confirmed_at FROM premium_payment_observations');assert.equal(confirmations.find(x=>x.payment_intent_id===timely.intent).confirmed_at,BASE+37*DAY);assert.equal(confirmations.find(x=>x.payment_intent_id===delayed.intent).confirmed_at,BASE+37*DAY+1);
  block(h,timely);await observePremiumPayments(h.db,h.now+DAY);run(h,'UPDATE premium_blocks SET reviewed_revision=revision WHERE object_id=?',timely.intent);await observePremiumPayments(h.db,h.now+2*DAY);
  assert.equal(one(h,'SELECT confirmed_at FROM premium_payment_observations WHERE payment_intent_id=?',timely.intent).confirmed_at,BASE+37*DAY,'Reconciliation does not move the first observation');
});

await scope('analytics recording failures do not change successful game responses, while health detects missing schema',async h=>{
  const a=await h.session('集計障害でも遊ぶ');h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO player_activity_days')))throw Error('fixture analytics outage');};
  await visit(h,a);assert.equal(one(h,'SELECT COUNT(*) n FROM player_activity_cohorts').n,0);h.beforeBatch=null;await visit(h,a);assert.equal(one(h,'SELECT COUNT(*) n FROM player_activity_cohorts').n,1);
  h.sql.exec('DROP TABLE player_activity_days');await h.api('/health',{expected:503});
});
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({passed,failed,calls,externalRequests,realPayments:0,productionWrites:0,fixtureOnly:true}));
if(failed||externalRequests)process.exitCode=1;
