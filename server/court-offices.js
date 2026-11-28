// External court offices are appointments, never account or staff privileges.
// A revision binds each confirmation to the complete six-seat directory.
import {courtEstateSnapshotStatements} from './court-estate-ledger.js';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=value=>value?.results||[];
export const COURT_OFFICES=Object.freeze([
 {id:'sangi',title:'参議',minMerit:0},{id:'chunagon',title:'中納言',minMerit:50},
 {id:'dainagon',title:'大納言',minMerit:200},{id:'naidaijin',title:'内大臣',minMerit:500},
 {id:'udaijin',title:'右大臣',minMerit:1000},{id:'sadaijin',title:'左大臣',minMerit:2000}
]);
const HOME="CASE WHEN json_valid(ps.save_json) THEN json_extract(ps.save_json,'$.state.home') END";
const TARGET=`NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id)
 AND u.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1)
 AND NOT EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=u.id)
 AND ${HOME} IS NOT NULL AND ${HOME} NOT IN ('edo','kyoto_gosho')`;
const GATE='EXISTS(SELECT 1 FROM court_office_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const castleName=id=>globalThis.SENGOKU_DATA?.castles?.find(c=>c.id===id)?.name||id;
const person=row=>({id:row.user_id||row.id,name:row.name,homeCastleId:row.home,homeCastleName:castleName(row.home)});
function requireAdmin(ctx){if(!ctx.user.is_admin)ctx.helpers.fail(403,'ADMIN_REQUIRED','太政官の任命・解任は、運営の太政大臣だけが行えます。');}
function queryOptions(ctx){
 const q=(ctx.url.searchParams.get('q')||'').normalize('NFC').trim(),raw=ctx.url.searchParams.get('limit')||'20';
 if(q.length>80||/[\u0000-\u001f\u007f]/u.test(q)||!/^\d{1,2}$/.test(raw)||Number(raw)<1||Number(raw)>50)ctx.helpers.fail(400,'INVALID_INPUT','領主名は80文字以内、表示件数は1〜50件で指定してください。');
 return{q,limit:Number(raw)};
}
async function checkAccess(ctx,access){
 await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);
 if(!await stmt(ctx.db,'SELECT 1 AS allowed WHERE '+access.guard.sql,...access.guard.args).first())ctx.helpers.fail(409,'COURT_ACCESS_CHANGED','太政大臣の利用資格が変わりました。最新の状態を確認してください。');
}
async function directory(ctx,access){
 requireAdmin(ctx);const {q,limit}=queryOptions(ctx),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
 const result=await ctx.db.batch([
  stmt(ctx.db,'SELECT 1 AS allowed WHERE '+access.guard.sql,...access.guard.args),
  stmt(ctx.db,`/* court-offices-directory */ SELECT s.revision,u.id,u.name FROM court_office_state s LEFT JOIN settings a ON a.key='adminUserId' LEFT JOIN users u ON u.id=a.value WHERE s.id=1`),
  stmt(ctx.db,`SELECT a.office_id,a.user_id,u.name,a.appointment_token,${HOME} AS home FROM court_external_offices a JOIN users u ON u.id=a.user_id JOIN player_saves ps ON ps.user_id=u.id ORDER BY a.office_id`),
  stmt(ctx.db,'SELECT DISTINCT office_id FROM court_kyoto_offices'),
  stmt(ctx.db,`SELECT u.id,u.name,${HOME} AS home,a.office_id FROM users u JOIN player_saves ps ON ps.user_id=u.id LEFT JOIN court_external_offices a ON a.user_id=u.id WHERE ${TARGET} AND u.name LIKE ? ESCAPE '\\' ORDER BY u.name COLLATE NOCASE,u.id LIMIT ?`,pattern,limit+1)
 ]);
 if(!rows(result[0]).length){await checkAccess(ctx,access);ctx.helpers.fail(409,'COURT_ACCESS_CHANGED','太政官の一覧を更新してください。');}
 const snapshot=rows(result[1])[0],holders=new Map(rows(result[2]).map(row=>[row.office_id,row])),kyoto=new Set(rows(result[3]).map(row=>row.office_id)),found=rows(result[4]);
 if(!snapshot)ctx.helpers.fail(503,'SERVICE_UNAVAILABLE','太政官の任命制度を準備しています。');
 access.guard={sql:access.guard.sql+' AND EXISTS(SELECT 1 FROM court_office_state WHERE id=1 AND revision=?)',args:[...access.guard.args,Number(snapshot.revision)]};
 return{ok:true,revision:Number(snapshot.revision),canManage:true,chancellor:{id:snapshot.id,name:snapshot.name,title:'太政大臣',fixed:true},
  offices:COURT_OFFICES.map(definition=>{const holder=holders.get(definition.id),blockedByKyoto=kyoto.has(definition.id);return{id:definition.id,title:definition.title,available:!blockedByKyoto&&!holder,blockedByKyoto,holder:holder?person(holder):null,appointmentToken:holder?.appointment_token||null};}),
  candidates:found.slice(0,limit).map(row=>({...person(row),officeId:row.office_id||null,courtOffice:row.office_id?{id:row.office_id,title:COURT_OFFICES.find(def=>def.id===row.office_id).title}:null})),query:q,hasMore:found.length>limit};
}
async function prior(ctx,requestId,digest){
 const found=await stmt(ctx.db,'SELECT * FROM court_office_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId).first();
 if(found&&found.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の太政官の操作に使われています。');return found;
}
async function conflict(ctx,access,body){
 const {db,helpers:h}=ctx;await checkAccess(ctx,access);
 const revision=await stmt(db,'SELECT revision FROM court_office_state WHERE id=1').first();
 if(Number(revision?.revision)!==body.expectedRevision)h.fail(409,'COURT_OFFICES_CHANGED','官職の在任状況が変わりました。一覧を更新して、もう一度確認してください。');
 const blocked=await stmt(db,'SELECT 1 AS occupied FROM court_kyoto_offices WHERE office_id=?',body.officeId).first();
 if(blocked)h.fail(409,'COURT_OFFICE_KYOTO_CONFLICT','この官職は京都御所のメンバーが在任中です。別の官職を選んでください。');
 const holder=await stmt(db,'SELECT user_id FROM court_office_appointments WHERE office_id=?',body.officeId).first();
 if(body.action==='dismiss'){
  if(holder?.user_id!==body.targetPlayerId)h.fail(409,'COURT_OFFICES_CHANGED','解任対象の在任状況が変わりました。一覧を更新してください。');
 }else{
  if(holder)h.fail(409,'COURT_OFFICE_OCCUPIED','この官職は在任中です。交代する場合は、先に現在の任命を解任してください。');
  if(!await stmt(db,`SELECT u.id FROM users u JOIN player_saves ps ON ps.user_id=u.id WHERE u.id=? AND ${TARGET}`,body.targetPlayerId).first())h.fail(400,'COURT_OFFICE_TARGET_REQUIRED','京都御所以外の拠点で活動中の、利用停止中ではない領主を選んでください。');
  if(await stmt(db,'SELECT office_id FROM court_office_appointments WHERE user_id=?',body.targetPlayerId).first())h.fail(409,'COURT_OFFICE_ALREADY_HELD','この領主は別の太政官に在任中です。先に現在の任命を解任してください。');
 }
}
async function operation(ctx,access){
 requireAdmin(ctx);const {db,user,now,helpers:h}=ctx,body=await h.readBody(ctx.request);
 if(Object.keys(body).some(key=>!['requestId','action','officeId','targetPlayerId','expectedRevision'].includes(key))||!['appoint','dismiss'].includes(body.action))h.fail(400,'INVALID_INPUT','任命または解任を指定してください。');
 if(['chancellor','daijodaijin','太政大臣','emperor','天皇'].includes(body.officeId))h.fail(400,'COURT_OFFICE_FIXED','太政大臣は運営の固定地位です。天皇は京都御所の専用任命から変更してください。');
 if(!COURT_OFFICES.some(def=>def.id===body.officeId)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)h.fail(400,'INVALID_INPUT','官職と一覧の更新情報を確認してください。');
 const requestId=h.idField(body.requestId,'操作番号'),targetId=h.idField(body.targetPlayerId,'対象の領主'),digest=await h.hash(JSON.stringify([body.action,body.officeId,targetId,body.expectedRevision]));
 let committed=false;if(!await prior(ctx,requestId,digest)){
  await conflict(ctx,access,body);let targetGuard={sql:'1=1',args:[]};
  if(body.action==='appoint'){
   const target=await h.getUser(db,targetId);if(!target||target.is_admin||target.is_staff||target.ban_active)h.fail(400,'COURT_OFFICE_TARGET_REQUIRED','京都御所以外の拠点の領主を選んでください。');targetGuard=h.roleCommitGuard(target);
  }
  await h.budget(db,'court-offices:'+user.id,30,60000,now);
  const nonce=crypto.randomUUID(),args=[user.id,requestId,nonce],condition=body.action==='appoint'
   ?`NOT EXISTS(SELECT 1 FROM court_office_appointments WHERE office_id=? OR user_id=?) AND NOT EXISTS(SELECT 1 FROM court_kyoto_offices WHERE office_id=?) AND EXISTS(SELECT 1 FROM users u JOIN player_saves ps ON ps.user_id=u.id WHERE u.id=? AND ${TARGET})`
   :'EXISTS(SELECT 1 FROM court_office_appointments WHERE office_id=? AND user_id=?)';
  const conditions=body.action==='appoint'?[body.officeId,targetId,body.officeId,targetId]:[body.officeId,targetId];
  const statements=[stmt(db,`INSERT INTO court_office_requests(actor_id,request_id,action,office_id,target_id,expected_revision,request_hash,commit_token,created_at)
   SELECT ?,?,?,?,?,?,?,?,? WHERE ${access.guard.sql} AND ${targetGuard.sql} AND EXISTS(SELECT 1 FROM court_office_state WHERE id=1 AND revision=?) AND ${condition}
   ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,requestId,body.action,body.officeId,targetId,body.expectedRevision,digest,nonce,now,...access.guard.args,...targetGuard.args,body.expectedRevision,...conditions)];
  if(body.action==='appoint')statements.push(stmt(db,`INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) SELECT ?,?,?,?,? WHERE ${GATE}`,body.officeId,targetId,nonce,user.id,now,...args));
  else statements.push(stmt(db,`DELETE FROM court_office_appointments WHERE office_id=? AND user_id=? AND ${GATE}`,body.officeId,targetId,...args));
  statements.push(...courtEstateSnapshotStatements(db,await h.getWorldClock(db,now),GATE,args));
  const result=await db.batch(statements);committed=!!rows(result[0]).length;
  if(!committed&&!await prior(ctx,requestId,digest)){await conflict(ctx,access,body);h.fail(409,'COURT_OFFICES_CHANGED','任命対象の状態が変わりました。一覧を更新してください。');}
 }
 return{...await directory(ctx,access),idempotent:!committed};
}
export async function handleCourtOffices(ctx,access){
 requireAdmin(ctx);
 // The deployment migration is schema-only. Initialize the singleton through
 // the ordinary authenticated runtime before any appointment can be created.
 await stmt(ctx.db,'INSERT INTO court_office_state(id,revision) VALUES(1,0) ON CONFLICT(id) DO NOTHING').run();
 if(ctx.method==='GET')return directory(ctx,access);
 if(ctx.method==='POST')return operation(ctx,access);
 ctx.helpers.fail(405,'METHOD_NOT_ALLOWED','この操作には対応していません。');
}
