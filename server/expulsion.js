import {ensureResidency} from './residency.js';
import {moderationExpulsion} from './expulsion-state.js';
import {closeReservations} from './relocation.js';
import {activeMarch} from './marches.js';
import {prepareRelocationProgress} from './progress.js';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {externalTroopSnapshotStatements} from './maintenance.js';

const S=(db,sql,...args)=>db.prepare(sql).bind(...args);
const ADMIN="EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)";
const GATE='EXISTS(SELECT 1 FROM expulsion_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const notice='運営による追放で旧戦役の派遣を終了しました。';

// The review identifies a public seat term, while the commit also fences the
// current private save, role, membership and progress. Nothing is erased from
// the account or the BAN/content ledgers.
export async function expelPlayer(ctx){
 const {db,user,now,helpers:h}=ctx,raw=await h.readBody(ctx.request);
 if(!raw||Object.keys(raw).some(key=>!['targetPlayerId','requestId','reason','expectedRevision','expectedCastleId','expectedLordEpoch'].includes(key))||!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0||!Number.isSafeInteger(raw.expectedLordEpoch)||raw.expectedLordEpoch<0)
  h.fail(400,'INVALID_INPUT','追放する領主と、確認した拠点の更新番号を指定してください。');
 const targetId=h.idField(raw.targetPlayerId,'対象の領主'),requestId=h.idField(raw.requestId,'操作番号'),castleId=h.idField(raw.expectedCastleId,'確認した拠点'),reason=h.textField(raw.reason,'管理メモ',300,{optional:true,min:0});
 if(targetId===user.id)h.fail(400,'INVALID_TARGET','運営本人は追放できません。');
 const digest=await h.hash(JSON.stringify([targetId,reason,raw.expectedRevision,castleId,raw.expectedLordEpoch]));
 const prior=async()=>{const row=await S(db,'SELECT request_hash,result_json FROM expulsion_requests WHERE actor_id=? AND request_id=? AND '+ADMIN,user.id,requestId,user.id).first();if(row&&row.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の追放に使われています。');return row?JSON.parse(row.result_json):null;};
 const previous=await prior();if(previous)return{receipt:previous,idempotent:true};
 await ensureResidency(db,now);
 const target=await h.getUser(db,targetId);if(!target)h.fail(404,'PLAYER_NOT_FOUND','対象の領主が見つかりません。');
 const reviewed=await moderationExpulsion(db,target),state=reviewed.expulsion;
 if(!reviewed.canExpel)h.fail(409,'EXPULSION_UNAVAILABLE',state.blockedReason);
 if(state.revision!==raw.expectedRevision||state.castleId!==castleId||state.lordEpoch!==raw.expectedLordEpoch)h.fail(409,'EXPULSION_CHANGED','対象の拠点が変わりました。最新の拠点を確認してから追放してください。');
 await h.budget(db,'expulsion:'+user.id,30,60000,now);
 const row=await h.getSyncRow(db,targetId),clock=await h.getWorldClock(db,now);
 if(!row?.save_json)h.fail(409,'EXPULSION_CHANGED','対象の保存が更新されました。もう一度確認してください。');
 const before=h.normalizeGameSave(JSON.parse(row.save_json),target,now,{reading:true,clock}),campaignId=before.state.walking.campaignId;
 await h.reconcileCovertProgress(db,targetId,before);
 const branch=await h.branchStateGuard(db,targetId,campaignId);await h.reconcileBranchProgress(db,targetId,before,clock);
 const member=await S(db,'SELECT * FROM castle_residents WHERE user_id=?',targetId).first();
 if((member?.castle_id||before.state.home)!==castleId)h.fail(409,'EXPULSION_CHANGED','対象の拠点が変わりました。最新の拠点を確認してください。');
 const membership=member?{sql:'EXISTS(SELECT 1 FROM castle_residents WHERE user_id=? AND castle_id=? AND revision=?)',args:[targetId,member.castle_id,member.revision]}:{sql:'NOT EXISTS(SELECT 1 FROM castle_residents WHERE user_id=?)',args:[targetId]};
 const progress=await prepareRelocationProgress(db,targetId,before,now),march=await activeMarch(db,targetId),game=GameEngine.fromSave(before,GAME_OFFICERS),dispatchIds=[];
 for(const dispatch of [...game.state.covert.dispatches]){dispatchIds.push(dispatch.requestId);game.cancelCovertDispatch(dispatch.id,notice,{authoritative:true});}
 const source=JSON.parse(game.exportSave());source.state.march=null;
 const revision=state.revision+1,nonce=crypto.randomUUID(),args=[user.id,requestId,nonce],access=h.roleCommitGuard(target);
 const receipt={action:'expel',requestId,actorPlayerId:user.id,targetPlayerId:targetId,targetName:target.name,castleId,castleName:state.castleName,role:state.role,released:state.role==='lord',expulsionRevision:revision,reason,createdAt:new Date(now).toISOString()};
 const statements=[S(db,`INSERT INTO expulsion_requests(actor_id,request_id,target_id,request_hash,commit_token,result_json,created_at)
  SELECT ?,?,?,?,?,?,? FROM player_saves ps JOIN castle_seats cs ON cs.castle_id=? WHERE ps.user_id=? AND ps.revision=? AND ps.save_json IS NOT NULL
  AND cs.lord_epoch=? AND COALESCE(cs.lord_user_id,'')=? AND COALESCE((SELECT revision FROM player_expulsions WHERE user_id=?),0)=?
  AND NOT EXISTS(SELECT 1 FROM player_expulsions WHERE user_id=? AND pending=1)
  AND NOT EXISTS(SELECT 1 FROM deputy_operator_state WHERE id=1 AND user_id=ps.user_id)
  AND NOT EXISTS(SELECT 1 FROM staff_members WHERE user_id=?) AND ?<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
  AND ${ADMIN} AND ${access.sql} AND ${membership.sql} AND ${branch.guard.sql} AND ${progress.guard.sql}
  ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING result_json`,user.id,requestId,targetId,digest,nonce,JSON.stringify(receipt),now,castleId,targetId,row.revision,raw.expectedLordEpoch,state.role==='lord'?targetId:(await S(db,'SELECT lord_user_id FROM castle_seats WHERE castle_id=?',castleId).first())?.lord_user_id||'',targetId,raw.expectedRevision,targetId,targetId,targetId,user.id,...access.args,...membership.args,...branch.guard.args,...progress.guard.args),
  S(db,`INSERT INTO player_expulsions(user_id,revision,pending,castle_id,lord_epoch,role,source_save_json,reason,expelled_by,expelled_at,resumed_at)
   SELECT ?,?,1,?,?,?,?,?,?,?,NULL WHERE ${GATE}
   ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,pending=1,castle_id=excluded.castle_id,lord_epoch=excluded.lord_epoch,role=excluded.role,source_save_json=excluded.source_save_json,reason=excluded.reason,expelled_by=excluded.expelled_by,expelled_at=excluded.expelled_at,resumed_at=NULL`,targetId,revision,castleId,raw.expectedLordEpoch,state.role,JSON.stringify(source),reason,user.id,now,...args),
  S(db,`INSERT INTO expelled_campaigns(user_id,campaign_id,expulsion_revision,created_at) SELECT ?,?,?,? WHERE ${GATE} ON CONFLICT(user_id,campaign_id) DO NOTHING`,targetId,campaignId,revision,now,...args),
  S(db,`UPDATE castle_seats SET lord_user_id=NULL,lord_epoch=lord_epoch+1,lord_since_elapsed_ms=?,revision=revision+1 WHERE lord_user_id=? AND ${GATE}`,clock.elapsedMs,targetId,...args),
  S(db,`DELETE FROM castle_residents WHERE user_id=? AND ${GATE}`,targetId,...args),
  S(db,`UPDATE castle_residency_meta SET revision=revision+1 WHERE id=1 AND ${GATE}`,...args),
  ...progress.statements(GATE,args,nonce),
  ...closeReservations(db,targetId,campaignId,now,nonce,GATE,args,march,game.state.covert,dispatchIds,clock.elapsedMs,notice),
  S(db,`INSERT INTO trade_deliveries(trade_id,recipient_id,kind,assets_json,created_at,claimed_at) SELECT id,sender_id,'refund',offer_json,?,NULL FROM trades WHERE status='pending' AND (sender_id=? OR recipient_id=?) AND ${GATE}`,now,targetId,targetId,...args),
  S(db,`UPDATE trades SET status='cancelled',revision=revision+1,updated_at=? WHERE status='pending' AND (sender_id=? OR recipient_id=?) AND ${GATE}`,now,targetId,targetId,...args),
  S(db,`UPDATE player_saves SET save_json=NULL,revision=revision+1,updated_at=?,writer_device_id=NULL,writer_device_name=NULL,lease_expires_at=0,cycle_commit=? WHERE user_id=? AND ${GATE}`,now,nonce,targetId,...args)
 ];
 statements.push(...externalTroopSnapshotStatements(db,[targetId],clock,GATE,args));
 const saved=(await db.batch(statements))[0].results?.[0];
 if(saved)return{receipt:JSON.parse(saved.result_json),idempotent:false};
 h.requireAdmin(await h.getUser(db,user.id)||{});const replay=await prior();if(replay)return{receipt:replay,idempotent:true};
 h.fail(409,'EXPULSION_CHANGED','対象の拠点・保存・役職が更新されました。最新の状態を確認してから追放してください。');
}
