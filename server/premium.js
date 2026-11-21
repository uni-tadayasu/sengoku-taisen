// Server-owned cosmetic purchases. Stripe snapshots are verified and reduced
// to immutable facts; game saves, currency, roles and writer leases are unused.
const PREMIUM_VERSION='2026-09-30.endive';
const PREMIUM_PRODUCTS=Object.freeze([
  {id:'gold-banner',slot:'nameplate',amount:480,mode:'payment',link:'plink_1UeEdvL3ZjL9QUmfKwCpWsEI',price:'price_1UeEcRL3ZjL9QUmf6snR2y5b',stripeProduct:'prod_VfZlNZd8yjCf4t',url:'https://buy.stripe.com/fZu6oI3Iwdcd5kn4Um9MY04'},
  {id:'moonlit-castle',slot:'town',amount:980,mode:'payment',link:'plink_1UeEg9L3ZjL9QUmf0Jiw1Inq',price:'price_1UeEfwL3ZjL9QUmfMZSVlcyg',stripeProduct:'prod_VfZpGdkUhwkdix',url:'https://buy.stripe.com/dRmdRa6UI2xz6or1Ia9MY05'},
  {id:'supporter',slot:'badge',amount:780,mode:'subscription',link:'plink_1UeEiNL3ZjL9QUmf5805BE1t',price:'price_1UeEiFL3ZjL9QUmfkthlf1SJ',stripeProduct:'prod_VfZr9Vag05JWrT',url:'https://buy.stripe.com/7sY8wQdj6dcdbILaeG9MY06'}
]);
const premiumStmt=(db,sql,...values)=>db.prepare(sql).bind(...values);
const premiumRows=result=>result?.results||[];
const premiumEmpty=()=>({nameplate:null,town:null,badge:null});
const premiumProduct=id=>PREMIUM_PRODUCTS.find(product=>product.id===id);
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
    queries.push(premiumStmt(db,`SELECT a.user_id,
      CASE WHEN a.nameplate='gold-banner' AND EXISTS(SELECT 1 FROM premium_grants g WHERE g.user_id=a.user_id AND g.product_id=a.nameplate AND g.starts_at<=? AND (g.expires_at IS NULL OR g.expires_at>?)) THEN a.nameplate END AS nameplate,
      CASE WHEN a.town='moonlit-castle' AND EXISTS(SELECT 1 FROM premium_grants g WHERE g.user_id=a.user_id AND g.product_id=a.town AND g.starts_at<=? AND (g.expires_at IS NULL OR g.expires_at>?)) THEN a.town END AS town,
      CASE WHEN a.badge='supporter' AND EXISTS(SELECT 1 FROM premium_grants g WHERE g.user_id=a.user_id AND g.product_id=a.badge AND g.starts_at<=? AND (g.expires_at IS NULL OR g.expires_at>?)) THEN a.badge END AS badge
      FROM premium_appearances a WHERE a.user_id IN (${page.map(()=>'?').join(',')}) AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=a.user_id AND b.active=1)`,now,now,now,now,now,now,...page));
  }
  const found=new Map();for(const result of await db.batch(queries))for(const row of premiumRows(result))found.set(row.user_id,{nameplate:row.nameplate,town:row.town,badge:row.badge});return found;
}
async function premiumSnapshot(ctx){
  const {db,user,now,env}=ctx,owned=await premiumOwnership(db,user.id,now),appearances=await premiumAppearanceRows(db,[user.id],now),appearance=appearances.get(user.id)||premiumEmpty(),ready=premiumReady(env),portalUrl=premiumPortal(env),subscriptionExists=await premiumSubscriptionExists(db,user.id,now);
  return {ok:true,ready,player:{id:user.id,name:user.name},products:PREMIUM_PRODUCTS.map(product=>{const value=owned.get(product.id)||{owned:false,expiresAt:null},blocked=product.mode==='subscription'&&subscriptionExists;return {id:product.id,owned:value.owned,equipped:appearance[product.slot]===product.id,expiresAt:value.expiresAt,canPurchase:ready&&!value.owned&&!blocked&&(product.mode!=='subscription'||!!portalUrl),purchaseBlockReason:blocked?'subscription_exists':value.owned?'owned':!ready?'preparing':product.mode==='subscription'&&!portalUrl?'portal_unavailable':null};}),appearance,portalUrl,serverNow:new Date(now).toISOString()};
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
  return {ok:true,holds:page.map((row,index)=>({scope:row.scope,objectId:row.object_id,revision:Number(row.revision),eventId:row.source_event_id,reason:row.reason,createdAt:new Date(Number(row.created_at)).toISOString(),updatedAt:new Date(Number(row.updated_at)).toISOString(),canRelease:PREMIUM_REVIEWABLE.includes(row.reason),players:premiumRows(players[index])})),nextCursor:found.length>limit?btoa(JSON.stringify([Number(last.updated_at),last.scope,last.object_id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null,serverNow:new Date(now).toISOString()};
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
  const access=h.accountCommitGuard(user),id=h.uid('prv_'),receiptGate='EXISTS(SELECT 1 FROM premium_reviews WHERE actor_id=? AND request_id=? AND id=?)';
  const result=await db.batch([
    premiumStmt(db,`INSERT INTO premium_reviews(id,actor_id,request_id,request_hash,scope,object_id,expected_revision,expected_event_id,reason,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,? FROM premium_blocks b WHERE b.scope=? AND b.object_id=? AND b.revision=? AND b.source_event_id=? AND b.reviewed_revision<b.revision AND b.reason IN ('refund_review','dispute_review','fraud_review') AND ${access.sql} AND EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?) ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING id`,id,user.id,requestId,digest,body.scope,body.objectId,body.expectedRevision,body.expectedEventId,normalized.reason,now,body.scope,body.objectId,body.expectedRevision,body.expectedEventId,...access.args,user.id),
    premiumStmt(db,`UPDATE premium_blocks SET reviewed_revision=revision WHERE scope=? AND object_id=? AND ${receiptGate}`,body.scope,body.objectId,user.id,requestId,id),
    premiumStmt(db,'SELECT * FROM premium_reviews WHERE actor_id=? AND request_id=?',user.id,requestId)
  ]);
  await h.requireAccountAccess(db,user);h.requireAdmin(await h.getUser(db,user.id));
  const review=premiumRows(result[2])[0];
  if(!review)h.fail(409,'PREMIUM_REVIEW_CHANGED','新しい通知で保留の状態が変わりました。一覧を更新し、Stripeで最新の状態を確認してください。');
  if(review.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の確認に使用されています。');
  return {ok:true,review:premiumReviewDto(review),idempotent:!premiumRows(result[0]).length};
}

export async function handlePremium(ctx){
  const {db,user,now,env,path,method,request,helpers:h}=ctx;
  if(path==='/admin/premium/reviews'){
    h.requireAdmin(user);
    if(method==='GET')return premiumReviewList(ctx);
    if(method==='POST')return premiumReviewRelease(ctx);
  }
  if(path==='/premium'&&method==='GET')return premiumSnapshot(ctx);
  if(path==='/premium/checkout'&&method==='POST'){
    const body=await h.readBody(request);premiumShape(body,['productId'],h);
    const product=premiumProduct(body.productId);if(!product)h.fail(400,'INVALID_PRODUCT','この商品は販売対象ではありません。');
    if(!premiumReady(env)||(product.mode==='subscription'&&!premiumPortal(env)))h.fail(503,'PREMIUM_NOT_READY','販売の準備中です。購入先の確認が終わるまでお待ちください。');
    await h.budget(db,'premium:checkout:'+user.id,20,60000,now);
    if(product.mode==='subscription'&&await premiumSubscriptionExists(db,user.id,now))h.fail(409,'SUBSCRIPTION_EXISTS','サポーター契約を確認中です。重複購入を避けるため、契約管理ページで更新・支払い・解約をご確認ください。');
    const owned=await premiumOwnership(db,user.id,now);if(owned.get(product.id)?.owned)h.fail(409,'ALREADY_OWNED','この商品は利用できます。外観の設定を確認してください。');
    const access=h.accountCommitGuard(user),reference=premiumReference();
    const result=await db.batch([
      premiumStmt(db,`INSERT INTO premium_orders(reference,user_id,product_id,created_at) SELECT ?,?,?,? WHERE ${access.sql} ON CONFLICT(user_id,product_id) DO NOTHING`,reference,user.id,product.id,now,...access.args),
      premiumStmt(db,'SELECT reference FROM premium_orders WHERE user_id=? AND product_id=?',user.id,product.id)
    ]);
    await h.requireAccountAccess(db,user);
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

// Only selected appearance keys are attached to public identity objects.
// Never traverse or add fields to imported game saves or financial records.
export async function resolvePremiumAppearances(db,payload,now){
  const refs=[],ids=new Set(),skip=new Set(['save','state','entitlements','appearance']);
  function visit(value){
    if(!value||typeof value!=='object')return;
    const id=value.playerId||value.userId||value.id;
    if(typeof value.name==='string'&&typeof id==='string'&&/^u_[a-f0-9]{32}$/.test(id)){refs.push({value,id});ids.add(id);}
    for(const [key,child]of Object.entries(value))if(!skip.has(key))visit(child);
  }
  visit(payload);if(!ids.size)return payload;
  const found=await premiumAppearanceRows(db,[...ids],now);
  for(const ref of refs)ref.value.appearance=found.get(ref.id)||premiumEmpty();
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
  const {db,now}=ctx,object=event.data.object,type=event.type,plan={db,now,event,nonce,statements:[],disposition:'accepted',reason:'verified_snapshot'};
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
    const session=premiumId(object.id,'cs_'),reference=object.client_reference_id,link=premiumId(object.payment_link,'plink_'),product=PREMIUM_PRODUCTS.find(item=>item.link===link);
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
  if(prior){if(prior.payload_hash!==digest)h.fail(409,'STRIPE_EVENT_CONFLICT','同じ通知番号の内容が一致しません。');return {ok:true,received:true,duplicate:true,disposition:prior.disposition};}
  const nonce=crypto.randomUUID(),plan=await premiumPlan(ctx,event,nonce),objectId=typeof event.data.object.id==='string'?event.data.object.id.slice(0,150):'';
  const result=await db.batch([
    premiumStmt(db,`INSERT INTO premium_events(event_id,event_type,object_id,payload_hash,disposition,reason,event_created,received_at,commit_token) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING RETURNING event_id`,event.id,event.type,objectId,digest,plan.disposition,plan.reason,premiumTimestamp(event.created),now,nonce),
    ...plan.statements,
    premiumStmt(db,'SELECT payload_hash,disposition FROM premium_events WHERE event_id=?',event.id)
  ]);
  const saved=premiumRows(result.at(-1))[0];if(saved?.payload_hash!==digest)h.fail(409,'STRIPE_EVENT_CONFLICT','同じ通知番号の内容が一致しません。');
  return {ok:true,received:true,duplicate:!premiumRows(result[0]).length,disposition:saved.disposition};
}
