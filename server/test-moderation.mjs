import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

// Real Worker routes, all migrations and transactional SQLite; never a live
// account, remote database, or production moderation request.
const post=(actor,body,expected=200)=>({method:'POST',token:actor?.token,body,expected});
const rows=(h,table)=>h.sql.prepare('SELECT * FROM '+table).all();
const owned=(h,table,column,player)=>h.sql.prepare('SELECT * FROM '+table+' WHERE '+column+'=?').all(player.user.id);
const savedRow=(h,player)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(player.user.id);
const revision=(h,player)=>Number(h.sql.prepare('SELECT revision FROM player_bans WHERE user_id=?').get(player.user.id)?.revision||0);
const banBody=(h,target,action='ban',extra={})=>({targetPlayerId:target.user.id,action,requestId:crypto.randomUUID(),expectedRevision:revision(h,target),...(action==='ban'?{reason:'検証用の非公開判断理由'}:{}),...extra});
const moderate=(h,admin,target,action='ban',extra={},expected=200)=>h.api('/admin/moderation',post(admin,banBody(h,target,action,extra),expected));
const targetInfo=async(h,admin,target)=>(await h.api('/admin/moderation/target?playerId='+target.user.id,{token:admin.token})).data;
const snapshot=h=>Object.fromEntries(['player_bans','moderation_requests','moderation_state','messages','base_letter_threads','base_letter_messages','base_letter_requests','base_letter_reads','player_saves','pairing_codes','player_presence','user_sessions','trades','trade_deliveries','trade_requests','walking_accounts','walking_sessions','walking_receipts'].map(table=>[table,rows(h,table).map(value=>JSON.stringify(value)).sort()]));
const moderationBatch=statements=>statements.some(statement=>statement.sql.includes('INSERT INTO moderation_requests'));
const letterBody=(target,text,extra={})=>({requestId:crypto.randomUUID(),targetPlayerId:target.user.id,destination:'player',text,...extra});
const letter=(h,actor,target,text,extra={})=>h.api('/letters',post(actor,letterBody(target,text,extra)));
const reply=(h,actor,id,text,extra={})=>h.api('/letters/'+id+'/messages',post(actor,{requestId:crypto.randomUUID(),text,...extra}));
const tradeBody=(h,actor,target,offer={gold:20},want={rice:10},extra={})=>({targetPlayerId:target.user.id,offer,want,requestId:crypto.randomUUID(),deviceId:actor.deviceId,expectedRevision:Number(savedRow(h,actor).revision),...extra});
const trade=(h,actor,target,offer,want)=>h.api('/trades',post(actor,tradeBody(h,actor,target,offer,want)));
const tradeAction=(h,actor,id,action,extra={},expected=200)=>h.api('/trades/'+id+'/'+action,post(actor,{requestId:crypto.randomUUID(),deviceId:actor.deviceId,expectedRevision:Number(savedRow(h,actor).revision),...extra},expected));
function interceptCommit(h,matches,run){
  let hit=false;
  const pause=async()=>{if(hit)return;hit=true;h.beforeStatement=h.beforeBatch=null;await run();};
  h.beforeStatement=async(sql,params)=>{if(matches({sql,params}))await pause();};
  h.beforeBatch=async statements=>{if(statements.some(matches))await pause();};
  return()=>assert(hit,'The intended commit boundary must actually be exercised');
}

