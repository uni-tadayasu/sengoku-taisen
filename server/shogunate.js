// A server-owned achievement ledger. Rights never come from imported booleans.
// Government approval and political sovereignty never change account roles.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {handleShogunateGovernance} from './shogunate-governance.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=r=>r?.results||[];
export const SHOGUNATE_APPROVAL_WINDOW_MS=3*24*60*60*1000;
const RIGHT_SELECT='SELECT r.*,a.status AS approval_status,a.requested_at,a.deadline_at,a.resolved_at FROM shogunate_rights r LEFT JOIN shogunate_approvals a ON a.right_id=r.id';
const dto=r=>r?{id:r.id,sourceType:r.source_type,sourceId:r.source_id,title:r.title,battleId:r.battle_id||null,earnedAt:Number(r.earned_at),openedAt:r.opened_at==null?null:Number(r.opened_at),governmentName:r.government_name||null,rank:r.opened_at==null?null:'征夷大将軍',approvalStatus:r.approval_status||(r.opened_at==null?'available':'legacy'),requestedAt:r.requested_at==null?null:Number(r.requested_at),deadlineAt:r.deadline_at==null?null:Number(r.deadline_at),resolvedAt:r.resolved_at==null?null:Number(r.resolved_at)}:null;
const activeApplicant=alias=>`NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=${alias} AND b.active=1)`;
const approvalGate='EXISTS(SELECT 1 FROM shogunate_approval_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const failRequestReuse=(row,digest,h)=>{if(row&&row.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の幕府の操作に使用されています。');return row;};

export function shogunateGrantStatements({db,userId,sourceType,sourceId,title,battleId=null,earnedAt,gateSql,gateArgs=[],proofSql,proofArgs=[]}){
 if(!['campaign','event','conquest'].includes(sourceType)||!gateSql||!proofSql)throw Error('Shogunate grant requires an admitted operation and a completion proof.');
 return[S(db,`INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,battle_id,earned_at)
  SELECT ?,?,?,?,?,?,? WHERE (${gateSql}) AND (${proofSql}) ON CONFLICT(user_id,source_type,source_id) DO NOTHING`,
  'sg_'+crypto.randomUUID().replaceAll('-',''),userId,sourceType,sourceId,title,battleId,earnedAt,...gateArgs,...proofArgs)];
}
export async function shogunateEventRight(db,userId,eventId){return dto(await S(db,RIGHT_SELECT+" WHERE r.user_id=? AND r.source_type='event' AND r.source_id=?",userId,eventId).first());}

export function campaignShogunateStatements({db,user,save,now,gateSql,gateArgs=[]}){
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected}),proof=game.getUnificationProof();
 if(!proof.achieved)return[];
 // Campaign ownership follows the existing validated-save authority model.
 // Recheck the exact committed campaign, cycle and all eligible castle owners.
 const eligible=JSON.stringify(proof.targetCastleIds),sourceId=proof.campaignId+':'+proof.cycle;
 return shogunateGrantStatements({db,userId:user.id,sourceType:'campaign',sourceId,title:'天下地図・第'+(proof.cycle+1)+'期 天下統一',earnedAt:now,gateSql,gateArgs,
  proofSql:`EXISTS(SELECT 1 FROM player_saves p WHERE p.user_id=? AND json_extract(p.save_json,'$.state.walking.campaignId')=? AND json_extract(p.save_json,'$.state.cycle.index')=? AND NOT EXISTS(SELECT 1 FROM json_each(?) target WHERE COALESCE(json_extract(p.save_json,'$.state.castles.'||target.value||'.owner'),'')<>json_extract(p.save_json,'$.state.clan')))`,
  proofArgs:[user.id,proof.campaignId,proof.cycle,eligible]});
}

export function conquestShogunateStatements({db,seasonId,guildId,title,now,gateSql,gateArgs=[]}){
 const count=globalThis.SENGOKU_DATA.castles.length;
 // Every participating contributor still in this guild at the decisive capture
 // earns the same achievement, including support contributors.
 return[S(db,`INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at)
 SELECT 'sg_'||lower(hex(randomblob(16))),m.user_id,'conquest',?,?,?
 FROM conquest_members m JOIN guild_members gm ON gm.user_id=m.user_id AND gm.guild_id=m.guild_id
 WHERE m.season_id=? AND m.guild_id=? AND m.actions>0 AND (${gateSql})
 AND (SELECT COUNT(*) FROM conquest_castles WHERE season_id=? AND owner_guild_id=?)=?
 AND NOT EXISTS(SELECT 1 FROM conquest_castles WHERE season_id=? AND (owner_guild_id IS NULL OR owner_guild_id<>?))
 ON CONFLICT(user_id,source_type,source_id) DO NOTHING`,seasonId+':'+guildId,title,now,seasonId,guildId,...gateArgs,seasonId,guildId,count,seasonId,guildId)];
}

