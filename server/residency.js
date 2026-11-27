import {externalTroopSnapshotStatements} from './maintenance.js';
// Public castle households are separate from each player's private campaign.
// Only committed admissions and proved home-defense defeats change this ledger.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),R=x=>x?.results||[],safe={sql:'1=1',args:[]};
const majors=new Set(['edo','kyoto_gosho','nijo','osaka','nagoya','kagoshima']);
export const RESIDENCY_CASTLES=globalThis.SENGOKU_DATA.castles.filter(c=>!majors.has(c.id));
const castles=new Map(RESIDENCY_CASTLES.map(c=>[c.id,c])),iso=n=>new Date(Number(n)).toISOString();
const ordinary=(alias='u')=>`${alias}.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') AND NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=${alias}.id) AND NOT EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=${alias}.id) AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=${alias}.id AND pb.active=1) AND NOT EXISTS(SELECT 1 FROM player_expulsions pe WHERE pe.user_id=${alias}.id AND pe.pending=1)`;
export function retainerCountSql(castleExpr,lordExpr){
 return `(SELECT COUNT(*) FROM castle_residents m_count JOIN users u_count ON u_count.id=m_count.user_id WHERE m_count.castle_id=${castleExpr} AND m_count.user_id<>COALESCE(${lordExpr},'') AND ${ordinary('u_count')})`;
}
// Project the lord's household even when the personal save has not advanced
// since the last admission, departure, or succession.
export function lordSupportSql(userExpr) {
  return `(SELECT json_object('castleId',seat.castle_id,'count',${retainerCountSql('seat.castle_id','seat.lord_user_id')})
    FROM castle_seats seat WHERE seat.lord_user_id=${userExpr})`;
}
export function guardLordSupport(guard,user) {
  if (user.is_admin || user.is_staff || user.is_deputy || !Object.hasOwn(user,'retainer_support_json')) return guard;
  return {sql:`${guard.sql} AND ${lordSupportSql('?')} IS ?`,args:[...guard.args,user.id,user.retainer_support_json]};
}
const eligibleResident=(member='m',user='u',save='ps')=>`${ordinary(user)} AND ${save}.save_json IS NOT NULL AND COALESCE(json_extract(${save}.save_json,'$.state.gameOver'),0)=0 AND json_extract(${save}.save_json,'$.state.home')=${member}.castle_id AND json_extract(${save}.save_json,'$.state.castles.'||${member}.castle_id||'.owner')=json_extract(${save}.save_json,'$.state.clan')`;
const plainPerson=(row,evaluationRef=null)=>row?.id?{playerId:row.id,name:row.name,avatarVersion:row.avatar_version||null,...(evaluationRef?{evaluation:evaluationRef(row.id)}:{})}:null;
const failDefault=(status,code,message)=>{const e=new Error(message);e.status=status;e.code=code;throw e;};

async function residencyElapsed(db,now){const row=await S(db,"SELECT * FROM world_clock WHERE id='world-v1'").first();return row?Number(row.base_elapsed_ms)+(row.running?Math.max(0,now-Number(row.anchor_real_ms))*Number(row.speed):0):0;}
async function reconcileResidencyAccess(db,now){
 const invalid=`EXISTS(SELECT 1 FROM castle_residents m JOIN users u ON u.id=m.user_id WHERE m.castle_id='kagoshima' OR NOT(${ordinary('u')}))`;
 if(!await S(db,'SELECT 1 AS found WHERE '+invalid).first())return;
 const elapsed=await residencyElapsed(db,now);await db.batch([
  S(db,'UPDATE castle_residency_meta SET revision=revision+1 WHERE id=1 AND '+invalid),
  S(db,`DELETE FROM castle_residents WHERE castle_id='kagoshima' OR user_id IN(SELECT u.id FROM users u WHERE NOT(${ordinary('u')}))`),
  S(db,`UPDATE castle_seats SET lord_user_id=(SELECT m.user_id FROM castle_residents m JOIN users u ON u.id=m.user_id JOIN player_saves ps ON ps.user_id=m.user_id WHERE m.castle_id=castle_seats.castle_id AND ${eligibleResident()} AND castle_seats.castle_id<>'kagoshima' ORDER BY m.join_order LIMIT 1),lord_epoch=lord_epoch+1,lord_since_elapsed_ms=?,revision=revision+1 WHERE lord_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM castle_residents m WHERE m.user_id=castle_seats.lord_user_id AND m.castle_id=castle_seats.castle_id)`,elapsed)
 ]);
}

