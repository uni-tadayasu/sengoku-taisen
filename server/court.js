// Admission derives from the current authoritative save. Public conversation
// represents all court officials as 朝廷; private personnel stay staff-only.
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=value=>value?.results||[],iso=value=>new Date(Number(value)).toISOString();
const REQUIREMENT=Object.freeze({rankId:'court-7',rankName:'従五位',minScore:35000});
const THRESHOLDS=Object.freeze([{title:'参議',minMerit:0},{title:'中納言',minMerit:50},{title:'大納言',minMerit:200},{title:'内大臣',minMerit:500},{title:'右大臣',minMerit:1000},{title:'左大臣',minMerit:2000}]);
const TERM="COALESCE(sm.term_id,'legacy:'||sm.appointed_at)";
const GATE='EXISTS(SELECT 1 FROM court_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const activeAuthor=alias=>`NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=${alias} AND pb.active=1)`;
const currentOfficial=alias=>`(${alias}=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') OR EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=${alias}))`;
const titleFor=(merit,operator,leader)=>operator?'太政大臣':leader?'天皇':[...THRESHOLDS].reverse().find(item=>merit>=item.minMerit).title;
const limits=(raw,fallback,max,h)=>{if(raw===null)return fallback;if(!/^[1-9][0-9]*$/.test(raw)||Number(raw)>max)h.fail(400,'INVALID_INPUT',`表示件数は1〜${max}件で指定してください。`);return Number(raw);};
const integer=(raw,h)=>{if(raw===null)return 0;if(!/^\d{1,16}$/.test(raw)||!Number.isSafeInteger(Number(raw)))h.fail(400,'INVALID_CURSOR','朝廷の表示位置を確認してください。');return Number(raw);};
const keys=(body,allowed,h)=>{if(Object.keys(body).some(key=>!allowed.includes(key)))h.fail(400,'INVALID_INPUT','朝廷への送信内容を確認してください。');};
const threadId=(id,h)=>{if(!/^ca_[a-f0-9]{32}$/.test(id))h.fail(404,'COURT_AUDIENCE_NOT_FOUND','この謁見は見つからないか、閲覧できません。');return id;};
const sameRequest=(prior,digest,h)=>{if(prior&&prior.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の朝廷の操作に使用されています。');return prior;};
const cursorEncode=row=>btoa(JSON.stringify([Number(row.updated_at),row.id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
function cursorDecode(raw,h){if(raw===null)return null;try{if(!/^[A-Za-z0-9_-]{1,256}$/.test(raw))throw Error();const value=JSON.parse(atob(raw.replaceAll('-','+').replaceAll('_','/')));if(!Array.isArray(value)||value.length!==2||!Number.isSafeInteger(value[0])||value[0]<0||!/^ca_[a-f0-9]{32}$/.test(value[1]))throw Error();return value;}catch{h.fail(400,'INVALID_CURSOR','謁見一覧の続きが正しくありません。');}}

async function allowed(ctx,access){if(!await stmt(ctx.db,'SELECT 1 AS allowed WHERE '+access.guard.sql,...access.guard.args).first()){await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);ctx.helpers.fail(409,'COURT_ACCESS_CHANGED','朝廷の利用資格が変わりました。最新の状態を確認してください。');}}
async function read(ctx,access,queries){const result=await ctx.db.batch([stmt(ctx.db,'SELECT 1 AS allowed WHERE '+access.guard.sql,...access.guard.args),...queries]);if(!rows(result[0]).length){await allowed(ctx,access);ctx.helpers.fail(409,'COURT_ACCESS_CHANGED','朝廷の利用資格が変わりました。');}return result.slice(1);}
async function finish(ctx,access,payload){
 const visitors=[...new Set([...(payload.messages||[]),...(payload.message?[payload.message]:[])].filter(item=>item.author?.kind==='visitor').map(item=>item.author.id))];
 // A visitor promoted while identities are being decorated must not escape
 // under their old public identity after becoming a court official.
 const guard=visitors.length?{sql:access.guard.sql+` AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id IN (${visitors.map(()=>'?').join(',')}) AND ${currentOfficial('u.id')})`,args:[...access.guard.args,...visitors]}:access.guard;
 ctx.helpers.registerGuard(guard);return{...payload,contentRevision:access.contentRevision};
}
async function revision(db){return Number((await stmt(db,'SELECT content_revision FROM moderation_state WHERE id=1').first()).content_revision);}
function requireEntry(ctx,access){if(!access.eligible)ctx.helpers.fail(403,'COURT_RANK_REQUIRED','朝廷への入場には従五位以上の位階が必要です。');}
function requireOfficial(ctx,access){if(!access.privileged)ctx.helpers.fail(403,'COURT_STAFF_REQUIRED','朝廷の担当者だけが利用できます。');}
async function prior(ctx,requestId,digest){return sameRequest(await stmt(ctx.db,'SELECT * FROM court_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId).first(),digest,ctx.helpers);}

async function roster(ctx,access){
 requireOfficial(ctx,access);
 const result=await read(ctx,access,[stmt(ctx.db,`SELECT u.id,u.name,${TERM} AS term_id,
  CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS operator,
  EXISTS(SELECT 1 FROM court_leader l WHERE l.user_id=u.id AND l.term_id=${TERM}) AS leader,
  COALESCE((SELECT SUM(points) FROM court_contributions c WHERE c.actor_id=u.id),0) AS merit,
  (SELECT COUNT(*) FROM court_contributions c WHERE c.actor_id=u.id) AS completed
  FROM users u LEFT JOIN staff_members sm ON sm.user_id=u.id WHERE ${activeAuthor('u.id')} AND (sm.user_id IS NOT NULL OR u.id=(SELECT value FROM settings WHERE key='adminUserId')) ORDER BY operator DESC,leader DESC,merit DESC,u.id`)]);
 const people=rows(result[0]).map(row=>({id:row.id,name:row.name,title:titleFor(Number(row.merit),!!row.operator,!!row.leader),merit:Number(row.merit),completedUpgrades:Number(row.completed),isLeader:!!row.leader&&!row.operator,termId:row.term_id||null}));
 return{ok:true,roster:people,leaderId:people.find(row=>row.isLeader)?.id||null,thresholds:THRESHOLDS};
}
async function info(ctx,access){
 const result=await read(ctx,access,[stmt(ctx.db,`SELECT COALESCE((SELECT SUM(points) FROM court_contributions WHERE actor_id=?),0) AS merit,EXISTS(SELECT 1 FROM court_leader l JOIN staff_members sm ON sm.user_id=l.user_id WHERE l.user_id=? AND l.term_id=${TERM}) AS leader`,ctx.user.id,ctx.user.id)]),self=rows(result[0])[0],state=access.shared;
 const title=ctx.user.is_admin?'太政大臣':ctx.user.is_staff?titleFor(Number(self.merit),false,!!self.leader):access.evaluation?.rankName||'無位';
 // Bind the title/capability to the same appointment observed for accessStamp.
 access.guard={sql:access.guard.sql+` AND COALESCE((SELECT l.appointment_token FROM court_leader l JOIN staff_members sm ON sm.user_id=l.user_id WHERE l.user_id=? AND l.term_id=${TERM} AND NOT EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=l.user_id)),'')=?`,args:[...access.guard.args,ctx.user.id,access.emperor.token||'']};
 return finish(ctx,access,{ok:true,eligible:access.eligible,requirement:REQUIREMENT,evaluation:access.evaluation,accessStamp:access.accessStamp,self:{id:ctx.user.id,name:ctx.user.name,title,merit:Number(self.merit),canRespond:access.privileged,canAppoint:!!ctx.user.is_admin,isCourtEmperor:access.emperor.isCourtEmperor},palace:{id:'kyoto_gosho',name:'京都御所',level:state.castleLevel,maxLevel:128,buildings:state.buildings,jobCount:state.jobs.length,updatedElapsedMs:state.updatedElapsedMs},features:{conversation:access.eligible,audience:access.eligible,roster:access.privileged},thresholds:THRESHOLDS,serverNow:iso(ctx.now)});
}
const messageSelect=table=>`SELECT m.*,u.name,CASE WHEN m.author_kind='court' OR ${currentOfficial('m.author_id')} THEN 1 ELSE 0 END AS official FROM ${table} m JOIN users u ON u.id=m.author_id`;
function message(row,ctx){const official=!!row.official;return{id:row.id,seq:Number(row.seq),text:row.body,createdAt:iso(row.created_at),author:official?{kind:'court',id:null,name:'朝廷',avatarVersion:null,evaluation:null}:{kind:'visitor',id:row.author_id,name:row.name,evaluation:ctx.helpers.evaluationRef(row.author_id)},own:row.author_id===ctx.user.id};}
async function chat(ctx,access){
 const {db,url,helpers:h}=ctx,after=integer(url.searchParams.get('after'),h),known=integer(url.searchParams.get('contentRevision'),h),limit=limits(url.searchParams.get('limit'),50,50,h),current=access.contentRevision,reset=known!==current;
 const delta=after&&!reset,result=await read(ctx,access,[stmt(db,messageSelect('court_chat')+` WHERE ${activeAuthor('m.author_id')} ${delta?'AND m.seq>?':''} ORDER BY m.seq ${delta?'ASC':'DESC'} LIMIT ?`,...(delta?[after]:[]),limit+1)]),found=rows(result[0]),selected=found.slice(0,limit);if(!delta)selected.reverse();
 return finish(ctx,access,{ok:true,messages:selected.map(row=>message(row,ctx)),hasMore:found.length>limit,reset,contentRevision:current});
}
async function chatWrite(ctx,access){
 const {db,user,now,helpers:h}=ctx,body=await h.readBody(ctx.request);keys(body,['requestId','text'],h);
 const requestId=h.idField(body.requestId,'操作番号'),text=h.textField(body.text,'会話',300),digest=await h.hash(JSON.stringify(['chat',text])),existing=await prior(ctx,requestId,digest);
 let saved=existing,committed=false;if(!saved){await h.budget(db,'court-chat:'+user.id,20,60000,now);const id=h.uid('cc_'),nonce=crypto.randomUUID(),args=[user.id,requestId,nonce];
 const register=await h.resolveMessageRegister(db,user,{kind:'public'},now),spoken=await register.write(text);
 const result=await db.batch([
  stmt(db,`INSERT INTO court_requests(actor_id,request_id,kind,request_hash,commit_token,message_id,created_at) SELECT ?,?,'chat',?,?,?,? WHERE ${access.guard.sql} AND ${register.guard.sql} ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING *`,user.id,requestId,digest,nonce,id,now,...access.guard.args,...register.guard.args),
  stmt(db,`INSERT INTO court_chat(id,author_id,author_kind,body,created_at) SELECT ?,?,?,?,? WHERE ${GATE}`,id,user.id,access.privileged?'court':'visitor',spoken,now,...args),
 ]);saved=rows(result[0])[0];committed=!!saved;saved=saved||await prior(ctx,requestId,digest);if(!saved){await allowed(ctx,access);h.fail(409,'COURT_CHANGED','会話の状態が変わりました。もう一度確認してください。');}}
 const found=await read(ctx,access,[stmt(db,messageSelect('court_chat')+` WHERE m.id=? AND ${activeAuthor('m.author_id')}`,saved.message_id)]),row=rows(found[0])[0];if(!row)h.fail(409,'CONTENT_CHANGED','この会話は削除されています。最新の会話を確認してください。');
 return finish(ctx,access,{ok:true,message:message(row,ctx),idempotent:!committed});
}
const threadSelect=`SELECT t.*,u.name AS requester_name,(SELECT COUNT(*) FROM court_audience_messages m WHERE m.thread_id=t.id) AS message_count FROM court_audience_threads t JOIN users u ON u.id=t.requester_id`;
const threadScope=(ctx,access)=>access.privileged?{sql:'1=1',args:[]}:{sql:'t.requester_id=?',args:[ctx.user.id]};
function thread(row){return{id:row.id,title:row.title,status:row.status,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),messageCount:Number(row.message_count||0),requester:{id:row.requester_id,name:row.requester_name},canReply:true};}
async function getThread(ctx,access,id){const scope=threadScope(ctx,access),result=await read(ctx,access,[stmt(ctx.db,threadSelect+` WHERE t.id=? AND ${scope.sql} AND ${activeAuthor('t.requester_id')}`,id,...scope.args)]),row=rows(result[0])[0];if(!row)ctx.helpers.fail(404,'COURT_AUDIENCE_NOT_FOUND','この謁見は見つからないか、閲覧できません。');return row;}
async function audienceList(ctx,access){
 const {db,url,helpers:h}=ctx,limit=limits(url.searchParams.get('limit'),30,50,h),point=cursorDecode(url.searchParams.get('cursor'),h),scope=threadScope(ctx,access),result=await read(ctx,access,[stmt(db,threadSelect+` WHERE ${scope.sql} AND ${activeAuthor('t.requester_id')} ${point?'AND (t.updated_at<? OR (t.updated_at=? AND t.id<?))':''} ORDER BY t.updated_at DESC,t.id DESC LIMIT ?`,...scope.args,...(point?[point[0],point[0],point[1]]:[]),limit+1)]),found=rows(result[0]),page=found.slice(0,limit);
 return finish(ctx,access,{ok:true,threads:page.map(thread),nextCursor:found.length>limit?cursorEncode(page.at(-1)):null});
}
async function audienceRead(ctx,access,id){
 const {db,url,helpers:h}=ctx,row=await getThread(ctx,access,id),before=integer(url.searchParams.get('before'),h),limit=limits(url.searchParams.get('limit'),50,50,h),scope=threadScope(ctx,access),current=access.contentRevision;
 const result=await read(ctx,access,[stmt(db,messageSelect('court_audience_messages')+` JOIN court_audience_threads t ON t.id=m.thread_id WHERE m.thread_id=? AND ${scope.sql} AND ${activeAuthor('t.requester_id')} AND ${activeAuthor('m.author_id')} ${before?'AND m.seq<?':''} ORDER BY m.seq DESC LIMIT ?`,id,...scope.args,...(before?[before]:[]),limit+1)]),found=rows(result[0]),page=found.slice(0,limit).reverse();
 return finish(ctx,access,{ok:true,thread:thread(row),messages:page.map(item=>message(item,ctx)),hasOlder:found.length>limit,nextBefore:found.length>limit?page[0]?.seq:null,contentRevision:current});
}
async function audienceWrite(ctx,access,id=null){
 const {db,user,now,helpers:h}=ctx,body=await h.readBody(ctx.request);keys(body,id?['requestId','text']:['requestId','title','text'],h);
 const requestId=h.idField(body.requestId,'操作番号'),text=h.textField(body.text,'謁見の本文',1000),title=id?null:h.textField(body.title,'謁見の件名',80),kind=id?'reply':'audience',digest=await h.hash(JSON.stringify([kind,id,title,text])),existing=await prior(ctx,requestId,digest);
 const threadRow=id?await getThread(ctx,access,id):null;
 let saved=existing,committed=false;if(!saved){await h.budget(db,'court-audience:'+user.id,20,60000,now);const entity=id||h.uid('ca_'),mid=h.uid('cm_'),nonce=crypto.randomUUID(),args=[user.id,requestId,nonce],scope=threadScope(ctx,access),extra=id?` AND EXISTS(SELECT 1 FROM court_audience_threads t WHERE t.id=? AND ${scope.sql} AND ${activeAuthor('t.requester_id')})`:'';
 const audience=threadRow&&threadRow.requester_id!==user.id?{kind:'person',id:threadRow.requester_id}:{kind:'officials'};
 const register=await h.resolveMessageRegister(db,user,audience,now),spoken=await register.write(text),subject=title&&await register.write(title,'title');
 const statements=[stmt(db,`INSERT INTO court_requests(actor_id,request_id,kind,request_hash,commit_token,entity_id,message_id,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${access.guard.sql}${extra} AND ${register.guard.sql} ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING *`,user.id,requestId,kind,digest,nonce,entity,mid,now,...access.guard.args,...(id?[id,...scope.args]:[]),...register.guard.args)];
 if(!id)statements.push(stmt(db,`INSERT INTO court_audience_threads(id,requester_id,title,status,created_at,updated_at) SELECT ?,?,?,'open',?,? WHERE ${GATE}`,entity,user.id,subject,now,now,...args));
 statements.push(stmt(db,`INSERT INTO court_audience_messages(id,thread_id,author_id,author_kind,body,created_at) SELECT ?,?,?,?,?,? WHERE ${GATE}`,mid,entity,user.id,access.privileged?'court':'visitor',spoken,now,...args));
 statements.push(stmt(db,`UPDATE court_audience_threads SET status=?,updated_at=? WHERE id=? AND ${GATE}`,id&&access.privileged?'answered':'open',now,entity,...args));
 const result=await db.batch(statements);saved=rows(result[0])[0];committed=!!saved;saved=saved||await prior(ctx,requestId,digest);if(!saved){await allowed(ctx,access);h.fail(409,'COURT_CHANGED','謁見の状態が変わりました。最新の内容を確認してください。');}}
 const current=await getThread(ctx,access,saved.entity_id),result=await read(ctx,access,[stmt(db,messageSelect('court_audience_messages')+` WHERE m.id=? AND ${activeAuthor('m.author_id')}`,saved.message_id)]),row=rows(result[0])[0];if(!row)h.fail(409,'CONTENT_CHANGED','この本文は削除されています。最新の内容を確認してください。');
 return finish(ctx,access,{ok:true,thread:thread(current),message:message(row,ctx),idempotent:!committed});
}
async function appoint(ctx,access){
 const {db,user,now,helpers:h}=ctx;if(!user.is_admin)h.fail(403,'ADMIN_REQUIRED','朝廷の任命は運営だけが行えます。');
 const body=await h.readBody(ctx.request);keys(body,['requestId','targetPlayerId'],h);const requestId=h.idField(body.requestId,'操作番号'),targetId=body.targetPlayerId===null?null:h.idField(body.targetPlayerId,'対象のスタッフ'),digest=await h.hash(JSON.stringify(['leader',targetId])),existing=await prior(ctx,requestId,digest);
 let committed=false;if(!existing){let target=null,guard={sql:'1=1',args:[]};if(targetId){target=await h.getUser(db,targetId);if(!target?.is_staff||target.is_admin||target.ban_active)h.fail(400,'COURT_LEADER_REQUIRED','現在在任中で利用停止中ではないスタッフを選んでください。');const account=h.accountCommitGuard(target);guard={sql:`EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=? AND ${TERM}=?) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?) AND ${account.sql}`,args:[target.id,target.staff_term,target.id,...account.args]};}
 await h.budget(db,'court-leader:'+user.id,30,60000,now);const nonce=crypto.randomUUID(),args=[user.id,requestId,nonce],statements=[stmt(db,`INSERT INTO court_requests(actor_id,request_id,kind,request_hash,commit_token,entity_id,created_at) SELECT ?,?,'leader',?,?,?,? WHERE ${access.guard.sql} AND ${guard.sql} ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING *`,user.id,requestId,digest,nonce,targetId,now,...access.guard.args,...guard.args)];
 if(target)statements.push(stmt(db,`INSERT INTO court_leader(id,user_id,term_id,appointment_token,appointed_by,updated_at) SELECT 1,?,?,?,?,? WHERE ${GATE} ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,term_id=excluded.term_id,appointment_token=excluded.appointment_token,appointed_by=excluded.appointed_by,updated_at=excluded.updated_at`,target.id,target.staff_term,nonce,user.id,now,...args));
 else statements.push(stmt(db,`DELETE FROM court_leader WHERE id=1 AND ${GATE}`,...args));
 const result=await db.batch(statements);committed=!!rows(result[0]).length;if(!committed&&!await prior(ctx,requestId,digest)){await allowed(ctx,access);h.fail(409,'COURT_LEADER_CHANGED','スタッフの任期または利用状態が変わりました。一覧を更新してください。');}}
 return finish(ctx,access,{...await roster(ctx,access),idempotent:!committed});
}
export async function handleCourt(ctx){
 const access=await ctx.helpers.courtAccess(ctx.db,ctx.user,ctx.now),{path,method,helpers:h}=ctx;
 // Capture the moderation epoch before reading any text. Every query, write,
 // and final response uses this same epoch, so a deletion during an await
 // cannot return an earlier body labelled with the newer revision.
 access.contentRevision=await revision(ctx.db);
 access.guard={sql:access.guard.sql+' AND EXISTS(SELECT 1 FROM moderation_state WHERE id=1 AND content_revision=?)',args:[...access.guard.args,access.contentRevision]};
 if(path==='/court'&&method==='GET')return info(ctx,access);
 if(path==='/staff/court'&&method==='GET')return finish(ctx,access,await roster(ctx,access));
 if(path==='/admin/court/leader'&&method==='POST')return appoint(ctx,access);
 requireEntry(ctx,access);
 if(path==='/court/chat'&&method==='GET')return chat(ctx,access);
 if(path==='/court/chat'&&method==='POST')return chatWrite(ctx,access);
 if(path==='/court/audiences'&&method==='GET')return audienceList(ctx,access);
 if(path==='/court/audiences'&&method==='POST')return audienceWrite(ctx,access);
 const match=/^\/court\/audiences\/([^/]+)(\/replies)?$/.exec(path);
 if(match){const id=threadId(match[1],h);if(!match[2]&&method==='GET')return audienceRead(ctx,access,id);if(match[2]&&method==='POST')return audienceWrite(ctx,access,id);}
 h.fail(404,'NOT_FOUND','この朝廷の機能は見つかりませんでした。');
}
