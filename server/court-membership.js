// Voluntary Kyoto enrollment has its own receipt and commits the household
// departure, role, personal campaign, and preserved progress atomically.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {ensureResidency,prepareResidencySuccession} from './residency.js';
import {advanceReservedMarch} from './marches.js';
import {closeReservations} from './relocation.js';
import {prepareRelocationProgress,seedProgressCampaignStatement} from './progress.js';
import {externalTroopSnapshotStatements} from './maintenance.js';
import {courtEstateSnapshotStatements} from './court-estate-ledger.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),copy=value=>JSON.parse(JSON.stringify(value));
const REQUIREMENT=Object.freeze({rankId:'court-7',rankName:'従五位',minScore:35000});
const CASTLES=globalThis.SENGOKU_DATA.castles,CASTLE_BY_ID=Object.fromEntries(CASTLES.map(c=>[c.id,c]));
const GATE='EXISTS(SELECT 1 FROM court_membership_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const PENDING=`NOT EXISTS(SELECT 1 FROM battle_marches WHERE actor_id=? AND status='marching')
 AND NOT EXISTS(SELECT 1 FROM covert_states WHERE actor_id=? AND json_array_length(state_json,'$.dispatches')>0)
 AND NOT EXISTS(SELECT 1 FROM conquest_marches WHERE user_id=? AND status='marching')
 AND NOT EXISTS(SELECT 1 FROM alliance_units WHERE owner_id=? AND state<>'claimed' AND campaign_retired=0)`;
const pendingArgs=id=>[id,id,id,id];

export function courtMembershipStatus(user,evaluation){
 const isMember=!!user.is_staff&&!user.is_admin;
 const reason=isMember?'京都御所に正式加入しています。':user.is_admin||user.is_deputy?'現在の立場では京都御所への正式加入を選べません。':user.expulsion_pending?'先に本拠への再入城を完了してください。':Number(evaluation?.score)<REQUIREMENT.minScore||!evaluation?'正式加入には従五位（総合評価35,000点）以上が必要です。':'';
 return{isMember,canJoin:!reason,reason,requirement:REQUIREMENT};
}
export async function courtMembershipDetails(ctx){
 const {db,user,now,helpers:h}=ctx,access=await h.courtAccess(db,user,now),row=await h.getSyncRow(db,user.id),status=courtMembershipStatus(user,access.evaluation);
 const save=row?.save_json?h.normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock:access.clock}):null;
 const owned=save?CASTLES.filter(c=>save.state.castles[c.id].owner===save.state.clan).map(c=>({id:c.id,name:c.name})):[];
 if(!save&&!status.isMember){status.canJoin=false;status.reason='先に本拠をクラウドへ保存してください。';}
 return{ok:true,membership:{...status,homeCastleId:save?.state.home||null,homeCastleName:CASTLE_BY_ID[save?.state.home]?.name||null,ownedCastleCount:owned.length,ownedCastles:owned,expectedRevision:row?.save_json?Number(row.revision):null}};
}

function clearTerritories(save){
 const next=copy(save),s=next.state,released=[];
 for(const c of CASTLES)if(s.castles[c.id].owner===s.clan){
  released.push(c.id);s.castles[c.id]={owner:c.clan===s.clan?'在地衆':c.clan,troops:c.initialTroops,wall:c.wall,level:1};
 }
 s.jobs=s.jobs.filter(job=>job.kind!=='castle'&&job.kind!=='branch');s.branches=[];
 if(s.cycle)s.cycle.retainedRegions=[];
 delete s.retainerSupport;s.march=null;s.marchHistory=[];
 s.walking={...s.walking,campaignId:crypto.randomUUID(),localSession:null};
 s.roaming=GameEngine.normalizeRoamingState(undefined,s.walking.campaignId);
 s.covert=GameEngine.normalizeCovertState(undefined,s.walking.campaignId);
 s.troopTransferSequence=0;
 return{next,released};
}

export async function joinCourtMembership(ctx,body){
 const {db,user,now,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['requestId','deviceId','expectedRevision','expectedHomeCastleId','confirmed'].includes(k))||body.confirmed!==true||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!CASTLE_BY_ID[body.expectedHomeCastleId])h.fail(400,'INVALID_INPUT','現在の拠点の破棄と京都御所への正式加入を確認してください。');
 const requestId=h.idField(body.requestId,'操作番号'),deviceId=h.idField(body.deviceId,'端末'),origin=body.expectedHomeCastleId;
 const query=ctx.url.searchParams;if([...query.keys()].some(key=>key!=='receipt')||query.has('receipt')&&(query.getAll('receipt').length!==1||query.get('receipt')!=='1'))h.fail(400,'INVALID_INPUT','正式加入の照会方法を確認してください。');
 const digest=await h.hash(JSON.stringify(['kyoto-membership-v1',origin,true]));
 const prior=async()=>{const row=await S(db,'SELECT * FROM court_membership_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first();if(row&&row.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の正式加入に使用されています。');return row;};
 const respond=async(receipt,idempotent)=>{const current=await h.getUser(db,user.id),snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,user.id),current,deviceId,now);return{...snapshot,membership:courtMembershipStatus({is_staff:snapshot.user.isStaff,is_admin:snapshot.user.isAdmin,is_deputy:snapshot.user.isDeputy},null),admission:{requestId,castleId:'kyoto_gosho',previousHomeCastleId:receipt.source_home,releasedCastleCount:Number(receipt.released_castle_count),termId:receipt.term_id,idempotent}};};
 const previous=await prior();if(previous)return respond(previous,true);
 if(query.has('receipt'))h.fail(404,'COURT_MEMBERSHIP_RECEIPT_PENDING','この正式加入の受付はまだ確認できません。');
 if(user.is_staff||user.is_admin||user.is_deputy)h.fail(409,'COURT_MEMBERSHIP_UNAVAILABLE',courtMembershipStatus(user,null).reason);
 if(user.expulsion_pending)h.fail(409,'BASE_EXPELLED','先に本拠への再入城を完了してください。');
 await h.budget(db,'court-membership:'+user.id,10,60000,now);
 let row;try{row=await h.settleWriterCycle(db,user,deviceId,body.expectedRevision,now);}catch(error){const accepted=await prior();if(accepted)return respond(accepted,true);throw error;}
 await ensureResidency(db,now);
 const access=await h.courtAccess(db,user,now),status=courtMembershipStatus(user,access.evaluation);
 if(!status.canJoin)h.fail(403,'COURT_RANK_REQUIRED',status.reason);
 const clock=await h.getWorldClock(db,now),journey=await advanceReservedMarch(ctx,row,clock),before=journey.save;
 if(before.state.home!==origin)h.fail(409,'COURT_HOME_CHANGED','本拠が変わりました。正式加入の確認画面を開き直してください。');
 if(!await S(db,'SELECT 1 AS clear WHERE '+PENDING,...pendingArgs(user.id)).first())h.fail(409,'ARMY_MARCHING','出陣・派遣・同盟への部隊参加を終えてから、京都御所へ正式加入してください。');
 if(GameEngine.publicEvaluation(journey.game.state,{officers:GAME_OFFICERS}).score<REQUIREMENT.minScore)h.fail(403,'COURT_RANK_REQUIRED','正式加入には従五位（総合評価35,000点）以上が必要です。');
 const institution=await S(db,"SELECT value FROM settings WHERE key='adminUserId'").first();
 if(!institution?.value||institution.value===user.id)h.fail(409,'COURT_MEMBERSHIP_UNAVAILABLE','現在は京都御所への正式加入を受け付けられません。');
 const old=await S(db,'SELECT m.castle_id,m.revision,s.lord_user_id,s.lord_epoch FROM castle_residents m JOIN castle_seats s ON s.castle_id=m.castle_id WHERE m.user_id=?',user.id).first();
 const departure=old?.lord_user_id===user.id?await prepareResidencySuccession(db,{userId:user.id,castleId:old.castle_id,battleId:'court-membership:'+user.id+':'+requestId,kind:'departure',now}):null;
 const residency=old?{sql:"EXISTS(SELECT 1 FROM castle_residents m JOIN castle_seats s ON s.castle_id=m.castle_id WHERE m.user_id=? AND m.castle_id=? AND m.revision=? AND s.lord_epoch=? AND COALESCE(s.lord_user_id,'')=?)",args:[user.id,old.castle_id,old.revision,old.lord_epoch,old.lord_user_id||'']}:{sql:'NOT EXISTS(SELECT 1 FROM castle_residents WHERE user_id=?)',args:[user.id]};
 const {next:personal,released}=clearTerritories(before),nonce=crypto.randomUUID(),termId=crypto.randomUUID(),nextUser={...user,is_staff:1,staff_term:termId,staff_since_ms:clock.elapsedMs};
 // Preserve a neutral, basic former castle for the existing departure path.
 // It is not an owned holding while the player belongs to Kyoto.
 personal.state.gameOver=true;personal.state.realtime.running=false;
 const next=h.normalizeGameSave(personal,nextUser,now,{reading:true,clock});next.state.staffService={baseId:'kyoto_gosho'};next.state.realtime.running=clock.running;next.savedAt=new Date(now).toISOString();
 const progress=await prepareRelocationProgress(db,user.id,before,now),role=h.roleCommitGuard(user),args=[user.id,requestId,nonce];
 const guard=[role,access.guard,residency,departure?.guard||{sql:'1=1',args:[]},journey.branches.guard,progress.guard];
 const statements=[S(db,`INSERT INTO court_membership_requests(actor_id,request_id,request_hash,commit_token,source_campaign_id,source_home,released_castle_count,term_id,created_at)
  SELECT ?,?,?,?,?,?,?,?,? FROM player_saves p WHERE p.user_id=? AND p.revision=? AND p.writer_device_id=? AND p.lease_expires_at>?
  AND EXISTS(SELECT 1 FROM world_clock WHERE id='world-v1' AND revision=?) AND EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)
  AND ${guard.map(g=>'('+g.sql+')').join(' AND ')} AND ${PENDING}
  ON CONFLICT DO NOTHING RETURNING *`,user.id,requestId,digest,nonce,before.state.walking.campaignId,origin,released.length,termId,now,user.id,row.revision,deviceId,now,clock.revision,institution.value,...guard.flatMap(g=>g.args),...pendingArgs(user.id))];
 if(departure?.succession)statements.push(...departure.statements(GATE,args));
 if(old)statements.push(S(db,`UPDATE castle_seats SET lord_user_id=NULL,lord_epoch=lord_epoch+1,lord_since_elapsed_ms=?,revision=revision+1 WHERE castle_id=? AND lord_user_id=? AND ${GATE}`,clock.elapsedMs,old.castle_id,user.id,...args),S(db,`DELETE FROM castle_residents WHERE user_id=? AND ${GATE}`,user.id,...args));
 statements.push(S(db,`UPDATE castle_residency_meta SET revision=revision+1 WHERE id=1 AND ${GATE}`,...args),
  // appointed_by denotes the receiving court; the dedicated receipt records
  // that the player, rather than its administrator, requested this admission.
  S(db,`INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) SELECT ?,?,?,?,? WHERE ${GATE}`,user.id,institution.value,now,termId,clock.elapsedMs,...args),
  S(db,`INSERT INTO staff_campaign_backups(user_id,term_id,save_json,joined_elapsed_ms,left_elapsed_ms,active,transition_token,updated_at)
   SELECT ?,?,?,?,NULL,1,?,? WHERE ${GATE} ON CONFLICT(user_id) DO UPDATE SET term_id=excluded.term_id,save_json=excluded.save_json,joined_elapsed_ms=excluded.joined_elapsed_ms,left_elapsed_ms=NULL,active=1,transition_token=excluded.transition_token,updated_at=excluded.updated_at`,user.id,termId,JSON.stringify(personal),clock.elapsedMs,nonce,now,...args),
  ...progress.statements(GATE,args,nonce),seedProgressCampaignStatement(db,user.id,next,GATE,args),
  ...closeReservations(db,user.id,before.state.walking.campaignId,now,nonce,GATE,args,null,null,[],clock.elapsedMs,'京都御所への正式加入により、旧領地の所属を終了しました。'),
  S(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=?,cycle_index=?,cycle_home='kyoto_gosho',cycle_commit=? WHERE user_id=? AND ${GATE}`,JSON.stringify(next),now,now+h.syncLease,next.state.cycle.index,nonce,user.id,...args),
  S(db,`UPDATE users SET clan=? WHERE id=? AND ${GATE}`,next.state.clan,user.id,...args),
  ...externalTroopSnapshotStatements(db,[user.id],clock,GATE,args),...courtEstateSnapshotStatements(db,clock,GATE,args));
 const receipt=(await db.batch(statements))[0].results?.[0];if(receipt)return respond(receipt,false);
 const accepted=await prior();if(accepted)return respond(accepted,true);
 await h.requireAccountAccess(db,user);h.fieldWriter(await h.getSyncRow(db,user.id),deviceId,body.expectedRevision,now);
 h.fail(409,'COURT_MEMBERSHIP_CHANGED','位階・本拠・所属が更新されました。正式加入の確認画面を開き直してください。');
}
