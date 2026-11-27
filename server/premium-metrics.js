import {rewardCalendar} from './rewards.js';

const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=value=>value?.results||[];
const DAY=86400000,GRACE_DAYS=7;
const dayOffset=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
const iso=value=>new Date(Number(value)).toISOString();
const activityCaches=new WeakMap();

// Only successful, authenticated game requests are observations. Public pages,
// failed requests, payment webhooks and operator reports never create activity.
// A bounded, per-database/per-day cache removes repeated polling writes; the
// primary keys remain authoritative across isolates and simultaneous devices.
export async function recordPlayerActivity({db,user,now,path,guard}){
  if(!user?.id||path.startsWith('/admin/')||path==='/session'||path.startsWith('/devices/')||path==='/premium/stripe/webhook')return;
  const day=rewardCalendar(now).day;
  let cache=activityCaches.get(db);
  if(!cache||cache.day!==day){cache={day,users:new Set()};activityCaches.set(db,cache);}
  if(cache.users.has(user.id))return;
  const access=guard(user),eligible=access.sql,args=access.args;
  const result=await db.batch([
    stmt(db,`INSERT INTO player_activity_program(id,started_at) SELECT 1,? WHERE ${eligible} ON CONFLICT(id) DO NOTHING`,now,...args),
    stmt(db,`INSERT INTO player_activity_cohorts(user_id,first_day,first_at,segment)
      SELECT ?,?,?,CASE WHEN EXISTS(SELECT 1 FROM premium_verified_payments p WHERE p.user_id=? AND p.starts_at<=?)
        OR EXISTS(SELECT 1 FROM premium_paid_supporter_periods p JOIN premium_invoices i ON i.invoice_id=p.source_id WHERE p.user_id=? AND i.created_at<=?) THEN 'paid' ELSE 'free' END
      WHERE ${eligible} AND NOT EXISTS(SELECT 1 FROM player_activity_cohorts WHERE user_id=?) ON CONFLICT(user_id) DO NOTHING`,user.id,day,now,user.id,now,user.id,now,...args,user.id),
    stmt(db,`INSERT INTO player_activity_days(user_id,day,first_at) SELECT ?,?,? WHERE ${eligible}
      AND EXISTS(SELECT 1 FROM player_activity_cohorts WHERE user_id=?) ON CONFLICT(user_id,day) DO NOTHING`,user.id,day,now,...args,user.id),
    stmt(db,'SELECT 1 AS recorded FROM player_activity_days WHERE user_id=? AND day=?',user.id,day)
  ]);
  if(rows(result.at(-1)).length&&cache.users.size<4096)cache.users.add(user.id);
}

// Use actual matched JPY charge amounts. One payment intent is one financial
// transaction even if several sessions, invoice-payment rows or charge snapshots
// reference it. Existing blocks can remove rights without recording a refunded
// amount, so this is a current-valid-payment total, never accounting net revenue.
const financialFacts=(scoped=false)=>`WITH financial_candidates AS (
  SELECT o.user_id,s.product_id,c.payment_intent_id,c.amount,c.created_at AS charged_at,
    CASE WHEN EXISTS(SELECT 1 FROM premium_verified_payments v WHERE v.source_id=s.session_id AND v.user_id=o.user_id) THEN 1 ELSE 0 END AS valid
  FROM premium_orders o JOIN premium_sessions s ON s.reference=o.reference AND s.product_id=o.product_id
  JOIN premium_charges c ON c.payment_intent_id=s.payment_intent_id AND c.amount=s.amount AND c.currency=s.currency AND c.captured=1
  WHERE s.mode='payment' AND s.paid=1 AND c.currency='jpy' ${scoped?'AND o.user_id=?':''}
  UNION ALL
  SELECT o.user_id,'supporter',c.payment_intent_id,c.amount,c.created_at,
    CASE WHEN EXISTS(SELECT 1 FROM premium_paid_supporter_periods v WHERE v.source_id=i.invoice_id AND v.user_id=o.user_id AND v.subscription_id=i.subscription_id) THEN 1 ELSE 0 END
  FROM premium_orders o JOIN premium_sessions s ON s.reference=o.reference AND s.product_id=o.product_id
  JOIN premium_invoices i ON i.subscription_id=s.subscription_id AND i.customer_id=s.customer_id
  JOIN premium_invoice_payments p ON p.invoice_id=i.invoice_id AND p.amount=i.amount AND p.currency=i.currency
  JOIN premium_charges c ON c.payment_intent_id=p.payment_intent_id AND c.amount=i.amount AND c.currency=i.currency AND c.captured=1
  WHERE s.mode='subscription' AND s.product_id='supporter' AND c.currency='jpy' ${scoped?'AND o.user_id=?':''}
), financial_payments AS (
  SELECT payment_intent_id,CASE WHEN COUNT(DISTINCT product_id)=1 AND COUNT(DISTINCT user_id)=1 AND COUNT(DISTINCT amount)=1 THEN MIN(product_id) ELSE NULL END AS product_id,MIN(user_id) AS user_id,MIN(amount) AS amount,MIN(charged_at) AS charged_at,
    CASE WHEN COUNT(DISTINCT product_id)=1 AND COUNT(DISTINCT user_id)=1 AND COUNT(DISTINCT amount)=1 THEN MIN(valid) ELSE 0 END AS valid
  FROM financial_candidates GROUP BY payment_intent_id HAVING COUNT(DISTINCT amount)=1
)`;

