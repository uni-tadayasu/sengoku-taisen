// Audio-only WebRTC signaling. Media never passes through this application or
// its database. Every signaling read/write is scoped to a live, authorized call.
const MAX_PARTICIPANTS=8,LEASE_MS=45000,SIGNAL_TTL_MS=60000,MAX_SIGNALS=240;
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=result=>result?.results||[];
const iso=value=>new Date(Number(value)).toISOString();
const sessionPattern=/^vc_[a-f0-9]{32}$/;

// Role terms, moderation revisions and a monotonic membership epoch prevent a
// removed/reappointed/rejoined account from reviving a previous call session.
const liveSession=alias=>`${alias}.lease_until>? AND EXISTS(SELECT 1 FROM users WHERE id=${alias}.user_id)
 AND NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id=${alias}.user_id AND active=1)
 AND COALESCE((SELECT revision FROM player_bans WHERE user_id=${alias}.user_id),0)=${alias}.moderation_epoch
 AND CASE WHEN ${alias}.user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') THEN 1 ELSE 0 END=${alias}.is_admin
 AND COALESCE((SELECT COALESCE(term_id,'legacy:'||appointed_at) FROM staff_members WHERE user_id=${alias}.user_id),'')=${alias}.staff_term
 AND COALESCE((SELECT term_id FROM deputy_operator_state WHERE user_id=${alias}.user_id),'')=${alias}.deputy_term
 AND NOT EXISTS(SELECT 1 FROM player_expulsions WHERE user_id=${alias}.user_id AND pending=1)
 AND ((${alias}.channel='admin' AND (${alias}.is_admin=1 OR ${alias}.staff_term<>'' OR ${alias}.deputy_term<>'')) OR
 (${alias}.channel='guild' AND EXISTS(SELECT 1 FROM guild_members gm JOIN voice_membership_epochs ve ON ve.user_id=gm.user_id WHERE gm.user_id=${alias}.user_id AND gm.guild_id=${alias}.guild_id AND ve.epoch=${alias}.membership_epoch)))`;
const rosterSql=`SELECT v.id,u.name,v.muted,v.joined_at,v.user_id FROM voice_sessions v JOIN users u ON u.id=v.user_id WHERE v.room_key=? AND ${liveSession('v')}`;
const rosterOrder=` ORDER BY v.joined_at,v.id LIMIT ${MAX_PARTICIPANTS}`;
const participant=(row,user)=>({sessionId:row.id,name:row.name,muted:!!row.muted,joinedAt:iso(row.joined_at),isSelf:row.user_id===user.id});

function strictKeys(value,keys,fail){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))fail(400,'INVALID_VOICE_INPUT','通話の送信内容を確認してください。');}
function sessionId(value,fail){if(typeof value!=='string'||!sessionPattern.test(value))fail(400,'INVALID_VOICE_SESSION','通話の識別子が正しくありません。');return value;}
function mutedValue(value,fail){if(typeof value!=='boolean')fail(400,'INVALID_VOICE_INPUT','マイクの状態を確認してください。');return value?1:0;}
function channelValue(value,fail){if(!['guild','admin'].includes(value))fail(400,'INVALID_VOICE_CHANNEL','同盟または運営の通話を選択してください。');return value;}
function queryKeys(url,keys,fail){const entries=[...url.searchParams.entries()];if(entries.some(([key])=>!keys.includes(key))||new Set(entries.map(([key])=>key)).size!==entries.length)fail(400,'INVALID_VOICE_INPUT','通話の取得条件を確認してください。');}
function cursorValue(value,fail){if(value===null)return 0;if(!/^\d{1,16}$/.test(value)||!Number.isSafeInteger(Number(value)))fail(400,'INVALID_CURSOR','通話の更新番号が正しくありません。');return Number(value);}