export async function ensureResidency(db,now=Date.now()){
 const existing=await S(db,'SELECT * FROM castle_residency_meta WHERE id=1').first();
 if(existing?.bootstrap_token){await reconcileResidencyAccess(db,now);return S(db,'SELECT * FROM castle_residency_meta WHERE id=1').first();}
 const nonce=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM castle_residency_meta WHERE id=1 AND bootstrap_token=?)';
 const statements=[S(db,'INSERT INTO castle_residency_meta(id) VALUES(1) ON CONFLICT(id) DO NOTHING')];
 for(let i=0;i<RESIDENCY_CASTLES.length;i+=40){const ids=RESIDENCY_CASTLES.slice(i,i+40).map(c=>c.id);statements.push(S(db,`INSERT INTO castle_seats(castle_id) VALUES ${ids.map(()=>'(?)').join(',')} ON CONFLICT(castle_id) DO NOTHING`,...ids));}
 statements.push(S(db,'UPDATE castle_residency_meta SET bootstrap_token=?,revision=revision+1 WHERE id=1 AND bootstrap_token IS NULL',nonce));
 // A single transaction determines legacy order; requests cannot race to make
 // the most recently connected duplicate the incumbent lord.
 statements.push(S(db,`INSERT INTO castle_residents(user_id,castle_id,join_order,joined_at)
  SELECT u.id,json_extract(ps.save_json,'$.state.home'),ROW_NUMBER() OVER(ORDER BY u.created_at,u.id),u.created_at
  FROM users u JOIN player_saves ps ON ps.user_id=u.id JOIN castle_seats cs ON cs.castle_id=json_extract(ps.save_json,'$.state.home')
  WHERE ps.save_json IS NOT NULL AND cs.castle_id<>'kagoshima' AND ${ordinary('u')} AND ${gate} ORDER BY u.created_at,u.id ON CONFLICT(user_id) DO NOTHING`,nonce));
 statements.push(S(db,`UPDATE castle_seats SET lord_user_id=(SELECT m.user_id FROM castle_residents m JOIN users u ON u.id=m.user_id JOIN player_saves ps ON ps.user_id=m.user_id WHERE m.castle_id=castle_seats.castle_id AND ${eligibleResident()} ORDER BY m.join_order LIMIT 1),lord_epoch=1,revision=1 WHERE EXISTS(SELECT 1 FROM castle_residents m WHERE m.castle_id=castle_seats.castle_id) AND ${gate}`,nonce));
 statements.push(S(db,`UPDATE castle_seats SET lord_since_elapsed_ms=COALESCE((SELECT json_extract(ps.save_json,'$.state.worldClock.elapsedMs') FROM player_saves ps WHERE ps.user_id=castle_seats.lord_user_id),0) WHERE ${gate}`,nonce));
 statements.push(S(db,`UPDATE castle_residency_meta SET sequence=COALESCE((SELECT MAX(join_order) FROM castle_residents),0) WHERE id=1 AND ${gate}`,nonce));
 await db.batch(statements);await reconcileResidencyAccess(db,now);return S(db,'SELECT * FROM castle_residency_meta WHERE id=1').first();
}