// Snapshot timestamps in the older ledger are not payment-confirmation times.
// Start a fresh observation clock and retain the first complete, valid match.
// Operator report reads do not call this function or backdate observations.
export async function observePremiumPayments(db,now,userId=null){
  await db.batch([
    stmt(db,'INSERT INTO premium_metrics_program(id,started_at) VALUES(1,?) ON CONFLICT(id) DO NOTHING',now),
    stmt(db,`${financialFacts(!!userId)} INSERT INTO premium_payment_observations(payment_intent_id,user_id,product_id,confirmed_at)
      SELECT p.payment_intent_id,p.user_id,p.product_id,? FROM financial_payments p WHERE p.valid=1 AND p.charged_at<=?
        AND NOT EXISTS(SELECT 1 FROM premium_payment_observations o WHERE o.payment_intent_id=p.payment_intent_id)
      ORDER BY p.charged_at,p.payment_intent_id LIMIT 1000 ON CONFLICT(payment_intent_id) DO NOTHING`,...(userId?[userId,userId]:[]),now,now)
  ]);
}

export async function readPremiumPaymentAccounts(db,since,now){
  return stmt(db,`${financialFacts()} SELECT p.user_id,p.charged_at,o.confirmed_at AS paid_at
    FROM financial_payments p LEFT JOIN premium_payment_observations o ON o.payment_intent_id=p.payment_intent_id AND o.user_id=p.user_id AND o.product_id=p.product_id
    WHERE p.valid=1 AND p.charged_at>=? AND p.charged_at<=?`,since,now).all();
}

