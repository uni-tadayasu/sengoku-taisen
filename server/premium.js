import {operationGuard} from './operator-access.js';
import {rerollPassSnapshot,rewardCalendar} from './rewards.js';
import {readPremiumGrowthMetrics,observePremiumPayments,readPremiumPaymentAccounts} from './premium-metrics.js';
// Stripe snapshots are verified and reduced to immutable payment facts.
// Purchased rights and permanent cosmetic choices never come from game saves.
const PREMIUM_VERSION='2026-09-30.endive';
const PREMIUM_PRODUCTS=Object.freeze([
  {id:'gold-banner',slot:'nameplate',amount:480,mode:'payment',link:'plink_1UeEdvL3ZjL9QUmfKwCpWsEI',price:'price_1UeEcRL3ZjL9QUmf6snR2y5b',stripeProduct:'prod_VfZlNZd8yjCf4t',url:'https://buy.stripe.com/fZu6oI3Iwdcd5kn4Um9MY04'},
  {id:'moonlit-castle',slot:'town',amount:980,mode:'payment',link:'plink_1UeEg9L3ZjL9QUmf0Jiw1Inq',price:'price_1UeEfwL3ZjL9QUmfMZSVlcyg',stripeProduct:'prod_VfZpGdkUhwkdix',url:'https://buy.stripe.com/dRmdRa6UI2xz6or1Ia9MY05'},
  {id:'supporter',slot:'badge',amount:780,mode:'subscription',link:'plink_1UeEiNL3ZjL9QUmf5805BE1t',price:'price_1UeEiFL3ZjL9QUmfkthlf1SJ',stripeProduct:'prod_VfZr9Vag05JWrT',url:'https://buy.stripe.com/7sY8wQdj6dcdbILaeG9MY06'},
  {"id":"vermilion-banner","slot":"nameplate","amount":580,"mode":"payment","link":"plink_1Ufq0iL3ZjL9QUmfIWm7MlvY","price":"price_1Ufq0OL3ZjL9QUmf9LJWwrDP","stripeProduct":"prod_sengokuvs_20261126_vermilion_banner","url":"https://buy.stripe.com/aFa8wQ3Iw5JL1479aC9MY07"},
  {"id":"silver-banner","slot":"nameplate","amount":580,"mode":"payment","link":"plink_1Ufq0jL3ZjL9QUmfnDoaBTMU","price":"price_1Ufq0VL3ZjL9QUmfZWpAzq76","stripeProduct":"prod_sengokuvs_20261126_silver_banner","url":"https://buy.stripe.com/aFacN65QE4FHeUXaeG9MY08"},
  {"id":"phoenix-medallion","slot":"badge","amount":780,"mode":"payment","link":"plink_1Ufq0jL3ZjL9QUmfWThYEpqL","price":"price_1Ufq0WL3ZjL9QUmfgJALQNy2","stripeProduct":"prod_sengokuvs_20261126_phoenix_medallion","url":"https://buy.stripe.com/8x2aEY5QE5JL00386y9MY09"},
  {"id":"sakura-town","slot":"town","amount":980,"mode":"payment","link":"plink_1Ufq0kL3ZjL9QUmfWmqjwuB7","price":"price_1Ufq0XL3ZjL9QUmfZn6HpE02","stripeProduct":"prod_sengokuvs_20261126_sakura_town","url":"https://buy.stripe.com/3cI6oIfre5JLeUX5Yq9MY0a"},
  {"id":"snow-town","slot":"town","amount":980,"mode":"payment","link":"plink_1Ufq0lL3ZjL9QUmfn5BGoLuI","price":"price_1Ufq0XL3ZjL9QUmfT3rgvT9j","stripeProduct":"prod_sengokuvs_20261126_snow_town","url":"https://buy.stripe.com/28EaEYfrec893cfeuW9MY0b"},
  {id:'reroll-pass-30d',slot:null,amount:480,mode:'payment',durationDays:30,link:null,price:null,stripeProduct:null,url:null},
  {id:'castle-heritage',slot:'town',amount:980,mode:'payment',link:'plink_1UgZ3RL3ZjL9QUmf9UOolX4E',price:'price_1UgZ3IL3ZjL9QUmf26YHbrPH',stripeProduct:'prod_sengokuvs_20261128_castle_heritage',url:'https://buy.stripe.com/eVq7sM3IwgopcMP72u9MY0d'}
]);
const premiumStmt=(db,sql,...values)=>db.prepare(sql).bind(...values);
const premiumRows=result=>result?.results||[];
const premiumEmpty=()=>({nameplate:null,town:null,badge:null,ownedProducts:[]});
const CASTLE_ART_INCLUDED=new Set(['edo','kyoto_gosho','nijo','osaka','nagoya','kagoshima']);
const castleLordGuard=`EXISTS(SELECT 1 FROM castle_residents art_member JOIN castle_seats art_seat ON art_seat.castle_id=art_member.castle_id JOIN player_saves art_save ON art_save.user_id=art_member.user_id
  WHERE art_member.user_id=? AND art_seat.lord_user_id=? AND art_member.castle_id NOT IN ('edo','kyoto_gosho','nijo','osaka','nagoya','kagoshima')
  AND json_extract(art_save.save_json,'$.state.home')=art_member.castle_id AND COALESCE(json_extract(art_save.save_json,'$.state.gameOver'),0)=0
  AND json_extract(art_save.save_json,'$.state.castles.'||art_member.castle_id||'.owner')=json_extract(art_save.save_json,'$.state.clan'))`;
async function castleHeritagePurchaseAccess(db,user){
  const row=await premiumStmt(db,`SELECT json_extract(s.save_json,'$.state.home') AS home,
    ${castleLordGuard} AS eligible FROM users u LEFT JOIN player_saves s ON s.user_id=u.id WHERE u.id=?`,user.id,user.id,user.id).first();
  const home=user.is_admin?'edo':user.is_staff?'kyoto_gosho':user.is_deputy?'kagoshima':row?.home;
  return {reason:CASTLE_ART_INCLUDED.has(home)?'castle_art_included':row?.eligible?null:'castle_lord_required',sql:castleLordGuard,args:[user.id,user.id]};
}
function requireCastleHeritagePurchase(access,h){
  if(access.reason==='castle_art_included')h.fail(409,'CASTLE_ART_INCLUDED','この商品は現在の本拠では購入できません。');
  if(access.reason)h.fail(409,'CASTLE_LORD_REQUIRED','一般拠点の城主になってから購入できます。家臣の城景観には、現在の城主の設定が表示されます。');
}
function premiumProduct(id,env={}){
  const base=PREMIUM_PRODUCTS.find(product=>product.id===id);
  if(base?.id==='reroll-pass-30d')return {...base,link:env.SENGOKU_REROLL_PAYMENT_LINK_ID||base.link,price:env.SENGOKU_REROLL_PRICE_ID||base.price,stripeProduct:env.SENGOKU_REROLL_PRODUCT_ID||base.stripeProduct,url:env.SENGOKU_REROLL_PAYMENT_LINK_URL||base.url};
  if(base?.id==='castle-heritage')return {...base,link:env.SENGOKU_CASTLE_HERITAGE_PAYMENT_LINK_ID||base.link,price:env.SENGOKU_CASTLE_HERITAGE_PRICE_ID||base.price,stripeProduct:env.SENGOKU_CASTLE_HERITAGE_PRODUCT_ID||base.stripeProduct,url:env.SENGOKU_CASTLE_HERITAGE_PAYMENT_LINK_URL||base.url};
  if(base)return base;
  const reward=typeof id==='string'&&/^supporter-(20[2-9][0-9]|2[1-9][0-9]{2}|[3-9][0-9]{3})(0[1-9]|1[0-2])-(flower|moon|star)$/.exec(id);
  return reward&&Number(reward[1])>=2026?{id,slot:'nameplate',mode:'reward'}:null;
}
const supporterChoices=key=>['flower','moon','star'].map(motif=>`supporter-${key}-${motif}`);
const supporterMonth=now=>new Date(now+9*3600000).toISOString().slice(0,7).replace('-','');
function premiumProductReady(product,env){
  if(!premiumReady(env)||!premiumId(product.link,'plink_')||!premiumId(product.price,'price_')||!premiumId(product.stripeProduct,'prod_'))return false;
  try{const url=new URL(product.url);return url.protocol==='https:'&&url.hostname==='buy.stripe.com'&&!url.port&&!url.username&&!url.password&&/^\/[A-Za-z0-9]+$/.test(url.pathname)&&!url.search&&!url.hash;}catch{return false;}
}
const premiumEncoder=new TextEncoder();
const premiumGate='EXISTS(SELECT 1 FROM premium_events WHERE event_id=? AND commit_token=?)';
const PREMIUM_REVIEWABLE=Object.freeze(['refund_review','dispute_review','fraud_review']);
const premiumBlockConflict=`ON CONFLICT(scope,object_id) DO UPDATE SET
  source_event_id=excluded.source_event_id,
  reason=CASE WHEN premium_blocks.reason IN ('refund_review','dispute_review','fraud_review') THEN excluded.reason ELSE premium_blocks.reason END,
  revision=premium_blocks.revision+CASE WHEN premium_blocks.source_event_id=excluded.source_event_id THEN 0 ELSE 1 END,
  updated_at=excluded.updated_at`;
