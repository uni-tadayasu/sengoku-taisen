import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {releaseInactivePlayerNameStatement} from './player-names.js';

// Real Worker routes and populated migration fixtures, all in local SQLite.
// Reusing a display name must never reuse an account, token or purchase.
const post=(actor,body,expected=200)=>({method:'POST',token:actor?.token,body,expected});
const key=name=>name.normalize('NFKC').toLocaleLowerCase('ja');
const rows=(h,table)=>h.sql.prepare('SELECT * FROM '+table+' ORDER BY 1').all();
const row=(h,actor)=>h.sql.prepare('SELECT * FROM users WHERE id=?').get(actor.user.id);
const saved=(h,actor)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(actor.user.id);
const banRow=(h,actor)=>h.sql.prepare('SELECT * FROM player_bans WHERE user_id=?').get(actor.user.id);
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
const get=async(h,actor,path)=>(await h.api(path,{token:actor?.token})).data;
const info=(h,operator,actor)=>get(h,operator,'/admin/moderation/target?playerId='+actor.user.id);
const rename=(h,actor,name,expected=200,extra={})=>h.api('/profile',{method:'PATCH',token:actor.token,body:{name,...extra},expected});
const banBody=(h,actor,action='ban',extra={})=>({targetPlayerId:actor.user.id,action,requestId:crypto.randomUUID(),expectedRevision:Number(banRow(h,actor)?.revision||0),reason:'名前の解放を検証する非公開理由',...extra});
const moderate=(h,operator,actor,action='ban',extra={},expected=200)=>h.api('/admin/moderation',post(operator,banBody(h,actor,action,extra),expected));
const startBody=(h,actor,castleId,extra={})=>({deviceId:actor.deviceId,revision:saved(h,actor).revision,requestId:crypto.randomUUID(),castleId,mode:'lord',clan:'織田家',difficulty:'normal',...extra});
const state=h=>Object.fromEntries(['users','player_bans','player_expulsions','moderation_requests','expulsion_requests','castle_residency_requests','castle_residents','castle_seats','player_saves','messages'].map(table=>[table,rows(h,table)]));
const releases=(h,actor)=>{
 const current=row(h,actor);
 assert.notEqual(current.name_key,key(current.name));
 assert(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(current.name_key),'Released keys use a namespace rejected by public name input');
 return current.name_key;
};
async function operator(h){const actor=await h.session('名前管理の運営');await h.api('/admin/claim',post(actor,{key:h.env.SENGOKU_ADMIN_KEY}));return actor;}
async function player(h,name,castleId='kiyosu'){
 const actor=await h.session(name);actor.deviceId='released-name-'+actor.user.id;
 await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}));
 await h.api('/castles/residency/start',post(actor,startBody(h,actor,castleId)));return actor;
}
async function expel(h,admin,actor,expected=200){
 const preview=await info(h,admin,actor),body={targetPlayerId:actor.user.id,requestId:crypto.randomUUID(),reason:'名前解放の追放確認',expectedRevision:preview.expulsion.revision,expectedCastleId:preview.expulsion.castleId,expectedLordEpoch:preview.expulsion.lordEpoch};
 return{body,...await h.api('/admin/moderation/expel',post(admin,body,expected))};
}
async function lease(h,actor){await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}));}
function seedLegacyReservation(h,actor){
 const trigger=h.sql.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='moderated_player_name_stays_released'").get();assert(trigger);
 h.sql.exec('DROP TRIGGER moderated_player_name_stays_released');
 try{h.sql.prepare('UPDATE users SET name_key=? WHERE id=?').run(key(row(h,actor).name),actor.user.id);}
 finally{h.sql.exec(trigger.sql);}
 assert.equal(row(h,actor).name_key,key(row(h,actor).name));
}
function purchase(h,actor){
 const reference='pr_name_fixture',intent='pi_name_fixture';
 h.sql.prepare('INSERT INTO premium_orders(reference,user_id,product_id,created_at) VALUES(?,?,?,?)').run(reference,actor.user.id,'gold-banner',h.now);
 h.sql.prepare('INSERT INTO premium_sessions(session_id,reference,product_id,mode,payment_intent_id,amount,currency,paid,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('cs_name_fixture',reference,'gold-banner','payment',intent,480,'jpy',1,h.now);
 h.sql.prepare('INSERT INTO premium_charges(charge_id,payment_intent_id,amount,currency,captured,created_at) VALUES(?,?,?,?,?,?)').run('ch_name_fixture',intent,480,'jpy',1,h.now);
 h.sql.prepare('INSERT INTO premium_appearances(user_id,nameplate,updated_at) VALUES(?,?,?)').run(actor.user.id,'gold-banner',h.now);
}
let checks=0,calls=0,externalRequests=0;
async function scope(label,run){const h=harness();try{await run(h);checks++;console.log('PASS '+label);}finally{calls+=h.calls;h.close();}}

// The schema-only migration preserves every existing account. Real claims
// lazily release only a matching inactive reservation in the same transaction;
// completed moderation history alone never makes a name available.
{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const entries=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8')).entries;
 const apply=tag=>{for(const command of readFileSync(new URL('./drizzle/'+tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))db.exec(command);};
 try{
  for(const entry of entries.filter(entry=>entry.idx<50))apply(entry.tag);
  const names={operator:'移行の運営',banned:'以前にBAN済み',expelled:'以前に追放済み',both:'両方の処分中',unbanned:'解除済みの通常領主',resumed:'再入城済みの通常領主',ordinary:'処分なしの領主'};
  for(const [id,name]of Object.entries(names))db.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run('u_legacy_'+id,name,key(name),'織田家','fixture-token-'+id,1,2);
  db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,2)").run('u_legacy_operator');
  for(const [id,active]of [['banned',1],['both',1],['unbanned',0]])db.prepare('INSERT INTO player_bans(user_id,active,revision,reason,banned_by,banned_at,updated_at) VALUES(?,?,2,?,?,1,2)').run('u_legacy_'+id,active,'残す管理メモ','u_legacy_operator');
  for(const [id,pending]of [['expelled',1],['both',1],['resumed',0]])db.prepare('INSERT INTO player_expulsions(user_id,revision,pending,castle_id,lord_epoch,role,source_save_json,reason,expelled_by,expelled_at,resumed_at) VALUES(?,2,?,\'kiyosu\',1,\'lord\',?,?,?,1,?)').run('u_legacy_'+id,pending,pending?'{}':null,'残す追放メモ','u_legacy_operator',pending?null:2);
  db.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,3,2)').run('u_legacy_banned','{"state":{"marker":"preserve"}}');
  db.prepare('INSERT INTO user_sessions(token_hash,user_id,device_name,created_at,last_seen) VALUES(?,?,?,1,2)').run('fixture-linked-token','u_legacy_banned','移行前からの端末');
  db.prepare('INSERT INTO premium_orders(reference,user_id,product_id,created_at) VALUES(?,?,?,1)').run('pr_legacy_name','u_legacy_banned','gold-banner');
  const tables=['player_bans','player_expulsions','player_saves','user_sessions','premium_orders'],before=tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY 1').all()),users=db.prepare('SELECT * FROM users ORDER BY id').all();
  const migration=entries.find(entry=>entry.idx===50);assert(migration,'The name release migration must be recorded in the journal');
  db.exec('BEGIN IMMEDIATE');apply(migration.tag);db.exec('COMMIT');
  assert.deepEqual(tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY 1').all()),before);
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(),users,'Applying the migration does not change any existing player row');
  const d1={prepare(sql){return{bind(...params){return{sql,params};}};}};
  for(const id of ['banned','expelled','both']){
   db.exec('BEGIN IMMEDIATE');
   try{
    const release=releaseInactivePlayerNameStatement(d1,names[id]);db.prepare(release.sql).all(...release.params);
    db.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run('u_reuser_'+id,names[id],key(names[id]),'織田家','fixture-new-token-'+id,3,3);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
   const previous=db.prepare('SELECT * FROM users WHERE id=?').get('u_legacy_'+id);assert.notEqual(previous.name_key,key(names[id]));assert(/[\u0000-\u001F\u007F]/u.test(previous.name_key));
  }
  for(const id of ['unbanned','resumed','ordinary']){
   const release=releaseInactivePlayerNameStatement(d1,names[id]);db.prepare(release.sql).all(...release.params);
   assert.throws(()=>db.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run('u_duplicate_'+id,names[id],key(names[id]),'織田家','fixture-duplicate-'+id,3,3),/UNIQUE/i);
   assert.equal(db.prepare('SELECT name_key FROM users WHERE id=?').get('u_legacy_'+id).name_key,key(names[id]));
  }
  for(const old of users){const current=db.prepare('SELECT * FROM users WHERE id=?').get(old.id);for(const [field,value]of Object.entries(old))if(field!=='name_key')assert.equal(current[field],value,old.id+'.'+field);}
  assert.deepEqual(tables.map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY 1').all()),before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);checks++;console.log('PASS schema-only legacy upgrade preserves all users and atomic claims release only matching inactive names');
 }finally{db.close();}
}

const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{externalRequests++;throw Error('Name release fixtures cannot access the network');};
try{
await scope('normal names retain normalized uniqueness and the internal release namespace cannot be registered',async h=>{
 const first=await h.session('ＡＢＣ領主'),second=await h.session('別の領主');
 assert.equal(first.user.nameReleased,false);
 assert.equal((await h.api('/session',post(null,{name:'abc領主'},409))).data.error.code,'NAME_TAKEN');
 assert.equal((await rename(h,second,'AbC領主',409)).data.error.code,'NAME_TAKEN');
 await h.api('/session',post(null,{name:'\u0001released-name'},400));await rename(h,second,'\u0001released-name',400);
 assert.equal(row(h,first).name_key,key('ＡＢＣ領主'));
});

await scope('actual registration, profile, unban and admission routes lazily release legacy inactive reservations',async h=>{
 const admin=await operator(h),registrationOwner=await h.session('以前のBAN名を登録');await moderate(h,admin,registrationOwner);seedLegacyReservation(h,registrationOwner);
 const registered=await h.session(registrationOwner.user.name);assert.notEqual(registered.user.id,registrationOwner.user.id);releases(h,registrationOwner);
 const profileOwner=await player(h,'以前の追放名へ改名');await expel(h,admin,profileOwner);seedLegacyReservation(h,profileOwner);
 const renaming=await h.session('名前変更する現役領主'),before=row(h,profileOwner);
 const stale=await rename(h,renaming,profileOwner.user.name,409,{expectedName:'一致しない変更前名'});assert.equal(stale.data.error.code,'PROFILE_CHANGED');assert.deepEqual(row(h,profileOwner),before,'A failed profile write must not release someone else\'s reservation');
 await rename(h,renaming,profileOwner.user.name);assert.equal(row(h,renaming).name_key,key(profileOwner.user.name));releases(h,profileOwner);
 const unbanOwner=await h.session('以前のBAN名で解除'),restoring=await h.session('別名で解除する本人');await moderate(h,admin,unbanOwner);await moderate(h,admin,restoring);seedLegacyReservation(h,unbanOwner);
 const restored=await moderate(h,admin,restoring,'unban',{name:unbanOwner.user.name});assert.equal(restored.data.player.id,restoring.user.id);assert.equal(restored.data.player.name,unbanOwner.user.name);assert.equal(restored.data.player.nameReleased,false);assert.equal(banRow(h,unbanOwner).active,1);releases(h,unbanOwner);
 const admissionOwner=await h.session('以前のBAN名で入城');await moderate(h,admin,admissionOwner);seedLegacyReservation(h,admissionOwner);
 const admitted=await player(h,'再入城する本人の元名');await expel(h,admin,admitted);await lease(h,admitted);
 const joined=await h.api('/castles/residency/start',post(admitted,startBody(h,admitted,'himeji',{name:admissionOwner.user.name})));assert.equal(joined.data.user.id,admitted.user.id);assert.equal(joined.data.user.name,admissionOwner.user.name);assert.equal(joined.data.user.nameReleased,false);assert.equal(joined.data.expulsion.pending,false);releases(h,admissionOwner);
});

await scope('BAN releases the normalized name for a new ID while tokens, purchases, saves and audit stay with the old ID',async h=>{
 const admin=await operator(h),target=await player(h,'ＡＢＣ葛\u{E0100}');purchase(h,target);
 const paired=(await h.api('/devices/pair-code',post(target,{}))).data,linked=(await h.api('/devices/link',post(null,{code:paired.code,deviceName:'元領主の別端末'}))).data;
 const old=row(h,target),oldSave=saved(h,target).save_json,purchases=rows(h,'premium_orders'),ban=await moderate(h,admin,target);
 assert.equal(ban.data.player.name,target.user.name);assert.equal(ban.data.player.nameReleased,true);assert.equal(ban.data.receipt.targetName,target.user.name);releases(h,target);
 const newcomer=await h.session('abc葛\u{E0100}');assert.notEqual(newcomer.user.id,target.user.id);assert.equal(newcomer.user.nameReleased,false);assert.equal(newcomer.user.isAdmin,false);assert.equal(newcomer.user.isStaff,false);
 for(const token of [target.token,linked.token])assert.equal((await h.api('/me',{token,expected:403})).data.error.code,'ACCOUNT_BANNED');
 const current=await get(h,newcomer,'/me');assert.equal(current.user.id,newcomer.user.id);assert(!current.user.appearance.ownedProducts.includes('gold-banner'));
 assert.equal(saved(h,newcomer)?.save_json??null,null);assert.equal(saved(h,target).save_json,oldSave);assert.deepEqual(rows(h,'premium_orders'),purchases);
 for(const field of ['id','token_hash','clan','created_at'])assert.equal(row(h,target)[field],old[field]);
 const roster=await get(h,admin,'/admin/moderation/bans');assert(roster.bans.some(item=>item.player.id===target.user.id&&item.player.name===target.user.name&&item.player.nameReleased));
});

await scope('other players can rename into released names and simultaneous normalized claims have one winner',async h=>{
 const admin=await operator(h),target=await h.session('ＡＢＣ再利用'),other=await h.session('再利用を希望する領主');
 await moderate(h,admin,target);const claimed=await rename(h,other,'abc再利用');assert.equal(claimed.data.user.id,other.user.id);assert.equal(row(h,other).name_key,key('ＡＢＣ再利用'));
 await moderate(h,admin,other);const contenders=await Promise.all([h.api('/session',post(null,{name:'ＡＢＣ再利用'},null)),h.api('/session',post(null,{name:'AbC再利用'},null))]);
 assert.deepEqual(contenders.map(result=>result.response.status).sort(),[200,409]);assert.equal(contenders.find(result=>result.response.status===409).data.error.code,'NAME_TAKEN');
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM users WHERE name_key=?').get(key('ＡＢＣ再利用')).n,1);releases(h,target);releases(h,other);
});

await scope('unban rejects a reused name atomically and an explicit new name restores only the original account',async h=>{
 const admin=await operator(h),target=await player(h,'解除前の領主名'),oldSave=saved(h,target).save_json;
 await moderate(h,admin,target);const newcomer=await h.session(target.user.name),before=state(h);
 const denied=await moderate(h,admin,target,'unban',{},409);assert.equal(denied.data.error.code,'NAME_TAKEN');assert.deepEqual(state(h),before);assert.equal(banRow(h,target).active,1);
 const body=banBody(h,target,'unban',{name:'解除して再出発'}),restored=await h.api('/admin/moderation',post(admin,body));
 assert.equal(restored.data.player.id,target.user.id);assert.equal(restored.data.player.name,'解除して再出発');assert.equal(restored.data.player.nameReleased,false);assert.equal(banRow(h,target).active,0);assert.equal(row(h,target).name_key,key('解除して再出発'));assert.equal(saved(h,target).save_json,oldSave);
 assert.equal((await get(h,target,'/me')).user.id,target.user.id);assert.equal((await get(h,newcomer,'/me')).user.name,target.user.name);
 const after=state(h),replay=await h.api('/admin/moderation',post(admin,body));assert.equal(replay.data.idempotent,true);assert.deepEqual(state(h),after);
 const changed=await h.api('/admin/moderation',post(admin,{...body,name:'別名に改ざん'},409));assert.equal(changed.data.error.code,'REQUEST_ID_REUSED');assert.deepEqual(state(h),after);
});

await scope('an unused old name is reclaimed by legacy unban and replaying its old BAN never releases it again',async h=>{
 const admin=await operator(h),target=await h.session('空いたままの旧名'),body=banBody(h,target),banned=await h.api('/admin/moderation',post(admin,body));
 await moderate(h,admin,target,'unban');assert.equal(row(h,target).name_key,key(target.user.name));assert.equal((await get(h,target,'/me')).user.nameReleased,false);
 const before=state(h),replay=await h.api('/admin/moderation',post(admin,body));assert.equal(replay.data.idempotent,true);assert.deepEqual(replay.data.receipt,banned.data.receipt);assert.equal(replay.data.ban.active,false);assert.deepEqual(state(h),before);
 await h.api('/session',post(null,{name:target.user.name},409));
});

await scope('expulsion releases a name but a pending profile change cannot re-reserve it or overwrite an active name',async h=>{
 const admin=await operator(h),target=await player(h,'追放前の表示名'),result=await expel(h,admin,target),sentinel=releases(h,target);
 assert.equal(result.data.player.nameReleased,true);assert.equal(result.data.receipt.targetName,target.user.name);assert.equal((await get(h,target,'/me')).user.name,target.user.name);
 const newcomer=await h.session(target.user.name);assert.notEqual(newcomer.user.id,target.user.id);
 const proposed='復帰時に使いたい名前',changed=await rename(h,target,proposed);assert.equal(changed.data.user.nameReleased,true);assert.equal(row(h,target).name,proposed);assert.equal(row(h,target).name_key,sentinel);
 const claimant=await h.session(proposed),before=row(h,target),conflict=await rename(h,target,newcomer.user.name,409);
 assert.equal(conflict.data.error.code,'NAME_TAKEN');assert.deepEqual(row(h,target),before);assert.equal(row(h,claimant).name_key,key(proposed));
 await rename(h,target,'別に選び直した候補');assert.equal(row(h,target).name_key,sentinel);
});

await scope('reentry with a reused name changes no game state; an explicit replacement admits the same account with its officers and purchases',async h=>{
 const admin=await operator(h),target=await player(h,'退城後に取られる名前');purchase(h,target);const oldSave=JSON.parse(saved(h,target).save_json),purchases=rows(h,'premium_orders'),expulsion=await expel(h,admin,target);
 const newcomer=await h.session(target.user.name);await lease(h,target);const before=state(h),body=startBody(h,target,'himeji');
 const denied=await h.api('/castles/residency/start',post(target,body,409));assert.equal(denied.data.error.code,'NAME_TAKEN');assert.deepEqual(state(h),before);
 const retry={...body,requestId:crypto.randomUUID(),name:'新たな名で再入城'},joined=await h.api('/castles/residency/start',post(target,retry));
 assert.equal(joined.data.user.id,target.user.id);assert.equal(joined.data.user.name,retry.name);assert.equal(joined.data.user.nameReleased,false);assert.equal(joined.data.expulsion.pending,false);assert.equal(joined.data.residency.castleId,'himeji');
 assert.deepEqual(joined.data.save.state.officers,oldSave.state.officers);assert.deepEqual(rows(h,'premium_orders'),purchases);assert.equal(row(h,newcomer).name,target.user.name);
 const after=state(h),replay=await h.api('/castles/residency/start',post(target,retry));assert(replay.data.admission.idempotent);assert.deepEqual(state(h),after);
 const changed=await h.api('/castles/residency/start',post(target,{...retry,name:'別の復帰名'},409));assert.equal(changed.data.error.code,'REQUEST_ID_REUSED');
 const oldExpulsion=await h.api('/admin/moderation/expel',post(admin,expulsion.body));assert(oldExpulsion.data.idempotent);assert.equal(row(h,target).name_key,key(retry.name));assert.deepEqual(state(h),after);
});

await scope('BAN over a pending expulsion and its later unban keep the name released until explicit readmission',async h=>{
 const admin=await operator(h),target=await player(h,'重なる処分の元名');await expel(h,admin,target);const sentinel=releases(h,target);await moderate(h,admin,target);
 const newcomer=await h.session(target.user.name),unbanned=await moderate(h,admin,target,'unban');
 assert.equal(unbanned.data.ban.active,false);assert.equal(unbanned.data.expulsion.pending,true);assert.equal(unbanned.data.player.nameReleased,true);assert.equal(row(h,target).name_key,sentinel);assert.equal(row(h,newcomer).name_key,key(target.user.name));
 await lease(h,target);await h.api('/castles/residency/start',post(target,startBody(h,target,'himeji',{name:'重なる処分からの復帰'})));assert.equal((await get(h,target,'/me')).user.nameReleased,false);
});

await scope('repeated sanctions and old Worker profile writes cannot reserve a released name again',async h=>{
 const admin=await operator(h),target=await player(h,'繰り返す処分の元名');
 await moderate(h,admin,target);const sentinel=releases(h,target);
 // This is the exact shape of the old Worker's UPDATE, before it knew that
 // pending expulsions need a different reservation key.
 h.sql.prepare('UPDATE users SET name=?,name_key=? WHERE id=?').run(target.user.name,key(target.user.name),target.user.id);assert.equal(row(h,target).name_key,sentinel);
 await moderate(h,admin,target,'unban');assert.equal(row(h,target).name_key,key(target.user.name));
 await moderate(h,admin,target);assert.equal(row(h,target).name_key,sentinel);await moderate(h,admin,target,'unban');
 await expel(h,admin,target);h.sql.prepare('UPDATE users SET name=?,name_key=? WHERE id=?').run(target.user.name,key(target.user.name),target.user.id);assert.equal(row(h,target).name_key,sentinel);
 await lease(h,target);await h.api('/castles/residency/start',post(target,startBody(h,target,'himeji')));assert.equal(row(h,target).name_key,key(target.user.name));
 await expel(h,admin,target);assert.equal(row(h,target).name_key,sentinel);const claimant=await h.session(target.user.name);assert.notEqual(claimant.user.id,target.user.id);
});

await scope('a registration between unban review and commit wins without partially lifting the BAN',async h=>{
 const admin=await operator(h),target=await h.session('解除確定時に競合'),body=banBody(h,target);await h.api('/admin/moderation',post(admin,body));
 const previous=row(h,target),previousBan=banRow(h,target),receipts=rows(h,'moderation_requests');let newcomer=null;
 h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO moderation_requests')))return;h.beforeBatch=null;newcomer=await h.session(target.user.name);};
 const denied=await moderate(h,admin,target,'unban',{},409);assert(newcomer,'The commit boundary must be exercised');assert.equal(denied.data.error.code,'NAME_TAKEN');assert.deepEqual(row(h,target),previous);assert.deepEqual(banRow(h,target),previousBan);assert.deepEqual(rows(h,'moderation_requests'),receipts);assert.equal(row(h,newcomer).name_key,key(target.user.name));
});

await scope('a registration between admission review and commit rolls back its seat, save and receipt',async h=>{
 const admin=await operator(h),target=await player(h,'再入城確定時に競合');await expel(h,admin,target);await lease(h,target);
 const before=state(h);let newcomer=null;
 h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO castle_residency_requests')))return;h.beforeBatch=null;newcomer=await h.session(target.user.name);};
 const denied=await h.api('/castles/residency/start',post(target,startBody(h,target,'himeji'),409));assert(newcomer,'The admission commit boundary must be exercised');assert.equal(denied.data.error.code,'NAME_TAKEN');
 const after=state(h);after.users=after.users.filter(item=>item.id!==newcomer.user.id);assert.deepEqual(after,before);assert.equal(row(h,newcomer).name_key,key(target.user.name));
});

await scope('failure after a BAN or expulsion has released its key rolls the whole operation back',async h=>{
 const admin=await operator(h),target=await player(h,'取引失敗時は名前を保持');await h.api('/chat',post(target,{channel:'world',text:'ロールバック対象の投稿'}));
 const beforeBan=state(h);h.sql.exec("CREATE TRIGGER fixture_name_ban_rollback BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT,'fixture ban rollback after key release'); END;");
 await moderate(h,admin,target,'ban',{},500);assert.deepEqual(state(h),beforeBan);assert.equal(row(h,target).name_key,key(target.user.name));h.sql.exec('DROP TRIGGER fixture_name_ban_rollback');
 const beforeExpulsion=state(h);h.sql.exec("CREATE TRIGGER fixture_name_expulsion_rollback BEFORE UPDATE OF save_json ON player_saves WHEN NEW.save_json IS NULL BEGIN SELECT RAISE(ABORT,'fixture expulsion rollback after key release'); END;");
 await expel(h,admin,target,500);assert.deepEqual(state(h),beforeExpulsion);assert.equal(row(h,target).name_key,key(target.user.name));h.sql.exec('DROP TRIGGER fixture_name_expulsion_rollback');
 await h.api('/session',post(null,{name:target.user.name},409));
});
}finally{globalThis.fetch=originalFetch;}
assert.equal(externalRequests,0);
console.log(JSON.stringify({passed:checks,calls,externalRequests,fixtureOnly:true,coverage:['legacy name release','normalized uniqueness','identity and purchase isolation','pending profile edits','unban and readmission conflicts','commit-time name races','transaction rollback','idempotent moderation history']}));