export async function residencySnapshot(db,userId,now=Date.now(),evaluationRef=null){
 const meta=await ensureResidency(db,now),row=userId?await S(db,`SELECT m.*,cs.lord_user_id,cs.lord_epoch,u.name AS lord_name,(SELECT version FROM user_avatars WHERE user_id=u.id) AS avatar_version,EXISTS(SELECT 1 FROM player_saves ownsave WHERE ownsave.user_id=m.user_id AND ${eligibleResident('m','self','ownsave')}) AS eligible,
  ${retainerCountSql('cs.castle_id','cs.lord_user_id')} AS retainers,
  (SELECT COUNT(*) FROM castle_residents q JOIN users qu ON qu.id=q.user_id JOIN player_saves qs ON qs.user_id=q.user_id WHERE q.castle_id=m.castle_id AND q.user_id<>COALESCE(cs.lord_user_id,'') AND q.join_order<=m.join_order AND ${eligibleResident('q','qu','qs')}) AS position
  FROM castle_residents m JOIN users self ON self.id=m.user_id JOIN castle_seats cs ON cs.castle_id=m.castle_id LEFT JOIN users u ON u.id=cs.lord_user_id
  WHERE m.user_id=? AND ${ordinary('self')}`,userId).first():null;
 if(!row)return{residency:null,residencyRevision:Number(meta.revision)};
 const lord=plainPerson(row.lord_user_id?{id:row.lord_user_id,name:row.lord_name,avatar_version:row.avatar_version}:null,evaluationRef),role=row.lord_user_id===userId?'lord':'retainer';
 return{residency:{role,castleId:row.castle_id,castleName:castles.get(row.castle_id).name,retainerCount:Number(row.retainers),joinedAt:iso(row.joined_at),eligible:!!row.eligible,successionPosition:role==='lord'?0:row.eligible?Number(row.position):null,lord,lordPlayerId:row.lord_user_id||null,lordEpoch:Number(row.lord_epoch),revision:Number(meta.revision)},residencyRevision:Number(meta.revision)};
}

export async function residencyDirectory({db,user=null,url,now,helpers:h}){
 const meta=await ensureResidency(db,now),list=R(await S(db,`SELECT cs.*,u.name,u.id,(SELECT version FROM user_avatars WHERE user_id=u.id) AS avatar_version,
  ${retainerCountSql('cs.castle_id','cs.lord_user_id')} AS retainers
  FROM castle_seats cs LEFT JOIN users u ON u.id=cs.lord_user_id WHERE cs.castle_id<>'kagoshima' ORDER BY cs.castle_id`).all());
 const mapped=list.map(row=>{const c=castles.get(row.castle_id);return{castleId:c.id,castleName:c.name,region:c.region||'',province:c.province||'',available:!row.lord_user_id,lord:plainPerson(row,h.evaluationRef),retainerCount:Number(row.retainers),lordEpoch:Number(row.lord_epoch),revision:Number(row.revision)};});
 const own=await residencySnapshot(db,user?.id,now,h.evaluationRef),occupied=mapped.filter(c=>!c.available).length;
 const out={ok:true,revision:Number(meta.revision),capacity:RESIDENCY_CASTLES.length,occupied,full:occupied===RESIDENCY_CASTLES.length,castles:mapped,self:own.residency};
 const castleId=url.searchParams.get('castleId');if(!castleId)return out;
 if(!castles.has(castleId))h.fail(400,'INVALID_CASTLE','家臣として仕える城を確認してください。');
 const cursorText=url.searchParams.get('cursor')||'0',limitText=url.searchParams.get('limit')||'50';if(!/^\d{1,16}$/.test(cursorText)||!/^\d{1,3}$/.test(limitText)||Number(limitText)<1||Number(limitText)>100)h.fail(400,'INVALID_CURSOR','家臣一覧の続きを確認してください。');
 const seat=list.find(x=>x.castle_id===castleId),limit=Number(limitText),members=R(await S(db,`SELECT m.*,u.id,u.name,(SELECT version FROM user_avatars WHERE user_id=u.id) AS avatar_version,EXISTS(SELECT 1 FROM player_saves ownsave WHERE ownsave.user_id=m.user_id AND ${eligibleResident('m','u','ownsave')}) AS eligible,
  (SELECT COUNT(*) FROM castle_residents q JOIN users qu ON qu.id=q.user_id JOIN player_saves qs ON qs.user_id=q.user_id WHERE q.castle_id=m.castle_id AND q.user_id<>? AND q.join_order<=m.join_order AND ${eligibleResident('q','qu','qs')}) AS position
  FROM castle_residents m JOIN users u ON u.id=m.user_id WHERE m.castle_id=? AND m.user_id<>? AND m.join_order>? AND ${ordinary('u')} ORDER BY m.join_order LIMIT ?`,seat.lord_user_id||'',castleId,seat.lord_user_id||'',Number(cursorText),limit+1).all());
 out.roster={castleId,lord:plainPerson(seat,h.evaluationRef),retainers:members.slice(0,limit).map(m=>({...plainPerson(m,h.evaluationRef),joinedAt:iso(m.joined_at),eligible:!!m.eligible,successionPosition:m.eligible?Number(m.position):null})),nextCursor:members.length>limit?String(members[limit-1].join_order):null,total:Number(seat.retainers)};
 const history=R(await S(db,'SELECT result_json,created_at FROM castle_successions WHERE castle_id=? ORDER BY created_at DESC,event_id DESC LIMIT 10',castleId).all());
 out.history=history.map(r=>({...JSON.parse(r.result_json),createdAt:iso(r.created_at)}));return out;
}

