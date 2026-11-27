// Operational authority is separate from the principal's court office and
// personal game entitlements. Every guard fences the exact current role term.
export function canOperate(user){
 return !!user&&!user.ban_active&&!user.expulsion_pending&&!!(user.is_admin||user.is_deputy&&!user.is_staff);
}
export function operationGuard(user){
 if(!canOperate(user))return{sql:'0=1',args:[]};
 return{sql:`EXISTS(SELECT 1 FROM users operation_actor WHERE operation_actor.id=?
  AND ?=CASE WHEN operation_actor.id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') THEN 1 ELSE 0 END
  AND COALESCE((SELECT COALESCE(term_id,'legacy:'||appointed_at) FROM staff_members WHERE user_id=operation_actor.id),'')=?
  AND COALESCE((SELECT term_id FROM deputy_operator_state WHERE user_id=operation_actor.id),'')=?
  AND NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id=operation_actor.id AND active=1)
  AND NOT EXISTS(SELECT 1 FROM player_expulsions WHERE user_id=operation_actor.id AND pending=1)
  AND COALESCE((SELECT revision FROM player_bans WHERE user_id=operation_actor.id),0)=?
  AND COALESCE((SELECT revision FROM player_expulsions WHERE user_id=operation_actor.id),0)=?)`,args:[user.id,user.is_admin?1:0,user.staff_term||'',user.deputy_term||'',Number(user.moderation_epoch||0),Number(user.expulsion_epoch||0)]};
}
