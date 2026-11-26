import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {harness,settleFieldMarch} from './test-support.mjs';

// Real Worker + journal migrations + transactional SQLite. All payments below
// are signed local fixtures; outgoing fetch is disabled for the whole suite.
const API_VERSION='2026-09-30.endive';
const SECRET='whsec_local_premium_fixture_not_a_real_secret';
const WEBHOOK='/premium/stripe/webhook';
const PRODUCTS={
  'gold-banner':{amount:480,mode:'payment',slot:'nameplate',link:'plink_1UeEdvL3ZjL9QUmfKwCpWsEI',price:'price_1UeEcRL3ZjL9QUmf6snR2y5b',product:'prod_VfZlNZd8yjCf4t',url:'https://buy.stripe.com/fZu6oI3Iwdcd5kn4Um9MY04'},
  'moonlit-castle':{amount:980,mode:'payment',slot:'town',link:'plink_1UeEg9L3ZjL9QUmf0Jiw1Inq',price:'price_1UeEfwL3ZjL9QUmfMZSVlcyg',product:'prod_VfZpGdkUhwkdix',url:'https://buy.stripe.com/dRmdRa6UI2xz6or1Ia9MY05'},
  supporter:{amount:780,mode:'subscription',slot:'badge',link:'plink_1UeEiNL3ZjL9QUmf5805BE1t',price:'price_1UeEiFL3ZjL9QUmfkthlf1SJ',product:'prod_VfZr9Vag05JWrT',url:'https://buy.stripe.com/7sY8wQdj6dcdbILaeG9MY06'}
};
const EXTRA_PRODUCTS={"vermilion-banner":{"slot":"nameplate","amount":580,"mode":"payment","link":"plink_1Ufq0iL3ZjL9QUmfIWm7MlvY","price":"price_1Ufq0OL3ZjL9QUmf9LJWwrDP","url":"https://buy.stripe.com/aFa8wQ3Iw5JL1479aC9MY07","product":"prod_sengokuvs_20261126_vermilion_banner"},"silver-banner":{"slot":"nameplate","amount":580,"mode":"payment","link":"plink_1Ufq0jL3ZjL9QUmfnDoaBTMU","price":"price_1Ufq0VL3ZjL9QUmfZWpAzq76","url":"https://buy.stripe.com/aFacN65QE4FHeUXaeG9MY08","product":"prod_sengokuvs_20261126_silver_banner"},"phoenix-medallion":{"slot":"badge","amount":780,"mode":"payment","link":"plink_1Ufq0jL3ZjL9QUmfWThYEpqL","price":"price_1Ufq0WL3ZjL9QUmfgJALQNy2","url":"https://buy.stripe.com/8x2aEY5QE5JL00386y9MY09","product":"prod_sengokuvs_20261126_phoenix_medallion"},"sakura-town":{"slot":"town","amount":980,"mode":"payment","link":"plink_1Ufq0kL3ZjL9QUmfWmqjwuB7","price":"price_1Ufq0XL3ZjL9QUmfZn6HpE02","url":"https://buy.stripe.com/3cI6oIfre5JLeUX5Yq9MY0a","product":"prod_sengokuvs_20261126_sakura_town"},"snow-town":{"slot":"town","amount":980,"mode":"payment","link":"plink_1Ufq0lL3ZjL9QUmfn5BGoLuI","price":"price_1Ufq0XL3ZjL9QUmfT3rgvT9j","url":"https://buy.stripe.com/28EaEYfrec893cfeuW9MY0b","product":"prod_sengokuvs_20261126_snow_town"}};
const configFor=key=>PRODUCTS[key]||EXTRA_PRODUCTS[key];
const copy=value=>JSON.parse(JSON.stringify(value));
const id=prefix=>prefix+crypto.randomUUID().replaceAll('-','');
const unix=h=>Math.floor(h.now/1000);
const post=(actor,body,expected=200)=>({method:'POST',token:actor?.token,body,expected});
const premium=async(h,actor)=>(await h.api('/premium?catalog=3',{token:actor.token})).data;
const product=(value,key)=>value.products.find(item=>item.id===key);
const equip=(h,actor,key,slot=configFor(key)?.slot,expected=200)=>h.api('/premium/appearance?catalog=3',{method:'PUT',token:actor.token,body:{productId:key,slot},expected});
const tables=h=>Object.fromEntries(h.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'premium_%' ORDER BY name").all().map(({name})=>[name,h.sql.prepare('SELECT * FROM '+name).all().map(row=>JSON.stringify(row)).sort()]));
const savedRows=h=>h.sql.prepare('SELECT * FROM player_saves ORDER BY user_id').all();
const grants=(h,actor)=>h.sql.prepare('SELECT * FROM premium_grants WHERE user_id=?').all(actor.user.id);

function event(h,type,object,overrides={}){
  return {id:id('evt_'),object:'event',api_version:API_VERSION,created:unix(h),livemode:true,type,data:{object},...overrides};
}
function signature(raw,timestamp,secret=SECRET){
  return 't='+timestamp+',v1='+createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex');
}
function deliver(h,value,{expected=200,raw=JSON.stringify(value),timestamp=unix(h),header,secret=SECRET,...options}={}){
  return h.api(WEBHOOK,{method:'POST',rawBody:raw,origin:null,headers:{'Stripe-Signature':header??signature(raw,timestamp,secret)},expected,...options});
}
async function order(h,actor,key){
  const result=(await h.api('/premium/checkout',post(actor,{productId:key}))).data;
  assert.equal(result.ok,true);assert.equal(result.productId,key);
  const url=new URL(result.url),expected=new URL(configFor(key).url);
  assert.equal(url.origin,expected.origin);assert.equal(url.pathname,expected.pathname);
  assert.deepEqual([...url.searchParams.keys()],['client_reference_id']);
  const reference=url.searchParams.get('client_reference_id');assert.match(reference,/^[A-Za-z0-9_-]{24,200}$/);
  assert(!reference.includes(actor.user.id));
  return {reference,result};
}
function purchase(h,key,reference,{subscription=id('sub_'),customer=id('cus_'),start=unix(h),end=start+30*86400}={}){
  const config=configFor(key),session=id('cs_live_'),intent=id('pi_'),chargeId=id('ch_'),invoice=id('in_');
  const checkout={id:session,object:'checkout.session',livemode:true,created:unix(h),payment_link:config.link,client_reference_id:reference,mode:config.mode,amount_total:config.amount,currency:'jpy',payment_status:'paid',status:'complete',payment_intent:config.mode==='payment'?intent:null,subscription:config.mode==='subscription'?subscription:null,invoice:config.mode==='subscription'?invoice:null,customer:config.mode==='subscription'?customer:null};
  const charge={id:chargeId,object:'charge',livemode:true,created:unix(h),payment_intent:intent,amount:config.amount,amount_captured:config.amount,amount_refunded:0,currency:'jpy',paid:true,captured:true,refunded:false,status:'succeeded'};
  const bill={id:invoice,object:'invoice',livemode:true,created:unix(h),customer,currency:'jpy',status:'paid',billing_reason:'subscription_cycle',amount_due:780,amount_paid:780,amount_remaining:0,amount_overpaid:0,subtotal:780,total:780,parent:{type:'subscription_details',subscription_details:{subscription}},lines:{object:'list',has_more:false,data:[{id:id('il_'),object:'line_item',amount:780,subtotal:780,currency:'jpy',quantity:1,quantity_decimal:'1',discount_amounts:[],taxes:[],parent:{type:'subscription_item_details',subscription_item_details:{subscription,subscription_item:id('si_'),proration:false}},pricing:{type:'price_details',price_details:{price:PRODUCTS.supporter.price,product:PRODUCTS.supporter.product},unit_amount_decimal:'780'},period:{start,end}}]},period_start:start-86400,period_end:start,status_transitions:{paid_at:unix(h)}};
  const payment={id:id('inpay_'),object:'invoice_payment',livemode:true,created:unix(h),invoice,amount_paid:780,amount_requested:780,currency:'jpy',status:'paid',is_default:true,payment:{type:'payment_intent',payment_intent:intent},status_transitions:{paid_at:unix(h),canceled_at:null}};
  return {key,reference,session,intent,chargeId,subscription,customer,invoice,start,end,checkout,charge,bill,payment};
}
const notices=(h,p)=>({checkout:event(h,'checkout.session.completed',p.checkout),charge:event(h,'charge.succeeded',p.charge),invoice:event(h,'invoice.paid',p.bill),payment:event(h,'invoice_payment.paid',p.payment)});
async function complete(h,p,sequence=p.key==='supporter'?['checkout','invoice','payment','charge']:['checkout','charge']){
  const values=notices(h,p);for(const key of sequence)await deliver(h,values[key]);return values;
}
async function savePlayer(h,actor,save=h.fresh()){
  actor.deviceId=actor.user.id+'-premium-fixture';
  const lease=(await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}))).data;
  save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
  return(await h.api('/sync',{method:'PUT',token:actor.token,body:{deviceId:actor.deviceId,revision:lease.revision,save}})).data;
}
async function administrator(h){const actor=await h.session('支払検証の運営');await h.api('/admin/claim',post(actor,{key:h.env.SENGOKU_ADMIN_KEY}));return actor;}
async function moderate(h,admin,target,action){
  const revision=Number(h.sql.prepare('SELECT revision FROM player_bans WHERE user_id=?').get(target.user.id)?.revision||0);
  return h.api('/admin/moderation',post(admin,{targetPlayerId:target.user.id,action,requestId:crypto.randomUUID(),expectedRevision:revision,...(action==='ban'?{reason:'ローカル支払検証'}:{})}));
}
const reviews=async(h,admin,query='')=>(await h.api('/admin/premium/reviews'+query,{token:admin.token})).data;
const reviewBody=hold=>({scope:hold.scope,objectId:hold.objectId,expectedRevision:hold.revision,expectedEventId:hold.eventId,reason:'Stripeの記録で対象の決済を確認したローカル検証です。',requestId:crypto.randomUUID()});
const release=(h,admin,body,expected=200)=>h.api('/admin/premium/reviews',post(admin,body,expected));
function warning(h,p,extra={}){return event(h,'radar.early_fraud_warning.created',{id:id('issfr_'),object:'radar.early_fraud_warning',charge:p.chargeId,payment_intent:p.intent,actionable:true,fraud_type:'unauthorized_use_of_card',...extra});}

