import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

// Exercise the real Worker and journal migrations against transactional local
// SQLite. No production player, service, or payment is used by this suite.
const post=(actor,body,expected=200)=>({method:'POST',token:actor?.token,body,expected});
const rows=(h,table)=>h.sql.prepare('SELECT * FROM '+table).all();
const saved=(h,actor)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(actor.user.id);
const campaign=(h,actor)=>JSON.parse(saved(h,actor).save_json);
const member=(h,actor)=>h.sql.prepare('SELECT * FROM castle_residents WHERE user_id=?').get(actor.user.id);
const seat=(h,id)=>h.sql.prepare('SELECT * FROM castle_seats WHERE castle_id=?').get(id);
const read=async(h,actor,path)=>(await h.api(path,{token:actor?.token})).data;
const details=(h,operator,target)=>read(h,operator,'/admin/moderation/target?playerId='+target.user.id);
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
const startBody=(h,actor,castleId,mode='lord')=>({deviceId:actor.deviceId,revision:saved(h,actor).revision,requestId:crypto.randomUUID(),castleId,mode,clan:'織田家',difficulty:'normal'});
async function account(h,name){const actor=await h.session(name);actor.deviceId='expulsion-'+actor.user.id;await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}));return actor;}
async function player(h,name,castleId='kiyosu',mode='lord'){
 const actor=await account(h,name);actor.startBody=startBody(h,actor,castleId,mode);
 actor.started=(await h.api('/castles/residency/start',post(actor,actor.startBody))).data;return actor;
}
async function administrator(h){const actor=await h.session('追放を管理する運営');await h.api('/admin/claim',post(actor,{key:h.env.SENGOKU_ADMIN_KEY}));return actor;}
async function request(h,operator,target,extra={}){
 const current=await details(h,operator,target);
 return{targetPlayerId:target.user.id,requestId:crypto.randomUUID(),reason:'拠点解放を検証する非公開理由',expectedRevision:current.expulsion.revision,expectedCastleId:current.expulsion.castleId,expectedLordEpoch:current.expulsion.lordEpoch,...extra};
}
const expel=async(h,operator,body,expected=200)=>(await h.api('/admin/moderation/expel',post(operator,body,expected))).data;
async function relocate(h,actor,castleId){return(await h.api('/castles/residency/relocate',post(actor,{deviceId:actor.deviceId,revision:saved(h,actor).revision,requestId:crypto.randomUUID(),castleId}))).data;}
const effects=h=>Object.fromEntries(['castle_seats','castle_residents','player_saves','player_bans','player_expulsions','expulsion_requests','expelled_campaigns','messages','base_letter_messages'].map(table=>[table,rows(h,table)]));
const expulsionBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO expulsion_requests'));
function tune(h,actor,change){const save=campaign(h,actor);change(save.state);h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(save),actor.user.id);}
async function reenter(h,actor,castleId,mode='lord'){
 await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}));
 const body=startBody(h,actor,castleId,mode);return{body,data:(await h.api('/castles/residency/start',post(actor,body))).data};
}
function premiumFixture(h,actor){
 const reference='expulsion-premium-reference',session='cs_expulsion_fixture',intent='pi_expulsion_fixture';
 h.sql.prepare('INSERT INTO premium_orders(reference,user_id,product_id,created_at) VALUES(?,?,?,?)').run(reference,actor.user.id,'gold-banner',h.now);
 h.sql.prepare('INSERT INTO premium_sessions(session_id,reference,product_id,mode,payment_intent_id,amount,currency,paid,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(session,reference,'gold-banner','payment',intent,480,'jpy',1,h.now);
 h.sql.prepare('INSERT INTO premium_charges(charge_id,payment_intent_id,amount,currency,captured,created_at) VALUES(?,?,?,?,?,?)').run('ch_expulsion_fixture',intent,480,'jpy',1,h.now);
 h.sql.prepare('INSERT INTO premium_appearances(user_id,nameplate,updated_at) VALUES(?,?,?)').run(actor.user.id,'gold-banner',h.now);
}
let scenarios=0,calls=0,maxBindings=0;
async function scope(name,run){
 const h=harness(),batch=h.db.batch.bind(h.db);
 h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100,'D1 binding limit: '+s.params.length);}return batch(statements);};
 try{await run(h);scenarios++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}
}
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Expulsion tests must never access the network');};
try{
await scope('only the current operator can expel; operator, staff and banned targets are protected',async h=>{
 const operator=await administrator(h),target=await player(h,'対象の領主'),peer=await player(h,'別城の領主','inuyama');
 const q=await request(h,operator,target),before=effects(h);
 await expel(h,null,q,401);await expel(h,peer,q,403);assert.deepEqual(effects(h),before);
 for(const extra of [{expectedRevision:-1},{expectedRevision:'0'},{expectedLordEpoch:-1},{requestId:null},{reason:'字'.repeat(301)},{unrecognized:true}])await expel(h,operator,{...q,...extra},400);
 assert.deepEqual(effects(h),before);
 const self=await details(h,operator,operator);assert.equal(self.canExpel,false);
 const rejected=await h.api('/admin/moderation/expel',post(operator,{...q,targetPlayerId:operator.user.id},null));assert(rejected.response.status>=400&&rejected.response.status<500);
 await h.api('/admin/staff',post(operator,{targetPlayerId:peer.user.id,action:'appoint',requestId:crypto.randomUUID()}));
 const staff=await details(h,operator,peer);assert.equal(staff.canExpel,false);assert(staff.expulsion.blockedReason);
 const staffAttempt=await h.api('/admin/moderation/expel',post(operator,{...q,targetPlayerId:peer.user.id,expectedCastleId:'inuyama'},null));assert(staffAttempt.response.status>=400&&staffAttempt.response.status<500);
 await h.api('/admin/moderation',post(operator,{targetPlayerId:target.user.id,action:'ban',requestId:crypto.randomUUID(),expectedRevision:0,reason:'ローカル検証'}));
 const banned=await details(h,operator,target);assert.equal(banned.canExpel,false);assert(banned.expulsion.blockedReason);
 const bannedAttempt=await h.api('/admin/moderation/expel',post(operator,q,null));assert(bannedAttempt.response.status>=400&&bannedAttempt.response.status<500);
 assert.equal(count(h,'expulsion_requests'),0);
});

await scope('expelling a lord opens the shared castle while retaining the other residents and all posts',async h=>{
 const operator=await administrator(h),target=await player(h,'追放される城主'),first=await player(h,'先着家臣','kiyosu','retainer'),second=await player(h,'後着家臣','kiyosu','retainer'),neighbor=await player(h,'隣城主','inuyama');
 await h.api('/chat',post(target,{channel:'world',text:'追放後も保持する投稿'}));
 await h.api('/letters',post(target,{requestId:crypto.randomUUID(),targetPlayerId:neighbor.user.id,destination:'player',text:'追放後も保持する書状'}));
 const otherMembers=[member(h,first),member(h,second)],otherSaves=[saved(h,first),saved(h,second),saved(h,neighbor)],posts=[rows(h,'messages'),rows(h,'base_letter_messages')],epoch=seat(h,'kiyosu').lord_epoch;
 const q=await request(h,operator,target),result=await expel(h,operator,q);
 assert.equal(result.receipt.action,'expel');assert.equal(result.receipt.targetPlayerId,target.user.id);assert.equal(result.receipt.actorPlayerId,operator.user.id);assert.equal(result.receipt.castleId,'kiyosu');assert.equal(result.receipt.released,true);
 assert.equal(seat(h,'kiyosu').lord_user_id,null);assert(seat(h,'kiyosu').lord_epoch>epoch);assert.equal(member(h,target),undefined);
 assert.deepEqual([member(h,first),member(h,second)],otherMembers);assert.deepEqual([saved(h,first),saved(h,second),saved(h,neighbor)],otherSaves);
 assert.deepEqual([rows(h,'messages'),rows(h,'base_letter_messages')],posts);assert.equal(result.ban.active,false);assert.equal(result.canExpel,false);assert.equal(result.expulsion.pending,true);
 const directory=await read(h,null,'/castles/residency');const vacant=directory.castles.find(c=>c.castleId==='kiyosu');assert.equal(vacant.available,true);assert.equal(vacant.lord,null);assert.equal(vacant.retainerCount,2);
 const field=await read(h,neighbor,'/field');assert(!field.players.some(p=>p.playerId===target.user.id));
 assert.equal((await read(h,target,'/me')).user.id,target.user.id,'Expulsion must not ban or delete the account');
 h.resetRates();
 await h.api('/chat',post(target,{channel:'world',text:'追放後も利用できる会話'}));
 const newcomer=await player(h,'空いた城を選ぶ領主','kiyosu');assert.equal(newcomer.started.residency.role,'lord');assert.equal(seat(h,'kiyosu').lord_user_id,newcomer.user.id);
 assert.deepEqual([member(h,first),member(h,second)],otherMembers);assert.equal((await read(h,first,'/castles/residency')).self.lordPlayerId,newcomer.user.id);
});

await scope('expelling a retainer removes only that person and cannot clear the incumbent lord',async h=>{
 const operator=await administrator(h),lord=await player(h,'継続する城主'),target=await player(h,'除籍される家臣','kiyosu','retainer'),peer=await player(h,'残る家臣','kiyosu','retainer');
 const previousSeat=seat(h,'kiyosu'),peerMember=member(h,peer),lordSave=saved(h,lord),q=await request(h,operator,target);
 const result=await expel(h,operator,q);assert.equal(result.receipt.role,'retainer');assert.equal(result.receipt.released,false);
 assert.equal(seat(h,'kiyosu').lord_user_id,lord.user.id);assert.equal(seat(h,'kiyosu').lord_epoch,previousSeat.lord_epoch);assert.equal(member(h,target),undefined);
 assert.deepEqual(member(h,peer),peerMember);assert.deepEqual(saved(h,lord),lordSave);
 const directory=await read(h,null,'/castles/residency'),castle=directory.castles.find(c=>c.castleId==='kiyosu');assert.equal(castle.available,false);assert.equal(castle.retainerCount,1);
});

await scope('old saves cannot restore an expelled seat, and explicit readmission keeps the identity, officers and purchases',async h=>{
 const operator=await administrator(h),target=await player(h,'再入城する領主'),neighbor=await player(h,'別の領主','inuyama');
 tune(h,target,s=>{s.resources.gold=90;s.magatama=15;s.buildings.keep=8;s.tech.siege=2;s.stats.gachaDraws=5;s.stats.gachaDuplicates=2;});
 premiumFixture(h,target);const old=campaign(h,target),name=target.user.name,purchases=rows(h,'premium_orders'),grants=rows(h,'premium_grants');
 assert((await read(h,target,'/premium')).products.find(p=>p.id==='gold-banner').owned);
 const q=await request(h,operator,target);await expel(h,operator,q);
 const pending=await read(h,target,'/sync?deviceId='+target.deviceId);assert.equal(pending.expulsion.pending,true);assert.equal(pending.save,null);assert.equal(pending.residency,null);assert.equal(pending.writable,false);
 await h.api('/sync/lease',post(target,{deviceId:target.deviceId}));
 for(const data of [old,{...old,state:{...old.state,walking:{...old.state.walking,campaignId:'forged_after_expulsion'}}}]){
  const denied=(await h.api('/sync',{method:'PUT',token:target.token,body:{deviceId:target.deviceId,revision:saved(h,target).revision,save:data},expected:409})).data;
  assert.equal(denied.error.code,'BASE_EXPELLED');assert.equal(member(h,target),undefined);assert.equal(seat(h,'kiyosu').lord_user_id,null);
 }
 const joined=await reenter(h,target,'himeji'),next=joined.data;
 assert.equal(next.expulsion?.pending,false);assert.equal(next.residency.castleId,'himeji');assert.equal(next.residency.role,'lord');assert.equal(next.save.state.home,'himeji');assert.equal(next.user.id,target.user.id);assert.equal(next.user.name,name);
 assert.deepEqual(next.save.state.officers,old.state.officers);assert.deepEqual(next.save.state.officerVariants,old.state.officerVariants);assert.deepEqual(next.save.state.progress.officers,old.state.progress.officers);
 assert.notEqual(next.save.state.walking.campaignId,old.state.walking.campaignId);assert(next.save.state.resources.gold<=90);assert(next.save.state.magatama<=15);assert.equal(next.save.state.tech.siege,0);
 assert.deepEqual(rows(h,'premium_orders'),purchases);assert.deepEqual(rows(h,'premium_grants'),grants);assert((await read(h,target,'/premium')).products.find(p=>p.id==='gold-banner').owned);
 const replaced=(await h.api('/sync',{method:'PUT',token:target.token,body:{deviceId:target.deviceId,revision:saved(h,target).revision,save:old},expected:409})).data;assert.equal(replaced.error.code,'CAMPAIGN_RELOCATED');
 const repeated=(await h.api('/castles/residency/start',post(target,joined.body))).data;assert(repeated.admission.idempotent);assert.equal(repeated.residency.castleId,'himeji');
 const latest=saved(h,target),replayed=await expel(h,operator,q);assert.equal(replayed.expulsion.pending,false);assert.deepEqual(saved(h,target),latest);assert.equal(member(h,target).castle_id,'himeji');
 assert.equal(seat(h,'inuyama').lord_user_id,neighbor.user.id);
});

await scope('duplicate requests and a lost response apply expulsion once and preserve a durable audit receipt',async h=>{
 const operator=await administrator(h),target=await player(h,'二重操作の領主'),q=await request(h,operator,target),revision=saved(h,target).revision;
 const repeated=await Promise.all([expel(h,operator,q),expel(h,operator,q)]);
 assert.equal(count(h,'expulsion_requests'),1);assert.equal(saved(h,target).revision,revision+1);assert.deepEqual(repeated[0].receipt,repeated[1].receipt);
 await expel(h,operator,{...q,reason:'同番号の違う理由'},409);
 const second=await player(h,'応答消失の領主','inuyama'),lostRequest=await request(h,operator,second);let hit=false;
 h.afterBatch=statements=>{if(expulsionBatch(statements)){h.afterBatch=null;hit=true;throw Error('Fixture lost response after expulsion commit');}};
 await expel(h,operator,lostRequest,500);assert(hit);const stored=saved(h,second),again=await expel(h,operator,lostRequest);
 assert.equal(again.receipt.requestId,lostRequest.requestId);assert.equal(again.expulsion.pending,true);assert.deepEqual(saved(h,second),stored);assert.equal(count(h,'expulsion_requests'),2);
});

await scope('a confirmation for an earlier castle cannot expel a relocated player, including a commit-time race',async h=>{
 const operator=await administrator(h),target=await player(h,'確認後に移転する領主'),stale=await request(h,operator,target);
 await relocate(h,target,'inuyama');await expel(h,operator,stale,409);assert.equal(member(h,target).castle_id,'inuyama');assert.equal(count(h,'expulsion_requests'),0);
 const q=await request(h,operator,target);let hit=false;
 h.beforeBatch=async statements=>{if(expulsionBatch(statements)){h.beforeBatch=null;hit=true;await relocate(h,target,'himeji');}};
 await expel(h,operator,q,409);assert(hit);assert.equal(member(h,target).castle_id,'himeji');assert.equal(seat(h,'himeji').lord_user_id,target.user.id);assert.equal(count(h,'expulsion_requests'),0);
});

await scope('a retainer moving after target review cannot be expelled from the new castle under the old confirmation',async h=>{
 const operator=await administrator(h),lord=await player(h,'家臣の元領主'),target=await player(h,'確認直後に移る家臣','kiyosu','retainer'),q=await request(h,operator,target),epoch=seat(h,'kiyosu').lord_epoch;let hit=false;
 h.beforeStatement=async(sql,params)=>{if(sql==='SELECT * FROM player_saves WHERE user_id=?'&&params[0]===target.user.id){h.beforeStatement=null;hit=true;await relocate(h,target,'inuyama');}};
 await expel(h,operator,q,409);assert(hit);assert.equal(member(h,target).castle_id,'inuyama');assert.equal(seat(h,'kiyosu').lord_user_id,lord.user.id);assert.equal(seat(h,'kiyosu').lord_epoch,epoch);assert.equal(count(h,'expulsion_requests'),0);
});

await scope('a newly appointed staff member and a replaced operator are rechecked at the transaction boundary',async h=>{
 const operator=await administrator(h),target=await player(h,'任命される領主'),q=await request(h,operator,target);let staffRace=false;
 h.beforeBatch=async statements=>{if(expulsionBatch(statements)){h.beforeBatch=null;staffRace=true;await h.api('/admin/staff',post(operator,{targetPlayerId:target.user.id,action:'appoint',requestId:crypto.randomUUID()}));}};
 const changed=await h.api('/admin/moderation/expel',post(operator,q,null));assert(staffRace);assert(changed.response.status>=400&&changed.response.status<500);assert.equal(count(h,'expulsion_requests'),0);
 const ordinary=await player(h,'運営交代時の対象','inuyama'),replacement=await account(h,'後任の運営'),next=await request(h,operator,ordinary);let adminRace=false;
 h.beforeBatch=async statements=>{if(expulsionBatch(statements)){h.beforeBatch=null;adminRace=true;h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(replacement.user.id);}};
 await expel(h,operator,next,403);assert(adminRace);assert.equal(member(h,ordinary).castle_id,'inuyama');assert.equal(count(h,'expulsion_requests'),0);
});

await scope('an in-flight save cannot cross expulsion and resurrect either the old home or its writer lease',async h=>{
 const operator=await administrator(h),target=await player(h,'保存中の領主'),old=campaign(h,target),q=await request(h,operator,target),revision=saved(h,target).revision;let hit=false;
 old.state.resources.gold-=1;
 h.beforeBatch=async statements=>{if(statements.some(s=>s.sql.includes('UPDATE player_saves SET save_json='))){h.beforeBatch=null;hit=true;await expel(h,operator,q);}};
 const writing=await h.api('/sync',{method:'PUT',token:target.token,body:{deviceId:target.deviceId,revision,save:old},expected:409});assert(hit);
 assert(['ACCOUNT_ACCESS_CHANGED','BASE_EXPELLED','REVISION_CONFLICT'].includes(writing.data.error.code));assert.equal(member(h,target),undefined);assert.equal(seat(h,'kiyosu').lord_user_id,null);assert.equal(saved(h,target).writer_device_id,null);
 assert.equal((await read(h,target,'/sync')).save,null);assert.equal(count(h,'expulsion_requests'),1);
});

await scope('a failure while clearing residence rolls back the audit, save, epoch and released seat together',async h=>{
 const operator=await administrator(h),target=await player(h,'原子的な追放対象'),q=await request(h,operator,target),before=effects(h);
 h.sql.exec("CREATE TRIGGER expulsion_fixture_rollback BEFORE DELETE ON castle_residents BEGIN SELECT RAISE(ABORT,'fixture expulsion rollback'); END");
 await expel(h,operator,q,500);assert.deepEqual(effects(h),before);
 h.sql.exec('DROP TRIGGER expulsion_fixture_rollback');await expel(h,operator,q);assert.equal(count(h,'expulsion_requests'),1);assert.equal(seat(h,'kiyosu').lord_user_id,null);
});

await scope('pending trades become intact sender refunds and active walking stops without deleting earned steps',async h=>{
 const operator=await administrator(h),target=await player(h,'取引と歩行の対象'),peer=await player(h,'取引相手','inuyama');
 const tradeBody=(a,b,offer)=>({requestId:crypto.randomUUID(),targetPlayerId:b.user.id,deviceId:a.deviceId,expectedRevision:saved(h,a).revision,offer,want:{rice:10}});
 const incoming=(await h.api('/trades',post(peer,tradeBody(peer,target,{gold:100})))).data.trade.id;
 const outgoing=(await h.api('/trades',post(target,tradeBody(target,peer,{wood:70})))).data.trade.id;
 const session=(await h.api('/walking/start',post(target,{requestId:crypto.randomUUID(),deviceId:target.deviceId,expectedRevision:saved(h,target).revision,campaignId:campaign(h,target).state.walking.campaignId}))).data.walkingSession;
 const walking=h.sql.prepare('SELECT total_steps FROM walking_accounts WHERE user_id=?').get(target.user.id).total_steps,peerSave=saved(h,peer);
 await expel(h,operator,await request(h,operator,target));
 for(const [id,owner,asset,amount] of [[incoming,peer,'gold',100],[outgoing,target,'wood',70]]){
  assert.equal(h.sql.prepare('SELECT status FROM trades WHERE id=?').get(id).status,'cancelled');
  const refund=h.sql.prepare('SELECT * FROM trade_deliveries WHERE trade_id=?').get(id);assert.equal(refund.recipient_id,owner.user.id);assert.equal(refund.kind,'refund');assert.equal(refund.claimed_at,null);assert.equal(JSON.parse(refund.assets_json)[asset],amount);
 }
 assert.deepEqual(saved(h,peer),peerSave);assert.equal(h.sql.prepare('SELECT closed FROM walking_sessions WHERE id=?').get(session.id).closed,1);
 const steps=h.sql.prepare('SELECT total_steps,active_session_id FROM walking_accounts WHERE user_id=?').get(target.user.id);assert.equal(steps.total_steps,walking);assert.equal(steps.active_session_id,null);
 const before=campaign(h,peer).state.resources.gold;
 await h.api('/trades/'+incoming+'/claim',post(peer,{requestId:crypto.randomUUID(),deviceId:peer.deviceId,expectedRevision:saved(h,peer).revision}));
 assert.equal(campaign(h,peer).state.resources.gold,before+100);
});

await scope('pending expulsion blocks staff appointment until an explicit new base has been chosen',async h=>{
 const operator=await administrator(h),target=await player(h,'拠点選び直し中の任命候補');
 await expel(h,operator,await request(h,operator,target));
 const pending=h.sql.prepare('SELECT * FROM player_expulsions WHERE user_id=?').get(target.user.id),before=effects(h),requests=count(h,'staff_role_requests');
 const command={targetPlayerId:target.user.id,action:'appoint',requestId:crypto.randomUUID()};
 const blocked=await h.api('/admin/staff',post(operator,command,409));assert.equal(blocked.data.error.code,'EXPULSION_PENDING');
 assert.equal(count(h,'staff_role_requests'),requests);assert.equal(h.sql.prepare('SELECT * FROM staff_members WHERE user_id=?').get(target.user.id),undefined);
 assert.deepEqual(effects(h),before);assert.deepEqual(h.sql.prepare('SELECT * FROM player_expulsions WHERE user_id=?').get(target.user.id),pending);
 await reenter(h,target,'himeji');
 const admitted=(await h.api('/admin/staff',post(operator,command))).data;assert.equal(admitted.user.isStaff,true);
 assert.equal((await read(h,target,'/sync')).save.state.home,'kyoto_gosho');
});

await scope('expulsion that wins a staff-appointment race prevents both its receipt and membership from committing',async h=>{
 const operator=await administrator(h),target=await player(h,'任命中の追放競合'),q=await request(h,operator,target),requests=count(h,'staff_role_requests');let raced=false;
 h.beforeBatch=async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO staff_role_requests'))){h.beforeBatch=null;raced=true;await expel(h,operator,q);}};
 const result=await h.api('/admin/staff',post(operator,{targetPlayerId:target.user.id,action:'appoint',requestId:crypto.randomUUID()},409));
 assert(raced);assert.equal(result.data.error.code,'EXPULSION_PENDING');assert.equal(count(h,'staff_role_requests'),requests);
 assert.equal(h.sql.prepare('SELECT * FROM staff_members WHERE user_id=?').get(target.user.id),undefined);assert.equal(saved(h,target).save_json,null);
 assert.equal((await read(h,target,'/sync')).expulsion.pending,true);assert.equal(seat(h,'kiyosu').lord_user_id,null);
 await reenter(h,target,'himeji');assert.equal((await read(h,target,'/sync')).residency.castleId,'himeji');
});

await scope('an outgoing attack is cancelled at expulsion and a replacement lord never inherits that army',async h=>{
 const operator=await administrator(h),target=await player(h,'進軍中の対象'),enemy=await player(h,'攻撃先','inuyama');
 tune(h,target,s=>{s.troops=3000;s.resources.rice=10000;});
 const departure=(await h.api('/field/attack',post(target,{deviceId:target.deviceId,expectedRevision:saved(h,target).revision,requestId:crypto.randomUUID(),targetPlayerId:enemy.user.id,targetCastleId:'inuyama',troops:300,tactic:'balanced'}))).data;assert(departure.marching);
 const enemyBefore=saved(h,enemy);await expel(h,operator,await request(h,operator,target));
 assert.equal(h.sql.prepare('SELECT status FROM battle_marches WHERE id=?').get(departure.march.id).status,'cancelled');
 const replacement=await player(h,'旧城の新しい領主','kiyosu');assert.equal(replacement.started.save.state.march,null);assert.deepEqual(saved(h,enemy),enemyBefore);
});
}finally{globalThis.fetch=originalFetch;}
console.log(`Expulsion: ${scenarios} scenarios, ${calls} Worker requests; max ${maxBindings} SQL bindings.`);