// Added to the same save receipt as a first upload for older clients. It never
// moves an existing membership, changes FIFO order, or trusts imported role data.
export async function initialResidencyStatements(db,{user,save,now,gateSql,gateArgs}){
 await ensureResidency(db,now);const castleId=save.state.home;
 if(user.is_admin||user.is_staff||user.is_deputy||!castles.has(castleId)||await S(db,'SELECT 1 AS found FROM castle_residents WHERE user_id=? UNION ALL SELECT 1 FROM player_expulsions WHERE user_id=? AND pending=1',user.id,user.id).first())return[];
 const absent='NOT EXISTS(SELECT 1 FROM castle_residents WHERE user_id=?)',eligible=`${gateSql} AND ${absent}`;
 return[
  S(db,`UPDATE castle_residency_meta SET sequence=sequence+1,revision=revision+1 WHERE id=1 AND ${eligible}`,...gateArgs,user.id),
  S(db,`INSERT INTO castle_residents(user_id,castle_id,join_order,joined_at) SELECT ?,?,sequence,? FROM castle_residency_meta WHERE id=1 AND ${eligible} ON CONFLICT(user_id) DO NOTHING`,user.id,castleId,now,...gateArgs,user.id),
  S(db,`UPDATE castle_seats SET lord_since_elapsed_ms=CASE WHEN lord_user_id IS NULL THEN ? ELSE lord_since_elapsed_ms END,lord_user_id=COALESCE(lord_user_id,CASE WHEN ?=1 THEN ? ELSE NULL END),lord_epoch=lord_epoch+CASE WHEN lord_user_id IS NULL AND ?=1 THEN 1 ELSE 0 END,revision=revision+1 WHERE castle_id=? AND ${gateSql} AND EXISTS(SELECT 1 FROM castle_residents WHERE user_id=? AND castle_id=? AND joined_at=?)`,Math.floor(save.state.worldClock?.elapsedMs||0),!save.state.gameOver&&save.state.castles[castleId]?.owner===save.state.clan?1:0,user.id,!save.state.gameOver&&save.state.castles[castleId]?.owner===save.state.clan?1:0,castleId,...gateArgs,user.id,castleId,now)
 ];
}

export async function residencyTargetGuard(db,{attackerId,targetId,castleId,isHome=true,term=null,now=Date.now(),fail=failDefault}){
 await ensureResidency(db,now);
 const own=await S(db,'SELECT castle_id FROM castle_residents WHERE user_id=?',attackerId).first(),target=await S(db,'SELECT castle_id FROM castle_residents WHERE user_id=?',targetId).first();
 if(own&&target&&own.castle_id===target.castle_id)fail(409,'HOUSEHOLD_ALLIED','同じ城の領主・家臣には攻撃できません。');
 const guard={sql:'NOT EXISTS(SELECT 1 FROM castle_residents a JOIN castle_residents d ON d.castle_id=a.castle_id WHERE a.user_id=? AND d.user_id=?)',args:[attackerId,targetId],term:null};
 if(!isHome||!castles.has(castleId)){if(term)fail(409,'RESIDENCY_TARGET_CHANGED','進軍中に城の領主が変わったため、部隊は帰還します。');return guard;}
 const seat=await S(db,'SELECT * FROM castle_seats WHERE castle_id=?',castleId).first();
 if(seat?.lord_user_id!==targetId||term&&(term.castleId!==castleId||term.lordPlayerId!==targetId||Number(term.lordEpoch)!==Number(seat.lord_epoch)))fail(409,'RESIDENCY_TARGET_CHANGED','城の領主が変わりました。共有地図で現在の領主を確認してください。');
 guard.term={castleId,lordPlayerId:targetId,lordEpoch:Number(seat.lord_epoch)};
 guard.sql+=' AND EXISTS(SELECT 1 FROM castle_seats WHERE castle_id=? AND lord_user_id=? AND lord_epoch=?)';guard.args.push(castleId,targetId,seat.lord_epoch);return guard;
}

