// A reigning Emperor may voluntarily transfer the office to current Kyoto
// staff. The retirement title survives the predecessor's staff departure.
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=value=>value?.results||[];
const TERM="COALESCE(sm.term_id,'legacy:'||sm.appointed_at)";
const GATE='EXISTS(SELECT 1 FROM court_succession_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';

async function emperor(ctx){
 const access=await ctx.helpers.courtEmperorAuthority(ctx.db,ctx.user);
 if(!access.isCourtEmperor)ctx.helpers.fail(403,'COURT_EMPEROR_REQUIRED','皇位を譲れるのは、現在在任中の天皇本人だけです。');
 return access;
}
async function prior(ctx,requestId,digest){
 const found=await S(ctx.db,'SELECT * FROM court_succession_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId).first();
 if(found&&found.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の皇位継承に使われています。');
 return found;
}
async function respond(ctx,record,idempotent){
 const h=ctx.helpers,current=await h.getUser(ctx.db,ctx.user.id);
 await h.requireAccountAccess(ctx.db,current);
 // Successful abdication deliberately removes the old Emperor's staff term.
 // Only account access is required to return/replay the committed receipt.
 h.registerResponseGuard?.(h.accountCommitGuard(current));
 return{ok:true,idempotent,receipt:JSON.parse(record.result_json),user:h.mapUser(current,ctx.now),needsSync:true};
}
async function directory(ctx){
 const access=await emperor(ctx),result=await ctx.db.batch([
  S(ctx.db,'SELECT 1 AS allowed WHERE '+access.guard.sql,...access.guard.args),
  S(ctx.db,`SELECT u.id,u.name,${TERM} AS term_id FROM staff_members sm JOIN users u ON u.id=sm.user_id
   WHERE u.id<>? AND u.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
   AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1)
   ORDER BY u.name COLLATE NOCASE,u.id`,ctx.user.id)
 ]);
 if(!rows(result[0]).length)ctx.helpers.fail(409,'COURT_SUCCESSION_CHANGED','天皇の在任状況が変わりました。京都御所を更新してください。');
 ctx.helpers.registerResponseGuard?.(access.guard);
 return{ok:true,canAbdicate:true,candidates:rows(result[1]).map(row=>({id:row.id,name:row.name,termId:row.term_id,homeCastleId:'kyoto_gosho',homeCastleName:'京都御所'})),serverNow:new Date(ctx.now).toISOString()};
}
async function abdicate(ctx){
 const {db,user,now,helpers:h}=ctx,body=await h.readBody(ctx.request);
 if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['requestId','targetPlayerId'].includes(key)))h.fail(400,'INVALID_INPUT','次の天皇に指名する京都御所のメンバーを選んでください。');
 const requestId=h.idField(body.requestId,'操作番号'),targetId=h.idField(body.targetPlayerId,'次の天皇'),digest=await h.hash(JSON.stringify(['abdicate',targetId]));
 const existing=await prior(ctx,requestId,digest);if(existing)return respond(ctx,existing,true);
 const access=await emperor(ctx);
 if(targetId===user.id)h.fail(400,'COURT_SUCCESSOR_REQUIRED','自分以外の京都御所のメンバーを選んでください。');
 const target=await h.getUser(db,targetId);
 if(!target||target.is_admin||!target.is_staff||target.ban_active)h.fail(400,'COURT_SUCCESSOR_REQUIRED','利用中の京都御所メンバーから、次の天皇を選んでください。');
 const targetGuard=h.roleCommitGuard(target),clock=await h.getWorldClock(db,now);
 await h.budget(db,'court-succession:'+user.id,12,60000,now);
 const nonce=crypto.randomUUID(),args=[user.id,requestId,nonce];
 const receipt={retiredPlayerId:user.id,retiredPlayerName:user.name,successorPlayerId:target.id,successorPlayerName:target.name,retiredAt:now};
 const result=await db.batch([
  S(db,`INSERT INTO court_succession_requests(actor_id,request_id,target_id,request_hash,commit_token,source_appointment_token,result_json,created_at)
   SELECT ?,?,?,?,?,?,?,? WHERE ${access.guard.sql} AND ${targetGuard.sql}
   AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)
   ON CONFLICT DO NOTHING RETURNING request_id`,user.id,requestId,target.id,digest,nonce,access.token,JSON.stringify(receipt),now,...access.guard.args,...targetGuard.args,clock.id,clock.revision),
  // Record retirement before moving the crown, so office reconciliation never
  // briefly demotes the predecessor to a merit seat and removes its holder.
  S(db,`INSERT INTO court_retired_emperors(user_id,succession_id,successor_id,retired_at) SELECT ?,?,?,? WHERE ${GATE}
   ON CONFLICT(user_id) DO UPDATE SET succession_id=excluded.succession_id,successor_id=excluded.successor_id,retired_at=excluded.retired_at`,user.id,nonce,target.id,now,...args),
  S(db,`UPDATE court_leader SET user_id=?,term_id=?,appointment_token=?,appointed_by=?,updated_at=? WHERE id=1 AND ${GATE}`,target.id,target.staff_term,nonce,user.id,now,...args),
  S(db,`UPDATE staff_campaign_backups SET left_elapsed_ms=COALESCE(left_elapsed_ms,?),updated_at=? WHERE user_id=? AND active=1 AND ${GATE}`,clock.elapsedMs,now,user.id,...args),
  // Move the crown first: court_leader's staff foreign key must never cascade
  // away the newly appointed successor when the predecessor departs Kyoto.
  S(db,`DELETE FROM staff_members WHERE user_id=? AND ${GATE}`,user.id,...args)
 ]);
 const accepted=await prior(ctx,requestId,digest);
 if(!accepted){
  await h.requireAccountAccess(db,user);
  h.fail(409,'COURT_SUCCESSION_CHANGED','天皇または後継者の在任状況が変わりました。最新の一覧で確認してください。');
 }
 return respond(ctx,accepted,!rows(result[0]).length);
}
export async function handleCourtSuccession(ctx){
 await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);
 if(ctx.method==='GET')return directory(ctx);
 if(ctx.method==='POST')return abdicate(ctx);
 ctx.helpers.fail(405,'METHOD_NOT_ALLOWED','この皇位継承の操作には対応していません。');
}