async function savePlayer(h,player){
  player.deviceId=player.user.id+'-moderation-device';
  const lease=(await h.api('/sync/lease',post(player,{deviceId:player.deviceId}))).data,save=h.fresh();
  save.state.resources={gold:10000,rice:10000,wood:10000,stone:10000};save.state.magatama=1000;
  save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
  await h.api('/sync',{method:'PUT',token:player.token,body:{deviceId:player.deviceId,revision:lease.revision,save}});
}
async function fixture(h,{save=false,staff=false}={}){
  const admin=await h.session('管理する運営'),target=await h.session('対象の領主'),peer=await h.session('他の本文を残す領主'),other=await h.session('別の領主');
  await h.api('/admin/claim',post(admin,{key:h.env.SENGOKU_ADMIN_KEY}));
  if(staff)await h.api('/admin/staff',post(admin,{targetPlayerId:target.user.id,action:'appoint',requestId:crypto.randomUUID()}));
  if(save)for(const player of [target,peer,other])await savePlayer(h,player);
  return{admin,target,peer,other};
}
async function linkedDevice(h,player,name='別の接続端末'){
  const pair=(await h.api('/devices/pair-code',post(player,{}))).data;
  return(await h.api('/devices/link',post(null,{code:pair.code,deviceName:name}))).data;
}
async function chat(h,player,channel,text,target){h.resetRates();return(await h.api('/chat',post(player,{channel,text,...(target?{target:target.user.id}:{})}))).data.message;}
async function seedCommunications(h,p){
  const {admin,target,peer,other}=p,guild=(await h.api('/guild',post(peer,{name:'本文を保存する同盟'}))).data.guild;
  await h.api('/guild/join',post(target,{guildId:guild.id}));
  await h.api('/friends/request',post(target,{userId:peer.user.id}));await h.api('/friends/respond',post(peer,{userId:target.user.id,accept:true}));
  for(const channel of ['world','guild','friend','admin']){
    await chat(h,target,channel,'削除本文:'+channel,channel==='friend'?peer:null);
    await chat(h,channel==='admin'?admin:peer,channel,'保存本文:'+channel,channel==='friend'?target:null);
  }
  const personal=(await letter(h,target,peer,'削除本文:個人書状')).data.thread;
  await reply(h,peer,personal.id,'保存本文:個人返信');const prior={requestId:'old-personal-reply',text:'削除本文:個人最新'};await h.api('/letters/'+personal.id+'/messages',post(target,prior));
  const guildOwn=(await letter(h,target,peer,'削除本文:ギルド書状',{destination:'guild',guildId:guild.id})).data.thread;
  await reply(h,peer,guildOwn.id,'保存本文:ギルド返信');await reply(h,target,guildOwn.id,'削除本文:ギルド最新');
  const guildOther=(await letter(h,other,peer,'保存本文:他人の開始',{destination:'guild',guildId:guild.id})).data.thread;
  await reply(h,target,guildOther.id,'削除本文:メンバー返信');await reply(h,peer,guildOther.id,'保存本文:他人の最後');
  return{guild,threads:[personal,guildOwn,guildOther],priorReply:{route:'/letters/'+personal.id+'/messages',body:prior}};
}
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;calls+=h.calls;console.log('PASS '+name);}finally{h.close();}}

await scope('only the current sole administrator can moderate, with strict input and protected operator identity',async h=>{
  const {admin,target,peer,other}=await fixture(h,{staff:true}),paths=['/admin/moderation/players?q='+target.user.id,'/admin/moderation/target?playerId='+target.user.id,'/admin/moderation/bans'];
  for(const path of paths){await h.api(path,{expected:401});for(const actor of [target,peer])assert.equal((await h.api(path,{token:actor.token,expected:403})).data.error.code,'ADMIN_REQUIRED');}
  await h.api('/admin/moderation',post(null,banBody(h,target),401));
  for(const actor of [target,peer])assert.equal((await moderate(h,actor,other,'ban',{},403)).data.error.code,'ADMIN_REQUIRED');
  for(const action of ['ban','unban'])assert.equal((await moderate(h,admin,admin,action,{},400)).data.error.code,'INVALID_TARGET');
  await moderate(h,admin,{user:{id:'u_missing'}},'ban',{},404);
  const before=snapshot(h);
  for(const extra of [{action:'delete-user'},{expectedRevision:-1},{expectedRevision:0.5},{expectedRevision:'0'},{requestId:null},{reason:'字'.repeat(301)},{reason:123},{isAdmin:true}])await moderate(h,admin,peer,'ban',extra,400);
  assert.deepEqual(snapshot(h),before);
  const found=(await h.api(paths[0],{token:admin.token})).data.players;assert(found.some(player=>player.id===target.user.id));
  const info=await targetInfo(h,admin,target);assert.equal(info.ban.active,false);assert.equal(info.ban.revision,0);assert.equal(info.canBan,true);assert.equal(info.canUnban,false);
});

await scope('ban atomically erases only its author across all chats and personal or guild letters while preserving assets',async h=>{
  const p=await fixture(h,{save:true,staff:true}),{admin,target,peer}=p,seed=await seedCommunications(h,p);
  const otherChats=rows(h,'messages').filter(row=>row.user_id!==target.user.id),otherLetters=rows(h,'base_letter_messages').filter(row=>row.sender_id!==target.user.id);
  const save=savedRow(h,target).save_json,peerSave=savedRow(h,peer),before=await targetInfo(h,admin,target);
  assert.equal(before.counts.chatMessages,4);assert.equal(before.counts.letterMessages,5);
  const banned=(await moderate(h,admin,target)).data;
  assert.equal(banned.ban.active,true);assert.equal(banned.canBan,false);assert.equal(banned.canUnban,true);assert.equal(banned.receipt.deleted.chatMessages,4);assert.equal(banned.receipt.deleted.letterMessages,5);assert(banned.contentRevision>before.contentRevision);
  assert.equal(owned(h,'messages','user_id',target).length,0);assert.equal(owned(h,'base_letter_messages','sender_id',target).length,0);
  assert.deepEqual(rows(h,'messages'),otherChats);assert.deepEqual(rows(h,'base_letter_messages'),otherLetters);
  assert.equal(savedRow(h,target).save_json,save);assert.deepEqual(savedRow(h,peer),peerSave);
  assert.equal(savedRow(h,target).writer_device_id,null);assert.equal(savedRow(h,target).lease_expires_at,0);
  for(const thread of seed.threads){
    const data=(await h.api('/letters/'+thread.id,{token:peer.token})).data;
    assert(!JSON.stringify(data).includes('削除本文:'));assert(data.messages.some(message=>message.text.startsWith('保存本文:')));
    const max=h.sql.prepare('SELECT COALESCE(MAX(seq),0) seq FROM base_letter_messages WHERE thread_id=?').get(thread.id).seq;
    assert.equal(data.thread.lastSeq,max,'A removed latest message never remains the thread preview');
  }
  for(const channel of ['world','guild','friend','admin']){
    const actor=channel==='admin'?admin:peer,route='/chat?channel='+channel+(channel==='friend'?'&target='+target.user.id:'');
    const data=(await h.api(route,{token:actor.token})).data;assert(!JSON.stringify(data).includes('削除本文:'));assert(data.messages.some(message=>message.text==='保存本文:'+channel));
  }
  const bans=(await h.api('/admin/moderation/bans',{token:admin.token})).data;assert.equal(bans.bans.length,1);assert.equal(bans.bans[0].player.id,target.user.id);assert.equal(bans.bans[0].ban.reason,'検証用の非公開判断理由');
  for(const route of ['/config','/online','/players?q='+encodeURIComponent('対象'),'/chat?channel=world','/letters']){
    const data=(await h.api(route,{token:peer.token})).data;assert(!JSON.stringify(data).includes('検証用の非公開判断理由'));
  }
});

