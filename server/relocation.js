// Voluntary moves start a new private campaign while keeping the public player.
// The receipt owns every side effect in one D1 transaction.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {ensureResidency,RESIDENCY_CASTLES,prepareResidencySuccession} from './residency.js';
import {activeMarch,finishMarchStatement} from './marches.js';
import {rallyMarchCancellation} from './alliance.js';
import {reconcileCovertProgress} from './covert.js';
import {prepareRelocationProgress} from './progress.js';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const castles=new Set(RESIDENCY_CASTLES.map(c=>c.id));
const noGuard={sql:'1=1',args:[]};
const notice='本拠移転で旧戦役の派遣を終了しました。';

function closeReservations(db,userId,campaignId,now,nonce,gate,args,march,retiredCovert,dispatchIds,elapsedMs){
 const changes=[];
 if(march){
  changes.push(finishMarchStatement(db,march,'cancelled',{message:notice,battle:null},now,gate,args));
  if(march.kind==='rally')changes.push(...rallyMarchCancellation(db,march,gate,args));
 }
 if(retiredCovert)changes.push(
  stmt(db,'UPDATE covert_states SET state_json=?,updated_at=? WHERE actor_id=? AND campaign_id=? AND '+gate,JSON.stringify(retiredCovert),now,userId,campaignId,...args),
  stmt(db,`UPDATE covert_requests SET result_json=json_set(result_json,'$.accepted',json('false'),'$.status','cancelled','$.retiredCampaign',json('true'),'$.resolvedElapsedMs',?,'$.message',?)
    WHERE actor_id=? AND campaign_id=? AND request_id IN (SELECT value FROM json_each(?)) AND ${gate}`,Math.floor(elapsedMs),notice,userId,campaignId,JSON.stringify(dispatchIds),...args)
 );
 // A contingent in someone else's launched rally keeps its combat strength
 // until that battle resolves. Private survivors from the retired army lapse.
 changes.push(
  stmt(db,`UPDATE alliance_units SET campaign_retired=1,troops=CASE WHEN march_id IS NULL THEN 0 ELSE troops END,state=CASE WHEN march_id IS NULL THEN 'claimed' ELSE state END,revision=revision+CASE WHEN march_id IS NULL THEN 1 ELSE 0 END WHERE owner_id=? AND state<>'claimed' AND campaign_retired=0 AND ${gate}`,userId,...args),
  stmt(db,`UPDATE alliance_units SET state='returning',revision=revision+1 WHERE kind='aid' AND target_id=? AND owner_id<>? AND state='stationed' AND march_id IS NULL AND ${gate}`,userId,userId,...args),
  // These troops and supplies belong to the season's guild. The existing
  // bounded pool return routine handles them once, including any overflow.
  stmt(db,`UPDATE conquest_marches SET status='cancelled',commit_token=?,settled_at=?,return_troops=troops,return_supplies=supply_cost,
    result_json=json_set(result_json,'$.marching',json('false'),'$.cancelled',json('true'),'$.points',0,'$.message',?)
    WHERE user_id=? AND status='marching' AND ${gate}`,nonce,now,'本拠移転のため進軍を中止しました。兵と補給は同盟へ返還します。',userId,...args),
  stmt(db,`UPDATE conquest_requests SET result_json=(SELECT m.result_json FROM conquest_marches m WHERE m.user_id=conquest_requests.user_id AND m.request_id=conquest_requests.request_id)
    WHERE user_id=? AND EXISTS(SELECT 1 FROM conquest_marches m WHERE m.user_id=conquest_requests.user_id AND m.request_id=conquest_requests.request_id AND m.commit_token=?) AND ${gate}`,userId,nonce,...args),
  stmt(db,`UPDATE walking_sessions SET closed=1,last_seen_at=?,expires_at=? WHERE user_id=? AND closed=0 AND ${gate}`,now,now,userId,...args),
  stmt(db,`UPDATE walking_accounts SET active_session_id=NULL,revision=revision+1 WHERE user_id=? AND active_session_id IS NOT NULL AND ${gate}`,userId,...args)
 );
 return changes;
}