function signalPayload(kind,payload,fail){
 const invalid=()=>fail(400,'INVALID_VOICE_SIGNAL','音声通話の接続情報が正しくありません。');
 if(kind==='offer'||kind==='answer'){
  strictKeys(payload,['type','sdp'],fail);
  if(payload.type!==kind||typeof payload.sdp!=='string'||payload.sdp.length<10||payload.sdp.length>12000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(payload.sdp))invalid();
  const lines=payload.sdp.split(/\r?\n/),media=lines.filter(line=>line.startsWith('m='));
  if(lines[0]!=='v=0'||lines.length>180||lines.some(line=>line.length>2048)||media.length!==1||!/^m=audio \d+(?:\/\d+)? (?:UDP\/TLS\/RTP\/SAVPF|RTP\/SAVPF) \d+(?: \d+)*$/.test(media[0]))invalid();
  return {type:kind,sdp:payload.sdp};
 }
 if(kind!=='ice')invalid();
 strictKeys(payload,['candidate','sdpMid','sdpMLineIndex','usernameFragment'],fail);
 // An empty candidate is the standard end-of-candidates marker, still scoped
 // to the same validated audio media section and authenticated peer session.
 if(typeof payload.candidate!=='string'||payload.candidate.length>2048||payload.candidate!==''&&!/^candidate:[^\r\n\u0000-\u001f\u007f]+$/.test(payload.candidate))invalid();
 if(payload.sdpMid!==undefined&&payload.sdpMid!==null&&(typeof payload.sdpMid!=='string'||payload.sdpMid.length>64||/[\u0000-\u0020\u007f]/.test(payload.sdpMid)))invalid();
 if(payload.sdpMLineIndex!==undefined&&payload.sdpMLineIndex!==null&&payload.sdpMLineIndex!==0)invalid();
 if(payload.usernameFragment!==undefined&&payload.usernameFragment!==null&&(typeof payload.usernameFragment!=='string'||payload.usernameFragment.length>256||/[\u0000-\u0020\u007f]/.test(payload.usernameFragment)))invalid();
 return {candidate:payload.candidate,...(payload.sdpMid!==undefined?{sdpMid:payload.sdpMid}:{}),...(payload.sdpMLineIndex!==undefined?{sdpMLineIndex:payload.sdpMLineIndex}:{}),...(payload.usernameFragment!==undefined?{usernameFragment:payload.usernameFragment}:{})};
}

// Optional coturn-compatible TURN REST credentials. Only short-lived HMAC
// credentials reach browsers; the shared secret is never returned or logged.
async function iceConfiguration(env,session,now){
 const result={iceServers:[{urls:'stun:stun.cloudflare.com:3478'}],relayAvailable:false};
 const secret=env.VOICE_TURN_SHARED_SECRET,raw=env.VOICE_TURN_URLS;
 if(typeof secret!=='string'||secret.length<24||typeof raw!=='string'||raw.length>2000)return result;
 let urls;try{urls=raw.trim().startsWith('[')?JSON.parse(raw):raw.split(/[\s,]+/).filter(Boolean);}catch{return result;}
 if(!Array.isArray(urls)||urls.length<1||urls.length>5||urls.some(url=>typeof url!=='string'||!/^turns?:(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?(?:\?transport=(?:udp|tcp))?$/.test(url)))return result;
 // Refresh the credential every ten minutes while retaining 50–60 minutes of
 // validity, so regular heartbeats do not churn native peer configuration.
 const expires=Math.floor(now/600000)*600+3600,username=expires+':'+session;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(username)));
 result.iceServers.push({urls,username,credential:btoa(String.fromCharCode(...signature))});result.relayAvailable=true;result.iceServersExpiresAt=iso(expires*1000);return result;
}

async function roomContext(db,user,channel,helpers){
 const {fail,roleCommitGuard}=helpers,role=roleCommitGuard(user);
 if(channel==='admin'){
  if(!user.is_admin&&!user.is_staff&&!user.is_deputy)fail(403,'STAFF_CHAT_REQUIRED','この通話を利用する権限がありません。');
  return {room:{id:'voice:admin',channel,name:'運営チャット',maxParticipants:MAX_PARTICIPANTS},guildId:null,membershipEpoch:0,guard:role};
 }
 if(!user.guild_id)fail(403,'GUILD_REQUIRED','所属同盟の通話だけを利用できます。');
 const member=await stmt(db,`SELECT gm.guild_id,g.name,ve.epoch FROM guild_members gm JOIN guilds g ON g.id=gm.guild_id JOIN voice_membership_epochs ve ON ve.user_id=gm.user_id WHERE gm.user_id=? AND gm.guild_id=? AND ${role.sql}`,user.id,user.guild_id,...role.args).first();
 if(!member)fail(409,'VOICE_ACCESS_CHANGED','通話の参加資格が変わりました。現在の所属を確認してください。');
 return {room:{id:'voice:guild:'+member.guild_id,channel,name:member.name,maxParticipants:MAX_PARTICIPANTS},guildId:member.guild_id,membershipEpoch:Number(member.epoch),guard:{sql:`${role.sql} AND EXISTS(SELECT 1 FROM guild_members gm JOIN voice_membership_epochs ve ON ve.user_id=gm.user_id WHERE gm.user_id=? AND gm.guild_id=? AND ve.epoch=?)`,args:[...role.args,user.id,member.guild_id,Number(member.epoch)]}};
}

