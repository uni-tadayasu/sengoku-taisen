import {canOperate} from './operator-access.js';
// National CPU deployments are public; proposed changes and their authors are
// visible only to authorized managers. An approval applies one immutable plan.
import {GameEngine} from './game-runtime.js';

const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=r=>r?.results||[];
const iso=n=>new Date(Number(n)).toISOString();
const gate='EXISTS(SELECT 1 FROM roaming_deployment_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const MAX_REVISION=1000000000;
const activeProposal=`EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=p.requester_id AND COALESCE(sm.term_id,'legacy:'||sm.appointed_at)=p.requester_term)
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=p.requester_id AND b.active=1)
 AND NOT EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=p.requester_id)`;

export async function getRoamingDeployment(db){
 const row=await stmt(db,'SELECT revision,total_troops,squad_size,respawn_seconds FROM roaming_deployment WHERE id=1').first();
 if(!row)throw Error('Roaming deployment schema is missing');
 return {revision:Number(row.revision),totalTroops:Number(row.total_troops),squadSize:Number(row.squad_size),respawnSeconds:Number(row.respawn_seconds),totalSquads:Math.ceil(Number(row.total_troops)/Number(row.squad_size))};
}
export async function roamingUnitAvailability(db,deployment,castleId,now){
 const cooldowns=rows(await stmt(db,'SELECT unit_id,respawn_at FROM roaming_unit_cooldowns WHERE deployment_revision=? AND castle_id=? AND respawn_at>?',deployment.revision,castleId,now).all());
 const times=new Map(cooldowns.map(r=>[r.unit_id,Number(r.respawn_at)]));
 return GameEngine.roamingDeploymentUnits(deployment,castleId).map(unit=>({...unit,available:!times.has(unit.unitId),respawnAt:times.get(unit.unitId)||null}));
}
async function managementUser(ctx){
 const {db,user,helpers:h}=ctx;
 if(!user)h.fail(401,'UNAUTHORIZED','接続中の領主を確認してください。');
 await h.requireAccountAccess(db,user);
 const fresh=await h.getUser(db,user.id);
 if(!fresh||!canOperate(fresh)&&!fresh.is_staff||!!fresh.is_admin!==!!user.is_admin||fresh.staff_term!==user.staff_term||(fresh.deputy_term||'')!==(user.deputy_term||''))h.fail(403,'ROAMING_MANAGEMENT_REQUIRED','配置管理の権限が変更されました。接続状態を確認してください。');
 return fresh;
}
function configInput(raw,h){
 const result=GameEngine.validateRoamingDeployment({totalTroops:raw.totalTroops,squadSize:raw.squadSize,respawnSeconds:raw.respawnSeconds,revision:1});
 if(!result.ok)h.fail(400,'INVALID_DEPLOYMENT',result.message||'全国の兵数・部隊人数・再出現時間を確認してください。');
 return {totalTroops:result.config.totalTroops,squadSize:result.config.squadSize,respawnSeconds:result.config.respawnSeconds};
}
function revisionInput(value,h){if(!Number.isSafeInteger(value)||value<1||value>=MAX_REVISION)h.fail(400,'INVALID_INPUT','配置の更新番号が正しくありません。');return value;}
async function requestReceipt(ctx,id,digest){
 const old=await stmt(ctx.db,'SELECT * FROM roaming_deployment_requests WHERE actor_id=? AND request_id=?',ctx.user.id,id).first();
 if(old&&old.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の配置変更に使われています。');
 return old;
}
function effectiveStatus(row,deployment){
 return row.status==='pending'&&(Number(row.base_revision)!==deployment.revision||row.current_term!==row.requester_term||row.requester_banned||row.requester_admin)?'superseded':row.status;
}
function proposalDTO(row,user,deployment){
 const status=effectiveStatus(row,deployment);
 return {id:row.id,status,expectedRevision:Number(row.base_revision),config:JSON.parse(row.config_json),requestedAt:iso(row.created_at),note:row.note,requester:{id:row.requester_id,name:row.requester_name},reviewedAt:row.reviewed_at===null?null:iso(row.reviewed_at),appliedRevision:row.applied_revision===null?null:Number(row.applied_revision),canApprove:canOperate(user)&&status==='pending',canCancel:!canOperate(user)&&row.requester_id===user.id&&row.requester_term===user.staff_term&&status==='pending'};
}
const proposalSelect=`SELECT p.*,u.name AS requester_name,
 (SELECT COALESCE(sm.term_id,'legacy:'||sm.appointed_at) FROM staff_members sm WHERE sm.user_id=p.requester_id) AS current_term,
 EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=p.requester_id AND b.active=1) AS requester_banned,
 EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=p.requester_id) AS requester_admin
 FROM roaming_deployment_proposals p JOIN users u ON u.id=p.requester_id`;
async function manageResponse(ctx,receipt=null,idempotent=false){
 const user=await managementUser(ctx),deployment=await getRoamingDeployment(ctx.db);
 const records=rows(await stmt(ctx.db,proposalSelect+(canOperate(user)?'': ' WHERE p.requester_id=?')+` ORDER BY CASE WHEN p.status='pending' AND p.base_revision=? AND ${activeProposal} THEN 0 ELSE 1 END,p.created_at DESC,p.id DESC LIMIT 100`,...(!canOperate(user)?[user.id]:[]),deployment.revision).all());
 const proposals=records.map(r=>proposalDTO(r,user,deployment));
 let proposal=receipt?.proposalId?proposals.find(p=>p.id===receipt.proposalId)||null:null;
 if(receipt?.proposalId&&!proposal){const row=await stmt(ctx.db,proposalSelect+' WHERE p.id=?'+(canOperate(user)?'':' AND p.requester_id=?'),receipt.proposalId,...(!canOperate(user)?[user.id]:[])).first();if(row)proposal=proposalDTO(row,user,deployment);}
 await managementUser(ctx);
 return {ok:true,deployment,capabilities:{canApply:canOperate(user),canApprove:canOperate(user),canPropose:!!user.is_staff&&!canOperate(user)},proposals,serverNow:iso(Date.now()),...(receipt?{receipt,proposal,idempotent}:{})};
}
async function changed(ctx,expectedRevision){
 await managementUser(ctx);
 if((await getRoamingDeployment(ctx.db)).revision!==expectedRevision)ctx.helpers.fail(409,'ROAMING_DEPLOYMENT_CHANGED','全国の配置が更新されました。最新の配置を確認し、新しい内容で申請してください。');
 ctx.helpers.fail(409,'ROAMING_PROPOSAL_CHANGED','申請または権限が更新されました。最新の一覧を確認してください。');
}
async function mutation(ctx,action,proposalId=null){
 const {db,helpers:h}=ctx,user=await managementUser(ctx);
 if(['apply','approve','reject'].includes(action)&&!canOperate(user))h.fail(403,'OPERATIONAL_REQUIRED','この配置の反映には運営の承認が必要です。');
 if(['propose','cancel'].includes(action)&&(!user.is_staff||canOperate(user)))h.fail(403,'STAFF_REQUIRED','スタッフとして申請する操作です。');
 const raw=await h.readBody(ctx.request),configAction=['apply','propose'].includes(action);
 const allowed=configAction?['requestId','expectedRevision','totalTroops','squadSize','respawnSeconds','note']:['requestId','expectedRevision'];
 if(Object.keys(raw).some(k=>!allowed.includes(k)))h.fail(400,'INVALID_INPUT','配置変更の送信項目を確認してください。');
 const requestId=h.idField(raw.requestId,'操作番号'),expectedRevision=revisionInput(raw.expectedRevision,h),config=configAction?configInput(raw,h):null;
 const note=configAction?h.textField(raw.note,'申請の説明',300,{optional:true})||'':'';
 const digest=await h.hash(JSON.stringify([action,proposalId,expectedRevision,config,note]));
 const old=await requestReceipt(ctx,requestId,digest);if(old)return manageResponse(ctx,JSON.parse(old.result_json),true);
 const deployment=await getRoamingDeployment(db);if(deployment.revision!==expectedRevision)return changed(ctx,expectedRevision);
 await h.budget(db,'roaming-management:'+user.id,30,60000,ctx.now);
 const now=Date.now(),nonce=crypto.randomUUID(),role=h.roleCommitGuard(user),args=[user.id,requestId,nonce];
 let proposal=null;
 if(proposalId){proposal=await stmt(db,proposalSelect+' WHERE p.id=?',proposalId).first();if(!proposal||proposal.status!=='pending'||action==='cancel'&&(proposal.requester_id!==user.id||proposal.requester_term!==user.staff_term))return changed(ctx,expectedRevision);}
 const apply=action==='apply'||action==='approve';
 if(action==='approve'&&effectiveStatus(proposal,deployment)!=='pending')return changed(ctx,expectedRevision);
 const id=action==='propose'?'rdp_'+crypto.randomUUID().replaceAll('-',''):proposalId;
 const targetConfig=action==='approve'?JSON.parse(proposal.config_json):config;
 const receipt={requestId,action,proposalId:id,appliedRevision:apply?expectedRevision+1:null};
 const checks=['EXISTS(SELECT 1 FROM roaming_deployment WHERE id=1 AND revision=?)',role.sql],checkArgs=[expectedRevision,...role.args];
 if(action==='propose'){
  checks.push(`(SELECT COUNT(*) FROM roaming_deployment_proposals p WHERE status='pending' AND base_revision=? AND ${activeProposal})<100`, `(SELECT COUNT(*) FROM roaming_deployment_proposals p WHERE status='pending' AND base_revision=? AND requester_id=? AND ${activeProposal})<10`);checkArgs.push(expectedRevision,expectedRevision,user.id);
 }
 if(proposal){
  checks.push("EXISTS(SELECT 1 FROM roaming_deployment_proposals p WHERE p.id=? AND p.status='pending' AND p.config_json=? AND p.base_revision=? AND p.requester_id=? AND p.requester_term=?)");
  checkArgs.push(proposal.id,proposal.config_json,proposal.base_revision,proposal.requester_id,proposal.requester_term);
  if(action==='approve'){
   checks.push("EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=? AND COALESCE(sm.term_id,'legacy:'||sm.appointed_at)=?)", "NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=? AND b.active=1)", "NOT EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)");
   checkArgs.push(proposal.requester_id,proposal.requester_term,proposal.requester_id,proposal.requester_id);
  }
 }
 const statements=[stmt(db,`INSERT INTO roaming_deployment_requests(actor_id,request_id,action,proposal_id,request_hash,commit_token,result_json,created_at)
  SELECT ?,?,?,?,?,?,?,? WHERE ${checks.join(' AND ')} ON CONFLICT(actor_id,request_id) DO NOTHING`,user.id,requestId,action,id,digest,nonce,JSON.stringify(receipt),now,...checkArgs)];
 if(action==='propose')statements.push(stmt(db,`INSERT INTO roaming_deployment_proposals(id,requester_id,requester_term,base_revision,config_json,note,status,created_at)
  SELECT ?,?,?,?,?,?,'pending',? WHERE ${gate}`,id,user.id,user.staff_term,expectedRevision,JSON.stringify(config),note,now,...args));
 if(apply){
  statements.push(stmt(db,`UPDATE roaming_deployment SET revision=revision+1,total_troops=?,squad_size=?,respawn_seconds=?,updated_at=? WHERE id=1 AND revision=? AND ${gate}`,targetConfig.totalTroops,targetConfig.squadSize,targetConfig.respawnSeconds,now,expectedRevision,...args));
  statements.push(stmt(db,`DELETE FROM roaming_unit_cooldowns WHERE deployment_revision<>? AND ${gate}`,expectedRevision+1,...args));
 }
 if(proposal)statements.push(stmt(db,`UPDATE roaming_deployment_proposals SET status=?,reviewed_at=?,reviewed_by=?,applied_revision=? WHERE id=? AND status='pending' AND ${gate}`,action==='approve'?'approved':action==='reject'?'rejected':'cancelled',now,user.id,apply?expectedRevision+1:null,id,...args));
 if(apply)statements.push(stmt(db,`UPDATE roaming_deployment_proposals SET status='superseded',reviewed_at=? WHERE status='pending' AND base_revision<=? AND ${gate}`,now,expectedRevision,...args));
 await db.batch(statements);
 const committed=await requestReceipt(ctx,requestId,digest);
 if(!committed){
  if(action==='propose'){
   await managementUser(ctx);
   const counts=await stmt(db,`SELECT COUNT(*) AS total,SUM(CASE WHEN requester_id=? THEN 1 ELSE 0 END) AS own FROM roaming_deployment_proposals p WHERE status='pending' AND base_revision=? AND ${activeProposal}`,user.id,expectedRevision).first();
   if(Number(counts?.total)>=100||Number(counts?.own)>=10)h.fail(409,'ROAMING_PROPOSAL_LIMIT','承認待ちの申請が上限に達しています。既存の申請を取り消すか、運営の確認をお待ちください。');
  }
  return changed(ctx,expectedRevision);
 }
 return manageResponse(ctx,JSON.parse(committed.result_json),committed.commit_token!==nonce);
}
export async function handleRoamingDeployment(ctx){
 const {db,path,method,url,helpers:h}=ctx;
 if(method==='GET'&&(path==='/roaming/deployment'||path==='/roaming/map')){
  const deployment=await getRoamingDeployment(db);
  if(path==='/roaming/deployment')return{ok:true,deployment,castles:GameEngine.roamingDeploymentSummary(deployment).castles,serverNow:iso(Date.now())};
  const castleId=h.idField(url.searchParams.get('castleId'),'拠点');
  if(!GameEngine.roamingDeploymentSummary(deployment).castles.some(c=>c.castleId===castleId))h.fail(400,'INVALID_CASTLE','野良兵を確認する拠点を選んでください。');
  return{ok:true,deployment,castleId,units:await roamingUnitAvailability(db,deployment,castleId,Date.now()),serverNow:iso(Date.now())};
 }
 if(path==='/staff/roaming'&&method==='GET')return manageResponse(ctx);
 if(path==='/staff/roaming/proposals'&&method==='POST')return mutation(ctx,'propose');
 if(path==='/admin/roaming/deployment'&&method==='POST')return mutation(ctx,'apply');
 const match=/^\/(staff|admin)\/roaming\/proposals\/(rdp_[a-f0-9]{32})\/(approve|reject|cancel)$/.exec(path);
 if(method==='POST'&&match&&(match[1]==='admin'&&['approve','reject'].includes(match[3])||match[1]==='staff'&&match[3]==='cancel'))return mutation(ctx,match[3],match[2]);
 h.fail(404,'NOT_FOUND','その野良兵の配置操作は見つかりませんでした。');
}