let checks=0,failed=0,calls=0,externalRequests=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{externalRequests++;throw Error('External requests are forbidden in premium fixtures');};
async function scope(name,run){
  const h=harness();h.env.STRIPE_WEBHOOK_SECRET=SECRET;h.env.SENGOKU_PREMIUM_ENABLED='true';h.env.SENGOKU_STRIPE_PORTAL_URL='https://billing.stripe.com/p/login/fixturePremiumTestOnly123';
  try{await run(h);checks++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name);console.error(error);}finally{calls+=h.calls;h.close();}
}

try{
await scope('readiness and account authentication are required before issuing a purchase link',async h=>{
  const actor=await h.session('購入する領主');
  for(const [path,method,body]of [['/premium','GET',undefined],['/premium/checkout','POST',{productId:'gold-banner'}],['/premium/appearance','PUT',{slot:'nameplate',productId:'gold-banner'}]])await h.api(path,{method,body,expected:401});
  for(const value of [undefined,'false',true]){
    if(value===undefined)delete h.env.SENGOKU_PREMIUM_ENABLED;else h.env.SENGOKU_PREMIUM_ENABLED=value;
    const current=await premium(h,actor);assert.equal(current.ready,false);assert(current.products.every(p=>!p.canPurchase));
    const denied=await h.api('/premium/checkout',post(actor,{productId:'gold-banner'},null));assert(denied.response.status>=400);
  }
  h.env.SENGOKU_PREMIUM_ENABLED='true';delete h.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await premium(h,actor)).ready,false);
  await deliver(h,event(h,'unhandled.fixture',{id:id('fixture_')}),{expected:503});
  h.env.STRIPE_WEBHOOK_SECRET=SECRET;
  const current=await premium(h,actor);assert.equal(current.player.id,actor.user.id);assert.deepEqual(current.player.evaluation,actor.user.evaluation);assert.equal(current.ready,true);assert.equal(current.serverNow,new Date(h.now).toISOString());
  assert.deepEqual(current.products.map(p=>p.id).sort(),[...Object.keys(PRODUCTS),...Object.keys(EXTRA_PRODUCTS)].sort());assert(current.products.every(p=>!p.owned));
});

await scope('legacy catalog clients retain the three-product response while the current release receives all eight',async h=>{
  const actor=await h.session('旧版を使う領主');
  const legacy=(await h.api('/premium',{token:actor.token})).data;
  assert.deepEqual(legacy.products.map(item=>item.id),Object.keys(PRODUCTS));
  const p=purchase(h,'gold-banner',(await order(h,actor,'gold-banner')).reference);await complete(h,p);await equip(h,actor,'gold-banner');
  const owned=(await h.api('/premium',{token:actor.token})).data;
  assert.equal(owned.products.length,3);assert.equal(product(owned,'gold-banner').owned,true);assert.equal(owned.appearance.nameplate,'gold-banner');
  assert.equal((await premium(h,actor)).products.length,8);
});