await scope('all existing tokens and pairing routes are blocked until unban, which restores the identity but never its old text',async h=>{
  const {admin,target,peer}=await fixture(h,{save:true}),linked=await linkedDevice(h,target),unused=(await h.api('/devices/pair-code',post(target,{}))).data;
  await h.api('/presence',post(target,{deviceId:target.deviceId,online:true}));await chat(h,target,'world','消したままの本文');
  const oldLetter=letterBody(peer,'消したままの書状',{requestId:'deleted-letter-replay'});await h.api('/letters',post(target,oldLetter));
  const unchanged=savedRow(h,target).save_json;await moderate(h,admin,target);
  const writes=[['/chat','POST',{channel:'world',text:'BAN中の投稿'}],['/letters','POST',letterBody(peer,'BAN中の書状')],['/trades','POST',{}],['/profile','PATCH',{name:'回避した名前'}],['/presence','POST',{deviceId:target.deviceId,online:true}],['/devices/pair-code','POST',{}],['/sync/lease','POST',{deviceId:target.deviceId,takeOver:true}],['/sync/release','POST',{deviceId:target.deviceId}],['/sync/settle','POST',{deviceId:target.deviceId,revision:1}],['/sync','PUT',{deviceId:target.deviceId,revision:1,save:JSON.parse(unchanged)}],['/friends/request','POST',{userId:peer.user.id}],['/guild/join','POST',{guildId:'g_any'}],['/walking/start','POST',{}],['/me/avatar','PUT',{}]];
  for(const actor of [target,linked]){
    for(const route of ['/me','/sync','/chat?channel=world','/letters','/trades','/guild','/admin/staff']){
      const result=await h.api(route,{token:actor.token,expected:403});assert.equal(result.data.error.code,'ACCOUNT_BANNED');assert(!JSON.stringify(result.data).includes('非公開判断理由'));
    }
    for(const [route,method,body] of writes)assert.equal((await h.api(route,{method,token:actor.token,body,expected:403})).data.error.code,'ACCOUNT_BANNED');
  }
  await h.api('/devices/link',post(null,{code:unused.code,deviceName:'BAN後リンク'},410));
  assert.equal(savedRow(h,target).save_json,unchanged);assert(owned(h,'player_presence','user_id',target).every(row=>row.online===0));
  const unbanned=(await moderate(h,admin,target,'unban')).data;assert.equal(unbanned.ban.active,false);assert.equal(unbanned.canBan,true);assert.equal(unbanned.canUnban,false);
  for(const actor of [target,linked])assert.equal((await h.api('/me',{token:actor.token})).data.user.id,target.user.id);
  assert.deepEqual((await h.api('/admin/moderation/bans',{token:admin.token})).data.bans,[]);
  const replay=await h.api('/letters',post(target,oldLetter,null));assert([200,404,409].includes(replay.response.status));assert.equal(owned(h,'base_letter_messages','sender_id',target).length,0,'A pre-ban send receipt cannot recreate erased correspondence');
  await chat(h,target,'world','解除後の新しい本文');assert.deepEqual(owned(h,'messages','user_id',target).map(row=>row.body),['解除後の新しい本文']);
  assert.equal((await linkedDevice(h,target,'解除後の端末')).user.id,target.user.id);await h.api('/devices/link',post(null,{code:unused.code,deviceName:'古いコード再利用'},410));
});

