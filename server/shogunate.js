// A server-owned achievement ledger. Rights never come from imported booleans.
// A government is a personal title/achievement; it does not change account roles.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=r=>r?.results||[];
const dto=r=>r?{id:r.id,sourceType:r.source_type,sourceId:r.source_id,title:r.title,battleId:r.battle_id||null,earnedAt:Number(r.earned_at),openedAt:r.opened_at==null?null:Number(r.opened_at),governmentName:r.government_name||null,rank:r.opened_at==null?null:'征夷大将軍'}:null;

export function shogunateGrantStatements({db,userId,sourceType,sourceId,title,battleId=null,earnedAt,gateSql,gateArgs=[],proofSql,proofArgs=[]}){
 if(!['campaign','event','conquest'].includes(sourceType)||!gateSql||!proofSql)throw Error('Shogunate grant requires an admitted operation and a completion proof.');
 return[S(db,`INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,battle_id,earned_at)
  SELECT ?,?,?,?,?,?,? WHERE (${gateSql}) AND (${proofSql}) ON CONFLICT(user_id,source_type,source_id) DO NOTHING`,
  'sg_'+crypto.randomUUID().replaceAll('-',''),userId,sourceType,sourceId,title,battleId,earnedAt,...gateArgs,...proofArgs)];
}
export async function shogunateEventRight(db,userId,eventId){return dto(await S(db,"SELECT * FROM shogunate_rights WHERE user_id=? AND source_type='event' AND source_id=?",userId,eventId).first());}

export function campaignShogunateStatements({db,user,save,now,gateSql,gateArgs=[]}){
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isStaff:!!user.is_staff}),proof=game.getUnificationProof();
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

async function view(ctx,requestedRightId=null){
 const [history,opened,requested]=await Promise.all([
  S(ctx.db,'SELECT * FROM shogunate_rights WHERE user_id=? ORDER BY earned_at DESC,id DESC LIMIT 100',ctx.user.id).all(),
  S(ctx.db,'SELECT * FROM shogunate_rights WHERE user_id=? AND opened_at IS NOT NULL ORDER BY opened_at DESC,id DESC LIMIT 1',ctx.user.id).first(),
  requestedRightId?S(ctx.db,'SELECT * FROM shogunate_rights WHERE user_id=? AND id=?',ctx.user.id,requestedRightId).first():null
 ]),selected=rows(history),priority=[...(opened?[opened]:[]),...(requested&&requested.id!==opened?.id?[requested]:[])],priorityIds=new Set(priority.map(r=>r.id));
 // The frontend validates current and receipts against this bounded list.
 // Keep the newest rows first, pin any older referenced rows at the tail, and
 // use the exact current/receipt snapshot if it was already among the newest.
 for(const right of priority){const index=selected.findIndex(r=>r.id===right.id);if(index<0)selected.push(right);else selected[index]=right;}
 while(selected.length>100){let index=selected.length-1;while(priorityIds.has(selected[index].id))index--;selected.splice(index,1);}
 const rights=selected.map(dto);
 const current=await ctx.helpers.getSyncRow(ctx.db,ctx.user.id);let campaign=null;
 if(current?.save_json){const g=GameEngine.fromSave(JSON.parse(current.save_json),GAME_OFFICERS,{isAdmin:!!ctx.user.is_admin,isStaff:!!ctx.user.is_staff});const p=g.getUnificationProof();campaign={owned:p.owned,target:p.target,achieved:p.achieved,cycle:p.cycle};}
 return{rights,current:dto(opened),campaign};
}
async function reconcileCampaign(ctx){
 const {db,user,helpers:h}=ctx,row=await h.getSyncRow(db,user.id);if(!row?.save_json)return;
 const guard=h.roleCommitGuard(user),statements=campaignShogunateStatements({db,user,save:JSON.parse(row.save_json),now:Date.now(),gateSql:`${guard.sql} AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?)`,gateArgs:[...guard.args,user.id,row.revision]});
 if(statements.length)await db.batch(statements);
}
export async function handleShogunate(ctx){
 const {db,user,path,method,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 if(path==='/shogunate'&&method==='GET'){await reconcileCampaign(ctx);return{ok:true,shogunate:await view(ctx)};}
 if(path!=='/shogunate/open'||method!=='POST')h.fail(404,'NOT_FOUND','幕府の操作が見つかりません。');
 const body=await h.readBody(ctx.request);
 if(!body||Object.keys(body).some(k=>!['requestId','rightId'].includes(k)))h.fail(400,'INVALID_INPUT','幕府開設権を選んでください。');
 const requestId=h.idField(body.requestId,'操作番号'),rightId=h.idField(body.rightId,'幕府開設権'),digest=await h.hash(JSON.stringify(['open',rightId]));
 const prior=await S(db,'SELECT * FROM shogunate_requests WHERE user_id=? AND request_id=?',user.id,requestId).first();
 if(prior){if(prior.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の幕府開設に使われています。');return{ok:true,idempotent:true,receipt:JSON.parse(prior.result_json),shogunate:await view(ctx,rightId)};}
 const right=await S(db,'SELECT * FROM shogunate_rights WHERE id=? AND user_id=?',rightId,user.id).first();
 if(!right)h.fail(409,'SHOGUNATE_RIGHT_REQUIRED','天下統一を達成して幕府開設権を獲得してください。');
 if(right.opened_at!=null)h.fail(409,'SHOGUNATE_ALREADY_OPENED','この天下統一の幕府は開設済みです。');
 await h.budget(db,'shogunate-open:'+user.id,12,60000,Date.now());
 const now=Date.now(),nonce=crypto.randomUUID(),name=(String(user.clan||user.name||'天下').replace(/家$/,''))+'幕府',receipt={rightId,governmentName:name,rank:'征夷大将軍',openedAt:now,title:right.title},guard=h.roleCommitGuard(user),gate='EXISTS(SELECT 1 FROM shogunate_requests WHERE user_id=? AND request_id=? AND commit_token=?)';
 await db.batch([
  S(db,`INSERT INTO shogunate_requests(user_id,request_id,right_id,request_hash,commit_token,result_json,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} AND EXISTS(SELECT 1 FROM shogunate_rights WHERE id=? AND user_id=? AND opened_at IS NULL) ON CONFLICT DO NOTHING`,user.id,requestId,rightId,digest,nonce,JSON.stringify(receipt),now,...guard.args,rightId,user.id),
  S(db,`UPDATE shogunate_rights SET opened_at=?,government_name=?,opened_request_id=? WHERE id=? AND user_id=? AND opened_at IS NULL AND ${gate}`,now,name,requestId,rightId,user.id,user.id,requestId,nonce)
 ]);
 const accepted=await S(db,'SELECT * FROM shogunate_requests WHERE user_id=? AND request_id=?',user.id,requestId).first();
 if(!accepted){await h.requireAccountAccess(db,user);h.fail(409,'SHOGUNATE_ALREADY_OPENED','幕府の記録が更新されました。最新の記録を確認してください。');}
 if(accepted.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の幕府開設に使われています。');
 return{ok:true,idempotent:accepted.commit_token!==nonce,receipt:JSON.parse(accepted.result_json),shogunate:await view(ctx,rightId)};
}
