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
    assert(!['isAdmin','isStaff','isOperator','is_admin','is_staff','is_operator','staffTitle','siteRole','roleTitle','operatorProtected','staffProtected','adminPlayerId','adminUserId','operatorPlayerId','operatorUserId'].includes(key),'Public role field '+key);
    if(key==='role')assert(!['admin','staff','operator'].includes(child),'Public role value '+child);
    if(key==='clan')assert.notEqual(child,'德川家');
    if(key==='kind')assert.notEqual(child,'staff-building');
    if(key==='ownedProducts')assert.deepEqual(child,[],'Site privileges never grant paid purchase marks');
    publicOnly(child,{self});
  }
}

await scope('public configuration never advertises management state and self recovery remains private',async h=>{
  const before=(await h.api('/config')).data,{admin,staff,viewer}=await people(h);
  for(const token of [undefined,admin.token,staff.token,viewer.token]){
    const config=(await h.api('/config',{token})).data;
    assert.deepEqual(config,before,'Public configuration is independent of management registration');
    for(const key of ['adminClaimed','adminRecoveryAvailable','adminPlayerId','adminUserId','management'])assert(!Object.hasOwn(config,key));
    publicOnly(config);
  }
  const owner=(await h.api('/me',{token:admin.token})).data;
  assert.equal(owner.user.isAdmin,true);assert.equal(owner.management.recoveryAvailable,true);
  for(const actor of [staff,viewer])assert(!Object.hasOwn((await h.api('/me',{token:actor.token})).data,'management'));
  delete h.env.SENGOKU_ADMIN_KEY;
  assert.equal((await h.api('/me',{token:admin.token})).data.management.recoveryAvailable,false);
  assert.deepEqual((await h.api('/config')).data,before);
});