// Each deadline is resolved in one ordered D1 batch. The nonce prevents an
// approval or another sweep from applying the same consequence twice.
export async function settleShogunateApprovals(db,now=Date.now()){
 if(!Number.isSafeInteger(now)||now<0)throw Error('A server timestamp is required.');
 const due=rows(await S(db,`SELECT a.right_id FROM shogunate_approvals a JOIN shogunate_rights r ON r.id=a.right_id
  WHERE a.status='pending' AND a.deadline_at<=? AND r.opened_at IS NULL AND ${activeApplicant('r.user_id')}
  ORDER BY a.deadline_at,a.right_id LIMIT 100`,now).all());
 let settled=0;
 for(const item of due){
  const nonce=crypto.randomUUID(),gate="EXISTS(SELECT 1 FROM shogunate_approvals WHERE right_id=? AND status='expired' AND commit_token=?)";
  const result=await db.batch([
   S(db,`UPDATE shogunate_approvals SET status='expired',resolved_at=deadline_at,commit_token=?,updated_at=?
    WHERE right_id=? AND status='pending' AND deadline_at<=? AND EXISTS(SELECT 1 FROM shogunate_rights r WHERE r.id=right_id AND r.opened_at IS NULL AND ${activeApplicant('r.user_id')}) RETURNING right_id`,nonce,now,item.right_id,now),
   S(db,`UPDATE shogunate_rights SET opened_at=(SELECT deadline_at FROM shogunate_approvals WHERE right_id=?) WHERE id=? AND opened_at IS NULL AND ${gate}`,item.right_id,item.right_id,item.right_id,nonce),
   S(db,`INSERT INTO shogunate_palace_control(castle_id,right_id,controller_id,government_name,controlled_at)
    SELECT 'kyoto_gosho',r.id,r.user_id,r.government_name,a.deadline_at FROM shogunate_rights r JOIN shogunate_approvals a ON a.right_id=r.id
    WHERE r.id=? AND r.opened_at=a.deadline_at AND ${gate}
    ON CONFLICT(castle_id) DO UPDATE SET right_id=excluded.right_id,controller_id=excluded.controller_id,government_name=excluded.government_name,controlled_at=excluded.controlled_at
    WHERE excluded.controlled_at>shogunate_palace_control.controlled_at OR (excluded.controlled_at=shogunate_palace_control.controlled_at AND excluded.right_id>shogunate_palace_control.right_id)`,item.right_id,item.right_id,nonce)
  ]);
  settled+=rows(result[0]).length;
 }
 return{checked:due.length,settled};
}
export async function readPalaceControl(db){
 const row=await S(db,"SELECT c.*,u.name FROM shogunate_palace_control c JOIN users u ON u.id=c.controller_id WHERE c.castle_id='kyoto_gosho'").first();
 return row?{castleId:row.castle_id,rightId:row.right_id,controller:{id:row.controller_id,name:row.name},governmentName:row.government_name,controlledAt:Number(row.controlled_at)}:null;
}