async function callContext(db,user,id,now,helpers){
 const {fail,roleCommitGuard}=helpers,role=roleCommitGuard(user);
 const call=await stmt(db,`SELECT v.*,(${liveSession('v')}) AS is_live FROM voice_sessions v WHERE v.id=? AND v.user_id=?`,now,id,user.id).first();
 if(!call||Number(call.lease_until)<=now)fail(410,'VOICE_SESSION_EXPIRED','通話への参加が終了しました。もう一度参加してください。');
 if(!call.is_live)fail(409,'VOICE_ACCESS_CHANGED','通話の参加資格が変わったため、通話を終了しました。');
 const guard={sql:`${role.sql} AND EXISTS(SELECT 1 FROM voice_sessions own WHERE own.id=? AND own.user_id=? AND ${liveSession('own')})`,args:[...role.args,id,user.id,now]};
 return {call,guard};
}
function protectResponse(helpers,guard,participants,now){
 const checked={sql:guard.sql,args:[...guard.args]};
 for(const row of participants){checked.sql+=` AND EXISTS(SELECT 1 FROM voice_sessions checked WHERE checked.id=? AND ${liveSession('checked')})`;checked.args.push(row.id,now);}
 helpers.registerResponseGuard({...checked,code:'VOICE_ROSTER_CHANGED',message:'通話の参加者が変わりました。最新の参加者を確認しています。'});
}
async function requireGuard(db,helpers,guard){if(!await stmt(db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args).first())helpers.fail(409,'VOICE_ACCESS_CHANGED','通話の参加資格が変わりました。現在の接続状態を確認してください。');}
function cleanupStatements(db,now){return[
 stmt(db,'DELETE FROM voice_signals WHERE id IN (SELECT s.id FROM voice_signals s WHERE s.created_at<=? OR NOT EXISTS(SELECT 1 FROM voice_sessions v WHERE v.id=s.from_session_id) OR NOT EXISTS(SELECT 1 FROM voice_sessions v WHERE v.id=s.to_session_id) LIMIT 300)',now-SIGNAL_TTL_MS),
 stmt(db,'DELETE FROM voice_sessions WHERE id IN (SELECT id FROM voice_sessions WHERE lease_until<=? LIMIT 100)',now),
];}