const premiumSecret=env=>typeof env.STRIPE_WEBHOOK_SECRET==='string'&&env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')&&env.STRIPE_WEBHOOK_SECRET.length>=20&&!/\s/.test(env.STRIPE_WEBHOOK_SECRET);
const premiumReady=env=>env.SENGOKU_PREMIUM_ENABLED==='true'&&premiumSecret(env);
function premiumId(value,prefix){const id=typeof value==='string'?value:value?.id;return typeof id==='string'&&id.startsWith(prefix)&&id.length>prefix.length&&/^[A-Za-z0-9_]{4,150}$/.test(id)?id:null;}
function premiumTimestamp(value){return Number.isSafeInteger(value)&&value>0&&value<=8640000000000?value*1000:null;}
function premiumPortal(env){
  const value=env.SENGOKU_STRIPE_PORTAL_URL;
  if(typeof value!=='string'||/[\s\\]/u.test(value))return null;
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='billing.stripe.com'&&!url.username&&!url.password&&!url.port&&/^\/p\/login\/[A-Za-z0-9]+$/.test(url.pathname)?url.href:null;}catch{return null;}
}
function premiumReference(){return 'pr_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');}
function premiumShape(body,keys,h){if(Object.keys(body).some(key=>!keys.includes(key)))h.fail(400,'INVALID_INPUT','購入・外観の指定内容を確認してください。');}

