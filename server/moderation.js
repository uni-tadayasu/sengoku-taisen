// Only the current primary operator may change account access or remove posts.
// Audit receipts contain counts and identifiers, never copies of deleted text.
const moderationStmt=(db,sql,...params)=>db.prepare(sql).bind(...params);
const moderationRows=result=>result?.results||[];
const moderationIso=value=>value===null||value===undefined?null:new Date(Number(value)).toISOString();
const MODERATION_ADMIN="EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)";
const MODERATION_GATE='EXISTS(SELECT 1 FROM moderation_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const moderationBan=row=>({active:!!row?.active,revision:Number(row?.revision||0),reason:row?.reason||'',bannedAt:moderationIso(row?.banned_at),bannedBy:row?.banned_by||null,updatedAt:moderationIso(row?.updated_at)});
async function moderationRequire(ctx){const current=await ctx.helpers.getUser(ctx.db,ctx.user.id);ctx.helpers.requireAdmin(current||{});return current;}
async function moderationTarget(ctx,id){
  const {db,user,helpers:h}=ctx;
  const result=await db.batch([
    moderationStmt(db,'SELECT 1 AS allowed WHERE '+MODERATION_ADMIN,user.id),
    moderationStmt(db,h.userSelect+' WHERE u.id=? AND '+MODERATION_ADMIN,id,user.id),
    moderationStmt(db,'SELECT * FROM player_bans WHERE user_id=? AND '+MODERATION_ADMIN,id,user.id),
    moderationStmt(db,`SELECT ((SELECT COUNT(*) FROM messages WHERE user_id=?)+(SELECT COUNT(*) FROM court_chat WHERE author_id=?)) AS chat_messages,
      ((SELECT COUNT(*) FROM base_letter_messages WHERE sender_id=?)+(SELECT COUNT(*) FROM court_audience_messages WHERE author_id=?)) AS letter_messages,
      (SELECT COUNT(*) FROM trades WHERE status='pending' AND (sender_id=? OR recipient_id=?)) AS pending_trades,
      (SELECT content_revision FROM moderation_state WHERE id=1) AS content_revision WHERE ${MODERATION_ADMIN}`,id,id,id,id,id,id,user.id)
  ]);
  if(!moderationRows(result[0]).length)h.fail(403,'ADMIN_REQUIRED','運営専用の機能です。');
  const player=moderationRows(result[1])[0];if(!player)h.fail(404,'PLAYER_NOT_FOUND','対象の領主が見つかりません。');
  const ban=moderationBan(moderationRows(result[2])[0]),counts=moderationRows(result[3])[0],protectedPlayer=player.id===user.id||!!player.is_admin;
  return {ok:true,player:h.mapUser(player,ctx.now),ban,counts:{chatMessages:Number(counts.chat_messages),letterMessages:Number(counts.letter_messages),pendingTrades:Number(counts.pending_trades)},canBan:!protectedPlayer&&!ban.active,canUnban:!protectedPlayer&&ban.active,contentRevision:Number(counts.content_revision)};
}
async function moderationSearch(ctx){
  const {db,user,url,helpers:h}=ctx,q=h.textField(url.searchParams.get('q'),'検索語',90,{min:2}),pattern='%'+q.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')+'%';
  const result=await db.batch([
    moderationStmt(db,'SELECT 1 AS allowed WHERE '+MODERATION_ADMIN,user.id),
    moderationStmt(db,h.userSelect+` WHERE (u.name LIKE ? ESCAPE '\\' OR u.id=?) AND ${MODERATION_ADMIN} ORDER BY u.last_seen DESC,u.name,u.id LIMIT 30`,pattern,q,user.id)
  ]);
  if(!moderationRows(result[0]).length)h.fail(403,'ADMIN_REQUIRED','運営専用の機能です。');
  return {ok:true,players:moderationRows(result[1]).map(row=>({...h.mapUser(row,ctx.now),banned:!!row.ban_active,moderationRevision:Number(row.moderation_epoch||0)}))};
}
async function moderationBans(ctx){
  const {db,user,url,helpers:h}=ctx,raw=url.searchParams.get('limit')||'20',cursor=url.searchParams.get('cursor');
  if(!/^\d{1,2}$/.test(raw)||Number(raw)<1||Number(raw)>50)h.fail(400,'INVALID_INPUT','BAN一覧の件数は1〜50で指定してください。');
  let point=null;if(cursor){try{if(!/^[A-Za-z0-9_-]{1,512}$/.test(cursor))throw new Error();point=JSON.parse(atob(cursor.replaceAll('-','+').replaceAll('_','/')));}catch{h.fail(400,'INVALID_CURSOR','BAN一覧の続きが正しくありません。');}if(!Array.isArray(point)||point.length!==2||!Number.isSafeInteger(point[0])||point[0]<0||typeof point[1]!=='string'||!/^u_[a-f0-9]{32}$/.test(point[1]))h.fail(400,'INVALID_CURSOR','BAN一覧の続きが正しくありません。');}
  const result=await db.batch([
    moderationStmt(db,'SELECT 1 AS allowed,content_revision FROM moderation_state WHERE id=1 AND '+MODERATION_ADMIN,user.id),
    moderationStmt(db,`SELECT member.*,b.active,b.revision,b.reason,b.banned_by,b.banned_at,b.updated_at FROM (${h.userSelect}) member JOIN player_bans b ON b.user_id=member.id WHERE b.active=1 AND ${MODERATION_ADMIN}${point?' AND (b.updated_at<? OR (b.updated_at=? AND b.user_id<?))':''} ORDER BY b.updated_at DESC,b.user_id DESC LIMIT ?`,user.id,...(point?[point[0],point[0],point[1]]:[]),Number(raw)+1)
  ]);
  const access=moderationRows(result[0])[0];if(!access)h.fail(403,'ADMIN_REQUIRED','運営専用の機能です。');
  const found=moderationRows(result[1]),page=found.slice(0,Number(raw)),last=page.at(-1);
  return {ok:true,bans:page.map(row=>({player:h.mapUser(row,ctx.now),ban:moderationBan(row)})),nextCursor:found.length>Number(raw)?btoa(JSON.stringify([Number(last.updated_at),last.id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null,contentRevision:Number(access.content_revision)};
}
async function moderationPrior(ctx,requestId,digest){
  const prior=await moderationStmt(ctx.db,'SELECT * FROM moderation_requests WHERE actor_id=? AND request_id=? AND '+MODERATION_ADMIN,ctx.user.id,requestId,ctx.user.id).first();
  if(prior&&prior.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別のBAN・解除に使われています。');return prior;
}
async function moderationResult(ctx,receipt,idempotent){return {...await moderationTarget(ctx,receipt.targetPlayerId),receipt,idempotent};}
async function moderationChange(ctx){
  const {db,user,request,now,helpers:h}=ctx,raw=await h.readBody(request);
  if(Object.keys(raw).some(key=>!['targetPlayerId','action','reason','requestId','expectedRevision'].includes(key))||!['ban','unban'].includes(raw.action)||!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0)h.fail(400,'INVALID_INPUT','BAN・解除の対象と確認済みの更新番号を指定してください。');
  const targetId=h.idField(raw.targetPlayerId,'対象の領主'),requestId=h.idField(raw.requestId,'操作番号'),reason=h.textField(raw.reason,'管理メモ',300,{optional:true,min:0}),action=raw.action;
  if(targetId===user.id)h.fail(400,'INVALID_TARGET','運営本人をBAN・解除の対象にはできません。');
  const digest=await h.hash(JSON.stringify([targetId,action,reason,raw.expectedRevision])),prior=await moderationPrior(ctx,requestId,digest);if(prior)return moderationResult(ctx,JSON.parse(prior.result_json),true);
  const target=await moderationTarget(ctx,targetId);if(target.player.isAdmin)h.fail(400,'INVALID_TARGET','運営をBAN・解除の対象にはできません。');
  if(target.ban.revision!==raw.expectedRevision||target.ban.active===(action==='ban'))h.fail(409,'MODERATION_CHANGED','BANの状態が更新されています。対象の最新状態を確認してください。');
  await h.budget(db,'moderation:'+user.id,30,60000,now);
  const id=h.uid('mod_'),nonce=crypto.randomUUID(),gateArgs=[user.id,requestId,nonce],ban=action==='ban',revision=raw.expectedRevision+1;
  const statements=[moderationStmt(db,`INSERT INTO moderation_requests(id,actor_id,request_id,target_id,action,request_hash,commit_token,result_json,created_at)
    SELECT ?,?,?,?,?,?,?,json_object('id',?,'requestId',?,'action',?,'targetPlayerId',target.id,'targetName',target.name,'actorPlayerId',?,'reason',?,'moderationRevision',?,'contentRevision',(SELECT content_revision FROM moderation_state WHERE id=1)+?,
      'deleted',json_object('chatMessages',CASE WHEN ?=1 THEN ((SELECT COUNT(*) FROM messages WHERE user_id=target.id)+(SELECT COUNT(*) FROM court_chat WHERE author_id=target.id)) ELSE 0 END,'letterMessages',CASE WHEN ?=1 THEN ((SELECT COUNT(*) FROM base_letter_messages WHERE sender_id=target.id)+(SELECT COUNT(*) FROM court_audience_messages WHERE author_id=target.id)) ELSE 0 END),
      'cancelledTrades',CASE WHEN ?=1 THEN (SELECT COUNT(*) FROM trades WHERE status='pending' AND (sender_id=target.id OR recipient_id=target.id)) ELSE 0 END,'createdAt',?),?
    FROM users target WHERE target.id=? AND target.id<>? AND target.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') AND ${MODERATION_ADMIN}
    AND COALESCE((SELECT revision FROM player_bans WHERE user_id=target.id),0)=? AND COALESCE((SELECT active FROM player_bans WHERE user_id=target.id),0)=?
    ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING result_json`,id,user.id,requestId,targetId,action,digest,nonce,id,requestId,action,user.id,reason,revision,ban?1:0,ban?1:0,ban?1:0,ban?1:0,moderationIso(now),now,targetId,user.id,user.id,raw.expectedRevision,ban?0:1),
    moderationStmt(db,`INSERT INTO player_bans(user_id,active,revision,reason,banned_by,banned_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE ${MODERATION_GATE}
      ON CONFLICT(user_id) DO UPDATE SET active=excluded.active,revision=excluded.revision,reason=excluded.reason,banned_by=excluded.banned_by,banned_at=CASE WHEN excluded.active=1 THEN excluded.banned_at ELSE player_bans.banned_at END,updated_at=excluded.updated_at`,targetId,ban?1:0,revision,reason,user.id,ban?now:null,now,...gateArgs)
  ];
  if(ban)statements.push(
    moderationStmt(db,`UPDATE moderation_state SET content_revision=content_revision+1 WHERE id=1 AND ${MODERATION_GATE}`,...gateArgs),
    moderationStmt(db,`UPDATE base_letter_threads SET last_seq=COALESCE((SELECT MAX(seq) FROM base_letter_messages remaining WHERE remaining.thread_id=base_letter_threads.id AND remaining.sender_id<>?),0),updated_at=? WHERE id IN (SELECT thread_id FROM base_letter_messages WHERE sender_id=?) AND ${MODERATION_GATE}`,targetId,now,targetId,...gateArgs),
    moderationStmt(db,`DELETE FROM messages WHERE user_id=? AND ${MODERATION_GATE}`,targetId,...gateArgs),
    moderationStmt(db,`DELETE FROM base_letter_messages WHERE sender_id=? AND ${MODERATION_GATE}`,targetId,...gateArgs),
    moderationStmt(db,`UPDATE court_audience_threads SET title=CASE WHEN requester_id=? THEN '削除された謁見' ELSE title END,updated_at=? WHERE (requester_id=? OR id IN (SELECT thread_id FROM court_audience_messages WHERE author_id=?)) AND ${MODERATION_GATE}`,targetId,now,targetId,targetId,...gateArgs),
    moderationStmt(db,`DELETE FROM court_chat WHERE author_id=? AND ${MODERATION_GATE}`,targetId,...gateArgs),
    moderationStmt(db,`DELETE FROM court_audience_messages WHERE author_id=? AND ${MODERATION_GATE}`,targetId,...gateArgs),
    moderationStmt(db,`DELETE FROM court_leader WHERE user_id=? AND ${MODERATION_GATE}`,targetId,...gateArgs),
    moderationStmt(db,`DELETE FROM pairing_codes WHERE user_id=? AND ${MODERATION_GATE}`,targetId,...gateArgs),
    moderationStmt(db,`UPDATE player_saves SET writer_device_id=NULL,writer_device_name=NULL,lease_expires_at=0 WHERE user_id=? AND ${MODERATION_GATE}`,targetId,...gateArgs),
    moderationStmt(db,`UPDATE player_presence SET online=0 WHERE user_id=? AND ${MODERATION_GATE}`,targetId,...gateArgs),
    moderationStmt(db,`UPDATE walking_sessions SET closed=1 WHERE user_id=? AND closed=0 AND ${MODERATION_GATE}`,targetId,...gateArgs),
    moderationStmt(db,`UPDATE walking_accounts SET active_session_id=NULL,revision=revision+1 WHERE user_id=? AND active_session_id IS NOT NULL AND ${MODERATION_GATE}`,targetId,...gateArgs),
    moderationStmt(db,`INSERT INTO trade_deliveries(trade_id,recipient_id,kind,assets_json,created_at,claimed_at) SELECT id,sender_id,'refund',offer_json,?,NULL FROM trades WHERE status='pending' AND (sender_id=? OR recipient_id=?) AND ${MODERATION_GATE}`,now,targetId,targetId,...gateArgs),
    moderationStmt(db,`UPDATE trades SET status='cancelled',revision=revision+1,updated_at=? WHERE status='pending' AND (sender_id=? OR recipient_id=?) AND ${MODERATION_GATE}`,now,targetId,targetId,...gateArgs)
  );
  const saved=moderationRows((await db.batch(statements))[0])[0];
  if(!saved){await moderationRequire(ctx);const replay=await moderationPrior(ctx,requestId,digest);if(replay)return moderationResult(ctx,JSON.parse(replay.result_json),true);const latest=await moderationTarget(ctx,targetId);if(latest.player.isAdmin)h.fail(400,'INVALID_TARGET','運営をBAN・解除の対象にはできません。');h.fail(409,'MODERATION_CHANGED','BANの状態または運営資格が更新されました。最新状態を確認してください。');}
  return moderationResult(ctx,JSON.parse(saved.result_json),false);
}

export async function handleModeration(ctx){
  await moderationRequire(ctx);const {path,method,helpers:h}=ctx;
  if(path==='/admin/moderation/players'&&method==='GET')return moderationSearch(ctx);
  if(path==='/admin/moderation/target'&&method==='GET')return moderationTarget(ctx,h.idField(ctx.url.searchParams.get('playerId'),'対象の領主'));
  if(path==='/admin/moderation/bans'&&method==='GET')return moderationBans(ctx);
  if(path==='/admin/moderation'&&method==='POST')return moderationChange(ctx);
  h.fail(404,'NOT_FOUND','その管理機能は見つかりませんでした。');
}
