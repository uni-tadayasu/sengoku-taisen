// Releasing a holding is an explicit mutation of the canonical campaign. The
// receipt, troops, branch ledger and any personal return backup commit once.
import {advanceReservedMarch} from './marches.js';
import {prepareResidencyCpuLosses} from './residency.js';
import {externalTroopSnapshotStatements} from './maintenance.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args);
const CASTLES=globalThis.SENGOKU_DATA.castles,BY_ID=new Map(CASTLES.map(c=>[c.id,c]));
const SPECIAL=new Set(['edo','kyoto_gosho','kagoshima']);
const GATE='EXISTS(SELECT 1 FROM field_release_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';

// The former personal home is not the shared Kyoto home. If it is released,
// choose a different return location without transferring its troops or levels.
// The neutral fallback becomes a normal basic home only on a later dismissal.
export function releasePersonalCastle(state,castleId){
 const def=BY_ID.get(castleId),released=new Set([...(state.cycle?.releasedCastles||[]),castleId]);
 state.castles[castleId]={owner:def.clan===state.clan?'在地衆':def.clan,troops:Math.round(def.initialTroops*({easy:.8,normal:1,hard:1.2}[state.difficulty]||1)),wall:def.wall,level:1};
 if(state.cycle)state.cycle.releasedCastles=CASTLES.filter(c=>released.has(c.id)).map(c=>c.id);
 const removed=new Set((state.branches||[]).filter(branch=>branch.parentCastleId===castleId).map(branch=>branch.id));
 state.branches=(state.branches||[]).filter(branch=>!removed.has(branch.id));
 state.jobs=(state.jobs||[]).filter(job=>!(job.kind==='castle'&&job.id===castleId)&&!(job.kind==='branch'&&removed.has(job.id)));
 const usable=id=>BY_ID.has(id)&&!SPECIAL.has(id)&&!released.has(id),owned=id=>usable(id)&&state.castles[id].owner===state.clan;
 if(state.home===castleId){
  const home=[state.cycle?.home,...CASTLES.map(c=>c.id)].find(owned)||CASTLES.find(c=>usable(c.id)&&c.clan===state.clan)?.id||CASTLES.find(c=>usable(c.id))?.id;
  if(!home)throw Error('No valid personal return home after release');
  state.home=home;
 }
 if(state.cycle?.home===castleId)state.cycle.home=state.home;
 state.won=false;
}

function relatedTravel(userId,campaignId,castleId){
 return{sql:`NOT EXISTS(SELECT 1 FROM battle_marches WHERE actor_id=? AND status='marching' AND (source_castle_id=? OR target_castle_id=?))
  AND NOT EXISTS(SELECT 1 FROM conquest_marches WHERE user_id=? AND status='marching' AND (source_castle_id=? OR target_castle_id=?))
  AND NOT EXISTS(SELECT 1 FROM covert_states cs,json_each(cs.state_json,'$.dispatches') d WHERE cs.actor_id=? AND cs.campaign_id=? AND json_extract(d.value,'$.sourceCastleId')=?)
  AND NOT EXISTS(SELECT 1 FROM covert_states cs,json_each(cs.state_json,'$.stations') d WHERE cs.actor_id=? AND cs.campaign_id=? AND json_extract(d.value,'$.sourceCastleId')=?)
  AND NOT EXISTS(SELECT 1 FROM alliance_units WHERE state<>'claimed' AND troops>0 AND ((owner_id=? AND home_castle_id=?) OR (target_id=? AND castle_id=?)))`,
  args:[userId,castleId,castleId,userId,castleId,castleId,userId,campaignId,castleId,userId,campaignId,castleId,userId,castleId,userId,castleId]};
}
async function privateLedgers(ctx,campaignId,castleId){
 const {db,user}=ctx,[covert,backup,vacant]=await Promise.all([
  S(db,'SELECT sequence,state_json FROM covert_states WHERE actor_id=? AND campaign_id=?',user.id,campaignId).first(),
  S(db,'SELECT term_id,save_json,transition_token FROM staff_campaign_backups WHERE user_id=? AND active=1',user.id).first(),
  S(db,'SELECT sequence,troops FROM vacant_garrisons WHERE actor_id=? AND campaign_id=? AND castle_id=?',user.id,campaignId,castleId).first()
 ]);
 return{covert,backup,vacant,guards:[
  covert?{sql:'EXISTS(SELECT 1 FROM covert_states WHERE actor_id=? AND campaign_id=? AND sequence=? AND state_json=?)',args:[user.id,campaignId,covert.sequence,covert.state_json]}:{sql:'NOT EXISTS(SELECT 1 FROM covert_states WHERE actor_id=? AND campaign_id=?)',args:[user.id,campaignId]},
  backup?{sql:'EXISTS(SELECT 1 FROM staff_campaign_backups WHERE user_id=? AND active=1 AND term_id=? AND transition_token=? AND save_json=?)',args:[user.id,backup.term_id,backup.transition_token,backup.save_json]}:{sql:'NOT EXISTS(SELECT 1 FROM staff_campaign_backups WHERE user_id=? AND active=1)',args:[user.id]},
  vacant?{sql:'EXISTS(SELECT 1 FROM vacant_garrisons WHERE actor_id=? AND campaign_id=? AND castle_id=? AND sequence=? AND troops=?)',args:[user.id,campaignId,castleId,vacant.sequence,vacant.troops]}:{sql:'NOT EXISTS(SELECT 1 FROM vacant_garrisons WHERE actor_id=? AND campaign_id=? AND castle_id=?)',args:[user.id,campaignId,castleId]}
 ]};
}

