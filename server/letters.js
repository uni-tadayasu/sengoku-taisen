// Private correspondence between two lords, or an outside sender and the
// CURRENT membership of one guild. This never reads the internal guild chat.
const letterStmt=(db,sql,...params)=>db.prepare(sql).bind(...params);
const letterRows=result=>result?.results||[];
const letterIso=value=>new Date(Number(value)).toISOString();
const letterAccess=(alias='t')=>`((${alias}.kind='player' AND (${alias}.user_a=? OR ${alias}.user_b=?)) OR (${alias}.kind='guild' AND (${alias}.sender_id=? OR EXISTS(SELECT 1 FROM guild_members gm WHERE gm.guild_id=${alias}.guild_id AND gm.user_id=?))))`;
const letterActor=id=>[id,id,id,id];
async function letterHash(value){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');}
const LETTER_SELECT=`SELECT t.*,a.name AS a_name,b.name AS b_name,s.name AS sender_name,g.name AS guild_name,c.name AS context_name,
  lm.id AS message_id,lm.body AS last_body,lm.sender_id AS last_sender_id,lm.created_at AS last_created_at,author.name AS last_sender_name,
  (SELECT COUNT(*) FROM base_letter_messages m WHERE m.thread_id=t.id AND m.seq>COALESCE(r.last_seq,0) AND m.sender_id<>?) AS unread_count
  FROM base_letter_threads t
  LEFT JOIN users a ON a.id=t.user_a LEFT JOIN users b ON b.id=t.user_b
  LEFT JOIN users s ON s.id=t.sender_id LEFT JOIN guilds g ON g.id=t.guild_id LEFT JOIN users c ON c.id=t.context_player_id
  LEFT JOIN base_letter_messages lm ON lm.seq=t.last_seq LEFT JOIN users author ON author.id=lm.sender_id
  LEFT JOIN base_letter_reads r ON r.thread_id=t.id AND r.user_id=?`;
function letterThread(row,viewer,evaluationRef){
  const player=row.kind==='player',peer=player?(row.user_a===viewer?{id:row.user_b,name:row.b_name,evaluation:evaluationRef(row.user_b)}:{id:row.user_a,name:row.a_name,evaluation:evaluationRef(row.user_a)}):null;
  return {id:row.id,kind:row.kind,title:player?peer.name:row.sender_id===viewer?row.guild_name:`${row.sender_name} → ${row.guild_name}`,
    peer,guild:player?null:{id:row.guild_id,name:row.guild_name},sender:player?null:{id:row.sender_id,name:row.sender_name,evaluation:evaluationRef(row.sender_id)},
    contextPlayer:row.context_player_id?{id:row.context_player_id,name:row.context_name,evaluation:evaluationRef(row.context_player_id)}:null,
    visibility:player?'領主本人同士だけが閲覧できます。':'送り主と、所属ギルドの現在のメンバーに共有されます。',
    unreadCount:Number(row.unread_count||0),lastSeq:Number(row.last_seq),updatedAt:letterIso(row.updated_at),canReply:true,
    lastMessage:row.message_id?{id:row.message_id,seq:Number(row.last_seq),authorId:row.last_sender_id,authorName:row.last_sender_name,authorEvaluation:evaluationRef(row.last_sender_id),text:Array.from(row.last_body||'').slice(0,120).join(''),createdAt:letterIso(row.last_created_at)}:null};
}
const letterMessage=(row,evaluationRef)=>({id:row.id,seq:Number(row.seq),threadId:row.thread_id,authorId:row.sender_id,authorName:row.name,authorEvaluation:evaluationRef(row.sender_id),text:row.body,createdAt:letterIso(row.created_at)});
function letterLimit(raw,fallback,max,fail){if(raw===null||raw===undefined)return fallback;if(!/^\d{1,3}$/.test(raw)||Number(raw)<1||Number(raw)>max)fail(400,'INVALID_INPUT',`書状の件数は1～${max}件にしてください。`);return Number(raw);}
function letterId(value,helpers){const id=helpers.idField(value,'書状の識別子');if(!/^lt_[a-f0-9]{32}$/.test(id))helpers.fail(404,'LETTER_NOT_FOUND','この書状は見つからないか、閲覧できません。');return id;}
function letterKeys(body,allowed,fail){if(Object.keys(body).some(key=>!allowed.includes(key)))fail(400,'INVALID_INPUT','書状の送信内容を確認してください。');}
async function letterSummary(db,userId){
  const result=await letterStmt(db,`SELECT COUNT(*) AS unread_count,COUNT(DISTINCT t.id) AS unread_threads
    FROM base_letter_threads t JOIN base_letter_messages m ON m.thread_id=t.id
    LEFT JOIN base_letter_reads r ON r.thread_id=t.id AND r.user_id=?
    WHERE ${letterAccess()} AND m.seq>COALESCE(r.last_seq,0) AND m.sender_id<>?`,userId,...letterActor(userId),userId).first();
  return {unreadCount:Number(result?.unread_count||0),unreadThreads:Number(result?.unread_threads||0)};
}
async function letterHeader(db,userId,id){return letterStmt(db,LETTER_SELECT+` WHERE t.id=? AND ${letterAccess()}`,userId,userId,id,...letterActor(userId)).first();}
async function letterInbox(ctx){
  const {db,user,url,helpers:h}=ctx,limit=letterLimit(url.searchParams.get('limit'),30,50,h.fail),cursor=url.searchParams.get('cursor');let point=null;
  if(cursor){if(cursor.length>512)h.fail(400,'INVALID_CURSOR','書状一覧の続きが正しくありません。');try{point=JSON.parse(atob(cursor.replaceAll('-','+').replaceAll('_','/')));}catch{h.fail(400,'INVALID_CURSOR','書状一覧の続きが正しくありません。');}if(!Array.isArray(point)||point.length!==2||!Number.isSafeInteger(point[0])||point[0]<0||!/^lt_[a-f0-9]{32}$/.test(point[1]))h.fail(400,'INVALID_CURSOR','書状一覧の続きが正しくありません。');}
  const found=letterRows(await letterStmt(db,LETTER_SELECT+` WHERE ${letterAccess()}${point?' AND (t.updated_at<? OR (t.updated_at=? AND t.id<?))':''} ORDER BY t.updated_at DESC,t.id DESC LIMIT ?`,user.id,user.id,...letterActor(user.id),...(point?[point[0],point[0],point[1]]:[]),limit+1).all()),page=found.slice(0,limit),last=page.at(-1);
  return {ok:true,threads:page.map(row=>letterThread(row,user.id,h.evaluationRef)),playerEvaluations:h.evaluationUpdates(page.flatMap(row=>[row.user_a,row.user_b,row.sender_id,row.context_player_id,row.last_sender_id])),...await letterSummary(db,user.id),nextCursor:found.length>limit?btoa(JSON.stringify([Number(last.updated_at),last.id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null};
}
async function letterRead(ctx,id){
  const {db,user,url,helpers:h}=ctx,limit=letterLimit(url.searchParams.get('limit'),40,100,h.fail),beforeRaw=url.searchParams.get('before'),afterRaw=url.searchParams.get('after');let before=null,after=null;
  if(beforeRaw!==null){if(!/^\d{1,15}$/.test(beforeRaw)||!Number.isSafeInteger(Number(beforeRaw))||Number(beforeRaw)<1)h.fail(400,'INVALID_CURSOR','書状の続きが正しくありません。');before=Number(beforeRaw);}
  if(afterRaw!==null){if(before!==null||!/^\d{1,15}$/.test(afterRaw)||!Number.isSafeInteger(Number(afterRaw))||Number(afterRaw)<0)h.fail(400,'INVALID_CURSOR','書状の続きが正しくありません。');after=Number(afterRaw);}
  // The membership check and message read share one database snapshot. An old
  // authenticated role cannot read a guild thread after leaving that guild.
  const result=await db.batch([
    letterStmt(db,LETTER_SELECT+` WHERE t.id=? AND ${letterAccess()}`,user.id,user.id,id,...letterActor(user.id)),
    letterStmt(db,`SELECT m.*,u.name FROM base_letter_messages m JOIN users u ON u.id=m.sender_id JOIN base_letter_threads t ON t.id=m.thread_id
      WHERE t.id=? AND ${letterAccess()}${before!==null?' AND m.seq<?':after!==null?' AND m.seq>?':''} ORDER BY m.seq ${after!==null?'ASC':'DESC'} LIMIT ?`,id,...letterActor(user.id),...(before!==null?[before]:after!==null?[after]:[]),limit+1),
    letterStmt(db,`SELECT DISTINCT sender_id FROM (SELECT m.sender_id FROM base_letter_messages m JOIN base_letter_threads t ON t.id=m.thread_id
      WHERE t.id=? AND ${letterAccess()} ORDER BY m.seq DESC LIMIT 100)`,id,...letterActor(user.id))
  ]),row=letterRows(result[0])[0];if(!row)h.fail(404,'LETTER_NOT_FOUND','この書状は見つからないか、閲覧できません。');
  const all=letterRows(result[1]),messages=all.slice(0,limit);if(after===null)messages.reverse();return {ok:true,thread:letterThread(row,user.id,h.evaluationRef),messages:messages.map(message=>letterMessage(message,h.evaluationRef)),playerEvaluations:h.evaluationUpdates([row.user_a,row.user_b,row.sender_id,row.context_player_id,...messages.map(message=>message.sender_id),...letterRows(result[2]).map(author=>author.sender_id)]),hasOlder:after===null&&all.length>limit,nextBefore:after===null&&all.length>limit?Number(messages[0].seq):null,hasNewer:after!==null&&all.length>limit,nextAfter:after!==null&&all.length>limit?Number(messages.at(-1).seq):null,readCursor:messages.length?Number(messages.at(-1).seq):0};
}
async function letterMarkRead(ctx,id){
  const {db,user,request,now,helpers:h}=ctx,body=await h.readBody(request);letterKeys(body,['through'],h.fail);
  if(!Number.isSafeInteger(body.through)||body.through<0)h.fail(400,'INVALID_INPUT','既読にする書状を確認してください。');
  const result=await letterStmt(db,`INSERT INTO base_letter_reads(thread_id,user_id,last_seq,read_at)
    SELECT t.id,?,MIN(?,t.last_seq),? FROM base_letter_threads t WHERE t.id=? AND ${letterAccess()}
    ON CONFLICT(thread_id,user_id) DO UPDATE SET last_seq=MAX(base_letter_reads.last_seq,excluded.last_seq),read_at=excluded.read_at RETURNING last_seq`,user.id,body.through,now,id,...letterActor(user.id)).first();
  if(!result)h.fail(404,'LETTER_NOT_FOUND','この書状は見つからないか、閲覧できません。');return {ok:true,through:Number(result.last_seq),...await letterSummary(db,user.id)};
}
async function letterSentResponse(ctx,receipt,idempotent){
  const {db,user,helpers:h}=ctx,result=await db.batch([
    letterStmt(db,LETTER_SELECT+` WHERE t.id=? AND ${letterAccess()}`,user.id,user.id,receipt.thread_id,...letterActor(user.id)),
    letterStmt(db,`SELECT m.*,u.name FROM base_letter_messages m JOIN users u ON u.id=m.sender_id JOIN base_letter_threads t ON t.id=m.thread_id WHERE m.id=? AND t.id=? AND ${letterAccess()}`,receipt.message_id,receipt.thread_id,...letterActor(user.id))
  ]),thread=letterRows(result[0])[0],message=letterRows(result[1])[0];
  if(!thread||!message)h.fail(404,'LETTER_NOT_FOUND','この書状は見つからないか、閲覧できません。');return {ok:true,thread:letterThread(thread,user.id,h.evaluationRef),message:letterMessage(message,h.evaluationRef),idempotent};
}
async function letterSend(ctx,replyId=null){
  const {db,user,request,now,helpers:h}=ctx,body=await h.readBody(request);letterKeys(body,replyId?['requestId','text']:['requestId','targetPlayerId','destination','guildId','text'],h.fail);
  const requestId=h.idField(body.requestId,'送信の識別子'),text=h.textField(body.text,'書状の本文',1000);
  let target=null,guildId=null,threadId=replyId,kind=null,a=null,b=null,sender=null,contextPlayer=null,guard,guardParams;
  if(replyId){guard=`EXISTS(SELECT 1 FROM base_letter_threads t WHERE t.id=? AND ${letterAccess()})`;guardParams=[replyId,...letterActor(user.id)];}
  else{
    if(!['player','guild'].includes(body.destination))h.fail(400,'INVALID_INPUT','領主本人か所属ギルドを選んでください。');
    target=h.idField(body.targetPlayerId,'宛先の領主');if(target===user.id)h.fail(400,'INVALID_TARGET','ほかの領主の本拠を選んでください。');kind=body.destination;contextPlayer=target;
    if(kind==='guild')guildId=h.idField(body.guildId,'宛先のギルド');else if(body.guildId!==undefined)h.fail(400,'INVALID_INPUT','領主本人への書状にギルドは指定できません。');
    if(kind==='player'){[a,b]=[user.id,target].sort();threadId='lt_'+(await letterHash(JSON.stringify(['player',a,b]))).slice(0,32);guard='EXISTS(SELECT 1 FROM users WHERE id=?)';guardParams=[target];}
    else{sender=user.id;threadId='lt_'+(await letterHash(JSON.stringify(['guild',guildId,sender]))).slice(0,32);guard='EXISTS(SELECT 1 FROM guild_members gm JOIN guilds g ON g.id=gm.guild_id WHERE gm.user_id=? AND gm.guild_id=?)';guardParams=[target,guildId];}
  }
  const digest=await letterHash(JSON.stringify(replyId?['reply',replyId,text]:['new',kind,target,guildId,text]));
  const prior=await letterStmt(db,'SELECT * FROM base_letter_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first();
  if(prior){if(prior.request_hash!==digest)h.fail(409,'LETTER_REQUEST_REUSED','この送信番号は別の書状に使用されています。');return letterSentResponse(ctx,prior,true);}
  await h.budget(db,'letter-send:'+user.id,20,60000,now);
  if(replyId&&!await letterHeader(db,user.id,replyId))h.fail(404,'LETTER_NOT_FOUND','この書状は見つからないか、返信できません。');
  if(!replyId&&!await h.getUser(db,target))h.fail(404,'PLAYER_NOT_FOUND','宛先の領主が見つかりません。');
  const token=crypto.randomUUID(),messageId=h.uid('lm_'),gate='EXISTS(SELECT 1 FROM base_letter_requests WHERE actor_id=? AND request_id=? AND commit_token=?)',args=[user.id,requestId,token];
  const statements=[letterStmt(db,`INSERT INTO base_letter_requests(actor_id,request_id,request_hash,thread_id,message_id,commit_token,created_at)
    SELECT ?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING *`,user.id,requestId,digest,threadId,messageId,token,now,...guardParams)];
  if(!replyId)statements.push(letterStmt(db,`INSERT INTO base_letter_threads(id,kind,user_a,user_b,sender_id,guild_id,context_player_id,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT(id) DO NOTHING`,threadId,kind,a,b,sender,guildId,contextPlayer,now,now,...args));
  statements.push(letterStmt(db,`INSERT INTO base_letter_messages(id,thread_id,sender_id,body,created_at) SELECT ?,?,?,?,? WHERE ${gate}`,messageId,threadId,user.id,text,now,...args));
  statements.push(letterStmt(db,`UPDATE base_letter_threads SET last_seq=(SELECT seq FROM base_letter_messages WHERE id=?),updated_at=? WHERE id=? AND ${gate}`,messageId,now,threadId,...args));
  const accepted=letterRows((await db.batch(statements))[0])[0];
  if(!accepted){const replay=await letterStmt(db,'SELECT * FROM base_letter_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first();if(replay){if(replay.request_hash!==digest)h.fail(409,'LETTER_REQUEST_REUSED','この送信番号は別の書状に使用されています。');return letterSentResponse(ctx,replay,true);}if(!replyId&&kind==='guild')h.fail(409,'LETTER_TARGET_CHANGED','宛先の所属ギルドが変わりました。送信先を選び直してください。');h.fail(404,'LETTER_NOT_FOUND','この書状は見つからないか、返信できません。');}
  return letterSentResponse(ctx,accepted,false);
}

export async function handleLetters(ctx){
  const {db,user,path,method,url,helpers:h}=ctx;
  if(path==='/letters/summary'&&method==='GET')return {ok:true,...await letterSummary(db,user.id)};
  if(path==='/letters/recipient'&&method==='GET'){
    const id=h.idField(url.searchParams.get('playerId'),'宛先の領主');if(id===user.id)h.fail(400,'INVALID_TARGET','ほかの領主の本拠を選んでください。');const player=await h.getUser(db,id);if(!player)h.fail(404,'PLAYER_NOT_FOUND','宛先の領主が見つかりません。');return {ok:true,player:h.mapUser(player,ctx.now)};
  }
  if(path==='/letters'&&method==='GET')return letterInbox(ctx);
  if(path==='/letters'&&method==='POST')return letterSend(ctx);
  const match=path.match(/^\/letters\/([^/]+)(?:\/(messages|read))?$/);
  if(match){const id=letterId(match[1],h);if(!match[2]&&method==='GET')return letterRead(ctx,id);if(match[2]==='messages'&&method==='POST')return letterSend(ctx,id);if(match[2]==='read'&&method==='POST')return letterMarkRead(ctx,id);}
  h.fail(404,'NOT_FOUND','この書状の操作は見つかりません。');
}
