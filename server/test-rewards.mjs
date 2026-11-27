import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {harness,syncFieldWriter} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {rewardCalendar,protectRewardSync} from './rewards.js';

// Only local signed Stripe fixtures and transactional in-memory SQLite.
const publishedVersion=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
const SECRET='whsec_rewards_local_fixture_not_a_real_secret';
const API_VERSION='2026-09-30.endive',DAY=86400000;
const PASS={id:'reroll-pass-30d',amount:480,mode:'payment',link:'plink_reroll_fixture',price:'price_reroll_fixture',product:'prod_reroll_fixture',url:'https://buy.stripe.com/fixtureReroll30'};
const SUPPORTER={id:'supporter',amount:780,mode:'subscription',link:'plink_1UeEiNL3ZjL9QUmf5805BE1t',price:'price_1UeEiFL3ZjL9QUmfkthlf1SJ',product:'prod_VfZr9Vag05JWrT'};
const id=prefix=>prefix+crypto.randomUUID().replaceAll('-',''),clone=value=>JSON.parse(JSON.stringify(value));
const post=(actor,body,expected=200)=>({method:'POST',token:actor?.token,body,expected});
const api=(h,a,path,body,expected=200)=>h.api(path,post(a,body,expected));
const state=(h,a)=>JSON.parse(h.sql.prepare('SELECT save_json FROM player_saves WHERE user_id=?').get(a.user.id).save_json).state;
const request=(a,extra={},requestId=id('req_'))=>({deviceId:a.deviceId,expectedRevision:a.snapshot.revision,requestId,...extra});
async function action(h,a,path,extra={},expected=200,requestId){const body=request(a,extra,requestId),result=await api(h,a,path,body,expected);if(result.data?.save)a.snapshot=result.data;return {...result,body};}
async function lease(h,a){a.snapshot=(await api(h,a,'/sync/lease',{deviceId:a.deviceId})).data;return a.snapshot;}
async function player(h,name='報酬を試す領主',change=()=>{}){
  const a=await h.session(name);a.deviceId=id('dev_');await lease(h,a);
  const save=h.fresh();save.state.magatama=20000;save.state.worldClock={id:a.snapshot.clock.id,elapsedMs:a.snapshot.clock.elapsedMs};save.state.turn=Math.floor(a.snapshot.clock.elapsedMs/60000);save.state.realtime.elapsed=a.snapshot.clock.elapsedMs%60000/1000;change(save);
  a.snapshot=(await h.api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:a.snapshot.revision,save}})).data;
  return a;
}
function event(h,type,object){return {id:id('evt_'),object:'event',api_version:API_VERSION,created:Math.floor(h.now/1000),livemode:true,type,data:{object}};}
async function deliver(h,value,expected=200){const raw=JSON.stringify(value),timestamp=Math.floor(h.now/1000),signature=createHmac('sha256',SECRET).update(timestamp+'.'+raw).digest('hex');return h.api('/premium/stripe/webhook',{method:'POST',rawBody:raw,origin:null,headers:{'Stripe-Signature':`t=${timestamp},v1=${signature}`},expected});}
async function payment(h,a,config=PASS,{start=Math.floor(h.now/1000),subscription=id('sub_'),customer=id('cus_'),reference=null}={}){
  if(!reference){const order=(await api(h,a,'/premium/checkout',{productId:config.id})).data;reference=new URL(order.url).searchParams.get('client_reference_id');}
  const now=Math.floor(h.now/1000),session=id('cs_'),intent=id('pi_'),chargeId=id('ch_'),invoice=id('in_'),end=start+30*86400;
  const checkout={id:session,object:'checkout.session',livemode:true,created:now,payment_link:config.link,client_reference_id:reference,mode:config.mode,amount_total:config.amount,currency:'jpy',payment_status:'paid',status:'complete',payment_intent:config.mode==='payment'?intent:null,subscription:config.mode==='subscription'?subscription:null,customer:config.mode==='subscription'?customer:null};
  const charge={id:chargeId,object:'charge',livemode:true,created:now,payment_intent:intent,amount:config.amount,amount_captured:config.amount,amount_refunded:0,currency:'jpy',paid:true,captured:true,refunded:false};
  const bill={id:invoice,object:'invoice',livemode:true,customer,currency:'jpy',status:'paid',billing_reason:'subscription_cycle',amount_due:780,amount_paid:780,amount_remaining:0,total:780,parent:{type:'subscription_details',subscription_details:{subscription}},lines:{has_more:false,data:[{amount:780,currency:'jpy',quantity:1,parent:{type:'subscription_item_details',subscription_item_details:{subscription,proration:false}},pricing:{type:'price_details',price_details:{price:SUPPORTER.price,product:SUPPORTER.product}},period:{start,end}}]}};
  const paid={id:id('inpay_'),object:'invoice_payment',livemode:true,invoice,amount_paid:780,currency:'jpy',status:'paid',payment:{type:'payment_intent',payment_intent:intent},status_transitions:{paid_at:now}};
  return {reference,config,session,intent,chargeId,invoice,subscription,customer,start,end,checkout,charge,bill,paid};
}
async function fulfill(h,p){const notices=[event(h,'checkout.session.completed',p.checkout),...(p.config.mode==='subscription'?[event(h,'invoice.paid',p.bill),event(h,'invoice_payment.paid',p.paid)]:[]),event(h,'charge.succeeded',p.charge)];for(const notice of notices)await deliver(h,notice);return notices;}
const premium=async(h,a)=>(await h.api('/premium?catalog=4',{token:a.token})).data;
const rewards=async(h,a)=>(await h.api('/rewards',{token:a.token})).data;
const freeze=h=>h.sql.prepare('UPDATE world_clock SET running=0').run();
async function syncSave(h,a,save,expected=200){const result=await h.api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:a.snapshot.revision,save},expected});if(result.data?.save)a.snapshot=result.data;return result;}

