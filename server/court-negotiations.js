// A family is a public identity. Negotiated service never grants account,
// castle, army or palace permissions; both players retain their own campaigns.
import {NOBLE_HOUSES} from './court-lineage.js';
import {socialNotificationStatement} from './social-notifications.js';
import {advanceReservedMarch} from './marches.js';
import {ensureResidency,prepareResidencyCpuLosses} from './residency.js';
import {externalTroopSnapshotStatements} from './maintenance.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),R=result=>result?.results||[];
const HOUSES=Object.fromEntries(NOBLE_HOUSES.map(h=>[h.id,h.name]));
const RESOURCES=Object.freeze(['gold','rice','wood','stone']);
const RULES=Object.freeze({resources:RESOURCES,maxAmount:1000000,balanceLimit:100000000,maxPending:20});
const GATE='EXISTS(SELECT 1 FROM court_negotiation_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const active=id=>`NOT EXISTS(SELECT 1 FROM player_bans nb WHERE nb.user_id=${id} AND nb.active=1)`;
const saved=id=>`EXISTS(SELECT 1 FROM player_saves ns WHERE ns.user_id=${id} AND ns.save_json IS NOT NULL)`;
const unexpelled=id=>`NOT EXISTS(SELECT 1 FROM player_expulsions ne WHERE ne.user_id=${id} AND ne.pending=1)`;
const lordEligible=id=>`EXISTS(SELECT 1 FROM court_lineages nl WHERE nl.user_id=${id}) AND ${active(id)} AND ${saved(id)} AND ${unexpelled(id)} AND NOT EXISTS(SELECT 1 FROM court_vassals nv WHERE nv.vassal_id=${id})`;
const warriorEligible=id=>`${active(id)} AND ${unexpelled(id)}
 AND NOT EXISTS(SELECT 1 FROM court_lineages nl WHERE nl.user_id=${id})
 AND NOT EXISTS(SELECT 1 FROM court_retained_memberships nm WHERE nm.user_id=${id})
 AND NOT EXISTS(SELECT 1 FROM staff_members nm WHERE nm.user_id=${id})
 AND NOT EXISTS(SELECT 1 FROM deputy_operator_state nd WHERE nd.user_id=${id})
 AND ${id}<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM court_vassals nv WHERE nv.vassal_id=${id} OR nv.lord_id=${id})
 AND EXISTS(SELECT 1 FROM player_saves ns WHERE ns.user_id=${id} AND ns.save_json IS NOT NULL AND COALESCE(json_extract(ns.save_json,'$.state.gameOver'),0)=0 AND json_extract(ns.save_json,'$.state.home') NOT IN ('edo','kyoto_gosho','kagoshima'))
 AND NOT EXISTS(SELECT 1 FROM castle_residents nr JOIN castle_seats nc ON nc.castle_id=nr.castle_id WHERE nr.user_id=${id} AND nc.lord_user_id IS NOT NULL AND nc.lord_user_id<>${id})`;
const SELECT=`SELECT n.*,nl.name AS lord_name,nw.name AS warrior_name,nw.clan AS warrior_clan,cl.house_id,cl.imperial_house_name,
 (${lordEligible('n.lord_id')}) AS lord_eligible,(${warriorEligible('n.warrior_id')}) AS warrior_eligible
 FROM court_negotiations n JOIN users nl ON nl.id=n.lord_id JOIN users nw ON nw.id=n.warrior_id LEFT JOIN court_lineages cl ON cl.user_id=n.lord_id`;

