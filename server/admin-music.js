/* Operator-controlled public music. Audio assets and personal volume stay on
   the client; only the authoritative transport state is persisted here. */
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=result=>Array.isArray(result?.results)?result.results:[];
const iso=value=>value==null?null:new Date(Number(value)).toISOString();
const STATE_SQL='SELECT enabled,mode,revision,started_at,updated_at FROM music_broadcast_state WHERE id=1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function musicBroadcastDto(row){
  if(!row)throw Error('Music broadcast migration incomplete');
  return {enabled:row.enabled===1,mode:row.mode,revision:Number(row.revision),startedAt:iso(row.started_at),updatedAt:iso(row.updated_at)};
}
export async function readMusicBroadcast(db){return musicBroadcastDto(await stmt(db,STATE_SQL).first());}

export async function handleAdminMusic({db,user,request,method,now,helpers:h}){
  h.requireAdmin(user);
  const guard=h.roleCommitGuard(user);
  const currentAccess=async()=>{
    await h.requireAccountAccess(db,user);
    if(!await stmt(db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args).first())h.fail(403,'ADMIN_REQUIRED','運営権限が変更されました。接続状態を確認してください。');
  };
  // The shared response guard also runs after asynchronous identity decoration.
  h.registerResponseGuard?.({...guard,code:'ADMIN_REQUIRED',message:'運営権限が変更されました。接続状態を確認してください。'});
  if(method==='GET'){
    const musicBroadcast=await readMusicBroadcast(db);await currentAccess();
    return {ok:true,musicBroadcast,serverNow:iso(now)};
  }
  if(method!=='POST')h.fail(405,'METHOD_NOT_ALLOWED','この操作はGETまたはPOSTで送信してください。');
  const body=await h.readBody(request,2048),keys=['enabled','mode','expectedRevision','requestId'];
  if(Object.keys(body).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(body,key))||typeof body.enabled!=='boolean'||!['loop','continuous'].includes(body.mode)||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>=Number.MAX_SAFE_INTEGER||typeof body.requestId!=='string'||!UUID.test(body.requestId))h.fail(400,'INVALID_INPUT','配信のON/OFF、再生方式、更新番号、受付番号を確認してください。');
  const requestId=body.requestId.toLowerCase(),payloadHash=await h.hash(JSON.stringify([body.enabled,body.mode,body.expectedRevision]));
  const receiptSql='SELECT * FROM music_broadcast_requests WHERE user_id=? AND request_id=?';
  const replay=async(receipt,state)=>{
    if(receipt.payload_hash!==payloadHash)h.fail(409,'REQUEST_ID_REUSED','同じ受付番号に異なる配信操作が指定されています。最新の設定を読み直してください。');
    await currentAccess();
    // Return the current shared state, not an older receipt's transport state.
    // A delayed response must not turn an already stopped broadcast back on.
    return {ok:true,musicBroadcast:musicBroadcastDto(state),serverNow:iso(now),requestId,appliedRevision:Number(receipt.applied_revision),changed:receipt.changed===1,idempotent:true};
  };
  const before=await db.batch([stmt(db,receiptSql,user.id,requestId),stmt(db,STATE_SQL)]);
  const prior=rows(before[0])[0],state=rows(before[1])[0];
  if(prior)return replay(prior,state);
  if(!state)throw Error('Music broadcast migration incomplete');
  if(Number(state.revision)!==body.expectedRevision){await currentAccess();h.fail(409,'MUSIC_REVISION_CONFLICT','別の端末で配信設定が更新されました。最新の設定を読み直してください。');}
  await h.budget(db,'admin-music:'+user.id,60,60000,now);
  const changed=Number(state.enabled)!==Number(body.enabled)||state.mode!==body.mode;
  const revision=body.expectedRevision+(changed?1:0),startedAt=changed?(body.enabled?now:null):state.started_at,updatedAt=changed?now:state.updated_at,nonce=crypto.randomUUID();
  const gate='EXISTS(SELECT 1 FROM music_broadcast_requests WHERE user_id=? AND request_id=? AND commit_token=?)';
  const result=await db.batch([
    stmt(db,`INSERT INTO music_broadcast_requests(user_id,request_id,payload_hash,applied_revision,changed,created_at,commit_token)
      SELECT ?,?,?,?,?,?,? FROM music_broadcast_state WHERE id=1 AND revision=? AND ${guard.sql}
      ON CONFLICT(user_id,request_id) DO NOTHING`,user.id,requestId,payloadHash,revision,changed?1:0,now,nonce,body.expectedRevision,...guard.args),
    stmt(db,`UPDATE music_broadcast_state SET enabled=?,mode=?,revision=?,started_at=?,updated_at=? WHERE id=1 AND revision=? AND ${gate}`,
      body.enabled?1:0,body.mode,revision,startedAt,updatedAt,body.expectedRevision,user.id,requestId,nonce),
    stmt(db,receiptSql,user.id,requestId),stmt(db,STATE_SQL)
  ]);
  const receipt=rows(result[2])[0],current=rows(result[3])[0];
  if(!receipt){await currentAccess();h.fail(409,'MUSIC_REVISION_CONFLICT','別の端末で配信設定が更新されました。最新の設定を読み直してください。');}
  if(receipt.commit_token!==nonce)return replay(receipt,current);
  await currentAccess();
  return {ok:true,musicBroadcast:musicBroadcastDto(current),serverNow:iso(now),requestId,appliedRevision:revision,changed,idempotent:false};
}