let passed=0,failed=0,calls=0,externalRequests=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{externalRequests++;throw Error('No external requests in reward tests');};
async function scope(name,run){const h=harness();h.now=Date.UTC(2026,10,27,3);Object.assign(h.env,{STRIPE_WEBHOOK_SECRET:SECRET,SENGOKU_PREMIUM_ENABLED:'true',SENGOKU_STRIPE_PORTAL_URL:'https://billing.stripe.com/p/login/fixtureRewards123',SENGOKU_REROLL_PAYMENT_LINK_ID:PASS.link,SENGOKU_REROLL_PAYMENT_LINK_URL:PASS.url,SENGOKU_REROLL_PRICE_ID:PASS.price,SENGOKU_REROLL_PRODUCT_ID:PASS.product});h.sql.prepare('UPDATE premium_reward_program SET starts_at=?').run(h.now-1000);try{await run(h);passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name);console.error(error);}finally{calls+=h.calls;h.close();}}
try{
await scope('health requires the reward migration and authentication/strict request shapes protect rewards',async h=>{
  const health=(await h.api('/health')).data;assert.equal(health.version,publishedVersion);for(const key of ['serverSummons','loginRewards','paidRerolls','supporterChoices'])assert.equal(health.features[key],true);
  for(const path of ['/rewards','/gacha/draw','/rewards/login'])await h.api(path,{method:path==='/rewards'?'GET':'POST',body:path==='/rewards'?undefined:{},expected:401});
  const a=await player(h);await action(h,a,'/gacha/draw',{count:1,day:'2000-01-01'},400);await action(h,a,'/rewards/login',{amount:999},400);
  h.sql.exec('DROP TABLE premium_daily_events');await h.api('/health',{expected:503});
});

await scope('normal singles and ten-pulls use the server once without touching the saved PRNG',async h=>{
  const a=await player(h),before=clone(a.snapshot.save.state),one=await action(h,a,'/gacha/draw',{count:1});
  assert.equal(one.data.receipt.pending,false);assert.equal(one.data.receipt.cost,300);assert.equal(one.data.receipt.results.length,1);assert.equal(state(h,a).stats.gachaDraws,before.stats.gachaDraws+1);assert.equal(state(h,a).seed,before.seed);
  const retry=await api(h,a,'/gacha/draw',one.body);assert.equal(retry.data.idempotent,true);assert.deepEqual(retry.data.receipt,one.data.receipt);
  await api(h,a,'/gacha/draw',{...one.body,count:10},409);
  const balance=state(h,a).magatama,ten=await action(h,a,'/gacha/draw',{count:10});assert.equal(ten.data.receipt.results.length,10);assert.equal(state(h,a).magatama,balance-2700+ten.data.receipt.refund);assert.equal((await rewards(h,a)).pending,null);
  await action(h,a,'/gacha/reroll',{drawId:ten.data.receipt.drawId},409);
});

await scope('a paid pass is gated by matching paid evidence, starts once, expires in 30 real days and revokes on refund',async h=>{
  const a=await player(h);freeze(h);const p=await payment(h,a),notices=await fulfill(h,p),first=await premium(h,a);
  assert.equal(first.products.length,9);assert.equal(first.rerollPass.active,true);assert.equal(Date.parse(first.rerollPass.expiresAt),h.now+30*DAY);assert.equal(first.rerollPass.remainingToday,3);
  await api(h,a,'/premium/checkout',{productId:PASS.id},409);
  h.now+=DAY;for(const notice of notices)await deliver(h,notice);assert.equal((await premium(h,a)).rerollPass.expiresAt,first.rerollPass.expiresAt);
  const refund=event(h,'charge.refunded',{...p.charge,refunded:true,amount_refunded:480});await deliver(h,refund);assert.equal((await premium(h,a)).rerollPass.active,false);for(const notice of notices)await deliver(h,notice);assert.equal((await premium(h,a)).rerollPass.active,false);
  const next=await payment(h,a);await fulfill(h,next);const expiry=Date.parse((await premium(h,a)).rerollPass.expiresAt);h.now=expiry;assert.equal((await premium(h,a)).rerollPass.active,false);
});

await scope('unpaid completion and repeated asynchronous success never grant early or extend a pass',async h=>{
  const a=await player(h),p=await payment(h,a);await deliver(h,event(h,'checkout.session.completed',{...p.checkout,payment_status:'unpaid'}));await deliver(h,event(h,'charge.succeeded',p.charge));assert.equal((await premium(h,a)).rerollPass.active,false);
  const notice=event(h,'checkout.session.async_payment_succeeded',p.checkout);await deliver(h,notice);const expiry=(await premium(h,a)).rerollPass.expiresAt;await deliver(h,notice);assert.equal((await premium(h,a)).rerollPass.expiresAt,expiry);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM premium_pass_receipts').get().n,1);
});

await scope('pending single, alternate candidate and final choice never grant both or return duplicate jade twice',async h=>{
  const a=await player(h);await fulfill(h,await payment(h,a));const before=state(h,a),draw=await action(h,a,'/gacha/draw',{count:1});assert.equal(draw.data.receipt.pending,true);assert.equal(state(h,a).magatama,before.magatama-300);assert.deepEqual(state(h,a).officerVariants,before.officerVariants);assert.equal(state(h,a).stats.gachaDraws,before.stats.gachaDraws);
  const pending=(await rewards(h,a)).pending;assert.equal(pending.id,draw.data.receipt.drawId);await action(h,a,'/gacha/draw',{count:10},409);
  const rolled=await action(h,a,'/gacha/reroll',{drawId:pending.id});assert.deepEqual(state(h,a).officerVariants,before.officerVariants);assert.equal(rolled.data.rewards.rerollPass.usedToday,1);
  const replay=await api(h,a,'/gacha/reroll',rolled.body);assert.equal(replay.data.idempotent,true);assert.deepEqual(replay.data.receipt,rolled.data.receipt);await action(h,a,'/gacha/reroll',{drawId:pending.id},409);
  const chosen=await action(h,a,'/gacha/choose',{drawId:pending.id,choice:'rerolled'}),card=chosen.data.receipt.results[0];assert.equal(chosen.data.receipt.results.length,1);assert.equal(chosen.data.receipt.cost,0);assert.equal(state(h,a).stats.gachaDraws,before.stats.gachaDraws+1);assert(state(h,a).officerVariants.includes(card.officerId+':'+card.rank));assert.equal(state(h,a).magatama,before.magatama-300+chosen.data.receipt.refund);
  const selectedState=state(h,a);await api(h,a,'/gacha/choose',chosen.body);assert.deepEqual(state(h,a),selectedState);await action(h,a,'/gacha/choose',{drawId:pending.id,choice:'original'},409);
});

await scope('exact duplicate conversion pays 50 once and the unchosen new card never enters collection',async h=>{
  const zero=GAME_OFFICERS[0],a=await player(h,'重複検証',save=>{if(!save.state.officers.includes(zero.id))save.state.officers.push(zero.id);if(!save.state.officerVariants)save.state.officerVariants=save.state.officers.map(id=>id+':'+GAME_OFFICERS.find(o=>o.id===id).rank);if(!save.state.officerVariants.includes(zero.id+':D'))save.state.officerVariants.push(zero.id+':D');});
  await fulfill(h,await payment(h,a));const native=crypto.getRandomValues,sequence=[0,0,99,0];crypto.getRandomValues=array=>{array[0]=sequence.shift()??0;return array;};let draw,rolled;
  try{draw=await action(h,a,'/gacha/draw',{count:1});rolled=await action(h,a,'/gacha/reroll',{drawId:draw.data.receipt.drawId});}finally{crypto.getRandomValues=native;}
  const before=state(h,a),selected=await action(h,a,'/gacha/choose',{drawId:draw.data.receipt.drawId,choice:'original'});assert.equal(selected.data.receipt.refund,50);assert.equal(state(h,a).magatama,before.magatama+50);assert.equal(state(h,a).stats.gachaDuplicates,before.stats.gachaDuplicates+1);assert.equal(state(h,a).officerVariants.length,before.officerVariants.length);assert.equal(rolled.data.receipt.rerolled.rank,'U');
});

await scope('three distinct daily rerolls reset only at 05 JST and are shared across devices',async h=>{
  const a=await player(h);freeze(h);await fulfill(h,await payment(h,a));h.now=Date.UTC(2026,10,27,14,59);await lease(h,a);
  for(let i=0;i<3;i++){const d=await action(h,a,'/gacha/draw',{count:1});await action(h,a,'/gacha/reroll',{drawId:d.data.receipt.drawId});await action(h,a,'/gacha/choose',{drawId:d.data.receipt.drawId,choice:'original'});}
  assert.equal((await rewards(h,a)).rerollPass.remainingToday,0);h.now+=120000;await lease(h,a);assert.equal((await rewards(h,a)).rerollPass.remainingToday,0);
  const no=await action(h,a,'/gacha/draw',{count:1});assert.equal(no.data.receipt.pending,false);
  a.deviceId=id('other_');h.now+=60000;await lease(h,a);assert.equal((await rewards(h,a)).rerollPass.usedToday,3);
  h.now=Date.UTC(2026,10,27,20);await lease(h,a);assert.equal((await rewards(h,a)).rerollPass.usedToday,0);const yes=await action(h,a,'/gacha/draw',{count:1});assert.equal(yes.data.receipt.pending,true);
});

await scope('a refunded pending alternate cannot be selected but the paid original remains recoverable',async h=>{
  const a=await player(h),p=await payment(h,a);await fulfill(h,p);const d=await action(h,a,'/gacha/draw',{count:1});await action(h,a,'/gacha/reroll',{drawId:d.data.receipt.drawId});
  await deliver(h,event(h,'charge.dispute.created',{id:id('dp_'),object:'dispute',charge:p.chargeId,payment_intent:p.intent,status:'needs_response'}));
  assert.equal((await rewards(h,a)).pending.rerolledAvailable,false);await action(h,a,'/gacha/choose',{drawId:d.data.receipt.drawId,choice:'rerolled'},403);await action(h,a,'/gacha/choose',{drawId:d.data.receipt.drawId,choice:'original'});
});

await scope('login windows use server time, midnight cannot repeat night, and cap preserves the unused slot',async h=>{
  const a=await player(h);freeze(h);h.now=Date.UTC(2026,10,27,14,59);await lease(h,a);const first=await action(h,a,'/rewards/login');assert.equal(first.data.receipt.window,'night');assert.equal(first.data.receipt.amount,30);await api(h,a,'/rewards/login',first.body);
  h.now+=120000;await lease(h,a);await action(h,a,'/rewards/login',{},409);assert.equal((await rewards(h,a)).login.window,'night');
  h.now=Date.UTC(2026,10,27,20);await lease(h,a);assert.equal((await rewards(h,a)).login.window,'morning');await action(h,a,'/rewards/login');
  h.now=Date.UTC(2026,10,28,3);await lease(h,a);assert.equal((await rewards(h,a)).login.window,'noon');await action(h,a,'/rewards/login');
  const b=await player(h,'上限検証',save=>{save.state.magatama=globalThis.SENGOKU_DATA.assetCap;});await action(h,b,'/rewards/login',{},409);assert.equal((await rewards(h,b)).login.claimed,false);
  const saved=clone(b.snapshot.save);saved.state.magatama-=7;await syncSave(h,b,saved);const partial=await action(h,b,'/rewards/login');assert.equal(partial.data.receipt.amount,7);assert.equal(state(h,b).magatama,globalThis.SENGOKU_DATA.assetCap);
});

await scope('lease checks, simultaneous choices and failed transactions cannot duplicate cost or grants',async h=>{
  const a=await player(h);await fulfill(h,await payment(h,a));const initial=state(h,a),body=request(a,{count:1});
  await api(h,a,'/gacha/draw',{...body,deviceId:'wrong-device'},409);
  let failOnce=true;h.beforeBatch=async statements=>{if(failOnce&&statements.some(s=>s.sql.includes('INSERT INTO reward_requests'))){failOnce=false;statements.push(h.db.prepare('SELECT * FROM deliberately_missing_reward_table'));}};
  await api(h,a,'/gacha/draw',body,500);h.beforeBatch=null;assert.deepEqual(state(h,a),initial);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM reward_requests').get().n,0);
  const draw=(await api(h,a,'/gacha/draw',body)).data;a.snapshot=draw;const drawId=draw.receipt.drawId;
  const results=await Promise.all([action(h,a,'/gacha/choose',{drawId,choice:'original'},null),action(h,a,'/gacha/choose',{drawId,choice:'original'},null)]);assert.equal(results.filter(r=>r.response.status===200).length,1);assert.equal(state(h,a).stats.gachaDraws,initial.stats.gachaDraws+1);
});

await scope('sync cannot restore consumed jade, erase server cards/history or import client draws',async h=>{
  const a=await player(h);await action(h,a,'/gacha/draw',{count:1});const original=clone(a.snapshot.save);
  for(const change of [s=>s.magatama+=300,s=>s.stats.gachaDraws++,s=>s.gachaHistory=[],s=>s.officerVariants.pop()]){const save=clone(original);change(save.state);const response=await syncSave(h,a,save,null);assert(response.response.status>=400);}
  const local=GameEngine.fromSave(original,GAME_OFFICERS);assert(local.drawOfficers(1).ok);await syncSave(h,a,JSON.parse(local.exportSave()),409);
  const renamed=clone(original);renamed.state.walking.campaignId=id('forged_campaign_');renamed.state.roaming.campaignId=renamed.state.walking.campaignId;renamed.state.covert.campaignId=renamed.state.walking.campaignId;renamed.state.magatama+=300;await syncSave(h,a,renamed,409);
  await syncSave(h,a,clone(original));
});

await scope('legitimate monthly, quest, first-capture and verified mail earnings survive the sync guard',async h=>{
  const a=await player(h);await action(h,a,'/rewards/login');const before=clone(a.snapshot.save),checks=[];
  const run=async change=>{const next=clone(before);change(next.state);await protectRewardSync(h.db,{id:a.user.id},next,before,{fail:(status,code,message)=>{throw Error(code+':'+message);}});checks.push(true);};
  const monthly=GameEngine.fromSave(before,GAME_OFFICERS);assert(monthly.applyWorldClock({...a.snapshot.clock,elapsedMs:a.snapshot.clock.elapsedMs+60000}).ok);await protectRewardSync(h.db,{id:a.user.id},JSON.parse(monthly.exportSave()),before,{fail:(status,code)=>{throw Error(code);}});checks.push(true);
  await run(s=>{s.claimedQuests.push('first_upgrade');s.magatama+=100;});
  await run(s=>{s.captureRewards.push(globalThis.SENGOKU_DATA.castles.find(c=>!s.captureRewards.includes(c.id)).id);s.magatama+=120;});
  const admin=await h.session('贈り物の運営');await api(h,admin,'/admin/claim',{key:h.env.SENGOKU_ADMIN_KEY});
  const mail=(await api(h,admin,'/admin/mail',{target:a.user.id,title:'検証用の贈り物',body:'ローカル報酬テストです。',gift:{magatama:70},requestId:id('mail_')})).data;
  const claimed=(await api(h,a,'/mail/claim',{mailId:mail.mailId,requestId:id('claim_')})).data;
  const game=GameEngine.fromSave(before,GAME_OFFICERS);assert(game.applyGift(claimed.gift,claimed.receiptId).ok);await syncSave(h,a,JSON.parse(game.exportSave()));assert.equal(state(h,a).magatama,before.state.magatama+70);assert.equal(checks.length,3);
  const canonical=clone(a.snapshot.save),resetGame=new GameEngine({officers:GAME_OFFICERS,clan:canonical.state.clan,seed:73});resetGame.applyWorldClock(a.snapshot.clock);await syncSave(h,a,JSON.parse(resetGame.exportSave()));
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM reward_campaigns WHERE user_id=?').get(a.user.id).n,1);await syncSave(h,a,canonical);assert.equal(state(h,a).magatama,canonical.state.magatama);
  await action(h,a,'/rewards/login',{},409); // account-level slot is not reset with the story
});

await scope('supporter paid periods grant one permanent choice and reject retries, foreign periods and already-owned selections',async h=>{
  const a=await player(h),b=await player(h,'別の支援者'),p=await payment(h,a,SUPPORTER);const notices=await fulfill(h,p),snapshot=await premium(h,a),period=snapshot.supporterRewards.periods[0];assert(period);assert.equal(period.choices.length,3);assert.equal(period.periodKey,'202611');
  const body={periodId:period.periodId,productId:period.choices[0],requestId:id('choice_')},chosen=(await api(h,a,'/premium/supporter-choice?catalog=4',body)).data;assert(chosen.appearance.ownedProducts.includes(body.productId));assert.equal(chosen.receipt.productId,body.productId);assert.equal((await api(h,a,'/premium/supporter-choice?catalog=4',body)).data.idempotent,true);
  await api(h,a,'/premium/supporter-choice?catalog=4',{...body,productId:period.choices[1]},409);await api(h,b,'/premium/supporter-choice?catalog=4',{...body,requestId:id('other_')},403);
  const equipped=(await h.api('/premium/appearance?catalog=4',{method:'PUT',token:a.token,body:{slot:'nameplate',productId:body.productId}})).data;assert.equal(equipped.appearance.nameplate,body.productId);
  await deliver(h,event(h,'customer.subscription.deleted',{id:p.subscription,object:'subscription',status:'canceled',ended_at:Math.floor(h.now/1000)}));assert((await premium(h,a)).appearance.ownedProducts.includes(body.productId));for(const notice of notices)await deliver(h,notice);assert.equal((await premium(h,a)).supporterRewards.periods.length,1);
  await deliver(h,event(h,'charge.refunded',{...p.charge,refunded:true,amount_refunded:780}));assert(!(await premium(h,a)).appearance.ownedProducts.includes(body.productId));
});

await scope('historical invoices do not retro-grant, duplicate period invoices do not multiply choices, and three periods block another checkout',async h=>{
  const a=await player(h),reference=new URL((await api(h,a,'/premium/checkout',{productId:'supporter'})).data.url).searchParams.get('client_reference_id');
  const historical=await payment(h,a,SUPPORTER,{reference,start:Math.floor(h.now/1000)-31*86400});await fulfill(h,historical);assert.equal((await premium(h,a)).supporterRewards.periods.length,0);
  const current=await payment(h,a,SUPPORTER,{reference});await fulfill(h,current);const duplicate=await payment(h,a,SUPPORTER,{reference,subscription:current.subscription,customer:current.customer,start:current.start});await fulfill(h,duplicate);assert.equal((await premium(h,a)).supporterRewards.periods.length,1);
  const purchases=[historical,current];for(let i=0;i<2;i++){const next=await payment(h,a,SUPPORTER,{reference});await fulfill(h,next);purchases.push(next);}
  for(const p of purchases)await deliver(h,event(h,'customer.subscription.deleted',{id:p.subscription,object:'subscription',status:'canceled',ended_at:Math.floor(h.now/1000)}));
  const snap=await premium(h,a);assert.equal(snap.supporterRewards.periods.length,3);assert.equal(snap.products.find(p=>p.id==='supporter').purchaseBlockReason,'monthly_choices_exhausted');await api(h,a,'/premium/checkout',{productId:'supporter'},409);
  const [one,two]=snap.supporterRewards.periods;await api(h,a,'/premium/supporter-choice?catalog=4',{periodId:one.periodId,productId:one.choices[0],requestId:id('pick_')});await api(h,a,'/premium/supporter-choice?catalog=4',{periodId:two.periodId,productId:two.choices[0],requestId:id('pick_')},409);assert.equal((await premium(h,a)).supporterRewards.periods.find(p=>p.periodId===two.periodId).claimedProductId,null);
});

await scope('metrics distinguish event counts, verified paid periods, unique claimants and mature D1 cohorts',async h=>{
  const a=await player(h);freeze(h);const admin=await h.session('集計する運営');await api(h,admin,'/admin/claim',{key:h.env.SENGOKU_ADMIN_KEY});
  await api(h,a,'/premium/events',{event:'shop_view'});await api(h,a,'/premium/events',{event:'shop_view'});await api(h,a,'/premium/events',{event:'checkout_start',productId:PASS.id});await fulfill(h,await payment(h,a));await action(h,a,'/rewards/login');
  h.now+=DAY;await lease(h,a);await action(h,a,'/rewards/login');h.now+=DAY;
  const metrics=(await h.api('/admin/premium/metrics?days=14',{token:admin.token})).data;assert.equal(metrics.totals.shopViews,2);assert.equal(metrics.totals.checkoutStarts,1);assert.equal(metrics.totals.fulfilledPasses,1);assert.equal(metrics.totals.loginClaimAccounts,1);assert.equal(metrics.totals.loginClaims,2);assert.equal(metrics.retention.cohortAccounts,1);assert.equal(metrics.retention.returnedNextDay,1);assert.equal(metrics.retention.rate,1);assert.equal(metrics.totals.uniqueShopAccounts,1);assert.equal(metrics.totals.uniqueCheckoutAccounts,1);assert.equal(metrics.totals.uniquePaidAccounts,1);assert.equal(metrics.conversion.rate,1);
  await h.api('/admin/premium/metrics',{token:a.token,expected:403});
});
await scope('an active paid supporter period at rollout is upgraded while ended history stays excluded',async h=>{
  const a=await player(h),p=await payment(h,a,SUPPORTER,{start:Math.floor(h.now/1000)-10*86400});await fulfill(h,p);
  const periods=(await premium(h,a)).supporterRewards.periods;assert.equal(periods.length,1);assert.equal(periods[0].startsAt,new Date(p.start*1000).toISOString());assert.equal(periods[0].claimedProductId,null);
});
await scope('exceptional repeated paid pass purchases stack full terms and are counted when paid',async h=>{
  const a=await player(h),first=await payment(h,a);await fulfill(h,first);const expiry=Date.parse((await premium(h,a)).rerollPass.expiresAt),second=await payment(h,a,PASS,{reference:first.reference}),notices=await fulfill(h,second);
  assert.equal(Date.parse((await premium(h,a)).rerollPass.expiresAt),expiry+30*DAY);assert.equal((await premium(h,a)).rerollPass.remainingToday,3);
  for(const notice of notices)await deliver(h,notice);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM premium_pass_receipts').get().n,2);
  const admin=await h.session('積増し確認運営');await api(h,admin,'/admin/claim',{key:h.env.SENGOKU_ADMIN_KEY});assert.equal((await h.api('/admin/premium/metrics',{token:admin.token})).data.totals.fulfilledPasses,2);
});
await scope('old checkout links cannot consume a fourth same-theme supporter choice without fulfillment',async h=>{
  const a=await player(h),first=await payment(h,a,SUPPORTER);await fulfill(h,first);
  const rest=[];for(let i=0;i<4;i++)rest.push(await payment(h,a,SUPPORTER,{reference:first.reference}));
  await Promise.all(rest.map(p=>fulfill(h,p)));const periods=(await premium(h,a)).supporterRewards.periods;assert.equal(periods.length,5);assert.equal(periods.filter(p=>p.periodKey==='202611').length,3);assert.equal(periods.filter(p=>p.periodKey==='202612').length,2);
  const next=periods.find(p=>p.periodKey==='202612');await api(h,a,'/premium/supporter-choice?catalog=4',{periodId:next.periodId,productId:next.choices[0],requestId:id('next_theme_')});
});
await scope('managed accounts retain legitimate walking, progression exchanges and server clock earnings',async h=>{
  const a=await player(h,'既存報酬の併用',save=>{save.state.stats.gachaDraws=100;save.state.stats.gachaDuplicates=20;});await h.api('/progress',{token:a.token});await action(h,a,'/rewards/login');
  const game=GameEngine.fromSave(a.snapshot.save,GAME_OFFICERS),target=game.gachaPool('SS').find(o=>!game.ownsVariant(o.id,'SS'));
  const exchanged=await action(h,a,'/progress/exchange',{officerId:target.id,rank:'SS'});assert(exchanged.data.save.state.officerVariants.includes(target.id+':SS'));await syncSave(h,a,clone(a.snapshot.save));
  const newGame=new GameEngine({officers:GAME_OFFICERS,clan:a.snapshot.save.state.clan,seed:4});newGame.applyWorldClock(a.snapshot.clock);await syncSave(h,a,JSON.parse(newGame.exportSave()));assert(state(h,a).officerVariants.includes(target.id+':SS'));
  freeze(h);const started=await action(h,a,'/walking/start',{campaignId:a.snapshot.save.state.walking.campaignId}),session=started.data.walkingSession,balance=state(h,a).magatama;h.now+=5000;
  const walked=await api(h,a,'/walking/claim',{deviceId:a.deviceId,expectedRevision:a.snapshot.revision,sessionId:session.id,sessionToken:session.token,seq:session.lastSeq+1,totalSteps:10,activeMs:5000,finish:true});a.snapshot=walked.data;assert.equal(walked.data.save.state.magatama,balance+20);await syncSave(h,a,clone(a.snapshot.save));
  h.sql.prepare('UPDATE world_clock SET running=1,anchor_real_ms=?').run(h.now);h.now+=60000;const before=state(h,a).magatama;a.snapshot=await syncFieldWriter(h,a);assert.equal(state(h,a).magatama,before+30);
});
await scope('committed response loss is recoverable and a refund racing a reroll consumes no daily use',async h=>{
  const a=await player(h),p=await payment(h,a);await fulfill(h,p);const body=request(a,{count:1}),balance=state(h,a).magatama;
  h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO reward_requests'))){h.afterBatch=null;throw Error('simulated response loss after commit');}};
  await api(h,a,'/gacha/draw',body,500);assert.equal(state(h,a).magatama,balance-300);const recovered=await api(h,a,'/gacha/draw',body);assert.equal(recovered.data.idempotent,true);a.snapshot=recovered.data;assert.equal((await rewards(h,a)).pending.id,recovered.data.receipt.drawId);
  h.beforeBatch=async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO reward_requests'))){h.beforeBatch=null;await deliver(h,event(h,'charge.refunded',{...p.charge,refunded:true,amount_refunded:480}));}};
  await action(h,a,'/gacha/reroll',{drawId:recovered.data.receipt.drawId},409);assert.equal((await rewards(h,a)).rerollPass.usedToday,0);assert.equal((await rewards(h,a)).pending.rerolled,null);await action(h,a,'/gacha/choose',{drawId:recovered.data.receipt.drawId,choice:'original'});
});
assert.deepEqual(rewardCalendar(Date.UTC(2026,10,27,19,59)),{day:'2026-11-27',window:'night',nextResetAt:'2026-11-27T20:00:00.000Z'});
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({passed,failed,calls,externalRequests,realPayments:0,fixtureOnly:true}));
if(failed||externalRequests)process.exitCode=1;
