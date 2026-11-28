import {allowedPushEndpoint,pushDecode,sendWebPush} from './web-push.js';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=r=>r?.results||[];
const legacyTypes=['battle','letter','operation','construction','event'],messageTypes=['chat','worldChat','announcement'],types=[...legacyTypes,...messageTypes];
const defaults={enabled:false,battle:true,letter:true,operation:true,construction:true,event:true,chat:true,worldChat:false,announcement:true,quietStart:0,quietEnd:0,digestMinutes:0};
const dto=p=>p?{enabled:!!p.enabled,...Object.fromEntries(types.map(k=>[k,!!p[k]])),quietStart:p.quiet_start,quietEnd:p.quiet_end,digestMinutes:p.digest_minutes}:{...defaults};
const configured=env=>!!env.WEB_PUSH_PRIVATE_JWK&&/^[A-Za-z0-9_-]{87}$/.test(env.WEB_PUSH_PUBLIC_KEY||'');
const campaignOf=state=>String(state?.walking?.campaignId||'legacy');
const stateOf=save=>{try{return (typeof save==='string'?JSON.parse(save):save)?.state||null;}catch(_){return null;}};
function jobKey(userId,state,job){
 const key='job:'+userId+':'+encodeURIComponent(campaignOf(state))+':'+job.kind+':'+encodeURIComponent(job.id)+':'+job.targetLevel;
 if(job.facilityId)return key+':facility:'+encodeURIComponent(job.facilityId);
 return job.repair?key+':'+job.due:key;
}
function levelOf(state,kind,id,facilityId){
 if(kind==='branch'){
  const branch=state.branches?.find(b=>b.id===id&&!b.fallen);
  return Number((facilityId?branch?.facilities?.[facilityId]:branch?.level)||0);
 }
 if(kind==='building')return Number(state.buildings?.[id]||0);
 if(kind==='research')return Number(state.tech?.[id]||0);
 return state.castles?.[id]?.owner===state.clan?Number(state.castles[id].level||0):0;
}
export function notificationQuiet(p,now){const h=new Date(now+9*3600000).getUTCHours(),a=p.quiet_start,b=p.quiet_end;return a!==b&&(a<b?h>=a&&h<b:h>=a||h<b);}
function preferenceGate(userId,updatedAt,now,categories){
 const hour=new Date(now+9*3600000).getUTCHours();
 return{sql:`EXISTS(SELECT 1 FROM notification_preferences p WHERE p.user_id=? AND p.enabled=1 AND p.updated_at=? AND ${categories.map(k=>'p.'+k+'=1').join(' AND ')||'1=1'} AND (p.quiet_start=p.quiet_end OR (p.quiet_start<p.quiet_end AND (?<p.quiet_start OR ?>=p.quiet_end)) OR (p.quiet_start>p.quiet_end AND ?<p.quiet_start AND ?>=p.quiet_end))) AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=? AND b.active=1)`,args:[userId,updatedAt,hour,hour,hour,hour,userId]};
}
export function notificationStatements(db,userId,category,id,title,body,dueAt,now,gate='1=1',args=[],sourceScope='',destination='recap'){
 if(!types.includes(category))throw Error('Invalid notification category');
 return[stmt(db,`INSERT INTO notification_outbox(id,user_id,category,title,body,due_at,created_at,source_scope,destination) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate} AND EXISTS(SELECT 1 FROM notification_preferences WHERE user_id=? AND enabled=1 AND ${category}=1) ON CONFLICT(id) DO NOTHING`,id,userId,category,title.slice(0,80),body.slice(0,200),dueAt,now,sourceScope,destination,...args,userId)];
}
// Permission and membership are read again immediately before delivery. A
// leave/rejoin or dismissal/reappointment cannot reuse a previous room's notice.
const activeAuthor=alias=>`NOT EXISTS(SELECT 1 FROM player_bans banned WHERE banned.user_id=${alias} AND banned.active=1)`;
const chatAudience=recipient=>`m.user_id<>${recipient} AND ${activeAuthor('m.user_id')} AND (
 (m.channel='world' AND m.room_key='world') OR
 (m.channel='guild' AND EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=${recipient} AND 'guild:'||gm.guild_id=m.room_key AND gm.joined_at<=m.created_at)) OR
 (m.channel='friend' AND EXISTS(SELECT 1 FROM friendships f WHERE (f.user_a=${recipient} OR f.user_b=${recipient}) AND f.status='accepted' AND 'friend:'||f.user_a||':'||f.user_b=m.room_key AND f.updated_at<=m.created_at)) OR
 (m.channel='admin' AND m.room_key='admin' AND (${recipient}=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') OR EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=${recipient} AND sm.appointed_at<=m.created_at) OR EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=${recipient} AND ds.appointed_at<=m.created_at))))`;
const chatScope=recipient=>`CASE m.channel
 WHEN 'guild' THEN COALESCE((SELECT gm.guild_id||':'||gm.joined_at FROM guild_members gm WHERE gm.user_id=${recipient}),'')
 WHEN 'friend' THEN COALESCE((SELECT f.created_at||':'||f.updated_at FROM friendships f WHERE (f.user_a=${recipient} OR f.user_b=${recipient}) AND 'friend:'||f.user_a||':'||f.user_b=m.room_key),'')
 WHEN 'admin' THEN CASE WHEN ${recipient}=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') THEN 'owner:'||COALESCE((SELECT updated_at FROM settings WHERE key='adminUserId'),0)
 ELSE COALESCE((SELECT 'staff:'||COALESCE(sm.term_id,'legacy:'||sm.appointed_at) FROM staff_members sm WHERE sm.user_id=${recipient}),(SELECT 'deputy:'||ds.term_id FROM deputy_operator_state ds WHERE ds.user_id=${recipient}),'') END ELSE 'world' END`;