// One bounded projection per already-selected identity, with no negotiation
// amounts, request IDs, saved states or campaign metadata in the public DTO.
export function courtRelationsSql(id){
 return `json_object('suzerain',json((SELECT json_object('id',cr_person.id,'name',cr_person.name,'houseId',cl.house_id,'imperialHouseName',cl.imperial_house_name) FROM court_vassals v JOIN users cr_person ON cr_person.id=v.lord_id JOIN court_lineages cl ON cl.user_id=cr_person.id WHERE v.vassal_id=${id} AND ${active('cr_person.id')})),
 'vassals',json(COALESCE((SELECT json_group_array(json(p.person)) FROM (SELECT json_object('id',cr_person.id,'name',cr_person.name,'clan',cr_person.clan) AS person FROM court_vassals v JOIN users cr_person ON cr_person.id=v.vassal_id WHERE v.lord_id=${id} AND ${active('cr_person.id')} ORDER BY v.created_at,v.vassal_id LIMIT 50) p),'[]')),
 'vassalCount',(SELECT COUNT(*) FROM court_vassals v JOIN users cr_person ON cr_person.id=v.vassal_id WHERE v.lord_id=${id} AND ${active('cr_person.id')}))`;
}
export function publicCourtRelations(row){
 const value=row?.court_relations_json?JSON.parse(row.court_relations_json):null,s=value?.suzerain;
 return {suzerain:s?{id:s.id,name:s.name,houseName:HOUSES[s.houseId]||null,imperialHouseName:s.imperialHouseName||null}:null,vassals:value?.vassals||[],vassalCount:Number(value?.vassalCount)||0};
}
function dto(row,viewer){
 const pending=row.status==='pending',opponent=row.offered_by!==viewer,eligible=!!row.lord_eligible&&!!row.warrior_eligible;
 return{id:row.id,revision:Number(row.revision),status:row.status,
  lord:{id:row.lord_id,name:row.lord_name,houseName:HOUSES[row.house_id]||null,imperialHouseName:row.imperial_house_name||null},
  warrior:{id:row.warrior_id,name:row.warrior_name,clan:row.warrior_clan},offer:JSON.parse(row.offer_json),offeredBy:row.offered_by,
  createdAt:Number(row.created_at),updatedAt:Number(row.updated_at),canAccept:pending&&opponent&&eligible,canCounter:pending&&opponent&&eligible,
  canReject:pending&&opponent,canCancel:pending&&!opponent,reason:pending&&!eligible?'家柄・所属・本拠の状態が変わったため、この条件では成立できません。':''};
}
async function find(ctx,id){return S(ctx.db,SELECT+' WHERE n.id=? AND (n.lord_id=? OR n.warrior_id=?)',id,ctx.user.id,ctx.user.id).first();}
async function requireRow(ctx,id){const row=await find(ctx,id);if(!row)ctx.helpers.fail(404,'COURT_NEGOTIATION_NOT_FOUND','この交渉は見つからないか、閲覧できません。');return row;}
function readId(value,h){if(typeof value!=='string'||!/^cn_[a-f0-9]{32}$/.test(value))h.fail(404,'COURT_NEGOTIATION_NOT_FOUND','この交渉は見つからないか、閲覧できません。');return value;}
function bundle(raw,h){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!RESOURCES.includes(k)))h.fail(400,'INVALID_INPUT','対価は金銭・兵糧・木材・石材で指定してください。');
 const result={};for(const key of RESOURCES){const n=raw[key]===undefined?0:raw[key];if(!Number.isSafeInteger(n)||n<0||n>RULES.maxAmount)h.fail(400,'INVALID_INPUT','対価は各0〜1,000,000の整数で指定してください。');result[key]=n;}
 if(!RESOURCES.some(k=>result[k]>0))h.fail(400,'INVALID_INPUT','対価を1つ以上指定してください。');return result;
}
function queryReceipt(ctx){const q=ctx.url.searchParams;if([...q.keys()].some(k=>k!=='receipt')||q.has('receipt')&&(q.getAll('receipt').length!==1||q.get('receipt')!=='1'))ctx.helpers.fail(400,'INVALID_INPUT','交渉の受付照会方法を確認してください。');return q.has('receipt');}
function bodyFor(raw,action,h){
 const allowed=['requestId','confirmed',...(action==='propose'?['targetPlayerId','offer']:['proposalRevision']),...(action==='counter'?['offer']:[]),...(action==='accept'?['deviceId','expectedRevision']:[])];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!allowed.includes(k))||raw.confirmed!==true)h.fail(400,'INVALID_INPUT','交渉の相手と最新の条件を確認してください。');
 const body={requestId:h.idField(raw.requestId,'操作番号'),confirmed:true};
 if(action==='propose')body.targetPlayerId=h.idField(raw.targetPlayerId,'相手の領主');
 else{if(!Number.isSafeInteger(raw.proposalRevision)||raw.proposalRevision<1)h.fail(400,'INVALID_INPUT','交渉条件の更新番号が正しくありません。');body.proposalRevision=raw.proposalRevision;}
 if(action==='propose'||action==='counter')body.offer=bundle(raw.offer,h);
 if(action==='accept'){body.deviceId=h.idField(raw.deviceId,'端末');if(!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0)h.fail(400,'INVALID_INPUT','本拠の更新番号が正しくありません。');body.expectedRevision=raw.expectedRevision;}
 return body;
}
async function eligibility(ctx,lordId,warriorId=null){
 const r=await S(ctx.db,`SELECT EXISTS(SELECT 1 FROM users nq WHERE nq.id=? AND ${lordEligible('nq.id')}) AS lord,
  EXISTS(SELECT 1 FROM users nq WHERE nq.id=? AND ${warriorEligible('nq.id')}) AS warrior`,lordId,warriorId||'').first();
 return {lord:!!r.lord,warrior:!!r.warrior};
}
async function requireEligible(ctx,lordId,warriorId){const result=await eligibility(ctx,lordId,warriorId);if(lordId===warriorId||!result.lord||!result.warrior)ctx.helpers.fail(409,'COURT_NEGOTIATION_INELIGIBLE','家柄選択済みの公家・皇族と、ほかの主君に仕えていない武家の間で交渉できます。');}
async function list(ctx){
 const {db,user,url,helpers:h}=ctx,box=url.searchParams.get('box')||'active',limitText=url.searchParams.get('limit')||'20',cursor=url.searchParams.get('cursor');
 if([...url.searchParams.keys()].some(k=>!['box','limit','cursor'].includes(k))||!['active','history'].includes(box)||!/^\d{1,2}$/.test(limitText)||+limitText<1||+limitText>50)h.fail(400,'INVALID_INPUT','交渉一覧の種類と件数（1〜50）を確認してください。');
 let point=null;if(cursor){try{if(!/^[A-Za-z0-9_-]{1,512}$/.test(cursor))throw Error();point=JSON.parse(atob(cursor.replaceAll('-','+').replaceAll('_','/')));}catch{h.fail(400,'INVALID_CURSOR','交渉一覧の続きが正しくありません。');}if(!Array.isArray(point)||point.length!==3||point[0]!==box||!Number.isSafeInteger(point[1])||point[1]<0||!/^cn_[a-f0-9]{32}$/.test(point[2]))h.fail(400,'INVALID_CURSOR','交渉一覧の続きが正しくありません。');}
 const found=R(await S(db,SELECT+` WHERE (n.lord_id=? OR n.warrior_id=?) AND n.status${box==='active'?'=':'<>'}'pending'${point?' AND (n.created_at<? OR (n.created_at=? AND n.id<?))':''} ORDER BY n.created_at DESC,n.id DESC LIMIT ?`,user.id,user.id,...(point?[point[1],point[1],point[2]]:[]),+limitText+1).all()),page=found.slice(0,+limitText),last=page.at(-1),access=await eligibility(ctx,user.id);
 return{ok:true,negotiations:page.map(r=>dto(r,user.id)),nextCursor:found.length>+limitText?btoa(JSON.stringify([box,+last.created_at,last.id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null,canPropose:access.lord,rules:RULES};
}
async function recipient(ctx){
 const {db,user,url,helpers:h}=ctx,id=h.idField(url.searchParams.get('playerId'),'相手の領主');
 if([...url.searchParams.keys()].some(k=>k!=='playerId'))h.fail(400,'INVALID_INPUT','相手の領主を指定してください。');
 const target=await h.getUser(db,id);if(!target||target.ban_active)h.fail(404,'PLAYER_NOT_FOUND','相手の領主が見つかりません。');
 const access=await eligibility(ctx,user.id,id),eligible=id!==user.id&&access.lord&&access.warrior;
 return{ok:true,player:{id:target.id,name:target.name,clan:target.clan},eligible,reason:eligible?'':'家柄選択済みの公家・皇族から、ほかの主君に仕えていない武家へ提案できます。'};
}
function authorize(ctx,row,body,action){
 const h=ctx.helpers;if(row.status!=='pending')h.fail(409,'COURT_NEGOTIATION_NOT_PENDING','この交渉はすでに終了しています。');
 if(+row.revision!==body.proposalRevision)h.fail(409,'COURT_NEGOTIATION_CHANGED','交渉の条件が更新されました。最新の条件を確認してください。');
 if(action==='cancel'?row.offered_by!==ctx.user.id:row.offered_by===ctx.user.id)h.fail(403,'COURT_NEGOTIATION_FORBIDDEN',action==='cancel'?'最新の条件を提示した本人だけが取り消せます。':'最新の条件を受け取った相手だけが承諾・再提案・辞退できます。');
}
async function prior(ctx,body,digest){const row=await S(ctx.db,'SELECT * FROM court_negotiation_requests WHERE actor_id=? AND request_id=?',ctx.user.id,body.requestId).first();if(row&&row.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の交渉条件に使われています。');return row;}
async function result(ctx,body,receipt,idempotent){
 const fixed=JSON.parse(receipt.result_json),row=await requireRow(ctx,fixed.negotiationId),snapshot=fixed.action==='accept'?await ctx.helpers.syncSnapshot(ctx.db,await ctx.helpers.getSyncRow(ctx.db,ctx.user.id),await ctx.helpers.getUser(ctx.db,ctx.user.id),body.deviceId,ctx.now):{};
 return{...snapshot,ok:true,negotiation:dto(row,ctx.user.id),receipt:fixed,idempotent};
}
async function paymentActor(ctx,user,saved,clock){
 const scoped={...ctx,user},journey=await advanceReservedMarch(scoped,saved,clock),save=journey.save;
 if(journey.result.settlementRequired||save.state.walking.campaignId!==JSON.parse(saved.save_json).state.walking.campaignId)ctx.helpers.fail(409,'CYCLE_SETTLEMENT_REQUIRED','双方の本拠を現在の戦役へ同期してから承諾してください。');
 const cpu=await prepareResidencyCpuLosses(ctx.db,{userId:user.id,events:journey.game.takeHomeDefenseLosses?.()||[],now:ctx.now,state:save.state});
 return{user,row:saved,clock,journey,save,cpu};
}
async function paymentStatements(ctx,actor,gateArgs,body,lordId){
 const {db,now,helpers:h}=ctx,{user,save,clock}=actor;
 save.state.log.unshift({turn:save.state.turn,text:user.id===lordId?'交渉が成立し、合意した対価を支払って武家を支配下へ迎えました。':'交渉が成立し、合意した対価を受け取り公家・皇族の主君に仕えました。',kind:'trade'});save.state.log=save.state.log.slice(0,200);save.savedAt=new Date(now).toISOString();
 const next=h.normalizeGameSave(save,user,now,{clock}),statements=[S(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?${user.id===ctx.user.id?',lease_expires_at=?':''} WHERE user_id=? AND ${GATE}`,JSON.stringify(next),now,...(user.id===ctx.user.id?[now+h.syncLease]:[]),user.id,...gateArgs),
  ...h.branchProgressStatements(db,user.id,next,now,GATE,gateArgs,{resolvedElapsedMs:actor.journey.resolvedElapsedMs}),...h.covertIncidentStatements(db,user.id,next,now,GATE,gateArgs),...actor.cpu.statements(GATE,gateArgs)];
 const personal=await h.staffPersonalProgressStatement(db,user,next,now,GATE,gateArgs,actor.journey.game.getStaffPersonalProgress?.());if(personal)statements.push(personal);
 for(const event of h.saveAchievements(actor.journey.before,next))statements.push(h.achievementStatement(db,user.id,event,now,GATE,gateArgs));return statements;
}
async function commit(ctx,body,digest,id,action){
 const {db,user,now,helpers:h}=ctx;await ensureResidency(db,now);
 const propose=action==='propose',row=propose?null:await requireRow(ctx,id);
 if(row)authorize(ctx,row,body,action);
 const lordId=propose?user.id:row.lord_id,warriorId=propose?body.targetPlayerId:row.warrior_id;
 if(propose||action==='counter'||action==='accept')await requireEligible(ctx,lordId,warriorId);
 const [lord,warrior]=await Promise.all([h.getUser(db,lordId),h.getUser(db,warriorId)]);
 if(!lord||!warrior)h.fail(404,'COURT_NEGOTIATION_NOT_FOUND','交渉相手が見つかりません。');
 if(propose){const pending=await S(db,"SELECT COUNT(*) AS total,MAX(warrior_id=?) AS duplicate FROM court_negotiations WHERE lord_id=? AND status='pending'",warriorId,lordId).first();if(pending.duplicate)h.fail(409,'COURT_NEGOTIATION_DUPLICATE','この領主とは交渉中です。既存の交渉を確認してください。');if(+pending.total>=RULES.maxPending)h.fail(409,'COURT_NEGOTIATION_LIMIT','交渉中の提案は20件までです。');id=h.uid('cn_');}
 const offer=body.offer||JSON.parse(row.offer_json),revision=propose?1:+row.revision+1,status=action==='accept'?'accepted':action==='reject'?'rejected':action==='cancel'?'cancelled':'pending',
  receipt={requestId:body.requestId,negotiationId:id,action,revision,lordId,warriorId,offer},nonce=crypto.randomUUID(),gateArgs=[user.id,body.requestId,nonce],
  guards=[h.roleCommitGuard(user)],payments=[];
 let clock=null;
 if(propose||action==='counter'||action==='accept'){
  const other=user.id===lordId?warrior:lord;guards.push(h.roleCommitGuard(other),{sql:`EXISTS(SELECT 1 FROM users nq WHERE nq.id=? AND ${lordEligible('nq.id')}) AND EXISTS(SELECT 1 FROM users nq WHERE nq.id=? AND ${warriorEligible('nq.id')})`,args:[lordId,warriorId]});
 }
 if(action==='accept'){
  const own=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now);clock=await h.getWorldClock(db,now);
  if(!clock.running)h.fail(409,'WORLD_PAUSED','世界の共通時間を再開してから承諾してください。');
  const other=user.id===lordId?warrior:lord,otherRow=await h.settlePlayerCycle(db,await h.getSyncRow(db,other.id),other,now,clock,{deferActive:true});
  if(!otherRow?.save_json)h.fail(409,'COURT_NEGOTIATION_INELIGIBLE','相手の本拠を確認できません。');
  const ownSave=h.normalizeGameSave(JSON.parse(own.save_json),user,now,{reading:true,clock});
  if(!ownSave.state.worldClock||clock.elapsedMs-ownSave.state.worldClock.elapsedMs>15000)h.fail(409,'CLOCK_STALE','共通時計と本拠を同期してから承諾してください。');
  for(const [person,savedRow]of [[user,own],[other,otherRow]])payments.push(await paymentActor(ctx,person,savedRow,clock));
  const paying=payments.find(p=>p.user.id===lordId),receiving=payments.find(p=>p.user.id===warriorId);
  if(receiving.save.state.gameOver||receiving.cpu.succession)h.fail(409,'COURT_NEGOTIATION_INELIGIBLE','武家の本拠・所属が変わりました。先に本拠を同期してから条件を確認してください。');
  for(const key of RESOURCES){const debit=paying.save.state.resources[key],credit=receiving.save.state.resources[key];if(debit<offer[key])h.fail(409,'INSUFFICIENT_ASSETS','公家・皇族の所持資源が、合意した対価に足りません。');if(credit+offer[key]>RULES.balanceLimit)h.fail(409,'ASSET_LIMIT','武家の所持上限を超えるため対価を全額受け取れません。資源を使ってから再度承諾してください。');paying.save.state.resources[key]=debit-offer[key];receiving.save.state.resources[key]=credit+offer[key];}
  for(const payment of payments)guards.push(payment.journey.branches.guard,payment.cpu.guard,{sql:`EXISTS(SELECT 1 FROM player_saves np WHERE np.user_id=? AND np.revision=? AND json_extract(np.save_json,'$.state.walking.campaignId')=?)`,args:[payment.user.id,payment.row.revision,JSON.parse(payment.row.save_json).state.walking.campaignId]});
  guards.push({sql:'EXISTS(SELECT 1 FROM player_saves np WHERE np.user_id=? AND np.writer_device_id=? AND np.lease_expires_at>?) AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=? AND running=1)',args:[user.id,body.deviceId,Date.now(),h.worldClockId,clock.revision]});
 }
 guards.push(propose?{sql:"(SELECT COUNT(*) FROM court_negotiations WHERE lord_id=? AND status='pending')<? AND NOT EXISTS(SELECT 1 FROM court_negotiations WHERE lord_id=? AND warrior_id=? AND status='pending')",args:[lordId,RULES.maxPending,lordId,warriorId]}:{sql:"EXISTS(SELECT 1 FROM court_negotiations WHERE id=? AND status='pending' AND revision=? AND offered_by=?)",args:[id,body.proposalRevision,row.offered_by]});
 await h.budget(db,'court-negotiation:'+user.id,30,60000,now);
 const statements=[S(db,`INSERT INTO court_negotiation_requests(actor_id,request_id,negotiation_id,action,request_hash,commit_token,result_json,created_at)
  SELECT ?,?,?,?,?,?,?,? WHERE ${guards.map(g=>'('+g.sql+')').join(' AND ')} ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING *`,user.id,body.requestId,id,action,digest,nonce,JSON.stringify(receipt),now,...guards.flatMap(g=>g.args))];
 if(propose)statements.push(S(db,`INSERT INTO court_negotiations(id,lord_id,warrior_id,offer_json,offered_by,status,revision,created_at,updated_at) SELECT ?,?,?,?,?,'pending',1,?,? WHERE ${GATE}`,id,lordId,warriorId,JSON.stringify(offer),user.id,now,now,...gateArgs));
 else statements.push(S(db,`UPDATE court_negotiations SET offer_json=?,offered_by=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND ${GATE}`,JSON.stringify(offer),action==='counter'?user.id:row.offered_by,status,now,id,...gateArgs));
 for(const payment of payments)statements.push(...await paymentStatements(ctx,payment,gateArgs,body,lordId));
 if(action==='accept'){
  statements.push(S(db,`INSERT INTO court_vassals(vassal_id,lord_id,negotiation_id,created_at) SELECT ?,?,?,? WHERE ${GATE}`,warriorId,lordId,id,now,...gateArgs),...externalTroopSnapshotStatements(db,[lordId,warriorId],clock,GATE,gateArgs));
 }
 const kind={'propose':'court-negotiation-proposed','counter':'court-negotiation-countered','accept':'court-negotiation-accepted','reject':'court-negotiation-rejected','cancel':'court-negotiation-cancelled'}[action];
 statements.push(socialNotificationStatement(db,{key:'court-negotiation:'+id+':'+revision,userId:user.id===lordId?warriorId:lordId,actorId:user.id,kind,sourceId:id,sourceRevision:revision},now,GATE,gateArgs));
 const committed=R((await db.batch(statements))[0])[0];if(committed)return result(ctx,body,committed,false);
 const replay=await prior(ctx,body,digest);if(replay)return result(ctx,body,replay,true);
 await h.requireAccountAccess(db,user);
 if(action==='accept')h.fieldWriter(await h.getSyncRow(db,user.id),body.deviceId,body.expectedRevision,Date.now());
 if(row)authorize(ctx,await requireRow(ctx,id),body,action);
 if(propose||action==='counter'||action==='accept')await requireEligible(ctx,lordId,warriorId);
 h.fail(409,'COURT_NEGOTIATION_CHANGED','交渉・双方の本拠・所属が更新されました。最新の状態を確認して、同じ受付番号で再度お試しください。');
}
async function mutate(ctx,id,action){
 const h=ctx.helpers,body=bodyFor(await h.readBody(ctx.request),action,h),receiptOnly=queryReceipt(ctx),digest=await h.hash(JSON.stringify(['court-negotiation-v1',action,id,body.targetPlayerId||null,body.proposalRevision||null,body.offer||null,true]));
 const previous=await prior(ctx,body,digest);if(previous)return result(ctx,body,previous,true);
 if(receiptOnly)h.fail(404,'COURT_NEGOTIATION_RECEIPT_PENDING','この交渉操作の受付はまだ確認できません。');
 try{return await commit(ctx,body,digest,id,action);}catch(error){
  const ineligible=String(error.message||'').includes('COURT_VASSAL_INELIGIBLE')||String(error.cause?.message||'').includes('COURT_VASSAL_INELIGIBLE');
  if(error.status===409||ineligible){const accepted=await prior(ctx,body,digest);if(accepted)return result(ctx,body,accepted,true);}
  if(ineligible)h.fail(409,'COURT_NEGOTIATION_INELIGIBLE','成立直前に双方の所属が変わりました。対価は移動していません。最新の状態を確認してください。');throw error;
 }
}
export async function handleCourtNegotiations(ctx){
 const {path,method,helpers:h}=ctx;await h.requireAccountAccess(ctx.db,ctx.user);
 if(path==='/court/negotiations'&&method==='GET')return list(ctx);
 if(path==='/court/negotiations'&&method==='POST')return mutate(ctx,null,'propose');
 if(path==='/court/negotiations/recipient'&&method==='GET')return recipient(ctx);
 const match=/^\/court\/negotiations\/([^/]+)(?:\/(counter|accept|reject|cancel))?$/.exec(path);
 if(match){const id=readId(match[1],h);if(method==='GET'&&!match[2]){if([...ctx.url.searchParams.keys()].length)h.fail(400,'INVALID_INPUT','交渉の照会方法を確認してください。');return{ok:true,negotiation:dto(await requireRow(ctx,id),ctx.user.id)};}if(method==='POST'&&match[2])return mutate(ctx,id,match[2]);}
 h.fail(404,'NOT_FOUND','その交渉機能は見つかりませんでした。');
}
