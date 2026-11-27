// State shared by moderation and normal save/admission routes. No role is
// inferred from this table and no BAN flag is changed by an expulsion.
const S=(db,sql,...args)=>db.prepare(sql).bind(...args);
const name=id=>globalThis.SENGOKU_DATA?.castles.find(c=>c.id===id)?.name||id||'';
export const EXPULSION_MESSAGE='管理操作により拠点から追放されました。最新状態を読み込み、拠点を選び直してください。';
export async function expulsionSnapshot(db,userId){
 const row=await S(db,'SELECT revision,pending,castle_id,expelled_at FROM player_expulsions WHERE user_id=?',userId).first();
 return row?{pending:!!row.pending,revision:Number(row.revision),castleId:row.castle_id,castleName:name(row.castle_id),expelledAt:new Date(Number(row.expelled_at)).toISOString()}:null;
}
export async function moderationExpulsion(db,target){
 const row=await S(db,`SELECT e.*,p.save_json,m.castle_id AS resident_castle,m.revision AS member_revision,
  s.castle_id AS current_castle,s.lord_user_id,s.lord_epoch AS current_epoch
  FROM users u LEFT JOIN player_expulsions e ON e.user_id=u.id LEFT JOIN player_saves p ON p.user_id=u.id
  LEFT JOIN castle_residents m ON m.user_id=u.id LEFT JOIN castle_seats s ON s.castle_id=COALESCE(m.castle_id,json_extract(p.save_json,'$.state.home'))
  WHERE u.id=?`,target.id).first();
 const pending=!!row?.pending,castleId=pending?row.castle_id:row?.current_castle||null;
 const blockedReason=target.is_admin?'運営本人は追放できません。':target.is_staff?'京都御所のメンバーは、先にスタッフを解任してください。':target.is_deputy?'サブ運営は、先にサブ運営を解任してください。':target.ban_active?'BANを解除してから追放してください。':pending?'この領主は拠点の選び直しを待っています。':!row?.save_json||!castleId?'追放できる通常城の拠点がありません。':'';
 return {canExpel:!blockedReason,expulsion:{revision:Number(row?.revision||0),pending,castleId,castleName:name(castleId),role:castleId?(pending?row.role:row.lord_user_id===target.id?'lord':'retainer'):null,lordEpoch:Number(pending?row.lord_epoch:row?.current_epoch||0),expelledAt:row?.expelled_at?new Date(Number(row.expelled_at)).toISOString():null,reason:row?.reason||'',blockedReason}};
}
