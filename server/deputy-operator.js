import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {withCourtEstateGuard} from './court-estate-guard.js';
import {ensureResidency,initialResidencyStatements} from './residency.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),R=result=>result?.results||[];
const BASE='kagoshima',ADMIN="EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)";
const GATE='EXISTS(SELECT 1 FROM deputy_role_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const iso=value=>value==null?null:new Date(Number(value)).toISOString();

async function ensureState(db){await S(db,'INSERT INTO deputy_operator_state(id) VALUES(1) ON CONFLICT(id) DO NOTHING').run();}
async function current(ctx){
  await ensureState(ctx.db);
  const {db,helpers:h,now}=ctx,state=await S(db,'SELECT * FROM deputy_operator_state WHERE id=1').first();
  const holder=state.user_id?await h.getUser(db,state.user_id):null;
  return {ok:true,revision:Number(state.revision),deputy:holder?{...h.mapUser(holder,now),appointedAt:iso(state.appointed_at),baseId:BASE,baseName:'鹿児島城'}:null};
}
async function change(ctx){
  const {db,user,request,now,helpers:h}=ctx,body=await h.readBody(request);
  await ensureState(db);
  if(!body||Object.keys(body).some(key=>!['targetPlayerId','action','requestId','expectedRevision'].includes(key))||!['appoint','dismiss'].includes(body.action)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)h.fail(400,'INVALID_INPUT','サブ運営の任命・解雇と確認済みの更新番号を指定してください。');
  const targetId=h.idField(body.targetPlayerId,'対象の領主'),requestId=h.idField(body.requestId,'操作番号'),appoint=body.action==='appoint';
  if(targetId===user.id)h.fail(400,'INVALID_TARGET','運営本人をサブ運営には変更できません。');
  const digest=await h.hash(JSON.stringify([targetId,body.action,body.expectedRevision]));
  const prior=async()=>{const row=await S(db,'SELECT request_hash FROM deputy_role_requests WHERE actor_id=? AND request_id=? AND '+ADMIN,user.id,requestId,user.id).first();if(row&&row.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の任命・解雇に使われています。');return row;};
  const respond=async idempotent=>({...await current(ctx),action:body.action,idempotent});
  if(await prior())return respond(true);
  const target=await h.getUser(db,targetId);if(!target)h.fail(404,'PLAYER_NOT_FOUND','対象の領主が見つかりません。');
  if(target.is_admin)h.fail(400,'INVALID_TARGET','運営本人をサブ運営には変更できません。');
  if(appoint&&(target.is_staff||target.ban_active||target.expulsion_pending))h.fail(409,'DEPUTY_TARGET_INELIGIBLE','京都御所の役職・BAN・追放後の拠点未選択を解消してから任命してください。');
  const state=await S(db,'SELECT * FROM deputy_operator_state WHERE id=1').first();
  if(Number(state.revision)!==body.expectedRevision||appoint&&state.user_id||!appoint&&state.user_id!==targetId)h.fail(409,'DEPUTY_CHANGED',appoint?'現在のサブ運営を解雇してから、新しいサブ運営を任命してください。':'サブ運営の在任状況が変わりました。最新の状態を確認してください。');
  await ensureResidency(db,now);
  const clock=await h.getWorldClock(db,now),row=appoint?await h.ensureStaffCampaign(db,target,now,clock):await h.getSyncRow(db,targetId);if(!row?.save_json)h.fail(409,'DEPUTY_SAVE_REQUIRED','ゲームを開始し、進行を同期済みの領主を選んでください。');
  const raw=JSON.parse(row.save_json);
  const busy=await S(db,"SELECT 1 AS found FROM battle_marches WHERE actor_id=? AND status='marching' UNION ALL SELECT 1 FROM covert_states WHERE actor_id=? AND json_array_length(state_json,'$.dispatches')>0 LIMIT 1",targetId,targetId).first();
  if(busy||raw.state?.march)h.fail(409,'ARMY_MARCHING','対象の領主の進軍・派遣部隊が帰還してから、任命・解雇してください。');
  await h.budget(db,'deputy-role:'+user.id,30,60000,now);
  const backup=await S(db,'SELECT * FROM deputy_campaign_backups WHERE user_id=?',targetId).first();
  const member=await S(db,'SELECT * FROM castle_residents WHERE user_id=?',targetId).first();
  const originalHome=appoint?member?.castle_id||raw.state.home:backup?.original_home;
  const nonce=crypto.randomUUID(),targetRole=appoint?h.roleCommitGuard(target):{sql:"EXISTS(SELECT 1 FROM deputy_operator_state WHERE user_id=? AND term_id=?)",args:[targetId,target.deputy_term]},actorRole=h.roleCommitGuard(user);
  const future={...target,is_deputy:appoint?1:0,deputy_term:appoint?nonce:null,deputy_return_home:originalHome};
  const normalized=h.normalizeGameSave(raw,target,now,{reading:true,clock});
   const courtEstate=await h.courtEstateContext(db,target,normalized,clock,now);
   Object.assign(targetRole,withCourtEstateGuard(targetRole,courtEstate));
   const engine=GameEngine.fromSave(normalized,GAME_OFFICERS,{isDeputy:appoint,deputyReturnHome:originalHome,courtEstateProjection:courtEstate.projection});
  if(!appoint&&backup){const old=JSON.parse(backup.save_json).state.castles[engine.state.home],home=engine.state.castles[engine.state.home];if(old)for(const key of ['wall','level'])home[key]=Math.min(key==='level'?engine.castleLevelLimit(engine.state.home):32,Math.max(home[key],old[key]));}
  const save=h.normalizeGameSave(JSON.parse(engine.exportSave()),future,now,{reading:true,clock});save.savedAt=iso(now);save.state.realtime.running=clock.running&&!save.state.gameOver;
  const receipt={targetPlayerId:targetId,action:body.action,revision:body.expectedRevision+1,homeCastleId:save.state.home,createdAt:iso(now)};
  const gateArgs=[user.id,requestId,nonce],targetEligibility=appoint?"NOT EXISTS(SELECT 1 FROM staff_members WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id=? AND active=1) AND NOT EXISTS(SELECT 1 FROM player_expulsions WHERE user_id=? AND pending=1)":"1=1";
  const statements=[S(db,`INSERT INTO deputy_role_requests(actor_id,request_id,target_id,action,request_hash,commit_token,result_json,created_at)
    SELECT ?,?,?,?,?,?,?,? FROM deputy_operator_state ds JOIN player_saves ps ON ps.user_id=?
    WHERE ds.id=1 AND ds.revision=? AND COALESCE(ds.user_id,'')=? AND ps.revision=? AND ps.save_json IS NOT NULL AND ${actorRole.sql} AND ${targetRole.sql} AND ${targetEligibility}
    AND NOT EXISTS(SELECT 1 FROM battle_marches WHERE actor_id=? AND status='marching') AND NOT EXISTS(SELECT 1 FROM covert_states WHERE actor_id=? AND json_array_length(state_json,'$.dispatches')>0)
    ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,requestId,targetId,body.action,digest,nonce,JSON.stringify(receipt),now,targetId,body.expectedRevision,state.user_id||'',row.revision,...actorRole.args,...targetRole.args,...(appoint?[targetId,targetId,targetId]:[]),targetId,targetId),
    S(db,`UPDATE deputy_operator_state SET user_id=?,term_id=?,revision=revision+1,appointed_by=?,appointed_at=?,updated_at=? WHERE id=1 AND ${GATE}`,appoint?targetId:null,appoint?nonce:null,appoint?user.id:null,appoint?now:null,now,...gateArgs),
    ...(appoint?[S(db,`INSERT INTO deputy_campaign_backups(user_id,term_id,original_home,save_json,active,updated_at) SELECT ?,?,?,?,1,? WHERE ${GATE} ON CONFLICT(user_id) DO UPDATE SET term_id=excluded.term_id,original_home=excluded.original_home,save_json=excluded.save_json,active=1,updated_at=excluded.updated_at`,targetId,nonce,originalHome,JSON.stringify(normalized),now,...gateArgs)]:[S(db,`UPDATE deputy_campaign_backups SET active=0,updated_at=? WHERE user_id=? AND ${GATE}`,now,targetId,...gateArgs)]),
    S(db,`UPDATE castle_seats SET lord_user_id=NULL,lord_epoch=lord_epoch+1,revision=revision+1 WHERE lord_user_id=? AND ${GATE}`,targetId,...gateArgs),
    S(db,`DELETE FROM castle_residents WHERE user_id=? AND ${GATE}`,targetId,...gateArgs),
    S(db,`UPDATE castle_residency_meta SET revision=revision+1 WHERE id=1 AND ${GATE}`,...gateArgs),
    S(db,`UPDATE player_saves SET save_json=?,revision=revision+1,cycle_home=?,updated_at=?,cycle_commit=?,writer_device_id=NULL,writer_device_name=NULL,lease_expires_at=0 WHERE user_id=? AND ${GATE}`,JSON.stringify(save),save.state.home,now,nonce,targetId,...gateArgs)
  ];
  if(!appoint)statements.push(...await initialResidencyStatements(db,{user:future,save,now,gateSql:GATE,gateArgs}));
  const result=await db.batch(statements);
  if(!R(result[0]).length){h.requireAdmin(await h.getUser(db,user.id));if(await prior())return respond(true);h.fail(409,'DEPUTY_CHANGED','役職・拠点・保存が更新されました。最新の状態を確認してください。');}
  return respond(false);
}

export async function handleDeputyOperator(ctx){
  const {helpers:h}=ctx;h.requireAdmin(await h.getUser(ctx.db,ctx.user.id));
  if(ctx.method==='GET')return current(ctx);
  if(ctx.method==='POST')return change(ctx);
  h.fail(404,'NOT_FOUND','そのサブ運営操作は見つかりませんでした。');
}
