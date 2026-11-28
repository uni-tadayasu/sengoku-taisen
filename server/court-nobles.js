// Kyoto's guaranteed collection is paid from the authoritative saved magatama
// balance. A receipt, the currency debit and the acquired character share one
// D1 transaction; receipts survive campaign resets and revoked court access.
import {withCourtEstateGuard} from './court-estate-guard.js';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const S=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=result=>result?.results||[];
const NOBLES=GAME_OFFICERS.filter(officer=>officer.courtNoble===true);
const BY_ID=Object.fromEntries(NOBLES.map(officer=>[officer.id,officer]));
const GATE='EXISTS(SELECT 1 FROM reward_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const ACCESS_REASON='京都御所へ参内できる従五位（総合評価35,000点）以上、または現在の京都御所の正式加入・役職が必要です。';

export async function courtNobleReceipts(db,userId){
 return rows(await S(db,"SELECT result_json FROM reward_requests WHERE actor_id=? AND kind='court_noble'",userId).all()).map(row=>JSON.parse(row.result_json));
}
export async function reconcileCourtNobles(db,userId,save,fail){
 const receipts=await courtNobleReceipts(db,userId),owned=new Set(receipts.map(receipt=>receipt.officerId)),state=save.state;
 // Neither importing a base-rank officer nor inventing a gacha result can
 // manufacture this collection. Only server receipts establish ownership.
 if(state.officers.some(id=>BY_ID[id]&&!owned.has(id))||state.officerVariants.some(pair=>{const id=pair.split(':')[0];return BY_ID[id]&&(!owned.has(id)||pair!==id+':'+BY_ID[id].rank);})||state.gachaHistory.some(result=>BY_ID[result.officerId]))
  fail(409,'COURT_NOBLE_RECEIPT_REQUIRED','公家キャラクターは京都御所の交換所で確定します。最新のクラウド保存を読み込んでください。');
 for(const receipt of receipts){
  const officer=BY_ID[receipt.officerId];if(!officer)continue;
  if(!state.officers.includes(officer.id))state.officers.push(officer.id);
  const pair=officer.id+':'+officer.rank;if(!state.officerVariants.includes(pair))state.officerVariants.push(pair);
  if(state.officerHealth&&!Object.hasOwn(state.officerHealth.values,officer.id))state.officerHealth.values[officer.id]=100;
 }
 return save;
}
async function catalog(ctx,{save=null,access=null}={}){
 const {db,user,now,helpers:h}=ctx;
 access=access||await h.courtAccess(db,user,now);
 if(!save){const row=await h.getSyncRow(db,user.id);if(row?.save_json)save=h.normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock:access.clock});}
 const owned=new Set((await courtNobleReceipts(db,user.id)).map(row=>row.officerId)),eligible=!!access.eligible&&!!save;
 return{ok:true,total:NOBLES.length,ownedCount:NOBLES.filter(officer=>owned.has(officer.id)).length,balance:save?.state?.magatama||0,eligible,
  reason:!access.eligible?ACCESS_REASON:!save?'本拠のクラウド保存を完了すると公家を迎えられます。':'',
  catalog:NOBLES.map(officer=>({...officer,...Object.fromEntries(['lead','valor','intellect','politics'].map(key=>[key,Math.min(100,officer[key]+globalThis.SENGOKU_DATA.rankBonuses[officer.rank])])),owned:owned.has(officer.id)}))};
}
function input(raw,h){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['deviceId','expectedRevision','requestId','officerId'].includes(key))||typeof raw.officerId!=='string'||!Object.hasOwn(BY_ID,raw.officerId)||!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0)
  h.fail(400,'INVALID_INPUT','交換する公家と保存の更新番号を確認してください。');
 return{deviceId:h.idField(raw.deviceId,'端末識別子'),requestId:h.idField(raw.requestId,'操作番号'),officerId:raw.officerId,expectedRevision:raw.expectedRevision};
}
async function prior(ctx,body,digest){
 const row=await S(ctx.db,'SELECT * FROM reward_requests WHERE actor_id=? AND request_id=?',ctx.user.id,body.requestId).first();
 if(row&&row.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の交換・報酬に使われています。');
 return row;
}
async function result(ctx,record,deviceId,idempotent){
 const {db,user,helpers:h}=ctx,current=await h.getUser(db,user.id),now=Date.now();
 await h.requireAccountAccess(db,current);
 const snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,user.id),current,deviceId,now);
 return{...snapshot,nobles:await catalog({...ctx,user:current,now},{save:snapshot.save}),receipt:JSON.parse(record.result_json),idempotent};
}
async function exchange(ctx){
 const {db,user,now,helpers:h}=ctx,body=input(await h.readBody(ctx.request),h),officer=BY_ID[body.officerId];
 const digest=await h.hash(JSON.stringify(['court-noble-v1',body.officerId])),old=await prior(ctx,body,digest);
 if(old)return result(ctx,old,body.deviceId,true);
 await h.budget(db,'court-nobles:'+user.id,50,60000,now);
 let saved;try{saved=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now);}catch(error){const accepted=await prior(ctx,body,digest);if(accepted)return result(ctx,accepted,body.deviceId,true);throw error;}
 const access=await h.courtAccess(db,user,now);
 if(!access.eligible)h.fail(403,'COURT_NOBLE_ACCESS_REQUIRED',ACCESS_REASON);
 const clock=access.clock,save=h.normalizeGameSave(JSON.parse(saved.save_json),user,now,{reading:true,clock});
 if((await courtNobleReceipts(db,user.id)).some(receipt=>receipt.officerId===officer.id)||save.state.officers.includes(officer.id)){const accepted=await prior(ctx,body,digest);if(accepted)return result(ctx,accepted,body.deviceId,true);h.fail(409,'COURT_NOBLE_OWNED','この公家はすでに迎えています。勾玉は消費していません。');}
 if(save.state.magatama<officer.cost)h.fail(409,'COURT_NOBLE_SHORTAGE',`勾玉が${(officer.cost-save.state.magatama).toLocaleString('ja-JP')}不足しています。`);
 const shared=user.is_staff&&!user.is_admin?await h.staffBaseDto(db,user,clock,now):null,estate=await h.courtEstateContext(db,user,save,clock,now);
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection:estate.projection,isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,staffBase:shared});
 game.state.magatama-=officer.cost;
 const acquired=game._grantOfficerVariant(officer.id,officer.rank);
 if(!acquired?.isNewOfficer)h.fail(409,'COURT_NOBLE_OWNED','この公家はすでに迎えています。勾玉は消費していません。');
 game.log(`京都御所で勾玉${officer.cost.toLocaleString('ja-JP')}と交換し、「${officer.name} ${officer.rank}」を迎えました。`,'court-noble');
 const next=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),nonce=crypto.randomUUID(),args=[user.id,body.requestId,nonce],guard=withCourtEstateGuard(access.guard,estate);
 const receipt={kind:'court_noble',officerId:officer.id,name:officer.name,rank:officer.rank,cost:officer.cost,balance:game.state.magatama};
 const statements=[S(db,`INSERT INTO reward_requests(actor_id,request_id,request_hash,kind,campaign_id,result_json,commit_token,created_at)
  SELECT ?,?,?,'court_noble',?,?,?,? WHERE EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>?)
  AND NOT EXISTS(SELECT 1 FROM reward_requests WHERE actor_id=? AND kind='court_noble' AND json_extract(result_json,'$.officerId')=?)
  AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${guard.sql}
  ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,body.requestId,digest,save.state.walking.campaignId,JSON.stringify(receipt),nonce,now,user.id,saved.revision,body.deviceId,now,user.id,officer.id,h.worldClockId,clock.revision,...guard.args),
  S(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${GATE}`,JSON.stringify(next),now,now+h.syncLease,user.id,...args),
  S(db,`INSERT INTO reward_accounts(user_id,started_at) SELECT ?,? WHERE ${GATE} ON CONFLICT(user_id) DO NOTHING`,user.id,now,...args)];
 const committed=await db.batch(statements),accepted=await prior(ctx,body,digest);
 if(!accepted){await h.requireAccountAccess(db,user);h.fieldWriter(await h.getSyncRow(db,user.id),body.deviceId,body.expectedRevision,now);h.fail(409,'COURT_NOBLE_STATE_CHANGED','参内資格・所持状況が変わりました。最新の公家交換所を開き直してください。');}
 return result(ctx,accepted,body.deviceId,!rows(committed[0]).length);
}
export async function handleCourtNobles(ctx){
 await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);
 if(ctx.path==='/court/nobles'&&ctx.method==='GET')return catalog(ctx);
 if(ctx.path==='/court/nobles/exchange'&&ctx.method==='POST')return exchange(ctx);
 ctx.helpers.fail(404,'NOT_FOUND','公家交換所の操作が見つかりません。');
}