await scope('in-flight posts in every chat cannot resurrect text even when a ban and unban both finish before commit',async h=>{
  const p=await fixture(h,{staff:true}),{admin,target,peer}=p;await seedCommunications(h,p);
  for(const cycle of [false,true])for(const channel of ['world','guild','friend','admin']){
    h.resetRates();const text='復活させない:'+channel+':'+cycle;
    const check=interceptCommit(h,statement=>statement.sql.includes('INSERT INTO messages'),async()=>{await moderate(h,admin,target);if(cycle)await moderate(h,admin,target,'unban');});
    const result=await h.api('/chat',post(target,{channel,text,...(channel==='friend'?{target:peer.user.id}:{})},cycle?409:403));check();
    assert.equal(result.data.error.code,cycle?'ACCOUNT_ACCESS_CHANGED':'ACCOUNT_BANNED');assert(!rows(h,'messages').some(row=>row.body===text));
    if(!cycle)await moderate(h,admin,target,'unban');
  }
});

await scope('new and reply letter batches recheck the authenticated generation before preserving any receipt or body',async h=>{
  const {admin,target,peer,other}=await fixture(h),thread=(await letter(h,peer,target,'保存する先行書状')).data.thread;
  for(const cycle of [false,true])for(const replying of [false,true]){
    h.resetRates();const id=crypto.randomUUID(),text='遅着本文:'+cycle+':'+replying,route=replying?'/letters/'+thread.id+'/messages':'/letters';
    const body=replying?{requestId:id,text}:letterBody(other,text,{requestId:id});
    const check=interceptCommit(h,statement=>statement.sql.includes('INSERT INTO base_letter_requests'),async()=>{await moderate(h,admin,target);if(cycle)await moderate(h,admin,target,'unban');});
    const result=await h.api(route,post(target,body,cycle?409:403));check();assert.equal(result.data.error.code,cycle?'ACCOUNT_ACCESS_CHANGED':'ACCOUNT_BANNED');
    assert(!rows(h,'base_letter_messages').some(row=>row.body===text));assert(!rows(h,'base_letter_requests').some(row=>row.actor_id===target.user.id&&row.request_id===id));
    assert.equal(rows(h,'base_letter_messages').filter(row=>row.body==='保存する先行書状').length,1);
    if(!cycle)await moderate(h,admin,target,'unban');
  }
});

await scope('in-flight saves, pairing creation, redemption and presence cannot cross a moderation transition',async h=>{
  const {admin,target}=await fixture(h,{save:true});
  const before=savedRow(h,target),save=JSON.parse(before.save_json);save.state.resources.gold--;
  const saveCheck=interceptCommit(h,statement=>statement.sql.includes('UPDATE player_saves SET save_json='),async()=>{await moderate(h,admin,target);await moderate(h,admin,target,'unban');});
  const writing=await h.api('/sync',{method:'PUT',token:target.token,body:{deviceId:target.deviceId,revision:before.revision,save},expected:409});saveCheck();
  assert.equal(writing.data.error.code,'ACCOUNT_ACCESS_CHANGED');assert.equal(savedRow(h,target).save_json,before.save_json);
  const createCheck=interceptCommit(h,statement=>statement.sql.includes('INSERT INTO pairing_codes'),async()=>{await moderate(h,admin,target);await moderate(h,admin,target,'unban');});
  const creating=await h.api('/devices/pair-code',post(target,{},409));createCheck();assert.equal(creating.data.error.code,'ACCOUNT_ACCESS_CHANGED');assert.equal(owned(h,'pairing_codes','user_id',target).length,0);
  const pair=(await h.api('/devices/pair-code',post(target,{}))).data,count=owned(h,'user_sessions','user_id',target).length;
  const redeemCheck=interceptCommit(h,statement=>statement.sql.includes('INSERT INTO user_sessions'),async()=>{await moderate(h,admin,target);await moderate(h,admin,target,'unban');});
  const redemption=await h.api('/devices/link',post(null,{code:pair.code,deviceName:'遅い端末'},409));redeemCheck();assert.equal(redemption.data.error.code,'ACCOUNT_ACCESS_CHANGED');assert.equal(owned(h,'user_sessions','user_id',target).length,count);
  const presenceCheck=interceptCommit(h,statement=>statement.sql.includes('INSERT INTO player_presence'),async()=>{await moderate(h,admin,target);await moderate(h,admin,target,'unban');});
  const presence=await h.api('/presence',post(target,{deviceId:target.deviceId,online:true},409));presenceCheck();assert.equal(presence.data.error.code,'ACCOUNT_ACCESS_CHANGED');assert(owned(h,'player_presence','user_id',target).every(row=>row.online===0));
});