const unreadChat=recipient=>`NOT EXISTS(SELECT 1 FROM notification_chat_reads nr WHERE nr.user_id=${recipient} AND nr.room_key=m.room_key AND nr.last_message_id>=m.id)`;
export async function recordNotificationChatRead(db,userId,room,lastMessageId,now,guard){
 if(!Number.isSafeInteger(lastMessageId)||lastMessageId<=0)return;
 await stmt(db,`INSERT INTO notification_chat_reads(user_id,room_key,last_message_id,updated_at)
 SELECT ?,?,MAX(m.id),? FROM messages m WHERE m.room_key=? AND m.id<=? AND ${guard.sql} HAVING MAX(m.id) IS NOT NULL
 ON CONFLICT(user_id,room_key) DO UPDATE SET last_message_id=MAX(notification_chat_reads.last_message_id,excluded.last_message_id),updated_at=excluded.updated_at`,userId,room,now,room,lastMessageId,...guard.args).run();
}
export function notificationAnnouncementStatements(db,userId,now,gate='1=1',args=[]){
 return[stmt(db,`INSERT INTO notification_announcements(id,sender_id,created_at) SELECT ?,?,? WHERE ${gate} AND EXISTS(SELECT 1 FROM settings WHERE key='announcement' AND updated_at=? AND length(trim(value))>0) ON CONFLICT(id) DO UPDATE SET sender_id=excluded.sender_id`,'na_'+now,userId,now,...args,now)];
}
async function notificationCourtAccess(db,userId,now,resolve){
 if(typeof resolve!=='function')return null;
 const access=await resolve(userId,now);if(!access?.guard||!access.accessStamp)return null;
 const proof=Number(access.notificationSince),since=Number.isFinite(proof)&&proof>=0?Math.min(now,proof):now;
 // Admission is remembered independently of save revisions. Ordinary autosaves
 // must not turn a currently eligible visitor's new messages into old history.
 await stmt(db,`INSERT INTO notification_court_access(user_id,access_stamp,eligible,since,updated_at)
 SELECT ?,?,?,?,? WHERE ${access.guard.sql}
 ON CONFLICT(user_id) DO UPDATE SET access_stamp=excluded.access_stamp,eligible=excluded.eligible,
 since=CASE WHEN notification_court_access.eligible=1 AND excluded.eligible=1 AND notification_court_access.access_stamp=excluded.access_stamp THEN notification_court_access.since ELSE MAX(notification_court_access.updated_at,excluded.since) END,
 updated_at=MAX(notification_court_access.updated_at,excluded.updated_at)`,userId,access.accessStamp,access.eligible?1:0,since,now,...access.guard.args).run();
 const checkpoint=await stmt(db,'SELECT since FROM notification_court_access WHERE user_id=? AND access_stamp=? AND eligible=?',userId,access.accessStamp,access.eligible?1:0).first();
 return checkpoint?{...access,notificationSince:Number(checkpoint.since)}:null;
}
export async function recordNotificationCourtRead(db,userId,kind,threadId,lastSeq,now,guard,privileged=false){
 if(!Number.isSafeInteger(lastSeq)||lastSeq<=0)return;
 const table=kind==='chat'?'court_chat':kind==='audience'?'court_audience_messages':null;if(!table)throw Error('Unknown court notification source');
 const room=kind==='chat'?'court:chat':'court:audience:'+threadId;
 const scope=kind==='chat'?{sql:'1=1',args:[]}:{sql:`m.thread_id=? AND EXISTS(SELECT 1 FROM court_audience_threads t WHERE t.id=m.thread_id AND (?=1 OR t.requester_id=?) AND ${activeAuthor('t.requester_id')})`,args:[threadId,privileged?1:0,userId]};
 await stmt(db,`INSERT INTO notification_chat_reads(user_id,room_key,last_message_id,updated_at)
 SELECT ?,?,MAX(m.seq),? FROM ${table} m WHERE m.seq<=? AND ${scope.sql} AND ${activeAuthor('m.author_id')} AND ${guard.sql} HAVING MAX(m.seq) IS NOT NULL
 ON CONFLICT(user_id,room_key) DO UPDATE SET last_message_id=MAX(notification_chat_reads.last_message_id,excluded.last_message_id),updated_at=excluded.updated_at`,userId,room,now,lastSeq,...scope.args,...guard.args).run();
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
// Store a full queue in one statement so long, valid branch queues do not
// require a separate D1 query for every forecast or completed facility.
function jobStatement(db,userId,state,jobs,now,clock,gate='1=1',args=[],completed=false){
 const notices=jobs.map(job=>{
  const due=completed?null:job.due,delay=completed?0:clock?.running?Math.max(0,due-clock.elapsedMs)/Math.max(.1,clock.speed):86400000;
  return {id:jobKey(userId,state,job),title:job.kind==='research'?'研究が完成しました':'普請が完成しました',dueAt:Math.round(now+delay),worldDue:due};
 });
 return stmt(db,`INSERT INTO notification_outbox(id,user_id,category,title,body,due_at,world_due_elapsed,created_at)
   SELECT json_extract(n.value,'$.id'),?,'construction',json_extract(n.value,'$.title'),?,json_extract(n.value,'$.dueAt'),json_extract(n.value,'$.worldDue'),?
   FROM json_each(?) n WHERE ${gate} AND EXISTS(SELECT 1 FROM notification_preferences WHERE user_id=? AND enabled=1 AND construction=1)
   ON CONFLICT(id) DO UPDATE SET due_at=excluded.due_at,world_due_elapsed=excluded.world_due_elapsed WHERE notification_outbox.delivered_at IS NULL AND notification_outbox.leased_until<=?`,
   userId,'城下町と成長手帳で次の目標を確認できます。',now,JSON.stringify(notices),...args,userId,now);
}
// Include these statements in the successful save transaction, using the same
// commit-token predicate as the save. This catches even work completed between ticks.
export function notificationSaveStatements(db,userId,beforeSave,afterSave,now,gate='1=1',gateArgs=[]){
 const before=stateOf(beforeSave),after=stateOf(afterSave);if(!before||!after||campaignOf(before)!==campaignOf(after))return[];
 const statements=[],oldJobs=pendingJobs(before);
 for(const kind of ['building','research','castle','branch']){
  const ids=kind==='building'?Object.keys(after.buildings||{}):kind==='research'?Object.keys(after.tech||{}):kind==='castle'?Object.keys(after.castles||{}):(after.branches||[]).map(b=>b.id);
  for(const id of ids){const old=levelOf(before,kind,id),next=levelOf(after,kind,id),repair=kind==='branch'&&before.branches?.find(b=>b.id===id)?.fallen&&next>0;if(next<=old||kind==='castle'&&before.castles?.[id]?.owner!==before.clan)continue;
   for(let targetLevel=repair?next:old+1;targetLevel<=Math.min(next,old+64);targetLevel++){const job=oldJobs.find(j=>!j.facilityId&&j.kind===kind&&j.id===id&&j.targetLevel===targetLevel)||{kind,id,targetLevel};statements.push(jobStatement(db,userId,after,[job],now,null,gate,gateArgs,true));}
  }
 }
 const facilities=[];
 for(const branch of after.branches||[]){
  if(branch.fallen)continue;
  const previous=before.branches?.find(b=>b.id===branch.id);
  for(const [facilityId,level] of Object.entries(branch.facilities||{})){
   // Repairs resume effects from existing levels without completing them again.
   for(let targetLevel=Number(previous?.facilities?.[facilityId]||0)+1;targetLevel<=level;targetLevel++)
    facilities.push({kind:'branch',id:branch.id,facilityId,targetLevel});
  }
 }
 if(facilities.length)statements.push(jobStatement(db,userId,after,facilities,now,null,gate,gateArgs,true));
 return statements;
}
function parseJob(userId,id){
 const prefix='job:'+userId+':';if(!id.startsWith(prefix))return null;
 try{
  const [campaign,kind,target,level,suffix,facility]=id.slice(prefix.length).split(':');
  if(!['building','research','castle','branch'].includes(kind)||!/^\d+$/.test(level))return null;
  const job={campaign:decodeURIComponent(campaign),kind,id:decodeURIComponent(target),targetLevel:Number(level)};
  if(suffix==='facility')return kind==='branch'&&facility?{...job,facilityId:decodeURIComponent(facility)}:null;
  return {...job,repair:suffix!==undefined,due:Number(suffix)};
 }catch(_){return null;}
}
async function queueCourtFacts(db,userId,preferences,now,resolve){
 if(!preferences.chat||typeof resolve!=='function')return{statements:[],access:null};
 const lower=Math.max(Number(preferences.since||0),Number(preferences.chat_since||now),now-86400000),reader=`NOT EXISTS(SELECT 1 FROM notification_chat_reads nr WHERE nr.user_id=? AND nr.room_key='court:chat' AND nr.last_message_id>=m.seq)`;
 const possibleOfficial=`(?=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') OR EXISTS(SELECT 1 FROM staff_members WHERE user_id=?) OR EXISTS(SELECT 1 FROM court_regent WHERE user_id=?))`;
 // Avoid projecting a complete game/save for subscribers with no court work.
 const pending=await stmt(db,`SELECT 1 AS needed WHERE
 EXISTS(SELECT 1 FROM notification_outbox WHERE user_id=? AND delivered_at IS NULL AND (id LIKE ? OR id LIKE ?)) OR
 EXISTS(SELECT 1 FROM court_chat m WHERE m.author_id<>? AND m.created_at>=? AND m.created_at>=COALESCE((SELECT CASE WHEN eligible=1 THEN since ELSE updated_at END FROM notification_court_access WHERE user_id=?),0) AND ${reader} AND NOT EXISTS(SELECT 1 FROM notification_outbox WHERE id='court-chat:'||?||':'||m.id)) OR
 EXISTS(SELECT 1 FROM court_audience_messages m JOIN court_audience_threads t ON t.id=m.thread_id WHERE m.author_id<>? AND m.created_at>=? AND (t.requester_id=? OR ${possibleOfficial}) AND NOT EXISTS(SELECT 1 FROM notification_chat_reads nr WHERE nr.user_id=? AND nr.room_key='court:audience:'||t.id AND nr.last_message_id>=m.seq) AND NOT EXISTS(SELECT 1 FROM notification_outbox WHERE id='court-audience:'||?||':'||m.id))`,userId,'court-chat:%','court-audience:%',userId,lower,userId,userId,userId,userId,lower,userId,userId,userId,userId,userId,userId).first();
 if(!pending)return{statements:[],access:null};
 const access=await notificationCourtAccess(db,userId,now,resolve),statements=[];
 if(!access?.eligible)return{statements,access};
 const cutoff=Math.max(lower,access.notificationSince),guard=`${access.guard.sql} AND EXISTS(SELECT 1 FROM notification_preferences np WHERE np.user_id=? AND np.updated_at=? AND np.enabled=1 AND np.chat=1)`,guardArgs=[...access.guard.args,userId,preferences.updated_at];
 const chat=rows(await stmt(db,`SELECT m.id,m.created_at FROM court_chat m WHERE m.author_id<>? AND m.created_at>=? AND ${activeAuthor('m.author_id')} AND ${reader} AND NOT EXISTS(SELECT 1 FROM notification_outbox WHERE id='court-chat:'||?||':'||m.id) AND ${guard} ORDER BY m.seq LIMIT 20`,userId,cutoff,userId,userId,...guardArgs).all());
 for(const m of chat)statements.push(...notificationStatements(db,userId,'chat','court-chat:'+userId+':'+m.id,'朝廷の会話に新着があります','朝廷の会話で確認できます。',m.created_at,now,guard,guardArgs,access.accessStamp,'courtChat'));
 const audience=rows(await stmt(db,`SELECT m.id,m.created_at FROM court_audience_messages m JOIN court_audience_threads t ON t.id=m.thread_id WHERE m.author_id<>? AND m.created_at>=? AND (?=1 OR t.requester_id=?) AND ${activeAuthor('m.author_id')} AND ${activeAuthor('t.requester_id')} AND NOT EXISTS(SELECT 1 FROM notification_chat_reads nr WHERE nr.user_id=? AND nr.room_key='court:audience:'||t.id AND nr.last_message_id>=m.seq) AND NOT EXISTS(SELECT 1 FROM notification_outbox WHERE id='court-audience:'||?||':'||m.id) AND ${guard} ORDER BY m.seq LIMIT 20`,userId,cutoff,access.privileged?1:0,userId,userId,userId,...guardArgs).all());
 for(const m of audience)statements.push(...notificationStatements(db,userId,'chat','court-audience:'+userId+':'+m.id,'謁見の書状に新着があります','朝廷の謁見一覧で確認できます。',m.created_at,now,guard,guardArgs,access.accessStamp,'courtAudiences'));
 return{statements,access};
}
async function queueFacts(db,userId,since,now,clock,preferences={},messageOnly=false,courtResolver=null){
 const statements=[],messageGuard='EXISTS(SELECT 1 FROM notification_preferences np WHERE np.user_id=? AND np.updated_at=?)',messageArgs=[userId,preferences.updated_at];
 const mail=rows(await stmt(db,"SELECT id,title,created_at FROM mail_campaigns m WHERE (target_user_id=? OR target_user_id IS NULL) AND (sender_id<>? OR request_id LIKE 'system:%') AND created_at>=? AND NOT EXISTS(SELECT 1 FROM mail_reads r WHERE r.mail_id=m.id AND r.user_id=?) AND NOT EXISTS(SELECT 1 FROM notification_outbox n WHERE n.id='mail:'||?||':'||m.id) ORDER BY created_at,id LIMIT 20",userId,userId,since,userId,userId).all());
 for(const m of mail){const category=/戦闘|襲撃|戦勝|防衛|敗北|勝利|落城/.test(m.title)?'battle':'letter';statements.push(...notificationStatements(db,userId,category,'mail:'+userId+':'+m.id,category==='battle'?'本拠に合戦の報告が届きました':'新しいシステム便が届きました','ゲーム内の郵便で詳細を確認できます。',m.created_at,now,messageGuard,messageArgs,'','mail'));}
 const letters=rows(await stmt(db,`SELECT m.id,m.created_at FROM base_letter_messages m JOIN base_letter_threads t ON t.id=m.thread_id WHERE m.sender_id<>? AND m.created_at>=? AND ((t.kind='player' AND (t.user_a=? OR t.user_b=?)) OR (t.kind='guild' AND (t.sender_id=? OR EXISTS(SELECT 1 FROM guild_members WHERE user_id=? AND guild_id=t.guild_id)))) AND NOT EXISTS(SELECT 1 FROM base_letter_reads r WHERE r.thread_id=t.id AND r.user_id=? AND r.last_seq>=m.seq) ORDER BY m.created_at DESC LIMIT 20`,userId,since,userId,userId,userId,userId,userId).all());
 for(const m of letters)statements.push(...notificationStatements(db,userId,'letter','letter:'+userId+':'+m.id,'新しい書状が届きました','領主の書状から内容を確認できます。',m.created_at,now,messageGuard,messageArgs,'','letters'));
 // Each newly enabled message category starts from its own consent time. Saving
 // quiet hours does not replay history or move that category's starting point.
 const messageSince=Math.max(Number(preferences.since||0),now-86400000);
 if(preferences.chat||preferences.worldChat){
  const chat=rows(await stmt(db,`SELECT m.id,m.channel,m.created_at,${chatScope('recipient.id')} AS source_scope FROM messages m JOIN users recipient ON recipient.id=?
   WHERE m.created_at>=? AND ((m.channel='world' AND ?=1 AND m.created_at>=?) OR (m.channel<>'world' AND ?=1 AND m.created_at>=?))
   AND ${chatAudience('recipient.id')} AND ${unreadChat('recipient.id')}
   AND NOT EXISTS(SELECT 1 FROM notification_outbox n WHERE n.id='chat:'||recipient.id||':'||m.id) ORDER BY m.id LIMIT 30`,userId,messageSince,preferences.worldChat?1:0,Number(preferences.worldChat_since||now),preferences.chat?1:0,Number(preferences.chat_since||now)).all());
  for(const m of chat)statements.push(...notificationStatements(db,userId,m.channel==='world'?'worldChat':'chat','chat:'+userId+':'+m.id,m.channel==='world'?'世界チャットに新着があります':'新しいチャットが届きました','ゲーム内の交流で確認できます。',m.created_at,now,messageGuard,messageArgs,m.source_scope,{world:'world',guild:'guild',friend:'friends',admin:'admin'}[m.channel]));
 }
 if(preferences.announcement){
  const announcement=await stmt(db,`SELECT a.id,a.created_at FROM notification_announcements a JOIN settings s ON s.key='announcement' AND s.updated_at=a.created_at WHERE a.sender_id<>? AND a.created_at>=? AND length(trim(s.value))>0 AND NOT EXISTS(SELECT 1 FROM notification_outbox n WHERE n.id='announcement:'||?||':'||a.id) ORDER BY a.created_at DESC LIMIT 1`,userId,Math.max(messageSince,Number(preferences.announcement_since||now)),userId).first();
  if(announcement)statements.push(...notificationStatements(db,userId,'announcement','announcement:'+userId+':'+announcement.id,'新しい御触書が届きました','ゲーム内のお知らせで確認できます。',announcement.created_at,now,messageGuard,messageArgs,'','news'));
 }
 const court=await queueCourtFacts(db,userId,preferences,now,courtResolver);statements.push(...court.statements);
 if(messageOnly){if(statements.length)await db.batch(statements);return{saveRevision:null,courtAccess:court.access};}
 const events=rows(await stmt(db,"SELECT id,starts_at,ends_at FROM timed_events WHERE status='active' AND ends_at>? AND (starts_at>=? OR ends_at<=?)",now,since,now+3600000).all());
 for(const e of events){if(e.starts_at>=since)statements.push(...notificationStatements(db,userId,'event','event:start:'+userId+':'+e.id,'期間限定合戦が始まりました','期間限定合戦から戦場と報酬を確認できます。',e.starts_at,now));statements.push(...notificationStatements(db,userId,'event','event:end:'+userId+':'+e.id,'期間限定合戦がまもなく終了します','残りの戦功目標を確認しましょう。',e.ends_at-3600000,now));}
 const saveRow=await stmt(db,'SELECT save_json,revision FROM player_saves WHERE user_id=?',userId).first(),state=stateOf(saveRow?.save_json),jobs=state?pendingJobs(state):[];
 if(jobs.length&&clock&&!state.gameOver)statements.push(jobStatement(db,userId,state,jobs,now,clock,'EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?)',[userId,saveRow.revision]));
 // A cancelled construction, a lost castle or a new campaign must not leave a
 // stale forecast behind. Completed levels survive removal from state.jobs.
 const queued=rows(await stmt(db,"SELECT id,world_due_elapsed FROM notification_outbox WHERE user_id=? AND category='construction' AND delivered_at IS NULL",userId).all());
 const forecastIds=new Set(jobs.map(job=>jobKey(userId,state,job))),stale=[];
 // Older clients stored a facility forecast using the branch-body key. Its
 // original due time identifies it without discarding a genuine body completion.
 const oldFacilityForecasts=new Set(jobs.filter(j=>j.facilityId).map(j=>jobKey(userId,state,{...j,facilityId:null})+'@'+j.due));
 for(const item of queued){
  const job=parseJob(userId,item.id);
  if(!forecastIds.has(item.id)&&oldFacilityForecasts.has(item.id+'@'+item.world_due_elapsed)||
   job&&(!state||job.campaign!==campaignOf(state)||levelOf(state,job.kind,job.id,job.facilityId)<job.targetLevel&&!forecastIds.has(item.id)))stale.push(item.id);
 }
 if(stale.length)statements.push(stmt(db,'DELETE FROM notification_outbox WHERE id IN (SELECT value FROM json_each(?)) AND delivered_at IS NULL AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?)',JSON.stringify(stale),userId,saveRow?.revision??null));
 statements.push(stmt(db,`DELETE FROM notification_outbox WHERE user_id=? AND category='operation' AND delivered_at IS NULL AND id LIKE ? AND NOT EXISTS(SELECT 1 FROM alliance_operations o JOIN guild_members m ON m.guild_id=o.guild_id AND m.user_id=? WHERE ('operation:'||?||':'||o.id)=notification_outbox.id AND o.status='planned' AND o.expires_at>? AND o.starts_at>?)`,userId,'operation:'+userId+':%',userId,userId,now,now-900000));
 const operations=rows(await stmt(db,`SELECT o.id,o.starts_at FROM alliance_operations o JOIN guild_members m ON m.guild_id=o.guild_id AND m.user_id=? WHERE o.status='planned' AND o.starts_at>? AND o.starts_at<?`,userId,now-900000,now+3600000).all());
 for(const o of operations){const id='operation:'+userId+':'+o.id;statements.push(...notificationStatements(db,userId,'operation',id,'同盟の作戦時刻が近づいています','同盟作戦で集合時刻と担当を確認できます。',o.starts_at-300000,now));statements.push(stmt(db,'UPDATE notification_outbox SET due_at=? WHERE id=? AND delivered_at IS NULL',o.starts_at-300000,id));}
 if(statements.length)await db.batch(statements);
 return{saveRevision:saveRow?.revision??null,courtAccess:court.access};
}
function sourceGate(userId,message,now,snapshot){
 const prefix=kind=>kind+':'+userId+':',id=message.id;
 if(id.startsWith(prefix('court-chat'))||id.startsWith(prefix('court-audience'))){
  const access=snapshot.courtAccess;
  if(!access)return{sql:'0',args:[],deferred:true,court:true};
  if(!access.eligible||access.accessStamp!==message.source_scope)return{sql:'0',args:[],court:true};
  if(id.startsWith(prefix('court-chat')))return{sql:`EXISTS(SELECT 1 FROM court_chat m WHERE m.id=? AND m.author_id<>? AND m.created_at>=? AND ${activeAuthor('m.author_id')} AND NOT EXISTS(SELECT 1 FROM notification_chat_reads nr WHERE nr.user_id=? AND nr.room_key='court:chat' AND nr.last_message_id>=m.seq))`,args:[id.slice(prefix('court-chat').length),userId,access.notificationSince,userId],court:true};
  return{sql:`EXISTS(SELECT 1 FROM court_audience_messages m JOIN court_audience_threads t ON t.id=m.thread_id WHERE m.id=? AND m.author_id<>? AND m.created_at>=? AND (?=1 OR t.requester_id=?) AND ${activeAuthor('m.author_id')} AND ${activeAuthor('t.requester_id')} AND NOT EXISTS(SELECT 1 FROM notification_chat_reads nr WHERE nr.user_id=? AND nr.room_key='court:audience:'||t.id AND nr.last_message_id>=m.seq))`,args:[id.slice(prefix('court-audience').length),userId,access.notificationSince,access.privileged?1:0,userId,userId],court:true};
 }
 if(id.startsWith(prefix('mail')))return{sql:"EXISTS(SELECT 1 FROM mail_campaigns m WHERE m.id=? AND (m.target_user_id=? OR m.target_user_id IS NULL) AND (m.sender_id<>? OR m.request_id LIKE 'system:%') AND NOT EXISTS(SELECT 1 FROM mail_reads r WHERE r.mail_id=m.id AND r.user_id=?))",args:[id.slice(prefix('mail').length),userId,userId,userId]};
 if(id.startsWith(prefix('chat')))return{sql:`EXISTS(SELECT 1 FROM messages m JOIN users recipient ON recipient.id=? WHERE m.id=? AND ${chatAudience('recipient.id')} AND ${unreadChat('recipient.id')} AND ${chatScope('recipient.id')}=?)`,args:[userId,Number(id.slice(prefix('chat').length)),message.source_scope]};
 if(id.startsWith(prefix('announcement')))return{sql:`EXISTS(SELECT 1 FROM notification_announcements a JOIN settings s ON s.key='announcement' AND s.updated_at=a.created_at WHERE a.id=? AND a.sender_id<>? AND length(trim(s.value))>0)`,args:[id.slice(prefix('announcement').length),userId]};
 if(id.startsWith(prefix('letter')))return{sql:`EXISTS(SELECT 1 FROM base_letter_messages m JOIN base_letter_threads t ON t.id=m.thread_id WHERE m.id=? AND m.sender_id<>? AND ((t.kind='player' AND (t.user_a=? OR t.user_b=?)) OR (t.kind='guild' AND (t.sender_id=? OR EXISTS(SELECT 1 FROM guild_members WHERE user_id=? AND guild_id=t.guild_id)))) AND NOT EXISTS(SELECT 1 FROM base_letter_reads r WHERE r.thread_id=t.id AND r.user_id=? AND r.last_seq>=m.seq))`,args:[id.slice(prefix('letter').length),userId,userId,userId,userId,userId,userId]};
 if(id.startsWith(prefix('operation')))return{sql:`EXISTS(SELECT 1 FROM alliance_operations o JOIN guild_members m ON m.guild_id=o.guild_id AND m.user_id=? WHERE o.id=? AND o.status='planned' AND o.starts_at<=? AND o.starts_at>? AND o.expires_at>?)`,args:[userId,id.slice(prefix('operation').length),now+300000,now-900000,now]};
 for(const phase of ['start','end']){const eventPrefix='event:'+phase+':'+userId+':';if(id.startsWith(eventPrefix))return{sql:`EXISTS(SELECT 1 FROM timed_events e WHERE e.id=? AND e.status='active' AND e.starts_at<=? AND e.ends_at>? ${phase==='end'?'AND e.ends_at<=?':''})`,args:[id.slice(eventPrefix.length),now,now,...(phase==='end'?[now+3600000]:[])]};}
 const job=parseJob(userId,id);
 if(job){
  const field=job.kind==='building'?'buildings':job.kind==='research'?'tech':'castles';
  const path='$.state.'+field+'.'+JSON.stringify(job.id)+(job.kind==='castle'?'.level':'');
  const branchLevel=job.facilityId?'$.facilities.'+JSON.stringify(job.facilityId):'$.level';
  const branchJob=job.kind!=='branch'?'':job.facilityId?" AND json_extract(j.value,'$.facilityId')=?":" AND json_extract(j.value,'$.facilityId') IS NULL";
  const level=job.kind==='branch'?`EXISTS(SELECT 1 FROM json_each(s.save_json,'$.state.branches') b WHERE json_extract(b.value,'$.id')=? AND json_extract(b.value,?)>=? AND COALESCE(json_extract(b.value,'$.fallen'),0)=0)`:`COALESCE(json_extract(s.save_json,?),0)>=?`;
  const ownership=job.kind==='castle'?` AND json_extract(s.save_json,?)=json_extract(s.save_json,'$.state.clan')`:'';
  return{sql:`EXISTS(SELECT 1 FROM player_saves s WHERE s.user_id=? AND s.revision=? AND COALESCE(json_extract(s.save_json,'$.state.walking.campaignId'),'legacy')=? ${ownership} AND (${level} OR (COALESCE(json_extract(s.save_json,'$.state.gameOver'),0)=0 AND EXISTS(SELECT 1 FROM json_each(s.save_json,'$.state.jobs') j WHERE json_extract(j.value,'$.kind')=? AND json_extract(j.value,'$.id')=? AND json_extract(j.value,'$.targetLevel')=?${branchJob}))))`,args:[userId,snapshot.saveRevision,job.campaign,...(job.kind==='castle'?['$.state.castles.'+JSON.stringify(job.id)+'.owner']:[]),...(job.kind==='branch'?[job.id,branchLevel]:[path]),job.targetLevel,job.kind,job.id,job.targetLevel,...(job.facilityId?[job.facilityId]:[])]};
 }
 return{sql:'1=1',args:[]};
}
function deliveryPayload(messages){
 const destinations=[...new Set(messages.map(m=>m.destination||'recap'))];
 return{title:messages.length===1?messages[0].title:'戦国VS：'+messages.length+'件のお知らせ',body:messages.length===1?messages[0].body:[...new Set(messages.map(m=>m.title))].slice(0,3).join(' ／ '),tag:'sengoku-update',url:'/?notice=1',destination:destinations.length===1?destinations[0]:'recap'};
}
async function deliverUser(env,p,clock,now,{messageOnly=false,courtAccess=null}={}){
 const db=env.DB,snapshot=await queueFacts(db,p.user_id,Math.max(p.since,Math.min(p.updated_at,now),now-86400000),now,clock,p,messageOnly,courtAccess);
 if(notificationQuiet(p,now))return{sent:0,failed:0};
 const categories=types.filter(k=>p[k]&&(!messageOnly||['battle','letter',...messageTypes].includes(k)));if(!categories.length)return{sent:0,failed:0};
 const subscriptions=rows(await stmt(db,'SELECT * FROM notification_subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 5',p.user_id).all());
 if(!subscriptions.length||!subscriptions.some(s=>s.last_sent_at<=now-p.digest_minutes*60000))return{sent:0,failed:0};
 const token=crypto.randomUUID(),gate=preferenceGate(p.user_id,p.updated_at,now,categories);
 // Claims cover the messages; per-device receipts preserve retries when another
 // device succeeds first or has a different digest timer.
 const claimed=rows(await stmt(db,`UPDATE notification_outbox SET lease_token=?,leased_until=? WHERE id IN(SELECT id FROM notification_outbox WHERE user_id=? AND delivered_at IS NULL AND due_at<=? AND leased_until<=? AND category IN(${categories.map(()=>'?').join(',')}) AND (world_due_elapsed IS NULL OR world_due_elapsed<=?) ORDER BY due_at,id LIMIT 8) AND ${gate.sql} RETURNING *`,token,now+120000,p.user_id,now,now,...categories,clock?.elapsedMs||0,...gate.args).all());
 const messages=[];
 for(const message of claimed){
  const source=sourceGate(p.user_id,message,now,snapshot),courtGuard=source.court&&snapshot.courtAccess?.guard;
  const check=courtGuard?await stmt(db,`SELECT (${source.sql}) AS source_ok,(${courtGuard.sql}) AS access_ok`,...source.args,...courtGuard.args).first():null;
  const deferred=source.deferred||courtGuard&&!check?.access_ok;
  const valid=courtGuard?!!check?.source_ok&&!!check?.access_ok:await stmt(db,'SELECT 1 AS ok WHERE '+source.sql,...source.args).first();
  if(valid)messages.push(message);
  else if(deferred||['construction','operation'].includes(message.category))await stmt(db,"UPDATE notification_outbox SET lease_token='',leased_until=? WHERE id=? AND lease_token=?",now+300000,message.id,token).run();
  else await stmt(db,"UPDATE notification_outbox SET delivered_at=?,lease_token='',leased_until=0 WHERE id=? AND lease_token=?",now,message.id,token).run();
 }
 if(!messages.length)return{sent:0,failed:0};
 const receipts=rows(await stmt(db,'SELECT outbox_id,subscription_id FROM notification_delivery_receipts WHERE outbox_id IN (SELECT value FROM json_each(?))',JSON.stringify(messages.map(m=>m.id))).all()),received=new Set(receipts.map(r=>r.subscription_id+'|'+r.outbox_id));
 let refreshedCourtAccess=null;
 const result=await Promise.all(subscriptions.map(async sub=>{
  let pending=messages.filter(m=>sub.created_at<=m.created_at&&!received.has(sub.id+'|'+m.id));
  if(!pending.length||sub.last_sent_at>now-p.digest_minutes*60000)return{sent:0,failed:0};
  // Worst-case mixes of facility completion guards and court admission guards
  // must stay below D1's 100 bound parameters. Unsent rows retain their leases.
  if(pending.some(m=>m.id.startsWith('court-')))pending=pending.slice(0,6);
  try{
   const r=await sendWebPush(sub,deliveryPayload(pending),env,now,async()=>{
    const commitNow=Date.now(),current=preferenceGate(p.user_id,p.updated_at,commitNow,[...new Set(pending.map(m=>m.category))]);
    const hasCourt=pending.some(m=>m.id.startsWith('court-'));
    if(hasCourt&&!refreshedCourtAccess)refreshedCourtAccess=notificationCourtAccess(db,p.user_id,commitNow,courtAccess);
    const deliverySnapshot=hasCourt?{...snapshot,courtAccess:await refreshedCourtAccess}:snapshot;
    if(hasCourt&&!deliverySnapshot.courtAccess?.eligible)return false;
    const currentSources=pending.map(m=>sourceGate(p.user_id,m,commitNow,deliverySnapshot));
    // The shared admission guard appears once, rather than once per message.
    if(hasCourt)currentSources.push(deliverySnapshot.courtAccess.guard);
    if(pending.some(m=>m.category==='construction')&&Number.isSafeInteger(clock?.revision))currentSources.push({sql:'EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)',args:[clock.id||'world-v1',clock.revision]});
    const result=await stmt(db,`UPDATE notification_subscriptions SET last_sent_at=? WHERE id=? AND user_id=? AND revision=? AND last_sent_at=? AND ${current.sql} AND ${currentSources.map(s=>'('+s.sql+')').join(' AND ')} AND (SELECT COUNT(*) FROM notification_outbox WHERE lease_token=? AND leased_until>? AND delivered_at IS NULL AND id IN (SELECT value FROM json_each(?)))=? RETURNING id`,commitNow,sub.id,p.user_id,sub.revision,sub.last_sent_at,...current.args,...currentSources.flatMap(s=>s.args),token,commitNow,JSON.stringify(pending.map(m=>m.id)),pending.length).all();return rows(result).length===1;
   });
   if(r.cancelled)return{sent:0,failed:0};
   if(r.ok){
    await db.batch([
     stmt(db,'INSERT INTO notification_delivery_receipts(outbox_id,subscription_id,delivered_at) SELECT n.id,s.id,? FROM notification_outbox n JOIN notification_subscriptions s ON s.id=? AND s.user_id=n.user_id WHERE n.lease_token=? AND n.id IN (SELECT value FROM json_each(?)) ON CONFLICT(outbox_id,subscription_id) DO NOTHING',Date.now(),sub.id,token,JSON.stringify(pending.map(m=>m.id))),
     stmt(db,'UPDATE notification_subscriptions SET failure_count=0 WHERE id=? AND revision=?',sub.id,sub.revision)
    ]);return{sent:1,failed:0};
   }
   if(r.status===404||r.status===410){await stmt(db,'DELETE FROM notification_subscriptions WHERE id=? AND revision=?',sub.id,sub.revision).run();return{sent:0,failed:0};}
   await stmt(db,'UPDATE notification_subscriptions SET failure_count=failure_count+1 WHERE id=? AND revision=?',sub.id,sub.revision).run();return{sent:0,failed:1};
  }catch(_){await stmt(db,'UPDATE notification_subscriptions SET failure_count=failure_count+1,last_sent_at=? WHERE id=? AND revision=?',Date.now(),sub.id,sub.revision).run();return{sent:0,failed:1};}
 }));
 const sent=result.reduce((n,r)=>n+r.sent,0),failed=result.reduce((n,r)=>n+r.failed,0),finishedAt=Date.now();
 await db.batch([
  stmt(db,`UPDATE notification_outbox SET delivered_at=?,sent_at=?,leased_until=0,lease_token='' WHERE lease_token=? AND NOT EXISTS(SELECT 1 FROM notification_subscriptions s WHERE s.user_id=notification_outbox.user_id AND s.created_at<=notification_outbox.created_at AND NOT EXISTS(SELECT 1 FROM notification_delivery_receipts r WHERE r.outbox_id=notification_outbox.id AND r.subscription_id=s.id))`,finishedAt,finishedAt,token),
  stmt(db,"UPDATE notification_outbox SET leased_until=?,sent_at=?,lease_token='' WHERE lease_token=?",finishedAt+(failed?300000:60000),finishedAt,token)
 ]);
 return{sent,failed};
}
export async function dispatchNotifications(env,clock=null,{courtAccess=null}={}){
 const db=env.DB,now=Date.now();if(!configured(env))return{ok:true,configured:false,sent:0};
 await stmt(db,'INSERT INTO notification_scheduler(id) VALUES(1) ON CONFLICT DO NOTHING').run();
 const claimed=rows(await stmt(db,'UPDATE notification_scheduler SET next_tick=? WHERE id=1 AND next_tick<=? RETURNING cursor',now+60000,now).all());if(!claimed.length)return{ok:true,sent:0,waiting:true};
 const records=rows(await stmt(db,`SELECT p.*,MIN(s.created_at) AS since FROM notification_preferences p JOIN notification_subscriptions s ON s.user_id=p.user_id WHERE p.enabled=1 AND p.user_id>? AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=p.user_id AND b.active=1) GROUP BY p.user_id ORDER BY p.user_id LIMIT 12`,claimed[0].cursor||'').all());
 // A slow provider must not use all of the Worker's 30-second background life.
 // Advance only over groups actually started; the next tick resumes the rest.
 let sent=0,failed=0,checked=0;
 if(!records.length)await stmt(db,"UPDATE notification_scheduler SET cursor='' WHERE id=1 AND next_tick=?",now+60000).run();
 for(let offset=0;offset<records.length&&Date.now()-now<18000;offset+=6){
  const selected=records.slice(offset,offset+6),complete=offset+selected.length===records.length&&records.length<12;
  await stmt(db,'UPDATE notification_scheduler SET cursor=? WHERE id=1 AND next_tick=?',complete?'':selected.at(-1).user_id,now+60000).run();
  const delivered=await Promise.allSettled(selected.map(p=>deliverUser(env,p,clock,Date.now(),{courtAccess})));checked+=selected.length;
  for(const r of delivered){if(r.status==='fulfilled'){sent+=r.value.sent;failed+=r.value.failed;}else failed++;}
 }
 await stmt(db,"DELETE FROM notification_outbox WHERE category<>'construction' AND created_at<? AND (delivered_at IS NOT NULL OR due_at<?)",now-7*86400000,now-7*86400000).run();
 return{ok:true,sent,failed,checked};
}
// A committed message can wake its own recipients immediately, independently
// of the periodic sweep's cursor/60-second throttle. The same outbox leases and
// device receipts are used by both paths, so their overlap cannot double-send.
export async function dispatchMessageNotifications(env,clock=null,{path='',actorId='',since=Date.now(),courtAccess=null}={}){
 if(!configured(env))return{ok:true,configured:false,sent:0};
 path=path.replace(/^\/api\/v1/,'');const now=Date.now(),start=Math.max(now-300000,Math.min(now,Number(since)||now));
 let source,args;
 if(path==='/chat'){
  source=`EXISTS(SELECT 1 FROM messages m WHERE m.user_id=? AND m.created_at>=? AND ((m.channel='world' AND p.worldChat=1) OR (m.channel<>'world' AND p.chat=1)) AND ${chatAudience('p.user_id')} AND ${unreadChat('p.user_id')})`;args=[actorId,start];
 }else if(path==='/admin/announcement'){
  source="p.announcement=1 AND EXISTS(SELECT 1 FROM notification_announcements a WHERE a.sender_id=? AND a.created_at>=? AND a.sender_id<>p.user_id)";args=[actorId,start];
 }else if(path==='/admin/mail'){
  source="(p.letter=1 OR p.battle=1) AND EXISTS(SELECT 1 FROM mail_campaigns m WHERE m.sender_id=? AND m.created_at>=? AND m.sender_id<>p.user_id AND (m.target_user_id IS NULL OR m.target_user_id=p.user_id))";args=[actorId,start];
 }else if(path==='/letters'||path.startsWith('/letters/')){
  source=`p.letter=1 AND EXISTS(SELECT 1 FROM base_letter_messages m JOIN base_letter_threads t ON t.id=m.thread_id WHERE m.sender_id=? AND m.created_at>=? AND m.sender_id<>p.user_id AND ((t.kind='player' AND (t.user_a=p.user_id OR t.user_b=p.user_id)) OR (t.kind='guild' AND (t.sender_id=p.user_id OR EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=p.user_id AND gm.guild_id=t.guild_id)))))`;args=[actorId,start];
 }else if(path==='/court/chat'){
  source=`p.chat=1 AND EXISTS(SELECT 1 FROM court_chat m WHERE m.author_id=? AND m.created_at>=? AND m.author_id<>p.user_id AND NOT EXISTS(SELECT 1 FROM notification_chat_reads nr WHERE nr.user_id=p.user_id AND nr.room_key='court:chat' AND nr.last_message_id>=m.seq))`;args=[actorId,start];
 }else if(path==='/court/audiences'||/^\/court\/audiences\/ca_[a-f0-9]{32}\/replies$/.test(path)){
  source=`p.chat=1 AND EXISTS(SELECT 1 FROM court_audience_messages m JOIN court_audience_threads t ON t.id=m.thread_id WHERE m.author_id=? AND m.created_at>=? AND m.author_id<>p.user_id AND (t.requester_id=p.user_id OR p.user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') OR EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=p.user_id) OR EXISTS(SELECT 1 FROM court_regent r WHERE r.user_id=p.user_id)))`;args=[actorId,start];
 }else return{ok:true,sent:0,checked:0};
 const records=rows(await stmt(env.DB,`SELECT p.*,MIN(s.created_at) AS since FROM notification_preferences p JOIN notification_subscriptions s ON s.user_id=p.user_id WHERE p.enabled=1 AND ${activeAuthor('p.user_id')} AND ${source} GROUP BY p.user_id ORDER BY p.user_id LIMIT 12`,...args).all());
 let sent=0,failed=0,checked=0;
 for(let offset=0;offset<records.length&&Date.now()-now<18000;offset+=6){
  const selected=records.slice(offset,offset+6),delivered=await Promise.allSettled(selected.map(p=>deliverUser(env,p,clock,Date.now(),{messageOnly:true,courtAccess})));checked+=selected.length;
  for(const r of delivered){if(r.status==='fulfilled'){sent+=r.value.sent;failed+=r.value.failed;}else failed++;}
 }
 return{ok:true,sent,failed,checked};
}
export async function handleNotifications(ctx){
 const {db,user,env,now,path,method,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 if(path==='/notifications'&&method==='GET'){const p=await stmt(db,'SELECT * FROM notification_preferences WHERE user_id=?',user.id).first();return{ok:true,configured:configured(env),publicKey:configured(env)?env.WEB_PUSH_PUBLIC_KEY:null,preferences:dto(p),devices:Number((await stmt(db,'SELECT COUNT(*) AS n FROM notification_subscriptions WHERE user_id=?',user.id).first())?.n||0),serverNow:now};}
 const body=await h.readBody(ctx.request);await h.budget(db,'notifications:'+user.id,30,60000,now);const guard=h.accountCommitGuard(user);
 if(path==='/notifications/preferences'&&method==='POST'){
  if(legacyTypes.some(k=>typeof body[k]!=='boolean')||messageTypes.some(k=>Object.hasOwn(body,k)&&typeof body[k]!=='boolean')||typeof body.enabled!=='boolean'||!Number.isInteger(body.quietStart)||body.quietStart<0||body.quietStart>23||!Number.isInteger(body.quietEnd)||body.quietEnd<0||body.quietEnd>23||![0,5,15,60].includes(body.digestMinutes))h.fail(400,'NOTIFICATION_SETTINGS','通知の種類・日本時間の休止時間・間隔を確認してください。');
  const previous=dto(await stmt(db,'SELECT * FROM notification_preferences WHERE user_id=?',user.id).first()),preferences={...previous,...body};
  const fields=['user_id','enabled',...types,'quiet_start','quiet_end','digest_minutes','updated_at',...messageTypes.map(k=>k+'_since')];
  const args=[user.id,preferences.enabled?1:0,...types.map(k=>preferences[k]?1:0),preferences.quietStart,preferences.quietEnd,preferences.digestMinutes,now,...messageTypes.map(()=>now),...guard.args],disabled=types.filter(k=>!preferences.enabled||!preferences[k]);
  const updates=['enabled',...types,'quiet_start','quiet_end','digest_minutes'].map(k=>k+'=excluded.'+k).concat('updated_at=MAX(notification_preferences.updated_at+1,excluded.updated_at)',messageTypes.map(k=>`${k}_since=CASE WHEN (notification_preferences.enabled=0 OR notification_preferences.${k}=0) AND excluded.enabled=1 AND excluded.${k}=1 THEN excluded.${k}_since ELSE notification_preferences.${k}_since END`));
  const statements=[stmt(db,`INSERT INTO notification_preferences(${fields.join(',')}) SELECT ${fields.map(()=>'?').join(',')} WHERE ${guard.sql} ON CONFLICT(user_id) DO UPDATE SET ${updates.join(',')}`,...args)];
  if(disabled.length)statements.push(stmt(db,`DELETE FROM notification_outbox WHERE user_id=? AND delivered_at IS NULL AND category IN(${disabled.map(()=>'?').join(',')}) AND ${guard.sql}`,user.id,...disabled,...guard.args));
  await db.batch(statements);await h.requireAccountAccess(db,user);
  if(preferences.enabled&&preferences.chat&&typeof h.courtAccess==='function')try{await notificationCourtAccess(db,user.id,now,(_id,at)=>h.courtAccess(db,user,at));}catch(_){/* A checkpoint can be retried without undoing saved notification choices. */}
  return{ok:true,preferences:dto(await stmt(db,'SELECT * FROM notification_preferences WHERE user_id=?',user.id).first())};
 }
 if(path==='/notifications/device'&&method==='POST'){
  if(typeof body.endpoint!=='string'||!allowedPushEndpoint(body.endpoint))h.fail(400,'PUSH_SUBSCRIPTION','ブラウザから発行された通知情報を確認してください。');
  const found=await stmt(db,'SELECT 1 AS found FROM notification_subscriptions WHERE user_id=? AND endpoint=? AND '+guard.sql,user.id,body.endpoint,...guard.args).first();await h.requireAccountAccess(db,user);return{ok:true,subscribed:!!found};
 }
 if(path==='/notifications/test'&&method==='POST'){
  if(!configured(env))h.fail(503,'PUSH_NOT_CONFIGURED','通知配信の準備中です。');
  if(typeof body.endpoint!=='string'||!allowedPushEndpoint(body.endpoint))h.fail(400,'PUSH_SUBSCRIPTION','この端末の通知登録を確認してください。');
  await h.budget(db,'notification-test:'+user.id,2,60000,now);
  const sub=await stmt(db,'SELECT s.* FROM notification_subscriptions s JOIN notification_preferences p ON p.user_id=s.user_id AND p.enabled=1 WHERE s.user_id=? AND s.endpoint=? AND '+guard.sql,user.id,body.endpoint,...guard.args).first();
  if(!sub)h.fail(409,'PUSH_DEVICE_REQUIRED','この端末の通知を有効にしてから受信確認してください。');
  let result;try{result=await sendWebPush(sub,{title:'戦国VS：通知の受信確認',body:'この端末の通知を受信できました。',tag:'sengoku-test',url:'/?notice=1',destination:'notifications'},env,now,async()=>!!await stmt(db,'SELECT 1 AS ok FROM notification_subscriptions s JOIN notification_preferences p ON p.user_id=s.user_id AND p.enabled=1 WHERE s.id=? AND s.user_id=? AND s.revision=? AND '+guard.sql,sub.id,user.id,sub.revision,...guard.args).first());}catch(_){h.fail(503,'PUSH_DELIVERY_FAILED','通知サービスに接続できませんでした。時間をおいて受信確認してください。');}
  if(result.cancelled){await h.requireAccountAccess(db,user);h.fail(409,'PUSH_DEVICE_CHANGED','通知設定が変更されました。画面を開き直してください。');}
  if(result.status===404||result.status===410){await stmt(db,'DELETE FROM notification_subscriptions WHERE id=? AND user_id=? AND revision=?',sub.id,user.id,sub.revision).run();h.fail(409,'PUSH_DEVICE_EXPIRED','通知の登録期限が切れています。この端末の通知を有効にし直してください。');}
  if(!result.ok)h.fail(503,'PUSH_DELIVERY_FAILED','通知サービスが受け付けませんでした。時間をおいて受信確認してください。');
  return{ok:true,sent:1};
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
