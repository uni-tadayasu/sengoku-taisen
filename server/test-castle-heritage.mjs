import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {fixture,post,row,updateSave} from './test-court-support.mjs';

// Signed local Stripe fixtures only. The entire suite forbids external fetch.
const publishedVersion=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version;
const SECRET='whsec_local_castle_heritage_fixture_only',PRODUCT='castle-heritage';
const LINK='plink_1UgZ3RL3ZjL9QUmf9UOolX4E',PRICE='price_1UgZ3IL3ZjL9QUmf26YHbrPH';
const id=prefix=>prefix+crypto.randomUUID().replaceAll('-','');
const current=(h,p)=>(h.api('/premium?catalog=5',{token:p.token})).then(r=>r.data);
const item=snapshot=>snapshot.products.find(p=>p.id===PRODUCT);
const equip=(h,p,productId=PRODUCT,expected=200)=>h.api('/premium/appearance?catalog=5',{method:'PUT',token:p.token,body:{slot:'town',productId},expected}).then(r=>r.data);
const profile=(h,p)=>h.api('/players/'+p.user.id+'/profile').then(r=>r.data.player);
async function resident(h,name,castleId,mode='lord'){
  const p=await h.session(name);p.deviceId='heritage-'+p.user.id;
  const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
  const joined=(await h.api('/castles/residency/start',post(p,{deviceId:p.deviceId,revision:lease.revision,requestId:crypto.randomUUID(),castleId,mode,clan:'織田家',difficulty:'normal'}))).data;
  assert.equal(joined.residency.role,mode);return p;
}
async function checkout(h,p){
  const result=(await h.api('/premium/checkout',post(p,{productId:PRODUCT}))).data,url=new URL(result.url);
  assert.equal(url.origin,'https://buy.stripe.com');assert.equal(url.pathname,'/eVq7sM3IwgopcMP72u9MY0d');
  return url.searchParams.get('client_reference_id');
}
async function deliver(h,type,object){
  const t=Math.floor(h.now/1000),event={id:id('evt_'),object:'event',api_version:'2026-09-30.endive',created:t,livemode:true,type,data:{object}};
  const raw=JSON.stringify(event),signature='t='+t+',v1='+createHmac('sha256',SECRET).update(t+'.'+raw).digest('hex');
  return h.api('/premium/stripe/webhook',{method:'POST',origin:null,rawBody:raw,headers:{'Stripe-Signature':signature}});
}
function payment(h,reference,overrides={}){
  const intent=id('pi_'),chargeId=id('ch_'),session=id('cs_live_'),created=Math.floor(h.now/1000);
  return {intent,chargeId,checkout:{id:session,object:'checkout.session',livemode:true,created,payment_link:LINK,client_reference_id:reference,mode:'payment',amount_total:980,currency:'jpy',payment_status:'paid',status:'complete',payment_intent:intent,subscription:null,customer:null,line_items:{has_more:false,data:[{quantity:1,price:PRICE,amount_total:980}]},...overrides},charge:{id:chargeId,object:'charge',livemode:true,created,payment_intent:intent,amount:980,amount_captured:980,amount_refunded:0,currency:'jpy',paid:true,captured:true,refunded:false,status:'succeeded'}};
}
async function complete(h,p){await deliver(h,'checkout.session.completed',p.checkout);await deliver(h,'charge.succeeded',p.charge);}
async function publish(h,op,castleId){
  const draft=(await h.api('/admin/events/generate',post(op,{battleId:'castle:'+castleId,durationDays:1,requestId:crypto.randomUUID()}))).data;
  return(await h.api('/admin/events/'+draft.event.id+'/publish',post(op,{requestId:crypto.randomUUID()}))).data.event;
}
const originalFetch=globalThis.fetch;let externalRequests=0,cases=0,calls=0;
globalThis.fetch=async()=>{externalRequests++;throw Error('External requests forbidden in castle appearance fixtures');};
async function scenario(name,run){
  const h=harness();h.env.STRIPE_WEBHOOK_SECRET=SECRET;h.env.SENGOKU_PREMIUM_ENABLED='true';
  try{await run(h);cases++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}
}
try{
await scenario('health readiness requires the new product constraints and verified payment view',async h=>{
  assert.equal((await h.api('/health')).data.version,publishedVersion);
  const view=h.sql.prepare("SELECT sql FROM sqlite_master WHERE type='view' AND name='premium_verified_payments'").get().sql;
  h.sql.exec('DROP VIEW premium_verified_payments');h.sql.exec(view.replace(",'castle-heritage'",''));
  assert.equal((await h.api('/health',{expected:503})).data.error.code,'SERVICE_UNAVAILABLE');
});
await scenario('catalog compatibility and new purchases are limited to an ordinary castle lord',async h=>{
  const lord=await resident(h,'一般の城主','himeji'),retainer=await resident(h,'一般の家臣','himeji','retainer'),newPlayer=await h.session('本拠未定'),admin=await fixture(h,'江戸の領主',{admin:true});
  assert.equal((await current(h,lord)).products.length,10);assert.equal(item(await current(h,lord)).canPurchase,true);
  for(const [version,count]of [['4',9],['3',8],['',3]])assert.equal((await h.api('/premium'+(version?'?catalog='+version:''),{token:lord.token})).data.products.length,count);
  for(const player of [retainer,newPlayer]){
    assert.equal(item(await current(h,player)).purchaseBlockReason,'castle_lord_required');
    assert.equal((await h.api('/premium/checkout',post(player,{productId:PRODUCT},409))).data.error.code,'CASTLE_LORD_REQUIRED');
  }
  assert.equal(item(await current(h,admin)).purchaseBlockReason,'castle_art_included');
  assert.equal((await h.api('/premium/checkout',post(admin,{productId:PRODUCT},409))).data.error.code,'CASTLE_ART_INCLUDED');
  // Legacy saves can still have a metropolitan home; those are also free.
  updateSave(h,lord,s=>{s.home='nijo';s.cycle.home='nijo';s.castles.nijo.owner=s.clan;});
  assert.equal(item(await current(h,lord)).purchaseBlockReason,'castle_art_included');
  assert.equal((await h.api('/premium/checkout',post(lord,{productId:PRODUCT},409))).data.error.code,'CASTLE_ART_INCLUDED');
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM premium_orders').get().n,0);
});
await scenario('matching paid evidence equips a permanent appearance and projects the owner to all viewers',async h=>{
  const op=await fixture(h,'催事奉行',{admin:true}),lord=await resident(h,'絵巻の城主','himeji'),retainer=await resident(h,'絵巻の家臣','himeji','retainer'),other=await resident(h,'未購入の城主','inuyama');
  const receipt=payment(h,await checkout(h,lord)),before=row(h,lord);
  await deliver(h,'checkout.session.completed',receipt.checkout);assert.equal(item(await current(h,lord)).owned,false);await equip(h,lord,PRODUCT,403);
  await deliver(h,'charge.succeeded',receipt.charge);assert.equal(item(await current(h,lord)).owned,true);assert.equal(item(await current(h,lord)).expiresAt,null);
  const appearance=(await equip(h,lord)).appearance;assert.equal(appearance.town,PRODUCT);assert(appearance.ownedProducts.includes(PRODUCT));
  assert.deepEqual(row(h,lord),before,'Payments and appearance selection do not alter a campaign');
  await equip(h,other,PRODUCT,403);assert.equal(item(await current(h,other)).owned,false);
  const publicLord=await profile(h,lord),publicRetainer=await profile(h,retainer);
  assert.equal(publicLord.homeCastleId,'himeji');assert.equal(publicLord.homeCastleName,'姫路城');assert.equal(publicLord.homeCastleOwnerId,lord.user.id);assert.equal(publicLord.homeCastleAppearance.town,PRODUCT);
  assert.equal(publicRetainer.homeCastleOwnerId,lord.user.id);assert.equal(publicRetainer.homeCastleAppearance.town,PRODUCT);assert.equal(publicRetainer.appearance.town,null);
  const directory=(await h.api('/castles/residency',{token:retainer.token})).data;
  assert.equal(directory.self.lord.appearance.town,PRODUCT);assert.equal(directory.castles.find(c=>c.castleId==='himeji').lord.appearance.town,PRODUCT);
  const field=(await h.api('/field')).data;assert.equal(field.players.find(p=>p.playerId===lord.user.id).appearance.town,PRODUCT);assert.equal(field.players.find(p=>p.playerId===other.user.id).appearance.town,null);
  const event=await publish(h,op,'himeji'),opponent=(await h.api('/events/'+event.id)).data.event.opponent;
  assert.equal(opponent.castleOwnerId,lord.user.id);assert.equal(opponent.castleAppearance.town,PRODUCT);
  for(const value of [publicLord,publicRetainer,opponent])for(const forbidden of [SECRET,receipt.intent,receipt.chargeId,receipt.checkout.id,'isAdmin','isDeputy','stripeProduct','payment_link'])assert(!JSON.stringify(value).includes(forbidden));
  const owned=(await h.api('/premium/checkout',post(lord,{productId:PRODUCT},409))).data;assert.equal(owned.error.code,'ALREADY_OWNED');
  await equip(h,lord,null);assert.equal((await profile(h,retainer)).homeCastleAppearance.town,null);assert.equal(item(await current(h,lord)).owned,true);
  await equip(h,lord);await deliver(h,'refund.created',{id:id('re_'),object:'refund',charge:receipt.chargeId,payment_intent:receipt.intent,amount:980,currency:'jpy',status:'succeeded'});
  assert.equal(item(await current(h,lord)).owned,false);assert.equal((await profile(h,retainer)).homeCastleAppearance.town,null);assert.equal((await h.api('/events/'+event.id)).data.event.opponent.castleAppearance.town,null);
  await complete(h,receipt);assert.equal(item(await current(h,lord)).owned,false,'Old paid notifications cannot resurrect a refunded entitlement');
});
await scenario('account rights survive relocation while the old castle follows its successor',async h=>{
  const lord=await resident(h,'移転する城主','himeji'),heir=await resident(h,'引継ぐ家臣','himeji','retainer');
  await complete(h,payment(h,await checkout(h,lord)));await equip(h,lord);
  const moved=(await h.api('/castles/residency/relocate',post(lord,{deviceId:lord.deviceId,revision:row(h,lord).revision,requestId:crypto.randomUUID(),castleId:'inuyama'}))).data;
  assert.equal(moved.residency.role,'lord');assert.equal(item(await current(h,lord)).owned,true);assert.equal((await current(h,lord)).appearance.town,PRODUCT);
  const relocated=await profile(h,lord),inherited=await profile(h,heir);
  assert.equal(relocated.homeCastleId,'inuyama');assert.equal(relocated.homeCastleAppearance.town,PRODUCT);
  assert.equal(inherited.homeCastleId,'himeji');assert.equal(inherited.homeCastleOwnerId,heir.user.id);assert.equal(inherited.homeCastleAppearance.town,null);assert.equal(item(await current(h,heir)).owned,false);
});
await scenario('wrong price and stale castle ownership cannot issue or grant the new appearance',async h=>{
  const lord=await resident(h,'検証する城主','kiyosu'),heir=await resident(h,'検証する家臣','kiyosu','retainer');
  const reference=await checkout(h,lord),bad=payment(h,reference,{amount_total:1});await complete(h,bad);assert.equal(item(await current(h,lord)).owned,false);
  const wrong=payment(h,reference);wrong.checkout.line_items.data[0].price='price_wrong_fixture';await complete(h,wrong);assert.equal(item(await current(h,lord)).owned,false);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO premium_orders')))return;h.beforeBatch=null;h.sql.prepare('UPDATE castle_seats SET lord_user_id=?,lord_epoch=lord_epoch+1 WHERE castle_id=?').run(heir.user.id,'kiyosu');};
  assert.equal((await h.api('/premium/checkout',post(lord,{productId:PRODUCT},409))).data.error.code,'CASTLE_LORD_REQUIRED');
});
}finally{globalThis.fetch=originalFetch;}
assert.equal(externalRequests,0);console.log(JSON.stringify({passed:cases,calls,externalRequests,realPayments:0}));