export async function releaseFieldCastle(ctx,body){
 const {db,user,now,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['requestId','deviceId','expectedRevision','castleId','confirmed'].includes(key))||body.confirmed!==true||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!BY_ID.has(body.castleId))h.fail(400,'INVALID_INPUT','手放す城と兵・城郭・支拠点の破棄を確認してください。');
 const castleId=body.castleId,requestId=h.idField(body.requestId,'操作番号'),deviceId=h.idField(body.deviceId,'端末'),query=ctx.url.searchParams;
 if([...query.keys()].some(key=>key!=='receipt')||query.has('receipt')&&(query.getAll('receipt').length!==1||query.get('receipt')!=='1'))h.fail(400,'INVALID_INPUT','城の返還受付の照会方法を確認してください。');
 const digest=await h.hash(JSON.stringify(['field-release-v1',castleId,true]));
 const prior=async()=>{const receipt=await S(db,'SELECT * FROM field_release_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first();if(receipt&&receipt.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の城の返還に使用されています。');return receipt;};
 const respond=async(receipt,idempotent)=>({...await h.syncSnapshot(db,await h.getSyncRow(db,user.id),await h.getUser(db,user.id),deviceId,now),release:{...JSON.parse(receipt.result_json),idempotent}});
 const previous=await prior();if(previous)return respond(previous,true);
 if(query.has('receipt'))h.fail(404,'FIELD_RELEASE_RECEIPT_PENDING','この城の返還受付はまだ確認できません。');
 if(SPECIAL.has(castleId))h.fail(409,'FIELD_RELEASE_PROTECTED','江戸城・京都御所・鹿児島城の専用本拠は手放せません。');
 let row;try{row=await h.settleWriterCycle(db,user,deviceId,body.expectedRevision,now);}catch(error){const accepted=await prior();if(accepted)return respond(accepted,true);throw error;}
 const clock=await h.getWorldClock(db,now);if(!clock.running)h.fail(409,'WORLD_PAUSED','世界の共通時間を再開してから操作してください。');
 const raw=h.normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock}),campaignId=raw.state.walking.campaignId;
 if(raw.state.home===castleId)h.fail(409,'FIELD_RELEASE_HOME','現在の本拠は手放せません。');
 if(raw.state.castles[castleId].owner!==raw.state.clan)h.fail(409,'FIELD_RELEASE_NOT_OWNED','現在領有している城を選んでください。');
 const ledgers=await privateLedgers(ctx,campaignId,castleId),travel=relatedTravel(user.id,campaignId,castleId);
 const requireTravelClear=async()=>{if(!await S(db,'SELECT 1 AS allowed WHERE '+travel.sql,...travel.args).first())h.fail(409,'FIELD_RELEASE_UNITS_PENDING','この城に関連する進軍・派遣・同盟の駐留兵を帰還・回収してから、城を手放してください。');};
 await requireTravelClear();
 const journey=await advanceReservedMarch(ctx,row,clock),game=journey.game;
 if(journey.result.settlementRequired||game.state.walking.campaignId!==campaignId)h.fail(409,'CYCLE_SETTLEMENT_REQUIRED','領地の精算へ同期してから、もう一度確認してください。');
 const branches=game.state.branches.filter(branch=>branch.parentCastleId===castleId),removedBranchCount=branches.length,
  lostTroops=game.state.castles[castleId].troops+branches.reduce((sum,branch)=>sum+Number(branch.stationedTroops||0),0)+Number(game.state.covert.reserves[castleId]||0)+Number(ledgers.vacant?.troops||0),
  lostReserve=Number(game.state.covert.reserves[castleId]||0);
 const result=game.releaseCastle(castleId);if(!result.ok)h.fail(409,result.code||'FIELD_RELEASE_UNAVAILABLE',result.message);
 if(lostReserve){game.state.covert.reserves[castleId]=0;game.state.covert.sequence=Number(ledgers.covert?.sequence||0)+1;}
 const next=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),nonce=crypto.randomUUID(),args=[user.id,requestId,nonce],
  receipt={requestId,castleId,castleName:BY_ID.get(castleId).name,removedBranchCount,lostTroops,released:true},
  cpu=await prepareResidencyCpuLosses(db,{userId:user.id,events:game.takeHomeDefenseLosses?.()||[],now,state:next.state}),
  guards=[h.roleCommitGuard(user),journey.branches.guard,cpu.guard,travel,...ledgers.guards];
 await h.budget(db,'field-release:'+user.id,30,60000,now);
 const statements=[S(db,`INSERT INTO field_release_requests(actor_id,request_id,campaign_id,castle_id,request_hash,commit_token,result_json,created_at)
  SELECT ?,?,?,?,?,?,?,? FROM player_saves p WHERE p.user_id=? AND p.revision=? AND p.writer_device_id=? AND p.lease_expires_at>?
  AND json_extract(p.save_json,'$.state.walking.campaignId')=? AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=? AND running=1)
  AND ${guards.map(guard=>'('+guard.sql+')').join(' AND ')} ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING *`,user.id,requestId,campaignId,castleId,digest,nonce,JSON.stringify(receipt),now,user.id,row.revision,deviceId,now,campaignId,h.worldClockId,clock.revision,...guards.flatMap(guard=>guard.args)),
  S(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=?,cycle_home=?,cycle_commit=? WHERE user_id=? AND ${GATE}`,JSON.stringify(next),now,now+h.syncLease,next.state.cycle.home,nonce,user.id,...args),
  ...h.branchProgressStatements(db,user.id,next,now,GATE,args,{resolvedElapsedMs:journey.resolvedElapsedMs}),
  ...h.covertIncidentStatements(db,user.id,next,now,GATE,args),...cpu.statements(GATE,args),
  S(db,`DELETE FROM vacant_garrisons WHERE actor_id=? AND campaign_id=? AND castle_id=? AND ${GATE}`,user.id,campaignId,castleId,...args)
 ];
 if(lostReserve)statements.push(S(db,`UPDATE covert_states SET state_json=?,sequence=?,updated_at=? WHERE actor_id=? AND campaign_id=? AND ${GATE}`,JSON.stringify(next.state.covert),next.state.covert.sequence,now,user.id,campaignId,...args));
 const personal=await h.staffPersonalProgressStatement(db,user,next,now,GATE,args,game.getStaffPersonalProgress?.(),null,{releasedCastleId:castleId});if(personal)statements.push(personal);
 for(const event of h.saveAchievements(journey.before,next))statements.push(h.achievementStatement(db,user.id,event,now,GATE,args));
 statements.push(...externalTroopSnapshotStatements(db,[user.id],clock,GATE,args));
 const accepted=(await db.batch(statements))[0].results?.[0];if(accepted)return respond(accepted,false);
 const retried=await prior();if(retried)return respond(retried,true);
 await h.requireAccountAccess(db,user);h.fieldWriter(await h.getSyncRow(db,user.id),deviceId,body.expectedRevision,now);await requireTravelClear();
 h.fail(409,'FIELD_RELEASE_CHANGED','城・支拠点・部隊・所属が更新されました。最新の状態を確認してから、もう一度お試しください。');
}
