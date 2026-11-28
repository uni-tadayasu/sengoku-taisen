import {withCourtEstateGuard} from './court-estate-guard.js';
import {maintenanceContext,protectMaintenance,externalTroopSnapshotStatements} from './maintenance.js';
// Sender-owned troop depots in castles with no current player lord. The depot
// neither grants residence nor transfers the castle's ordinary NPC soldiers.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {branchStateGuard,applyBranchProgress,branchProgressStatements,troopTransferGuard} from './branches.js';
import {prepareResidencyCpuLosses} from './residency.js';

const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=value=>value?.results||[];
const CAP=100000000,SEQUENCE_CAP=1000000000;
const GATE='EXISTS(SELECT 1 FROM vacant_garrison_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const CASTLES=new Map(globalThis.SENGOKU_DATA.castles.map(c=>[c.id,{id:c.id,name:c.name,majorCity:!!c.majorCity}]));
// An abandoned campaign does not reserve an otherwise vacant destination.
const ACTIVE_CAMPAIGN="COALESCE(json_extract(ps.save_json,'$.state.walking.campaignId'),'legacy_v1')=vg.campaign_id";

async function ownGarrison(db,userId,campaignId,castleId){
 const row=await stmt(db,'SELECT * FROM vacant_garrisons WHERE actor_id=? AND campaign_id=? AND castle_id=?',userId,campaignId,castleId).first();
 const guard=row?{sql:'EXISTS(SELECT 1 FROM vacant_garrisons WHERE actor_id=? AND campaign_id=? AND castle_id=? AND sequence=? AND troops=?)',args:[userId,campaignId,castleId,row.sequence,row.troops]}:{sql:'NOT EXISTS(SELECT 1 FROM vacant_garrisons WHERE actor_id=? AND campaign_id=? AND castle_id=?)',args:[userId,campaignId,castleId]};
 return{row,troops:Number(row?.troops||0),sequence:Number(row?.sequence||0),guard};
}
function otherGarrisonGuard(userId,castleId){return{sql:`NOT EXISTS(SELECT 1 FROM vacant_garrisons vg JOIN player_saves ps ON ps.user_id=vg.actor_id WHERE vg.castle_id=? AND vg.actor_id<>? AND vg.troops>0 AND ${ACTIVE_CAMPAIGN})`,args:[castleId,userId]};}
async function status(ctx,snapshot=null){
 const{db,user,helpers:h}=ctx,now=Date.now(),current=await h.getUser(db,user.id);
 await h.requireAccountAccess(db,user);h.registerResponseGuard?.(h.roleCommitGuard(current));
 snapshot=snapshot||await h.syncSnapshot(db,await h.getSyncRow(db,user.id),current,ctx.url.searchParams.get('deviceId')||null,now);
 const empty={ok:true,...snapshot,campaignId:null,commandCost:1,command:{current:0,max:0},army:{troops:0,capacity:0,transportCapacity:0,recruitmentCapacity:0,recallCapacity:0},garrisons:[],availableCastles:[]};
 if(!snapshot.save)return empty;
 const campaignId=snapshot.save.state.walking.campaignId,game=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{courtEstateProjection:snapshot.courtEstateProjection||null,isAdmin:!!current.is_admin,isDeputy:!!current.is_deputy,isStaff:!!current.is_staff,isCourtProtected:!!current.is_court_protected,staffBase:snapshot.staffBase||null});
 const owned=rows(await stmt(db,'SELECT castle_id,troops FROM vacant_garrisons WHERE actor_id=? AND campaign_id=? AND troops>0 ORDER BY castle_id',user.id,campaignId).all());
 const occupied=rows(await stmt(db,`SELECT DISTINCT vg.castle_id FROM vacant_garrisons vg JOIN player_saves ps ON ps.user_id=vg.actor_id WHERE vg.actor_id<>? AND vg.troops>0 AND ${ACTIVE_CAMPAIGN}`,user.id).all());
 const blocked=new Set(occupied.map(row=>row.castle_id)),vacant=await h.listVacantCastles(db,current,snapshot.clock,now),vacantIds=new Set(vacant.map(row=>row.id)),ownByCastle=new Map(owned.map(row=>[row.castle_id,Number(row.troops)]));
 const troops=game.state.troops,recruitmentCapacity=game.availableTroopCapacity(),transportCapacity=game.troopTransportCapacity(),recallCapacity=Math.max(0,transportCapacity-troops);
 const availableCastles=vacant.filter(c=>!blocked.has(c.id)).map(c=>({castleId:c.id,castleName:c.name,majorCity:!!c.majorCity,stationedTroops:ownByCastle.get(c.id)||0,maxSend:Math.max(0,Math.min(troops,CAP-(ownByCastle.get(c.id)||0)))}));
 const garrisons=owned.filter(row=>CASTLES.has(row.castle_id)).map(row=>{
  const c=CASTLES.get(row.castle_id),troops=Number(row.troops),canSend=vacantIds.has(c.id)&&!blocked.has(c.id);
  return{castleId:c.id,castleName:c.name,majorCity:c.majorCity,troops,canSend,sendReason:canSend?'':blocked.has(c.id)?'ほかの領主の兵が配置されたため、追加の兵は送れません。':'この城に領主がいるため、追加の兵は送れません。',maxSend:canSend?Math.max(0,Math.min(game.state.troops,CAP-troops)):0,maxRecall:Math.min(troops,recallCapacity)};
 });
 await h.requireAccountAccess(db,user);
 return{ok:true,...snapshot,campaignId,commandCost:1,command:{current:game.state.command,max:game.commandMax()},army:{troops,capacity:transportCapacity,transportCapacity,recruitmentCapacity,recallCapacity},garrisons,availableCastles};
}
async function prior(ctx,requestId,digest){
 const record=await stmt(ctx.db,'SELECT * FROM vacant_garrison_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId).first();
 if(record&&record.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の兵の輸送に使用されています。');
 return record;
}
async function response(ctx,record,deviceId,idempotent){
 const{db,user,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 const snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,user.id),await h.getUser(db,user.id),deviceId,Date.now());
 return{...await status(ctx,snapshot),result:JSON.parse(record.result_json),idempotent};
}
function input(raw,h){
 const allowed=['castleId','troops','requestId','deviceId','expectedRevision','campaignId'];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!allowed.includes(key)))h.fail(400,'INVALID_INPUT','兵の輸送の送信項目を確認してください。');
 const body={};for(const key of ['castleId','requestId','deviceId','campaignId']){body[key]=h.idField(raw[key],key);if(body[key].length>90)h.fail(400,'INVALID_INPUT','兵の輸送の識別子が長すぎます。');}
 if(!CASTLES.has(body.castleId))h.fail(400,'INVALID_GARRISON_CASTLE','全国地図にある城を選んでください。');
 if(!Number.isSafeInteger(raw.troops)||raw.troops<1||raw.troops>CAP)h.fail(400,'INVALID_TROOP_AMOUNT','移動する兵数を1人以上の整数で指定してください。');
 if(!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0||raw.expectedRevision>SEQUENCE_CAP)h.fail(400,'INVALID_INPUT','保存の更新番号を確認してください。');
 return{...body,troops:raw.troops,expectedRevision:raw.expectedRevision};
}
async function mutation(ctx,action){
 const{db,user,helpers:h}=ctx,body=input(await h.readBody(ctx.request),h),digest=await h.hash(JSON.stringify({action,castleId:body.castleId,troops:body.troops,campaignId:body.campaignId}));
 // A committed transport remains acknowledged after a new lord arrives, the
 // writer changes or the player starts a different campaign.
 const previous=await prior(ctx,body.requestId,digest);if(previous)return response(ctx,previous,body.deviceId,true);
 const row=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,ctx.now),clock=await h.getWorldClock(db,ctx.now);
 const save=h.normalizeGameSave(JSON.parse(row.save_json),user,ctx.now,{reading:true,clock});
 if(save.state.walking.campaignId!==body.campaignId)h.fail(409,'GARRISON_SCOPE_CHANGED','物語が切り替わりました。現在の兵の配置を確認してください。');
 if(!save.state.worldClock||save.state.worldClock.id!==clock.id)h.fail(409,'CLOCK_ANCHOR_REQUIRED','先に本拠を共通時計へ同期してください。');
 if(Math.abs(clock.elapsedMs-save.state.worldClock.elapsedMs)>15000)h.fail(409,'CLOCK_STALE','共通時計と本拠を同期してから兵を移動してください。');
 if(!clock.running)h.fail(409,'WORLD_PAUSED','共通時間が停止中です。');
 const branch=await branchStateGuard(db,user.id,body.campaignId);applyBranchProgress(save,branch.state,clock);
 const movement=await troopTransferGuard(db,user.id,body.campaignId);if((save.state.troopTransferSequence||0)!==movement.sequence)h.fail(409,'TROOP_STATE_CHANGED','兵の配置が更新されました。最新の保存状態を読み込んでください。');
 if(movement.sequence>=SEQUENCE_CAP)h.fail(409,'TROOP_SEQUENCE_LIMIT','兵の移動記録が上限に達しました。');
 const stationed=await ownGarrison(db,user.id,body.campaignId,body.castleId),castle=CASTLES.get(body.castleId);
 if(stationed.sequence>=SEQUENCE_CAP)h.fail(409,'GARRISON_SEQUENCE_LIMIT','この城への輸送記録が上限に達しました。');
 let vacancy={guard:{sql:'1=1',args:[]}},other={sql:'1=1',args:[]};
 if(action==='send'){
  vacancy=await h.vacantCastleGuard(db,user,body.castleId,clock,ctx.now);
  if(!vacancy?.vacant)h.fail(409,'GARRISON_CASTLE_OCCUPIED','この城には領主がいます。空いている城を選んでください。');
  other=otherGarrisonGuard(user.id,body.castleId);
  if(!await stmt(db,'SELECT 1 AS available WHERE '+other.sql,...other.args).first())h.fail(409,'GARRISON_CASTLE_RESERVED','この城にはほかの領主の兵が配置されています。');
 }
 const shared=user.is_staff&&!user.is_admin?await h.staffBaseDto(db,user,clock,ctx.now):null;
 const maintenanceAuthority=protectMaintenance(branch,await maintenanceContext(db,user.id,save,clock));
 if(maintenanceAuthority.hasMore||maintenanceAuthority.asOfElapsedMs>clock.elapsedMs)h.fail(409,'CLOCK_STALE','維持費の時間経過を同期しています。最新の保存へ同期してください。');
 const courtEstate=await h.courtEstateContext(db,user,save,clock,ctx.now);
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection:courtEstate.projection,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,staffBase:shared,maintenanceAuthority,branchAuthority:{resolvedElapsedMs:branch.resolvedElapsedMs}});
 const advanced=game.applyWorldClock(clock,{maxSeconds:60,deferCycleSettlement:true});
 if(!advanced.ok||advanced.pending||advanced.courtEstatePending||advanced.settlementRequired)h.fail(409,'CLOCK_STALE','共通時計と本拠を同期してから兵を移動してください。');
 if(game.state.gameOver)h.fail(409,'GARRISON_UNAVAILABLE','本拠の状態を確認してから兵を移動してください。');
 if(game.state.command<1)h.fail(409,'NO_COMMANDS','兵の移動には指令を1回使用します。回復してからお試しください。');
 const armyBefore=game.state.troops,garrisonBefore=stationed.troops;
 if(action==='send'&&body.troops>armyBefore)h.fail(409,'INSUFFICIENT_TROOPS','手元の軍勢の兵が足りません。');
 if(action==='send'&&garrisonBefore+body.troops>CAP)h.fail(409,'GARRISON_CAPACITY','この城に配置できる兵数の上限を超えます。');
 if(action==='recall'&&body.troops>garrisonBefore)h.fail(409,'INSUFFICIENT_GARRISON_TROOPS','この城に配置している兵が足りません。');
 if(action==='recall'&&armyBefore+body.troops>game.troopTransportCapacity())h.fail(409,'TROOP_CAPACITY','出陣中の兵が帰還する枠を含めると、兵の輸送で受け入れられる総数上限を超えます。拠点の収容人数とは別枠です。配置中の兵はそのまま保管されます。');
 const delta=action==='send'?body.troops:-body.troops,armyAfter=armyBefore-delta,garrisonAfter=garrisonBefore+delta;
 const message=action==='send'?`${castle.name}に兵${body.troops.toLocaleString()}人を配置しました。`:`${castle.name}から兵${body.troops.toLocaleString()}人が手元の軍勢へ帰還しました。`;
 game.state.troops=armyAfter;game.state.command--;game.state.troopTransferSequence=movement.sequence+1;game.log(message,'army');
 const result={requestId:body.requestId,action,castleId:castle.id,castleName:castle.name,troops:body.troops,armyBefore,armyAfter,garrisonBefore,garrisonAfter,commandCost:1,message};
 await h.budget(db,'troop-garrisons:'+user.id,60,60000,ctx.now);
 const now=Date.now(),next=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),nonce=crypto.randomUUID(),role=withCourtEstateGuard(h.roleCommitGuard(user),courtEstate),gateArgs=[user.id,body.requestId,nonce];
 const sharedGuard=shared?{sql:"EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)",args:[shared.revision]}:{sql:'1=1',args:[]};
 const cpuLosses=await prepareResidencyCpuLosses(db,{userId:user.id,events:game.takeHomeDefenseLosses(),now,state:next.state});
 const guards=[role,branch.guard,movement.guard,stationed.guard,vacancy.guard,other,sharedGuard,cpuLosses.guard];
 const statements=[stmt(db,`INSERT INTO vacant_garrison_requests(actor_id,request_id,campaign_id,action,request_hash,commit_token,result_json,created_at)
  SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>? AND COALESCE(json_extract(save_json,'$.state.walking.campaignId'),'legacy_v1')=?)
  AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=? AND running=1) AND ${guards.map(g=>'('+g.sql+')').join(' AND ')}
  ON CONFLICT(actor_id,request_id) DO NOTHING`,user.id,body.requestId,body.campaignId,action,digest,nonce,JSON.stringify(result),now,user.id,body.expectedRevision,body.deviceId,now,body.campaignId,h.worldClockId,clock.revision,...guards.flatMap(g=>g.args)),
  stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${GATE}`,JSON.stringify(next),now,now+h.syncLease,user.id,...gateArgs),
  stmt(db,`INSERT INTO vacant_garrisons(actor_id,campaign_id,castle_id,troops,sequence,updated_at)
   SELECT ?,?,?,?,?,? WHERE ${GATE} ON CONFLICT(actor_id,campaign_id,castle_id) DO UPDATE SET troops=excluded.troops,sequence=excluded.sequence,updated_at=excluded.updated_at`,user.id,body.campaignId,body.castleId,garrisonAfter,stationed.sequence+1,now,...gateArgs),
  stmt(db,`INSERT INTO troop_transfer_states(actor_id,campaign_id,sequence,updated_at)
   SELECT ?,?,?,? WHERE ${GATE} ON CONFLICT(actor_id,campaign_id) DO UPDATE SET sequence=excluded.sequence,updated_at=excluded.updated_at`,user.id,body.campaignId,next.state.troopTransferSequence,now,...gateArgs),
  ...branchProgressStatements(db,user.id,next,now,GATE,gateArgs,{resolvedElapsedMs:clock.elapsedMs}),
  ...(h.covertIncidentStatements?h.covertIncidentStatements(db,user.id,next,now,GATE,gateArgs):[]),
  ...cpuLosses.statements(GATE,gateArgs)
 ];
 const personal=h.staffPersonalProgressStatement?await h.staffPersonalProgressStatement(db,user,next,now,GATE,gateArgs,game.getStaffPersonalProgress?.()):null;if(personal)statements.push(personal);
 statements.push(...externalTroopSnapshotStatements(db,[user.id],clock,GATE,gateArgs));
 await db.batch(statements);const committed=await prior(ctx,body.requestId,digest);
 if(!committed){await h.requireAccountAccess(db,user);h.fieldWriter(await h.getSyncRow(db,user.id),body.deviceId,body.expectedRevision,Date.now());h.fail(409,'GARRISON_STATE_CHANGED','城の領主・兵の配置・保存状態が更新されました。最新の状態を確認してください。');}
 return response(ctx,committed,body.deviceId,committed.commit_token!==nonce);
}
export async function handleVacantGarrisons(ctx){
 const{helpers:h,path,method,url}=ctx;await h.requireAccountAccess(ctx.db,ctx.user);
 if(path==='/troop-garrisons'&&method==='GET'){if([...url.searchParams.keys()].some(key=>key!=='deviceId'))h.fail(400,'INVALID_INPUT','兵の配置一覧の指定を確認してください。');return status(ctx);}
 if(method==='POST'&&['/troop-garrisons/send','/troop-garrisons/recall'].includes(path))return mutation(ctx,path.endsWith('/send')?'send':'recall');
 h.fail(404,'NOT_FOUND','その兵の輸送操作は見つかりませんでした。');
}