await scope('webhook verification checks the raw body, signature age, live mode and supported snapshot version',async h=>{
  const valid=event(h,'unhandled.fixture',{id:id('fixture_'),object:'fixture'}),raw=JSON.stringify(valid),before=tables(h);
  for(const options of [{header:''},{header:'t='+unix(h)+',v1=bad'},{secret:'whsec_wrong_fixture'},{timestamp:unix(h)-301},{timestamp:unix(h)+301},{raw:raw+' ',header:signature(raw,unix(h))}])await deliver(h,valid,{expected:400,...options});
  assert.deepEqual(tables(h),before);
  const oversized=JSON.stringify({...valid,padding:'x'.repeat(512*1024)}),large=await deliver(h,valid,{raw:oversized,expected:null});assert(large.response.status>=400&&large.response.status<500);assert.deepEqual(tables(h),before);
  for(const extra of [{livemode:false},{api_version:'2025-06-30.basil'}]){
    const received=await deliver(h,{...valid,id:id('evt_'),...extra},{expected:null});assert.equal(received.data.ok,true);assert.equal(received.data.disposition,'quarantined');
  }
  const ignored=(await deliver(h,valid)).data;assert.equal(ignored.received,true);assert.equal(ignored.disposition,'ignored');assert.equal(ignored.duplicate,false);
  assert.equal((await deliver(h,valid)).data.duplicate,true);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM premium_grants').get().n,0);
});

await scope('checkout references are opaque, account-bound, product-bound and stable across linked devices',async h=>{
  const a=await h.session('注文する領主'),b=await h.session('別の注文主');
  const first=await order(h,a,'gold-banner'),again=await order(h,a,'gold-banner');assert.equal(first.reference,again.reference);
  assert.notEqual((await order(h,b,'gold-banner')).reference,first.reference);assert.notEqual((await order(h,a,'moonlit-castle')).reference,first.reference);
  const pair=(await h.api('/devices/pair-code',post(a,{}))).data,linked=(await h.api('/devices/link',post(null,{code:pair.code,deviceName:'支払用の別端末'}))).data;
  assert.equal(linked.user.id,a.user.id);assert.equal((await order(h,linked,'gold-banner')).reference,first.reference);
  const before=tables(h);
  for(const body of [{productId:'unknown'},{productId:'gold-banner',userId:b.user.id},{productId:'gold-banner',price:1},{productId:'gold-banner',url:'https://other.example.test/'},{productId:null},{}])await h.api('/premium/checkout',post(a,body,400));
  assert.deepEqual(tables(h),before);
  const visible=JSON.stringify(await premium(h,a));for(const forbidden of [SECRET,a.token,first.reference,'commit_token','payload_hash'])assert(!visible.includes(forbidden));
});

await scope('one-time ownership needs matching paid checkout and captured charge and never rewrites game saves',async h=>{
  const a=await h.session('旗印の購入者'),b=await h.session('旗印を持たない領主');await savePlayer(h,a);await savePlayer(h,b);
  const before=savedRows(h),{reference}=await order(h,a,'gold-banner'),p=purchase(h,'gold-banner',reference),events=notices(h,p);
  await deliver(h,events.checkout);assert.equal(product(await premium(h,a),'gold-banner').owned,false);
  await deliver(h,events.charge);assert.equal(product(await premium(h,a),'gold-banner').owned,true);assert.equal(product(await premium(h,b),'gold-banner').owned,false);
  await equip(h,a,'gold-banner');assert.equal((await premium(h,a)).appearance.nameplate,'gold-banner');
  const forbidden=await equip(h,b,'gold-banner','nameplate',null);assert(forbidden.response.status>=400);
  await equip(h,a,'gold-banner','town',400);
  await h.api('/premium/appearance',{method:'PUT',token:a.token,body:{slot:'nameplate',productId:null}});assert.equal((await premium(h,a)).appearance.nameplate,null);
  assert.deepEqual(savedRows(h),before,'Webhook, private reads and equipment leave all save bytes, revisions and leases unchanged');
  assert.equal(grants(h,a).length,1);
});

await scope('signed mismatches and incomplete checkout snapshots cannot grant another product or account',async h=>{
  const actor=await h.session('厳密な注文主'),{reference}=await order(h,actor,'gold-banner');
  const bad=[p=>p.checkout.amount_total=1,p=>p.checkout.currency='usd',p=>p.checkout.payment_link=PRODUCTS['moonlit-castle'].link,p=>p.checkout.mode='subscription',p=>p.checkout.client_reference_id='unknown_reference_0123456789012345',p=>delete p.checkout.client_reference_id,p=>p.checkout.payment_status='no_payment_required',p=>p.checkout.payment_status='unpaid',p=>p.checkout.payment_intent=null,p=>p.checkout.object='payment_intent',p=>p.charge.captured=false,p=>p.charge.paid=false,p=>p.charge.amount=481];
  for(const change of bad){const p=purchase(h,'gold-banner',reference);change(p);await complete(h,p);assert.equal(product(await premium(h,actor),'gold-banner').owned,false);}
  const p=purchase(h,'gold-banner',reference);await complete(h,p);assert.equal(product(await premium(h,actor),'gold-banner').owned,true,'A fresh correct payment is unaffected by unrelated rejected snapshots');
  const conflict=copy(p.checkout);conflict.amount_total=1;await deliver(h,event(h,'checkout.session.completed',conflict));assert.equal(product(await premium(h,actor),'gold-banner').owned,false,'A conflicting snapshot for the same session fails closed');
});

await scope('delayed-payment completion upgrades one session exactly once without trusting an unpaid completion',async h=>{
  const actor=await h.session('後日決済の領主'),{reference}=await order(h,actor,'moonlit-castle'),p=purchase(h,'moonlit-castle',reference),unpaid={...p.checkout,payment_status:'unpaid'};
  await deliver(h,event(h,'checkout.session.completed',unpaid));await deliver(h,event(h,'charge.succeeded',p.charge));assert.equal(product(await premium(h,actor),'moonlit-castle').owned,false);
  const paid=event(h,'checkout.session.async_payment_succeeded',p.checkout);await deliver(h,paid);assert.equal(product(await premium(h,actor),'moonlit-castle').owned,true);
  await deliver(h,paid);await deliver(h,event(h,'checkout.session.completed',unpaid));await deliver(h,event(h,'checkout.session.async_payment_succeeded',p.checkout));
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM premium_sessions WHERE session_id=?').get(p.session).n,1);assert.equal(grants(h,actor).length,1);assert.equal(product(await premium(h,actor),'moonlit-castle').owned,true);
});

