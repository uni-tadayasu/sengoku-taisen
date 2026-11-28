// The Emperor nominates a current Kyoto member; only the Chancellor can
// certify that nomination and atomically perform the completed abdication.
import {courtEstateSnapshotStatements} from './court-estate-ledger.js';
import {courtImperialCandidateSql,courtImperialMemberTermSql,courtImperialMemberTerm,isCourtImperialFamily,courtImperialAdmissionStatement} from './court-lineage.js';
import {courtRetirementCapacity,retiredEmperorVacancySql} from './retirement.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=value=>value?.results||[];
const TERM="COALESCE(sm.term_id,'legacy:'||sm.appointed_at)";
const GATE='EXISTS(SELECT 1 FROM court_succession_nomination_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const SOURCE_VALID=n=>`EXISTS(SELECT 1 FROM court_leader l JOIN staff_members sm ON sm.user_id=l.user_id WHERE l.id=1 AND l.user_id=${n}.emperor_id AND l.appointment_token=${n}.source_appointment_token AND l.term_id=${n}.source_staff_term AND ${TERM}=${n}.source_staff_term)
 AND ${n}.emperor_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=${n}.emperor_id AND b.active=1)
 AND COALESCE((SELECT revision FROM player_bans b WHERE b.user_id=${n}.emperor_id),0)=${n}.source_moderation_epoch
 AND NOT EXISTS(SELECT 1 FROM court_succession_requests r WHERE r.source_appointment_token=${n}.source_appointment_token)`;
const TARGET_VALID=n=>`${courtImperialCandidateSql(`${n}.successor_id`,`${n}.target_staff_term`)}
 AND ${n}.successor_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=${n}.successor_id AND b.active=1)
 AND COALESCE((SELECT revision FROM player_bans b WHERE b.user_id=${n}.successor_id),0)=${n}.target_moderation_epoch`;
const VALID=n=>`${n}.invalidated_reason IS NULL AND ${SOURCE_VALID(n)} AND ${TARGET_VALID(n)}`;
const SELECT=`SELECT n.*,u.name AS resolver_name,CASE WHEN n.status='pending' THEN
 CASE WHEN ${retiredEmperorVacancySql('n.emperor_id','n.successor_id')} THEN '{"kind":"retired-emperor","title":"上皇"}' ELSE '{"kind":"imperial","title":"皇族"}' END
 ELSE (SELECT json_extract(r.result_json,'$.retirement') FROM court_succession_nomination_requests r WHERE r.nomination_id=n.id AND r.action='approve' LIMIT 1) END AS retirement_json FROM court_succession_nominations n LEFT JOIN users u ON u.id=n.resolved_by`;
const iso=value=>new Date(Number(value)).toISOString();
const ACCESS_MESSAGE='皇位継承の利用資格が変わりました。最新の京都御所を確認してください。';
const dto=row=>({id:row.id,status:row.status,revision:Number(row.revision),emperor:{id:row.emperor_id,name:row.emperor_name},successor:{id:row.successor_id,name:row.successor_name},nominatedAt:Number(row.nominated_at),resolvedAt:row.resolved_at===null?null:Number(row.resolved_at),resolvedBy:row.resolved_by?{id:row.resolved_by,name:row.resolver_name}:null,reason:row.reason||null,retirement:row.retirement_json?JSON.parse(row.retirement_json):null});

export async function settleCourtSuccessionNominations(db,now){
 await S(db,`UPDATE court_succession_nominations AS n SET status='invalidated',revision=revision+1,resolved_at=MAX(?,nominated_at),resolved_by=NULL,
  reason=COALESCE(invalidated_reason,CASE WHEN NOT (${SOURCE_VALID('n')}) THEN 'emperor_changed' ELSE 'successor_changed' END)
  WHERE status='pending' AND NOT (${VALID('n')})`,now).run();
}
async function emperor(ctx){
 const access=await ctx.helpers.courtEmperorAuthority(ctx.db,ctx.user);
 if(!access.isCourtEmperor)ctx.helpers.fail(403,'COURT_EMPEROR_REQUIRED','次の天皇を指名できるのは、現在在任中の天皇本人だけです。');
 return access;
}
function admin(ctx){
 if(!ctx.user.is_admin)ctx.helpers.fail(403,'ADMIN_REQUIRED','皇位継承を認証・却下できるのは、太政大臣だけです。');
 return ctx.helpers.roleCommitGuard(ctx.user);
}
async function checkAccess(ctx,guard){
 await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);
 if(!await S(ctx.db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args).first())ctx.helpers.fail(409,'COURT_SUCCESSION_ACCESS_CHANGED',ACCESS_MESSAGE);
}
function register(ctx,guard,records=[]){
 const checks=records.map(row=>({sql:'EXISTS(SELECT 1 FROM court_succession_nominations WHERE id=? AND revision=? AND status=? AND invalidated_reason IS ?)',args:[row.id,row.revision,row.status,row.invalidated_reason]}));
 ctx.helpers.registerResponseGuard?.({sql:[guard.sql,...checks.map(c=>c.sql)].join(' AND '),args:[...guard.args,...checks.flatMap(c=>c.args)],code:'COURT_SUCCESSION_ACCESS_CHANGED',message:ACCESS_MESSAGE});
}
function bodyKeys(body,allowed,h){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key)))h.fail(400,'INVALID_INPUT','皇位継承の送信内容を確認してください。');}
function token(value,label,h){if(typeof value!=='string'||!value||value.length>150||/[\u0000-\u001F\u007F-\u009F]/u.test(value))h.fail(400,'INVALID_INPUT',label+'の在任情報を確認してください。');return value;}
async function prior(ctx,requestId,digest){
 const found=await S(ctx.db,'SELECT * FROM court_succession_nomination_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId).first();
 if(found&&found.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の皇位継承の操作に使われています。');
 return found;
}
async function nomination(ctx,id){const found=await S(ctx.db,SELECT+' WHERE n.id=?',id).first();if(!found)ctx.helpers.fail(404,'COURT_SUCCESSION_NOT_FOUND','この皇位継承の指名は見つかりませんでした。');return found;}
async function respond(ctx,record,idempotent,guard=null){
 await settleCourtSuccessionNominations(ctx.db,ctx.now);
 const row=await nomination(ctx,record.nomination_id),h=ctx.helpers;
 // The author can recover their immutable receipt after certification removed
 // their crown and staff term. This exposes only their own nomination.
 if(!guard){const current=await h.getUser(ctx.db,ctx.user.id);await h.requireAccountAccess(ctx.db,current);guard=h.accountCommitGuard(current);}
 await checkAccess(ctx,guard);register(ctx,guard,[row]);
 return{ok:true,idempotent,receipt:JSON.parse(record.result_json),nomination:dto(row),needsSync:false,serverNow:iso(ctx.now)};
}
async function legacy(ctx,requestId,targetId){
 const h=ctx.helpers,record=await S(ctx.db,'SELECT * FROM court_succession_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId).first();
 if(!record)return null;
 const digest=await h.hash(JSON.stringify(['abdicate',targetId]));
 if(record.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の皇位継承に使われています。');
 const current=await h.getUser(ctx.db,ctx.user.id);await h.requireAccountAccess(ctx.db,current);register(ctx,h.accountCommitGuard(current));
 return{ok:true,idempotent:true,legacy:true,status:'legacy-approved',receipt:JSON.parse(record.result_json),user:h.mapUser(current,ctx.now),needsSync:true};
}
async function directory(ctx,isAdmin){
 const access=isAdmin?{guard:admin(ctx)}:await emperor(ctx);
 await checkAccess(ctx,access.guard);await settleCourtSuccessionNominations(ctx.db,ctx.now);
 const owner=isAdmin?{sql:'1=1',args:[]}:{sql:'n.emperor_id=?',args:[ctx.user.id]},result=await ctx.db.batch([
  S(ctx.db,'SELECT 1 AS allowed WHERE '+access.guard.sql,...access.guard.args),
  S(ctx.db,SELECT+` WHERE n.status='pending' AND ${owner.sql} ORDER BY n.nominated_at,n.id`,...owner.args),
  S(ctx.db,SELECT+` WHERE n.status<>'pending' AND ${owner.sql} ORDER BY n.nominated_at DESC,n.id DESC LIMIT 21`,...owner.args),
  ...(!isAdmin?[S(ctx.db,`SELECT u.id,u.name,${courtImperialMemberTermSql('u.id')} AS term_id,cl.imperial_house_name,
   CASE WHEN sm.user_id IS NOT NULL THEN 'kyoto' ELSE 'retained-base' END AS member_kind,
   CASE WHEN EXISTS(SELECT 1 FROM court_retirement_holders rh WHERE rh.user_id=u.id) THEN 'sento_gosho' WHEN sm.user_id IS NOT NULL THEN 'kyoto_gosho' ELSE cm.base_id END AS home
   FROM users u LEFT JOIN staff_members sm ON sm.user_id=u.id LEFT JOIN court_retained_memberships cm ON cm.user_id=u.id LEFT JOIN court_lineages cl ON cl.user_id=u.id
   WHERE u.id<>? AND u.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
   AND ${courtImperialCandidateSql('u.id')}
   AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1) ORDER BY u.name COLLATE NOCASE,u.id`,ctx.user.id)]:[])
 ]);
 if(!rows(result[0]).length){await checkAccess(ctx,access.guard);ctx.helpers.fail(409,'COURT_SUCCESSION_ACCESS_CHANGED',ACCESS_MESSAGE);}
 const pending=rows(result[1]),history=rows(result[2]),shown=history.slice(0,20);register(ctx,access.guard,[...pending,...shown]);
 const capacity=await courtRetirementCapacity(ctx.db),retirementPreview=pending[0]?.retirement_json?JSON.parse(pending[0].retirement_json):capacity.shared.available?{kind:'retired-emperor',title:'上皇'}:{kind:'imperial',title:'皇族'},common={ok:true,approvalRequired:true,capacity,retirementPreview,history:shown.map(dto),historyHasMore:history.length>20,serverNow:iso(ctx.now)};
 if(isAdmin)return{...common,canApprove:true,pending:pending.map(dto)};
 return{...common,canNominate:true,canAbdicate:false,sourceAppointmentToken:access.token,pending:pending[0]?dto(pending[0]):null,candidates:rows(result[3]).map(row=>({id:row.id,name:row.name,termId:row.term_id,memberKind:row.member_kind,imperialHouseName:row.imperial_house_name||null,homeCastleId:row.home,homeCastleName:globalThis.SENGOKU_DATA.castles.find(c=>c.id===row.home)?.name||row.home}))};
}
async function nominate(ctx){
 const{db,user,now,helpers:h}=ctx,body=await h.readBody(ctx.request);
 bodyKeys(body,['requestId','targetPlayerId','targetTermId','sourceAppointmentToken'],h);
 const requestId=h.idField(body.requestId,'操作番号'),targetId=h.idField(body.targetPlayerId,'次の天皇');
 if(!Object.hasOwn(body,'targetTermId')&&!Object.hasOwn(body,'sourceAppointmentToken')){
  const historical=await legacy(ctx,requestId,targetId);if(historical)return historical;
  await emperor(ctx);
  h.fail(400,'COURT_SUCCESSION_APPROVAL_REQUIRED','皇位継承には太政大臣の認証が必要です。最新の画面で後継者を指名してください。');
 }
 const sourceToken=token(body.sourceAppointmentToken,'天皇',h),targetTerm=token(body.targetTermId,'後継者',h),digest=await h.hash(JSON.stringify(['nominate',targetId,targetTerm,sourceToken])),existing=await prior(ctx,requestId,digest);
 if(existing)return respond(ctx,existing,true);
 if(await S(db,'SELECT 1 AS used FROM court_succession_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first())h.fail(409,'REQUEST_ID_REUSED','この操作番号は完了済みの皇位継承に使われています。');
 const access=await emperor(ctx);await checkAccess(ctx,access.guard);await settleCourtSuccessionNominations(db,now);
 if(sourceToken!==access.token)h.fail(409,'COURT_SUCCESSION_CHANGED','天皇の在任情報が変わりました。最新の一覧を確認してください。');
 if(targetId===user.id)h.fail(400,'COURT_SUCCESSOR_REQUIRED','自分以外の、京都御所に正式加入している皇族を選んでください。');
 const target=await h.getUser(db,targetId);
 if(!target||target.is_admin||!courtImperialMemberTerm(target)||target.ban_active)h.fail(400,'COURT_SUCCESSOR_REQUIRED','京都御所に正式加入している皇族から、次の天皇を選んでください。');
 if(!isCourtImperialFamily(target))h.fail(400,'COURT_IMPERIAL_FAMILY_REQUIRED','天皇になるには皇族であることが必要です。宮家を創立した皇族を選んでください。');
 if(courtImperialMemberTerm(target)!==targetTerm)h.fail(409,'COURT_SUCCESSION_CHANGED','後継者の在任情報が変わりました。最新の候補を確認してください。');
 if(await S(db,"SELECT 1 AS pending FROM court_succession_nominations WHERE status='pending'").first())h.fail(409,'COURT_SUCCESSION_PENDING','太政大臣の認証待ちの指名があります。取り消すか、認証・却下を待ってください。');
 await h.budget(db,'court-succession:'+user.id,12,60000,now);
 const targetGuard=h.roleCommitGuard(target),id=h.uid('csn_'),nonce=crypto.randomUUID(),args=[user.id,requestId,nonce],receipt={action:'nominate',nominationId:id,targetPlayerId:targetId,revision:0,status:'pending',nominatedAt:now,resolvedAt:null};
 const result=await db.batch([
  S(db,`INSERT INTO court_succession_nomination_requests(actor_id,request_id,nomination_id,action,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,'nominate',?,?,?,? WHERE ${access.guard.sql} AND ${targetGuard.sql} AND ${courtImperialCandidateSql('?', '?')}
   AND NOT EXISTS(SELECT 1 FROM court_succession_nominations WHERE status='pending')
   AND NOT EXISTS(SELECT 1 FROM court_succession_requests WHERE source_appointment_token=?)
   ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,requestId,id,digest,nonce,JSON.stringify(receipt),now,...access.guard.args,...targetGuard.args,targetId,targetId,targetId,targetId,targetId,targetId,targetTerm,sourceToken),
  S(db,`INSERT INTO court_succession_nominations(id,emperor_id,emperor_name,successor_id,successor_name,source_appointment_token,source_staff_term,target_staff_term,source_moderation_epoch,target_moderation_epoch,status,nominated_at)
   SELECT ?,?,?,?,?,?,?,?,?,?,'pending',? WHERE ${GATE}`,id,user.id,user.name,target.id,target.name,sourceToken,user.staff_term,targetTerm,Number(user.moderation_epoch||0),Number(target.moderation_epoch||0),now,...args)
 ]),accepted=await prior(ctx,requestId,digest);
 if(!accepted){await checkAccess(ctx,access.guard);await settleCourtSuccessionNominations(db,now);if(await S(db,"SELECT 1 AS pending FROM court_succession_nominations WHERE status='pending'").first())h.fail(409,'COURT_SUCCESSION_PENDING','太政大臣の認証待ちの指名があります。最新の一覧を確認してください。');h.fail(409,'COURT_SUCCESSION_CHANGED','後継者または天皇の在任状況が変わりました。最新の候補を確認してください。');}
 return respond(ctx,accepted,!rows(result[0]).length);
}
async function decide(ctx,id,action){
 const{db,user,now,helpers:h}=ctx,isAdmin=action!=='cancel',initialGuard=isAdmin?admin(ctx):null,body=await h.readBody(ctx.request);
 bodyKeys(body,['requestId','expectedRevision'],h);const requestId=h.idField(body.requestId,'操作番号');
 if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)h.fail(400,'INVALID_INPUT','指名の更新番号を確認してください。');
 const digest=await h.hash(JSON.stringify([action,id,body.expectedRevision])),existing=await prior(ctx,requestId,digest);
 if(existing)return respond(ctx,existing,true,initialGuard);
 const access=isAdmin?{guard:initialGuard}:await emperor(ctx);await checkAccess(ctx,access.guard);await settleCourtSuccessionNominations(db,now);
 const row=await nomination(ctx,id);
 if(!isAdmin&&row.emperor_id!==user.id)h.fail(403,'COURT_EMPEROR_REQUIRED','自分が行った皇位継承の指名だけを取り消せます。');
 if(row.status!=='pending'||Number(row.revision)!==body.expectedRevision)h.fail(409,'COURT_SUCCESSION_REVISION_CONFLICT','指名の状態が変わりました。最新の記録を確認してください。');
 const clock=action==='approve'?await h.getWorldClock(db,now):null;
 await h.budget(db,'court-succession-review:'+user.id,20,60000,now);
 const nonce=crypto.randomUUID(),args=[user.id,requestId,nonce],status={approve:'approved',reject:'rejected',cancel:'cancelled'}[action],receipt={action,nominationId:id,targetPlayerId:row.successor_id,revision:body.expectedRevision+1,status,nominatedAt:Number(row.nominated_at),resolvedAt:now};
 const statements=[
  S(db,`INSERT INTO court_succession_nomination_requests(actor_id,request_id,nomination_id,action,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,?,?,?,${action==='approve'?`json_set(?,'$.retirement',json(CASE WHEN ${retiredEmperorVacancySql('n.emperor_id','n.successor_id')} THEN '{"kind":"retired-emperor","title":"上皇"}' ELSE '{"kind":"imperial","title":"皇族"}' END))`:'?'},? FROM court_succession_nominations n WHERE n.id=? AND n.status='pending' AND n.revision=? AND ${VALID('n')} AND ${access.guard.sql}
   ${clock?'AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)':''}
   ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,requestId,id,action,digest,nonce,JSON.stringify(receipt),now,id,body.expectedRevision,...access.guard.args,...(clock?[clock.id,clock.revision]:[])),
  S(db,`UPDATE court_succession_nominations SET status=?,revision=revision+1,resolved_at=?,resolved_by=?,reason=? WHERE id=? AND ${GATE}`,status,now,user.id,action==='approve'?null:status,id,...args)
 ];
 if(action==='approve'){
  const completed={retiredPlayerId:row.emperor_id,retiredPlayerName:row.emperor_name,successorPlayerId:row.successor_id,successorPlayerName:row.successor_name,retiredAt:now},completedRequest='approved_'+id,completedDigest=await h.hash(JSON.stringify(['certified',id]));
  statements.push(
   S(db,`INSERT INTO court_succession_requests(actor_id,request_id,target_id,request_hash,commit_token,source_appointment_token,result_json,created_at)
    SELECT ?,?,?,?,?,?,json_set(?,'$.retirement',json((SELECT json_extract(result_json,'$.retirement') FROM court_succession_nomination_requests WHERE actor_id=? AND request_id=?))),? WHERE ${GATE}`,row.emperor_id,completedRequest,row.successor_id,completedDigest,nonce,row.source_appointment_token,JSON.stringify(completed),user.id,requestId,now,...args),
   // Returning to the throne ends any former retired/cloistered seat. The old
   // immutable receipts remain, but only this abdication can assign a new seat.
   S(db,`DELETE FROM court_retired_emperors WHERE user_id IN (?,?) AND ${GATE}`,row.emperor_id,row.successor_id,...args),
   // Record retirement before moving the crown. This prevents the predecessor
   // briefly taking a merit seat and evicting an unrelated ordinary office.
   S(db,`INSERT INTO court_retired_emperors(user_id,succession_id,successor_id,retired_at) SELECT ?,?,?,? WHERE ${GATE}
    AND json_extract((SELECT result_json FROM court_succession_nomination_requests WHERE actor_id=? AND request_id=?),'$.retirement.kind')='retired-emperor'
    ON CONFLICT(user_id) DO UPDATE SET succession_id=excluded.succession_id,successor_id=excluded.successor_id,retired_at=excluded.retired_at`,row.emperor_id,nonce,row.successor_id,now,...args,user.id,requestId),
   courtImperialAdmissionStatement(db,row.successor_id,row.target_staff_term,user.id,now,clock.elapsedMs,GATE,args),
   S(db,`UPDATE staff_campaign_backups SET left_elapsed_ms=COALESCE(left_elapsed_ms,?),updated_at=? WHERE user_id=? AND active=1 AND ${GATE}`,clock.elapsedMs,now,row.emperor_id,...args),
   S(db,`DELETE FROM court_retained_memberships WHERE user_id=? AND ${GATE}`,row.emperor_id,...args),
   // Remove palace service before placing the successor. Its crown cascades
   // away inside this same batch, so an abdicator returning to ordinary royalty
   // cannot briefly take a merit office and evict an unrelated external holder.
   S(db,`DELETE FROM staff_members WHERE user_id=? AND ${GATE}`,row.emperor_id,...args),
   S(db,`INSERT INTO court_leader(id,user_id,term_id,appointment_token,appointed_by,updated_at) SELECT 1,?,?,?,?,? WHERE ${GATE}
    ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,term_id=excluded.term_id,appointment_token=excluded.appointment_token,appointed_by=excluded.appointed_by,updated_at=excluded.updated_at`,row.successor_id,row.target_staff_term,nonce,user.id,now,...args)
  );
  statements.push(...courtEstateSnapshotStatements(db,clock,GATE,args));
 }
 const result=await db.batch(statements),accepted=await prior(ctx,requestId,digest);
 if(!accepted){await checkAccess(ctx,access.guard);await settleCourtSuccessionNominations(db,now);h.fail(409,'COURT_SUCCESSION_CHANGED','指名・在任状況または共通時計が変わりました。最新の記録を確認してください。');}
 return respond(ctx,accepted,!rows(result[0]).length,isAdmin?access.guard:null);
}
export async function handleCourtSuccession(ctx){
 await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);
 if([...ctx.url.searchParams].length)ctx.helpers.fail(400,'INVALID_INPUT','皇位継承のURLを確認してください。');
 if(ctx.path==='/court/succession'){
  if(ctx.method==='GET')return directory(ctx,false);
  if(ctx.method==='POST')return nominate(ctx);
 }
 if(ctx.path==='/admin/court/succession'&&ctx.method==='GET')return directory(ctx,true);
 const cancellation=/^\/court\/succession\/(csn_[a-f0-9]{32})\/cancel$/.exec(ctx.path),decision=/^\/admin\/court\/succession\/(csn_[a-f0-9]{32})\/(approve|reject)$/.exec(ctx.path);
 if(ctx.method==='POST'&&(cancellation||decision))return decide(ctx,(cancellation||decision)[1],cancellation?'cancel':decision[2]);
 ctx.helpers.fail(404,'NOT_FOUND','この皇位継承の操作は見つかりませんでした。');
}
