import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

// Local Worker/SQLite fixtures only. Authorization still uses private roles;
// public names must not disclose them or grant a purchase mark by role.
const post=(actor,body,expected=200)=>({method:'POST',token:actor?.token,body,expected});
const checks=[];let calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks.push(name);console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function savedPlayer(h,name){
  const actor=await h.session(name);actor.deviceId='identity-'+actor.user.id;
  const lease=(await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}))).data,save=h.fresh();
  save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};
  save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
  await h.api('/sync',{method:'PUT',token:actor.token,body:{deviceId:actor.deviceId,revision:lease.revision,save}});return actor;
}
async function people(h){
  const admin=await savedPlayer(h,'公開確認の甲'),staff=await savedPlayer(h,'公開確認の乙'),viewer=await savedPlayer(h,'公開確認の丙');
  await h.api('/admin/claim',post(admin,{key:h.env.SENGOKU_ADMIN_KEY}));
  await h.api('/admin/staff',post(admin,{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}));
  for(const actor of [admin,staff])await h.api('/sync',{token:actor.token});
  return {admin,staff,viewer};
}
function publicOnly(value,{self=null}={}){
  if(!value||typeof value!=='object')return;
  if(value===self)return;
  for(const [key,child]of Object.entries(value)){
    assert(!['isAdmin','isStaff','is_admin','is_staff','staffTitle','siteRole','operatorProtected','staffProtected'].includes(key),'Public role field '+key);
    if(key==='clan')assert.notEqual(child,'德川家');
    if(key==='kind')assert.notEqual(child,'staff-building');
    if(key==='ownedProducts')assert.deepEqual(child,[],'Site privileges never grant paid purchase marks');
    publicOnly(child,{self});
  }
}

await scope('public lists, friends, guild members, chats and field targets conceal site roles',async h=>{
  const {admin,staff,viewer}=await people(h);
  for(const actor of [admin,staff])await h.api('/presence',post(actor,{deviceId:actor.deviceId,online:true}));
  const online=(await h.api('/online')).data;publicOnly(online);assert.equal(online.players.length,2);
  for(const person of online.players)assert.equal(person.clan,'徳川家');
  const search=(await h.api('/players?q='+encodeURIComponent('公開確認'),{token:viewer.token})).data;publicOnly(search);assert.equal(search.players.length,2);
  for(const actor of [admin,staff]){
    await h.api('/friends/request',post(actor,{userId:viewer.user.id}));
    const pending=(await h.api('/me',{token:viewer.token})).data;publicOnly(pending,{self:pending.user});
    await h.api('/friends/respond',post(viewer,{userId:actor.user.id,accept:true}));
  }
  const me=(await h.api('/me',{token:viewer.token})).data;publicOnly(me,{self:me.user});assert.equal(me.friends.length,2);assert.equal(me.user.isAdmin,false);
  const guild=(await h.api('/guild',post(admin,{name:'公開確認の軍団'}))).data.guild;
  for(const actor of [staff,viewer])await h.api('/guild/join',post(actor,{guildId:guild.id}));
  for(const path of ['/guild','/guilds','/guild/rankings']){const data=(await h.api(path,{token:viewer.token})).data;publicOnly(data,{self:data.user});}
  for(const [actor,text]of [[admin,'運営という言葉を含む本人の文章'],[staff,'本文はそのまま残す']])await h.api('/chat',post(actor,{channel:'world',text}));
  const chat=(await h.api('/chat?channel=world',{token:viewer.token})).data;publicOnly(chat);assert.equal(chat.messages.length,2);assert.equal(chat.messages[0].text,'運営という言葉を含む本人の文章');
  const field=(await h.api('/field',{token:viewer.token})).data;publicOnly(field);
  for(const actor of [admin,staff])assert(field.players.some(player=>player.playerId===actor.user.id));
  assert.equal(field.rules.targetCastles,true,'Public combat mechanics remain available');
});

