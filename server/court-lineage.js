// Court lineage is a public identity and imperial eligibility, never a source
// of account administration permissions. Completed succession is also proof
// of royal ancestry for legacy Emperors who did not yet establish a house.
// It survives dismissal, succession and campaign changes for the same user ID.
import {playerNameKey} from './player-names.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args);
export const NOBLE_HOUSES=Object.freeze([
 {id:'konoe',name:'近衛家'},{id:'kujo',name:'九条家'},{id:'ichijo',name:'一条家'},
 {id:'nijo',name:'二条家'},{id:'takatsukasa',name:'鷹司家'}
].map(Object.freeze));
const BY_ID=Object.fromEntries(NOBLE_HOUSES.map(house=>[house.id,house]));
const REQUIREMENT=Object.freeze({officeId:'sadaijin',officeName:'左大臣',minMerit:2000});
const GATE='EXISTS(SELECT 1 FROM court_lineage_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const kyotoService=user=>!!user.is_staff&&!user.is_admin;
const member=user=>!!user.court_retained_term||kyotoService(user);
const term=user=>user.court_retained_term||(kyotoService(user)?user.staff_term||null:null);

export const courtImperialFamilySql=userId=>`(EXISTS(SELECT 1 FROM court_lineages ic_lineage WHERE ic_lineage.user_id=${userId} AND ic_lineage.imperial_house_name IS NOT NULL AND length(trim(ic_lineage.imperial_house_name))>0)
 OR EXISTS(SELECT 1 FROM court_succession_requests ic_history WHERE ic_history.actor_id=${userId}))`;
export const courtImperialMemberTermSql=userId=>`COALESCE((SELECT COALESCE(ic_staff.term_id,'legacy:'||ic_staff.appointed_at) FROM staff_members ic_staff WHERE ic_staff.user_id=${userId}),(SELECT ic_member.term_id FROM court_retained_memberships ic_member WHERE ic_member.user_id=${userId}))`;
export const courtImperialCandidateSql=(userId,termSql=null)=>`${courtImperialFamilySql(userId)} AND ${courtImperialMemberTermSql(userId)} IS NOT NULL${termSql?` AND ${courtImperialMemberTermSql(userId)}=${termSql}`:''}`;
export const isCourtImperialFamily=user=>!!user.imperial_heritage||!!BY_ID[user.court_house_id]&&typeof user.imperial_house_name==='string'&&!!user.imperial_house_name.trim();
export const courtImperialMemberTerm=user=>user.is_staff?user.staff_term||null:user.court_retained_term||null;
// Retained-home members enter palace service on coronation. The established
// staff synchronizer preserves their personal campaign for their abdication.
export function courtImperialAdmissionStatement(db,userId,memberTerm,appointedBy,now,elapsedMs,gate,args){
 return S(db,`INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms)
  SELECT ?,?,?,?,? WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM staff_members WHERE user_id=?)
  AND EXISTS(SELECT 1 FROM court_retained_memberships WHERE user_id=? AND term_id=?) ON CONFLICT(user_id) DO NOTHING`,userId,appointedBy,now,memberTerm,elapsedMs,...args,userId,userId,memberTerm);
}