export async function prepareResidencySuccession(db,{userId,castleId,battleId,kind='field',now=Date.now()}){
 await ensureResidency(db,now);const empty={guard:safe,succession:null,statements:()=>[]};if(!castles.has(castleId))return empty;
 const seat=await S(db,'SELECT cs.*,u.name FROM castle_seats cs JOIN users u ON u.id=cs.lord_user_id WHERE cs.castle_id=? AND cs.lord_user_id=?',castleId,userId).first();if(!seat)return empty;
 const candidate=await S(db,`SELECT m.*,u.name FROM castle_residents m JOIN users u ON u.id=m.user_id JOIN player_saves ps ON ps.user_id=m.user_id WHERE m.castle_id=? AND m.user_id<>? AND ${eligibleResident()} ORDER BY m.join_order LIMIT 1`,castleId,userId).first();
 const noCandidateGuard={sql:`EXISTS(SELECT 1 FROM castle_seats WHERE castle_id=? AND lord_user_id=? AND lord_epoch=?) AND NOT EXISTS(SELECT 1 FROM castle_residents m JOIN users u ON u.id=m.user_id JOIN player_saves ps ON ps.user_id=m.user_id WHERE m.castle_id=? AND m.user_id<>? AND ${eligibleResident()})`,args:[castleId,userId,seat.lord_epoch,castleId,userId]};
 if(!candidate&&kind!=='cpu')return{...empty,guard:noCandidateGuard};
 const eventId=kind+':'+battleId,nonce=crypto.randomUUID(),elapsed=await residencyElapsed(db,now);
 const guard=candidate?{sql:`EXISTS(SELECT 1 FROM castle_seats WHERE castle_id=? AND lord_user_id=? AND lord_epoch=?) AND ?=(SELECT m.user_id FROM castle_residents m JOIN users u ON u.id=m.user_id JOIN player_saves ps ON ps.user_id=m.user_id WHERE m.castle_id=? AND m.user_id<>? AND ${eligibleResident()} ORDER BY m.join_order LIMIT 1)`,args:[castleId,userId,seat.lord_epoch,candidate.user_id,castleId,userId]}:noCandidateGuard;
 const succession={castleId,castleName:castles.get(castleId).name,previousLordPlayerId:userId,previousLordName:seat.name,lordPlayerId:candidate?.user_id||null,lordName:candidate?.name||null,lordEpoch:Number(seat.lord_epoch)+1,reason:kind,...(!candidate?{vacant:true}:{})};
 const eventGate='EXISTS(SELECT 1 FROM castle_successions WHERE event_id=? AND commit_token=?)',eventArgs=[eventId,nonce],resultJson=JSON.stringify(succession),title=succession.castleName+'の領主継承',body=candidate?succession.castleName+(kind==='departure'?'の領主が新たな城へ移り、':'の防衛戦が敗北となり、')+'仕えた順番に従って'+candidate.name+'が領主を引き継ぎました。'+(kind==='departure'?'':seat.name+'は家臣の列の最後に加わります。')+'各プレイヤーの資産・武将・育成記録は引き続き本人が保持します。':succession.castleName+'が陥落し、引き継げる家臣がいないため領主の席が空きました。育成記録は保持されています。新たな物語を始める際に、空いている城か家臣として仕える城を選べます。';
 return{guard,succession,statements:(parentGate,parentArgs)=>[
  S(db,`INSERT INTO castle_successions(event_id,castle_id,previous_lord_id,lord_user_id,lord_epoch,kind,result_json,commit_token,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${parentGate} AND ${guard.sql} ON CONFLICT(event_id) DO NOTHING`,eventId,castleId,userId,candidate?.user_id||null,succession.lordEpoch,kind,resultJson,nonce,now,...parentArgs,...guard.args),
  S(db,`UPDATE castle_residency_meta SET sequence=sequence+1,revision=revision+1 WHERE id=1 AND ${eventGate}`,...eventArgs),
  S(db,`UPDATE castle_residents SET join_order=(SELECT sequence FROM castle_residency_meta WHERE id=1),joined_at=?,revision=revision+1 WHERE user_id=? AND ${eventGate}`,now,userId,...eventArgs),
  ...(candidate?[S(db,`UPDATE castle_residents SET revision=revision+1 WHERE user_id=? AND ${eventGate}`,candidate.user_id,...eventArgs)]:[]),
  S(db,`UPDATE castle_seats SET lord_user_id=?,lord_epoch=lord_epoch+1,lord_since_elapsed_ms=?,revision=revision+1 WHERE castle_id=? AND ${eventGate}`,candidate?.user_id||null,elapsed,castleId,...eventArgs),
  ...[userId,...(candidate?[candidate.user_id]:[])].map(recipient=>S(db,`INSERT INTO mail_campaigns(id,sender_id,target_user_id,title,body,gift_json,request_id,payload_hash,created_at) SELECT ?,?,?,?,?,NULL,?,?,? WHERE ${eventGate} ON CONFLICT(sender_id,request_id) DO NOTHING`,'m_res_'+crypto.randomUUID().replaceAll('-',''),userId,recipient,title,body,'system:succession:'+eventId+':'+recipient,resultJson,now,...eventArgs))
 ]};
}

