// A Regent acts for the Emperor without acquiring staff membership or moving
// home. The current appointment token is checked again at each write/response.
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=value=>value?.results||[];
const TERM="COALESCE(sm.term_id,'legacy:'||sm.appointed_at)";
const CROWN=alias=>`EXISTS(SELECT 1 FROM court_leader l JOIN staff_members sm ON sm.user_id=l.user_id WHERE l.id=1 AND l.user_id=${alias} AND l.term_id=${TERM})`;
const ELIGIBLE=alias=>`${alias}<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=${alias} AND b.active=1)
 AND NOT EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=${alias})
 AND NOT ${CROWN(alias)}`;
const HOME="CASE WHEN sm.user_id IS NOT NULL THEN 'kyoto_gosho' WHEN json_valid(ps.save_json) THEN json_extract(ps.save_json,'$.state.home') END";
const TARGET=`${ELIGIBLE('u.id')} AND (${HOME}) IS NOT NULL AND (${HOME})<>'edo'
 AND (sm.user_id IS NOT NULL OR (${HOME})<>'kyoto_gosho')`;
const PEOPLE=`FROM users u LEFT JOIN staff_members sm ON sm.user_id=u.id LEFT JOIN player_saves ps ON ps.user_id=u.id`;
const PERSON_SELECT=`u.id,u.name,CASE WHEN sm.user_id IS NOT NULL THEN 1 ELSE 0 END AS staff,${HOME} AS home`;
const GATE='EXISTS(SELECT 1 FROM court_regency_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const castleName=id=>id?(globalThis.SENGOKU_DATA?.castles?.find(c=>c.id===id)?.name||id):null;
const person=row=>({id:row.id,name:row.name,isStaff:!!row.staff,homeCastleId:row.home||null,homeCastleName:castleName(row.home)});