async function view(ctx,requestedRightId=null){
 const {db,user,helpers:h}=ctx,authority=await h.courtImperialAuthority(db,user);
 const [history,opened,requested,pending,queue,palaceControl]=await Promise.all([
  S(db,RIGHT_SELECT+' WHERE r.user_id=? ORDER BY r.earned_at DESC,r.id DESC LIMIT 100',user.id).all(),
  S(db,RIGHT_SELECT+' WHERE r.user_id=? AND r.opened_at IS NOT NULL ORDER BY r.opened_at DESC,r.id DESC LIMIT 1',user.id).first(),
  requestedRightId?S(db,RIGHT_SELECT+' WHERE r.user_id=? AND r.id=?',user.id,requestedRightId).first():null,
  S(db,RIGHT_SELECT+" WHERE r.user_id=? AND a.status='pending' ORDER BY a.deadline_at,r.id LIMIT 101",user.id).all(),
  authority.canActForEmperor?S(db,`SELECT r.*,a.status AS approval_status,a.requested_at,a.deadline_at,a.resolved_at,u.name AS applicant_name FROM shogunate_approvals a JOIN shogunate_rights r ON r.id=a.right_id JOIN users u ON u.id=r.user_id
   WHERE a.status='pending' AND ${activeApplicant('r.user_id')} AND ${authority.guard.sql} ORDER BY a.deadline_at,a.right_id LIMIT 101`,...authority.guard.args).all():null,
  readPalaceControl(db)
 ]),selected=rows(history),priority=[...(opened?[opened]:[]),...(requested&&requested.id!==opened?.id?[requested]:[])],priorityIds=new Set(priority.map(r=>r.id));
 // Keep unresolved applications visible after receipt delivery and reload,
 // even when subsequent earned rights would push them outside the history.
 // Current and the requested receipt take their fixed slots; the remaining
 // slots prioritize the oldest pending deadlines, never exceeding 100 rows.
 for(const right of rows(pending))if(priority.length<100&&!priorityIds.has(right.id)){priority.push(right);priorityIds.add(right.id);}
 const pendingHasMore=rows(pending).some(right=>!priorityIds.has(right.id));
 for(const right of priority){const index=selected.findIndex(r=>r.id===right.id);if(index<0)selected.push(right);else selected[index]=right;}
 while(selected.length>100){let index=selected.length-1;while(priorityIds.has(selected[index].id))index--;selected.splice(index,1);}
 const rights=selected.map(dto),current=await h.getSyncRow(db,user.id);let campaign=null;
 if(current?.save_json){const g=GameEngine.fromSave(JSON.parse(current.save_json),GAME_OFFICERS,{isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected});const p=g.getUnificationProof();campaign={owned:p.owned,target:p.target,achieved:p.achieved,cycle:p.cycle};}
 // The final response pass rechecks this exact appointment after decoration.
 if(authority.canActForEmperor)h.registerResponseGuard(authority.guard);
 return{rights,current:dto(opened),campaign,serverNow:ctx.now,approvalWindowMs:SHOGUNATE_APPROVAL_WINDOW_MS,canApprove:authority.canActForEmperor,approvals:rows(queue).slice(0,100).map(r=>({...dto(r),applicant:{id:r.user_id,name:r.applicant_name}})),approvalsHasMore:rows(queue).length>100,pendingHasMore,palaceControl};
}
async function reconcileCampaign(ctx){
 const {db,user,helpers:h}=ctx,row=await h.getSyncRow(db,user.id);if(!row?.save_json)return;
 const guard=h.roleCommitGuard(user),statements=campaignShogunateStatements({db,user,save:JSON.parse(row.save_json),now:ctx.now,gateSql:`${guard.sql} AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?)`,gateArgs:[...guard.args,user.id,row.revision]});
 if(statements.length)await db.batch(statements);
}
async function approve(ctx,body){
 const {db,user,helpers:h,now}=ctx,authority=await h.courtImperialAuthority(db,user);
 if(!authority.canActForEmperor)h.fail(403,'SHOGUNATE_EMPEROR_REQUIRED','幕府の開設を承認できるのは、現在在任中の天皇または摂政だけです。');
 const requestId=h.idField(body.requestId,'操作番号'),rightId=h.idField(body.rightId,'幕府開設権'),digest=await h.hash(JSON.stringify(['approve',rightId]));
 const prior=failRequestReuse(await S(db,'SELECT * FROM shogunate_approval_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first(),digest,h);
 if(prior)return{ok:true,idempotent:true,approvalReceipt:JSON.parse(prior.result_json),shogunate:await view(ctx)};
 const right=await S(db,RIGHT_SELECT+' WHERE r.id=?',rightId).first();
 if(!right||right.approval_status!=='pending'||Number(right.deadline_at)<=now)h.fail(409,'SHOGUNATE_APPROVAL_CHANGED','承認待ちの申請ではないか、3日間の承認期限を過ぎています。最新の記録を確認してください。');
 await h.budget(db,'shogunate-approve:'+user.id,30,60000,now);
 const nonce=crypto.randomUUID(),receipt={rightId,status:'approved',approvedAt:now},args=[user.id,requestId,nonce];
 await db.batch([
  S(db,`INSERT INTO shogunate_approval_requests(actor_id,request_id,right_id,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,?,?,?,? WHERE ${authority.guard.sql}
   AND EXISTS(SELECT 1 FROM shogunate_approvals a JOIN shogunate_rights r ON r.id=a.right_id WHERE a.right_id=? AND a.status='pending' AND a.deadline_at>? AND r.opened_at IS NULL AND ${activeApplicant('r.user_id')})
   ON CONFLICT DO NOTHING`,user.id,requestId,rightId,digest,nonce,JSON.stringify(receipt),now,...authority.guard.args,rightId,now),
  S(db,`UPDATE shogunate_approvals SET status='approved',resolved_at=?,approved_by=?,commit_token=?,updated_at=? WHERE right_id=? AND status='pending' AND ${approvalGate}`,now,user.id,nonce,now,rightId,...args),
  S(db,`UPDATE shogunate_rights SET opened_at=? WHERE id=? AND opened_at IS NULL AND ${approvalGate}`,now,rightId,...args)
 ]);
 const accepted=failRequestReuse(await S(db,'SELECT * FROM shogunate_approval_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first(),digest,h);
 if(!accepted){await h.requireAccountAccess(db,user);h.fail(409,'SHOGUNATE_APPROVAL_CHANGED','天皇・摂政の任命または申請の状態が変わりました。最新の記録を確認してください。');}
 return{ok:true,idempotent:accepted.commit_token!==nonce,approvalReceipt:JSON.parse(accepted.result_json),shogunate:await view(ctx)};
}
export async function handleShogunate(ctx){
 const {db,user,path,method,helpers:h,now}=ctx;await h.requireAccountAccess(db,user);
 await settleShogunateApprovals(db,now);
 if(path==='/shogunate/governance'||path.startsWith('/shogunate/governance/'))return handleShogunateGovernance(ctx);
 if(path==='/shogunate'&&method==='GET'){await reconcileCampaign(ctx);return{ok:true,shogunate:await view(ctx)};}
 if(!['/shogunate/open','/shogunate/approve'].includes(path)||method!=='POST')h.fail(404,'NOT_FOUND','幕府の操作が見つかりません。');
 const body=await h.readBody(ctx.request);
 if(!body||Object.keys(body).some(k=>!['requestId','rightId'].includes(k)))h.fail(400,'INVALID_INPUT','幕府開設権を選んでください。');
 if(path==='/shogunate/approve')return approve(ctx,body);
 const requestId=h.idField(body.requestId,'操作番号'),rightId=h.idField(body.rightId,'幕府開設権'),digest=await h.hash(JSON.stringify(['open',rightId]));
 const prior=failRequestReuse(await S(db,'SELECT * FROM shogunate_requests WHERE user_id=? AND request_id=?',user.id,requestId).first(),digest,h);
 if(prior)return{ok:true,idempotent:true,receipt:JSON.parse(prior.result_json),shogunate:await view(ctx,rightId)};
 const right=await S(db,RIGHT_SELECT+' WHERE r.id=? AND r.user_id=?',rightId,user.id).first();
 if(!right)h.fail(409,'SHOGUNATE_RIGHT_REQUIRED','天下統一を達成して幕府開設権を獲得してください。');
 if(right.opened_at!=null)h.fail(409,'SHOGUNATE_ALREADY_OPENED','この天下統一の幕府は開設済みです。');
 if(right.approval_status)h.fail(409,'SHOGUNATE_APPROVAL_PENDING','この幕府は天皇の承認を待っています。記録を更新してください。');
 await h.budget(db,'shogunate-open:'+user.id,12,60000,now);
 const nonce=crypto.randomUUID(),name=(String(user.clan||user.name||'天下').replace(/家$/,''))+'幕府',deadline=now+SHOGUNATE_APPROVAL_WINDOW_MS,receipt={rightId,governmentName:name,status:'pending',requestedAt:now,deadlineAt:deadline,rank:null,openedAt:null,title:right.title},guard=h.roleCommitGuard(user),gate='EXISTS(SELECT 1 FROM shogunate_requests WHERE user_id=? AND request_id=? AND commit_token=?)',args=[user.id,requestId,nonce];
 await db.batch([
  S(db,`INSERT INTO shogunate_requests(user_id,request_id,right_id,request_hash,commit_token,result_json,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}
   AND EXISTS(SELECT 1 FROM shogunate_rights r WHERE r.id=? AND r.user_id=? AND r.opened_at IS NULL AND NOT EXISTS(SELECT 1 FROM shogunate_approvals a WHERE a.right_id=r.id)) ON CONFLICT DO NOTHING`,user.id,requestId,rightId,digest,nonce,JSON.stringify(receipt),now,...guard.args,rightId,user.id),
  S(db,`INSERT INTO shogunate_approvals(right_id,status,requested_at,deadline_at,updated_at) SELECT ?,'pending',?,?,? WHERE ${gate}`,rightId,now,deadline,now,...args),
  S(db,`UPDATE shogunate_rights SET government_name=?,opened_request_id=? WHERE id=? AND user_id=? AND opened_at IS NULL AND ${gate}`,name,requestId,rightId,user.id,...args)
 ]);
 const accepted=failRequestReuse(await S(db,'SELECT * FROM shogunate_requests WHERE user_id=? AND request_id=?',user.id,requestId).first(),digest,h);
 if(!accepted){await h.requireAccountAccess(db,user);h.fail(409,'SHOGUNATE_APPROVAL_PENDING','申請の記録が更新されました。最新の記録を確認してください。');}
 return{ok:true,idempotent:accepted.commit_token!==nonce,receipt:JSON.parse(accepted.result_json),shogunate:await view(ctx,rightId)};
}