await scope('old action receipts replay without reversing current state and stale revisions cannot act after a ban-unban cycle',async h=>{
  const {admin,target,peer}=await fixture(h),ban=banBody(h,target),first=(await h.api('/admin/moderation',post(admin,ban))).data;
  assert.equal(first.idempotent,false);assert.equal(first.receipt.action,'ban');assert.equal(first.receipt.targetPlayerId,target.user.id);assert.equal(first.receipt.actorPlayerId,admin.user.id);
  const unban=banBody(h,target,'unban'),second=(await h.api('/admin/moderation',post(admin,unban))).data,before=snapshot(h);
  const replayBan=(await h.api('/admin/moderation',post(admin,ban))).data;assert.equal(replayBan.idempotent,true);assert.equal(replayBan.ban.active,false);assert.equal(replayBan.ban.revision,second.ban.revision);assert.deepEqual(replayBan.receipt,first.receipt);assert.deepEqual(snapshot(h),before);
  await moderate(h,admin,target,'unban',{},409);
  for(const change of [{reason:'別の理由'},{targetPlayerId:peer.user.id},{action:'unban'}])assert.equal((await h.api('/admin/moderation',post(admin,{...ban,...change},409))).data.error.code,'REQUEST_ID_REUSED');
  const third=(await moderate(h,admin,target)).data,again=snapshot(h);
  const replayUnban=(await h.api('/admin/moderation',post(admin,unban))).data;assert.equal(replayUnban.idempotent,true);assert.equal(replayUnban.ban.active,true);assert.equal(replayUnban.ban.revision,third.ban.revision);assert.deepEqual(replayUnban.receipt,second.receipt);assert.deepEqual(snapshot(h),again);
  await moderate(h,admin,target,'ban',{},409);await moderate(h,admin,target,'unban',{expectedRevision:0},409);
  for(const action of ['unban','ban']){
    h.resetRates();const expected=revision(h,target),desired=action==='ban';
    const check=interceptCommit(h,statement=>statement.sql.includes('INSERT INTO moderation_requests'),async()=>{await moderate(h,admin,target,action);await moderate(h,admin,target,action==='ban'?'unban':'ban');});
    const result=await moderate(h,admin,target,action,{expectedRevision:expected},409);check();assert.equal(result.data.error.code,'MODERATION_CHANGED');
    const current=await targetInfo(h,admin,target);assert.equal(current.ban.active,!desired);assert.equal(current.ban.revision,expected+2);
    if(action==='unban')await moderate(h,admin,target,'unban');
  }
});

await scope('duplicate moderation requests and a lost committed response apply once while changed administrator authority blocks commit',async h=>{
  const {admin,target,other}=await fixture(h),body=banBody(h,target);let arrived=0,release;const gate=new Promise(resolve=>release=resolve);
  h.beforeBatch=async statements=>{if(!moderationBatch(statements))return;if(++arrived===2){h.beforeBatch=null;release();}await gate;};
  const twin=await Promise.all([h.api('/admin/moderation',post(admin,body)),h.api('/admin/moderation',post(admin,body))]);
  assert.deepEqual(twin.map(result=>result.data.idempotent).sort(),[false,true]);assert.equal(twin[0].data.receipt.id,twin[1].data.receipt.id);assert.equal(revision(h,target),1);assert.equal(rows(h,'moderation_requests').length,1);
  const unban=banBody(h,target,'unban');h.afterBatch=statements=>{if(moderationBatch(statements)){h.afterBatch=null;throw Error('local moderation reply loss');}};
  await h.api('/admin/moderation',post(admin,unban,500));assert.equal((await targetInfo(h,admin,target)).ban.active,false);
  const recovered=(await h.api('/admin/moderation',post(admin,unban))).data;assert.equal(recovered.idempotent,true);assert.equal(revision(h,target),2);assert.equal(rows(h,'moderation_requests').length,2);
  const before=snapshot(h),check=interceptCommit(h,statement=>statement.sql.includes('INSERT INTO moderation_requests'),async()=>{h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(other.user.id);});
  const forbidden=await moderate(h,admin,target,'ban',{},null);check();assert([403,409].includes(forbidden.response.status));assert.deepEqual(snapshot(h),before);
  await h.api('/admin/moderation',post(admin,body,403));
});

await scope('failures midway through text purge or trade refunds roll back moderation and all affected records',async h=>{
  const p=await fixture(h,{save:true,staff:true}),{admin,target,peer}=p;await seedCommunications(h,p);
  await h.api('/presence',post(target,{deviceId:target.deviceId,online:true}));await h.api('/devices/pair-code',post(target,{}));await trade(h,peer,target,{gold:25},{});
  const body=banBody(h,target),before=snapshot(h);
  for(const [name,sql] of [
    ['fail_purge',`CREATE TRIGGER fail_purge BEFORE DELETE ON base_letter_messages WHEN OLD.sender_id='${target.user.id}' BEGIN SELECT RAISE(ABORT,'local purge failure'); END`],
    ['fail_refund',"CREATE TRIGGER fail_refund BEFORE INSERT ON trade_deliveries BEGIN SELECT RAISE(ABORT,'local refund failure'); END"]
  ]){
    h.sql.exec(sql);await h.api('/admin/moderation',post(admin,body,500));assert.deepEqual(snapshot(h),before);h.sql.exec('DROP TRIGGER '+name);
    assert.equal((await h.api('/me',{token:target.token})).data.user.id,target.user.id);
  }
  const success=(await h.api('/admin/moderation',post(admin,body))).data;assert.equal(success.idempotent,false);assert.equal(success.ban.active,true);assert.equal(success.receipt.cancelledTrades,1);
});