await scope('concurrent retries, repeated resource events and a lost response remain idempotent',async h=>{
  const actor=await h.session('通知再送の領主'),{reference}=await order(h,actor,'gold-banner'),p=purchase(h,'gold-banner',reference),events=notices(h,p);
  await deliver(h,events.charge);
  const results=await Promise.all([deliver(h,events.checkout),deliver(h,events.checkout)]);assert(results.some(r=>r.data.duplicate));
  await deliver(h,event(h,'checkout.session.completed',p.checkout));assert.equal(grants(h,actor).length,1);
  const unchanged=tables(h),conflicting=copy(events.checkout);conflicting.data.object.client_reference_id='pr_'+'f'.repeat(64);
  assert.equal((await deliver(h,conflicting,{expected:409})).data.error.code,'STRIPE_EVENT_CONFLICT');assert.deepEqual(tables(h),unchanged,'An event ID cannot be replayed with a different signed body');
  const p2=purchase(h,'moonlit-castle',(await order(h,actor,'moonlit-castle')).reference);await deliver(h,event(h,'charge.succeeded',p2.charge));
  let lost=false;h.afterBatch=statements=>{if(statements.some(s=>/premium_events/.test(s.sql))){h.afterBatch=null;lost=true;throw Error('Fixture response loss after committed payment');}};
  const second=event(h,'checkout.session.completed',p2.checkout);await deliver(h,second,{expected:500});assert(lost);
  assert.equal((await deliver(h,second)).data.duplicate,true);assert.equal(product(await premium(h,actor),'moonlit-castle').owned,true);assert.equal(grants(h,actor).filter(g=>g.product_id==='moonlit-castle').length,1);
});

await scope('a failed D1 transaction rolls the event receipt and payment fact back together',async h=>{
  const actor=await h.session('原子的な決済'),{reference}=await order(h,actor,'gold-banner'),p=purchase(h,'gold-banner',reference);await deliver(h,event(h,'charge.succeeded',p.charge));
  h.sql.exec("CREATE TRIGGER fixture_premium_failure BEFORE INSERT ON premium_sessions BEGIN SELECT RAISE(ABORT,'fixture payment rollback'); END;");
  const before=tables(h),value=event(h,'checkout.session.completed',p.checkout);await deliver(h,value,{expected:500});assert.deepEqual(tables(h),before);
  h.sql.exec('DROP TRIGGER fixture_premium_failure');await deliver(h,value);assert.equal(product(await premium(h,actor),'gold-banner').owned,true);assert.equal(grants(h,actor).length,1);
});

await scope('refund, dispute and fraud-warning tombstones work before or after payment and never auto-resurrect it',async h=>{
  const actor=await h.session('取消を反映する領主'),{reference}=await order(h,actor,'gold-banner');
  for(const kind of ['refund','dispute','fraud'])for(const first of [true,false]){
    const p=purchase(h,'gold-banner',reference);
    const object=kind==='refund'?{id:id('re_'),object:'refund',charge:p.chargeId,payment_intent:first?null:p.intent,amount:480,currency:'jpy',status:'succeeded'}:kind==='dispute'?{id:id('dp_'),object:'dispute',charge:p.chargeId,payment_intent:p.intent,amount:480,currency:'jpy',status:'needs_response'}:{id:id('issfr_'),object:'radar.early_fraud_warning',charge:p.chargeId,payment_intent:p.intent,actionable:true,fraud_type:'unauthorized_use_of_card'};
    const type=kind==='refund'?'refund.created':kind==='dispute'?'charge.dispute.created':'radar.early_fraud_warning.created';
    if(first)await deliver(h,event(h,type,object));await complete(h,p);if(!first)await deliver(h,event(h,type,object));
    assert.equal(product(await premium(h,actor),'gold-banner').owned,false,kind+' first='+first);
    await complete(h,p);assert.equal(product(await premium(h,actor),'gold-banner').owned,false,'Late paid snapshots cannot erase a tombstone');
    if(kind==='dispute')await deliver(h,event(h,'charge.dispute.closed',{...object,status:'won'}));
    if(kind==='fraud')await deliver(h,event(h,'radar.early_fraud_warning.updated',{...object,actionable:false}));
    assert.equal(product(await premium(h,actor),'gold-banner').owned,false);
  }
  const fresh=purchase(h,'gold-banner',reference);await complete(h,fresh);assert.equal(product(await premium(h,actor),'gold-banner').owned,true,'A new separately paid purchase is not blocked by an earlier payment cancellation');
});

await scope('subscription invoices, payment allocations and charges correlate regardless of delivery order',async h=>{
  const sequences=[['invoice','payment','charge','checkout'],['charge','checkout','invoice','payment'],['payment','invoice','checkout','charge'],['checkout','payment','charge','invoice']];
  for(let i=0;i<sequences.length;i++){
    h.resetRates();const actor=await h.session('順不同の月額'+i),{reference}=await order(h,actor,'supporter'),p=purchase(h,'supporter',reference),values=notices(h,p);
    for(let step=0;step<sequences[i].length;step++){
      await deliver(h,values[sequences[i][step]]);
      assert.equal(product(await premium(h,actor),'supporter').owned,step===3,'All four matching facts are required');
    }
    const owned=product(await premium(h,actor),'supporter');assert.equal(owned.expiresAt,new Date(p.end*1000).toISOString());assert.equal(owned.canPurchase,false);
    await equip(h,actor,'supporter');assert.equal((await premium(h,actor)).appearance.badge,'supporter');
  }
});

await scope('subscription quantity precision, complete line data, permitted price and exact payment are checked',async h=>{
  const actor=await h.session('月額条件を守る領主'),{reference}=await order(h,actor,'supporter');
  const bad=[p=>p.bill.lines.has_more=true,p=>p.bill.lines.data[0].pricing.price_details.price='price_unknown',p=>p.bill.lines.data[0].quantity_decimal='1.5',p=>p.bill.lines.data[0].quantity=2,p=>p.bill.lines.data[0].parent.subscription_item_details.proration=true,p=>p.bill.lines.data[0].parent.subscription_item_details.subscription=id('sub_'),p=>delete p.bill.lines.data[0].period,p=>p.bill.lines.data[0].period.end=p.end+335*86400,p=>p.bill.amount_paid=779,p=>p.payment.amount_paid=779,p=>p.payment.payment.type='payment_record',p=>p.charge.captured=false,p=>p.bill.customer=id('cus_')];
  for(const change of bad){const p=purchase(h,'supporter',reference);change(p);await complete(h,p);assert.equal(product(await premium(h,actor),'supporter').owned,false);}
  const p=purchase(h,'supporter',reference);await complete(h,p);assert.equal(product(await premium(h,actor),'supporter').owned,true);
});