export async function prepareResidencyCpuLosses(db,{userId,events,now=Date.now(),state=null}){
 await ensureResidency(db,now);const losses=(events||[]).filter(e=>e?.kind==='cpu'&&typeof e.id==='string'),empty={guard:safe,succession:null,statements:()=>[]};if(!losses.length)return empty;
 const seat=await S(db,'SELECT cs.* FROM castle_residents m JOIN castle_seats cs ON cs.castle_id=m.castle_id WHERE m.user_id=?',userId).first();
 // A retainer's catch-up can race an appointment. The original save CAS must
 // retry against that new term before storing a now-ineligible private home.
 const guard=seat?{sql:"EXISTS(SELECT 1 FROM castle_residents m JOIN castle_seats cs ON cs.castle_id=m.castle_id WHERE m.user_id=? AND cs.castle_id=? AND cs.lord_epoch=? AND COALESCE(cs.lord_user_id,'')=?)",args:[userId,seat.castle_id,seat.lord_epoch,seat.lord_user_id||'']}:{sql:'NOT EXISTS(SELECT 1 FROM castle_seats WHERE lord_user_id=?)',args:[userId]};
 if(seat?.lord_user_id!==userId)return{...empty,guard};
 const event=losses.find(e=>e.castleId===seat.castle_id&&Number(e.occurredElapsedMs)>Number(seat.lord_since_elapsed_ms));
 if(event)return prepareResidencySuccession(db,{userId,castleId:event.castleId,battleId:event.id,kind:'cpu',now});
 // An offline successor may replay a private defeat that happened before
 // taking office. That historical event must neither dismiss nor hide them.
 if(state&&losses.some(e=>e.castleId===seat.castle_id&&Number(e.occurredElapsedMs)<=Number(seat.lord_since_elapsed_ms))&&state.castles?.[seat.castle_id]){
  state.castles[seat.castle_id].owner=state.clan;state.home=seat.castle_id;state.gameOver=false;
  const clock=await S(db,"SELECT running FROM world_clock WHERE id='world-v1'").first();if(state.realtime)state.realtime.running=!!clock?.running;
 }
 return{...empty,guard};
}

