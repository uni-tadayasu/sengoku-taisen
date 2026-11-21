// Player-to-player trade keeps offered assets in escrow. Only the actor's own
// save is ever written: proceeds/refunds wait in a separate delivery ledger.
const tradeStmt=(db,sql,...params)=>db.prepare(sql).bind(...params);
const tradeRows=result=>result?.results||[];
const tradeIso=value=>new Date(Number(value)).toISOString();
const TRADE_ASSETS=Object.freeze(['gold','rice','wood','stone','magatama']);
const TRADE_NAMES={gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'};
const TRADE_RULES=Object.freeze({assets:TRADE_ASSETS,maxAmount:1000000,balanceLimit:999999999,maxPending:20});
const TRADE_GATE='EXISTS(SELECT 1 FROM trade_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const TRADE_SELECT=`SELECT t.*,d.recipient_id AS delivery_recipient_id,d.kind AS delivery_kind,d.assets_json AS delivery_assets_json,d.claimed_at
  FROM trades t LEFT JOIN trade_deliveries d ON d.trade_id=t.id`;
const tradeVisible='(t.sender_id=? OR t.recipient_id=?)';
const tradeEmpty=()=>Object.fromEntries(TRADE_ASSETS.map(key=>[key,0]));
const tradeHasAssets=bundle=>TRADE_ASSETS.some(key=>bundle[key]>0);
const tradeLabel=bundle=>TRADE_ASSETS.filter(key=>bundle[key]>0).map(key=>TRADE_NAMES[key]+bundle[key].toLocaleString('ja-JP')).join('・')||'対価なし';

function tradeBundle(value,required,h){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!TRADE_ASSETS.includes(key)))h.fail(400,'INVALID_INPUT','交易の資産は金銭・兵糧・木材・石材・勾玉で指定してください。');
  const result=tradeEmpty();
  for(const key of TRADE_ASSETS){const amount=value[key]??0;if(!Number.isSafeInteger(amount)||amount<0||amount>TRADE_RULES.maxAmount||Object.hasOwn(value,key)&&value[key]===null)h.fail(400,'INVALID_INPUT','交易数量は0〜1,000,000の整数で指定してください。');result[key]=amount;}
  if(required&&!tradeHasAssets(result))h.fail(400,'INVALID_INPUT','輸出する資産を1つ以上指定してください。');
  return result;
}
function tradeId(value,h){const id=h.idField(value,'交易の識別子');if(!/^tr_[a-f0-9]{32}$/.test(id))h.fail(404,'TRADE_NOT_FOUND','この交易は見つからないか、閲覧できません。');return id;}
function tradeBody(raw,propose,h){
  const allowed=propose?['targetPlayerId','offer','want','requestId','deviceId','expectedRevision']:['requestId','deviceId','expectedRevision'];
  if(Object.keys(raw).some(key=>!allowed.includes(key)))h.fail(400,'INVALID_INPUT','交易の送信内容を確認してください。');
  const body={requestId:h.idField(raw.requestId,'操作番号'),deviceId:h.idField(raw.deviceId,'端末'),expectedRevision:raw.expectedRevision};
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)h.fail(400,'INVALID_INPUT','保存の更新番号が正しくありません。');
  if(propose){body.targetPlayerId=h.idField(raw.targetPlayerId,'相手の領主');body.offer=tradeBundle(raw.offer,true,h);body.want=tradeBundle(raw.want===undefined?{}:raw.want,false,h);}
  return body;
}
function tradeDto(row,viewer){
  const pending=row.status==='pending',sender=row.sender_id===viewer,recipient=row.recipient_id===viewer;
  const delivery=row.delivery_assets_json?{kind:row.delivery_kind,recipientPlayerId:row.delivery_recipient_id,assets:JSON.parse(row.delivery_assets_json),claimedAt:row.claimed_at===null?null:tradeIso(row.claimed_at)}:null;
  return {id:row.id,revision:Number(row.revision),status:row.status,sender:{playerId:row.sender_id,name:row.sender_name},recipient:{playerId:row.recipient_id,name:row.recipient_name},offer:JSON.parse(row.offer_json),want:JSON.parse(row.want_json),createdAt:tradeIso(row.created_at),updatedAt:tradeIso(row.updated_at),delivery,
    canAccept:pending&&recipient,canReject:pending&&recipient,canCancel:pending&&sender,canClaim:!!delivery&&delivery.recipientPlayerId===viewer&&delivery.claimedAt===null};
}
async function tradeRow(db,viewer,id){return tradeStmt(db,TRADE_SELECT+` WHERE t.id=? AND ${tradeVisible}`,id,viewer,viewer).first();}
async function tradeRequireRow(ctx,id){const row=await tradeRow(ctx.db,ctx.user.id,id);if(!row)ctx.helpers.fail(404,'TRADE_NOT_FOUND','この交易は見つからないか、閲覧できません。');return row;}
async function tradeSummary(db,id){
  const row=await tradeStmt(db,`SELECT
    (SELECT COUNT(*) FROM trades WHERE recipient_id=? AND status='pending') AS incoming_pending,
    (SELECT COUNT(*) FROM trades WHERE sender_id=? AND status='pending') AS outgoing_pending,
    (SELECT COUNT(*) FROM trade_deliveries WHERE recipient_id=? AND claimed_at IS NULL) AS claimable`,id,id,id).first();
  return {incomingPending:Number(row.incoming_pending),outgoingPending:Number(row.outgoing_pending),claimable:Number(row.claimable)};
}
async function tradeList(ctx){
  const {db,user,url,helpers:h}=ctx,box=url.searchParams.get('box')||'incoming',raw=url.searchParams.get('limit')||'20',cursor=url.searchParams.get('cursor');
  if(!['incoming','outgoing','history','claimable'].includes(box)||!/^\d{1,2}$/.test(raw)||Number(raw)<1||Number(raw)>50)h.fail(400,'INVALID_INPUT','交易一覧の種類と件数（1〜50）を確認してください。');
  let point=null;
  if(cursor){try{if(!/^[A-Za-z0-9_-]{1,512}$/.test(cursor))throw new Error();point=JSON.parse(atob(cursor.replaceAll('-','+').replaceAll('_','/')));}catch{h.fail(400,'INVALID_CURSOR','交易一覧の続きが正しくありません。');}if(!Array.isArray(point)||point.length!==3||point[0]!==box||!Number.isSafeInteger(point[1])||point[1]<0||!/^tr_[a-f0-9]{32}$/.test(point[2]))h.fail(400,'INVALID_CURSOR','交易一覧の続きが正しくありません。');}
  const filter=box==='incoming'?'t.recipient_id=?':box==='outgoing'?'t.sender_id=?':box==='claimable'?'d.recipient_id=? AND d.claimed_at IS NULL':tradeVisible,params=box==='history'?[user.id,user.id]:[user.id],limit=Number(raw);
  const found=tradeRows(await tradeStmt(db,TRADE_SELECT+` WHERE ${filter}${point?' AND (t.created_at<? OR (t.created_at=? AND t.id<?))':''} ORDER BY t.created_at DESC,t.id DESC LIMIT ?`,...params,...(point?[point[1],point[1],point[2]]:[]),limit+1).all()),page=found.slice(0,limit),last=page.at(-1);
  return {ok:true,trades:page.map(row=>tradeDto(row,user.id)),nextCursor:found.length>limit?btoa(JSON.stringify([box,Number(last.created_at),last.id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null,summary:await tradeSummary(db,user.id),rules:TRADE_RULES};
}
async function tradeRecipient(ctx){
  const {db,user,url,now,helpers:h}=ctx,id=h.idField(url.searchParams.get('playerId'),'相手の領主');
  if(id===user.id)h.fail(400,'INVALID_TARGET','ほかの領主を交易相手に選んでください。');
  const target=await h.getUser(db,id),save=target?await h.getSyncRow(db,id):null;
  if(!target||!save?.save_json)h.fail(404,'PLAYER_NOT_FOUND','本拠を保存済みの領主を交易相手に選んでください。');
  return {ok:true,player:h.mapUser(target,now)};
}
async function tradePrior(ctx,body,digest){
  const row=await tradeStmt(ctx.db,'SELECT * FROM trade_requests WHERE actor_id=? AND request_id=?',ctx.user.id,body.requestId).first();
  if(row&&row.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の交易に使用されています。');
  return row;
}
async function tradeResult(ctx,body,receipt,idempotent){
  const {db,user,now,helpers:h}=ctx,current=await h.getUser(db,user.id),snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,user.id),current,body.deviceId,now),row=await tradeRequireRow(ctx,receipt.tradeId);
  return {...snapshot,trade:tradeDto(row,user.id),receipt,idempotent};
}
async function tradeActor(ctx,body){
  const {db,user,now,helpers:h}=ctx,row=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now),clock=await h.getWorldClock(db,now),save=h.normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock});
  if(!save.state.worldClock)h.fail(409,'CLOCK_ANCHOR_REQUIRED','先に共通時計へ同期してください。');
  if(clock.elapsedMs-save.state.worldClock.elapsedMs>15000)h.fail(409,'CLOCK_STALE','共通時計と本拠を同期してから交易してください。');
  return {row,clock,save};
}
function tradeMove(save,outgoing,incoming,h){
  const values={};
  for(const key of TRADE_ASSETS){const balance=key==='magatama'?save.state.magatama:save.state.resources[key];if(balance<outgoing[key])h.fail(409,'INSUFFICIENT_ASSETS','支払う資産が足りません。');values[key]=balance-outgoing[key]+incoming[key];if(values[key]>TRADE_RULES.balanceLimit)h.fail(409,'ASSET_LIMIT','所持上限を超えるため全額を受け取れません。資産を使ってから再度お試しください。');}
  for(const key of TRADE_ASSETS)if(key==='magatama')save.state.magatama=values[key];else save.state.resources[key]=values[key];
}
function tradeSaveStatements(ctx,actor,body,gateArgs,text){
  const {db,user,now,helpers:h}=ctx,save=actor.save;save.state.log.unshift({turn:save.state.turn,text,kind:'trade'});save.state.log=save.state.log.slice(0,200);save.savedAt=tradeIso(now);
  const normalized=h.normalizeGameSave(save,user,now,{clock:actor.clock});
  return [tradeStmt(db,'UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND '+TRADE_GATE,JSON.stringify(normalized),now,now+h.syncLease,user.id,...gateArgs),
    tradeStmt(db,"UPDATE users SET clan=CASE WHEN EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=users.id) AND users.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') THEN clan ELSE ? END WHERE id=? AND "+TRADE_GATE,normalized.state.clan,user.id,...gateArgs)];
}
function tradeAuthorize(row,actor,action,h){
  if(action==='accept'||action==='reject'){if(row.recipient_id!==actor)h.fail(403,'TRADE_FORBIDDEN','届いた交易にだけ承認・拒否できます。');}
  else if(row.sender_id!==actor)h.fail(403,'TRADE_FORBIDDEN','この交易の送り主だけが操作できます。');
  if(action==='claim'){
    if(!row.delivery_assets_json||row.delivery_recipient_id!==actor)h.fail(409,'TRADE_NOT_CLAIMABLE','この交易には受け取れる資産がありません。');
    if(row.claimed_at!==null)h.fail(409,'TRADE_ALREADY_CLAIMED','この交易の資産は受取済みです。');
  }else if(row.status!=='pending')h.fail(409,'TRADE_CLOSED','この交易はすでに承認・取消・拒否されています。最新の内容を確認してください。');
}
async function tradeCommitFailure(ctx,body,digest,actor,id,action){
  const {db,user,now,helpers:h}=ctx,prior=await tradePrior(ctx,body,digest);if(prior)return tradeResult(ctx,body,JSON.parse(prior.result_json),true);
  h.fieldWriter(await h.getSyncRow(db,user.id),body.deviceId,body.expectedRevision,Date.now());
  const current=await h.getUser(db,user.id);if(!!current?.is_admin!==!!user.is_admin||current?.staff_term!==user.staff_term)h.fail(409,'AUTHORITY_CHANGED','領主の役職が更新されました。同期してからお試しください。');
  if((await h.getWorldClock(db,now)).revision!==actor.clock.revision)h.fail(409,'WORLD_CLOCK_CHANGED','共通時計を確認してからお試しください。');
  if(action==='propose'){
    if((await tradeSummary(db,user.id)).outgoingPending>=TRADE_RULES.maxPending)h.fail(409,'TRADE_PENDING_LIMIT','承認待ちの交易は20件までです。先に取消・承認をお待ちください。');
    if(!(await h.getSyncRow(db,body.targetPlayerId))?.save_json)h.fail(404,'PLAYER_NOT_FOUND','相手の本拠が見つかりません。');
  }else tradeAuthorize(await tradeRequireRow(ctx,id),user.id,action,h);
  h.fail(409,'TRADE_CHANGED','交易の状態が更新されました。最新の一覧を確認してください。');
}
async function tradeMutate(ctx,id=null,action='propose'){
  const {db,user,request,now,helpers:h}=ctx,propose=action==='propose',body=tradeBody(await h.readBody(request),propose,h);
  const digest=await h.hash(JSON.stringify(propose?['propose',body.targetPlayerId,body.offer,body.want]:[action,id]));
  const prior=await tradePrior(ctx,body,digest);if(prior)return tradeResult(ctx,body,JSON.parse(prior.result_json),true);
  await h.budget(db,'trade:'+user.id,30,60000,now);
  let row=null,target=null;
  if(propose){
    if(body.targetPlayerId===user.id)h.fail(400,'INVALID_TARGET','自分自身へ交易を申し込むことはできません。');
    target=await h.getUser(db,body.targetPlayerId);if(!target||!(await h.getSyncRow(db,target.id))?.save_json)h.fail(404,'PLAYER_NOT_FOUND','本拠を保存済みの領主を交易相手に選んでください。');
    if((await tradeSummary(db,user.id)).outgoingPending>=TRADE_RULES.maxPending)h.fail(409,'TRADE_PENDING_LIMIT','承認待ちの交易は20件までです。先に取消・承認をお待ちください。');
    id=h.uid('tr_');
  }else{row=await tradeRequireRow(ctx,id);tradeAuthorize(row,user.id,action,h);}
  const actor=await tradeActor(ctx,body),changesSave=propose||action==='accept'||action==='claim',offer=propose?body.offer:JSON.parse(row.offer_json),want=propose?body.want:JSON.parse(row.want_json);
  let delivery=null,log='';
  if(propose){tradeMove(actor.save,offer,tradeEmpty(),h);log=`${target.name}へ交易を提案。輸出する${tradeLabel(offer)}を預けました。`;}
  else if(action==='accept'){tradeMove(actor.save,want,offer,h);if(tradeHasAssets(want))delivery={kind:'proceeds',assets:want};log=`${row.sender_name}との交易が成立。${tradeLabel(want)}と引き換えに${tradeLabel(offer)}を輸入しました。`;}
  else if(action==='claim'){const assets=JSON.parse(row.delivery_assets_json);tradeMove(actor.save,tradeEmpty(),assets,h);log=`交易の${row.delivery_kind==='refund'?'返還資産':'対価'}として${tradeLabel(assets)}を受け取りました。`;}
  else delivery={kind:'refund',assets:offer};
  const nonce=crypto.randomUUID(),gateArgs=[user.id,body.requestId,nonce],role=h.roleCommitGuard(user),tradeRevision=propose?1:Number(row.revision)+1;
  const receipt={id:h.uid('tx_'),requestId:body.requestId,tradeId:id,action,playerId:user.id,playerRevision:Number(actor.row.revision)+(changesSave?1:0),tradeRevision,createdAt:tradeIso(now)};
  const condition=propose?"EXISTS(SELECT 1 FROM player_saves target WHERE target.user_id=? AND target.save_json IS NOT NULL) AND (SELECT COUNT(*) FROM trades WHERE sender_id=? AND status='pending')<?":action==='claim'?"EXISTS(SELECT 1 FROM trades t JOIN trade_deliveries d ON d.trade_id=t.id WHERE t.id=? AND t.revision=? AND t.sender_id=? AND d.recipient_id=? AND d.claimed_at IS NULL)":`EXISTS(SELECT 1 FROM trades t WHERE t.id=? AND t.revision=? AND t.status='pending' AND t.${action==='cancel'?'sender_id':'recipient_id'}=?)`;
  const conditionArgs=propose?[body.targetPlayerId,user.id,TRADE_RULES.maxPending]:action==='claim'?[id,row.revision,user.id,user.id]:[id,row.revision,user.id];
  const statements=[tradeStmt(db,`INSERT INTO trade_requests(id,actor_id,request_id,trade_id,action,request_hash,commit_token,result_json,created_at)
    SELECT ?,?,?,?,?,?,?,?,? FROM player_saves ps WHERE ps.user_id=? AND ps.revision=? AND ps.writer_device_id=? AND ps.lease_expires_at>?
    AND ${role.sql} AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${condition}
    ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING id`,receipt.id,user.id,body.requestId,id,action,digest,nonce,JSON.stringify(receipt),now,user.id,body.expectedRevision,body.deviceId,Date.now(),...role.args,h.worldClockId,actor.clock.revision,...conditionArgs)];
  if(propose)statements.push(tradeStmt(db,`INSERT INTO trades(id,sender_id,recipient_id,sender_name,recipient_name,offer_json,want_json,status,revision,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'pending',1,?,? WHERE ${TRADE_GATE}`,id,user.id,target.id,user.name,target.name,JSON.stringify(offer),JSON.stringify(want),now,now,...gateArgs));
  else statements.push(tradeStmt(db,`UPDATE trades SET status=?,revision=revision+1,updated_at=? WHERE id=? AND ${TRADE_GATE}`,action==='claim'?row.status:action==='accept'?'accepted':action==='cancel'?'cancelled':'rejected',now,id,...gateArgs));
  if(changesSave)statements.push(...tradeSaveStatements(ctx,actor,body,gateArgs,log));
  if(delivery)statements.push(tradeStmt(db,`INSERT INTO trade_deliveries(trade_id,recipient_id,kind,assets_json,created_at,claimed_at) SELECT ?,?,?,?,?,NULL WHERE ${TRADE_GATE}`,id,row.sender_id,delivery.kind,JSON.stringify(delivery.assets),now,...gateArgs));
  if(action==='claim')statements.push(tradeStmt(db,`UPDATE trade_deliveries SET claimed_at=? WHERE trade_id=? AND recipient_id=? AND ${TRADE_GATE}`,now,id,user.id,...gateArgs));
  if(!tradeRows((await db.batch(statements))[0]).length)return tradeCommitFailure(ctx,body,digest,actor,id,action);
  return tradeResult(ctx,body,receipt,false);
}

export async function handleTrades(ctx){
  const {path,method,helpers:h}=ctx;
  if(path==='/trades'&&method==='GET')return tradeList(ctx);
  if(path==='/trades'&&method==='POST')return tradeMutate(ctx);
  if(path==='/trades/recipient'&&method==='GET')return tradeRecipient(ctx);
  const match=/^\/trades\/([^/]+)(?:\/(accept|cancel|reject|claim))?$/.exec(path);
  if(match){const id=tradeId(match[1],h);if(!match[2]&&method==='GET')return {ok:true,trade:tradeDto(await tradeRequireRow(ctx,id),ctx.user.id)};if(match[2]&&method==='POST')return tradeMutate(ctx,id,match[2]);}
  h.fail(404,'NOT_FOUND','その交易機能は見つかりませんでした。');
}