await scope('content revisions reset stale chat and letter cursors without exposing deleted bodies or private reasons',async h=>{
  const p=await fixture(h,{staff:true}),{admin,target,peer}=p,seed=await seedCommunications(h,p);
  const world=(await h.api('/chat?channel=world',{token:peer.token})).data,thread=(await h.api('/letters/'+seed.threads[0].id,{token:peer.token})).data,inbox=(await h.api('/letters?limit=1',{token:peer.token})).data;
  assert(Number.isSafeInteger(world.contentRevision));assert(Number.isSafeInteger(thread.contentRevision));assert(inbox.nextCursor);
  const result=(await moderate(h,admin,target)).data,newRevision=result.contentRevision;assert(newRevision>world.contentRevision);
  const chatReset=(await h.api('/chat?channel=world&after='+world.nextAfter+'&contentRevision='+world.contentRevision,{token:peer.token})).data;
  assert.equal(chatReset.reset,true);assert.equal(chatReset.contentRevision,newRevision);assert(!JSON.stringify(chatReset).includes('削除本文:'));assert(chatReset.messages.some(message=>message.text==='保存本文:world'));
  for(const suffix of ['after='+thread.readCursor,'before='+thread.readCursor]){
    const fresh=(await h.api('/letters/'+seed.threads[0].id+'?'+suffix+'&contentRevision='+thread.contentRevision,{token:peer.token})).data;
    assert.equal(fresh.reset,true);assert.equal(fresh.contentRevision,newRevision);assert(!JSON.stringify(fresh).includes('削除本文:'));assert(fresh.messages.some(message=>message.text==='保存本文:個人返信'));
  }
  const freshInbox=(await h.api('/letters?limit=1&cursor='+encodeURIComponent(inbox.nextCursor)+'&contentRevision='+inbox.contentRevision,{token:peer.token})).data;
  assert.equal(freshInbox.reset,true);assert.equal(freshInbox.contentRevision,newRevision);assert(!JSON.stringify(freshInbox).includes('削除本文:'));
  const current=(await h.api('/chat?channel=world&after='+chatReset.nextAfter+'&contentRevision='+newRevision,{token:peer.token})).data;
  assert.notEqual(current.reset,true);assert.deepEqual(current.messages,[]);
  const summary=(await h.api('/letters/summary',{token:peer.token})).data;assert.equal(summary.contentRevision,newRevision);
});

await scope('authenticated private reads started before a ban cannot finish under the old account generation',async h=>{
  const {admin,target,peer}=await fixture(h,{save:true}),thread=(await letter(h,peer,target,'非公開の受信本文')).data.thread;
  await chat(h,peer,'world','世界の本文');await trade(h,peer,target,{gold:20},{rice:10});
  const routes=[
    ['/chat?channel=world',sql=>sql.includes('FROM messages m')],
    ['/letters/'+thread.id,sql=>sql.includes('FROM base_letter_threads t')],
    ['/sync',sql=>sql.includes('FROM player_saves')],
    ['/trades?box=incoming',sql=>sql.includes('FROM trades t')]
  ];
  for(const cycle of [false,true])for(const [route,match] of routes){
    h.resetRates();const check=interceptCommit(h,statement=>match(statement.sql),async()=>{await moderate(h,admin,target);if(cycle)await moderate(h,admin,target,'unban');});
    const result=await h.api(route,{token:target.token,expected:cycle?409:403});check();assert.equal(result.data.error.code,cycle?'ACCOUNT_ACCESS_CHANGED':'ACCOUNT_BANNED');assert(!JSON.stringify(result.data).includes('非公開の受信本文'));
    if(!cycle)await moderate(h,admin,target,'unban');
  }
});