export async function residencyStart(ctx,body){
 const {db,user,now,helpers:h}=ctx;await h.requireAccountAccess(db,user);await ensureResidency(db,now);
 if(user.is_admin||user.is_staff||user.is_deputy)h.fail(403,'RESIDENCY_PROTECTED','現在の拠点の利用資格では、通常城の領主・家臣を選び直せません。');
 if(!body||Object.keys(body).some(k=>!['deviceId','revision','requestId','castleId','mode','clan','difficulty'].includes(k))||!Number.isSafeInteger(body.revision)||body.revision<0||!['lord','retainer'].includes(body.mode)||!castles.has(body.castleId)||!['easy','normal','hard'].includes(body.difficulty)||!globalThis.SENGOKU_DATA.clans.some(c=>c.name===body.clan))h.fail(400,'INVALID_INPUT','開始する城・身分・勢力・難易度を選んでください。');
 for(const key of ['deviceId','requestId','castleId'])h.idField(body[key],key);
 const digest=await h.hash(JSON.stringify([body.castleId,body.mode,body.clan,body.difficulty]));
 const prior=await S(db,'SELECT * FROM castle_residency_requests WHERE actor_id=? AND request_id=?',user.id,body.requestId).first();
 const reply=async idempotent=>{const current=await h.getUser(db,user.id);if(!current.expulsion_pending&&Number(current.expulsion_epoch)===Number(user.expulsion_epoch||0)+1){user.expulsion_epoch=current.expulsion_epoch;user.expulsion_pending=0;}return {...await h.syncSnapshot(db,await h.getSyncRow(db,user.id),current,body.deviceId,now),admission:{requestId:body.requestId,mode:body.mode,castleId:body.castleId,idempotent}};};
 if(prior){if(prior.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の入城に使われています。');return reply(true);}
 await h.budget(db,'residency-start:'+user.id,15,60000,now);
 const row=await h.getSyncRow(db,user.id);if(!row||row.writer_device_id!==body.deviceId||Number(row.lease_expires_at)<=now)h.fail(409,'LEASE_REQUIRED','この端末を操作端末にしてから入城してください。');if(Number(row.revision)!==body.revision)h.fail(409,'REVISION_CONFLICT','最新の保存を確認してから入城してください。');
 const pending=await S(db,"SELECT 1 AS found FROM battle_marches WHERE actor_id=? AND status='marching' UNION ALL SELECT 1 FROM covert_states WHERE actor_id=? AND json_array_length(state_json,'$.dispatches')>0 LIMIT 1",user.id,user.id).first();if(pending)h.fail(409,'ARMY_MARCHING','進軍中の部隊が戻ってから、新しい物語を始めてください。');
 const seat=await S(db,'SELECT * FROM castle_seats WHERE castle_id=?',body.castleId).first(),old=await S(db,'SELECT m.*,cs.lord_user_id,cs.lord_epoch FROM castle_residents m JOIN castle_seats cs ON cs.castle_id=m.castle_id WHERE m.user_id=?',user.id).first();
 if(body.mode==='lord'&&seat.lord_user_id&&seat.lord_user_id!==user.id)h.fail(409,'CASTLE_OCCUPIED','この城にはすでに領主がいます。家臣として入るか、空いている城を選んでください。');
 if(body.mode==='retainer'&&(!seat.lord_user_id||seat.lord_user_id===user.id))h.fail(409,'CASTLE_VACANT','仕える領主が変わりました。城の一覧を更新してください。');
 const expelled=await S(db,'SELECT * FROM player_expulsions WHERE user_id=? AND pending=1',user.id).first();
 const clock=await h.getWorldClock(db,now),game=expelled?GameEngine.fromSave(h.normalizeGameSave(JSON.parse(expelled.source_save_json),user,now,{reading:true,clock}),GAME_OFFICERS):new GameEngine({officers:GAME_OFFICERS,clan:body.clan,difficulty:body.difficulty,startCastle:body.castleId});
 if(expelled){const moved=game.relocateResidence(body.castleId,{role:body.mode,worldClock:clock,residencyCastleId:''});if(!moved.ok)h.fail(409,moved.code,moved.message);}
 const anchored=game.applyWorldClock(clock);if(!anchored.ok||anchored.pending)h.fail(409,'CLOCK_STALE','共通時計を確認してから入城してください。');
 const save=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock});save.state.cycle.latestReward=null;
 const nonce=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM castle_residency_requests WHERE actor_id=? AND request_id=? AND commit_token=?)',args=[user.id,body.requestId,nonce],role=h.roleCommitGuard(user),memberGuard=old?{sql:'EXISTS(SELECT 1 FROM castle_residents WHERE user_id=? AND castle_id=? AND revision=?)',args:[user.id,old.castle_id,old.revision]}:{sql:'NOT EXISTS(SELECT 1 FROM castle_residents WHERE user_id=?)',args:[user.id]};
 const leaving=old?.lord_user_id===user.id&&old.castle_id!==body.castleId?await prepareResidencySuccession(db,{userId:user.id,castleId:old.castle_id,battleId:'departure:'+user.id+':'+body.requestId,kind:'departure',now}):null;
 const expulsionGuard=expelled?{sql:'EXISTS(SELECT 1 FROM player_expulsions WHERE user_id=? AND pending=1 AND revision=?)',args:[user.id,expelled.revision]}:{sql:'NOT EXISTS(SELECT 1 FROM player_expulsions WHERE user_id=? AND pending=1)',args:[user.id]};
 const statements=[S(db,`INSERT INTO castle_residency_requests(actor_id,request_id,request_hash,commit_token,castle_id,mode,created_at)
  SELECT ?,?,?,?,?,?,? FROM player_saves ps JOIN castle_seats cs ON cs.castle_id=? WHERE ps.user_id=? AND ps.revision=? AND ps.writer_device_id=? AND ps.lease_expires_at>? AND cs.lord_epoch=? AND COALESCE(cs.lord_user_id,'')=? AND ${role.sql} AND ${memberGuard.sql} AND ${leaving?.guard.sql||'1=1'} AND ${expulsionGuard.sql}
  AND NOT EXISTS(SELECT 1 FROM battle_marches WHERE actor_id=? AND status='marching') AND NOT EXISTS(SELECT 1 FROM covert_states WHERE actor_id=? AND json_array_length(state_json,'$.dispatches')>0) ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,body.requestId,digest,nonce,body.castleId,body.mode,now,body.castleId,user.id,row.revision,body.deviceId,now,seat.lord_epoch,seat.lord_user_id||'',...role.args,...memberGuard.args,...(leaving?.guard.args||[]),...expulsionGuard.args,user.id,user.id)];
 if(leaving?.succession)statements.push(...leaving.statements(gate,args));
 if(old&&old.castle_id!==body.castleId){statements.push(S(db,`UPDATE castle_seats SET lord_user_id=NULL,lord_epoch=lord_epoch+1,revision=revision+1 WHERE castle_id=? AND lord_user_id=? AND ${gate}`,old.castle_id,user.id,...args));statements.push(S(db,`DELETE FROM castle_residents WHERE user_id=? AND ${gate}`,user.id,...args));}
 const retainOrder=old?.castle_id===body.castleId;
 statements.push(S(db,`UPDATE castle_residency_meta SET sequence=sequence+?,revision=revision+1 WHERE id=1 AND ${gate}`,retainOrder?0:1,...args));
 if(!retainOrder)statements.push(S(db,`INSERT INTO castle_residents(user_id,castle_id,join_order,joined_at) SELECT ?,?,sequence,? FROM castle_residency_meta WHERE id=1 AND ${gate}`,user.id,body.castleId,now,...args));
 statements.push(S(db,`UPDATE castle_seats SET lord_since_elapsed_ms=CASE WHEN ?='lord' AND lord_user_id IS NULL THEN ? ELSE lord_since_elapsed_ms END,lord_user_id=CASE WHEN ?='lord' THEN ? ELSE lord_user_id END,lord_epoch=lord_epoch+CASE WHEN ?='lord' AND lord_user_id IS NULL THEN 1 ELSE 0 END,revision=revision+1 WHERE castle_id=? AND ${gate}`,body.mode,clock.elapsedMs,body.mode,user.id,body.mode,body.castleId,...args));
 statements.push(S(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=?,cycle_index=?,cycle_home=?,cycle_commit=? WHERE user_id=? AND ${gate}`,JSON.stringify(save),now,now+h.syncLease,save.state.cycle.index,save.state.home,nonce,user.id,...args));
 statements.push(S(db,`UPDATE users SET clan=? WHERE id=? AND ${gate}`,save.state.clan,user.id,...args));
 if(expelled)statements.push(S(db,`UPDATE player_expulsions SET pending=0,source_save_json=NULL,resumed_at=?,revision=revision+1 WHERE user_id=? AND pending=1 AND ${gate}`,now,user.id,...args));
 statements.push(...externalTroopSnapshotStatements(db,[user.id],clock,gate,args));
 const result=await db.batch(statements);if(!R(result[0]).length){const done=await S(db,'SELECT request_hash FROM castle_residency_requests WHERE actor_id=? AND request_id=?',user.id,body.requestId).first();if(done?.request_hash===digest)return reply(true);const current=await S(db,'SELECT lord_user_id FROM castle_seats WHERE castle_id=?',body.castleId).first();if(body.mode==='lord'&&current?.lord_user_id&&current.lord_user_id!==user.id)h.fail(409,'CASTLE_OCCUPIED','この城への入城が先に確定しました。一覧を更新してください。');h.fail(409,'RESIDENCY_CHANGED','城の領主・家臣または保存が更新されました。もう一度確認してください。');}
 return reply(false);
}