export async function readPremiumGrowthMetrics({db,now,fromDay,toDay,products}){
  const since=Date.parse(fromDay+'T00:00:00Z')-4*3600000;
  const [financial,periods,program,cohorts,paymentProgram]=await Promise.all([
    stmt(db,`${financialFacts()}
      SELECT product_id,valid,COUNT(*) AS payments,SUM(amount) AS amount FROM financial_payments
      WHERE charged_at>=? AND charged_at<=? GROUP BY product_id,valid`,since,now).all(),
    stmt(db,`WITH periods AS (
      SELECT p.user_id,p.subscription_id,p.period_start,p.period_end,MIN(observed.confirmed_at) AS confirmed_at
      FROM premium_paid_supporter_periods p JOIN premium_invoices i ON i.invoice_id=p.source_id
      JOIN premium_invoice_payments ip ON ip.invoice_id=i.invoice_id AND ip.amount=i.amount AND ip.currency=i.currency
      JOIN premium_charges c ON c.payment_intent_id=ip.payment_intent_id AND c.amount=i.amount AND c.currency=i.currency AND c.captured=1
      JOIN premium_payment_observations observed ON observed.payment_intent_id=c.payment_intent_id AND observed.user_id=p.user_id AND observed.product_id='supporter'
      GROUP BY p.user_id,p.subscription_id,p.period_start,p.period_end
    ) SELECT COUNT(*) AS eligible,SUM(CASE WHEN EXISTS(
      SELECT 1 FROM periods n WHERE n.user_id=p.user_id AND n.subscription_id=p.subscription_id
        AND n.period_start=p.period_end AND n.confirmed_at<=p.period_end+?) THEN 1 ELSE 0 END) AS renewed
      FROM periods p WHERE p.period_end>=? AND p.period_end+?<=? AND p.period_end>=(SELECT started_at FROM premium_metrics_program WHERE id=1)`,GRACE_DAYS*DAY,since,GRACE_DAYS*DAY,now).first(),
    stmt(db,'SELECT started_at FROM player_activity_program WHERE id=1').first(),
    stmt(db,`SELECT c.segment,COUNT(*) AS observed,
      SUM(CASE WHEN c.first_day<=date(?,'-2 day') THEN 1 ELSE 0 END) AS d1_eligible,
      SUM(CASE WHEN c.first_day<=date(?,'-2 day') AND EXISTS(SELECT 1 FROM player_activity_days a WHERE a.user_id=c.user_id AND a.day=date(c.first_day,'+1 day')) THEN 1 ELSE 0 END) AS d1_returned,
      SUM(CASE WHEN c.first_day<=date(?,'-31 day') THEN 1 ELSE 0 END) AS d30_eligible,
      SUM(CASE WHEN c.first_day<=date(?,'-31 day') AND EXISTS(SELECT 1 FROM player_activity_days a WHERE a.user_id=c.user_id AND a.day=date(c.first_day,'+30 day')) THEN 1 ELSE 0 END) AS d30_returned
      FROM player_activity_cohorts c WHERE c.first_day>=? AND c.first_day<=? GROUP BY c.segment`,toDay,toDay,toDay,toDay,fromDay,toDay).all(),
    stmt(db,'SELECT started_at FROM premium_metrics_program WHERE id=1').first()
  ]);
  const byProduct=products.map(product=>({productId:product.id,validAmount:0,validPayments:0,excludedAmount:0,excludedPayments:0}));
  const productMap=new Map(byProduct.map(row=>[row.productId,row]));
  let unclassifiedExcludedAmount=0,unclassifiedExcludedPayments=0;
  for(const record of rows(financial)){
    const item=productMap.get(record.product_id);if(!item){unclassifiedExcludedAmount+=Number(record.amount||0);unclassifiedExcludedPayments+=Number(record.payments||0);continue;}
    const prefix=record.valid?'valid':'excluded';item[prefix+'Amount']+=Number(record.amount||0);item[prefix+'Payments']+=Number(record.payments||0);
  }
  const totals=Object.fromEntries(['validAmount','validPayments','excludedAmount','excludedPayments'].map(key=>[key,byProduct.reduce((sum,row)=>sum+row[key],0)]));
  totals.excludedAmount+=unclassifiedExcludedAmount;totals.excludedPayments+=unclassifiedExcludedPayments;
  const eligiblePeriods=Number(periods?.eligible||0),renewedPeriods=Number(periods?.renewed||0),cohortMap=new Map(rows(cohorts).map(row=>[row.segment,row]));
  const retention=(row,n)=>{const eligibleAccounts=Number(row?.['d'+n+'_eligible']||0),returnedAccounts=Number(row?.['d'+n+'_returned']||0);return {eligibleAccounts,returnedAccounts,rate:eligibleAccounts?returnedAccounts/eligibleAccounts:null,throughDay:dayOffset(toDay,-n-1)};};
  return {
    revenue:{currency:'JPY',taxIncluded:true,definition:'全9商品の照合済み決済額。現在有効な支払いを合計し、返金・取消・異議申立て・保留などで利用権を確認できない決済は全額を除外欄へ分けます。未確認決済は含めません。返金実額・決済手数料を差し引いた純売上ではありません。',dateBasis:'Stripeチャージ作成日・JST05:00区切り',...totals,unclassifiedExcludedAmount,unclassifiedExcludedPayments,byProduct},
    supporterRenewal:{definition:'支払い確認の計測開始後かつ対象期間内に終了し7日間が経過した支払い済み請求期間のうち、同一契約の連続する翌請求期間の決済を終了後7日以内に照合確認できた割合。解約した契約も分母に含み、返金・保留等で無効な支払いは除外します。導入前の支払確認時刻は推測しません。',graceDays:GRACE_DAYS,observedSince:paymentProgram?iso(paymentProgram.started_at):null,eligiblePeriods,renewedPeriods,rate:eligiblePeriods?renewedPeriods/eligiblePeriods:null,throughDay:rewardCalendar(now-GRACE_DAYS*DAY).day},
    playerRetention:{definition:'計測開始後に初めて認証済みゲームAPIの成功を観測した接続アカウントの再訪率。登録日ではありません。起点時点に有効な確認済み支払い履歴があれば課金、なければ無料として固定します。後日の購入・返金で起点の分類を変えません。翌日または30日後の丸一日が終わった対象だけを評価します。匿名・未接続プレイと計測開始以前の活動は対象外です。',observedSince:program?iso(program.started_at):null,dayBoundary:'Asia/Tokyo 05:00',cohortBasis:'初回の認証済みゲームAPI成功',segments:['free','paid'].map(segment=>{const row=cohortMap.get(segment);return {segment,label:segment==='paid'?'初回観測時に課金履歴あり':'初回観測時に無料',observedAccounts:Number(row?.observed||0),d1:retention(row,1),d30:retention(row,30)};})}
  };
}