await scope('paid subscription coverage follows service periods, exact expiry and actual cancellation, not game time',async h=>{
  const actor=await h.session('月額の期間を守る領主');await savePlayer(h,actor);
  const {reference}=await order(h,actor,'supporter'),p=purchase(h,'supporter',reference);await complete(h,p);await equip(h,actor,'supporter');
  const row=h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(actor.user.id),game=JSON.parse(row.save_json);game.state.turn+=999999;game.state.premium={supporter:true,expiresAt:'2999-01-01T00:00:00.000Z'};h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(game),actor.user.id);
  const reserved={id:p.subscription,object:'subscription',customer:p.customer,status:'active',cancel_at_period_end:true,cancel_at:p.end,canceled_at:unix(h),ended_at:null};await deliver(h,event(h,'customer.subscription.updated',reserved));
  h.now=p.end*1000-1;assert.equal(product(await premium(h,actor),'supporter').owned,true);
  h.now=p.end*1000;const expired=await premium(h,actor);assert.equal(product(expired,'supporter').owned,false);assert.equal(expired.appearance.badge,null);
  assert.equal(product(expired,'supporter').canPurchase,false,'An unpaid renewal does not authorize a second active subscription');assert(expired.portalUrl);
  await h.api('/premium/checkout',post(actor,{productId:'supporter'},409));
  await deliver(h,event(h,'invoice.payment_failed',{...p.bill,id:id('in_'),status:'open',amount_paid:0,amount_remaining:780}));
  assert.equal(product(await premium(h,actor),'supporter').canPurchase,false,'Failure or delay of renewal keeps the original subscription binding');
  const renewed=purchase(h,'supporter',reference,{subscription:p.subscription,customer:p.customer,start:p.end,end:p.end+31*86400});
  await complete(h,renewed,['invoice','payment','charge']);assert.equal(product(await premium(h,actor),'supporter').owned,true);
  const actualEnd=unix(h)+120;h.now=actualEnd*1000;await deliver(h,event(h,'customer.subscription.deleted',{...reserved,status:'canceled',cancel_at_period_end:false,ended_at:actualEnd}));
  assert.equal(product(await premium(h,actor),'supporter').owned,false);
  await complete(h,renewed,['invoice','payment','charge']);assert.equal(product(await premium(h,actor),'supporter').owned,false,'An old paid event cannot undo actual subscription termination');
  assert.equal(product(await premium(h,actor),'supporter').canPurchase,true,'An actual ended subscription permits a new explicit purchase');
  assert.equal((await order(h,actor,'supporter')).reference,reference);
});

await scope('imported saves cannot create rights or remove legitimate ownership and public responses reveal no billing identifiers',async h=>{
  const a=await h.session('正規の所有者'),b=await h.session('偽の保存の領主');
  const p=purchase(h,'gold-banner',(await order(h,a,'gold-banner')).reference);await complete(h,p);await equip(h,a,'gold-banner');
  const imported=h.fresh();imported.premium={owned:['gold-banner','supporter']};imported.state.premium={owned:['gold-banner','supporter']};imported.state.appearance={nameplate:'gold-banner',badge:'supporter'};imported.state.entitlements={goldBanner:true,supporter:true};
  await savePlayer(h,b,imported);assert((await premium(h,b)).products.every(item=>!item.owned));
  await savePlayer(h,a,h.fresh());assert.equal(product(await premium(h,a),'gold-banner').owned,true);
  const publicData=(await h.api('/me',{token:a.token})).data;assert.equal(publicData.user.appearance?.nameplate,'gold-banner');
  const text=JSON.stringify(publicData);for(const forbidden of [p.intent,p.session,p.chargeId,p.reference,SECRET,a.token,'payload_hash','commit_token'])assert(!text.includes(forbidden));
});

await scope('BAN blocks player operations while financial notifications and later revocation remain recorded',async h=>{
  const admin=await administrator(h),actor=await h.session('停止中の支払者');await savePlayer(h,actor);
  const p=purchase(h,'gold-banner',(await order(h,actor,'gold-banner')).reference);await moderate(h,admin,actor,'ban');
  await h.api('/premium',{token:actor.token,expected:403});await h.api('/premium/checkout',post(actor,{productId:'gold-banner'},403));await equip(h,actor,'gold-banner','nameplate',403);
  const before=savedRows(h);await complete(h,p);assert.deepEqual(savedRows(h),before);
  await moderate(h,admin,actor,'unban');assert.equal(product(await premium(h,actor),'gold-banner').owned,true);
  await moderate(h,admin,actor,'ban');await deliver(h,event(h,'refund.created',{id:id('re_'),object:'refund',charge:p.chargeId,payment_intent:p.intent,amount:480,currency:'jpy',status:'succeeded'}));
  await moderate(h,admin,actor,'unban');assert.equal(product(await premium(h,actor),'gold-banner').owned,false);
});

await scope('an in-flight checkout or equipment request cannot survive a BAN and unban access-epoch change',async h=>{
  const admin=await administrator(h),actor=await h.session('権限の切替中の購入者');
  const p=purchase(h,'gold-banner',(await order(h,actor,'gold-banner')).reference);await complete(h,p);
  let checkoutHook=false;
  h.beforeBatch=async statements=>{if(statements.some(s=>/INSERT INTO premium_orders/.test(s.sql))){h.beforeBatch=null;checkoutHook=true;await moderate(h,admin,actor,'ban');await moderate(h,admin,actor,'unban');}};
  const changed=await h.api('/premium/checkout',post(actor,{productId:'moonlit-castle'},409));assert(checkoutHook);assert.equal(changed.data.error.code,'ACCOUNT_ACCESS_CHANGED');
  assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM premium_orders WHERE user_id=? AND product_id='moonlit-castle'").get(actor.user.id).n,0);
  let equipHook=false;
  h.beforeStatement=async sql=>{if(/INSERT INTO premium_appearances/.test(sql)){h.beforeStatement=null;equipHook=true;await moderate(h,admin,actor,'ban');await moderate(h,admin,actor,'unban');}};
  const equipChanged=await equip(h,actor,'gold-banner','nameplate',409);assert(equipHook);assert.equal(equipChanged.data.error.code,'ACCOUNT_ACCESS_CHANGED');
  const current=await premium(h,actor);assert.equal(product(current,'gold-banner').owned,true);assert.equal(current.appearance.nameplate,null);
});