await scope('letter profiles and old shared-building news use ordinary public identity without rewriting stored history',async h=>{
  const {admin,staff,viewer}=await people(h);
  const sent=(await h.api('/letters',post(admin,{requestId:'identity-letter',destination:'player',targetPlayerId:viewer.user.id,text:'以前の書状本文'}))).data;
  for(const path of ['/letters','/letters/'+sent.thread.id,'/letters/recipient?playerId='+staff.user.id,'/trades/recipient?playerId='+admin.user.id])publicOnly((await h.api(path,{token:viewer.token})).data);
  const id='ach_'+crypto.randomUUID().replaceAll('-',''),title='駿府城の水田 Lv.3の共同普請を達成',detail='全スタッフの共同拠点へ成長が反映されました。';
  h.sql.prepare('INSERT INTO achievement_events(id,user_id,event_key,kind,target_id,target_name,value,title,detail,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,staff.user.id,'identity-legacy-build','staff-building','farm','水田',3,title,detail,h.now);
  const before=h.sql.prepare('SELECT * FROM achievement_events WHERE id=?').get(id),feed=(await h.api('/achievements')).data,event=feed.events.find(item=>item.id===id);
  publicOnly(feed);assert.equal(event.kind,'building');assert.equal(event.clan,'徳川家');assert(!event.title.includes('共同'));assert(!event.detail.includes('スタッフ'));
  assert.deepEqual(h.sql.prepare('SELECT * FROM achievement_events WHERE id=?').get(id),before,'Read projection preserves the historical record');
  assert.equal((await h.api('/letters/'+sent.thread.id,{token:viewer.token})).data.messages[0].text,'以前の書状本文');
});

await scope('self and authorized management retain roles while ordinary and forged callers remain rejected',async h=>{
  const {admin,staff,viewer}=await people(h),saves=h.sql.prepare('SELECT user_id,save_json FROM player_saves ORDER BY user_id').all();
  for(const [actor,key]of [[admin,'isAdmin'],[staff,'isStaff']]){
    const me=(await h.api('/me',{token:actor.token})).data,sync=(await h.api('/sync',{token:actor.token})).data;
    assert.equal(me.user[key],true);assert.equal(sync.user[key],true);assert.equal(sync.user.clan,'德川家');assert.deepEqual(me.user.appearance.ownedProducts,[]);
    const paired=(await h.api('/devices/pair-code',post(actor,{}))).data;
    const linked=(await h.api('/devices/link',post(null,{code:paired.code,deviceName:'本人確認の別端末'}))).data;assert.equal(linked.user[key],true);assert.equal(linked.user.id,actor.user.id);
  }
  const roster=(await h.api('/admin/staff',{token:admin.token})).data;assert.equal(roster.staff[0].isStaff,true);
  const recent=(await h.api('/staff/recent-logins',{token:staff.token})).data;assert(recent.players.some(player=>player.id===admin.user.id&&player.isAdmin));
  await h.api('/admin/staff',{token:viewer.token,expected:403});await h.api('/admin/staff',{token:staff.token,expected:403});await h.api('/staff/recent-logins',{token:viewer.token,expected:403});
  await h.api('/admin/moderation',post(viewer,{targetPlayerId:staff.user.id,action:'ban',reason:'偽装確認',requestId:crypto.randomUUID(),expectedRevision:0,isAdmin:true},403));
  const profile=(await h.api('/profile',{method:'PATCH',token:viewer.token,body:{name:viewer.user.name,isAdmin:true,isStaff:true,role:'admin'}})).data;assert.equal(profile.user.isAdmin,false);assert.equal(profile.user.isStaff,false);
  const recover=(await h.api('/admin/recover',post(null,{key:h.env.SENGOKU_ADMIN_KEY,requestId:crypto.randomUUID()}))).data;assert.equal(recover.user.id,admin.user.id);assert.equal(recover.user.isAdmin,true);
  assert.deepEqual(h.sql.prepare('SELECT user_id,save_json FROM player_saves ORDER BY user_id').all(),saves,'Presentation does not rewrite game saves');
});

console.log(JSON.stringify({passed:checks.length,calls,fixtureOnly:true}));
