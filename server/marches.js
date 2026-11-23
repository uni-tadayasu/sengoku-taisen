import {maintenanceContext,protectMaintenance} from './maintenance.js';
// Durable main-army movement. Only the original departure transaction can
// reserve troops; only a pending-row CAS can resolve or refund the escrow.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {prepareResidencyCpuLosses} from './residency.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),R=x=>x?.results||[];
export const MARCH_GATE="EXISTS(SELECT 1 FROM battle_marches WHERE id=? AND status='marching' AND commit_token=?)";
export function marchDto(row,clock,now=Date.now()){
 if(!row)return null;const payload=JSON.parse(row.payload_json),result=row.result_json?JSON.parse(row.result_json):null;
 return{id:row.id,requestId:row.request_id,kind:row.kind,status:row.status,timeBasis:'world',sourceCastleId:row.source_castle_id,sourceName:payload.marker?.travel?.sourceName||row.source_castle_id,targetCastleId:row.target_castle_id,targetPlayerId:row.target_player_id||null,targetName:row.target_name,distanceKm:Number(row.distance_km),durationMs:Number(row.duration_ms),departedAtMs:Number(row.departed_ms),arrivesAtMs:Number(row.arrives_ms),remainingMs:row.status==='marching'?Math.max(0,Number(row.arrives_ms)-Number(clock.elapsedMs)):0,troops:Number(row.troops),...(payload.rally?{operationId:payload.rally.operationId}:{}),travel:payload.marker?.travel||payload.nativeMarch?.travel||null,...(result?{battle:result.battle||null,message:result.message||'',resolvedAt:result.resolvedAt||null}:{message:'目的地へ進軍しています。到着後に戦況を確認して合戦を行います。'})};
}
export async function findMarch(db,actorId,requestId){return S(db,'SELECT * FROM battle_marches WHERE actor_id=? AND request_id=?',actorId,requestId).first();}
export async function activeMarch(db,actorId){return S(db,"SELECT * FROM battle_marches WHERE actor_id=? AND status='marching'",actorId).first();}
export async function battleMarches(db,actorId,clock,now){
 const values=R(await S(db,'SELECT * FROM battle_marches WHERE actor_id=? ORDER BY created_at DESC,id DESC LIMIT 30',actorId).all());
 return{active:values.filter(x=>x.status==='marching').map(x=>marchDto(x,clock,now)),history:values.filter(x=>x.status!=='marching').slice(0,20).map(x=>marchDto(x,clock,now))};
}
export function serverMarchMarker(record){return JSON.parse(record.payload_json).marker;}
export async function restoreServerMarch(db,actorId,save){
 if(!save)return save;const row=await activeMarch(db,actorId);
 if(row)save.state.march=serverMarchMarker(row);
 else if(save.state.march?.authority==='server')save.state.march=null;
 return save;
}
export function marchRecord({user,requestId,kind,save,travel,targetPlayerId=null,targetCampaignId=null,targetName,troops,tactic,foodCost,commandCost=1,clock,now,digest,payload={}}){
 const id='bm_'+crypto.randomUUID().replaceAll('-',''),departed=Math.floor(clock.elapsedMs),arrives=departed+travel.durationMs;
 const marker={version:1,authority:'server',id,kind,campaignId:save.state.walking.campaignId,cycle:Math.floor(departed/(672*60000)),clan:save.state.clan,sourceCastleId:travel.sourceCastleId,targetCastleId:travel.targetCastleId,...(targetPlayerId?{targetPlayerId}:{}),...(payload.body?.targetBranchId?{targetBranchId:payload.body.targetBranchId}:{}),troops,tactic,foodCost,commandCost,departedElapsedMs:departed,arrivesElapsedMs:arrives,travel};
 return{id,actor_id:user.id,request_id:requestId,kind,campaign_id:marker.campaignId,source_castle_id:travel.sourceCastleId,target_castle_id:travel.targetCastleId,target_player_id:targetPlayerId,target_campaign_id:targetCampaignId,target_name:targetName,troops,food_cost:foodCost,command_cost:commandCost,departed_ms:departed,arrives_ms:arrives,duration_ms:travel.durationMs,distance_km:travel.distanceKm,status:'marching',request_hash:digest,payload_json:JSON.stringify({...payload,marker}),result_json:null,commit_token:crypto.randomUUID(),revision:0,created_at:now,updated_at:now};
}
export function insertMarch(db,row,guard,args){
 const columns=['id','actor_id','request_id','kind','campaign_id','source_castle_id','target_castle_id','target_player_id','target_campaign_id','target_name','troops','food_cost','command_cost','departed_ms','arrives_ms','duration_ms','distance_km','status','request_hash','payload_json','commit_token','created_at','updated_at'];
 return S(db,`INSERT INTO battle_marches(${columns.join(',')}) SELECT ${columns.map(()=>'?').join(',')} WHERE ${guard} AND NOT EXISTS(SELECT 1 FROM battle_marches WHERE actor_id=? AND status='marching') ON CONFLICT DO NOTHING`,...columns.map(k=>row[k]),...args,row.actor_id);
}
export function finishMarchStatement(db,row,status,result,now,parentGate,parentArgs){return S(db,`UPDATE battle_marches SET status=?,result_json=?,revision=revision+1,updated_at=? WHERE id=? AND status='marching' AND revision=? AND ${parentGate}`,status,JSON.stringify({...result,resolvedAt:new Date(now).toISOString()}),now,row.id,row.revision,...parentArgs);}
export async function advanceReservedMarch(ctx,saved,clock){
 const {db,user,now,helpers:h}=ctx,save=h.normalizeGameSave(JSON.parse(saved.save_json),user,now,{reading:true,clock}),before=JSON.parse(JSON.stringify(save));
 if(h.reconcileCovertProgress)await h.reconcileCovertProgress(db,user.id,save);
 const branches=await h.branchStateGuard(db,user.id,save.state.walking.campaignId);await h.reconcileBranchProgress(db,user.id,save,clock);
 const shared=user.is_staff&&!user.is_admin?await h.staffBaseDto(db,user,clock,now):null;
 const maintenanceAuthority=protectMaintenance(branches,await maintenanceContext(db,user.id,save,clock));
 if(maintenanceAuthority.hasMore||maintenanceAuthority.asOfElapsedMs>clock.elapsedMs)h.fail(409,'CLOCK_STALE','維持費の時間経過を同期しています。最新の保存へ同期してください。');
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isStaff:!!user.is_staff,staffBase:shared,maintenanceAuthority,branchAuthority:{resolvedElapsedMs:branches.resolvedElapsedMs}});
 // Keep the server marker present: travelling troops cannot defend the home or
 // earn income from a castle they have not reached. Stop before a new cycle so
 // the existing cycle receipt transaction remains the sole award authority.
 const result=game.applyWorldClock(clock,{maxSeconds:86400,deferCycleSettlement:true});
 if(!result.ok||result.pending)h.fail(409,'MARCH_RETRY','進軍中の本拠を共通時刻へ同期しています。');
 const next=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),guard={sql:branches.guard.sql+(shared?" AND EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)":''),args:[...branches.guard.args,...(shared?[shared.revision]:[])]};
 return{save:next,before,game,branches:{...branches,guard},result,resolvedElapsedMs:next.state.worldClock?.elapsedMs||0};
}
export async function cancelBattleMarch(ctx,row,message,extraStatements=()=>[]){
 const {db,user,now,helpers:h}=ctx,current=await S(db,'SELECT * FROM battle_marches WHERE id=?',row.id).first();
 if(!current||current.status!=='marching')return false;
 const saved=await h.getSyncRow(db,user.id);if(!saved?.save_json)return false;
 const clock=await h.getWorldClock(db,now),journey=await advanceReservedMarch(ctx,saved,clock),save=journey.save;
 save.state.troops=Math.min(100000000,save.state.troops+(row.kind==='rally'?0:Number(row.troops)));
 save.state.resources.rice=Math.min(100000000,save.state.resources.rice+Number(row.food_cost));
 save.state.command=Math.min(user.is_staff&&!user.is_admin?7:3+Math.floor(save.state.buildings.keep/8),save.state.command+Number(row.command_cost));
 if(save.state.march?.id===row.id)save.state.march=null;
 const cpuLosses=await prepareResidencyCpuLosses(db,{userId:user.id,events:journey.game.takeHomeDefenseLosses?.()||[],now,state:save.state});
 const result={message,battle:null,refund:{troops:row.kind==='rally'?0:Number(row.troops),rice:Number(row.food_cost),command:Number(row.command_cost)}},nonce=crypto.randomUUID();
 const guard="EXISTS(SELECT 1 FROM battle_marches WHERE id=? AND status='cancelled' AND commit_token=?)",args=[row.id,nonce];
 const role=user.ban_active?{sql:"(?=CASE WHEN ?=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') THEN 1 ELSE 0 END) AND COALESCE((SELECT COALESCE(sm.term_id,'legacy:'||sm.appointed_at) FROM staff_members sm WHERE sm.user_id=?),'')=?",args:[user.is_admin?1:0,user.id,user.id,user.staff_term||'']}:h.roleCommitGuard(user);
 const statements=[S(db,`UPDATE battle_marches SET status='cancelled',result_json=?,commit_token=?,revision=revision+1,updated_at=? WHERE id=? AND status='marching' AND revision=? AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?) AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${journey.branches.guard.sql} AND ${role.sql} AND ${cpuLosses.guard.sql}`,JSON.stringify({...result,resolvedAt:new Date(now).toISOString()}),nonce,now,row.id,current.revision,user.id,saved.revision,h.worldClockId,clock.revision,...journey.branches.guard.args,...role.args,...cpuLosses.guard.args),S(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${guard}`,JSON.stringify(h.normalizeGameSave(save,user,now,{clock})),now,user.id,...args),...h.branchProgressStatements(db,user.id,save,now,guard,args,{resolvedElapsedMs:journey.resolvedElapsedMs}),...h.covertIncidentStatements(db,user.id,save,now,guard,args),...extraStatements(guard,args),...cpuLosses.statements(guard,args)];
 const personal=h.staffPersonalProgressStatement?await h.staffPersonalProgressStatement(db,user,save,now,guard,args,journey.game.getStaffPersonalProgress?.()):null;if(personal)statements.push(personal);
 if(h.saveAchievements)for(const event of h.saveAchievements(journey.before,save))statements.push(h.achievementStatement(db,user.id,event,now,guard,args));
 await db.batch(statements);return (await S(db,'SELECT status FROM battle_marches WHERE id=?',row.id).first())?.status==='cancelled';
}
export async function replayMarch(ctx,row,deviceId,idempotent=true){
 const {db,user,now,helpers:h}=ctx,clock=await h.getWorldClock(db,now),snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,user.id),user,deviceId,now),dto=marchDto(row,clock,now),result=row.result_json?JSON.parse(row.result_json):null;
 return{...snapshot,accepted:row.status==='marching',marching:row.status==='marching',march:dto,battle:result?.battle||null,idempotent};
}