await scope('new destinations recheck a recipient ban before committing letters or escrow and existing other-author replies remain intact',async h=>{
  const {admin,target,peer,other}=await fixture(h,{save:true}),thread=(await letter(h,target,peer,'後に削除する本文')).data.thread;
  await reply(h,peer,thread.id,'他人からの保存する返信');
  const before=savedRow(h,peer),proposal=tradeBody(h,peer,target,{gold:123},{});
  const tradeCheck=interceptCommit(h,statement=>statement.sql.includes('INSERT INTO trade_requests'),async()=>{await moderate(h,admin,target);});
  const rejectedTrade=await h.api('/trades',post(peer,proposal,404));tradeCheck();assert.equal(rejectedTrade.data.error.code,'PLAYER_NOT_FOUND');assert.deepEqual(savedRow(h,peer),before);assert.equal(rows(h,'trades').length,0);
  for(const route of ['/letters/recipient?playerId='+target.user.id,'/trades/recipient?playerId='+target.user.id])await h.api(route,{token:peer.token,expected:404});
  await reply(h,peer,thread.id,'BAN中も他人の新しい返信');
  await moderate(h,admin,target,'unban');
  const body=letterBody(target,'遅れた新しい宛先への本文'),letterCheck=interceptCommit(h,statement=>statement.sql.includes('INSERT INTO base_letter_requests'),async()=>{await moderate(h,admin,target);});
  const rejectedLetter=await h.api('/letters',post(other,body,404));letterCheck();assert.equal(rejectedLetter.data.error.code,'PLAYER_NOT_FOUND');assert(!rows(h,'base_letter_requests').some(row=>row.actor_id===other.user.id&&row.request_id===body.requestId));
  assert.deepEqual(owned(h,'base_letter_messages','sender_id',peer).map(row=>row.body),['他人からの保存する返信','BAN中も他人の新しい返信']);
});