export function courtHouseId(value,fail){
 if(typeof value!=='string'||!Object.hasOwn(BY_ID,value))fail(400,'COURT_HOUSE_REQUIRED','近衛家・九条家・一条家・二条家・鷹司家から家柄を選んでください。');
 return value;
}
export function publicCourtLineage(user){
 const house=BY_ID[user.court_house_id],isMember=member(user),imperial=isCourtImperialFamily(user);
 if(!house&&!isMember&&!imperial)return null;
 return{class:imperial?'imperial':'kuge',houseId:house?.id||null,houseName:house?.name||null,imperialHouseName:house?user.imperial_house_name||null:null,originalClan:house?user.court_original_clan||null:null,needsHouseSelection:isMember&&!house};
}
export function courtHouseMembershipGuard(userId,houseId){
 return{sql:'(NOT EXISTS(SELECT 1 FROM court_lineages WHERE user_id=?) OR EXISTS(SELECT 1 FROM court_lineages WHERE user_id=? AND house_id=?))',args:[userId,userId,houseId]};
}
export function courtHouseMembershipStatement(db,userId,houseId,now,gate,args,originalClan=null){
 return S(db,`INSERT INTO court_lineages(user_id,house_id,original_clan,revision,created_at,updated_at) SELECT ?,?,?,1,?,? WHERE ${gate} ON CONFLICT(user_id) DO NOTHING`,userId,houseId,originalClan,now,now,...args);
}
async function state(ctx,user=ctx.user){
 const row=await S(ctx.db,`SELECT (SELECT house_id FROM court_lineages WHERE user_id=?) AS house_id,
  (SELECT imperial_house_name FROM court_lineages WHERE user_id=?) AS imperial_house_name,
  (SELECT original_clan FROM court_lineages WHERE user_id=?) AS original_clan,
  COALESCE((SELECT revision FROM court_lineages WHERE user_id=?),0) AS revision,
  COALESCE((SELECT merit FROM court_rank_progress WHERE user_id=?),0) AS merit`,user.id,user.id,user.id,user.id,user.id).first();
 const isMember=member(user),house=BY_ID[row.house_id],imperial=!!row.imperial_house_name,
  qualified=isMember&&!user.is_admin&&Number(row.merit)>=REQUIREMENT.minMerit,
  canChooseHouse=isMember&&!house,canCreateImperialHouse=!!house&&!imperial&&qualified;
 const reason=imperial?'宮家は創立済みです。':!isMember?'京都御所への正式加入が必要です。':!house?'先に五摂家から家柄を選んでください。':!qualified?'正式加入後、現在の在任期間で朝廷功績2,000を積み、左大臣へ昇格すると宮家を創立できます。':'';
 return{...(publicCourtLineage({...user,court_house_id:row.house_id,court_original_clan:row.original_clan,imperial_house_name:row.imperial_house_name})||{class:null,houseId:null,houseName:null,imperialHouseName:null,originalClan:null,needsHouseSelection:false}),revision:Number(row.revision),termId:term(user),canChooseHouse,canCreateImperialHouse,reason,requirement:REQUIREMENT};
}
export async function courtLineageStatus(ctx){return state(ctx);}
function readName(value,h){
 if(typeof value!=='string'||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value))h.fail(400,'INVALID_INPUT','宮家名は改行や制御文字を含まない2〜20文字で入力してください。');
 const name=value.normalize('NFKC').trim();
 if(Array.from(name).length<2||Array.from(name).length>20)h.fail(400,'INVALID_INPUT','宮家名は2〜20文字で入力してください。');
 return name;
}
function requestQuery(ctx){
 const query=ctx.url.searchParams;
 if([...query.keys()].some(key=>key!=='receipt')||query.has('receipt')&&(query.getAll('receipt').length!==1||query.get('receipt')!=='1'))ctx.helpers.fail(400,'INVALID_INPUT','家柄・宮家の照会方法を確認してください。');
 return query.has('receipt');
}
export async function handleCourtLineage(ctx){
 const {db,user,helpers:h,now}=ctx;await h.requireAccountAccess(db,user);
 if(ctx.method!=='POST')h.fail(405,'METHOD_NOT_ALLOWED','この操作には対応していません。');
 const action=ctx.path==='/court/house'?'choose-house':'create-imperial-house',body=await h.readBody(ctx.request),choose=action==='choose-house',
  keys=['requestId','expectedRevision','termId','confirmed',choose?'houseId':'name'];
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key))||body.confirmed!==true||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||typeof body.termId!=='string'||!body.termId||body.termId.length>150||/[\u0000-\u001f\u007f]/u.test(body.termId))h.fail(400,'INVALID_INPUT','家柄・宮家の確認内容を更新してください。');
 const requestId=h.idField(body.requestId,'操作番号'),houseId=choose?courtHouseId(body.houseId,h.fail):null,name=choose?null:readName(body.name,h),receiptOnly=requestQuery(ctx),
  digest=await h.hash(JSON.stringify(['court-lineage-v1',action,body.expectedRevision,body.termId,houseId,name,true]));
 const prior=async()=>{const row=await S(db,'SELECT * FROM court_lineage_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first();if(row&&row.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の家柄・宮家の操作に使用されています。');return row;};
 const respond=async(receipt,idempotent)=>({ok:true,lineage:await state(ctx,await h.getUser(db,user.id)),receipt:{requestId,action:receipt.action,houseId:receipt.house_id,name:receipt.imperial_house_name||null,revision:Number(receipt.result_revision)},idempotent});
 const previous=await prior();if(previous)return respond(previous,true);
 if(receiptOnly)h.fail(404,'COURT_LINEAGE_RECEIPT_PENDING','この家柄・宮家の受付はまだ確認できません。');
 const conflict=async()=>{
  await h.requireAccountAccess(db,user);const currentUser=await h.getUser(db,user.id),current=await state(ctx,currentUser);
  if(!member(currentUser)||current.termId!==body.termId)h.fail(409,'COURT_MEMBERSHIP_CHANGED','京都御所の所属が変わりました。最新の状態を確認してください。');
  if(current.revision!==body.expectedRevision)h.fail(409,'COURT_LINEAGE_CHANGED','家柄・宮家の状態が変わりました。最新の状態を確認してください。');
  if(choose&&!current.canChooseHouse)h.fail(409,'COURT_HOUSE_ALREADY_CHOSEN','家柄は選択済みです。');
  if(!choose&&!current.canCreateImperialHouse)h.fail(403,'COURT_IMPERIAL_HOUSE_REQUIRED',current.reason);
  if(!choose&&await S(db,'SELECT 1 AS taken FROM court_lineages WHERE imperial_house_key=?',playerNameKey(name)).first())h.fail(409,'COURT_IMPERIAL_HOUSE_NAME_TAKEN','その宮家名はすでに使われています。別の名前を入力してください。');
  return current;
 };
 const current=await conflict();await h.budget(db,'court-lineage:'+user.id,15,60000,now);
 const role=h.roleCommitGuard(user),nonce=crypto.randomUUID(),args=[user.id,requestId,nonce],revision=body.expectedRevision+1,chosen=choose?houseId:current.houseId,
  memberGuard="(EXISTS(SELECT 1 FROM court_retained_memberships cm WHERE cm.user_id=? AND cm.term_id=?) OR (EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=? AND COALESCE(sm.term_id,'legacy:'||sm.appointed_at)=?) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)))",
  lineageGuard=choose?'NOT EXISTS(SELECT 1 FROM court_lineages WHERE user_id=?)':`EXISTS(SELECT 1 FROM court_lineages WHERE user_id=? AND revision=? AND house_id=? AND imperial_house_name IS NULL)
   AND NOT EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)
   AND EXISTS(SELECT 1 FROM court_rank_progress WHERE user_id=? AND term_id=? AND merit>=?)
   AND NOT EXISTS(SELECT 1 FROM court_lineages WHERE imperial_house_key=?)`,
  lineageArgs=choose?[user.id]:[user.id,body.expectedRevision,chosen,user.id,user.id,body.termId,REQUIREMENT.minMerit,playerNameKey(name)];
 const statements=[S(db,`INSERT INTO court_lineage_requests(actor_id,request_id,action,house_id,imperial_house_name,expected_revision,result_revision,term_id,request_hash,commit_token,created_at)
  SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${role.sql} AND ${memberGuard} AND ${lineageGuard}
  ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING *`,user.id,requestId,action,chosen,name,body.expectedRevision,revision,body.termId,digest,nonce,now,...role.args,user.id,body.termId,user.id,body.termId,user.id,...lineageArgs)];
 if(choose)statements.push(S(db,`INSERT INTO court_lineages(user_id,house_id,original_clan,revision,created_at,updated_at)
  SELECT ?,?,(SELECT CASE WHEN json_valid(b.save_json) THEN json_extract(b.save_json,'$.state.clan') END
   FROM staff_campaign_backups b JOIN staff_members sm ON sm.user_id=b.user_id
   WHERE b.user_id=? AND b.active=1 AND b.term_id=COALESCE(sm.term_id,'legacy:'||sm.appointed_at)),1,?,?
  WHERE ${GATE} ON CONFLICT(user_id) DO NOTHING`,user.id,houseId,user.id,now,now,...args));
 else statements.push(S(db,`UPDATE court_lineages SET imperial_house_name=?,imperial_house_key=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${GATE}`,name,playerNameKey(name),now,user.id,...args));
 const accepted=(await db.batch(statements))[0].results?.[0];if(accepted)return respond(accepted,false);
 const existing=await prior();if(existing)return respond(existing,true);
 await conflict();h.fail(409,'COURT_LINEAGE_CHANGED','家柄・宮家の状態が変わりました。もう一度確認してください。');
}
