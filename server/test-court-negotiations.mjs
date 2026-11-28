import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createECDH,generateKeyPairSync,randomBytes} from 'node:crypto';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';
import {dispatchMessageNotifications} from './notifications.js';

let scenarios=0,calls=0,maxBindings=0;
const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Negotiation tests cannot contact real services');};
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const statement of statements){maxBindings=Math.max(maxBindings,statement.params.length);assert(statement.params.length<=100,'D1 bind limit');}return batch(statements);};try{await run(h);scenarios++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
function noble(h,p,house='konoe'){h.sql.prepare('INSERT INTO court_lineages(user_id,house_id,original_clan,revision,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(p.user.id,house,save(h,p).state.clan,h.now,h.now);}
async function pair(h){const lord=await fixture(h,'交渉する公家',{startCastle:'inabayama'}),warrior=await fixture(h,'交渉する武家',{startCastle:'kiyosu'});noble(h,lord);return{lord,warrior};}
const core=h=>JSON.stringify(['player_saves','court_negotiations','court_negotiation_requests','court_vassals','notification_social_events','branch_states','covert_states','staff_campaign_backups'].map(t=>[t,h.sql.prepare('SELECT * FROM '+t).all()]));
const cmd=(h,p,id,action,body,expected=200,query='')=>h.api('/court/negotiations'+(id?'/'+id+'/'+action:'')+query,post(p,body,expected));
const proposal=(p,offer={gold:100,rice:50,wood:0,stone:0},extra={})=>({requestId:crypto.randomUUID(),targetPlayerId:p.user.id,offer,confirmed:true,...extra});
const command=(revision,extra={})=>({requestId:crypto.randomUUID(),proposalRevision:revision,confirmed:true,...extra});
const acceptance=(h,p,revision,extra={})=>command(revision,{deviceId:p.deviceId,expectedRevision:row(h,p).revision,...extra});
const propose=async(h,lord,warrior,offer)=> (await cmd(h,lord,null,'propose',proposal(warrior,offer))).data;
const get=async(h,p,id)=> (await h.api('/court/negotiations/'+id,{token:p.token})).data.negotiation;
const list=async(h,p,query='')=>(await h.api('/court/negotiations'+query,{token:p.token})).data;
const relationCount=h=>h.sql.prepare('SELECT COUNT(*) AS n FROM court_vassals').get().n;
const receipts=h=>h.sql.prepare('SELECT COUNT(*) AS n FROM court_negotiation_requests').get().n;
const relationFields=value=>({suzerain:value.suzerain?Object.fromEntries(['id','name','houseName','imperialHouseName'].map(k=>[k,value.suzerain[k]])):null,vassals:value.vassals.map(p=>({id:p.id,name:p.name,clan:p.clan})),vassalCount:value.vassalCount});
try{
 await scope('authentication, strict confirmation, four-resource bounds and semantic receipt identity',async h=>{
  await h.api('/court/negotiations',{expected:401});await h.api('/court/negotiations',{method:'POST',body:{},expected:401});
  const {lord,warrior}=await pair(h),request=proposal(warrior);
  assert.equal((await list(h,warrior)).canPropose,false);assert.equal((await list(h,lord)).canPropose,true);
  assert.deepEqual((await list(h,lord)).rules,{resources:['gold','rice','wood','stone'],maxAmount:1000000,balanceLimit:100000000,maxPending:20});
  for(const bad of [{...request,confirmed:false},{...request,confirmed:undefined},{...request,expectedRevision:1},{...request,offer:{}},{...request,offer:{gold:null}},{...request,offer:{gold:1.1}},{...request,offer:{gold:-1}},{...request,offer:{gold:1000001}},{...request,offer:{gold:1,troops:1}},{...request,offer:{gold:1,iron:1}},{...request,offer:{gold:1,magatama:1}},{...request,targetPlayerId:'bad/id'}])await cmd(h,lord,null,'propose',bad,400);
  const before=core(h);const missing=(await cmd(h,lord,null,'propose',request,404,'?receipt=1')).data;assert.equal(missing.error.code,'COURT_NEGOTIATION_RECEIPT_PENDING');assert.equal(core(h),before);
  await cmd(h,lord,null,'propose',request,400,'?receipt=0');await cmd(h,lord,null,'propose',request,400,'?receipt=1&receipt=1');
  const first=(await cmd(h,lord,null,'propose',request)).data;assert.match(first.negotiation.id,/^cn_[a-f0-9]{32}$/);assert.equal(first.receipt.revision,1);
  const replay=(await cmd(h,lord,null,'propose',request)).data;assert(replay.idempotent);assert.equal(replay.negotiation.id,first.negotiation.id);
  assert.equal((await cmd(h,lord,null,'propose',{...request,offer:{gold:101}},409)).data.error.code,'REQUEST_ID_REUSED');
  assert.equal(receipts(h),1);assert.equal(relationCount(h),0);
 });
 await scope('only the other party may answer the latest conditions; offers and counters do not debit resources',async h=>{
  const {lord,warrior}=await pair(h),before=[row(h,lord),row(h,warrior)],p=await propose(h,lord,warrior),id=p.negotiation.id;
  assert.equal((await get(h,lord,id)).canCancel,true);assert.equal((await get(h,lord,id)).canAccept,false);assert.equal((await get(h,warrior,id)).canCounter,true);
  await cmd(h,lord,id,'accept',acceptance(h,lord,1),403);await cmd(h,warrior,id,'cancel',command(1),403);
  const counter=command(1,{offer:{gold:250,stone:70}}),c=(await cmd(h,warrior,id,'counter',counter)).data;assert.equal(c.receipt.revision,2);assert.equal(c.negotiation.offeredBy,warrior.user.id);
  await cmd(h,warrior,id,'counter',command(2,{offer:{gold:1}}),403);await cmd(h,lord,id,'accept',acceptance(h,lord,1),409);
  const reply=(await cmd(h,lord,id,'counter',command(2,{offer:{gold:200,rice:10}}))).data;assert.equal(reply.receipt.revision,3);
  const old=(await cmd(h,warrior,id,'counter',counter,200,'?receipt=1')).data;assert.equal(old.receipt.revision,2);assert.equal(old.negotiation.revision,3);assert.equal(old.receipt.offer.gold,250);
  assert.deepEqual([row(h,lord),row(h,warrior)],before);
  await cmd(h,warrior,id,'cancel',command(3),403);const cancelled=(await cmd(h,lord,id,'cancel',command(3))).data;assert.equal(cancelled.negotiation.status,'cancelled');assert.equal(cancelled.receipt.revision,4);
  await cmd(h,warrior,id,'reject',command(4),409);assert.equal((await list(h,lord)).negotiations.length,0);assert.equal((await list(h,lord,'?box=history')).negotiations.length,1);
  const second=await propose(h,lord,warrior);assert.equal((await cmd(h,warrior,second.negotiation.id,'reject',command(1))).data.negotiation.status,'rejected');assert.deepEqual([row(h,lord),row(h,warrior)],before);
 });
 await scope('accepting a warrior counter transfers all four resources once and exposes only public relationships',async h=>{
  const {lord,warrior}=await pair(h),offer={gold:251,rice:37,wood:29,stone:13},p=await propose(h,lord,warrior),id=p.negotiation.id;
  await cmd(h,warrior,id,'counter',command(1,{offer}));const oldLord=row(h,lord),oldWarrior=row(h,warrior),beforeLord=save(h,lord),beforeWarrior=save(h,warrior),request=acceptance(h,lord,2);
  const accepted=(await cmd(h,lord,id,'accept',request)).data;assert.equal(accepted.negotiation.status,'accepted');assert.equal(accepted.receipt.revision,3);assert.equal(relationCount(h),1);
  for(const key of Object.keys(offer)){assert.equal(save(h,lord).state.resources[key],beforeLord.state.resources[key]-offer[key]);assert.equal(save(h,warrior).state.resources[key],beforeWarrior.state.resources[key]+offer[key]);}
  assert.equal(row(h,lord).revision,oldLord.revision+1);assert.equal(row(h,warrior).revision,oldWarrior.revision+1);assert.equal(row(h,warrior).writer_device_id,oldWarrior.writer_device_id);assert.equal(row(h,warrior).lease_expires_at,oldWarrior.lease_expires_at);
  for(const [p,before]of [[lord,beforeLord],[warrior,beforeWarrior]]){const after=save(h,p);assert.equal(after.state.home,before.state.home);assert.equal(after.state.clan,before.state.clan);assert.equal(after.state.walking.campaignId,before.state.walking.campaignId);assert.equal(after.state.troops,before.state.troops);}
  const warriorPublic=(await h.api('/players/'+warrior.user.id+'/profile')).data.player.courtRelations,lordPublic=(await h.api('/players/'+lord.user.id+'/profile')).data.player.courtRelations;
  assert.deepEqual(relationFields(warriorPublic),{suzerain:{id:lord.user.id,name:lord.user.name,houseName:'近衛家',imperialHouseName:null},vassals:[],vassalCount:0});
  assert.deepEqual(relationFields(lordPublic),{suzerain:null,vassals:[{id:warrior.user.id,name:warrior.user.name,clan:beforeWarrior.state.clan}],vassalCount:1});
  assert.deepEqual(accepted.user.courtRelations,lordPublic);assert.equal(accepted.user.canOperate,false);assert.equal(accepted.user.isStaff,false);
  for(const value of [lordPublic,warriorPublic])for(const privateKey of ['offer','requestId','campaign','hash','gold','rice','wood','stone'])assert(!JSON.stringify(value).includes(privateKey));
  const committed=core(h);assert.equal((await cmd(h,lord,id,'accept',request)).data.idempotent,true);assert.equal(core(h),committed);
 });
 await scope('insufficient funds and recipient caps preserve pending terms and allow the same semantic retry',async h=>{
  const {lord,warrior}=await pair(h),p=await propose(h,lord,warrior,{gold:1000000}),id=p.negotiation.id,request=acceptance(h,warrior,1),before=core(h);
  assert.equal((await cmd(h,warrior,id,'accept',request,409)).data.error.code,'INSUFFICIENT_ASSETS');assert.equal(core(h),before);
  updateSave(h,lord,s=>s.resources.gold=1000000);updateSave(h,warrior,s=>s.resources.gold=100000000);request.expectedRevision=row(h,warrior).revision;
  const capped=core(h);assert.equal((await cmd(h,warrior,id,'accept',request,409)).data.error.code,'ASSET_LIMIT');assert.equal(core(h),capped);
  updateSave(h,warrior,s=>s.resources.gold=500);request.expectedRevision=row(h,warrior).revision;
  const accepted=(await cmd(h,warrior,id,'accept',request)).data;assert.equal(accepted.negotiation.status,'accepted');assert.equal(save(h,lord).state.resources.gold,0);assert.equal(save(h,warrior).state.resources.gold,1000500);assert.equal(receipts(h),2);
 });
 await scope('eligible nobles include formal operator families; warriors exclude self, nobles and household retainers',async h=>{
  const {lord,warrior}=await pair(h),other=await fixture(h,'同じ城の家臣',{startCastle:'kiyosu'}),nobleTarget=await fixture(h,'別の公家',{startCastle:'odawara'});noble(h,nobleTarget,'kujo');
  for(const target of [lord,other,nobleTarget]){const r=(await h.api('/court/negotiations/recipient?playerId='+target.user.id,{token:lord.token})).data;assert.equal(r.eligible,false);await cmd(h,lord,null,'propose',proposal(target),409);}
  await cmd(h,warrior,null,'propose',proposal(lord),409);
  const operator=await fixture(h,'正式家柄の運営',{admin:true});assert.equal((await list(h,operator)).canPropose,false);noble(h,operator,'takatsukasa');assert.equal((await list(h,operator)).canPropose,true);
  const p=await propose(h,operator,warrior);await cmd(h,warrior,p.negotiation.id,'accept',acceptance(h,warrior,1));assert.equal(relationCount(h),1);assert.equal((await get(h,operator,p.negotiation.id)).status,'accepted');
  await cmd(h,lord,null,'propose',proposal(warrior),409);assert.equal((await list(h,warrior)).canPropose,false);
  const outsider=await fixture(h,'専用役職への勧誘',{startCastle:'odani'});await cmd(h,lord,null,'propose',proposal(operator),409);
  h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,0)').run(outsider.user.id,operator.user.id,h.now,'staff-candidate');await cmd(h,lord,null,'propose',proposal(outsider),409);
 });
 await scope('private lists and receipts cannot be read or changed by outsiders; pagination is stable',async h=>{
  const {lord,warrior}=await pair(h),outsider=await fixture(h,'交渉外の閲覧者',{startCastle:'odawara'});
  for(let i=0;i<3;i++){const p=await propose(h,lord,warrior,{gold:i+1});await cmd(h,warrior,p.negotiation.id,'reject',command(1));}
  const first=await list(h,lord,'?box=history&limit=2');assert.equal(first.negotiations.length,2);assert(first.nextCursor);const last=await list(h,lord,'?box=history&limit=2&cursor='+first.nextCursor);assert.equal(last.negotiations.length,1);assert.equal(last.nextCursor,null);assert.equal(new Set([...first.negotiations,...last.negotiations].map(n=>n.id)).size,3);
  const id=first.negotiations[0].id;await h.api('/court/negotiations/'+id,{token:outsider.token,expected:404});await cmd(h,outsider,id,'reject',command(1),404);
  const request=h.sql.prepare("SELECT result_json FROM court_negotiation_requests WHERE action='propose' LIMIT 1").get(),known=JSON.parse(request.result_json);await cmd(h,outsider,null,'propose',proposal(warrior,known.offer,{requestId:known.requestId}),404,'?receipt=1');
  assert.deepEqual((await list(h,outsider)).negotiations,[]);await h.api('/court/negotiations?limit=0',{token:lord.token,expected:400});
  await h.api('/court/negotiations?box=active&cursor='+first.nextCursor,{token:lord.token,expected:400});await h.api('/court/negotiations/nope',{token:lord.token,expected:404});
 });
 await scope('both save revisions, roles, branches, world clock and latest proposal are fenced at commit',async h=>{
  const {lord,warrior}=await pair(h),p=await propose(h,lord,warrior),id=p.negotiation.id;
  const races=[
   ['actor save',()=>h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(warrior.user.id)],
   ['payer save',()=>h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(lord.user.id)],
   ['clock',()=>h.sql.prepare('UPDATE world_clock SET revision=revision+1').run()],
   ['branch ledger',()=>h.sql.prepare("INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,updated_at) VALUES(?,?,1,'{\"branches\":[],\"jobs\":[]}',?) ON CONFLICT(actor_id,campaign_id) DO UPDATE SET sequence=sequence+1").run(warrior.user.id,save(h,warrior).state.walking.campaignId,h.now)],
   ['latest conditions',()=>h.sql.prepare('UPDATE court_negotiations SET revision=revision+1,offer_json=? WHERE id=?').run(JSON.stringify({gold:200,rice:0,wood:0,stone:0}),id)]
  ];
  for(const [name,race]of races){const request=acceptance(h,warrior,(await get(h,warrior,id)).revision),before=[save(h,lord).state.resources,save(h,warrior).state.resources],count=receipts(h);h.beforeBatch=statements=>{if(!statements[0].sql.startsWith('INSERT INTO court_negotiation_requests'))return;h.beforeBatch=null;race();};await cmd(h,warrior,id,'accept',request,409);assert.equal(receipts(h),count,name);assert.equal(relationCount(h),0,name);assert.deepEqual([save(h,lord).state.resources,save(h,warrior).state.resources],before,name);}
  const request=acceptance(h,warrior,(await get(h,warrior,id)).revision);h.beforeBatch=statements=>{if(!statements[0].sql.startsWith('INSERT INTO court_negotiation_requests'))return;h.beforeBatch=null;noble(h,warrior,'nijo');};assert.equal((await cmd(h,warrior,id,'accept',request,409)).data.error.code,'COURT_NEGOTIATION_INELIGIBLE');assert.equal(relationCount(h),0);
 });
 await scope('a failed atomic batch cannot retain a receipt, debit, credit, relationship or notification',async h=>{
  const {lord,warrior}=await pair(h),p=await propose(h,lord,warrior),request=acceptance(h,warrior,1),before=core(h);
  h.beforeBatch=statements=>{if(!statements[0].sql.startsWith('INSERT INTO court_negotiation_requests'))return;h.beforeBatch=null;statements.push(h.db.prepare('SELECT * FROM intentionally_missing_negotiation_table'));};
  await cmd(h,warrior,p.negotiation.id,'accept',request,500);assert.equal(core(h),before);await cmd(h,warrior,p.negotiation.id,'accept',request);assert.equal(relationCount(h),1);
 });
 await scope('concurrent duplicate acceptance transfers once while competing lords cannot gain the same warrior',async h=>{
  const {lord,warrior}=await pair(h),other=await fixture(h,'競合する公家',{startCastle:'odawara'});noble(h,other,'kujo');
  const p=await propose(h,lord,warrior),q=await propose(h,other,warrior),request=acceptance(h,warrior,1),before=save(h,lord).state.resources.gold;
  let arrivals=0,release;const barrier=new Promise(resolve=>release=resolve);h.beforeBatch=async statements=>{if(!statements[0].sql.startsWith('INSERT INTO court_negotiation_requests'))return;if(++arrivals===2){h.beforeBatch=null;release();}await barrier;};
  const responses=await Promise.all([cmd(h,warrior,p.negotiation.id,'accept',request),cmd(h,warrior,p.negotiation.id,'accept',request)]);assert.equal(responses.filter(r=>!r.data.idempotent).length,1);assert.equal(save(h,lord).state.resources.gold,before-100);assert.equal(relationCount(h),1);
  await cmd(h,warrior,q.negotiation.id,'accept',acceptance(h,warrior,1),409);assert.equal((await get(h,other,q.negotiation.id)).status,'pending');assert.equal(save(h,other).state.resources.gold,900000);assert.equal(receipts(h),3);
 });
 await scope('lost responses recover receipt-first with fresh writer metadata and never recreate ended service',async h=>{
  const {lord,warrior}=await pair(h),p=await propose(h,lord,warrior),id=p.negotiation.id,request=acceptance(h,warrior,1);
  h.afterBatch=statements=>{if(!statements[0].sql.startsWith('INSERT INTO court_negotiation_requests'))return;h.afterBatch=null;throw Error('response lost after commit');};await cmd(h,warrior,id,'accept',request,500);assert.equal(relationCount(h),1);
  const accepted=core(h),replay=(await cmd(h,warrior,id,'accept',{...request,deviceId:'different-device',expectedRevision:0},200,'?receipt=1')).data;assert.equal(replay.negotiation.status,'accepted');assert(replay.idempotent);assert.equal(core(h),accepted);
  await cmd(h,warrior,id,'accept',{...request,proposalRevision:2},409,'?receipt=1');noble(h,warrior,'ichijo');assert.equal(relationCount(h),0);const ended=core(h);await cmd(h,warrior,id,'accept',request);assert.equal(core(h),ended);assert.equal(relationCount(h),0);
  const status=(await h.api('/me',{token:lord.token})).data;assert(status.socialNotifications.some(n=>n.kind==='court-vassal-ended'));assert.equal(status.user.courtRelations.vassalCount,0);
 });
 await scope('propose, counter, reject, cancel and accept notify only their recipient with push deduplication',async h=>{
  const {lord,warrior}=await pair(h),keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=keys.publicKey.export({format:'jwk'});Object.assign(h.env,{WEB_PUSH_PRIVATE_JWK:JSON.stringify(keys.privateKey.export({format:'jwk'})),WEB_PUSH_PUBLIC_KEY:Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url')});
  for(const p of [lord,warrior]){const ecdh=createECDH('prime256v1');ecdh.generateKeys();p.endpoint='https://fcm.googleapis.com/fcm/send/'+crypto.randomUUID();await h.api('/notifications/preferences',post(p,{enabled:true,battle:true,letter:true,operation:true,construction:true,event:true,chat:true,worldChat:false,announcement:true,quietStart:0,quietEnd:0,digestMinutes:0}));await h.api('/notifications/subscribe',post(p,{subscription:{endpoint:p.endpoint,keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}}));}
  const sent=[],strictFetch=globalThis.fetch;globalThis.fetch=async(url)=>{sent.push(url);return new Response(null,{status:201});};
  try{const immediate=async(actor,id,action,recipient)=>{const path='/court/negotiations'+(id?'/'+id+'/'+action:'');assert.equal((await dispatchMessageNotifications(h.env,null,{path,actorId:actor.user.id,since:h.now})).sent,1);assert.equal(sent.at(-1),recipient.endpoint);assert.equal((await dispatchMessageNotifications(h.env,null,{path,actorId:actor.user.id,since:h.now})).sent,0);};
   let p=await propose(h,lord,warrior);await immediate(lord,null,null,warrior);assert.equal((await h.api('/me',{token:warrior.token})).data.unreadSocial.court,1);
   await cmd(h,warrior,p.negotiation.id,'counter',command(1,{offer:{gold:123}}));await immediate(warrior,p.negotiation.id,'counter',lord);assert.equal((await h.api('/me',{token:warrior.token})).data.unreadSocial.court,0,'the obsolete terms no longer count');
   await cmd(h,lord,p.negotiation.id,'reject',command(2));await immediate(lord,p.negotiation.id,'reject',warrior);
   p=await propose(h,lord,warrior);await immediate(lord,null,null,warrior);await cmd(h,lord,p.negotiation.id,'cancel',command(1));await immediate(lord,p.negotiation.id,'cancel',warrior);
   p=await propose(h,lord,warrior);await immediate(lord,null,null,warrior);await cmd(h,warrior,p.negotiation.id,'accept',acceptance(h,warrior,1));await immediate(warrior,p.negotiation.id,'accept',lord);assert.equal(sent.length,7);
   const box=(await h.api('/me',{token:lord.token})).data,notice=box.socialNotifications.find(n=>n.kind==='court-negotiation-accepted');assert.equal(notice.destination,'courtNegotiations');assert.equal(box.unreadSocial.court,1);await h.api('/notifications/read',post(lord,{ids:[notice.id]}));assert.equal((await h.api('/me',{token:lord.token})).data.unreadSocial.court,0);
  }finally{globalThis.fetch=strictFetch;}
 });
 for(const empty of [false,true]){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');const entries=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url))).entries;
  for(const entry of entries.filter(e=>e.idx<61))for(const statement of readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))sql.exec(statement);
  sql.exec("INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES('a','a','a','織田家','a',1,1),('b','b','b','斎藤家','b',1,1); INSERT INTO notification_social_events(seq,id,user_id,actor_id,kind,destination,source_id,audience,created_at,expires_at,read_at,push_eligible) VALUES(900,'keep','a','b','friend-request','friends','source','person',10,999999,15,0),(999,'deleted','a','b','trade-offer','trade','old','person',12,999999,NULL,1); DELETE FROM notification_social_events WHERE id='deleted';");
  if(empty)sql.exec('DELETE FROM notification_social_events');const before=sql.prepare('SELECT * FROM notification_social_events').all();
  for(const statement of readFileSync(new URL('./drizzle/0061_court_negotiations.sql',import.meta.url),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))sql.exec(statement);
  assert.deepEqual(sql.prepare('SELECT * FROM notification_social_events').all(),before);assert.equal(sql.prepare("SELECT seq FROM sqlite_sequence WHERE name='notification_social_events'").get().seq,999);
  const inserted=sql.prepare("INSERT INTO notification_social_events(id,user_id,actor_id,kind,destination,audience,created_at,expires_at) VALUES('new','a','b','court-negotiation-proposed','courtNegotiations','person',20,999999) RETURNING seq,push_eligible").get();assert.equal(inserted.seq,1000);assert.equal(inserted.push_eligible,1);assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);sql.close();scenarios++;console.log('PASS destination migration preserves '+(empty?'empty':'populated')+' inbox high-water, consent and read state');
 }
 console.log(JSON.stringify({ok:true,scenarios,calls,maxBindings}));
}finally{globalThis.fetch=oldFetch;}