await scope('the private banned roster paginates deterministically and excludes unbanned identities without restoring posts',async h=>{
  const {admin,target,peer,other}=await fixture(h);
  for(const actor of [target,peer,other]){await chat(h,actor,'world','一覧削除:'+actor.user.id);await moderate(h,admin,actor);}
  let cursor='',seen=[];do{const data=(await h.api('/admin/moderation/bans?limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{token:admin.token})).data;assert.equal(data.bans.length,1);assert(data.bans[0].ban.active);seen.push(data.bans[0].player.id);cursor=data.nextCursor;}while(cursor);
  assert.deepEqual(seen,[target,peer,other].map(actor=>actor.user.id).sort().reverse());
  for(const suffix of ['limit=0','limit=51','limit=1.5','cursor=broken'])await h.api('/admin/moderation/bans?'+suffix,{token:admin.token,expected:400});
  await moderate(h,admin,peer,'unban');const active=(await h.api('/admin/moderation/bans',{token:admin.token})).data;
  assert.deepEqual(active.bans.map(value=>value.player.id).sort(),[target.user.id,other.user.id].sort());assert.equal(rows(h,'messages').length,0);
  const found=(await h.api('/admin/moderation/players?q='+peer.user.id,{token:admin.token})).data.players;
  assert.equal(found[0].id,peer.user.id);assert.equal(found[0].banned,false);assert.equal(found[0].moderationRevision,2);
});

await scope('pending trades in both directions become intact refunds and completed deliveries survive ban and unban',async h=>{
  const {admin,target,peer,other}=await fixture(h,{save:true});
  const incoming=(await trade(h,peer,target,{gold:100},{rice:50})).data.trade.id,outgoing=(await trade(h,target,peer,{wood:70},{stone:30})).data.trade.id;
  const peerProceeds=(await trade(h,peer,target,{gold:11},{magatama:3})).data.trade.id;await tradeAction(h,target,peerProceeds,'accept');
  const targetProceeds=(await trade(h,target,peer,{stone:13},{gold:5})).data.trade.id;await tradeAction(h,peer,targetProceeds,'accept');
  const untouched=(await trade(h,other,peer,{rice:17},{wood:9})).data.trade.id,peerSave=savedRow(h,peer),otherSave=savedRow(h,other),targetSave=savedRow(h,target).save_json;
  const settled=rows(h,'trade_deliveries'),beforeRequests=rows(h,'trade_requests'),banned=(await moderate(h,admin,target)).data;
  assert.equal(banned.receipt.cancelledTrades,2);assert.equal(savedRow(h,target).save_json,targetSave);assert.deepEqual(savedRow(h,peer),peerSave);assert.deepEqual(savedRow(h,other),otherSave);assert.deepEqual(rows(h,'trade_requests'),beforeRequests);
  for(const [id,owner,assets] of [[incoming,peer,{gold:100}],[outgoing,target,{wood:70}]]){
    const t=h.sql.prepare('SELECT * FROM trades WHERE id=?').get(id),d=h.sql.prepare('SELECT * FROM trade_deliveries WHERE trade_id=?').get(id);
    assert.equal(t.status,'cancelled');assert.equal(d.recipient_id,owner.user.id);assert.equal(d.kind,'refund');assert.equal(d.claimed_at,null);
    assert.deepEqual(JSON.parse(d.assets_json),{gold:0,rice:0,wood:0,stone:0,magatama:0,...assets});
  }
  for(const before of settled)assert.deepEqual(h.sql.prepare('SELECT * FROM trade_deliveries WHERE trade_id=?').get(before.trade_id),before);
  assert.equal(h.sql.prepare('SELECT status FROM trades WHERE id=?').get(untouched).status,'pending');
  const peerBefore=JSON.parse(peerSave.save_json).state;await tradeAction(h,peer,incoming,'claim');await tradeAction(h,peer,peerProceeds,'claim');
  const peerAfter=JSON.parse(savedRow(h,peer).save_json).state;assert.equal(peerAfter.resources.gold,peerBefore.resources.gold+100);assert.equal(peerAfter.magatama,peerBefore.magatama+3);
  await tradeAction(h,target,outgoing,'claim',{},403);await moderate(h,admin,target,'unban');await h.api('/sync/lease',post(target,{deviceId:target.deviceId}));
  const before=JSON.parse(savedRow(h,target).save_json).state;await tradeAction(h,target,outgoing,'claim');await tradeAction(h,target,targetProceeds,'claim');
  const after=JSON.parse(savedRow(h,target).save_json).state;assert.equal(after.resources.wood,before.resources.wood+70);assert.equal(after.resources.gold,before.resources.gold+5);
  assert.equal(owned(h,'trade_deliveries','recipient_id',target).filter(row=>row.claimed_at===null).length,0);
});

await scope('ban closes walking measurement without removing earned steps and unban cannot revive its unclaimed tail',async h=>{
  const {admin,target}=await fixture(h,{save:true});
  const startBody=()=>({requestId:crypto.randomUUID(),deviceId:target.deviceId,expectedRevision:Number(savedRow(h,target).revision),campaignId:JSON.parse(savedRow(h,target).save_json).state.walking.campaignId});
  const opening=startBody(),started=(await h.api('/walking/start',post(target,opening))).data.walkingSession;
  h.now+=5000;
  const claim={deviceId:target.deviceId,expectedRevision:Number(savedRow(h,target).revision),sessionId:started.id,sessionToken:started.token,seq:1,totalSteps:10,activeMs:5000,finish:false};
  const earned=(await h.api('/walking/claim',post(target,claim))).data,save=savedRow(h,target).save_json,receipts=rows(h,'walking_receipts');
  assert.equal(earned.receipt.deltaSteps,10);assert.equal(owned(h,'walking_accounts','user_id',target)[0].total_steps,10);
  await moderate(h,admin,target);
  const account=owned(h,'walking_accounts','user_id',target)[0],session=h.sql.prepare('SELECT * FROM walking_sessions WHERE id=?').get(started.id);
  assert.equal(account.active_session_id,null);assert.equal(account.total_steps,10);assert.equal(session.closed,1);assert.equal(session.total_steps,10);assert.equal(session.last_seq,1);assert.deepEqual(rows(h,'walking_receipts'),receipts);assert.equal(savedRow(h,target).save_json,save);
  await moderate(h,admin,target,'unban');await h.api('/sync/lease',post(target,{deviceId:target.deviceId}));
  const replay=(await h.api('/walking/claim',post(target,claim))).data;assert.equal(replay.idempotent,true);assert.deepEqual(replay.receipt,earned.receipt);assert.equal(savedRow(h,target).save_json,save);assert.deepEqual(rows(h,'walking_receipts'),receipts);
  const oldStart=(await h.api('/walking/start',post(target,opening))).data;assert.equal(oldStart.idempotent,true);assert.equal(oldStart.walkingSession.closed,true);assert.equal(owned(h,'walking_accounts','user_id',target)[0].active_session_id,null);
  h.now+=5000;const tail={...claim,expectedRevision:Number(savedRow(h,target).revision),seq:2,totalSteps:20,activeMs:10000};
  const denied=(await h.api('/walking/claim',post(target,tail,409))).data;assert.equal(denied.error.code,'WALKING_SESSION_CLOSED');assert.equal(savedRow(h,target).save_json,save);assert.deepEqual(rows(h,'walking_receipts'),receipts);
  const fresh=(await h.api('/walking/start',post(target,startBody()))).data.walkingSession;assert.notEqual(fresh.id,started.id);assert.equal(fresh.closed,false);
  h.now+=5000;const resumed=(await h.api('/walking/claim',post(target,{deviceId:target.deviceId,expectedRevision:Number(savedRow(h,target).revision),sessionId:fresh.id,sessionToken:fresh.token,seq:1,totalSteps:3,activeMs:5000,finish:false}))).data;
  assert.equal(resumed.receipt.deltaSteps,3);assert.equal(owned(h,'walking_accounts','user_id',target)[0].total_steps,13);assert.equal(rows(h,'walking_receipts').length,2);
  const before=JSON.parse(save).state,after=JSON.parse(savedRow(h,target).save_json).state;
  for(const key of ['gold','rice','wood','stone'])assert.equal(after.resources[key],before.resources[key]+6);assert.equal(after.magatama,before.magatama+6);
});

console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0,coverage:['administrator-only moderation','author-only text erasure and private reasons','existing-token ban and unban','in-flight post/save/pairing/presence races','revision and idempotency across ban-unban cycles','atomic rollback','cache and cursor invalidation','pending trade refunds and saved assets','walking stop without reward loss or tail revival']},null,2));