// Fulfillment may be retried after any delivery order or process interruption.
// The unique financial source and paid-period keys make this idempotent.
async function ensurePremiumBenefits(db,now,userId=null){
  const pending=premiumRows(await premiumStmt(db,`SELECT DISTINCT p.user_id,p.source_id,s.payment_intent_id FROM premium_verified_payments p JOIN premium_sessions s ON s.session_id=p.source_id
    WHERE p.product_id='reroll-pass-30d' ${userId?'AND p.user_id=?':''} AND NOT EXISTS(SELECT 1 FROM premium_pass_receipts r WHERE r.source_id=p.source_id OR r.payment_intent_id=s.payment_intent_id) ORDER BY p.starts_at,p.source_id LIMIT 100`,...(userId?[userId]:[])).all());
  const statements=[];
  for(const payment of pending){
    const start=`MAX(?,COALESCE((SELECT MAX(r.expires_at) FROM premium_pass_receipts r JOIN premium_verified_payments v ON v.source_id=r.source_id AND v.user_id=r.user_id WHERE r.user_id=?),?))`;
    statements.push(premiumStmt(db,`INSERT INTO premium_pass_receipts(source_id,user_id,payment_intent_id,starts_at,expires_at,fulfilled_at)
      SELECT p.source_id,p.user_id,?,${start},${start}+2592000000,? FROM premium_verified_payments p WHERE p.source_id=? AND p.user_id=? AND p.product_id='reroll-pass-30d' ON CONFLICT DO NOTHING`,payment.payment_intent_id,now,payment.user_id,now,now,payment.user_id,now,now,payment.source_id,payment.user_id));
  }
  const periods=premiumRows(await premiumStmt(db,`SELECT DISTINCT p.user_id,p.subscription_id,p.period_start,p.period_end FROM premium_paid_supporter_periods p
    WHERE p.period_end>(SELECT starts_at FROM premium_reward_program WHERE id=1) AND p.period_start<=? ${userId?'AND p.user_id=?':''}
    AND NOT EXISTS(SELECT 1 FROM premium_supporter_periods r WHERE r.user_id=p.user_id AND r.subscription_id=p.subscription_id AND r.period_start=p.period_start AND r.period_end=p.period_end)
    ORDER BY p.period_start LIMIT 100`,now,...(userId?[userId]:[])).all());
  for(const period of periods)statements.push(premiumStmt(db,`WITH RECURSIVE months(n,key) AS (
      SELECT 0,strftime('%Y%m',?) UNION ALL SELECT n+1,strftime('%Y%m',?,'+'||(n+1)||' months') FROM months WHERE n<1199)
    INSERT INTO premium_supporter_periods(id,user_id,subscription_id,period_start,period_end,period_key,created_at)
    SELECT ?,?,?,?,?,(SELECT key FROM months WHERE (SELECT COUNT(*) FROM premium_supporter_periods r WHERE r.user_id=? AND r.period_key=key)<3 ORDER BY n LIMIT 1),?
    WHERE EXISTS(SELECT 1 FROM premium_paid_supporter_periods p WHERE p.user_id=? AND p.subscription_id=? AND p.period_start=? AND p.period_end=?)
    AND ?>(SELECT starts_at FROM premium_reward_program WHERE id=1) AND ?<=? ON CONFLICT(user_id,subscription_id,period_start,period_end) DO NOTHING`,
    supporterMonth(Number(period.period_start)).replace(/^(\d{4})(\d{2})$/,'$1-$2-01'),supporterMonth(Number(period.period_start)).replace(/^(\d{4})(\d{2})$/,'$1-$2-01'),
    'srp_'+crypto.randomUUID().replaceAll('-',''),period.user_id,period.subscription_id,period.period_start,period.period_end,period.user_id,now,period.user_id,period.subscription_id,period.period_start,period.period_end,period.period_end,period.period_start,now));
  if(statements.length)await db.batch(statements);
  await observePremiumPayments(db,now,userId);
}
const supporterPeriodEligible=`EXISTS(SELECT 1 FROM premium_paid_supporter_periods p WHERE p.user_id=r.user_id AND p.subscription_id=r.subscription_id AND p.period_start=r.period_start AND p.period_end=r.period_end)`;
async function supporterRewards(db,userId,now){
  const periods=premiumRows(await premiumStmt(db,`SELECT r.*,c.product_id FROM premium_supporter_periods r LEFT JOIN premium_supporter_choices c ON c.period_id=r.id
    WHERE r.user_id=? AND r.period_start<=? AND ${supporterPeriodEligible} ORDER BY r.period_start DESC,r.id`,userId,now).all());
  return {periods:periods.map(row=>({periodId:row.id,periodKey:row.period_key,startsAt:new Date(Number(row.period_start)).toISOString(),endsAt:new Date(Number(row.period_end)).toISOString(),claimedProductId:row.product_id||null,choices:supporterChoices(row.period_key)}))};
}
async function supporterMonthExhausted(db,userId,now){
  return Number((await premiumStmt(db,`SELECT COUNT(*) AS total FROM premium_supporter_periods r WHERE r.user_id=? AND r.period_key=? AND ${supporterPeriodEligible}`,userId,supporterMonth(now)).first())?.total||0)>=3;
}
async function supporterChoice(ctx){
  const {db,user,now,request,helpers:h}=ctx,body=await h.readBody(request);premiumShape(body,['periodId','productId','requestId'],h);
  const periodId=h.idField(body.periodId,'請求期間'),requestId=h.idField(body.requestId,'操作番号');
  if(premiumProduct(body.productId)?.mode!=='reward')h.fail(400,'INVALID_PRODUCT','サポーターの選べる外観を指定してください。');
  const digest=await h.hash(JSON.stringify([periodId,body.productId])),old=await premiumStmt(db,'SELECT * FROM premium_supporter_choices WHERE user_id=? AND request_id=?',user.id,requestId).first();
  if(old){if(old.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の外観選択に使われています。');return {...await premiumSnapshot(ctx),receipt:{periodId:old.period_id,productId:old.product_id},idempotent:true};}
  await ensurePremiumBenefits(db,now,user.id);await h.budget(db,'premium:choice:'+user.id,30,60000,now);
  const period=await premiumStmt(db,`SELECT r.* FROM premium_supporter_periods r WHERE r.id=? AND r.user_id=? AND r.period_start<=? AND ${supporterPeriodEligible}`,periodId,user.id,now).first();
  if(!period)h.fail(403,'SUPPORTER_PERIOD_UNAVAILABLE','支払いが完了した対象期間を確認できません。購入状況を更新してください。');
  if(!supporterChoices(period.period_key).includes(body.productId))h.fail(400,'INVALID_PRODUCT','この請求期間の3種類から外観を選んでください。');
  const prior=await premiumStmt(db,'SELECT product_id FROM premium_supporter_choices WHERE period_id=?',periodId).first();
  if(prior)h.fail(409,'SUPPORTER_REWARD_CLAIMED','この請求期間の外観は受け取り済みです。');
  if((await premiumOwnership(db,user.id,now)).get(body.productId)?.owned||await premiumStmt(db,'SELECT 1 FROM premium_supporter_choices WHERE user_id=? AND product_id=?',user.id,body.productId).first())h.fail(409,'ALREADY_OWNED','この外観には受取履歴があります。別の外観を選んでください。選択権は消費していません。');
  const access=h.accountCommitGuard(user),nonce=crypto.randomUUID(),result=await premiumStmt(db,`INSERT INTO premium_supporter_choices(period_id,user_id,product_id,request_id,request_hash,commit_token,created_at)
    SELECT r.id,?,?,?,?,?,? FROM premium_supporter_periods r WHERE r.id=? AND r.user_id=? AND r.period_start<=? AND ${supporterPeriodEligible} AND ${access.sql}
    AND NOT EXISTS(SELECT 1 FROM premium_grants g WHERE g.user_id=? AND g.product_id=? AND g.starts_at<=? AND (g.expires_at IS NULL OR g.expires_at>?))
    ON CONFLICT DO NOTHING RETURNING period_id`,user.id,body.productId,requestId,digest,nonce,now,periodId,user.id,now,...access.args,user.id,body.productId,now,now).all();
  await h.requireAccountAccess(db,user);
  if(!premiumRows(result).length){const accepted=await premiumStmt(db,'SELECT * FROM premium_supporter_choices WHERE user_id=? AND request_id=?',user.id,requestId).first();if(accepted&&accepted.request_hash===digest)return {...await premiumSnapshot(ctx),receipt:{periodId:accepted.period_id,productId:accepted.product_id},idempotent:true};h.fail(409,'SUPPORTER_REWARD_CHANGED','支払いまたは外観の受取状況が更新されました。購入状況を更新してください。');}
  return {...await premiumSnapshot(ctx),receipt:{periodId,productId:body.productId},idempotent:false};
}

async function premiumOwnership(db,userId,now){
  const records=premiumRows(await premiumStmt(db,`SELECT product_id,MAX(CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END) AS permanent,MAX(expires_at) AS expires_at FROM premium_grants WHERE user_id=? AND starts_at<=? GROUP BY product_id`,userId,now).all());
  return new Map(records.map(row=>[row.product_id,{owned:!!row.permanent||Number(row.expires_at)>now,expiresAt:row.permanent||row.expires_at===null?null:new Date(Number(row.expires_at)).toISOString()}]));
}
async function premiumSubscriptionExists(db,userId,now){
  return !!await premiumStmt(db,`SELECT 1 FROM premium_orders o JOIN premium_sessions s ON s.reference=o.reference WHERE o.user_id=? AND o.product_id='supporter' AND s.mode='subscription' AND NOT EXISTS(SELECT 1 FROM premium_subscription_ends e WHERE e.subscription_id=s.subscription_id AND e.ended_at<=?) LIMIT 1`,userId,now).first();
}
async function premiumAppearanceRows(db,ids,now){
  if(!ids.length)return new Map();
  const queries=[];
  for(let offset=0;offset<ids.length;offset+=70){
    const page=ids.slice(offset,offset+70);
    queries.push(premiumStmt(db,`SELECT u.id AS user_id,a.nameplate,a.town,a.badge,g.product_id
      FROM users u LEFT JOIN premium_appearances a ON a.user_id=u.id
      LEFT JOIN premium_grants g ON g.user_id=u.id AND g.starts_at<=? AND (g.expires_at IS NULL OR g.expires_at>?)
      WHERE u.id IN (${page.map(()=>'?').join(',')}) AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1)`,now,now,...page));
  }
  const found=new Map();
  for(const result of await db.batch(queries))for(const row of premiumRows(result)){
    if(!found.has(row.user_id))found.set(row.user_id,{selection:row,products:new Set()});
    if(premiumProduct(row.product_id))found.get(row.user_id).products.add(row.product_id);
  }
  for(const [id,{selection,products}]of found){
    const appearance=premiumEmpty();
    for(const productId of products){const product=premiumProduct(productId);if(product?.slot){
      appearance.ownedProducts.push(product.id);
      if(selection[product.slot]===product.id)appearance[product.slot]=product.id;
    }}
    found.set(id,appearance);
  }
  return found;
}
async function premiumSnapshot(ctx){
  const {db,user,now,env}=ctx;await ensurePremiumBenefits(db,now,user.id);
  const owned=await premiumOwnership(db,user.id,now),appearances=await premiumAppearanceRows(db,[user.id],now),appearance=appearances.get(user.id)||premiumEmpty(),ready=premiumReady(env),portalUrl=premiumPortal(env),subscriptionExists=await premiumSubscriptionExists(db,user.id,now),exhausted=await supporterMonthExhausted(db,user.id,now),pass=await rerollPassSnapshot(db,user.id,now);
  if(pass.active)owned.set('reroll-pass-30d',{owned:true,expiresAt:pass.expiresAt});
  // Older clients validate a fixed three-product response. Keep their existing
  // purchases visible during the rollout; the current catalog explicitly opts in.
  const catalog=new URL(ctx.request.url).searchParams.get('catalog'),visibleProducts=catalog==='5'?PREMIUM_PRODUCTS:catalog==='4'?PREMIUM_PRODUCTS.slice(0,9):catalog==='3'?PREMIUM_PRODUCTS.slice(0,8):PREMIUM_PRODUCTS.slice(0,3);
  const castleAccess=catalog==='5'?await castleHeritagePurchaseAccess(db,user):null;
  return {ok:true,ready,player:{id:user.id,name:user.name,evaluation:ctx.helpers.evaluationRef(user.id)},products:visibleProducts.map(base=>{const product=premiumProduct(base.id,env),value=owned.get(product.id)||{owned:false,expiresAt:null},blocked=product.mode==='subscription'&&subscriptionExists,limited=product.id==='supporter'&&exhausted,configured=premiumProductReady(product,env),castleReason=product.id==='castle-heritage'?castleAccess?.reason:null;return {id:product.id,owned:value.owned,equipped:!!product.slot&&appearance[product.slot]===product.id,expiresAt:value.expiresAt,canPurchase:configured&&!value.owned&&!blocked&&!limited&&!castleReason&&(product.mode!=='subscription'||!!portalUrl),purchaseBlockReason:blocked?'subscription_exists':limited?'monthly_choices_exhausted':value.owned?'owned':castleReason||(!configured?'preparing':product.mode==='subscription'&&!portalUrl?'portal_unavailable':null)};}),appearance,portalUrl,serverNow:new Date(now).toISOString(),...(['4','5'].includes(catalog)?{rerollPass:pass,supporterRewards:await supporterRewards(db,user.id,now)}:{})};
}

function premiumReviewDto(row){return {id:row.id,scope:row.scope,objectId:row.object_id,revision:Number(row.expected_revision),eventId:row.expected_event_id,reason:row.reason,createdAt:new Date(Number(row.created_at)).toISOString()};}
function premiumReviewPlayersQuery(db,scope,objectId){
  const match={session:'s.session_id=?',subscription:'s.subscription_id=?',invoice:'i.invoice_id=?',payment_intent:'(s.payment_intent_id=? OR p.payment_intent_id=?)',charge:'c.charge_id=?'}[scope];
  return premiumStmt(db,`SELECT DISTINCT u.id,u.name FROM premium_orders o JOIN users u ON u.id=o.user_id JOIN premium_sessions s ON s.reference=o.reference
    LEFT JOIN premium_invoices i ON i.subscription_id=s.subscription_id AND i.customer_id=s.customer_id
    LEFT JOIN premium_invoice_payments p ON p.invoice_id=i.invoice_id
    LEFT JOIN premium_charges c ON c.payment_intent_id=COALESCE(s.payment_intent_id,p.payment_intent_id)
    WHERE ${match} ORDER BY u.id LIMIT 20`,...scope==='payment_intent'?[objectId,objectId]:[objectId]);
}
async function premiumReviewList(ctx){
  const {db,request,now,helpers:h}=ctx,url=new URL(request.url),raw=url.searchParams.get('limit')||'20',cursor=url.searchParams.get('cursor');
  if(!/^\d{1,2}$/.test(raw)||Number(raw)<1||Number(raw)>50)h.fail(400,'INVALID_INPUT','一覧は1〜50件で指定してください。');
  let point=null;
  if(cursor){try{if(!/^[A-Za-z0-9_-]{1,512}$/.test(cursor))throw Error();point=JSON.parse(atob(cursor.replaceAll('-','+').replaceAll('_','/')));}catch{h.fail(400,'INVALID_CURSOR','保留一覧の続きが正しくありません。');}if(!Array.isArray(point)||point.length!==3||!Number.isSafeInteger(point[0])||point[0]<0||!['session','subscription','invoice','payment_intent','charge'].includes(point[1])||typeof point[2]!=='string'||!/^[A-Za-z0-9_]{4,150}$/.test(point[2]))h.fail(400,'INVALID_CURSOR','保留一覧の続きが正しくありません。');}
  const limit=Number(raw),found=premiumRows(await premiumStmt(db,`SELECT * FROM premium_blocks WHERE reviewed_revision<revision ${point?'AND (updated_at<? OR (updated_at=? AND (scope<? OR (scope=? AND object_id<?))))':''} ORDER BY updated_at DESC,scope DESC,object_id DESC LIMIT ?`,...(point?[point[0],point[0],point[1],point[1],point[2]]:[]),limit+1).all()),page=found.slice(0,limit),last=page.at(-1),players=page.length?await db.batch(page.map(row=>premiumReviewPlayersQuery(db,row.scope,row.object_id))):[];
  return {ok:true,holds:page.map((row,index)=>({scope:row.scope,objectId:row.object_id,revision:Number(row.revision),eventId:row.source_event_id,reason:row.reason,createdAt:new Date(Number(row.created_at)).toISOString(),updatedAt:new Date(Number(row.updated_at)).toISOString(),canRelease:PREMIUM_REVIEWABLE.includes(row.reason),players:premiumRows(players[index]).map(player=>({...player,evaluation:h.evaluationRef(player.id)}))})),nextCursor:found.length>limit?btoa(JSON.stringify([Number(last.updated_at),last.scope,last.object_id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null,serverNow:new Date(now).toISOString()};
}
async function premiumReviewRelease(ctx){
  const {db,user,now,request,helpers:h}=ctx,body=await h.readBody(request);
  premiumShape(body,['scope','objectId','expectedRevision','expectedEventId','reason','requestId'],h);
  const prefixes={session:'cs_',subscription:'sub_',invoice:'in_',payment_intent:'pi_',charge:'ch_'};
  if(!Object.hasOwn(prefixes,body.scope)||!premiumId(body.objectId,prefixes[body.scope])||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1||!premiumId(body.expectedEventId,'evt_'))h.fail(400,'INVALID_INPUT','確認対象の保留と更新番号を指定してください。');
  const normalized={scope:body.scope,objectId:body.objectId,expectedRevision:body.expectedRevision,expectedEventId:body.expectedEventId,reason:h.textField(body.reason,'Stripeで確認した解除理由',500,{min:8})},requestId=h.idField(body.requestId,'操作番号'),digest=await h.hash(JSON.stringify(normalized));
  const prior=await premiumStmt(db,'SELECT * FROM premium_reviews WHERE actor_id=? AND request_id=?',user.id,requestId).first();
  if(prior){if(prior.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の確認に使用されています。');return {ok:true,review:premiumReviewDto(prior),idempotent:true};}
  await h.budget(db,'premium:review:'+user.id,30,60000,now);
  const block=await premiumStmt(db,'SELECT * FROM premium_blocks WHERE scope=? AND object_id=?',body.scope,body.objectId).first();
  if(!block)h.fail(404,'PREMIUM_REVIEW_NOT_FOUND','この保留は見つかりませんでした。');
  if(!PREMIUM_REVIEWABLE.includes(block.reason))h.fail(403,'PREMIUM_REVIEW_FORBIDDEN','返金確定や不一致による利用権の失効は、この操作では解除できません。');
  const access=operationGuard(user),id=h.uid('prv_'),receiptGate='EXISTS(SELECT 1 FROM premium_reviews WHERE actor_id=? AND request_id=? AND id=?)';
  const result=await db.batch([
    premiumStmt(db,`INSERT INTO premium_reviews(id,actor_id,request_id,request_hash,scope,object_id,expected_revision,expected_event_id,reason,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? FROM premium_blocks b WHERE b.scope=? AND b.object_id=? AND b.revision=? AND b.source_event_id=? AND b.reviewed_revision<b.revision AND b.reason IN ('refund_review','dispute_review','fraud_review') AND ${access.sql} ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING id`,id,user.id,requestId,digest,body.scope,body.objectId,body.expectedRevision,body.expectedEventId,normalized.reason,now,body.scope,body.objectId,body.expectedRevision,body.expectedEventId,...access.args),
    premiumStmt(db,`UPDATE premium_blocks SET reviewed_revision=revision WHERE scope=? AND object_id=? AND ${receiptGate}`,body.scope,body.objectId,user.id,requestId,id),
    premiumStmt(db,'SELECT * FROM premium_reviews WHERE actor_id=? AND request_id=?',user.id,requestId)
  ]);
  await h.requireAccountAccess(db,user);h.requireOperator(await h.getUser(db,user.id));
  const review=premiumRows(result[2])[0];
  if(!review)h.fail(409,'PREMIUM_REVIEW_CHANGED','新しい通知で保留の状態が変わりました。一覧を更新し、Stripeで最新の状態を確認してください。');
  if(review.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の確認に使用されています。');
  return {ok:true,review:premiumReviewDto(review),idempotent:!premiumRows(result[0]).length};
}

export async function handlePremium(ctx){
  const {db,user,now,env,path,method,request,helpers:h}=ctx;
  if(path==='/admin/premium/reviews'){
    h.requireOperator(user);
    if(method==='GET')return premiumReviewList(ctx);
    if(method==='POST')return premiumReviewRelease(ctx);
  }
  if(path==='/premium'&&method==='GET')return premiumSnapshot(ctx);
  if(path==='/premium/supporter-choice'&&method==='POST')return supporterChoice(ctx);
  if(path==='/premium/events'&&method==='POST')return premiumEvent(ctx);
  if(path==='/admin/premium/metrics'&&method==='GET'){h.requireOperator(user);return premiumMetrics(ctx);}
  if(path==='/premium/checkout'&&method==='POST'){
    const body=await h.readBody(request);premiumShape(body,['productId'],h);
    const product=premiumProduct(body.productId,env);if(!product||product.mode==='reward')h.fail(400,'INVALID_PRODUCT','この商品は販売対象ではありません。');
    if(!premiumProductReady(product,env)||(product.mode==='subscription'&&!premiumPortal(env)))h.fail(503,'PREMIUM_NOT_READY','販売の準備中です。購入先の確認が終わるまでお待ちください。');
    await ensurePremiumBenefits(db,now,user.id);
    await h.budget(db,'premium:checkout:'+user.id,20,60000,now);
    if(product.mode==='subscription'&&await premiumSubscriptionExists(db,user.id,now))h.fail(409,'SUBSCRIPTION_EXISTS','サポーター契約を確認中です。重複購入を避けるため、契約管理ページで更新・支払い・解約をご確認ください。');
    if(product.id==='supporter'&&await supporterMonthExhausted(db,user.id,now))h.fail(409,'MONTHLY_CHOICES_EXHAUSTED','今月の3種類分の選択権を持っています。翌月の外観が始まってから再契約できます。');
    const owned=await premiumOwnership(db,user.id,now);if(owned.get(product.id)?.owned)h.fail(409,'ALREADY_OWNED','この商品は利用できます。外観の設定を確認してください。');
    const castleAccess=product.id==='castle-heritage'?await castleHeritagePurchaseAccess(db,user):null;
    if(castleAccess)requireCastleHeritagePurchase(castleAccess,h);
    const accountAccess=h.accountCommitGuard(user),access=castleAccess?{sql:accountAccess.sql+' AND '+castleAccess.sql,args:[...accountAccess.args,...castleAccess.args]}:accountAccess,reference=premiumReference();
    const result=await db.batch([
      premiumStmt(db,`INSERT INTO premium_orders(reference,user_id,product_id,created_at) SELECT ?,?,?,? WHERE ${access.sql} ON CONFLICT(user_id,product_id) DO NOTHING`,reference,user.id,product.id,now,...access.args),
      premiumStmt(db,'SELECT reference FROM premium_orders WHERE user_id=? AND product_id=?',user.id,product.id)
    ]);
    await h.requireAccountAccess(db,user);
    if(castleAccess)requireCastleHeritagePurchase(await castleHeritagePurchaseAccess(db,user),h);
    const order=premiumRows(result[1])[0];if(!order)h.fail(409,'PREMIUM_CHANGED','購入の準備をもう一度お試しください。');
    const url=new URL(product.url);url.searchParams.set('client_reference_id',order.reference);
    return {ok:true,productId:product.id,url:url.href};
  }
  if(path==='/premium/appearance'&&method==='PUT'){
    const body=await h.readBody(request);premiumShape(body,['slot','productId'],h);
    if(!['nameplate','town','badge'].includes(body.slot)||!Object.hasOwn(body,'productId')||(body.productId!==null&&premiumProduct(body.productId)?.slot!==body.slot))h.fail(400,'INVALID_APPEARANCE','外観の種類を確認してください。');
    await h.budget(db,'premium:appearance:'+user.id,40,60000,now);
    const access=h.accountCommitGuard(user),eligible=body.productId===null?'1':`EXISTS(SELECT 1 FROM premium_grants WHERE user_id=? AND product_id=? AND starts_at<=? AND (expires_at IS NULL OR expires_at>?))`,eligibleArgs=body.productId===null?[]:[user.id,body.productId,now,now];
    const result=await premiumStmt(db,`INSERT INTO premium_appearances(user_id,${body.slot},updated_at) SELECT ?,?,? WHERE ${access.sql} AND ${eligible} ON CONFLICT(user_id) DO UPDATE SET ${body.slot}=excluded.${body.slot},updated_at=excluded.updated_at RETURNING user_id`,user.id,body.productId,now,...access.args,...eligibleArgs).all();
    if(!premiumRows(result).length){await h.requireAccountAccess(db,user);h.fail(403,'PREMIUM_NOT_OWNED','この外観の利用権を確認できませんでした。購入状況を更新してください。');}
    return premiumSnapshot(ctx);
  }
  h.fail(404,'NOT_FOUND','その購入・外観の機能は見つかりませんでした。');
}

// Display selections and current ownership are projected together. Historical
// posts/receipts keep their stored bytes; no payment identifiers are exposed.
// The evaluation update lists also refresh cached authors on an empty delta.
export async function resolvePremiumAppearances(db,payload,now){
  const refs=[],ids=new Set(),skip=new Set(['save','state','entitlements','appearance']);
  const playerId=id=>typeof id==='string'&&/^u_[A-Za-z0-9_]{1,96}$/.test(id);
  function add(value,id,key){if(playerId(id)){refs.push({value,id,key});ids.add(id);}}
  function visit(value){
    if(!value||typeof value!=='object')return;
    const id=value.playerId||value.userId||value.id;
    if(typeof value.name==='string'||value.playerId&&Object.hasOwn(value,'evaluation'))add(value,id,'appearance');
    // A retainer's profile shows the current lord's castle appearance while
    // retaining that retainer's own nameplate and badges.
    if(Object.hasOwn(value,'homeCastleOwnerId'))add(value,value.homeCastleOwnerId,'homeCastleAppearance');
    for(const [idKey,nameKey,key]of [
      ['playerId','playerName','playerAppearance'],
      ['ownerId','ownerName','ownerAppearance'],
      ['authorId','authorName','authorAppearance'],
      ['targetPlayerId','targetName','targetAppearance'],
      ['attackerPlayerId','attackerName','attackerAppearance'],
      ['defenderPlayerId','defenderName','defenderAppearance'],
      ['castleOwnerId','lordName','castleAppearance']
    ])if(typeof value[nameKey]==='string')add(value,value[idKey],key);
    for(const [key,child]of Object.entries(value))if(!skip.has(key))visit(child);
  }
  visit(payload);if(!ids.size)return payload;
  const found=await premiumAppearanceRows(db,[...ids],now);
  for(const ref of refs)ref.value[ref.key]=found.get(ref.id)||premiumEmpty();
  return payload;
}

async function premiumRawBody(request,h){
  const limit=512*1024,declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>limit)h.fail(413,'BODY_TOO_LARGE','通知が大きすぎます。');
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))h.fail(415,'JSON_REQUIRED','JSON通知が必要です。');
  const reader=request.body?.getReader();if(!reader)h.fail(400,'INVALID_WEBHOOK','通知本文がありません。');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();h.fail(413,'BODY_TOO_LARGE','通知が大きすぎます。');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
async function premiumVerify(request,bytes,env,now,h){
  if(!premiumSecret(env))h.fail(503,'PREMIUM_NOT_READY','決済通知の受信設定を確認してください。');
  const header=request.headers.get('stripe-signature')||'';if(header.length>2048)h.fail(400,'STRIPE_SIGNATURE_INVALID','通知の署名が正しくありません。');
  const parts=header.split(',').map(part=>part.trim().split('=')),timestamps=parts.filter(part=>part[0]==='t'),signatures=parts.filter(part=>part[0]==='v1'&&/^[a-fA-F0-9]{64}$/.test(part[1]||'')).slice(0,8);
  if(timestamps.length!==1||!/^\d{1,12}$/.test(timestamps[0][1])||Math.abs(now-Number(timestamps[0][1])*1000)>300000||!signatures.length)h.fail(400,'STRIPE_SIGNATURE_INVALID','通知の署名が正しくありません。');
  const prefix=premiumEncoder.encode(timestamps[0][1]+'.'),signed=new Uint8Array(prefix.length+bytes.length);signed.set(prefix);signed.set(bytes,prefix.length);
  const key=await crypto.subtle.importKey('raw',premiumEncoder.encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  let valid=false;for(const [,hex]of signatures){const sig=Uint8Array.from(hex.match(/../g),value=>parseInt(value,16));if(await crypto.subtle.verify('HMAC',key,sig,signed))valid=true;}
  if(!valid)h.fail(400,'STRIPE_SIGNATURE_INVALID','通知の署名が正しくありません。');
}

function premiumFact(plan,table,values,{primary,scope,objectId,promote=null}={}){
  const keys=Object.keys(values),stable=keys.filter(key=>key!==promote&&key!=='created_at'),match=stable.map(key=>`${table}.${key} IS ?`).join(' AND '),gateArgs=[plan.event.id,plan.nonce];
  const conflict=promote?`DO UPDATE SET ${promote}=MAX(${table}.${promote},excluded.${promote}) WHERE ${stable.map(key=>`${table}.${key} IS excluded.${key}`).join(' AND ')}`:'DO NOTHING';
  plan.statements.push(premiumStmt(plan.db,`INSERT INTO ${table}(${keys.join(',')}) SELECT ${keys.map(()=>'?').join(',')} WHERE ${premiumGate} ON CONFLICT(${primary}) ${conflict}`,...keys.map(key=>values[key]),...gateArgs));
  if(scope&&objectId)plan.statements.push(premiumStmt(plan.db,`INSERT INTO premium_blocks(scope,object_id,source_event_id,reason,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE ${premiumGate} AND EXISTS(SELECT 1 FROM ${table} WHERE ${primary}=? AND NOT(${match})) ${premiumBlockConflict}`,scope,objectId,plan.event.id,'conflicting_snapshot',plan.now,plan.now,...gateArgs,values[primary],...stable.map(key=>values[key])));
}
function premiumBlock(plan,scope,objectId,reason){if(objectId)plan.statements.push(premiumStmt(plan.db,`INSERT INTO premium_blocks(scope,object_id,source_event_id,reason,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE ${premiumGate} ${premiumBlockConflict}`,scope,objectId,plan.event.id,reason,plan.now,plan.now,plan.event.id,plan.nonce));}
function premiumChargeLinks(plan,object,reason){const charge=premiumId(object.charge,'ch_'),intent=premiumId(object.payment_intent,'pi_');if(!charge&&!intent)return false;premiumBlock(plan,'charge',charge,reason);premiumBlock(plan,'payment_intent',intent,reason);return true;}
function premiumQuantity(line){return line.quantity===1&&(line.quantity_decimal===undefined||typeof line.quantity_decimal==='string'&&/^1(?:\.0{1,12})?$/.test(line.quantity_decimal));}

async function premiumPlan(ctx,event,nonce){
  const {db,now,env}=ctx,object=event.data.object,type=event.type,plan={db,now,event,nonce,statements:[],disposition:'accepted',reason:'verified_snapshot'};
  const reject=(reason,block=true)=>{
    const denied={...plan,statements:[],disposition:'quarantined',reason};
    // A later malformed snapshot of a known financial object cannot leave an
    // earlier grant usable. Preserve the denial even when the good fact is late.
    if(block){
      if(type.startsWith('checkout.session.'))premiumBlock(denied,'session',premiumId(object.id,'cs_'),reason);
      else if(type==='invoice.paid')premiumBlock(denied,'invoice',premiumId(object.id,'in_'),reason);
      else if(type==='invoice_payment.paid')premiumBlock(denied,'invoice',premiumId(object.invoice,'in_'),reason);
      else if(['charge.succeeded','charge.captured','charge.updated'].includes(type))premiumBlock(denied,'charge',premiumId(object.id,'ch_'),reason);
      else if(type.startsWith('customer.subscription.'))premiumBlock(denied,'subscription',premiumId(object.id,'sub_'),reason);
      else premiumChargeLinks(denied,object,reason);
    }
    return denied;
  };
  if(event.livemode!==true||object.livemode===false||event.account||event.api_version!==PREMIUM_VERSION)return reject('mode_account_or_version',false);
  if(type==='checkout.session.completed'||type==='checkout.session.async_payment_succeeded'){
    const session=premiumId(object.id,'cs_'),reference=object.client_reference_id,link=premiumId(object.payment_link,'plink_'),product=link?PREMIUM_PRODUCTS.map(item=>premiumProduct(item.id,env)).find(item=>item.link===link):null;
    if(!session||!product||typeof reference!=='string'||!/^pr_[a-f0-9]{64}$/.test(reference)||object.object!=='checkout.session'||object.status!=='complete'||object.mode!==product.mode||object.currency!=='jpy'||object.amount_total!==product.amount||!['paid','unpaid'].includes(object.payment_status))return reject('checkout_mismatch');
    const order=await premiumStmt(db,'SELECT user_id,product_id FROM premium_orders WHERE reference=?',reference).first();
    if(!order||order.product_id!==product.id)return reject('checkout_reference');
    const customer=premiumId(object.customer,'cus_'),intent=premiumId(object.payment_intent,'pi_'),subscription=premiumId(object.subscription,'sub_');
    if(product.mode==='payment'&&(!intent||subscription)||product.mode==='subscription'&&(!customer||!subscription)||type==='checkout.session.async_payment_succeeded'&&object.payment_status!=='paid')return reject('checkout_identity');
    if(object.line_items){const items=object.line_items;if(items.has_more!==false||!Array.isArray(items.data)||items.data.length!==1)return reject('checkout_lines');const line=items.data[0];if(!premiumQuantity(line)||premiumId(line.price,'price_')!==product.price||line.amount_total!==product.amount)return reject('checkout_lines');}
    premiumFact(plan,'premium_sessions',{session_id:session,reference,product_id:product.id,mode:product.mode,customer_id:customer,payment_intent_id:intent,subscription_id:subscription,amount:product.amount,currency:'jpy',paid:object.payment_status==='paid'?1:0,created_at:premiumTimestamp(object.created)||now},{primary:'session_id',scope:'session',objectId:session,promote:'paid'});
  }else if(type==='charge.succeeded'||type==='charge.captured'||type==='charge.updated'){
    const id=premiumId(object.id,'ch_'),intent=premiumId(object.payment_intent,'pi_');
    if(!id||!intent||object.object!=='charge'||object.paid!==true||!Number.isSafeInteger(object.amount)||object.amount<=0||object.currency!=='jpy')return reject('charge_mismatch');
    if(object.refunded===true||Number(object.amount_refunded)>0){premiumBlock(plan,'charge',id,'charge_refunded');premiumBlock(plan,'payment_intent',intent,'charge_refunded');}
    const captured=object.captured===true&&(object.amount_captured===undefined||object.amount_captured===object.amount);
    premiumFact(plan,'premium_charges',{charge_id:id,payment_intent_id:intent,amount:object.amount,currency:'jpy',captured:captured?1:0,created_at:premiumTimestamp(object.created)||now},{primary:'charge_id',scope:'charge',objectId:id,promote:'captured'});
  }else if(type==='invoice.payment_failed'||type==='checkout.session.async_payment_failed'){
    if(type==='invoice.payment_failed'&&(!premiumId(object.id,'in_')||object.object!=='invoice')||type==='checkout.session.async_payment_failed'&&(!premiumId(object.id,'cs_')||object.object!=='checkout.session'))return reject('failed_payment_mismatch',false);
    plan.reason='payment_failed_no_grant';
  }else if(type==='invoice.paid'){
    const product=premiumProduct('supporter'),id=premiumId(object.id,'in_'),subscription=premiumId(object.parent?.subscription_details?.subscription,'sub_'),customer=premiumId(object.customer,'cus_'),lines=object.lines;
    if(!id||!subscription||!customer||object.object!=='invoice'||object.status!=='paid'||object.currency!=='jpy'||object.amount_paid!==product.amount||object.amount_due!==product.amount||object.total!==product.amount||object.amount_remaining!==0||!['subscription_create','subscription_cycle'].includes(object.billing_reason)||object.parent?.type!=='subscription_details'||!lines||lines.has_more!==false||!Array.isArray(lines.data)||lines.data.length!==1)return reject('invoice_mismatch');
    const line=lines.data[0],start=premiumTimestamp(line.period?.start),end=premiumTimestamp(line.period?.end),parent=line.parent?.subscription_item_details;
    if(!start||!end||end-start<27*86400000||end-start>32*86400000||line.parent?.type!=='subscription_item_details'||parent?.proration!==false||premiumId(parent?.subscription,'sub_')!==subscription||line.pricing?.type!=='price_details'||premiumId(line.pricing?.price_details?.price,'price_')!==product.price||premiumId(line.pricing?.price_details?.product,'prod_')!==product.stripeProduct||line.currency!=='jpy'||line.amount!==product.amount||!premiumQuantity(line))return reject('invoice_line_mismatch');
    premiumFact(plan,'premium_invoices',{invoice_id:id,subscription_id:subscription,customer_id:customer,amount:product.amount,currency:'jpy',period_start:start,period_end:end,created_at:now},{primary:'invoice_id',scope:'invoice',objectId:id});
  }else if(type==='invoice_payment.paid'){
    const id=premiumId(object.id,'inpay_'),invoice=premiumId(object.invoice,'in_'),intent=premiumId(object.payment?.payment_intent,'pi_');
    if(!id||!invoice||!intent||object.object!=='invoice_payment'||object.payment?.type!=='payment_intent'||object.status!=='paid'||object.amount_paid!==780||object.currency!=='jpy'||!premiumTimestamp(object.status_transitions?.paid_at))return reject('invoice_payment_mismatch');
    premiumFact(plan,'premium_invoice_payments',{payment_id:id,invoice_id:invoice,payment_intent_id:intent,amount:780,currency:'jpy',created_at:now},{primary:'payment_id',scope:'invoice',objectId:invoice});
  }else if(type==='customer.subscription.updated'||type==='customer.subscription.deleted'){
    const id=premiumId(object.id,'sub_');if(!id||object.object!=='subscription'||typeof object.status!=='string')return reject('subscription_mismatch');
    if(type==='customer.subscription.deleted'||object.status==='canceled'){
      const ended=premiumTimestamp(object.ended_at);
      if(ended)plan.statements.push(premiumStmt(db,`INSERT INTO premium_subscription_ends(subscription_id,ended_at,source_event_id) SELECT ?,?,? WHERE ${premiumGate} ON CONFLICT(subscription_id) DO UPDATE SET ended_at=MIN(premium_subscription_ends.ended_at,excluded.ended_at)`,id,ended,event.id,event.id,nonce));
      else premiumBlock(plan,'subscription',id,'subscription_ended_without_time');
    }
    // A cancellation request is reversible. Paid periods expire naturally;
    // only an actual, irreversible end cuts short an already-paid period.
  }else if(type==='charge.refunded'){
    const id=premiumId(object.id,'ch_');if(!id||object.object!=='charge'||!(object.refunded===true||Number(object.amount_refunded)>0))return reject('refund_mismatch');
    premiumBlock(plan,'charge',id,'refund');premiumBlock(plan,'payment_intent',premiumId(object.payment_intent,'pi_'),'refund');
  }else if(['refund.created','refund.updated','refund.failed','charge.refund.updated'].includes(type)){
    if(object.object!=='refund'||!premiumId(object.id,'re_')||!['pending','requires_action','succeeded','failed','canceled'].includes(object.status)||!premiumChargeLinks(plan,object,object.status==='succeeded'?'refund':'refund_review'))return reject('refund_mismatch');
  }else if(type.startsWith('charge.dispute.')){
    if(object.object!=='dispute'||!premiumId(object.id,'dp_')||typeof object.status!=='string'||!premiumChargeLinks(plan,object,object.status==='lost'?'dispute_lost':'dispute_review'))return reject('dispute_mismatch');
  }else if(type==='radar.early_fraud_warning.created'||type==='radar.early_fraud_warning.updated'){
    if(object.object!=='radar.early_fraud_warning'||!premiumId(object.id,'issfr_')||!premiumChargeLinks(plan,object,'fraud_review'))return reject('fraud_warning_mismatch');
  }else return {...plan,disposition:'ignored',reason:'unsupported_event'};
  return plan;
}

export async function handlePremiumWebhook(ctx){
  const {db,request,env,now,helpers:h}=ctx,bytes=await premiumRawBody(request,h);
  await premiumVerify(request,bytes,env,now,h);
  let event;try{event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{h.fail(400,'INVALID_WEBHOOK','通知JSONが正しくありません。');}
  if(!event||typeof event!=='object'||!premiumId(event.id,'evt_')||typeof event.type!=='string'||event.type.length>100||!event.data?.object||typeof event.data.object!=='object'||Array.isArray(event.data.object)||!premiumTimestamp(event.created))h.fail(400,'INVALID_WEBHOOK','通知の識別情報が正しくありません。');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join(''),prior=await premiumStmt(db,'SELECT payload_hash,disposition FROM premium_events WHERE event_id=?',event.id).first();
  if(prior){if(prior.payload_hash!==digest)h.fail(409,'STRIPE_EVENT_CONFLICT','同じ通知番号の内容が一致しません。');await ensurePremiumBenefits(db,now);return {ok:true,received:true,duplicate:true,disposition:prior.disposition};}
  const nonce=crypto.randomUUID(),plan=await premiumPlan(ctx,event,nonce),objectId=typeof event.data.object.id==='string'?event.data.object.id.slice(0,150):'';
  const result=await db.batch([
    premiumStmt(db,`INSERT INTO premium_events(event_id,event_type,object_id,payload_hash,disposition,reason,event_created,received_at,commit_token) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,event.id,event.type,objectId,digest,plan.disposition,plan.reason,premiumTimestamp(event.created),now,nonce),
    ...plan.statements,
    premiumStmt(db,'SELECT payload_hash,disposition FROM premium_events WHERE event_id=?',event.id)
  ]);
  const saved=premiumRows(result.at(-1))[0];if(saved?.payload_hash!==digest)h.fail(409,'STRIPE_EVENT_CONFLICT','同じ通知番号の内容が一致しません。');
  await ensurePremiumBenefits(db,now);
  return {ok:true,received:true,duplicate:!premiumRows(result[0]).length,disposition:saved.disposition};
}

async function premiumEvent(ctx){
  const {db,user,now,request,helpers:h}=ctx,body=await h.readBody(request);premiumShape(body,['event','productId'],h);
  if(!['shop_view','checkout_start'].includes(body.event)||body.productId!==undefined&&!PREMIUM_PRODUCTS.some(product=>product.id===body.productId)||body.event==='checkout_start'&&!body.productId)h.fail(400,'INVALID_INPUT','記録するショップ操作を確認してください。');
  // These are event counts, never unique visitor or purchase counts.
  await h.budget(db,'premium:metrics:'+user.id,30,60000,now);const access=h.accountCommitGuard(user);
  const day=rewardCalendar(now).day;
  await db.batch([
    premiumStmt(db,`INSERT INTO premium_daily_events(day,event,product_id,count) SELECT ?,?,?,1 WHERE ${access.sql} ON CONFLICT(day,event,product_id) DO UPDATE SET count=count+1`,day,body.event,body.productId||'',...access.args),
    premiumStmt(db,`INSERT INTO premium_daily_visitors(user_id,day,event,product_id,first_at) SELECT ?,?,?,?,? WHERE ${access.sql} ON CONFLICT(user_id,day,event,product_id) DO NOTHING`,user.id,day,body.event,body.productId||'',now,...access.args)
  ]);
  await h.requireAccountAccess(db,user);return {ok:true};
}
async function premiumMetrics(ctx){
  const {db,now,request,helpers:h}=ctx,raw=new URL(request.url).searchParams.get('days')||'14';
  if(!/^\d{1,2}$/.test(raw)||Number(raw)<1||Number(raw)>90)h.fail(400,'INVALID_INPUT','集計期間は1〜90日で指定してください。');
  const days=Number(raw),toDay=rewardCalendar(now).day,base=Date.parse(toDay+'T00:00:00Z'),fromDay=new Date(base-(days-1)*86400000).toISOString().slice(0,10),since=Date.parse(fromDay+'T00:00:00Z')-4*3600000;
  const [eventRows,passRows,periodRows,loginRows,cohortRows,accountRows,visitorRows,paidRows]=await Promise.all([
    premiumStmt(db,'SELECT day,event,SUM(count) AS total FROM premium_daily_events WHERE day>=? AND day<=? GROUP BY day,event',fromDay,toDay).all(),
    premiumStmt(db,"SELECT strftime('%Y-%m-%d',r.fulfilled_at/1000,'unixepoch','+4 hours') AS day,COUNT(DISTINCT r.source_id) AS total FROM premium_pass_receipts r JOIN premium_verified_payments p ON p.source_id=r.source_id AND p.user_id=r.user_id WHERE r.fulfilled_at>=? AND r.fulfilled_at<=? GROUP BY day",since,now).all(),
    premiumStmt(db,"SELECT strftime('%Y-%m-%d',confirmed_at/1000,'unixepoch','+4 hours') AS day,COUNT(*) AS total FROM (SELECT p.user_id,p.subscription_id,p.period_start,p.period_end,MIN(i.created_at) AS confirmed_at FROM premium_paid_supporter_periods p JOIN premium_invoices i ON i.invoice_id=p.source_id GROUP BY p.user_id,p.subscription_id,p.period_start,p.period_end) WHERE confirmed_at>=? AND confirmed_at<=? GROUP BY day",since,now).all(),
    premiumStmt(db,'SELECT day,COUNT(DISTINCT user_id) AS accounts,COUNT(*) AS claims FROM login_bonus_claims WHERE day>=? AND day<=? GROUP BY day',fromDay,toDay).all(),
    premiumStmt(db,`SELECT COUNT(*) AS cohort,SUM(CASE WHEN EXISTS(SELECT 1 FROM login_bonus_claims n WHERE n.user_id=f.user_id AND n.day=date(f.first_day,'+1 day')) THEN 1 ELSE 0 END) AS returned
      FROM (SELECT user_id,MIN(day) AS first_day FROM login_bonus_claims GROUP BY user_id) f WHERE f.first_day>=? AND f.first_day<=date(?,'-2 day')`,fromDay,toDay).all(),
    premiumStmt(db,'SELECT COUNT(DISTINCT user_id) AS total FROM login_bonus_claims WHERE day>=? AND day<=?',fromDay,toDay).all(),
    premiumStmt(db,'SELECT user_id,event,MIN(first_at) AS first_at FROM premium_daily_visitors WHERE day>=? AND day<=? GROUP BY user_id,event',fromDay,toDay).all(),
    readPremiumPaymentAccounts(db,since,now)
  ]);
  const daily=Array.from({length:days},(_,index)=>({day:new Date(base-(days-1-index)*86400000).toISOString().slice(0,10),shopViews:0,checkoutStarts:0,fulfilledPasses:0,paidSupporterPeriods:0,loginClaimAccounts:0,loginClaims:0})),byDay=new Map(daily.map(row=>[row.day,row]));
  for(const row of premiumRows(eventRows)){const day=byDay.get(row.day);if(day)day[row.event==='shop_view'?'shopViews':'checkoutStarts']=Number(row.total);}
  for(const row of premiumRows(passRows)){const day=byDay.get(row.day);if(day)day.fulfilledPasses=Number(row.total);}
  for(const row of premiumRows(periodRows)){const day=byDay.get(row.day);if(day)day.paidSupporterPeriods=Number(row.total);}
  for(const row of premiumRows(loginRows)){const day=byDay.get(row.day);if(day){day.loginClaimAccounts=Number(row.accounts);day.loginClaims=Number(row.claims);}}
  const totals=Object.fromEntries(['shopViews','checkoutStarts','fulfilledPasses','paidSupporterPeriods','loginClaimAccounts','loginClaims'].map(key=>[key,daily.reduce((sum,row)=>sum+row[key],0)]));totals.loginClaimAccounts=Number(premiumRows(accountRows)[0]?.total||0);
  const cohort=premiumRows(cohortRows)[0]||{},cohortAccounts=Number(cohort.cohort||0),returnedNextDay=Number(cohort.returned||0);
  const viewers=new Map(premiumRows(visitorRows).filter(row=>row.event==='shop_view').map(row=>[row.user_id,Number(row.first_at)])),clickers=new Set(premiumRows(visitorRows).filter(row=>row.event==='checkout_start').map(row=>row.user_id)),paid=new Set(premiumRows(paidRows).map(row=>row.user_id)),converted=new Set(premiumRows(paidRows).filter(row=>viewers.has(row.user_id)&&row.paid_at!==null&&Number(row.paid_at)>=viewers.get(row.user_id)&&Number(row.charged_at)>=viewers.get(row.user_id)).map(row=>row.user_id));
  Object.assign(totals,{uniqueShopAccounts:viewers.size,uniqueCheckoutAccounts:clickers.size,uniquePaidAccounts:paid.size,matchedPaidShopAccounts:converted.size});
  const growth=await readPremiumGrowthMetrics({db,now,fromDay,toDay,products:PREMIUM_PRODUCTS});
  const access=operationGuard(ctx.user);if(!await premiumStmt(db,'SELECT 1 AS allowed WHERE '+access.sql,...access.args).first())h.fail(403,'OPERATIONAL_REQUIRED','この管理機能の利用資格が変更されました。');
  return {ok:true,days,fromDay,toDay,daily,totals,conversion:{definition:'集計期間中のショップ閲覧後に作成され、照合確認された有効な決済を持つ接続アカウントの割合。過去の決済を今回初めて観測しただけのものは含めません。',viewedAccounts:viewers.size,paidAfterViewAccounts:converted.size,rate:viewers.size?converted.size/viewers.size:null},retention:{definition:'初回ログイン報酬受取者の翌日再受取',cohortAccounts,returnedNextDay,rate:cohortAccounts?returnedNextDay/cohortAccounts:null,throughDay:new Date(base-2*86400000).toISOString().slice(0,10)},...growth,serverNow:new Date(now).toISOString()};
}
