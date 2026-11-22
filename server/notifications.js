import {allowedPushEndpoint,pushDecode,sendWebPush} from './web-push.js';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=r=>r?.results||[];
const types=['battle','letter','operation','construction','event'];
const defaults={enabled:false,battle:true,letter:true,operation:true,construction:true,event:true,quietStart:22,quietEnd:8,digestMinutes:5};
const dto=p=>p?{enabled:!!p.enabled,...Object.fromEntries(types.map(k=>[k,!!p[k]])),quietStart:p.quiet_start,quietEnd:p.quiet_end,digestMinutes:p.digest_minutes}:{...defaults};
const configured=env=>!!env.WEB_PUSH_PRIVATE_JWK&&/^[A-Za-z0-9_-]{87}$/.test(env.WEB_PUSH_PUBLIC_KEY||'');
const campaignOf=state=>String(state?.walking?.campaignId||'legacy');
const stateOf=save=>{try{return (typeof save==='string'?JSON.parse(save):save)?.state||null;}catch(_){return null;}};
const jobKey=(userId,state,job)=>'job:'+userId+':'+encodeURIComponent(campaignOf(state))+':'+job.kind+':'+encodeURIComponent(job.id)+':'+job.targetLevel+(job.repair?':'+job.due:'');
const levelOf=(state,kind,id)=>kind==='building'?Number(state.buildings?.[id]||0):kind==='research'?Number(state.tech?.[id]||0):kind==='castle'?(state.castles?.[id]?.owner===state.clan?Number(state.castles[id].level||0):0):Number(state.branches?.find(b=>b.id===id&&!b.fallen)?.level||0);
export function notificationQuiet(p,now){const h=new Date(now+9*3600000).getUTCHours(),a=p.quiet_start,b=p.quiet_end;return a!==b&&(a<b?h>=a&&h<b:h>=a||h<b);}
function preferenceGate(userId,updatedAt,now,categories){
 const hour=new Date(now+9*3600000).getUTCHours();
 return{sql:`EXISTS(SELECT 1 FROM notification_preferences p WHERE p.user_id=? AND p.enabled=1 AND p.updated_at=? AND ${categories.map(k=>'p.'+k+'=1').join(' AND ')||'1=1'} AND (p.quiet_start=p.quiet_end OR (p.quiet_start<p.quiet_end AND (?<p.quiet_start OR ?>=p.quiet_end)) OR (p.quiet_start>p.quiet_end AND ?<p.quiet_start AND ?>=p.quiet_end))) AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=? AND b.active=1)`,args:[userId,updatedAt,hour,hour,hour,hour,userId]};
}
export function notificationStatements(db,userId,category,id,title,body,dueAt,now,gate='1=1',args=[]){
 if(!types.includes(category))throw Error('Invalid notification category');
 return[stmt(db,`INSERT INTO notification_outbox(id,user_id,category,title,body,due_at,created_at) SELECT ?,?,?,?,?,?,? WHERE ${gate} AND EXISTS(SELECT 1 FROM notification_preferences WHERE user_id=? AND enabled=1 AND ${category}=1) ON CONFLICT(id) DO NOTHING`,id,userId,category,title.slice(0,80),body.slice(0,200),dueAt,now,...args,userId)];
}
function pendingJobs(state){
 const base=Number(state?.worldClock?.elapsedMs??(Number(state?.turn||0)*60000+Number(state?.realtime?.elapsed||0)*1000)),chains=new Map(),result=[];
 for(const job of state?.jobs||[]){
  if(!['building','research','castle','branch'].includes(job.kind)||typeof job.id!=='string'||!Number.isSafeInteger(job.targetLevel))continue;
  const chain=job.kind+':'+job.id,remaining=Number(job.remainingSeconds??job.remaining*60);if(!Number.isFinite(remaining)||remaining<0)continue;
  const seconds=(chains.get(chain)||0)+remaining;chains.set(chain,seconds);
  result.push({...job,due:Number.isFinite(job.completesElapsedMs)?job.completesElapsedMs:Math.round(base+seconds*1000)});
 }
 return result;
}
function jobStatement(db,userId,state,job,now,clock,gate='1=1',args=[],completed=false){
 const due=completed?null:job.due,delay=completed?0:clock?.running?Math.max(0,due-clock.elapsedMs)/Math.max(.1,clock.speed):86400000;
 return stmt(db,`INSERT INTO notification_outbox(id,user_id,category,title,body,due_at,world_due_elapsed,created_at) SELECT ?,?,'construction',?,?,?,?,? WHERE ${gate} AND EXISTS(SELECT 1 FROM notification_preferences WHERE user_id=? AND enabled=1 AND construction=1) ON CONFLICT(id) DO UPDATE SET due_at=excluded.due_at,world_due_elapsed=excluded.world_due_elapsed WHERE notification_outbox.delivered_at IS NULL AND notification_outbox.leased_until<=?`,jobKey(userId,state,job),userId,job.kind==='research'?'研究が完成しました':'普請が完成しました','城下町と成長手帳で次の目標を確認できます。',Math.round(now+delay),due,now,...args,userId,now);
}
// Include these statements in the successful save transaction, using the same
// commit-token predicate as the save. This catches even work completed between ticks.
export function notificationSaveStatements(db,userId,beforeSave,afterSave,now,gate='1=1',gateArgs=[]){
 const before=stateOf(beforeSave),after=stateOf(afterSave);if(!before||!after||campaignOf(before)!==campaignOf(after))return[];
 const statements=[],oldJobs=pendingJobs(before);
 for(const kind of ['building','research','castle','branch']){
  const ids=kind==='building'?Object.keys(after.buildings||{}):kind==='research'?Object.keys(after.tech||{}):kind==='castle'?Object.keys(after.castles||{}):(after.branches||[]).map(b=>b.id);
  for(const id of ids){const old=levelOf(before,kind,id),next=levelOf(after,kind,id),repair=kind==='branch'&&before.branches?.find(b=>b.id===id)?.fallen&&next>0;if(next<=old||kind==='castle'&&before.castles?.[id]?.owner!==before.clan)continue;
   for(let targetLevel=repair?next:old+1;targetLevel<=Math.min(next,old+64);targetLevel++){const job=oldJobs.find(j=>j.kind===kind&&j.id===id&&j.targetLevel===targetLevel)||{kind,id,targetLevel};statements.push(jobStatement(db,userId,after,job,now,null,gate,gateArgs,true));}
  }
 }
 return statements;
}
function parseJob(userId,id){
 const prefix='job:'+userId+':';if(!id.startsWith(prefix))return null;
 try{const [campaign,kind,target,level,repairDue]=id.slice(prefix.length).split(':');if(!['building','research','castle','branch'].includes(kind)||!/^\d+$/.test(level))return null;return{campaign:decodeURIComponent(campaign),kind,id:decodeURIComponent(target),targetLevel:Number(level),repair:repairDue!==undefined,due:Number(repairDue)};}catch(_){return null;}
}
async function queueFacts(db,userId,since,now,clock){
 const statements=[];
 const mail=rows(await stmt(db,"SELECT id,title,created_at FROM mail_campaigns m WHERE (target_user_id=? OR target_user_id IS NULL) AND created_at>=? AND NOT EXISTS(SELECT 1 FROM mail_reads r WHERE r.mail_id=m.id AND r.user_id=?) ORDER BY created_at DESC LIMIT 20",userId,since,userId).all());
 for(const m of mail){const category=/戦闘|襲撃|戦勝|防衛|敗北|勝利|落城/.test(m.title)?'battle':'letter';statements.push(...notificationStatements(db,userId,category,'mail:'+userId+':'+m.id,category==='battle'?'本拠に合戦の報告が届きました':'新しいシステム便が届きました','ゲーム内の郵便で詳細を確認できます。',m.created_at,now));}
 const letters=rows(await stmt(db,`SELECT m.id,m.created_at FROM base_letter_messages m JOIN base_letter_threads t ON t.id=m.thread_id WHERE m.sender_id<>? AND m.created_at>=? AND ((t.kind='player' AND (t.user_a=? OR t.user_b=?)) OR (t.kind='guild' AND (t.sender_id=? OR EXISTS(SELECT 1 FROM guild_members WHERE user_id=? AND guild_id=t.guild_id)))) AND NOT EXISTS(SELECT 1 FROM base_letter_reads r WHERE r.thread_id=t.id AND r.user_id=? AND r.last_seq>=m.seq) ORDER BY m.created_at DESC LIMIT 20`,userId,since,userId,userId,userId,userId,userId).all());
 for(const m of letters)statements.push(...notificationStatements(db,userId,'letter','letter:'+userId+':'+m.id,'新しい書状が届きました','領主の書状から内容を確認できます。',m.created_at,now));
 const events=rows(await stmt(db,"SELECT id,starts_at,ends_at FROM timed_events WHERE status='active' AND ends_at>? AND (starts_at>=? OR ends_at<=?)",now,since,now+3600000).all());
 for(const e of events){if(e.starts_at>=since)statements.push(...notificationStatements(db,userId,'event','event:start:'+userId+':'+e.id,'期間限定合戦が始まりました','期間限定合戦から戦場と報酬を確認できます。',e.starts_at,now));statements.push(...notificationStatements(db,userId,'event','event:end:'+userId+':'+e.id,'期間限定合戦がまもなく終了します','残りの戦功目標を確認しましょう。',e.ends_at-3600000,now));}
 const saveRow=await stmt(db,'SELECT save_json,revision FROM player_saves WHERE user_id=?',userId).first(),state=stateOf(saveRow?.save_json),jobs=state?pendingJobs(state):[];
 if(state&&clock&&!state.gameOver)for(const job of jobs)statements.push(jobStatement(db,userId,state,job,now,clock,'EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?)',[userId,saveRow.revision]));
 // A cancelled construction, a lost castle or a new campaign must not leave a
 // stale forecast behind. Completed levels survive removal from state.jobs.
 const queued=rows(await stmt(db,"SELECT id FROM notification_outbox WHERE user_id=? AND category='construction' AND delivered_at IS NULL",userId).all());
 for(const item of queued){const job=parseJob(userId,item.id);if(job&&(!state||job.campaign!==campaignOf(state)||levelOf(state,job.kind,job.id)<job.targetLevel&&!jobs.some(j=>jobKey(userId,state,j)===item.id)))statements.push(stmt(db,'DELETE FROM notification_outbox WHERE id=? AND delivered_at IS NULL AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?)',item.id,userId,saveRow?.revision??null));}
 statements.push(stmt(db,`DELETE FROM notification_outbox WHERE user_id=? AND category='operation' AND delivered_at IS NULL AND id LIKE ? AND NOT EXISTS(SELECT 1 FROM alliance_operations o JOIN guild_members m ON m.guild_id=o.guild_id AND m.user_id=? WHERE ('operation:'||?||':'||o.id)=notification_outbox.id AND o.status='planned' AND o.expires_at>? AND o.starts_at>?)`,userId,'operation:'+userId+':%',userId,userId,now,now-900000));
 const operations=rows(await stmt(db,`SELECT o.id,o.starts_at FROM alliance_operations o JOIN guild_members m ON m.guild_id=o.guild_id AND m.user_id=? WHERE o.status='planned' AND o.starts_at>? AND o.starts_at<?`,userId,now-900000,now+3600000).all());
 for(const o of operations){const id='operation:'+userId+':'+o.id;statements.push(...notificationStatements(db,userId,'operation',id,'同盟の作戦時刻が近づいています','同盟作戦で集合時刻と担当を確認できます。',o.starts_at-300000,now));statements.push(stmt(db,'UPDATE notification_outbox SET due_at=? WHERE id=? AND delivered_at IS NULL',o.starts_at-300000,id));}
 if(statements.length)await db.batch(statements);
 return{saveRevision:saveRow?.revision??null};
}
function sourceGate(userId,message,now,snapshot){
 const prefix=kind=>kind+':'+userId+':',id=message.id;
 if(id.startsWith(prefix('mail')))return{sql:'EXISTS(SELECT 1 FROM mail_campaigns m WHERE m.id=? AND (m.target_user_id=? OR m.target_user_id IS NULL) AND NOT EXISTS(SELECT 1 FROM mail_reads r WHERE r.mail_id=m.id AND r.user_id=?))',args:[id.slice(prefix('mail').length),userId,userId]};
 if(id.startsWith(prefix('letter')))return{sql:`EXISTS(SELECT 1 FROM base_letter_messages m JOIN base_letter_threads t ON t.id=m.thread_id WHERE m.id=? AND m.sender_id<>? AND ((t.kind='player' AND (t.user_a=? OR t.user_b=?)) OR (t.kind='guild' AND (t.sender_id=? OR EXISTS(SELECT 1 FROM guild_members WHERE user_id=? AND guild_id=t.guild_id)))) AND NOT EXISTS(SELECT 1 FROM base_letter_reads r WHERE r.thread_id=t.id AND r.user_id=? AND r.last_seq>=m.seq))`,args:[id.slice(prefix('letter').length),userId,userId,userId,userId,userId,userId]};
 if(id.startsWith(prefix('operation')))return{sql:`EXISTS(SELECT 1 FROM alliance_operations o JOIN guild_members m ON m.guild_id=o.guild_id AND m.user_id=? WHERE o.id=? AND o.status='planned' AND o.starts_at<=? AND o.starts_at>? AND o.expires_at>?)`,args:[userId,id.slice(prefix('operation').length),now+300000,now-900000,now]};
 for(const phase of ['start','end']){const eventPrefix='event:'+phase+':'+userId+':';if(id.startsWith(eventPrefix))return{sql:`EXISTS(SELECT 1 FROM timed_events e WHERE e.id=? AND e.status='active' AND e.starts_at<=? AND e.ends_at>? ${phase==='end'?'AND e.ends_at<=?':''})`,args:[id.slice(eventPrefix.length),now,now,...(phase==='end'?[now+3600000]:[])]};}
 const job=parseJob(userId,id);
 if(job){
  const field=job.kind==='building'?'buildings':job.kind==='research'?'tech':'castles';
  const path='$.state.'+field+'.'+JSON.stringify(job.id)+(job.kind==='castle'?'.level':'');
  const level=job.kind==='branch'?`EXISTS(SELECT 1 FROM json_each(s.save_json,'$.state.branches') b WHERE json_extract(b.value,'$.id')=? AND json_extract(b.value,'$.level')>=? AND COALESCE(json_extract(b.value,'$.fallen'),0)=0)`:`COALESCE(json_extract(s.save_json,?),0)>=?`;
  const ownership=job.kind==='castle'?` AND json_extract(s.save_json,?)=json_extract(s.save_json,'$.state.clan')`:'';
  return{sql:`EXISTS(SELECT 1 FROM player_saves s WHERE s.user_id=? AND s.revision=? AND COALESCE(json_extract(s.save_json,'$.state.walking.campaignId'),'legacy')=? ${ownership} AND (${level} OR (COALESCE(json_extract(s.save_json,'$.state.gameOver'),0)=0 AND EXISTS(SELECT 1 FROM json_each(s.save_json,'$.state.jobs') j WHERE json_extract(j.value,'$.kind')=? AND json_extract(j.value,'$.id')=? AND json_extract(j.value,'$.targetLevel')=?))))`,args:[userId,snapshot.saveRevision,job.campaign,...(job.kind==='castle'?['$.state.castles.'+JSON.stringify(job.id)+'.owner']:[]),job.kind==='branch'?job.id:path,job.targetLevel,job.kind,job.id,job.targetLevel]};
 }
 return{sql:'1=1',args:[]};
}
async function deliverUser(env,p,clock,now){
 const db=env.DB,snapshot=await queueFacts(db,p.user_id,Math.max(p.since,Math.min(p.updated_at,now),now-86400000),now,clock);
 if(notificationQuiet(p,now))return{sent:0,failed:0};
 const categories=types.filter(k=>p[k]);if(!categories.length)return{sent:0,failed:0};
 const subscriptions=rows(await stmt(db,'SELECT * FROM notification_subscriptions WHERE user_id=? AND last_sent_at<=? ORDER BY created_at DESC LIMIT 5',p.user_id,now-p.digest_minutes*60000).all());if(!subscriptions.length)return{sent:0,failed:0};
 const token=crypto.randomUUID(),gate=preferenceGate(p.user_id,p.updated_at,now,categories);
 // D1 executes this UPDATE atomically. A second scheduler cannot claim these
 // messages while encryption or delivery is awaiting its network response.
 const claimed=rows(await stmt(db,`UPDATE notification_outbox SET lease_token=?,leased_until=? WHERE id IN(SELECT id FROM notification_outbox WHERE user_id=? AND delivered_at IS NULL AND due_at<=? AND leased_until<=? AND category IN(${categories.map(()=>'?').join(',')}) AND (world_due_elapsed IS NULL OR world_due_elapsed<=?) ORDER BY due_at,id LIMIT 8) AND ${gate.sql} RETURNING *`,token,now+120000,p.user_id,now,now,...categories,clock?.elapsedMs||0,...gate.args).all());
 const messages=[];
 for(const message of claimed){const source=sourceGate(p.user_id,message,now,snapshot),valid=await stmt(db,'SELECT 1 AS ok WHERE '+source.sql,...source.args).first();if(valid){messages.push(message);}else if(['construction','operation'].includes(message.category))await stmt(db,'UPDATE notification_outbox SET lease_token=\'\',leased_until=? WHERE id=? AND lease_token=?',now+300000,message.id,token).run();else await stmt(db,'UPDATE notification_outbox SET delivered_at=?,lease_token=\'\',leased_until=0 WHERE id=? AND lease_token=?',now,message.id,token).run();}
 if(!messages.length)return{sent:0,failed:0};
 const payload={title:messages.length===1?messages[0].title:'戦国VS：'+messages.length+'件のお知らせ',body:messages.length===1?messages[0].body:[...new Set(messages.map(m=>m.title))].slice(0,3).join(' ／ '),tag:'sengoku-update',url:'/?notice=1'};
 const result=await Promise.all(subscriptions.map(async sub=>{
  try{
   const r=await sendWebPush(sub,payload,env,now,async()=>{
    const commitNow=Date.now(),current=preferenceGate(p.user_id,p.updated_at,commitNow,[...new Set(messages.map(m=>m.category))]);
    const currentSources=messages.map(m=>sourceGate(p.user_id,m,commitNow,snapshot));
    if(messages.some(m=>m.category==='construction')&&Number.isSafeInteger(clock?.revision))currentSources.push({sql:'EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)',args:[clock.id||'world-v1',clock.revision]});
    const result=await stmt(db,`UPDATE notification_subscriptions SET last_sent_at=? WHERE id=? AND user_id=? AND revision=? AND last_sent_at=? AND ${current.sql} AND ${currentSources.map(s=>'('+s.sql+')').join(' AND ')} AND (SELECT COUNT(*) FROM notification_outbox WHERE lease_token=? AND leased_until>? AND delivered_at IS NULL)=? RETURNING id`,commitNow,sub.id,p.user_id,sub.revision,sub.last_sent_at,...current.args,...currentSources.flatMap(s=>s.args),token,commitNow,messages.length).all();return rows(result).length===1;
   });
   if(r.cancelled)return{sent:0,failed:0};
   if(r.ok){await stmt(db,'UPDATE notification_subscriptions SET failure_count=0 WHERE id=? AND revision=?',sub.id,sub.revision).run();return{sent:1,failed:0};}
   if(r.status===404||r.status===410){await stmt(db,'DELETE FROM notification_subscriptions WHERE id=? AND revision=?',sub.id,sub.revision).run();return{sent:0,failed:0};}
   await stmt(db,'UPDATE notification_subscriptions SET failure_count=failure_count+1 WHERE id=? AND revision=?',sub.id,sub.revision).run();return{sent:0,failed:1};
  }catch(_){await stmt(db,'UPDATE notification_subscriptions SET failure_count=failure_count+1,last_sent_at=? WHERE id=? AND revision=?',Date.now(),sub.id,sub.revision).run();return{sent:0,failed:1};}
 }));
 const sent=result.reduce((n,r)=>n+r.sent,0),failed=result.reduce((n,r)=>n+r.failed,0),finishedAt=Date.now();
 await stmt(db,sent?'UPDATE notification_outbox SET delivered_at=?,sent_at=?,leased_until=0,lease_token=\'\' WHERE lease_token=?':'UPDATE notification_outbox SET leased_until=?,sent_at=?,lease_token=\'\' WHERE lease_token=?',sent?finishedAt:finishedAt+300000,finishedAt,token).run();
 return{sent,failed};
}
export async function dispatchNotifications(env,clock=null){
 const db=env.DB,now=Date.now();if(!configured(env))return{ok:true,configured:false,sent:0};
 await stmt(db,'INSERT INTO notification_scheduler(id) VALUES(1) ON CONFLICT DO NOTHING').run();
 const claimed=rows(await stmt(db,'UPDATE notification_scheduler SET next_tick=? WHERE id=1 AND next_tick<=? RETURNING cursor',now+60000,now).all());if(!claimed.length)return{ok:true,sent:0,waiting:true};
 const records=rows(await stmt(db,`SELECT p.*,MIN(s.created_at) AS since FROM notification_preferences p JOIN notification_subscriptions s ON s.user_id=p.user_id WHERE p.enabled=1 AND p.user_id>? AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=p.user_id AND b.active=1) GROUP BY p.user_id ORDER BY p.user_id LIMIT 30`,claimed[0].cursor||'').all());
 // Advance the cursor before network I/O so the next tick can process another
 // page. At most six users (30 devices) send concurrently, in five short waves.
 await stmt(db,'UPDATE notification_scheduler SET cursor=? WHERE id=1 AND next_tick=?',records.length===30?records.at(-1).user_id:'',now+60000).run();
 let sent=0,failed=0;
 for(let offset=0;offset<records.length;offset+=6){const delivered=await Promise.allSettled(records.slice(offset,offset+6).map(p=>deliverUser(env,p,clock,Date.now())));for(const r of delivered){if(r.status==='fulfilled'){sent+=r.value.sent;failed+=r.value.failed;}else failed++;}}
 await stmt(db,"DELETE FROM notification_outbox WHERE category<>'construction' AND created_at<? AND (delivered_at IS NOT NULL OR due_at<?)",now-7*86400000,now-7*86400000).run();
 return{ok:true,sent,failed,checked:records.length};
}
export async function handleNotifications(ctx){
 const {db,user,env,now,path,method,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 if(path==='/notifications'&&method==='GET'){const p=await stmt(db,'SELECT * FROM notification_preferences WHERE user_id=?',user.id).first();return{ok:true,configured:configured(env),publicKey:configured(env)?env.WEB_PUSH_PUBLIC_KEY:null,preferences:dto(p),devices:Number((await stmt(db,'SELECT COUNT(*) AS n FROM notification_subscriptions WHERE user_id=?',user.id).first())?.n||0),serverNow:now};}
 const body=await h.readBody(ctx.request);await h.budget(db,'notifications:'+user.id,30,60000,now);const guard=h.accountCommitGuard(user);
 if(path==='/notifications/preferences'&&method==='POST'){
  if(types.some(k=>typeof body[k]!=='boolean')||typeof body.enabled!=='boolean'||!Number.isInteger(body.quietStart)||body.quietStart<0||body.quietStart>23||!Number.isInteger(body.quietEnd)||body.quietEnd<0||body.quietEnd>23||![0,5,15,60].includes(body.digestMinutes))h.fail(400,'NOTIFICATION_SETTINGS','通知の種類・日本時間の休止時間・間隔を確認してください。');
  const args=[user.id,body.enabled?1:0,...types.map(k=>body[k]?1:0),body.quietStart,body.quietEnd,body.digestMinutes,now,...guard.args],disabled=types.filter(k=>!body.enabled||!body[k]);
  const statements=[stmt(db,`INSERT INTO notification_preferences(user_id,enabled,battle,letter,operation,construction,event,quiet_start,quiet_end,digest_minutes,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql} ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled,battle=excluded.battle,letter=excluded.letter,operation=excluded.operation,construction=excluded.construction,event=excluded.event,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,digest_minutes=excluded.digest_minutes,updated_at=MAX(notification_preferences.updated_at+1,excluded.updated_at)`,...args)];
  if(disabled.length)statements.push(stmt(db,`DELETE FROM notification_outbox WHERE user_id=? AND delivered_at IS NULL AND category IN(${disabled.map(()=>'?').join(',')}) AND ${guard.sql}`,user.id,...disabled,...guard.args));
  await db.batch(statements);await h.requireAccountAccess(db,user);return{ok:true,preferences:dto(await stmt(db,'SELECT * FROM notification_preferences WHERE user_id=?',user.id).first())};
 }
 if(path==='/notifications/subscribe'&&method==='POST'){
  if(!configured(env))h.fail(503,'PUSH_NOT_CONFIGURED','通知配信の準備中です。');
  const endpoint=body.subscription?.endpoint,keys=body.subscription?.keys;
  if(typeof endpoint!=='string'||!allowedPushEndpoint(endpoint)||!/^[A-Za-z0-9_-]{87}$/.test(keys?.p256dh||'')||!/^[A-Za-z0-9_-]{22}$/.test(keys?.auth||''))h.fail(400,'PUSH_SUBSCRIPTION','ブラウザから発行された通知情報を確認してください。');
  try{const key=pushDecode(keys.p256dh),auth=pushDecode(keys.auth);if(key.length!==65||auth.length!==16)throw Error();await crypto.subtle.importKey('raw',key,{name:'ECDH',namedCurve:'P-256'},false,[]);}catch(_){h.fail(400,'PUSH_SUBSCRIPTION','通知の公開鍵が正しくありません。');}
  const id='pn_'+crypto.randomUUID().replaceAll('-',''),fingerprint=await h.hash(endpoint);
  const saved=rows(await stmt(db,`INSERT INTO notification_subscriptions(id,user_id,endpoint,pull_hash,p256dh,auth,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} AND NOT EXISTS(SELECT 1 FROM notification_subscriptions WHERE endpoint=? AND user_id<>?) AND (EXISTS(SELECT 1 FROM notification_subscriptions WHERE endpoint=? AND user_id=?) OR (SELECT COUNT(*) FROM notification_subscriptions WHERE user_id=?)<5) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,failure_count=0,revision=notification_subscriptions.revision+1 WHERE notification_subscriptions.user_id=excluded.user_id RETURNING id`,id,user.id,endpoint,fingerprint,keys.p256dh,keys.auth,now,...guard.args,endpoint,user.id,endpoint,user.id,user.id).all());
  if(!saved.length){await h.requireAccountAccess(db,user);const owner=await stmt(db,'SELECT user_id FROM notification_subscriptions WHERE endpoint=?',endpoint).first();if(owner&&owner.user_id!==user.id)h.fail(409,'PUSH_OTHER_ACCOUNT','このブラウザの通知を解除してから、現在の領主で登録し直してください。');h.fail(409,'PUSH_DEVICE_LIMIT','通知端末は5台までです。不要な端末の通知を解除してください。');}
  return{ok:true};
 }
 if(path==='/notifications/unsubscribe'&&method==='POST'){
  if(body.all===true)await stmt(db,'DELETE FROM notification_subscriptions WHERE user_id=? AND '+guard.sql,user.id,...guard.args).run();else if(typeof body.endpoint==='string')await stmt(db,'DELETE FROM notification_subscriptions WHERE user_id=? AND endpoint=? AND '+guard.sql,user.id,body.endpoint,...guard.args).run();else h.fail(400,'PUSH_SUBSCRIPTION','解除する通知端末を確認してください。');return{ok:true};
 }
 h.fail(404,'NOT_FOUND','通知の操作を確認してください。');
}
