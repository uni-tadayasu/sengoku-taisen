import {advanceReservedMarch} from './marches.js';
import {maintenanceContext,protectMaintenance,externalTroopSnapshotStatements} from './maintenance.js';
// Private, authoritative dispatch ledger. None of the information in this
// module is a public role projection or a client-provided intelligence report.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {recordCastleSiege} from './durability.js';
import {prepareProtection,protectionBattleStatements} from './protection.js';
import {getAllianceDefense} from './alliance.js';
import {guardLordSupport,residencyTargetGuard,prepareResidencySuccession,prepareResidencyCpuLosses} from './residency.js';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=value=>value?.results||[];
const gate='EXISTS(SELECT 1 FROM covert_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const cities=['edo','kyoto_gosho','nijo','osaka','nagoya'];
const castles=globalThis.SENGOKU_DATA.castles;
const castleMap=new Map(castles.map(c=>[c.id,c]));
const cycleMs=672*60000;
const safe={sql:'1=1',args:[]};
const incidentCastle="CASE WHEN json_extract(result_json,'$.castleId')='sunpu' AND json_extract(result_json,'$.battleMode')='reward' THEN 'kyoto_gosho' ELSE json_extract(result_json,'$.castleId') END";

async function canonical(db,userId,campaignId){
 const row=await stmt(db,'SELECT * FROM covert_states WHERE actor_id=? AND campaign_id=?',userId,campaignId).first();
 return{row,state:GameEngine.normalizeCovertState(row?JSON.parse(row.state_json):undefined,campaignId)};
}
// An uploaded save can retain its ordinary campaign/import behavior, but cannot
// mint dispatch units, undo casualties, forge reports or regenerate a response.
export async function reconcileCovertProgress(db,userId,save){
 const found=await canonical(db,userId,save.state.walking.campaignId);
 save.state.covert=found.state;
 return save;
}
// Called only after this Worker advances the shared deterministic engine. The
// existing save transaction gates the immutable incident, including role and
// revision checks; browser-reported CPU incidents never reach this function.
export function covertIncidentStatements(db,userId,save,now,parentGate,parentArgs){
 const state=save.state.covert,campaignId=save.state.walking.campaignId;
 return state.incidents.filter(v=>v.kind==='cpu').map(v=>stmt(db,`INSERT INTO covert_incidents(actor_id,campaign_id,incident_id,source_castle_id,occurred_elapsed_ms,station_sequence,result_json,created_at)
  SELECT ?,?,?,?,?,?,?,? WHERE ${parentGate} ON CONFLICT DO NOTHING`,userId,campaignId,v.id,v.sourceCastleId,v.occurredElapsedMs,v.stationSequence,JSON.stringify(v),now,...parentArgs));
}
async function incoming(ctx,state,requested=null){
 const {db,user}=ctx;
 const found=rows(await stmt(db,`SELECT b.rowid AS serial,b.id,b.occurred_elapsed_ms,${incidentCastle} AS castle_id
  FROM field_battles b WHERE b.defender_id=? AND b.defender_campaign_id=? AND (${incidentCastle}) IN ('edo','kyoto_gosho','nijo','osaka','nagoya')
  AND NOT EXISTS(SELECT 1 FROM covert_requests cr WHERE cr.actor_id=? AND cr.incident_id=b.id)
  ORDER BY CASE WHEN b.id=? THEN 0 ELSE 1 END,b.rowid DESC LIMIT 128`,user.id,state.campaignId,user.id,requested).all());
 const fields=found.filter(r=>state.stations.some(s=>s.sourceCastleId===r.castle_id&&s.battleCursor<Number(r.serial)&&s.createdElapsedMs<=Number(r.occurred_elapsed_ms))).map(r=>({id:r.id,sourceCastleId:r.castle_id,kind:'field',occurredElapsedMs:Number(r.occurred_elapsed_ms),used:false,battleCursor:Number(r.serial),stationSequence:0}));
 const cpu=rows(await stmt(db,`SELECT ci.result_json FROM covert_incidents ci WHERE ci.actor_id=? AND ci.campaign_id=?
  AND NOT EXISTS(SELECT 1 FROM covert_requests cr WHERE cr.actor_id=ci.actor_id AND cr.incident_id=ci.incident_id)
  ORDER BY CASE WHEN ci.incident_id=? THEN 0 ELSE 1 END,ci.occurred_elapsed_ms DESC LIMIT 128`,user.id,state.campaignId,requested).all()).map(v=>JSON.parse(v.result_json)).filter(r=>state.stations.some(s=>s.sourceCastleId===r.sourceCastleId&&s.deploymentSequence<r.stationSequence&&s.createdElapsedMs<=r.occurredElapsedMs));
 state.incidents=[...fields,...cpu].sort((a,b)=>(a.id===requested?-1:b.id===requested?1:0)||b.occurredElapsedMs-a.occurredElapsedMs).slice(0,128);
 return state;
}
async function status(ctx,snapshot=null){
 const {db,user,helpers:h,url}=ctx,now=Date.now();
 snapshot=snapshot||await h.syncSnapshot(db,await h.getSyncRow(db,user.id),await h.getUser(db,user.id),url.searchParams.get('deviceId')||null,now);
 if(!snapshot.save)return{...snapshot,covert:null};
 const current=await h.getUser(db,user.id),found=await canonical(db,user.id,snapshot.save.state.walking.campaignId);
 snapshot.save.state.covert=await incoming({...ctx,user:current},found.state);
 const shared=current.is_staff&&!current.is_admin?await h.staffBaseDto(db,current,snapshot.clock,now):null;
 const emperor=await h.courtImperialAuthority(db,current);
 const game=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isAdmin:!!current.is_admin,isDeputy:!!current.is_deputy,isStaff:!!current.is_staff,isCourtEmperor:emperor.isCourtEmperor,isCourtRegent:emperor.isCourtRegent,staffBase:shared});
 const covert=game.covertStatus(),listUrl=new URL(url);listUrl.searchParams.set('limit',url.searchParams.get('limit')||'100');
 covert.rules={...covert.rules,canAttackEdoFromKyoto:emperor.canActForEmperor};if(emperor.canActForEmperor)h.registerCourtGuard(emperor.guard);
 const list=await h.getFieldList(db,current,listUrl,now);
 covert.targets.push(...list.targets.filter(t=>t.playerId!==user.id&&(!snapshot.residency?.castleId||t.householdCastleId!==snapshot.residency.castleId)).map(t=>({kind:'player',playerId:t.playerId,castleId:t.targetCastleId,name:t.targetCastleName,playerName:t.name})));
 covert.targetCursor=list.nextCursor;covert.playerTargetTotal=Math.max(0,list.total-1);covert.online=true;
 return{...snapshot,covert};
}
async function prior(ctx,requestId,digest){
 const record=await stmt(ctx.db,'SELECT * FROM covert_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId).first();
 if(record&&record.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の派遣に使用されています。');
 return record;
}
async function response(ctx,record,deviceId,idempotent){
 const {db,user,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 const snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,user.id),await h.getUser(db,user.id),deviceId,Date.now());
 const result=JSON.parse(record.result_json);return{...await status(ctx,snapshot),result,idempotent,...(result.march?{accepted:result.status==='marching',marching:result.status==='marching',march:covertMarchDto(result.march,snapshot.clock,result)}:{})};
}
function input(raw,action,h){
 const common=['requestId','deviceId','expectedRevision','campaignId','sequence'];
 const extra={hire:['sourceCastleId','count'],dispatch:['sourceCastleId','count','mode','target'],recall:['stationId'],retaliate:['stationId','incidentId']}[action];
 if(!extra||!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!common.includes(k)&&!extra.includes(k)))h.fail(400,'INVALID_INPUT','派遣操作の送信項目を確認してください。');
 const body={};for(const key of ['requestId','deviceId','campaignId']){body[key]=h.idField(raw[key],key);if(body[key].length>90)h.fail(400,'INVALID_INPUT','操作番号が長すぎます。');}
 for(const key of ['sequence','expectedRevision']){if(!Number.isSafeInteger(raw[key])||raw[key]<0||raw[key]>1000000000)h.fail(400,'INVALID_INPUT','保存の更新番号が正しくありません。');body[key]=raw[key];}
 for(const key of ['sourceCastleId','stationId','incidentId'])if(extra.includes(key))body[key]=h.idField(raw[key],key);
 if(extra.includes('sourceCastleId')&&!cities.includes(body.sourceCastleId))h.fail(400,'INVALID_SOURCE','派遣元の大都市拠点を選んでください。');
 if(extra.includes('count')){if(!Number.isSafeInteger(raw.count)||raw.count<1||raw.count>20000)h.fail(400,'INVALID_COUNT','人数は1〜20,000人の整数で指定してください。');body.count=raw.count;}
 if(action==='dispatch'){
  if(!['scout','station'].includes(raw.mode))h.fail(400,'INVALID_INPUT','偵察または常駐を選んでください。');body.mode=raw.mode;
  if(!raw.target||typeof raw.target!=='object'||Array.isArray(raw.target)||Object.keys(raw.target).some(k=>!['kind','castleId','playerId'].includes(k)))h.fail(400,'INVALID_TARGET','派遣先の指定が正しくありません。');
  try{const normalized=GameEngine.normalizeCovertTarget(raw.target);body.target={kind:normalized.kind,castleId:normalized.castleId,...(normalized.kind==='player'?{playerId:normalized.playerId}:{})};}catch{h.fail(400,'INVALID_TARGET','派遣先の指定が正しくありません。');}
  if(body.target.kind==='castle'&&raw.target.playerId!==undefined)h.fail(400,'INVALID_TARGET','城の派遣先に領主IDは指定できません。');
 }
 return body;
}
async function playerTarget(ctx,targetSpec,clock,action,term=null){
 const {db,user,helpers:h,now}=ctx;
 if(targetSpec.playerId===user.id)h.fail(400,'INVALID_TARGET','自分の共有拠点には派遣できません。');
 const target=await h.getUser(db,targetSpec.playerId);
 if(!target||target.ban_active)h.fail(404,'FIELD_PLAYER_NOT_FOUND','相手の共有拠点が見つかりません。');
 let row=await h.getSyncRow(db,target.id);
 if(!row?.save_json)h.fail(404,'FIELD_PLAYER_NOT_FOUND','相手の本拠はまだ共有されていません。');
 const rewardOnly=['edo','kyoto_gosho','kagoshima'].includes(targetSpec.castleId);
 // Spying stays read-only. A damaging counterattack first settles the owner's
 // unchanged troops/facilities to this time, then applies losses at that boundary.
 const journey=action==='retaliate'&&!rewardOnly?await advanceReservedMarch({...ctx,user:target,helpers:{...h,reconcileCovertProgress}},row,clock):null;
 const save=journey?.save||h.normalizeGameSave(JSON.parse(row.save_json),target,now,{reading:true,clock}),s=save.state;
 const residency=await residencyTargetGuard(db,{attackerId:user.id,targetId:target.id,castleId:targetSpec.castleId,isHome:targetSpec.castleId===s.home,term,now,fail:h.fail});
 const branches=journey?.branches||await h.branchStateGuard(db,target.id,s.walking.campaignId);if(!journey)await h.reconcileBranchProgress(db,target.id,save,clock,{projectToClock:true});
 const cpuLosses=await prepareResidencyCpuLosses(db,{userId:target.id,events:journey?.game.takeHomeDefenseLosses?.()||[],now,state:s});
 branches.guard={sql:branches.guard.sql+' AND '+cpuLosses.guard.sql,args:[...branches.guard.args,...cpuLosses.guard.args]};
 if(targetSpec.castleId!==s.home&&(!['nijo','osaka','nagoya'].includes(targetSpec.castleId)||s.castles[targetSpec.castleId].owner!==s.clan))h.fail(409,'FIELD_TARGET_CHANGED','この領主の共有拠点ではありません。派遣先を更新してください。');
 if(s.gameOver||Number(row.cycle_index)<Math.floor(clock.elapsedMs/cycleMs)&&!rewardOnly)h.fail(409,'BASE_UNAVAILABLE','この拠点は領地の精算中です。');
 const sharedGuard=target.is_staff&&!target.is_admin&&targetSpec.castleId==='kyoto_gosho'?await h.fieldStaffDefense(db,s,clock):safe;
 const g=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!target.is_admin,isDeputy:!!target.is_deputy,isStaff:!!target.is_staff}),castle=s.castles[targetSpec.castleId];
 const support=await getAllianceDefense(db,target,targetSpec.castleId,now),protection=action==='retaliate'?await prepareProtection(db,user,target,now,{reward:rewardOnly,fail:h.fail}):{guard:safe,shieldUntil:0};
 const supportedState={...s,worldClock:{...s.worldClock,elapsedMs:clock.elapsedMs},castles:{...s.castles,[targetSpec.castleId]:{...castle,troops:castle.troops+support.troops}}};
 const snapshot=GameEngine.normalizeCovertSnapshot({level:castle.level,troops:s.troops,garrison:castle.troops,wall:targetSpec.castleId===s.home?s.buildings.wall:castle.wall,defensePower:h.fieldDefense(supportedState,'balanced',0,targetSpec.castleId).power,resources:s.resources,army:g.armyStats()});
 snapshot.activeBranches=s.branches.filter(branch=>branch.parentCastleId===targetSpec.castleId&&branch.level>0&&!branch.fallen).map(branch=>branch.id);
 const canonicalTarget={kind:'player',playerId:target.id,castleId:targetSpec.castleId,name:castleMap.get(targetSpec.castleId).name,playerName:target.name};
 const role=journey?h.roleCommitGuard(target):guardLordSupport(h.roleCommitGuard(target),target),guards={sql:`EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND save_json IS NOT NULL) AND ${role.sql} AND ${sharedGuard.sql} AND ${branches.guard.sql} AND ${residency.sql}`,args:[target.id,row.revision,...role.args,...sharedGuard.args,...branches.guard.args,...residency.args]};
 if(action==='retaliate'){
  if(snapshot.activeBranches.length)h.fail(409,'BRANCHES_REQUIRED','大都市拠点へ反撃する前に、残っている支拠点をすべて陥落させてください。');
  const relation=await h.fieldRelation(db,user.id,target.id);if(h.fieldRelationStatus(relation,user.id,clock.elapsedMs)==='allied')h.fail(409,'ALLIED_TARGET','同盟期間中の相手には反撃できません。');
  const [a,b]=[user.id,target.id].sort();guards.sql+=' AND NOT EXISTS(SELECT 1 FROM field_relations WHERE user_a=? AND user_b=? AND status=\'allied\' AND expires_elapsed_ms>? AND updated_elapsed_ms>=?)';guards.args.push(a,b,clock.elapsedMs,Math.floor(clock.elapsedMs/cycleMs)*cycleMs);
  const shieldPalace=targetSpec.castleId==='kyoto_gosho'?1:0;
  const shield=await stmt(db,`SELECT MAX(elapsed) AS elapsed FROM (
   SELECT occurred_elapsed_ms AS elapsed FROM field_battles WHERE defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='kyoto_gosho')
   UNION ALL SELECT occurred_elapsed_ms FROM covert_battles WHERE defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='kyoto_gosho'))`,target.id,shieldPalace,target.id,shieldPalace).first();
  if(shield?.elapsed!==null&&Number(shield.elapsed)+60000>clock.elapsedMs)h.fail(409,'TARGET_PROTECTED','相手は襲撃後の保護期間です。共通時間で60秒お待ちください。');
  for(const table of ['field_battles','covert_battles']){guards.sql+=` AND NOT EXISTS(SELECT 1 FROM ${table} WHERE (defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='kyoto_gosho')) AND occurred_elapsed_ms>?)`;guards.args.push(target.id,shieldPalace,clock.elapsedMs-60000);}
 }
 guards.sql+=' AND '+protection.guard.sql+' AND '+support.guard.sql;guards.args.push(...protection.guard.args,...support.guard.args);
 return{target,row,save,snapshot,canonicalTarget,guards,rewardOnly,protection,support,journey,cpuLosses,residencyTerm:residency.term};
}
async function mutation(ctx,action){
 const {db,user,helpers:h,request}=ctx,body=input(await h.readBody(request),action,h);
 const intent={action,campaignId:body.campaignId,sequence:body.sequence,...Object.fromEntries(Object.entries(body).filter(([key])=>!['requestId','deviceId','expectedRevision','campaignId','sequence'].includes(key)))};
 const digest=await h.hash(JSON.stringify(intent)),old=await prior(ctx,body.requestId,digest);if(old)return response(ctx,old,body.deviceId,true);
 const saved=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,ctx.now),clock=await h.getWorldClock(db,ctx.now);
 const save=h.normalizeGameSave(JSON.parse(saved.save_json),user,ctx.now,{reading:true,clock});
 const actorBranches=await h.branchStateGuard(db,user.id,save.state.walking.campaignId);await h.reconcileBranchProgress(db,user.id,save,clock);
 if(save.state.walking.campaignId!==body.campaignId)h.fail(409,'COVERT_SCOPE_CHANGED','物語が切り替わりました。派遣画面を更新してください。');
 if(!save.state.worldClock||save.state.worldClock.id!==clock.id)h.fail(409,'CLOCK_ANCHOR_REQUIRED','先に本拠を共通時計へ同期してください。');
 if(Math.abs(clock.elapsedMs-save.state.worldClock.elapsedMs)>15000)h.fail(409,'CLOCK_STALE','共通時計と本拠を同期してから操作してください。');
 if(action==='retaliate'&&!clock.running)h.fail(409,'WORLD_PAUSED','共通時間が停止中です。');
 const found=await canonical(db,user.id,body.campaignId);save.state.covert=await incoming(ctx,found.state,body.incidentId);
 if(found.state.sequence!==body.sequence)h.fail(409,'COVERT_STATE_CHANGED','派遣部隊が更新されました。最新の状態を確認してください。');
 const shared=user.is_staff&&!user.is_admin?await h.staffBaseDto(db,user,clock,ctx.now):null;
 const emperor=await h.courtImperialAuthority(db,user);
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtEmperor:emperor.isCourtEmperor,isCourtRegent:emperor.isCourtRegent,staffBase:shared});
 const options={requestId:body.requestId,campaignId:body.campaignId,sequence:body.sequence};
 const station=body.stationId?game.state.covert.stations.find(s=>s.id===body.stationId):null;
 const targetSpec=action==='dispatch'?body.target:action==='retaliate'?station?.target:null;
 const courtGuard=action==='retaliate'&&station?await h.courtAttackAuthority(db,user,station.sourceCastleId,station.target.castleId):safe;
 let target=null;if(targetSpec?.kind==='player'){target=await playerTarget(ctx,targetSpec,clock,action);options.targetSnapshot=target.snapshot;options.canonicalTarget=target.canonicalTarget;}
 if(action==='dispatch'&&body.mode==='station')options.battleCursor=Number((await stmt(db,'SELECT COALESCE(MAX(rowid),0) AS cursor FROM field_battles').first()).cursor);
 let incidentGuard=action==='dispatch'&&body.mode==='station'?{sql:"NOT EXISTS(SELECT 1 FROM field_battles WHERE defender_id=? AND json_extract(result_json,'$.castleId')=? AND rowid>?)",args:[user.id,body.sourceCastleId,options.battleCursor]}:safe;
 if(action==='retaliate'){
  const incident=game.state.covert.incidents.find(v=>v.id===body.incidentId);
  if(!station||!incident||incident.sourceCastleId!==station.sourceCastleId||(incident.kind==='field'?incident.battleCursor<=station.battleCursor:station.deploymentSequence>=incident.stationSequence))h.fail(409,'COVERT_INCIDENT_REQUIRED','常駐後に派遣元が攻撃されたとき、一度だけ反撃できます。');
  incidentGuard=incident.kind==='field'?{sql:`EXISTS(SELECT 1 FROM field_battles WHERE id=? AND defender_id=? AND defender_campaign_id=? AND rowid>? AND occurred_elapsed_ms>=? AND (${incidentCastle})=?)`,args:[body.incidentId,user.id,body.campaignId,station.battleCursor,station.createdElapsedMs,station.sourceCastleId]}:{sql:'EXISTS(SELECT 1 FROM covert_incidents WHERE actor_id=? AND campaign_id=? AND incident_id=? AND source_castle_id=? AND occurred_elapsed_ms>=? AND station_sequence>?)',args:[user.id,body.campaignId,body.incidentId,station.sourceCastleId,station.createdElapsedMs,station.deploymentSequence]};
  incidentGuard.sql+=' AND NOT EXISTS(SELECT 1 FROM covert_requests WHERE actor_id=? AND incident_id=?)';incidentGuard.args.push(user.id,body.incidentId);
 }
 const result=action==='hire'?game.hireCovert(body.sourceCastleId,body.count,options):action==='dispatch'?game.departCovertDispatch(body.sourceCastleId,body.target,body.count,body.mode,options):action==='recall'?game.recallCovert(body.stationId,options):game.retaliateCovert(body.stationId,body.incidentId,options);
 if(!result.ok)h.fail(409,result.code||'COVERT_UNAVAILABLE',result.message);
 if(result.idempotent)h.fail(409,'COVERT_ALREADY_RECORDED','この操作は記録済みです。派遣画面を更新してください。');
 if(result.accepted&&result.march){const dispatch=game.state.covert.dispatches.find(v=>v.id===result.march.id);dispatch.authority='server';dispatch.departedElapsedMs=Math.floor(clock.elapsedMs);dispatch.arrivesElapsedMs=dispatch.departedElapsedMs+dispatch.travel.durationMs;const history=game.state.covert.history.find(v=>v.requestId===body.requestId);history.march=JSON.parse(JSON.stringify(dispatch));result.result.march=history.march;result.march=history.march;}
 await h.budget(db,'covert:'+user.id,60,60000,ctx.now);
 const now=Date.now(),nonce=crypto.randomUUID(),role=guardLordSupport(h.roleCommitGuard(user),user),gateArgs=[user.id,body.requestId,nonce];
 const incomingBattle=action==='retaliate'&&target?{battleMode:target.rewardOnly?'reward':'raid',id:'cb_'+crypto.randomUUID().replaceAll('-',''),attackerPlayerId:user.id,defenderPlayerId:target.target.id,castleId:targetSpec.castleId,castleName:castleMap.get(targetSpec.castleId).name,won:result.result.battle.won,defenderLost:result.result.battle.defenderLost,occurredElapsedMs:clock.elapsedMs}:null;
 if(incomingBattle&&!target.rewardOnly){const b=result.result.battle,damage=recordCastleSiege(target.save.state,targetSpec.castleId,{won:b.won,ratio:Number(b.attackPower||b.power||1)/Math.max(1,Number(b.defensePower||target.snapshot.defensePower||1)),elapsedMs:clock.elapsedMs});incomingBattle.durability=damage;b.durability=damage;}
 const next=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock});
 // _covertCommit returns a detached receipt. Keep the same authoritative
 // structural damage in the actor's durable history as in that receipt.
 if(incomingBattle?.durability){const entry=next.state.covert.history.find(item=>item.requestId===body.requestId);if(entry?.battle)entry.battle.durability=structuredClone(incomingBattle.durability);}
 const cpuLosses=await prepareResidencyCpuLosses(db,{userId:user.id,events:game.takeHomeDefenseLosses(),now,state:next.state});
 const successionPlan=incomingBattle?.won&&!target.rewardOnly&&targetSpec.castleId===target.save.state.home?await prepareResidencySuccession(db,{userId:target.target.id,castleId:targetSpec.castleId,battleId:incomingBattle.id,kind:'covert',now}):null;
 if(successionPlan?.succession){incomingBattle.succession=successionPlan.succession;result.result.battle.succession=successionPlan.succession;}
 const stateGuard=found.row?{sql:'EXISTS(SELECT 1 FROM covert_states WHERE actor_id=? AND campaign_id=? AND sequence=? AND state_json=?)',args:[user.id,body.campaignId,body.sequence,found.row.state_json]}:{sql:'NOT EXISTS(SELECT 1 FROM covert_states WHERE actor_id=? AND campaign_id=?)',args:[user.id,body.campaignId]};
 const sharedGuard=shared?{sql:"EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)",args:[shared.revision]}:safe,targetGuard=target?.guards||safe,successionGuard=successionPlan?.guard||safe;
 const statements=[stmt(db,`INSERT INTO covert_requests(actor_id,request_id,campaign_id,sequence,action,incident_id,request_hash,commit_token,result_json,created_at)
  SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>? AND COALESCE(json_extract(save_json,'$.state.walking.campaignId'),'legacy_v1')=?)
  AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${role.sql} AND ${stateGuard.sql} AND ${sharedGuard.sql} AND ${targetGuard.sql} AND ${incidentGuard.sql} AND ${courtGuard.sql} AND ${actorBranches.guard.sql} AND ${successionGuard.sql} AND ${cpuLosses.guard.sql}
  ON CONFLICT DO NOTHING`,user.id,body.requestId,body.campaignId,body.sequence,action,action==='retaliate'?body.incidentId:null,digest,nonce,JSON.stringify(result.result),now,user.id,body.expectedRevision,body.deviceId,now,body.campaignId,h.worldClockId,clock.revision,...role.args,...stateGuard.args,...sharedGuard.args,...targetGuard.args,...incidentGuard.args,...courtGuard.args,...actorBranches.guard.args,...successionGuard.args,...cpuLosses.guard.args),
  stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(next),now,now+h.syncLease,user.id,...gateArgs),
  stmt(db,`INSERT INTO covert_states(actor_id,campaign_id,sequence,state_json,updated_at) SELECT ?,?,?,?,? WHERE ${gate}
   ON CONFLICT(actor_id,campaign_id) DO UPDATE SET sequence=excluded.sequence,state_json=excluded.state_json,updated_at=excluded.updated_at`,user.id,body.campaignId,next.state.covert.sequence,JSON.stringify(next.state.covert),now,...gateArgs)
 ];
 if(action==='dispatch'&&target)statements.push(stmt(db,`UPDATE covert_requests SET march_target_campaign_id=?,march_target_residency_json=? WHERE actor_id=? AND request_id=? AND ${gate}`,target.save.state.walking.campaignId,target.residencyTerm?JSON.stringify(target.residencyTerm):null,user.id,body.requestId,...gateArgs));
 statements.push(...h.branchProgressStatements(db,user.id,next,now,gate,gateArgs,{resolvedElapsedMs:Math.min(clock.elapsedMs,next.state.worldClock?.elapsedMs||0)}));
 if(action==='retaliate'&&target){
  const b=result.result.battle,d=target.save.state,castle=d.castles[targetSpec.castleId];
  if(!target.rewardOnly){
   d.troops-=b.defenderLost.troops;castle.troops-=b.defenderLost.garrison;
   d.log.unshift({turn:d.turn,text:'部隊の襲撃を受け、兵'+(b.defenderLost.troops+b.defenderLost.garrison)+'人を失いました。拠点の領有は継続しています。',kind:'pvp'});d.log=d.log.slice(0,200);
   const defenderNext=h.normalizeGameSave(target.save,target.target,now,{clock});
   statements.push(stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(defenderNext),now,target.target.id,...gateArgs));
   statements.push(...h.branchProgressStatements(db,target.target.id,defenderNext,now,gate,gateArgs,{resolvedElapsedMs:clock.elapsedMs}),...covertIncidentStatements(db,target.target.id,defenderNext,now,gate,gateArgs),...target.cpuLosses.statements(gate,gateArgs));
   if(target.journey){const personal=await h.staffPersonalProgressStatement(db,target.target,defenderNext,now,gate,gateArgs,target.journey.game.getStaffPersonalProgress?.());if(personal)statements.push(personal);for(const event of h.saveAchievements(target.journey.before,defenderNext))statements.push(h.achievementStatement(db,target.target.id,event,now,gate,gateArgs));}
  }
  const battle=incomingBattle;
  statements.push(...protectionBattleStatements(db,target.target.id,now,target.protection.shieldUntil,gate,gateArgs),...target.support.statements(battle,gate,gateArgs));
  statements.push(stmt(db,`INSERT INTO covert_battles(id,attacker_id,defender_id,occurred_elapsed_ms,result_json,created_at) SELECT ?,?,?,?,?,? WHERE ${gate}`,battle.id,user.id,target.target.id,clock.elapsedMs,JSON.stringify(battle),now,...gateArgs));
  const title=battle.castleName+'の戦闘報告',mailBody=battle.castleName+'が部隊の襲撃を受けました。'+(b.won?'相手部隊が戦闘で優勢となりました。':'守備隊が相手部隊を退けました。')+'損失は軍団'+b.defenderLost.troops+'人・守備兵'+b.defenderLost.garrison+'人です。拠点の領有は継続しています。',mailRequest='system:covert:'+battle.id,mailHash=await h.hash(JSON.stringify([target.target.id,title,mailBody]));
  statements.push(stmt(db,`INSERT INTO mail_campaigns(id,sender_id,target_user_id,title,body,gift_json,request_id,payload_hash,created_at) SELECT ?,?,?,?,?,NULL,?,?,? WHERE ${gate}`,'m_sys_'+battle.id,user.id,target.target.id,title,mailBody,mailRequest,mailHash,now,...gateArgs));
 }
 if(successionPlan)statements.push(...successionPlan.statements(gate,gateArgs));
 statements.push(...cpuLosses.statements(gate,gateArgs));
 if(action==='retaliate'&&target)statements.push(...externalTroopSnapshotStatements(db,target.support.maintenanceOwnerIds||[],clock,gate,gateArgs));
 await db.batch(statements);
 const committed=await prior(ctx,body.requestId,digest);
 if(!committed){
  await h.requireAccountAccess(db,user);h.fieldWriter(await h.getSyncRow(db,user.id),body.deviceId,body.expectedRevision,Date.now());
  if((await h.getWorldClock(db,Date.now())).revision!==clock.revision)h.fail(409,'WORLD_CLOCK_CHANGED','共通時計が更新されました。同期してからお試しください。');
  h.fail(409,'COVERT_STATE_CHANGED','部隊・派遣先・利用権限が更新されました。最新の状態を確認してください。');
 }
 return response(ctx,committed,body.deviceId,committed.commit_token!==nonce);
}
function covertMarchDto(dispatch,clock,result=null){
 const status=result?.status||'marching',phase=dispatch.phase||'outbound',returning=phase==='returning';return{id:dispatch.id,requestId:dispatch.requestId,kind:'covert',phase,status,timeBasis:'world',sourceCastleId:dispatch.travel.sourceCastleId,sourceName:dispatch.travel.sourceName,targetCastleId:dispatch.travel.targetCastleId,targetPlayerId:dispatch.target.playerId||null,targetName:dispatch.travel.targetName,distanceKm:dispatch.travel.distanceKm,durationMs:dispatch.travel.durationMs,departedAtMs:dispatch.departedElapsedMs,arrivesAtMs:dispatch.arrivesElapsedMs,remainingMs:status==='marching'?Math.max(0,dispatch.arrivesElapsedMs-clock.elapsedMs):0,troops:dispatch.count,travel:dispatch.travel,battle:null,message:result?.retiredCampaign?'本拠移転で旧戦役の派遣を終了しました。':status==='cancelled'?returning?'帰還中の部隊を待機人数へ戻しました。':'派遣を取りやめ、部隊と出陣費用を戻しました。':status==='resolved'?returning?'部隊が帰還しました。再び派遣できます。':dispatch.mode==='station'?'部隊が到着し、常駐を開始しました。':'偵察が完了し、部隊が帰還しました。':returning?'部隊が帰還中です。到着後に再び派遣できます。':'目的地へ部隊を派遣しています。到着後に報告を確認できます。'};
}
export async function covertMarches(ctx){
 const row=await ctx.helpers.getSyncRow(ctx.db,ctx.user.id);if(!row?.save_json)return{active:[],history:[]};const save=JSON.parse(row.save_json),found=await canonical(ctx.db,ctx.user.id,save.state.walking?.campaignId||'legacy_v1'),clock=await ctx.helpers.getWorldClock(ctx.db,ctx.now);
 return{active:found.state.dispatches.map(m=>covertMarchDto(m,clock)),history:found.state.history.filter(r=>r.march&&r.status!=='marching').map(r=>covertMarchDto(r.march,clock,r))};
}
export async function settleCovertDispatches(ctx,{actorId=null,limit=8}={}){
 const {db,helpers:h,now}=ctx,clock=await h.getWorldClock(db,now);if(!clock.running)return;
 const pending=rows(await stmt(db,`SELECT * FROM covert_states WHERE EXISTS(SELECT 1 FROM json_each(state_json,'$.dispatches') dispatch WHERE CAST(json_extract(dispatch.value,'$.arrivesElapsedMs') AS INTEGER)<=? OR CAST(json_extract(dispatch.value,'$.cycle') AS INTEGER)<>?)${actorId?' AND actor_id=?':''} ORDER BY updated_at LIMIT ?`,clock.elapsedMs,Math.floor(clock.elapsedMs/cycleMs),...(actorId?[actorId]:[]),Math.min(16,limit)).all());
 for(const ledger of pending){
  const user=await h.getUser(db,ledger.actor_id);if(!user)continue;
  const own={...ctx,user},saved=await h.getSyncRow(db,user.id);if(!saved?.save_json)continue;
  const save=h.normalizeGameSave(JSON.parse(saved.save_json),user,now,{reading:true,clock}),found=await canonical(db,user.id,ledger.campaign_id);
  if(save.state.walking.campaignId!==ledger.campaign_id)continue;
  if(!found.state.dispatches.some(m=>m.arrivesElapsedMs<=clock.elapsedMs||m.cycle!==Math.floor(clock.elapsedMs/cycleMs)))continue;
  const branches=await h.branchStateGuard(db,user.id,ledger.campaign_id);await h.reconcileBranchProgress(db,user.id,save,clock);save.state.covert=found.state;
  const maintenanceAuthority=protectMaintenance(branches,await maintenanceContext(db,user.id,save,clock));
  if(maintenanceAuthority.hasMore)continue;
  const shared=user.is_staff&&!user.is_admin?await h.staffBaseDto(db,user,clock,now):null,emperor=await h.courtImperialAuthority(db,user),game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtEmperor:emperor.isCourtEmperor,isCourtRegent:emperor.isCourtRegent,staffBase:shared,maintenanceAuthority,branchAuthority:{resolvedElapsedMs:branches.resolvedElapsedMs}});
  const completed=[];for(const dispatch of [...game.state.covert.dispatches])if(dispatch.cycle!==Math.floor(clock.elapsedMs/cycleMs)){const result=game.cancelCovertDispatch(dispatch.id,'年月が変わったため派遣を取りやめました。',{authoritative:true});if(result)completed.push(result);}
  const advanced=completed.length?{ok:true}:game.applyWorldClock(clock,{maxSeconds:86400,deferCycleSettlement:true});if(!advanced.ok||advanced.pending||advanced.settlementRequired)continue;
  const targetSnapshots={},targetGuards=[];let playerTargets=0;const cursor=Number((await stmt(db,'SELECT COALESCE(MAX(rowid),0) AS cursor FROM field_battles').first()).cursor);
  for(const dispatch of [...game.state.covert.dispatches]){
   if(dispatch.arrivesElapsedMs>clock.elapsedMs&&dispatch.cycle===game.state.cycle.index)continue;
   if(user.ban_active){const result=game.cancelCovertDispatch(dispatch.id,'利用状況が変わったため派遣を取りやめました。',{authoritative:true});if(result)completed.push(result);continue;}
   if(dispatch.phase==='returning'||dispatch.target.kind!=='player')continue;
   if(playerTargets++>=1)continue; // Keep D1 arrival guards below 100 bindings.
   try{
    const receipt=await stmt(db,'SELECT march_target_campaign_id,march_target_residency_json FROM covert_requests WHERE actor_id=? AND request_id=?',user.id,dispatch.requestId).first(),term=receipt?.march_target_residency_json?JSON.parse(receipt.march_target_residency_json):null,target=await playerTarget(own,dispatch.target,clock,'dispatch',term);
    if(receipt?.march_target_campaign_id&&target.save.state.walking.campaignId!==receipt.march_target_campaign_id)h.fail(409,'COVERT_TARGET_CHANGED','派遣先の物語が切り替わったため、部隊は帰還しました。');
    targetSnapshots[dispatch.target.playerId+':'+dispatch.target.castleId]={snapshot:target.snapshot,battleCursor:cursor};targetGuards.push(target.guards);
   }catch(error){if(!error?.status)throw error;const result=game.cancelCovertDispatch(dispatch.id,error.message,{authoritative:true});if(result)completed.push(result);}
  }
  completed.push(...game.settleCovertDue({targetSnapshots,authoritative:true}));if(!completed.length)continue;
  const cpuLosses=await prepareResidencyCpuLosses(db,{userId:user.id,events:game.takeHomeDefenseLosses(),now,state:game.state});
  const next=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),nonce=crypto.randomUUID(),role=user.ban_active?safe:guardLordSupport(h.roleCommitGuard(user),user),guards=[role,branches.guard,cpuLosses.guard,...targetGuards,...(shared?[{sql:"EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)",args:[shared.revision]}]:[])],commitGate='EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND cycle_commit=?)',args=[user.id,nonce];
  const statements=[stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_commit=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM covert_states WHERE actor_id=? AND campaign_id=? AND state_json=?) AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${guards.map(g=>'('+g.sql+')').join(' AND ')} RETURNING user_id`,JSON.stringify(next),now,nonce,user.id,saved.revision,user.id,ledger.campaign_id,found.row.state_json,h.worldClockId,clock.revision,...guards.flatMap(g=>g.args)),stmt(db,`UPDATE covert_states SET sequence=?,state_json=?,updated_at=? WHERE actor_id=? AND campaign_id=? AND ${commitGate}`,next.state.covert.sequence,JSON.stringify(next.state.covert),now,user.id,ledger.campaign_id,...args),...h.branchProgressStatements(db,user.id,next,now,commitGate,args,{resolvedElapsedMs:Math.min(clock.elapsedMs,next.state.worldClock?.elapsedMs||0)}),...covertIncidentStatements(db,user.id,next,now,commitGate,args)];
  for(const result of completed){
   // The compact save history can roll over during a long return. Preserve
   // the original paid cost and intelligence in the durable request receipt.
   const record=await stmt(db,'SELECT result_json FROM covert_requests WHERE actor_id=? AND request_id=?',user.id,result.requestId).first(),prior=record?JSON.parse(record.result_json):{};
   const receipt={...prior,...result,foodCost:prior.foodCost??result.foodCost,commandCost:prior.commandCost??result.commandCost,createdElapsedMs:prior.createdElapsedMs??result.createdElapsedMs};
   statements.push(stmt(db,`UPDATE covert_requests SET result_json=? WHERE actor_id=? AND request_id=? AND ${commitGate}`,JSON.stringify(receipt),user.id,result.requestId,...args));
  }
  const personal=await h.staffPersonalProgressStatement(db,user,next,now,commitGate,args,game.getStaffPersonalProgress?.());if(personal)statements.push(personal);
  statements.push(...cpuLosses.statements(commitGate,args));
  await db.batch(statements);
 }
}
export async function handleCovert(ctx){
 const {user,db,helpers:h,path,method,url}=ctx;await h.requireAccountAccess(db,user);
 if(path==='/covert'&&method==='GET'){
  await settleCovertDispatches(ctx,{actorId:user.id,limit:1});
  if([...url.searchParams.keys()].some(k=>!['cursor','limit','deviceId'].includes(k)))h.fail(400,'INVALID_INPUT','一覧の指定を確認してください。');
  return status(ctx);
 }
 const action=path.slice('/covert/'.length);if(method==='POST'&&['hire','dispatch','recall','retaliate'].includes(action))return mutation(ctx,action);
 h.fail(404,'NOT_FOUND','その派遣操作は見つかりませんでした。');
}