await scope('only the operator can review soft holds and hard refund facts cannot be weakened or released',async h=>{
  const admin=await administrator(h),actor=await h.session('警告確認対象'),staff=await h.session('確認できないスタッフ');
  const reviewSave=h.fresh();reviewSave.state.prestige=10000;const saved=await savePlayer(h,actor,reviewSave),evaluation=saved.user.evaluation;assert(evaluation.score>0);assert.deepEqual((await premium(h,actor)).player.evaluation,evaluation);
  await h.api('/admin/staff',post(admin,{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}));
  const p=purchase(h,'gold-banner',(await order(h,actor,'gold-banner')).reference);await complete(h,p);await deliver(h,warning(h,p));
  const first=await reviews(h,admin,'?limit=1');assert.equal(first.holds.length,1);assert(first.nextCursor);
  const second=await reviews(h,admin,'?limit=1&cursor='+encodeURIComponent(first.nextCursor));assert.equal(second.holds.length,1);
  const holds=[...first.holds,...second.holds];assert.equal(new Set(holds.map(row=>row.scope+row.objectId)).size,2);
  assert(holds.every(row=>row.canRelease&&row.reason==='fraud_review'&&row.players.some(player=>player.id===actor.user.id)));
  for(const hold of holds)assert.deepEqual(hold.players.find(player=>player.id===actor.user.id).evaluation,evaluation);
  await h.api('/admin/premium/reviews',{expected:401});await release(h,null,reviewBody(holds[0]),401);
  for(const other of [actor,staff]){await h.api('/admin/premium/reviews',{token:other.token,expected:403});await release(h,other,reviewBody(holds[0]),403);}
  await release(h,admin,{...reviewBody(holds[0]),reason:'短い'},400);
  await release(h,admin,reviewBody(holds[0]));assert.equal(product(await premium(h,actor),'gold-banner').owned,false,'Both independently recorded risk links must be resolved');
  await release(h,admin,reviewBody(holds[1]));assert.equal(product(await premium(h,actor),'gold-banner').owned,true);
  await deliver(h,event(h,'refund.created',{id:id('re_'),object:'refund',charge:p.chargeId,payment_intent:p.intent,amount:480,currency:'jpy',status:'succeeded'}));
  await deliver(h,warning(h,p));
  const hard=(await reviews(h,admin)).holds;assert.equal(hard.length,2);assert(hard.every(row=>!row.canRelease));
  for(const hold of hard)assert.equal((await release(h,admin,reviewBody(hold),403)).data.error.code,'PREMIUM_REVIEW_FORBIDDEN');
  assert.equal(product(await premium(h,actor),'gold-banner').owned,false,'A later soft warning cannot downgrade a known completed refund');
  const castle=purchase(h,'moonlit-castle',(await order(h,actor,'moonlit-castle')).reference);await complete(h,castle);
  const dispute={id:id('dp_'),object:'dispute',charge:castle.chargeId,payment_intent:castle.intent,amount:980,currency:'jpy',status:'lost'};
  await deliver(h,event(h,'charge.dispute.closed',dispute));await deliver(h,event(h,'charge.dispute.updated',{...dispute,status:'won'}));
  const lost=(await reviews(h,admin)).holds.filter(hold=>[castle.intent,castle.chargeId].includes(hold.objectId));assert.equal(lost.length,2);assert(lost.every(hold=>!hold.canRelease));
  for(const hold of lost)await release(h,admin,reviewBody(hold),403);
  assert.equal(product(await premium(h,actor),'moonlit-castle').owned,false);
});

await scope('an old review replay never clears a newer risk and duplicate delivery does not recreate a reviewed hold',async h=>{
  const admin=await administrator(h),actor=await h.session('再確認の対象');
  const p=purchase(h,'gold-banner',(await order(h,actor,'gold-banner')).reference);await complete(h,p);
  const risk=warning(h,p);await deliver(h,risk);const original=(await reviews(h,admin)).holds,bodies=original.map(reviewBody);
  for(const body of bodies)await release(h,admin,body);
  assert.equal(product(await premium(h,actor),'gold-banner').owned,true);
  assert.equal((await deliver(h,risk)).data.duplicate,true);assert.deepEqual((await reviews(h,admin)).holds,[]);
  const later=event(h,'radar.early_fraud_warning.updated',{...risk.data.object,actionable:false});await deliver(h,later);
  const fresh=(await reviews(h,admin)).holds;assert.equal(fresh.length,2);assert(fresh.every(hold=>hold.revision===2&&hold.eventId===later.id));
  for(const body of bodies)assert.equal((await release(h,admin,body)).data.idempotent,true);
  assert.equal(product(await premium(h,actor),'gold-banner').owned,false);assert.equal((await reviews(h,admin)).holds.length,2);
  await release(h,admin,{...bodies[0],reason:'同じ操作番号で内容を変える不正な検証要求です。'},409);
  assert.equal((await release(h,admin,{...bodies[0],requestId:crypto.randomUUID()},409)).data.error.code,'PREMIUM_REVIEW_CHANGED');
  for(const hold of fresh)await release(h,admin,reviewBody(hold));
  assert.equal(product(await premium(h,actor),'gold-banner').owned,true);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM premium_reviews').get().n,4);
});

await scope('review release and its audit commit atomically, with concurrent and revoked-operator requests fenced out',async h=>{
  const admin=await administrator(h),actor=await h.session('監査の対象');
  const p=purchase(h,'gold-banner',(await order(h,actor,'gold-banner')).reference);await complete(h,p);await deliver(h,warning(h,p));
  const holds=(await reviews(h,admin)).holds,body=reviewBody(holds[0]);
  h.sql.exec("CREATE TRIGGER fixture_review_failure BEFORE INSERT ON premium_reviews BEGIN SELECT RAISE(ABORT,'fixture review rollback'); END;");
  const before=tables(h);await release(h,admin,body,500);assert.deepEqual(tables(h),before);
  h.sql.exec('DROP TRIGGER fixture_review_failure');await release(h,admin,body);
  const concurrent=await Promise.all([release(h,admin,reviewBody(holds[1]),null),release(h,admin,reviewBody(holds[1]),null)]);
  assert.deepEqual(concurrent.map(result=>result.response.status).sort(),[200,409]);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM premium_reviews').get().n,2);
  await deliver(h,warning(h,p));const next=(await reviews(h,admin)).holds[0],beforeRevoked=tables(h);let intercepted=false;
  h.beforeBatch=statements=>{if(statements.some(statement=>/INSERT INTO premium_reviews/.test(statement.sql))){h.beforeBatch=null;intercepted=true;h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(actor.user.id);}};
  const denied=await release(h,admin,reviewBody(next),null);assert(intercepted);assert([403,409].includes(denied.response.status),JSON.stringify({status:denied.response.status,data:denied.data}));assert.deepEqual(tables(h),beforeRevoked);
});