await scope('public field pages project newly assigned fixed homes without changing personal saves or showing ordinary retainers',async h=>{
  async function start(name,castleId,mode='lord') {
    const actor=await h.session(name),deviceId='map-'+actor.user.id;
    const lease=(await h.api('/sync/lease',post(actor,{deviceId}))).data;
    await h.api('/castles/residency/start',post(actor,{deviceId,revision:lease.revision,requestId:crypto.randomUUID(),castleId,mode,clan:'織田家',difficulty:'normal'}));
    return actor;
  }
  const operator=await start('地図の甲','kiyosu'),office=await start('地図の乙','himeji'),ordinary=await start('地図の丙','inuyama');
  await start('地図の丁','inuyama','retainer');
  await h.api('/admin/claim',post(operator,{key:h.env.SENGOKU_ADMIN_KEY}));
  await h.api('/admin/staff',post(operator,{targetPlayerId:office.user.id,action:'appoint',requestId:crypto.randomUUID()}));
  const before=h.sql.prepare('SELECT user_id,save_json,revision FROM player_saves ORDER BY user_id').all();
  const expected=[[operator.user.id,'edo'],[office.user.id,'kyoto_gosho'],[ordinary.user.id,'inuyama']].sort();
  for(const viewer of [null,ordinary]) {
    const players=[],targets=[];let cursor='';
    for(let i=0;i<expected.length;i++){
      const page=(await h.api('/field?limit=1'+(cursor?'&cursor='+cursor:''),{token:viewer?.token})).data;
      publicOnly(page);assert.equal(page.total,expected.length);assert.equal(page.players.length,1);
      players.push(...page.players.map(p=>[p.playerId,p.homeCastleId]));targets.push(...page.targets.map(p=>[p.playerId,p.targetCastleId]));
      cursor=page.nextCursor;assert.equal(Boolean(cursor),i<expected.length-1);
    }
    assert.deepEqual(players,expected);assert.deepEqual(targets,expected);
  }
  assert.deepEqual(h.sql.prepare('SELECT user_id,save_json,revision FROM player_saves ORDER BY user_id').all(),before);
  const palace=(await h.api('/sync',{token:office.token})).data,deviceId='map-'+office.user.id;
  await h.api('/sync',{method:'PUT',token:office.token,body:{deviceId,save:palace.save,revision:palace.revision}});
  await h.api('/admin/staff',post(operator,{targetPlayerId:office.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
  const afterDismissal=(await h.api('/field?limit=1')).data;
  assert.equal(afterDismissal.total,2);assert.equal(afterDismissal.players.length,1);assert(afterDismissal.nextCursor);
  const last=(await h.api('/field?limit=1&cursor='+afterDismissal.nextCursor)).data;
  assert.equal(last.players.length,1);assert.equal(last.nextCursor,null);
  assert.deepEqual([...afterDismissal.players,...last.players].map(p=>p.playerId).sort(),[operator.user.id,ordinary.user.id].sort());
  const personal=(await h.api('/sync',{token:office.token})).data;
  await h.api('/sync',{method:'PUT',token:office.token,body:{deviceId,save:personal.save,revision:personal.revision}});
  const rejoined=(await h.api('/field')).data;publicOnly(rejoined);assert.equal(rejoined.total,3);
  assert.equal(rejoined.players.find(p=>p.playerId===office.user.id)?.homeCastleId,'himeji');
});

await scope('public lists show current offices while concealing site authority flags',async h=>{
  const {admin,staff,viewer}=await people(h);
  for(const actor of [admin,staff])await h.api('/presence',post(actor,{deviceId:actor.deviceId,online:true}));
  const online=(await h.api('/online')).data;publicOnly(online);assert.equal(online.players.length,2);
  for(const person of online.players){assert.equal(person.clan,'徳川家');assert.deepEqual(person.courtOffice,person.id===admin.user.id?{title:'太政大臣',kind:'chancellor'}:{title:'参議',kind:'official'});}
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

await scope('nested historical battle objects are projected while identities, stats and stored records survive',async h=>{
  const {admin,staff,viewer}=await people(h),id='fb_'+crypto.randomUUID().replaceAll('-','');
  const legacy={playerId:staff.user.id,name:staff.user.name,clan:'德川家',isAdmin:false,isStaff:true,role:'staff',roleTitle:'スタッフ',adminPlayerId:admin.user.id,defensePower:4321};
  const battle={id,attackerPlayerId:viewer.user.id,attackerName:viewer.user.name,defenderPlayerId:staff.user.id,defenderName:staff.user.name,castleId:'kyoto_gosho',castleName:'京都御所城',battleMode:'reward',won:true,troops:500,defensePower:4321,history:{state:legacy,save:{state:legacy},entitlements:{owner:legacy},staffBase:{startedBy:legacy}},createdAt:new Date(h.now).toISOString()};
  const raw=JSON.stringify(battle);
  h.sql.prepare('INSERT INTO field_battles(id,attacker_id,defender_id,occurred_elapsed_ms,result_json,created_at) VALUES(?,?,?,?,?,?)').run(id,viewer.user.id,staff.user.id,0,raw,h.now);
  const result=(await h.api('/field/me',{token:viewer.token})).data;publicOnly(result);
  const projected=result.battles.find(item=>item.id===id);
  assert.equal(projected.defenderPlayerId,staff.user.id);assert.equal(projected.defenderName,staff.user.name);assert.equal(projected.defensePower,4321);assert.equal(projected.battleMode,'reward');
  for(const person of [projected.history.state,projected.history.save.state,projected.history.entitlements.owner,projected.history.staffBase.startedBy]){assert.equal(person.playerId,staff.user.id);assert.equal(person.name,staff.user.name);assert.equal(person.clan,'徳川家');assert.equal(person.defensePower,4321);}
  assert.equal(h.sql.prepare('SELECT result_json FROM field_battles WHERE id=?').get(id).result_json,raw);
  const own=(await h.api('/sync',{token:staff.token})).data;
  assert.equal(own.user.isStaff,true);assert.equal(own.save.state.clan,'德川家');assert.equal(own.staffBase.id,'kyoto_gosho','Private shared base remains available to its authorized member');
});

await scope('site mail and event publication omit the managing player identity',async h=>{
  const {admin,staff,viewer}=await people(h),body='本人が入力した運営・スタッフという言葉は書き換えません。';
  const sent=(await h.api('/admin/mail',post(admin,{target:viewer.user.id,title:'催事のお知らせ',body,gift:{gold:5},requestId:'identity-site-mail'}))).data;
  const inbox=(await h.api('/mail',{token:viewer.token})).data;publicOnly(inbox);
  const mail=inbox.mail.find(item=>item.id===sent.mailId);
  assert.equal(mail.source,'site');assert.equal(mail.body,body);assert.equal(mail.gift.gold,5);assert.equal(mail.event,null);
  for(const key of ['senderId','sender_id','authorId','authorName','authorAvatarVersion','authorEvaluation','authorAppearance','createdBy','creatorId'])assert(!Object.hasOwn(mail,key));
  assert(!JSON.stringify(mail).includes(admin.user.id));assert(!JSON.stringify(mail).includes(admin.user.name));
  const planned=(await h.api('/admin/events/generate',post(admin,{battleId:'history:okehazama',durationDays:1,requestId:crypto.randomUUID()}))).data;
  await h.api('/admin/events/'+planned.event.id+'/publish',post(admin,{requestId:crypto.randomUUID()}));
  for(const path of ['/events','/events/'+planned.event.id]){
    const event=(await h.api(path,{token:viewer.token})).data;publicOnly(event);
    for(const field of ['creatorId','creator_id','createdBy','authorId','authorName'])assert(!JSON.stringify(event).includes('"'+field+'"'));
    assert(!JSON.stringify(event).includes(admin.user.id));
  }
  await h.api('/admin/events/generate',post(staff,{battleId:'history:okehazama',durationDays:1,requestId:crypto.randomUUID()},403));
  await h.api('/admin/mail',post(viewer,{target:'all',title:'偽装',body:'本文',requestId:'identity-forged-mail'},403));
});

await scope('letter profiles and old shared-building news use ordinary public identity without rewriting stored history',async h=>{
  const {admin,staff,viewer}=await people(h);
  const sent=(await h.api('/letters',post(admin,{requestId:'identity-letter',destination:'player',targetPlayerId:viewer.user.id,text:'以前の書状本文'}))).data;
  for(const path of ['/letters','/letters/'+sent.thread.id,'/letters/recipient?playerId='+staff.user.id,'/trades/recipient?playerId='+admin.user.id])publicOnly((await h.api(path,{token:viewer.token})).data);
  const id='ach_'+crypto.randomUUID().replaceAll('-',''),title='京都御所城の水田 Lv.3の共同普請を達成',detail='全スタッフの共同拠点へ成長が反映されました。';
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