export async function handleVoice({db,env,user,now,path,method,url,request,helpers}){
 const {fail,readBody,budget,uid,hash,requireAccountAccess,accountCommitGuard}=helpers;
 await requireAccountAccess(db,user);
 if(method==='GET'&&path==='/voice/room'){
  queryKeys(url,['channel'],fail);const channel=channelValue(url.searchParams.get('channel'),fail),context=await roomContext(db,user,channel,helpers);
  await budget(db,'voice-room:'+user.id,60,60000,now);
  const result=await db.batch([stmt(db,'SELECT 1 AS allowed WHERE '+context.guard.sql,...context.guard.args),stmt(db,rosterSql+' AND '+context.guard.sql+rosterOrder,context.room.id,now,...context.guard.args)]);
  if(!rows(result[0]).length)fail(409,'VOICE_ACCESS_CHANGED','通話の参加資格が変わりました。');
  const participants=rows(result[1]);protectResponse(helpers,context.guard,participants,now);
  return {ok:true,room:context.room,participants:participants.map(row=>participant(row,user)),serverNow:iso(now)};
 }
 if(method==='POST'&&path==='/voice/join'){
  queryKeys(url,[],fail);const body=await readBody(request);strictKeys(body,['channel','muted'],fail);const channel=channelValue(body.channel,fail),muted=mutedValue(body.muted,fail),context=await roomContext(db,user,channel,helpers),id=uid('vc_');
  await budget(db,'voice-join:'+user.id,12,60000,now);
  const guard=context.guard,result=await db.batch([...cleanupStatements(db,now),
   stmt(db,`INSERT INTO voice_sessions(id,user_id,room_key,channel,guild_id,membership_epoch,moderation_epoch,is_admin,staff_term,deputy_term,muted,joined_at,last_seen,lease_until)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql} AND (SELECT COUNT(*) FROM voice_sessions occupied WHERE occupied.room_key=? AND occupied.user_id<>? AND ${liveSession('occupied')})<?
    ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,room_key=excluded.room_key,channel=excluded.channel,guild_id=excluded.guild_id,membership_epoch=excluded.membership_epoch,moderation_epoch=excluded.moderation_epoch,is_admin=excluded.is_admin,staff_term=excluded.staff_term,deputy_term=excluded.deputy_term,muted=excluded.muted,joined_at=excluded.joined_at,last_seen=excluded.last_seen,lease_until=excluded.lease_until RETURNING id`,
    id,user.id,context.room.id,channel,context.guildId,context.membershipEpoch,Number(user.moderation_epoch||0),user.is_admin?1:0,user.staff_term||'',user.deputy_term||'',muted,now,now,now+LEASE_MS,...guard.args,context.room.id,user.id,now,MAX_PARTICIPANTS),
   stmt(db,rosterSql+rosterOrder,context.room.id,now),
  ]);
  if(!rows(result[2]).length){await requireGuard(db,helpers,guard);fail(409,'VOICE_ROOM_FULL','この通話は8人までです。空きができてから参加してください。');}
  const participants=rows(result[3]),sessionGuard=(await callContext(db,user,id,now,helpers)).guard;protectResponse(helpers,sessionGuard,participants,now);
  return {ok:true,sessionId:id,room:context.room,participants:participants.map(row=>participant(row,user)),heartbeatMs:10000,pollMs:2000,leaseMs:LEASE_MS,after:0,serverNow:iso(now),...await iceConfiguration(env,id,now)};
 }
 if(method==='POST'&&path==='/voice/leave'){
  queryKeys(url,[],fail);const body=await readBody(request);strictKeys(body,['sessionId'],fail);const id=sessionId(body.sessionId,fail),guard=accountCommitGuard(user);
  await budget(db,'voice-leave:'+user.id,30,60000,now);
  await db.batch([stmt(db,`DELETE FROM voice_signals WHERE (from_session_id=? OR to_session_id=?) AND EXISTS(SELECT 1 FROM voice_sessions WHERE id=? AND user_id=?) AND ${guard.sql}`,id,id,id,user.id,...guard.args),stmt(db,'DELETE FROM voice_sessions WHERE id=? AND user_id=? AND '+guard.sql,id,user.id,...guard.args)]);
  return {ok:true};
 }
 if(method==='GET'&&path==='/voice/poll'){
  queryKeys(url,['sessionId','after'],fail);const id=sessionId(url.searchParams.get('sessionId'),fail),after=cursorValue(url.searchParams.get('after'),fail),{call,guard}=await callContext(db,user,id,now,helpers);
  await budget(db,'voice-poll:'+user.id,90,60000,now);
  const result=await db.batch([
   stmt(db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args),
   stmt(db,'UPDATE voice_signals SET acknowledged=1 WHERE to_session_id=? AND id<=? AND acknowledged=0 AND '+guard.sql,id,after,...guard.args),
   stmt(db,rosterSql+rosterOrder,call.room_key,now),
   stmt(db,`SELECT s.id,s.from_session_id,s.kind,s.payload_json FROM voice_signals s JOIN voice_sessions sender ON sender.id=s.from_session_id WHERE s.to_session_id=? AND s.room_key=? AND s.id>? AND s.acknowledged=0 AND s.created_at>? AND ${liveSession('sender')} AND sender.room_key=s.room_key AND ${guard.sql} ORDER BY s.id LIMIT 100`,id,call.room_key,after,now-SIGNAL_TTL_MS,now,...guard.args),
  ]);
  if(!rows(result[0]).length)fail(409,'VOICE_ACCESS_CHANGED','通話への参加が終了しました。');
  const participants=rows(result[2]),signals=rows(result[3]).map(row=>({id:Number(row.id),fromSessionId:row.from_session_id,kind:row.kind,payload:JSON.parse(row.payload_json)}));protectResponse(helpers,guard,participants,now);
  return {ok:true,participants:participants.map(row=>participant(row,user)),signals,after:signals.at(-1)?.id??after,serverNow:iso(now)};
 }
 if(method==='POST'&&path==='/voice/heartbeat'){
  queryKeys(url,[],fail);const body=await readBody(request);strictKeys(body,['sessionId','muted'],fail);const id=sessionId(body.sessionId,fail),muted=mutedValue(body.muted,fail),{call,guard}=await callContext(db,user,id,now,helpers);
  await budget(db,'voice-heartbeat:'+user.id,30,60000,now);
  const result=await db.batch([...cleanupStatements(db,now),stmt(db,`UPDATE voice_sessions SET muted=?,last_seen=?,lease_until=? WHERE id=? AND user_id=? AND ${guard.sql} RETURNING id`,muted,now,now+LEASE_MS,id,user.id,...guard.args),stmt(db,rosterSql+rosterOrder,call.room_key,now)]);
  if(!rows(result[2]).length)fail(409,'VOICE_ACCESS_CHANGED','通話への参加が終了しました。');
  const participants=rows(result[3]);protectResponse(helpers,guard,participants,now);
  return {ok:true,participants:participants.map(row=>participant(row,user)),serverNow:iso(now),...await iceConfiguration(env,id,now)};
 }
 if(method==='POST'&&path==='/voice/signal'){
  queryKeys(url,[],fail);const body=await readBody(request);strictKeys(body,['sessionId','toSessionId','kind','payload'],fail);const id=sessionId(body.sessionId,fail),to=sessionId(body.toSessionId,fail);
  if(id===to)fail(400,'INVALID_VOICE_TARGET','別の通話参加者を選択してください。');
  const payload=signalPayload(body.kind,body.payload,fail),{call,guard}=await callContext(db,user,id,now,helpers),serialized=JSON.stringify(payload),digest=await hash(serialized);
  await budget(db,'voice-signal:'+user.id,300,60000,now);
  const peerSql=`EXISTS(SELECT 1 FROM voice_sessions peer WHERE peer.id=? AND peer.room_key=? AND ${liveSession('peer')})`,peerArgs=[to,call.room_key,now];
  const result=await db.batch([
   stmt(db,`DELETE FROM voice_signals WHERE from_session_id=? AND to_session_id=? AND kind=? AND payload_hash=? AND created_at<=? AND ${guard.sql}`,id,to,body.kind,digest,now-SIGNAL_TTL_MS,...guard.args),
   stmt(db,`INSERT INTO voice_signals(room_key,from_session_id,to_session_id,kind,payload_json,payload_hash,created_at)
    SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} AND ${peerSql} AND (SELECT COUNT(*) FROM voice_signals WHERE to_session_id=? AND acknowledged=0 AND created_at>?)<?
    ON CONFLICT(from_session_id,to_session_id,kind,payload_hash) DO NOTHING RETURNING id`,call.room_key,id,to,body.kind,serialized,digest,now,...guard.args,...peerArgs,to,now-SIGNAL_TTL_MS,MAX_SIGNALS),
   stmt(db,`SELECT id FROM voice_signals WHERE from_session_id=? AND to_session_id=? AND kind=? AND payload_hash=? AND ${guard.sql} AND ${peerSql}`,id,to,body.kind,digest,...guard.args,...peerArgs),
  ]);
  const stored=rows(result[2])[0];
  if(!stored){await requireGuard(db,helpers,guard);if(!await stmt(db,'SELECT 1 AS allowed WHERE '+peerSql,...peerArgs).first())fail(410,'VOICE_PEER_LEFT','相手はこの通話から退出しました。');fail(429,'VOICE_SIGNAL_BACKLOG','接続情報を整理しています。少し待ってから再接続してください。',2);}
  protectResponse(helpers,guard,[{id:to}],now);return {ok:true,id:Number(stored.id)};
 }
 fail(404,'NOT_FOUND','その通話機能は見つかりませんでした。');
}