await scope('unequipped purchases appear on every public name and refresh historical chat and letter authors',async h=>{
  const actor=await h.session('購入表示の甲'),other=await h.session('購入表示の乙');
  for(const [player,defender]of [[actor,false],[other,true]]){
    const save=h.fresh(defender?'inuyama':'kiyosu');save.state.troops=20000;save.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};
    if(defender)save.state.castles.nijo={owner:save.state.clan,level:20,wall:4,troops:1000};
    await savePlayer(h,player,save);
  }
  const chat=(await h.api('/chat',post(actor,{channel:'world',text:'購入前に書いた投稿'}))).data.message;
  const letter=(await h.api('/letters',post(actor,{requestId:'premium-historical-letter',destination:'player',targetPlayerId:other.user.id,text:'購入前の書状'}))).data;
  const guild=(await h.api('/guild',post(actor,{name:'購入表示の軍団'}))).data.guild;
  await h.api('/guild/join',post(other,{guildId:guild.id}));
  await h.api('/friends/request',post(actor,{userId:other.user.id}));await h.api('/friends/respond',post(other,{userId:actor.user.id,accept:true}));
  await h.api('/presence',post(actor,{deviceId:actor.deviceId,online:true}));
  const purchases=[];
  for(const key of Object.keys(PRODUCTS)){const p=purchase(h,key,(await order(h,actor,key)).reference);await complete(h,p);purchases.push(p);}
  const expected={nameplate:null,town:null,badge:null,ownedProducts:['gold-banner','moonlit-castle','supporter']};
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM premium_appearances').get().n,0,'Ownership must work before equipment is ever selected');
  assert.deepEqual((await premium(h,actor)).appearance,expected);
  const publicReads=[];
  const read=async path=>{const value=(await h.api(path,{token:other.token})).data;publicReads.push(value);return value;};
  assert.deepEqual((await read('/online')).players.find(p=>p.id===actor.user.id).appearance,expected);
  assert.deepEqual((await read('/players?q='+encodeURIComponent('購入表示'))).players.find(p=>p.id===actor.user.id).appearance,expected);
  assert.deepEqual((await read('/me')).friends.find(p=>p.id===actor.user.id).appearance,expected);
  const memberList=await read('/guild');assert.deepEqual(memberList.guild.ownerAppearance,expected);assert.deepEqual(memberList.members.find(p=>p.id===actor.user.id).appearance,expected);
  for(const path of ['/guilds','/guild/rankings'])assert.deepEqual((await read(path)).guilds[0].ownerAppearance,expected);
  const full=await read('/chat?channel=world');assert.deepEqual(full.messages[0].appearance,expected);assert.equal(full.messages[0].text,chat.text);
  const delta=await read('/chat?channel=world&after='+chat.id);assert.deepEqual(delta.messages,[]);assert.deepEqual(delta.playerEvaluations.find(p=>p.playerId===actor.user.id).appearance,expected);
  const thread=await read('/letters/'+letter.thread.id);assert.deepEqual(thread.thread.peer.appearance,expected);assert.deepEqual(thread.messages[0].authorAppearance,expected);assert.deepEqual(thread.thread.lastMessage.authorAppearance,expected);
  const letterDelta=await read('/letters/'+letter.thread.id+'?after='+letter.message.seq);assert.deepEqual(letterDelta.messages,[]);assert.deepEqual(letterDelta.playerEvaluations.find(p=>p.playerId===actor.user.id).appearance,expected);
  const revision=()=>Number(h.sql.prepare('SELECT revision FROM player_saves WHERE user_id=?').get(actor.user.id).revision);
  const ledger=(await h.api('/guild/treasury/transfer',post(actor,{guildId:guild.id,resource:'gold',amount:1,direction:'deposit',requestId:'premium-ledger',deviceId:actor.deviceId,expectedRevision:revision()}))).data.receipt;
  assert.deepEqual(ledger.appearance,expected);assert.deepEqual((await read('/guild/treasury')).ledger[0].appearance,expected);
  const proposed=(await h.api('/trades',post(actor,{targetPlayerId:other.user.id,offer:{gold:1},want:{},requestId:'premium-trade',deviceId:actor.deviceId,expectedRevision:revision()}))).data;
  assert.deepEqual(proposed.trade.sender.appearance,expected);assert.deepEqual((await read('/trades')).trades[0].sender.appearance,expected);
  // Purchase badges are verified against a legitimate opposing player.
  await h.api('/guild/leave',post(other,{guildId:guild.id}));
  const original=crypto.getRandomValues;crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(0):original.call(crypto,array);};
  let attacked;
  try{
  const departure=(await h.api('/field/attack',post(actor,{requestId:'premium-battle',targetPlayerId:other.user.id,targetCastleId:'nijo',troops:3000,tactic:'balanced',deviceId:actor.deviceId,expectedRevision:revision()}))).data;
  attacked={battle:await settleFieldMarch(h,actor,departure)};
  }finally{crypto.getRandomValues=original;}
  await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}));
  await h.api('/guild/join',post(other,{guildId:guild.id}));
  assert.deepEqual(attacked.battle.attackerAppearance,expected);assert.deepEqual(attacked.battle.defenderAppearance.ownedProducts,[]);
  await h.api('/field/diplomacy',post(actor,{requestId:'premium-diplomacy',targetPlayerId:other.user.id,action:'propose',deviceId:actor.deviceId,expectedRevision:revision()}));
  const field=await read('/field');assert.deepEqual(field.players.find(p=>p.playerId===actor.user.id).appearance,expected);
  const history=await read('/field/me');assert.deepEqual(history.battles[0].attackerAppearance,expected);assert.deepEqual(history.relationships[0].targetAppearance,expected);
  const mail=await read('/mail');assert.deepEqual(mail.mail[0].participants.find(p=>p.playerId===actor.user.id).appearance,expected);
  const feed=await read('/achievements');const achievement=feed.events.find(p=>p.playerId===actor.user.id);assert(achievement);assert.deepEqual(achievement.playerAppearance,expected);
  const before=savedRows(h),stored=h.sql.prepare('SELECT result_json FROM field_battles').get().result_json;
  await read('/field/me');await read('/letters/'+letter.thread.id);assert.deepEqual(savedRows(h),before);assert.equal(h.sql.prepare('SELECT result_json FROM field_battles').get().result_json,stored);assert(!stored.includes('Appearance'));
  const published=JSON.stringify(publicReads);
  for(const forbidden of [SECRET,actor.token,...purchases.flatMap(p=>[p.reference,p.session,p.intent,p.chargeId,p.customer])])assert(!published.includes(forbidden),'Public identity discloses private purchase data');
  await equip(h,actor,'gold-banner');await h.api('/premium/appearance',{method:'PUT',token:actor.token,body:{slot:'nameplate',productId:null}});
  assert.deepEqual((await read('/chat?channel=world')).messages[0].appearance,expected,'Removing equipment leaves the valid ownership mark');
  const admin=await administrator(h);await h.api('/admin/staff',post(admin,{targetPlayerId:actor.user.id,action:'appoint',requestId:'premium-shared-role'}));
  const shared=(await h.api('/sync',{token:actor.token})).data;
  const construction=(await h.api('/staff/base/upgrade',post(actor,{kind:'building',id:'farm',requestId:'premium-shared-build',deviceId:actor.deviceId,expectedRevision:shared.revision,baseRevision:shared.staffBase.revision}))).data;
  const attribution=construction.staffBase.jobs.find(job=>job.startedBy?.id===actor.user.id).startedBy;
  assert.deepEqual(attribution.appearance,expected,'Server-owned construction attribution carries the actual buyer marks');
  assert(!JSON.parse(h.sql.prepare("SELECT state_json FROM staff_base WHERE id='kyoto_gosho'").get().state_json).jobs[0].startedBy.appearance,'Display state is never written back to shared jobs');
});