export async function courtRegentAuthority(db,user,roleCommitGuard){
 const role=roleCommitGuard(user),found=await S(db,`SELECT g.appointment_token FROM court_regent g
  WHERE g.id=1 AND g.user_id=? AND ${ELIGIBLE('g.user_id')} AND ${role.sql}`,user.id,...role.args).first(),token=found?.appointment_token||null;
 return{isCourtRegent:!!token,token,guard:{sql:`${role.sql} AND EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=? AND g.appointment_token=? AND ${ELIGIBLE('g.user_id')})`,args:[...role.args,user.id,token||'']}};
}
function requireAdmin(ctx){if(!ctx.user.is_admin)ctx.helpers.fail(403,'ADMIN_REQUIRED','摂政の任命・解任は、太政大臣だけが行えます。');}
async function checkAccess(ctx,guard){
 await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);
 if(!await S(ctx.db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args).first())ctx.helpers.fail(409,'REGENT_ACCESS_CHANGED','太政大臣の利用資格が変わりました。最新の接続状態を確認してください。');
}
function queryOptions(ctx){
 const q=(ctx.url.searchParams.get('q')||'').trim(),raw=ctx.url.searchParams.get('limit')||'20';
 if(q.length>80||/[\u0000-\u001f\u007f]/u.test(q)||!/^\d{1,2}$/.test(raw)||Number(raw)<1||Number(raw)>50||[...ctx.url.searchParams.keys()].some(key=>!['q','limit'].includes(key))||new Set(ctx.url.searchParams.keys()).size!==[...ctx.url.searchParams.keys()].length)ctx.helpers.fail(400,'INVALID_INPUT','領主名は80文字以内、表示件数は1〜50件で指定してください。');
 return{q,limit:Number(raw)};
}
async function directory(ctx,guard){
 const{q,limit}=queryOptions(ctx),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%',result=await ctx.db.batch([
  S(ctx.db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args),
  S(ctx.db,'SELECT revision FROM court_regency_state WHERE id=1'),
  S(ctx.db,`SELECT ${PERSON_SELECT},g.appointed_at ${PEOPLE} JOIN court_regent g ON g.user_id=u.id WHERE g.id=1`),
  S(ctx.db,`SELECT ${PERSON_SELECT} ${PEOPLE} WHERE ${TARGET} AND NOT EXISTS(SELECT 1 FROM court_regent g WHERE g.user_id=u.id)
   AND u.name LIKE ? ESCAPE '\\' ORDER BY u.name COLLATE NOCASE,u.id LIMIT ?`,pattern,limit+1)
 ]);
 if(!rows(result[0]).length){await checkAccess(ctx,guard);ctx.helpers.fail(409,'REGENT_ACCESS_CHANGED','摂政の任命情報を更新してください。');}
 const revision=Number(rows(result[1])[0]?.revision),holder=rows(result[2])[0],candidates=rows(result[3]);
 if(!Number.isSafeInteger(revision))ctx.helpers.fail(503,'SERVICE_UNAVAILABLE','摂政の任命制度を準備しています。');
 ctx.helpers.registerResponseGuard({...guard,sql:guard.sql+' AND EXISTS(SELECT 1 FROM court_regency_state WHERE id=1 AND revision=?)',args:[...guard.args,revision],code:'REGENT_ACCESS_CHANGED',message:'摂政の任命情報または太政大臣の利用資格が変わりました。一覧を更新してください。'});
 return{ok:true,canManage:true,revision,holder:holder?{...person(holder),appointedAt:Number(holder.appointed_at)}:null,candidates:candidates.slice(0,limit).map(person),query:q,hasMore:candidates.length>limit};
}
async function prior(ctx,requestId,digest){
 const found=await S(ctx.db,'SELECT * FROM court_regency_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId).first();
 if(found&&found.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の摂政の任命・解任に使われています。');
 return found;
}
async function conflict(ctx,guard,body){
 await checkAccess(ctx,guard);const revision=await S(ctx.db,'SELECT revision FROM court_regency_state WHERE id=1').first();
 if(Number(revision?.revision)!==body.expectedRevision)ctx.helpers.fail(409,'REGENT_REVISION_CONFLICT','摂政の在任状況が変わりました。一覧を更新して確認してください。');
 const holder=await S(ctx.db,'SELECT user_id FROM court_regent WHERE id=1').first();
 if(body.action==='dismiss'){
  if(holder?.user_id!==body.targetPlayerId)ctx.helpers.fail(409,'REGENT_REVISION_CONFLICT','解任対象の在任状況が変わりました。一覧を更新してください。');
 }else{
  if(holder)ctx.helpers.fail(409,'REGENT_OCCUPIED','摂政は在任中です。交代する場合は、先に現在の摂政を解任してください。');
  if(!await S(ctx.db,`SELECT u.id ${PEOPLE} WHERE u.id=? AND ${TARGET}`,body.targetPlayerId).first())ctx.helpers.fail(400,'REGENT_TARGET_REQUIRED','天皇・上皇・太政大臣以外の、一般拠点または京都御所で活動中の領主を選んでください。');
 }
}
async function operation(ctx,guard){
 const{db,user,helpers:h,now}=ctx,body=await h.readBody(ctx.request);
 if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['requestId','action','targetPlayerId','expectedRevision'].includes(key))||!['appoint','dismiss'].includes(body.action)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)h.fail(400,'INVALID_INPUT','摂政の任命または解任と、一覧の更新情報を確認してください。');
 const requestId=h.idField(body.requestId,'操作番号'),targetId=h.idField(body.targetPlayerId,'対象の領主'),digest=await h.hash(JSON.stringify([body.action,targetId,body.expectedRevision]));
 const existing=await prior(ctx,requestId,digest);if(existing)return{...await directory(ctx,guard),idempotent:true,receipt:JSON.parse(existing.result_json)};
 await conflict(ctx,guard,body);
 let targetGuard={sql:'1=1',args:[]};if(body.action==='appoint'){const target=await h.getUser(db,targetId);if(!target)h.fail(400,'REGENT_TARGET_REQUIRED','任命する領主を選んでください。');targetGuard=h.roleCommitGuard(target);}
 await h.budget(db,'court-regency:'+user.id,30,60000,now);
 const nonce=crypto.randomUUID(),args=[user.id,requestId,nonce],condition=body.action==='appoint'
  ?`NOT EXISTS(SELECT 1 FROM court_regent) AND EXISTS(SELECT 1 ${PEOPLE} WHERE u.id=? AND ${TARGET})`
  :'EXISTS(SELECT 1 FROM court_regent WHERE id=1 AND user_id=?)',receipt={action:body.action,targetPlayerId:targetId,revision:body.expectedRevision+1,appointedAt:body.action==='appoint'?now:null};
 const statements=[S(db,`INSERT INTO court_regency_requests(actor_id,request_id,action,target_id,expected_revision,request_hash,commit_token,result_json,created_at)
  SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard.sql} AND ${targetGuard.sql}
  AND EXISTS(SELECT 1 FROM court_regency_state WHERE id=1 AND revision=?) AND ${condition}
  ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,requestId,body.action,targetId,body.expectedRevision,digest,nonce,JSON.stringify(receipt),now,...guard.args,...targetGuard.args,body.expectedRevision,targetId)];
 if(body.action==='appoint')statements.push(S(db,`INSERT INTO court_regent(id,user_id,appointment_token,appointed_by,appointed_at) SELECT 1,?,?,?,? WHERE ${GATE}`,targetId,nonce,user.id,now,...args));
 else statements.push(S(db,`DELETE FROM court_regent WHERE id=1 AND user_id=? AND ${GATE}`,targetId,...args));
 const result=await db.batch(statements),accepted=await prior(ctx,requestId,digest);
 if(!accepted){await conflict(ctx,guard,body);h.fail(409,'REGENT_ACCESS_CHANGED','任命対象の状態が変わりました。一覧を更新してください。');}
 return{...await directory(ctx,guard),idempotent:!rows(result[0]).length,receipt:JSON.parse(accepted.result_json)};
}
export async function handleRegency(ctx){
 requireAdmin(ctx);await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);
 const guard=ctx.helpers.roleCommitGuard(ctx.user);
 await S(ctx.db,'INSERT INTO court_regency_state(id,revision) SELECT 1,0 WHERE '+guard.sql+' ON CONFLICT(id) DO NOTHING',...guard.args).run();
 if(ctx.method==='GET')return directory(ctx,guard);
 if(ctx.method==='POST')return operation(ctx,guard);
 ctx.helpers.fail(405,'METHOD_NOT_ALLOWED','この摂政の操作には対応していません。');
}