export async function relocateResidence(ctx,body){
 const {db,user,now,helpers:h}=ctx;
 await h.requireAccountAccess(db,user);
 if(user.is_admin||user.is_staff)h.fail(403,'RESIDENCY_PROTECTED','現在の立場では本拠を移せません。');
 if(!body||Object.keys(body).some(k=>!['deviceId','revision','requestId','castleId'].includes(k))||!Number.isSafeInteger(body.revision)||body.revision<0||!castles.has(body.castleId))
  h.fail(400,'INVALID_INPUT','124の通常城から移転先を選んでください。');
 const device=h.idField(body.deviceId,'端末識別子'),requestId=h.idField(body.requestId,'操作番号'),target=body.castleId;
 const query=ctx.url.searchParams;
 if([...query.keys()].some(key=>key!=='receipt')||query.has('receipt')&&(query.getAll('receipt').length!==1||query.get('receipt')!=='1'))h.fail(400,'INVALID_INPUT','移転の照会方法を確認してください。');
 const digest=await h.hash(JSON.stringify(['relocate',target]));
 const prior=()=>stmt(db,'SELECT request_hash,castle_id,mode FROM castle_residency_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first();
 const result=async(receipt,idempotent)=>{
  if(receipt.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の入城に使用されています。');
  return {...await h.syncSnapshot(db,await h.getSyncRow(db,user.id),await h.getUser(db,user.id),device,now),
    admission:{requestId,castleId:receipt.castle_id,mode:receipt.mode,idempotent}};
 };
 const previous=await prior();if(previous)return result(previous,true);
 if(query.has('receipt'))h.fail(404,'RELOCATION_RECEIPT_PENDING','この移転の受付はまだ確認できません。');
 await ensureResidency(db,now);
 let row;
 try{row=await h.settleWriterCycle(db,user,device,body.revision,now);}
 catch(error){const accepted=await prior();if(accepted)return result(accepted,true);throw error;}
 const clock=await h.getWorldClock(db,now);
 const before=h.normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock}),campaignId=before.state.walking.campaignId;
 const old=await stmt(db,'SELECT m.castle_id,m.revision,s.lord_user_id,s.lord_epoch FROM castle_residents m JOIN castle_seats s ON s.castle_id=m.castle_id WHERE m.user_id=?',user.id).first();
 const origin=old?.castle_id||before.state.home;
 if(origin===target)h.fail(409,'RESIDENCY_SAME_CASTLE','現在の本拠と異なる城を選んでください。');
 const seat=await stmt(db,'SELECT lord_user_id FROM castle_seats WHERE castle_id=?',target).first();
 if(!seat)h.fail(409,'RESIDENCY_CHANGED','城の最新の状況を確認してください。');
 await reconcileCovertProgress(db,user.id,before);
 const walking=await stmt(db,'SELECT total_steps FROM walking_accounts WHERE user_id=?',user.id).first();
 if(walking)before.state.walking.serverSteps=Number(walking.total_steps);
 const game=GameEngine.fromSave(before,GAME_OFFICERS),oldCovert=game.state.covert.dispatches.length?GameEngine.fromSave(before,GAME_OFFICERS):null;
 const dispatchIds=[];
 if(oldCovert)for(const dispatch of [...oldCovert.state.covert.dispatches]){
  oldCovert.cancelCovertDispatch(dispatch.id,notice,{authoritative:true});dispatchIds.push(dispatch.requestId);
 }
 // Role never changes private assets. The actual role is selected at INSERT,
 // so simultaneous arrivals become one lord and one retainer without a restart.
 const relocated=game.relocateResidence(target,{role:seat.lord_user_id?'retainer':'lord',worldClock:clock,residencyCastleId:origin});
 if(!relocated.ok)h.fail(409,relocated.code,relocated.message);
 const next=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock});
 const leaving=old?.lord_user_id===user.id?await prepareResidencySuccession(db,{userId:user.id,castleId:old.castle_id,battleId:user.id+':'+requestId,kind:'departure',now}):null;
 const membership=old?{sql:"EXISTS(SELECT 1 FROM castle_residents m JOIN castle_seats s ON s.castle_id=m.castle_id WHERE m.user_id=? AND m.castle_id=? AND m.revision=? AND s.lord_epoch=? AND COALESCE(s.lord_user_id,'')=?)",args:[user.id,old.castle_id,old.revision,old.lord_epoch,old.lord_user_id||'']}:
   {sql:'NOT EXISTS(SELECT 1 FROM castle_residents WHERE user_id=?)',args:[user.id]};
 const progress=await prepareRelocationProgress(db,user.id,before,now);
 const role=h.roleCommitGuard(user),departure=leaving?.guard||noGuard,march=await activeMarch(db,user.id);
 const nonce=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM castle_residency_requests WHERE actor_id=? AND request_id=? AND commit_token=?)',args=[user.id,requestId,nonce];
 const statements=[stmt(db,`INSERT INTO castle_residency_requests(actor_id,request_id,request_hash,commit_token,castle_id,mode,created_at)
   SELECT ?,?,?,?,?,CASE WHEN s.lord_user_id IS NULL THEN 'lord' ELSE 'retainer' END,?
   FROM castle_seats s JOIN player_saves p ON p.user_id=? WHERE s.castle_id=? AND p.revision=? AND p.writer_device_id=? AND p.lease_expires_at>?
   AND EXISTS(SELECT 1 FROM world_clock WHERE id='world-v1' AND revision=?) AND ${role.sql} AND ${membership.sql} AND ${departure.sql} AND ${progress.guard.sql}
   ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_hash,castle_id,mode`,user.id,requestId,digest,nonce,target,now,user.id,target,row.revision,device,now,clock.revision,...role.args,...membership.args,...departure.args,...progress.guard.args),
  stmt(db,`INSERT INTO castle_retired_campaigns(actor_id,campaign_id,request_id) SELECT ?,?,? WHERE ${gate}`,user.id,campaignId,requestId,...args)];
 if(leaving?.succession)statements.push(...leaving.statements(gate,args));
 if(old)statements.push(stmt(db,`UPDATE castle_seats SET lord_user_id=NULL,lord_epoch=lord_epoch+1,lord_since_elapsed_ms=?,revision=revision+1 WHERE castle_id=? AND lord_user_id=? AND ${gate}`,clock.elapsedMs,old.castle_id,user.id,...args));
 statements.push(
  stmt(db,'UPDATE castle_residency_meta SET sequence=sequence+1,revision=revision+1 WHERE id=1 AND '+gate,...args),
  stmt(db,`INSERT INTO castle_residents(user_id,castle_id,join_order,joined_at) SELECT ?,?,sequence,? FROM castle_residency_meta WHERE id=1 AND ${gate}
    ON CONFLICT(user_id) DO UPDATE SET castle_id=excluded.castle_id,join_order=excluded.join_order,joined_at=excluded.joined_at,revision=castle_residents.revision+1`,user.id,target,now,...args),
  stmt(db,`UPDATE castle_seats SET lord_since_elapsed_ms=CASE WHEN lord_user_id IS NULL THEN ? ELSE lord_since_elapsed_ms END,
    lord_epoch=lord_epoch+CASE WHEN lord_user_id IS NULL THEN 1 ELSE 0 END,lord_user_id=COALESCE(lord_user_id,?),revision=revision+1 WHERE castle_id=? AND ${gate}`,clock.elapsedMs,user.id,target,...args),
  ...progress.statements(gate,args,nonce),
  ...closeReservations(db,user.id,campaignId,now,nonce,gate,args,march,oldCovert?.state.covert,dispatchIds,clock.elapsedMs),
  stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=?,cycle_index=?,cycle_home=?,cycle_commit=? WHERE user_id=? AND ${gate}`,JSON.stringify(next),now,now+h.syncLease,next.state.cycle.index,target,nonce,user.id,...args)
 );
 const committed=(await db.batch(statements))[0].results?.[0];if(committed)return result(committed,false);
 const retry=await prior();if(retry)return result(retry,true);
 await h.requireAccountAccess(db,user);h.fieldWriter(await h.getSyncRow(db,user.id),device,body.revision,now);
 h.fail(409,'RESIDENCY_CHANGED','在籍または城の状況が更新されました。最新の本拠を確認してからもう一度お試しください。');
}
