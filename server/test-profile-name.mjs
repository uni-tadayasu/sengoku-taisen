import assert from 'node:assert/strict';
import {harness,settleFieldMarch} from './test-support.mjs';

// Isolated SQLite/Worker fixtures: no live account, payment or external request.
const post=(actor,body,expected=200)=>({method:'POST',token:actor?.token,body,expected});
const rename=(h,actor,body,expected=200)=>h.api('/profile',{method:'PATCH',token:actor?.token,body,expected});
const row=(h,actor)=>h.sql.prepare('SELECT * FROM users WHERE id=?').get(actor.user.id);
const saved=(h,actor)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(actor.user.id);
const name=(h,actor)=>row(h,actor).name;
const id=prefix=>prefix+crypto.randomUUID().replaceAll('-','');
let checks=0,calls=0,externalRequests=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{externalRequests++;throw Error('No external requests in profile fixtures');};
async function scope(label,run){const h=harness();try{await run(h);checks++;console.log('PASS '+label);}finally{calls+=h.calls;h.close();}}
async function savePlayer(h,actor,{defender=false}={}){
  actor.deviceId='profile-'+actor.user.id;const lease=(await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}))).data,save=h.fresh(defender?'inuyama':'kiyosu');
  save.state.troops=20000;save.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};
  if(defender)save.state.castles.nijo={owner:save.state.clan,level:20,wall:4,troops:1000};
  save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
  return (await h.api('/sync',{method:'PUT',token:actor.token,body:{deviceId:actor.deviceId,revision:lease.revision,save}})).data;
}
async function linked(h,actor){const pair=(await h.api('/devices/pair-code',post(actor,{}))).data;return (await h.api('/devices/link',post(null,{code:pair.code,deviceName:'名前変更の別端末'}))).data;}
async function admin(h){const actor=await h.session('名前管理の領主');await h.api('/admin/claim',post(actor,{key:h.env.SENGOKU_ADMIN_KEY}));return actor;}
async function moderate(h,operator,actor,action){const revision=h.sql.prepare('SELECT revision FROM player_bans WHERE user_id=?').get(actor.user.id)?.revision||0;return h.api('/admin/moderation',post(operator,{targetPlayerId:actor.user.id,action,reason:'名前更新境界のローカル検証',expectedRevision:revision,requestId:crypto.randomUUID()}));}
function tables(h,names){return Object.fromEntries(names.map(table=>[table,h.sql.prepare('SELECT * FROM '+table+' ORDER BY 1').all()]));}
function paidFixture(h,actor){
  // Seed already-verified local facts; this does not contact or call Stripe.
  const reference=id('pr_'),intent=id('pi_');
  h.sql.prepare('INSERT INTO premium_orders(reference,user_id,product_id,created_at) VALUES(?,?,?,?)').run(reference,actor.user.id,'gold-banner',h.now);
  h.sql.prepare('INSERT INTO premium_sessions(session_id,reference,product_id,mode,payment_intent_id,amount,currency,paid,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id('cs_'),reference,'gold-banner','payment',intent,480,'jpy',1,h.now);
  h.sql.prepare('INSERT INTO premium_charges(charge_id,payment_intent_id,amount,currency,captured,created_at) VALUES(?,?,?,?,?,?)').run(id('ch_'),intent,480,'jpy',1,h.now);
  h.sql.prepare('INSERT INTO premium_appearances(user_id,nameplate,updated_at) VALUES(?,?,?)').run(actor.user.id,'gold-banner',h.now);
}

try{
await scope('health and config advertise the deployed name-preservation capability',async h=>{
  for(const route of ['/health','/config']){const result=(await h.api(route)).data;assert.equal(result.version,'5.8.0');assert.equal(result.features.displayNameVariants,true);}
});

await scope('names preserve display spelling, Unicode limits and unique keys without trusting target or role fields',async h=>{
  const actor=await h.session('変更する甲'),other=await h.session('ＡＢＣ');
  await rename(h,null,{name:'認証なし'},401);await rename(h,{token:'invalid'},{name:'不正認証'},401);
  for(const invalid of [undefined,null,7,{},'', '   ','字'.repeat(25),'城\u0000主','城\u000b主','城\u007f主'])await rename(h,actor,{name:invalid},400);
  for(const invalid of [null,2,''])await rename(h,actor,{name:'有効な名前',expectedName:invalid},400);
  assert.equal((await rename(h,actor,{name:'abc'},409)).data.error.code,'NAME_TAKEN');
  assert.equal((await h.api('/session',post(null,{name:'abc'},409))).data.error.code,'NAME_TAKEN');
  const preserved=(await rename(h,actor,{name:'  e\u0301武将  ',expectedName:actor.user.name})).data.user;assert.equal(preserved.name,'e\u0301武将');assert.equal(name(h,actor),'e\u0301武将');
  assert.equal((await h.api('/session',post(null,{name:'é武将'},409))).data.error.code,'NAME_TAKEN');
  await rename(h,actor,{name:'将'});assert.equal(name(h,actor),'将');
  const emoji='🏯'.repeat(24);await rename(h,actor,{name:emoji});assert.equal(Array.from(name(h,actor)).length,24);
  await rename(h,actor,{name:'🏯'.repeat(25)},400);
  const otherBefore=row(h,other),forged=(await rename(h,actor,{name:'自分だけ変更',userId:other.user.id,id:other.user.id,isAdmin:true,isStaff:true,role:'admin'})).data.user;
  assert.equal(forged.id,actor.user.id);assert.equal(forged.isAdmin,false);assert.equal(forged.isStaff,false);assert.deepEqual(row(h,other),otherBefore);
});

await scope('registration and reload retain compatibility ideographs and variation selectors without weakening name uniqueness',async h=>{
  const registeredName='神葛\u{E0100}か\u3099𠮷',actor=await h.session('  '+registeredName+'  ');
  assert.equal(actor.user.name,registeredName);assert.equal(name(h,actor),registeredName);assert.equal(row(h,actor).name_key,registeredName.normalize('NFKC').toLocaleLowerCase('ja'));
  assert.equal((await h.api('/me',{token:actor.token})).data.user.name,registeredName);
  assert.equal((await h.api('/session',post(null,{name:registeredName.normalize('NFC')},409))).data.error.code,'NAME_TAKEN');
  for(const part of ['葛\u{E0100}','か\u3099']){
    const boundary=part.repeat(12);await rename(h,actor,{name:boundary,expectedName:name(h,actor)});assert.equal(name(h,actor),boundary);assert.equal((await h.api('/me',{token:actor.token})).data.user.name,boundary);
    await rename(h,actor,{name:part.repeat(13),expectedName:boundary},400);assert.equal(name(h,actor),boundary);
    await h.api('/session',post(null,{name:part.repeat(13)},400));
  }
});

await scope('exact name expectations preserve legacy NFC accounts and fence canonically equivalent glyph changes',async h=>{
  const actor=await h.session('é旧領主');
  await rename(h,actor,{name:'神の領主',expectedName:'é旧領主'});assert.equal(name(h,actor),'神の領主');
  await rename(h,actor,{name:'神の領主',expectedName:'神の領主'});assert.equal(name(h,actor),'神の領主');
  assert.equal((await rename(h,actor,{name:'古い期待値の変更',expectedName:'神の領主'},409)).data.error.code,'PROFILE_CHANGED');
  await rename(h,actor,{name:'神の領主',expectedName:'神の領主'});assert.equal(name(h,actor),'神の領主');
  assert.equal((await rename(h,actor,{name:'異体字を見ていた端末',expectedName:'神の領主'},409)).data.error.code,'PROFILE_CHANGED');
  await rename(h,actor,{name:'葛\u{E0100}の領主',expectedName:'神の領主'});assert.equal(name(h,actor),'葛\u{E0100}の領主');
  assert.equal((await rename(h,actor,{name:'指定を失った端末',expectedName:'葛の領主'},409)).data.error.code,'PROFILE_CHANGED');
  await rename(h,actor,{name:'葛\u{E0101}の領主',expectedName:'葛\u{E0100}の領主'});assert.equal(name(h,actor),'葛\u{E0101}の領主');
});

await scope('linked devices can rename without taking a gameplay lease or changing saves, guilds, purchases or authentication',async h=>{
  const actor=await h.session('不変条件の旧名'),other=await h.session('別の所属領主');await savePlayer(h,actor);
  const guild=(await h.api('/guild',post(actor,{name:'名前に依存しない軍団'}))).data.guild;await h.api('/guild/join',post(other,{guildId:guild.id}));
  await h.api('/presence',post(actor,{deviceId:actor.deviceId,online:true}));const device=await linked(h,actor);paidFixture(h,actor);
  const selected=['player_saves','user_sessions','pairing_codes','guilds','guild_members','guild_officers','premium_orders','premium_sessions','premium_charges','premium_appearances','premium_events','premium_blocks','premium_reviews'],before=tables(h,selected),old=row(h,actor),presence=h.sql.prepare('SELECT * FROM player_presence WHERE user_id=?').all(actor.user.id);
  const updated=(await rename(h,device,{name:'不変条件の新名',expectedName:old.name})).data.user;
  assert.equal(updated.id,actor.user.id);assert.equal(updated.guildId,guild.id);assert.deepEqual(updated.appearance.ownedProducts,['gold-banner']);assert.equal(updated.appearance.nameplate,'gold-banner');
  assert.deepEqual(tables(h,selected),before);assert.deepEqual(h.sql.prepare('SELECT * FROM player_presence WHERE user_id=?').all(actor.user.id),presence);
  const current=row(h,actor);for(const key of ['id','token_hash','clan','created_at'])assert.equal(current[key],old[key]);assert.equal(saved(h,actor).writer_device_id,actor.deviceId);
  for(const token of [actor.token,device.token])assert.equal((await h.api('/me',{token})).data.user.name,'不変条件の新名');
  assert.equal((await h.api('/online')).data.players.find(p=>p.id===actor.user.id).name,'不変条件の新名');
  assert.equal((await h.api('/premium',{token:actor.token})).data.products.find(p=>p.id==='gold-banner').owned,true);
});

await scope('expected names fence concurrent edits and response-loss retry cannot overwrite a newer name',async h=>{
  const actor=await h.session('競合前の名前'),device=await linked(h,actor),original=actor.user.name;
  const results=await Promise.all([rename(h,actor,{name:'競合後の甲',expectedName:original},null),rename(h,device,{name:'競合後の乙',expectedName:original},null)]);
  assert.deepEqual(results.map(result=>result.response.status).sort(),[200,409]);assert.equal(results.find(result=>result.response.status===409).data.error.code,'PROFILE_CHANGED');
  const winner=name(h,actor);await rename(h,actor,{name:winner,expectedName:original});
  const requested={name:'応答喪失の変更',expectedName:winner};let lost=false;
  h.beforeBatch=statements=>{if(statements.some(statement=>statement.sql.includes('/* player-evaluation */'))&&name(h,actor)===requested.name){h.beforeBatch=null;lost=true;throw Error('local response loss after committed rename');}};
  await rename(h,actor,requested,500);assert(lost);assert.equal(name(h,actor),requested.name);await rename(h,device,requested);
  await rename(h,device,{name:'別端末による次の名前',expectedName:requested.name});
  assert.equal((await rename(h,actor,requested,409)).data.error.code,'PROFILE_CHANGED');assert.equal(name(h,actor),'別端末による次の名前');
  const competitor=await h.session('別の名前競合者'),sameName='同じ名前の争奪';
  const unique=await Promise.all([rename(h,actor,{name:sameName,expectedName:name(h,actor)},null),rename(h,competitor,{name:sameName,expectedName:competitor.user.name},null)]);
  assert.deepEqual(unique.map(result=>result.response.status).sort(),[200,409]);assert.equal(unique.find(result=>result.response.status===409).data.error.code,'NAME_TAKEN');
});

await scope('BAN, BAN-unban generations and failed SQL prevent any delayed name write',async h=>{
  const operator=await admin(h),actor=await h.session('停止境界の名前');await moderate(h,operator,actor,'ban');
  await rename(h,actor,{name:'停止中の変更'},403);assert.equal(name(h,actor),actor.user.name);await moderate(h,operator,actor,'unban');
  let intercepted=false;h.beforeStatement=async sql=>{if(sql.startsWith('UPDATE users SET name=')){h.beforeStatement=null;intercepted=true;await moderate(h,operator,actor,'ban');await moderate(h,operator,actor,'unban');}};
  assert.equal((await rename(h,actor,{name:'古い認証の変更',expectedName:actor.user.name},409)).data.error.code,'ACCOUNT_ACCESS_CHANGED');assert(intercepted);assert.equal(name(h,actor),actor.user.name);
  h.sql.exec("CREATE TRIGGER fixture_profile_failure BEFORE UPDATE OF name ON users BEGIN SELECT RAISE(ABORT,'fixture rename rollback'); END;");
  await rename(h,actor,{name:'失敗する変更'},500);assert.equal(name(h,actor),actor.user.name);h.sql.exec('DROP TRIGGER fixture_profile_failure');
  const updated=await rename(h,actor,{name:'解除後の名前',expectedName:actor.user.name});assert.equal(updated.data.user.id,actor.user.id);
});

await scope('historical chat, letters, ledgers, battles and empty deltas use the current name without rewriting stored records',async h=>{
  const actor=await h.session('過去表示の旧名'),viewer=await h.session('過去表示の閲覧者');await savePlayer(h,actor);await savePlayer(h,viewer,{defender:true});
  const message=(await h.api('/chat',post(actor,{channel:'world',text:'過去表示の旧名と書いた本文はそのまま'}))).data.message;
  const letter=(await h.api('/letters',post(actor,{requestId:'rename-letter',destination:'player',targetPlayerId:viewer.user.id,text:'旧名を含む書状本文'}))).data;
  const guild=(await h.api('/guild',post(actor,{name:'履歴表示の軍団'}))).data.guild;await h.api('/guild/join',post(viewer,{guildId:guild.id}));
  const revision=()=>Number(saved(h,actor).revision);
  await h.api('/guild/treasury/transfer',post(actor,{guildId:guild.id,resource:'gold',amount:1,direction:'deposit',requestId:'rename-ledger',deviceId:actor.deviceId,expectedRevision:revision()}));
  await h.api('/trades',post(actor,{targetPlayerId:viewer.user.id,offer:{gold:1},want:{},requestId:'rename-trade',deviceId:actor.deviceId,expectedRevision:revision()}));
  // Keep the battle fixture outside the alliance's friendly-fire restriction.
  await h.api('/guild/leave',post(viewer,{guildId:guild.id}));
  const random=crypto.getRandomValues;crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(0):random.call(crypto,array);};
  try{
  const departure=(await h.api('/field/attack',post(actor,{requestId:'rename-battle',targetPlayerId:viewer.user.id,targetCastleId:'nijo',troops:3000,tactic:'balanced',deviceId:actor.deviceId,expectedRevision:revision()}))).data;
  await settleFieldMarch(h,actor,departure);
  }finally{crypto.getRandomValues=random;}
  await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}));
  await h.api('/guild/join',post(viewer,{guildId:guild.id}));
  await h.api('/field/diplomacy',post(actor,{requestId:'rename-relation',targetPlayerId:viewer.user.id,action:'propose',deviceId:actor.deviceId,expectedRevision:revision()}));
  const records=['messages','base_letter_messages','field_battles','field_requests','guild_asset_requests','trade_requests','mail_campaigns'],before=tables(h,records),newName='過去表示の新名';
  await rename(h,actor,{name:newName,expectedName:actor.user.name});
  const get=async path=>(await h.api(path,{token:viewer.token})).data;
  const full=await get('/chat?channel=world');assert.equal(full.messages[0].name,newName);assert.equal(full.messages[0].text,message.text);
  const delta=await get('/chat?channel=world&after='+message.id);assert.deepEqual(delta.messages,[]);assert.equal(delta.playerEvaluations.find(p=>p.playerId===actor.user.id).name,newName);
  const thread=await get('/letters/'+letter.thread.id);assert.equal(thread.thread.peer.name,newName);assert.equal(thread.thread.title,newName);assert.equal(thread.messages[0].authorName,newName);assert.equal(thread.thread.lastMessage.authorName,newName);assert.equal(thread.messages[0].text,'旧名を含む書状本文');
  const letterDelta=await get('/letters/'+letter.thread.id+'?after='+letter.message.seq);assert.deepEqual(letterDelta.messages,[]);assert.equal(letterDelta.playerEvaluations.find(p=>p.playerId===actor.user.id).name,newName);
  assert.equal((await get('/guild')).members.find(p=>p.id===actor.user.id).name,newName);assert.equal((await get('/guild/rankings')).guilds[0].ownerName,newName);assert.equal((await get('/guild/treasury')).ledger[0].name,newName);
  assert.equal((await get('/trades')).trades[0].sender.name,newName);assert.equal((await get('/field')).players.find(p=>p.playerId===actor.user.id).name,newName);
  const history=await get('/field/me');assert.equal(history.battles[0].attackerName,newName);assert.equal(history.relationships[0].targetName,newName);
  assert.equal((await get('/mail')).mail[0].participants.find(p=>p.playerId===actor.user.id).name,newName);
  assert.equal((await get('/achievements')).events.find(p=>p.playerId===actor.user.id).playerName,newName);
  assert.deepEqual(tables(h,records),before,'Historical financial receipts and body text remain byte-for-byte unchanged');
  assert((await get('/players?q='+encodeURIComponent(newName))).players.some(p=>p.id===actor.user.id));
});

await scope('rename throttling is per identity, permits unchanged retries and resets after one minute',async h=>{
  const actor=await h.session('名前制限の初期'),device=await linked(h,actor);let current=actor.user.name;
  for(let i=0;i<20;i++){const next='名前制限の変更'+i;await rename(h,i%2?actor:device,{name:next,expectedName:current});current=next;}
  const denied=await rename(h,device,{name:'制限中の別名',expectedName:current},429);assert.equal(denied.data.error.code,'RATE_LIMITED');assert(denied.data.error.retryAfter>0);assert.equal(name(h,actor),current);
  await rename(h,actor,{name:current,expectedName:'応答を失った古い名前'});assert.equal(name(h,actor),current);
  h.now+=60000;await rename(h,device,{name:'時間経過後の名前',expectedName:current});assert.equal(name(h,actor),'時間経過後の名前');
});
}finally{globalThis.fetch=originalFetch;}
assert.equal(externalRequests,0);console.log(JSON.stringify({passed:checks,calls,externalRequests,fixtureOnly:true}));
