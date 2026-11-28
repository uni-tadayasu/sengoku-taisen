import {withCourtEstateGuard} from './court-estate-guard.js';
import {maintenanceContext,protectMaintenance} from './maintenance.js';
// Authoritative branch construction and siege condition. A branch is attached
// to its parent city; it never becomes an additional territory or reward city.
import {guardLordSupport} from './residency.js';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {prepareResidencyCpuLosses} from './residency.js';
import {branchDurability,durabilityRecord} from './durability.js';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const GATE='EXISTS(SELECT 1 FROM branch_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const DEPLOYMENT_GATE='EXISTS(SELECT 1 FROM branch_deployment_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const DEPLOYMENTS=['transfer-troops','assign-commander','remove-commander','auto-assign-commanders','auto-assign-officers'];
const PARENTS=['edo','nijo','osaka','nagoya'];
const DIRECTIONS=['north','east','south','west'];
const EMPTY='{"branches":[],"jobs":[]}';
const clone=value=>JSON.parse(JSON.stringify(value));
const elapsed=save=>Math.max(0,Math.round(Number(save?.state?.worldClock?.elapsedMs??((save?.state?.turn||0)*60000+(save?.state?.realtime?.elapsed||0)*1000))));

export async function branchStateGuard(db,userId,campaignId){
 const row=await stmt(db,'SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?',userId,campaignId).first();
 const state=row?JSON.parse(row.state_json):{branches:[],jobs:[]},sequence=Number(row?.sequence||0),resolvedElapsedMs=Number(row?.resolved_elapsed_ms||0);
 const guard=row?{sql:'EXISTS(SELECT 1 FROM branch_states WHERE actor_id=? AND campaign_id=? AND sequence=? AND resolved_elapsed_ms=?)',args:[userId,campaignId,sequence,resolvedElapsedMs]}:{sql:'NOT EXISTS(SELECT 1 FROM branch_states WHERE actor_id=? AND campaign_id=?)',args:[userId,campaignId]};
 return{row,sequence,state,resolvedElapsedMs,guard};
}
export async function troopTransferGuard(db,userId,campaignId){
 const row=await stmt(db,'SELECT * FROM troop_transfer_states WHERE actor_id=? AND campaign_id=?',userId,campaignId).first(),sequence=Number(row?.sequence||0);
 const guard=row?{sql:'EXISTS(SELECT 1 FROM troop_transfer_states WHERE actor_id=? AND campaign_id=? AND sequence=?)',args:[userId,campaignId,sequence]}:{sql:'NOT EXISTS(SELECT 1 FROM troop_transfer_states WHERE actor_id=? AND campaign_id=?)',args:[userId,campaignId]};
 return{row,sequence,guard};
}
export function projectBranchState(raw,at,anchor=at){
 const state=clone(raw),jobs=[];
 // Branch ledgers created before paid repair have no work fields. Preserve
 // their old free recovery only to the owner's saved checkpoint, not to the
 // time of a public map read or an opponent's inspection.
 for(const branch of state.branches)if(branch.durability&&branch.durability.repairPendingHP===undefined&&branch.durability.repairRemainder===undefined){
  branch.durability={...durabilityRecord(GameEngine.durabilityView(branch.durability,{castleId:branch.parentCastleId,level:branch.level,branch:true,fallen:branch.fallen||branch.retreating,elapsedMs:anchor,recoveryMode:'free'})),repairPendingHP:0,repairRemainder:0};
 }
 for(const job of state.jobs){
  const branch=state.branches.find(item=>item.id===job.id);if(!branch||branch.retreating)continue;
  const due=job.completesElapsedMs<=at;
  const remainingSeconds=Math.min(job.totalSeconds,Math.max(.001,(job.completesElapsedMs-anchor)/1000));
  if(due){if(job.facilityId)GameEngine.completeBranchFacility(branch,job,job.completesElapsedMs);else{branch.level=job.targetLevel;if(job.repair){branch.fallen=false;delete branch.durability;}else if(branch.durability)branch.durability=durabilityRecord(branchDurability(branch,job.completesElapsedMs));}continue;}
  jobs.push({...job,remainingSeconds,remaining:Math.max(1,Math.ceil((remainingSeconds-1e-8)/60))});
 }
 return{branches:state.branches,jobs};
}
export function applyBranchProgress(save,state,clock,options={}){
 const anchor=Math.min(elapsed(save),Number.isSafeInteger(clock?.elapsedMs)?clock.elapsedMs:elapsed(save)),at=options.projectToClock&&Number.isSafeInteger(clock?.elapsedMs)?clock.elapsedMs:anchor;
 const model=projectBranchState(state,at,anchor);
 // Role migration, a completed capture or a new cycle may have legitimately
 // removed the parent. Its old ledger must never restore orphaned defenses.
 // Uploads must establish ownership against the trusted prior checkpoint first.
 // Only server-resolved role/capture/cycle paths may prune by save ownership.
 save.state.branches=model.branches;
 save.state.jobs=[...(save.state.jobs||[]).filter(job=>job.kind!=='branch'),...model.jobs];
 if(options.pruneOwners!==false)GameEngine.pruneBranchState(save.state,options);
 // Branch posts are authoritative and take precedence over facility posts.
 // An older client may still submit the governor who transferred in a newer
 // deployment receipt; clearing only that post preserves unrelated choices.
 const commanders=new Set(save.state.branches.flatMap(branch=>branch.commanders||[]));
 if(save.state.governors)for(const [facility,id]of Object.entries(save.state.governors))if(commanders.has(id))delete save.state.governors[facility];
 return save;
}
export async function reconcileBranchProgress(db,userId,save,clock,options={}){
 const found=await branchStateGuard(db,userId,save.state.walking.campaignId);
 return applyBranchProgress(save,found.state,clock,options);
}
function durable(save){
 const at=elapsed(save),branches=clone(save.state.branches||[]).sort((a,b)=>a.id.localeCompare(b.id));
 const ends=new Map();
 const jobs=(save.state.jobs||[]).filter(job=>job.kind==='branch').map(job=>{
  const {remainingSeconds,remaining,...rest}=job;
  const completesElapsedMs=Number.isSafeInteger(job.completesElapsedMs)?job.completesElapsedMs:
    (ends.get(job.id)??at)+Math.round(Number(remainingSeconds??Number(remaining)*60)*1000);
  ends.set(job.id,completesElapsedMs);
  return{...rest,completesElapsedMs};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 return JSON.stringify({branches,jobs});
}
// Use only for a server-resolved action/progression, inside its transaction.
// An unchanged absolute deadline does not bump the sequence on ordinary ticks.
export function branchProgressStatements(db,userId,save,now,parentGate,parentArgs,{resolvedElapsedMs=elapsed(save)}={}){
 const campaignId=save.state.walking.campaignId,json=durable(save);
 return[stmt(db,`INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,resolved_elapsed_ms,updated_at)
  SELECT ?,?,1,?,?,? WHERE (${parentGate}) AND (?<>? OR EXISTS(SELECT 1 FROM branch_states WHERE actor_id=? AND campaign_id=?))
  ON CONFLICT(actor_id,campaign_id) DO UPDATE SET sequence=branch_states.sequence+CASE WHEN branch_states.state_json<>excluded.state_json THEN 1 ELSE 0 END,state_json=excluded.state_json,resolved_elapsed_ms=MAX(branch_states.resolved_elapsed_ms,excluded.resolved_elapsed_ms),updated_at=excluded.updated_at
  WHERE branch_states.state_json<>excluded.state_json OR branch_states.resolved_elapsed_ms<excluded.resolved_elapsed_ms`,userId,campaignId,json,resolvedElapsedMs,now,...parentArgs,json,EMPTY,userId,campaignId)];
}
async function status(ctx,snapshot=null){
 const{db,user,helpers:h,url}=ctx,now=Date.now(),current=await h.getUser(db,user.id);
 h.registerResponseGuard?.(h.roleCommitGuard(user));
 snapshot=snapshot||await h.syncSnapshot(db,await h.getSyncRow(db,user.id),current,url.searchParams.get('deviceId')||null,now);
 if(!snapshot.save)return{...snapshot,campaignId:null,sequence:0,troopTransferSequence:0,troopTransfer:{commandCost:1,sequence:0,endpoints:[]},branchState:{branches:[],jobs:[]},parents:[]};
 const campaignId=snapshot.save.state.walking.campaignId,found=await branchStateGuard(db,user.id,campaignId);applyBranchProgress(snapshot.save,found.state,snapshot.clock);
 const shared=current.is_staff&&!current.is_admin?await h.staffBaseDto(db,current,snapshot.clock,now):null;
 const game=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{courtEstateProjection:snapshot.courtEstateProjection||null,isAdmin:!!current.is_admin,isDeputy:!!current.is_deputy,isStaff:!!current.is_staff,isCourtProtected:!!current.is_court_protected,staffBase:shared});
 await h.requireAccountAccess(db,user);
 return{...snapshot,campaignId,sequence:found.sequence,troopTransferSequence:game.state.troopTransferSequence,troopTransfer:game.troopTransferStatus(),branchResolvedElapsedMs:found.resolvedElapsedMs,branchState:{branches:clone(snapshot.save.state.branches),jobs:clone(snapshot.save.state.jobs.filter(job=>job.kind==='branch'))},parents:PARENTS.map(id=>game.branchStatus(id))};
}
async function prior(ctx,requestId,digest){
 const row=await stmt(ctx.db,'SELECT request_hash,commit_token,result_json FROM branch_requests WHERE actor_id=? AND request_id=? UNION ALL SELECT request_hash,commit_token,result_json FROM branch_deployment_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId,ctx.user.id,requestId).first();
 if(row&&row.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の支拠点操作に使用されています。');return row;
}
async function response(ctx,record,deviceId,idempotent){
 const{db,user,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 const snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,user.id),await h.getUser(db,user.id),deviceId,Date.now());
 return{...await status(ctx,snapshot),result:JSON.parse(record.result_json),idempotent};
}
function input(raw,action,h){
 const common=['requestId','deviceId','expectedRevision','campaignId','sequence'],facility=action==='build-facility'||action==='upgrade-facility',commander=action==='assign-commander'||action==='remove-commander',extra=action==='transfer-troops'?['from','to','troops']:commander?['branchId','officerId']:action==='build'?['parentCastleId','direction']:facility?['branchId','facilityId']:['branchId'];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!common.includes(key)&&!extra.includes(key)))h.fail(400,'INVALID_INPUT','支拠点操作の送信項目を確認してください。');
 const body={};for(const key of ['requestId','deviceId','campaignId']){body[key]=h.idField(raw[key],key);if(body[key].length>90)h.fail(400,'INVALID_INPUT','操作番号が長すぎます。');}
 for(const key of ['sequence','expectedRevision']){if(!Number.isSafeInteger(raw[key])||raw[key]<0||raw[key]>1000000000)h.fail(400,'INVALID_INPUT','更新番号が正しくありません。');body[key]=raw[key];}
 if(action==='transfer-troops'){
  for(const key of ['from','to']){if(typeof raw[key]!=='string'||!/^(army|(?:castle|branch):[a-z][a-z0-9_]{0,80})$/.test(raw[key]))h.fail(400,'INVALID_TROOP_ENDPOINT','兵を移動する拠点を選んでください。');body[key]=raw[key];}
  if(!Number.isSafeInteger(raw.troops)||raw.troops<1||raw.troops>GameEngine.ASSET_CAP)h.fail(400,'INVALID_TROOP_AMOUNT','移動する兵数を1人以上の整数で指定してください。');body.troops=raw.troops;
 }else if(action==='build'){
  if(!PARENTS.includes(raw.parentCastleId)||!DIRECTIONS.includes(raw.direction))h.fail(400,'INVALID_BRANCH_PARENT','江戸・二条・大坂・名古屋の拠点と東西南北の方角を選んでください。京都御所には支拠点を建設できません。');
  body.parentCastleId=raw.parentCastleId;body.direction=raw.direction;
 }else{body.branchId=h.idField(raw.branchId,'支拠点');if(action==='auto-assign-officers'&&body.branchId!=='all')h.fail(400,'INVALID_BRANCH_SCOPE','全支拠点と施設のおまかせ配置を指定してください。');if(commander)body.officerId=h.idField(raw.officerId,'武将');if(facility){body.facilityId=h.idField(raw.facilityId,'支拠点施設');if(!globalThis.SENGOKU_DATA.branchFacilities.some(def=>def.id===body.facilityId))h.fail(400,'INVALID_BRANCH_FACILITY','支拠点に建設できる施設を選んでください。');}}
 return body;
}
async function mutation(ctx,action){
 const{db,user,helpers:h}=ctx,body=input(await h.readBody(ctx.request),action,h),deployment=DEPLOYMENTS.includes(action),gate=deployment?DEPLOYMENT_GATE:GATE;
 const intent={action,campaignId:body.campaignId,sequence:body.sequence,...Object.fromEntries(Object.entries(body).filter(([key])=>!['requestId','deviceId','expectedRevision','campaignId','sequence'].includes(key)))};
 const digest=await h.hash(JSON.stringify(intent)),previous=await prior(ctx,body.requestId,digest);if(previous)return response(ctx,previous,body.deviceId,true);
 const row=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,ctx.now),clock=await h.getWorldClock(db,ctx.now);
 const save=h.normalizeGameSave(JSON.parse(row.save_json),user,ctx.now,{reading:true,clock});
 if(save.state.walking.campaignId!==body.campaignId)h.fail(409,'BRANCH_SCOPE_CHANGED','物語が切り替わりました。支拠点を確認してください。');
 if(!save.state.worldClock||save.state.worldClock.id!==clock.id)h.fail(409,'CLOCK_ANCHOR_REQUIRED','先に本拠を共通時計へ同期してください。');
 if(Math.abs(clock.elapsedMs-save.state.worldClock.elapsedMs)>15000)h.fail(409,'CLOCK_STALE','共通時計と本拠を同期してから操作してください。');
 if(!clock.running)h.fail(409,'WORLD_PAUSED','共通時間が停止中です。');
 const found=await branchStateGuard(db,user.id,body.campaignId);if(found.sequence!==body.sequence)h.fail(409,'BRANCH_STATE_CHANGED','支拠点が更新されました。最新の状態を確認してください。');applyBranchProgress(save,found.state,clock);
 const movement=await troopTransferGuard(db,user.id,body.campaignId);if((save.state.troopTransferSequence||0)!==movement.sequence)h.fail(409,'TROOP_STATE_CHANGED','兵の配置が更新されました。最新の保存状態を読み込んでください。');
 const shared=user.is_staff&&!user.is_admin?await h.staffBaseDto(db,user,clock,ctx.now):null;
 const maintenanceAuthority=protectMaintenance(found,await maintenanceContext(db,user.id,save,clock));
 if(maintenanceAuthority.hasMore||maintenanceAuthority.asOfElapsedMs>clock.elapsedMs)h.fail(409,'CLOCK_STALE','維持費の時間経過を同期しています。最新の保存へ同期してください。');
 const courtEstate=await h.courtEstateContext(db,user,save,clock,ctx.now);
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection:courtEstate.projection,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,staffBase:shared,maintenanceAuthority,branchAuthority:{resolvedElapsedMs:found.resolvedElapsedMs}});
 const advanced=game.applyWorldClock(clock,{maxSeconds:60});
 if(!advanced.ok||advanced.pending||advanced.courtEstatePending||advanced.settlementRequired)h.fail(409,'CLOCK_STALE','京都御所の領有期間と共通時刻を同期してから操作してください。');
 const result=action==='transfer-troops'?game.transferTroops(body.from,body.to,body.troops):action==='auto-assign-officers'?game.autoAssignGovernors():action==='auto-assign-commanders'?game.autoAssignBranchCommanders(body.branchId):action==='assign-commander'?game.assignBranchCommander(body.branchId,body.officerId):action==='remove-commander'?game.removeBranchCommander(body.branchId,body.officerId):action==='build'?game.buildBranch(body.parentCastleId,body.direction):action==='upgrade'?game.upgradeBranch(body.branchId):action==='repair'?game.repairBranch(body.branchId):action==='build-facility'?game.buildBranchFacility(body.branchId,body.facilityId):game.upgradeBranchFacility(body.branchId,body.facilityId);
 if(!result.ok)h.fail(409,result.code||'BRANCH_UNAVAILABLE',result.message);
 // Only the new tail may acquire a deadline. Earlier reservations remain
 // tied to their original authoritative completion, including across retries.
 const chain=deployment?[]:game.state.jobs.filter(job=>job.kind==='branch'&&job.id===result.branchId);
 const tail=chain.at(-1),previousEnd=chain.at(-2)?.completesElapsedMs;
 if(tail){
  const starts=Number.isSafeInteger(previousEnd)?Math.max(previousEnd,clock.elapsedMs):
    clock.elapsedMs+Math.round(Number(result.startsInSeconds||0)*1000);
  tail.completesElapsedMs=starts+tail.totalSeconds*1000;
 }
 await h.budget(db,'branches:'+user.id,60,60000,ctx.now);
 const now=Date.now(),next=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),nonce=crypto.randomUUID(),role=withCourtEstateGuard(guardLordSupport(h.roleCommitGuard(user),user),courtEstate),gateArgs=[user.id,body.requestId,nonce];
 // The immutable receipt table records build/upgrade/repair categories. The
 // exact facility/automatic assignment operation and target are bound by the request hash and
 // retained in result_json; reusing an ID across either scope still conflicts.
 const ledgerAction=action==='build-facility'?'build':action==='upgrade-facility'?'upgrade':action==='auto-assign-commanders'||action==='auto-assign-officers'?'assign-commander':action;
 const cpuLosses=await prepareResidencyCpuLosses(db,{userId:user.id,events:game.takeHomeDefenseLosses(),now,state:next.state});
 const sharedGuard=shared?{sql:"EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)",args:[shared.revision]}:{sql:'1=1',args:[]};
 const statements=[stmt(db,`INSERT INTO ${deployment?'branch_deployment_requests':'branch_requests'}(actor_id,request_id,campaign_id,sequence,action,request_hash,commit_token,result_json,created_at)
  SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>? AND COALESCE(json_extract(save_json,'$.state.walking.campaignId'),'legacy_v1')=?)
  AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${role.sql} AND ${found.guard.sql} AND ${movement.guard.sql} AND ${sharedGuard.sql} AND ${cpuLosses.guard.sql}
  ON CONFLICT(actor_id,request_id) DO NOTHING`,user.id,body.requestId,body.campaignId,body.sequence,ledgerAction,digest,nonce,JSON.stringify(result),now,user.id,body.expectedRevision,body.deviceId,now,body.campaignId,h.worldClockId,clock.revision,...role.args,...found.guard.args,...movement.guard.args,...sharedGuard.args,...cpuLosses.guard.args),
  stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(next),now,now+h.syncLease,user.id,...gateArgs),
  ...branchProgressStatements(db,user.id,next,now,gate,gateArgs,{resolvedElapsedMs:clock.elapsedMs}),
  ...(h.covertIncidentStatements?h.covertIncidentStatements(db,user.id,next,now,gate,gateArgs):[])
 ];
 if(action==='transfer-troops')statements.push(stmt(db,`INSERT INTO troop_transfer_states(actor_id,campaign_id,sequence,updated_at)
  SELECT ?,?,?,? WHERE ${gate} ON CONFLICT(actor_id,campaign_id) DO UPDATE SET sequence=excluded.sequence,updated_at=excluded.updated_at`,user.id,body.campaignId,next.state.troopTransferSequence,now,...gateArgs));
 statements.push(...cpuLosses.statements(gate,gateArgs));
 // Time advancement can reduce the personal garrison for upkeep even when
 // this particular command does not transfer troops to or from that castle.
 const progress=game.getStaffPersonalProgress?.();
 const personal=h.staffPersonalProgressStatement?await h.staffPersonalProgressStatement(db,user,next,now,gate,gateArgs,progress):null;
 if(personal)statements.push(personal);
 await db.batch(statements);const committed=await prior(ctx,body.requestId,digest);
 if(!committed){await h.requireAccountAccess(db,user);h.fieldWriter(await h.getSyncRow(db,user.id),body.deviceId,body.expectedRevision,Date.now());h.fail(409,'BRANCH_STATE_CHANGED','支拠点・保存・利用資格が更新されました。最新の状態を確認してください。');}
 return response(ctx,committed,body.deviceId,committed.commit_token!==nonce);
}
export async function handleBranches(ctx){
 const{db,user,helpers:h,path,method,url}=ctx;await h.requireAccountAccess(db,user);
 if(path==='/branches'&&method==='GET'){if([...url.searchParams.keys()].some(key=>key!=='deviceId'))h.fail(400,'INVALID_INPUT','支拠点一覧の指定を確認してください。');return status(ctx);}
 const action=path.slice('/branches/'.length);if(method==='POST'&&['build','upgrade','repair','build-facility','upgrade-facility',...DEPLOYMENTS].includes(action))return mutation(ctx,action);
 h.fail(404,'NOT_FOUND','その支拠点操作は見つかりませんでした。');
}