await scope('historical names lose purchase marks on holds, refunds, BAN and exact subscription expiry',async h=>{
  const admin=await administrator(h),actor=await h.session('取消表示の甲'),viewer=await h.session('取消表示の乙'),payments={};
  for(const key of Object.keys(PRODUCTS)){const p=purchase(h,key,(await order(h,actor,key)).reference);await complete(h,p);payments[key]=p;}
  const battle={id:id('fb_'),attackerPlayerId:actor.user.id,attackerName:actor.user.name,defenderPlayerId:viewer.user.id,defenderName:viewer.user.name,createdAt:new Date(h.now).toISOString(),battleMode:'raid'};
  h.sql.prepare('INSERT INTO field_battles(id,attacker_id,defender_id,occurred_elapsed_ms,result_json,created_at) VALUES(?,?,?,?,?,?)').run(battle.id,actor.user.id,viewer.user.id,0,JSON.stringify(battle),h.now);
  const appearance=async()=>(await h.api('/field/me',{token:viewer.token})).data.battles[0].attackerAppearance;
  const all=['gold-banner','moonlit-castle','supporter'];assert.deepEqual((await appearance()).ownedProducts,all);
  await deliver(h,warning(h,payments['gold-banner']));assert.deepEqual((await appearance()).ownedProducts,['moonlit-castle','supporter']);
  for(const hold of (await reviews(h,admin)).holds)await release(h,admin,reviewBody(hold));assert.deepEqual((await appearance()).ownedProducts,all);
  await deliver(h,event(h,'refund.created',{id:id('re_'),object:'refund',charge:payments['gold-banner'].chargeId,payment_intent:payments['gold-banner'].intent,amount:480,currency:'jpy',status:'succeeded'}));
  assert.deepEqual((await appearance()).ownedProducts,['moonlit-castle','supporter']);
  await moderate(h,admin,actor,'ban');assert.deepEqual(await appearance(),{nameplate:null,town:null,badge:null,ownedProducts:[]});
  await moderate(h,admin,actor,'unban');assert.deepEqual((await appearance()).ownedProducts,['moonlit-castle','supporter']);
  h.now=payments.supporter.end*1000-1;assert.deepEqual((await appearance()).ownedProducts,['moonlit-castle','supporter']);
  h.now++;assert.deepEqual((await appearance()).ownedProducts,['moonlit-castle']);
  assert.equal(h.sql.prepare('SELECT result_json FROM field_battles WHERE id=?').get(battle.id).result_json,JSON.stringify(battle));
});
await scope('five new one-time cosmetics require matching paid evidence, switch within each slot, and revoke on refund',async h=>{
  const actor=await h.session('新装の領主'),other=await h.session('別の領主'),payments={};
  for(const [key,config] of Object.entries(EXTRA_PRODUCTS)){
    const {reference}=await order(h,actor,key),p=purchase(h,key,reference);payments[key]=p;
    await equip(h,other,key,config.slot,403);
    await deliver(h,event(h,'checkout.session.completed',{...p.checkout,payment_status:'unpaid'}));
    await deliver(h,event(h,'charge.succeeded',p.charge));
    assert.equal(product(await premium(h,actor),key).owned,false);
    const paid=event(h,'checkout.session.async_payment_succeeded',p.checkout);
    await deliver(h,paid);await deliver(h,paid);
    assert.equal(product(await premium(h,actor),key).owned,true);assert.equal(product(await premium(h,other),key).owned,false);
    await equip(h,actor,key);
    const equipped=await premium(h,actor);assert.equal(equipped.appearance[config.slot],key);
    assert.equal(equipped.products.filter(item=>item.equipped&&configFor(item.id).slot===config.slot).length,1);
    await h.api('/premium/checkout',post(actor,{productId:key},409));
    assert.equal(grants(h,actor).filter(g=>g.product_id===key).length,1);
  }
  const before=await premium(h,actor);assert.equal(before.appearance.nameplate,'silver-banner');assert.equal(before.appearance.town,'snow-town');assert.equal(before.appearance.badge,'phoenix-medallion');
  await equip(h,actor,'vermilion-banner');await equip(h,actor,'sakura-town');
  const updated=await premium(h,actor);assert.equal(updated.appearance.nameplate,'vermilion-banner');assert.equal(updated.appearance.town,'sakura-town');
  const p=payments['sakura-town'];
  await deliver(h,event(h,'refund.created',{id:id('re_'),object:'refund',charge:p.chargeId,payment_intent:p.intent,amount:980,currency:'jpy',status:'succeeded'}));
  const refunded=await premium(h,actor);assert.equal(product(refunded,'sakura-town').owned,false);assert.equal(refunded.appearance.town,null);assert.equal(product(refunded,'snow-town').owned,true);
  assert.equal(refunded.appearance.nameplate,'vermilion-banner');assert.equal(refunded.appearance.badge,'phoenix-medallion');
  await h.api('/premium/appearance',{method:'PUT',token:actor.token,body:{slot:'nameplate',productId:null}});
  assert.equal((await premium(h,actor)).appearance.nameplate,null);
});
}finally{globalThis.fetch=originalFetch;}
assert.equal(externalRequests,0,'Fixture suite must never make a real payment or external network request');
console.log(JSON.stringify({passed:checks,failed,calls,externalRequests,realPayments:0,fixtureOnly:true}));
if(failed)process.exitCode=1;
