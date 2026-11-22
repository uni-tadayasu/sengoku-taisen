import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';

// The same durable identities are read through real Worker routes before and
// after avatar replacement/removal. Fixtures never contact a public service.
const h=harness(),post=(actor,body)=>({method:'POST',token:actor?.token,body});
const saved=actor=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(actor.user.id);
const get=async(path,actor)=>(await h.api(path,{token:actor?.token})).data;
const image=name=>Buffer.from(readFileSync(new URL('./fixtures/avatar/'+name+'.jpg',import.meta.url))).toString('base64');
const upload=async(actor,name)=>(await h.api('/me/avatar',{method:'PUT',token:actor.token,body:{image:image(name)}})).data.user.avatarVersion;
const photo=(value,expected,key='avatarVersion')=>{assert(value,'Expected a visible participant');assert(Object.hasOwn(value,key),'Missing '+key);assert.equal(value[key],expected,key);};
const tables=names=>Object.fromEntries(names.map(table=>[table,h.sql.prepare('SELECT * FROM '+table+' ORDER BY 1').all()]));
async function save(actor,defender=false){
 actor.deviceId='avatar-'+actor.user.id;const lease=(await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}))).data,state=h.fresh();
 state.state.troops=20000;state.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};
 if(defender)state.state.castles.nijo={owner:state.state.clan,level:20,wall:4,troops:1000};
 state.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};state.state.turn=Math.floor(lease.clock.elapsedMs/60000);state.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
 await h.api('/sync',{method:'PUT',token:actor.token,body:{deviceId:actor.deviceId,revision:lease.revision,save:state}});
}
let externalRequests=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{externalRequests++;throw Error('No external requests in avatar fixtures');};
try{
 const actor=await h.session('全画面アイコンの領主'),viewer=await h.session('全画面アイコンの相手'),operator=await h.session('確認する管理者'),staff=await h.session('共同普請のアイコン');
 await h.api('/admin/claim',post(operator,{key:h.env.SENGOKU_ADMIN_KEY}));
 await save(actor);await save(viewer,true);await save(staff);
 await h.api('/presence',post(actor,{deviceId:actor.deviceId,online:true}));
 await h.api('/friends/request',post(actor,{userId:viewer.user.id}));
 await h.api('/friends/respond',post(viewer,{userId:actor.user.id,accept:true}));
 const guild=(await h.api('/guild',post(actor,{name:'全画面アイコンの軍団'}))).data.guild;
 await h.api('/guild/join',post(viewer,{guildId:guild.id}));
 const message=(await h.api('/chat',post(actor,{channel:'world',text:'写真を変えても本文はそのまま'}))).data.message;
 const letter=(await h.api('/letters',post(actor,{requestId:'avatar-letter',destination:'player',targetPlayerId:viewer.user.id,text:'写真を変える前の書状'}))).data;
 const revision=()=>Number(saved(actor).revision);
 await h.api('/guild/treasury/transfer',post(actor,{guildId:guild.id,resource:'gold',amount:1,direction:'deposit',requestId:'avatar-ledger',deviceId:actor.deviceId,expectedRevision:revision()}));
 await h.api('/trades',post(actor,{targetPlayerId:viewer.user.id,offer:{gold:1},want:{},requestId:'avatar-trade',deviceId:actor.deviceId,expectedRevision:revision()}));
 // Combat projections use an opponent outside the current alliance.
 await h.api('/guild/leave',post(viewer,{guildId:guild.id}));
 const random=crypto.getRandomValues;crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(0):random.call(crypto,array);};
 try{await h.api('/field/attack',post(actor,{requestId:'avatar-battle',targetPlayerId:viewer.user.id,targetCastleId:'nijo',troops:3000,tactic:'balanced',deviceId:actor.deviceId,expectedRevision:revision()}));}finally{crypto.getRandomValues=random;}
 await h.api('/guild/join',post(viewer,{guildId:guild.id}));
 await h.api('/field/diplomacy',post(actor,{requestId:'avatar-alliance',targetPlayerId:viewer.user.id,action:'propose',deviceId:actor.deviceId,expectedRevision:revision()}));
 await h.api('/admin/staff',post(operator,{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}));
 await get('/sync?deviceId='+staff.deviceId,staff);
 const base=JSON.parse(h.sql.prepare("SELECT state_json FROM staff_base WHERE id='kyoto_gosho'").get().state_json);
 base.jobs=[{jobId:'avatar-job',kind:'building',id:'farm',targetLevel:base.buildings.farm+1,totalSeconds:600,queuedAtElapsedMs:0,startedElapsedMs:0,completesElapsedMs:600000,startedBy:{id:staff.user.id,name:staff.user.name}}];
 h.sql.prepare("UPDATE staff_base SET state_json=? WHERE id='kyoto_gosho'").run(JSON.stringify(base));
 const pair=(await h.api('/devices/pair-code',post(actor,{}))).data,linked=(await h.api('/devices/link',post(null,{code:pair.code,deviceName:'写真の別端末'}))).data;
 const first=await upload(actor,'baseline'),other=await upload(viewer,'progressive'),staffPhoto=await upload(staff,'grayscale');
 const records=['player_saves','staff_base','user_sessions','messages','base_letter_messages','field_battles','field_requests','guild_asset_requests','trade_requests','mail_campaigns','guild_members'],before=tables(records);

 async function verify(version){
  photo((await get('/me',actor)).user,version);
  photo((await get('/sync?deviceId='+actor.deviceId,actor)).user,version);
  photo((await get('/me',viewer)).friends.find(p=>p.id===actor.user.id),version);
  photo((await get('/online')).players.find(p=>p.id===actor.user.id),version);
  photo((await get('/players?q='+encodeURIComponent('全画面アイコン'),viewer)).players.find(p=>p.id===actor.user.id),version);
  photo((await get('/guild',viewer)).members.find(p=>p.id===actor.user.id),version);
  photo((await get('/guilds',viewer)).guilds.find(p=>p.id===guild.id),version,'ownerAvatarVersion');
  photo((await get('/guild/rankings')).guilds.find(p=>p.id===guild.id),version,'ownerAvatarVersion');
  photo((await get('/guild/treasury',viewer)).ledger[0],version);
  const full=await get('/chat?channel=world',viewer),delta=await get('/chat?channel=world&after='+message.id,viewer);
  photo(full.messages[0],version);assert.equal(full.messages[0].text,message.text);assert.deepEqual(delta.messages,[]);photo(delta.playerEvaluations.find(p=>p.playerId===actor.user.id),version);
  const inbox=await get('/letters',viewer),thread=await get('/letters/'+letter.thread.id,viewer),letterDelta=await get('/letters/'+letter.thread.id+'?after='+letter.message.seq,viewer);
  photo(inbox.threads[0].peer,version);photo(inbox.threads[0].lastMessage,version,'authorAvatarVersion');
  photo(thread.thread.peer,version);photo(thread.messages[0],version,'authorAvatarVersion');assert.equal(thread.messages[0].text,'写真を変える前の書状');
  assert.deepEqual(letterDelta.messages,[]);photo(letterDelta.playerEvaluations.find(p=>p.playerId===actor.user.id),version);
  const trade=(await get('/trades',viewer)).trades[0];photo(trade.sender,version);photo(trade.recipient,other);
  photo((await get('/field')).players.find(p=>p.playerId===actor.user.id),version);
  const field=await get('/field/me',viewer);photo(field.battles[0],version,'attackerAvatarVersion');photo(field.battles[0],other,'defenderAvatarVersion');photo(field.relationships[0],version,'targetAvatarVersion');
  photo((await get('/mail',viewer)).mail[0].participants.find(p=>p.playerId===actor.user.id),version);
  const achievement=(await get('/achievements')).events.find(p=>p.playerId===actor.user.id);photo(achievement,version);photo(achievement,version,'playerAvatarVersion');
  photo((await get('/premium',actor)).player,version);
  photo((await get('/staff/recent-logins',operator)).players.find(p=>p.id===actor.user.id),version);
  photo((await get('/admin/moderation/target?playerId='+actor.user.id,operator)).player,version);
  photo((await get('/staff/base',staff)).staffBase.jobs[0].startedBy,staffPhoto);
  assert.deepEqual(tables(records),before,'Reading current photos must not rewrite gameplay, messages, receipts, guild membership or authentication');
  for(const payload of [full,delta,inbox,thread,letterDelta,field,trade])for(const hidden of ['object_key','avatar_version','byte_length','base64',actor.token,viewer.token])assert(!JSON.stringify(payload).includes(hidden),'Private avatar or authentication data must not be projected');
 }
 await verify(first);
 const second=await upload(linked,'progressive');assert.notEqual(first,second);await verify(second);
 await h.api('/me/avatar',{method:'DELETE',token:linked.token});await verify(null);
 await h.api('/avatars/'+actor.user.id+'?v='+second,{expected:404});
 console.log('PASS current avatars reach every player surface, empty deltas and historical records after linked-device upload, replacement and removal');

 await upload(actor,'baseline');
 const ban=(await h.api('/admin/moderation',post(operator,{targetPlayerId:actor.user.id,action:'ban',reason:'画像表示のローカル確認',expectedRevision:0,requestId:crypto.randomUUID()}))).data;
 photo(ban.player,null);photo(ban.receipt,null,'targetAvatarVersion');
 photo((await get('/admin/moderation/bans',operator)).bans.find(b=>b.player.id===actor.user.id).player,null);
 photo((await get('/guild/rankings')).guilds.find(p=>p.id===guild.id),null,'ownerAvatarVersion');
 photo((await get('/field/me',viewer)).battles[0],null,'attackerAvatarVersion');
 photo((await get('/trades',viewer)).trades[0].sender,null);
 await h.api('/avatars/'+actor.user.id+'?v='+first,{expected:404});
 const unban=(await h.api('/admin/moderation',post(operator,{targetPlayerId:actor.user.id,action:'unban',reason:'画像表示のローカル確認完了',expectedRevision:1,requestId:crypto.randomUUID()}))).data;
 photo(unban.player,first);photo((await get('/field/me',viewer)).battles[0],first,'attackerAvatarVersion');
 console.log('PASS BAN clears public and privileged avatar projections; unban restores only the still-current image');
 assert.equal(externalRequests,0);console.log(JSON.stringify({passed:2,calls:h.calls,externalRequests,fixtureOnly:true}));
}finally{globalThis.fetch=originalFetch;h.close();}
