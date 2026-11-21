// Authoritative CPU field battles. The receipt and campaign mutation are one
// D1 transaction, so network retries never spend or reward a second time.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {getRoamingDeployment} from './roaming-deployment.js';

const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=value=>value?.results||[];
const gate='EXISTS(SELECT 1 FROM roaming_battles WHERE actor_id=? AND request_id=? AND commit_token=?)';
// Imported saves may predate this feature or the latest online battle. The
// receipt ledger restores progress only: it never applies a reward or casualty.
export async function reconcileRoamingProgress(db,userId,save,previous=null){
 const campaignId=save.state.walking.campaignId,imported=save.state.roaming;
 const before=previous?.state?.walking?.campaignId===campaignId?previous.state.roaming:null;
 const summary=await stmt(db,"SELECT COALESCE(MAX(sequence)+1,0) AS sequence,COALESCE(SUM(CASE WHEN json_extract(result_json,'$.won')=1 THEN 1 ELSE 0 END),0) AS wins FROM roaming_battles WHERE actor_id=? AND campaign_id=?",userId,campaignId).first();
 const ledger=rows(await stmt(db,'SELECT result_json FROM roaming_battles WHERE actor_id=? AND campaign_id=? ORDER BY sequence DESC LIMIT 20',userId,campaignId).all()).map(r=>JSON.parse(r.result_json));
 const sequence=Math.max(imported.sequence,before?.sequence||0,Number(summary?.sequence||0));
 const wins=Math.max(imported.wins,before?.wins||0,Number(summary?.wins||0));
 const bySequence=new Map();
 // A cloud receipt is authoritative when an imported local record overlaps.
 for(const record of [...imported.history,...(before?.history||[]),...ledger])bySequence.set(record.sequence,record);
 const seen=new Set(),history=[...bySequence.values()].sort((a,b)=>b.sequence-a.sequence).filter(record=>{if(seen.has(record.requestId))return false;seen.add(record.requestId);return true;}).slice(0,20);
 save.state.roaming=GameEngine.normalizeRoamingState({version:1,campaignId,sequence,wins,history},campaignId);
 return save;
}
async function prior(ctx,id,digest){
 const record=await stmt(ctx.db,'SELECT * FROM roaming_battles WHERE actor_id=? AND request_id=?',ctx.user.id,id).first();
 if(record&&record.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の野良兵戦に使われています。');
 return record;
}
async function response(ctx,record,deviceId,idempotent){
 const {db,user,helpers:h}=ctx,now=Date.now();
 await h.requireAccountAccess(db,user);
 const snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,user.id),await h.getUser(db,user.id),deviceId,now);
 return {...snapshot,battle:JSON.parse(record.result_json),idempotent};
}
async function battle(ctx){
 const {db,user,request,helpers:h}=ctx,raw=await h.readBody(request);
 const allowed=['encounterId','tactic','troops','requestId','campaignId','sequence','deviceId','expectedRevision','unitId','castleId','deploymentRevision'];
 if(Object.keys(raw).some(k=>!allowed.includes(k)))h.fail(400,'INVALID_INPUT','野良兵戦の送信項目を確認してください。');
 const body=Object.fromEntries(['encounterId','tactic','requestId','campaignId','deviceId'].map(k=>[k,h.idField(raw[k],k)]));
 for(const key of ['sequence','expectedRevision'])if(!Number.isSafeInteger(raw[key])||raw[key]<0||raw[key]>1000000000)h.fail(400,'INVALID_INPUT','出陣または保存の更新番号が正しくありません。');
 if(!Number.isSafeInteger(raw.troops)||raw.troops<300||raw.troops>1000000)h.fail(400,'INVALID_INPUT','出陣兵数は300〜1,000,000人の整数で指定してください。');
 Object.assign(body,{troops:raw.troops,sequence:raw.sequence,expectedRevision:raw.expectedRevision});
 const hasUnit=['unitId','castleId','deploymentRevision'].some(k=>Object.hasOwn(raw,k));
 if(hasUnit){
  body.unitId=h.idField(raw.unitId,'野良兵の部隊');body.castleId=h.idField(raw.castleId,'周辺の拠点');
  if(!Number.isSafeInteger(raw.deploymentRevision)||raw.deploymentRevision<1||raw.deploymentRevision>1000000000)h.fail(400,'INVALID_INPUT','全国の配置番号が正しくありません。');
  body.deploymentRevision=raw.deploymentRevision;
 }
 const digest=await h.hash(JSON.stringify([body.campaignId,body.sequence,body.encounterId,body.tactic,body.troops,...(hasUnit?[body.unitId,body.castleId,body.deploymentRevision]:[])]));
 const old=await prior(ctx,body.requestId,digest);if(old)return response(ctx,old,body.deviceId,true);
 if(!hasUnit)h.fail(400,'ROAMING_MAP_REQUIRED','拡大マップから配置中の野良兵を選び直してください。');
 const deployment=await getRoamingDeployment(db);
 if(deployment.revision!==body.deploymentRevision)h.fail(409,'ROAMING_DEPLOYMENT_CHANGED','全国の野良兵配置が更新されました。地図を更新して選び直してください。');
 const unit=GameEngine.roamingDeploymentUnits(deployment,body.castleId).find(u=>u.unitId===body.unitId&&u.encounterId===body.encounterId);
 if(!unit)h.fail(409,'ROAMING_UNIT_CHANGED','この野良兵は配置されていません。地図から相手を選び直してください。');
 const cooldown=await stmt(db,'SELECT respawn_at FROM roaming_unit_cooldowns WHERE deployment_revision=? AND unit_id=?',deployment.revision,unit.unitId).first();
 if(cooldown&&Number(cooldown.respawn_at)>ctx.now)h.fail(409,'ROAMING_UNIT_UNAVAILABLE','この部隊はすでに撃退されています。地図を更新するか、再出現をお待ちください。');
 const saved=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,ctx.now),clock=await h.getWorldClock(db,ctx.now);
 const save=h.normalizeGameSave(JSON.parse(saved.save_json),user,ctx.now,{reading:true,clock});
 if(!save.state.worldClock||save.state.worldClock.id!==clock.id)h.fail(409,'CLOCK_ANCHOR_REQUIRED','先に本拠を共通時計へ同期してください。');
 if(Math.abs(clock.elapsedMs-save.state.worldClock.elapsedMs)>15000)h.fail(409,'CLOCK_STALE','共通時計と本拠を同期してから出陣してください。');
 if(save.state.walking.campaignId!==body.campaignId)h.fail(409,'ROAMING_SCOPE_CHANGED','物語が切り替わりました。最新の野良兵戦を開いてください。');
 const shared=user.is_staff&&!user.is_admin?await h.staffBaseDto(db,user,clock,ctx.now):null;
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isStaff:!!user.is_staff,staffBase:shared});
 const result=game.battleRoaming(body.encounterId,body.tactic,body.troops,{...body,deploymentUnit:unit});
 if(!result.ok)h.fail(409,result.code||'ROAMING_UNAVAILABLE',result.message);
 // A history entry without its server receipt cannot authorize another credit.
 if(result.idempotent)h.fail(409,'ROAMING_ALREADY_RECORDED','この出陣は本拠に記録済みです。最新の戦果を確認してください。');
 await h.budget(db,'roaming-battle:'+user.id,30,60000,ctx.now);
 const now=Date.now();result.battle.respawnAt=result.battle.won?now+deployment.respawnSeconds*1000:null;game.state.roaming.history[0].respawnAt=result.battle.respawnAt;
 const next=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),nonce=crypto.randomUUID(),role=h.roleCommitGuard(user),args=[user.id,body.requestId,nonce];
 const sharedGuard=shared?{sql:"EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)",args:[shared.revision]}:{sql:'1=1',args:[]};
 await db.batch([
  stmt(db,`INSERT INTO roaming_battles(actor_id,request_id,campaign_id,sequence,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM player_saves ps WHERE ps.user_id=? AND ps.revision=? AND ps.writer_device_id=? AND ps.lease_expires_at>? AND ps.save_json IS NOT NULL
    AND COALESCE(json_extract(ps.save_json,'$.state.walking.campaignId'),'legacy_v1')=? AND COALESCE(json_extract(ps.save_json,'$.state.roaming.sequence'),0)=?)
   AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${role.sql} AND ${sharedGuard.sql}
   AND EXISTS(SELECT 1 FROM roaming_deployment WHERE id=1 AND revision=?)
   AND NOT EXISTS(SELECT 1 FROM roaming_unit_cooldowns WHERE deployment_revision=? AND unit_id=? AND respawn_at>?)
   ON CONFLICT DO NOTHING`,user.id,body.requestId,body.campaignId,body.sequence,digest,nonce,JSON.stringify(result.battle),now,user.id,body.expectedRevision,body.deviceId,now,body.campaignId,body.sequence,h.worldClockId,clock.revision,...role.args,...sharedGuard.args,deployment.revision,deployment.revision,unit.unitId,now),
  stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(next),now,now+h.syncLease,user.id,...args),
  ...(result.battle.won?[stmt(db,`INSERT INTO roaming_unit_cooldowns(deployment_revision,unit_id,castle_id,respawn_at,actor_id,request_id)
   SELECT ?,?,?,?,?,? WHERE ${gate} ON CONFLICT(deployment_revision,unit_id) DO UPDATE SET respawn_at=excluded.respawn_at,actor_id=excluded.actor_id,request_id=excluded.request_id`,deployment.revision,unit.unitId,unit.castleId,result.battle.respawnAt,user.id,body.requestId,...args)]:[])
 ]);
 const committed=await prior(ctx,body.requestId,digest);
 if(!committed){
  await h.requireAccountAccess(db,user);
  h.fieldWriter(await h.getSyncRow(db,user.id),body.deviceId,body.expectedRevision,Date.now());
  if((await h.getWorldClock(db,Date.now())).revision!==clock.revision)h.fail(409,'WORLD_CLOCK_CHANGED','共通時計が更新されました。同期してからお試しください。');
  if((await getRoamingDeployment(db)).revision!==deployment.revision)h.fail(409,'ROAMING_DEPLOYMENT_CHANGED','全国の野良兵配置が更新されました。地図を更新して選び直してください。');
  const currentCooldown=await stmt(db,'SELECT respawn_at FROM roaming_unit_cooldowns WHERE deployment_revision=? AND unit_id=?',deployment.revision,unit.unitId).first();
  if(currentCooldown&&Number(currentCooldown.respawn_at)>Date.now())h.fail(409,'ROAMING_UNIT_UNAVAILABLE','ほかの領主がこの部隊を撃退しました。地図を更新して相手を選び直してください。');
  h.fail(409,'ROAMING_STATE_CHANGED','本拠・出陣記録・利用権限が更新されました。最新の状態を確認してください。');
 }
 return response(ctx,committed,body.deviceId,committed.commit_token!==nonce);
}
export async function handleRoaming(ctx){
 const {db,user,path,method,helpers:h}=ctx;
 await h.requireAccountAccess(db,user);
 if(path==='/roaming/history'&&method==='GET'){
  const result=rows(await stmt(db,'SELECT result_json,created_at FROM roaming_battles WHERE actor_id=? ORDER BY created_at DESC,sequence DESC LIMIT 20',user.id).all());
  return {ok:true,battles:result.map(r=>({...JSON.parse(r.result_json),createdAt:new Date(Number(r.created_at)).toISOString()}))};
 }
 if(path==='/roaming/battle'&&method==='POST')return battle(ctx);
 h.fail(404,'NOT_FOUND','その野良兵戦の操作は見つかりませんでした。');
}
