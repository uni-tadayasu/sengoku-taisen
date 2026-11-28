// Community events belong to their recipients even when Web Push is disabled.
// Store them in the same transaction as the successful action, then recheck
// source state and membership for both the inbox and lock-screen delivery.
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=result=>result?.results||[];
const DAY=86400000;
const kinds={
 'friend-request':{destination:'friends',title:'フレンド申請が届きました',body:'フレンド一覧で申請を確認できます。'},
 'friend-accepted':{destination:'friends',title:'フレンド申請が承認されました',body:'フレンド一覧から会話を始められます。'},
 'friend-declined':{destination:'friends',title:'フレンド申請の返事が届きました',body:'フレンド申請が辞退されました。'},
 'guild-application':{destination:'guild',title:'同盟への加入申請が届きました',body:'同盟の加入申請一覧で確認できます。'},
 'guild-invitation':{destination:'guild',title:'同盟への招待が届きました',body:'同盟の招待一覧で確認できます。'},
 'guild-approved':{destination:'guild',title:'同盟への加入申請が承認されました',body:'同盟一覧から参加できます。'},
 'guild-declined':{destination:'guild',title:'同盟への加入申請の返事が届きました',body:'同盟への加入申請が辞退されました。'},
 'treasury-request':{destination:'guild',title:'同盟金庫の出金申請が届きました',body:'同盟作戦の金庫管理で確認できます。'},
 'treasury-approved':{destination:'guild',title:'同盟金庫の出金が承認されました',body:'同盟作戦の金庫管理から受け取れます。'},
 'treasury-declined':{destination:'guild',title:'同盟金庫の出金申請の返事が届きました',body:'出金申請が辞退されました。'},
 'trade-offer':{destination:'trade',title:'交易の申し込みが届きました',body:'交易の受信一覧で条件を確認できます。'},
 'trade-accepted':{destination:'trade',title:'交易が成立しました',body:'交易で結果と受け取りを確認できます。'},
 'trade-rejected':{destination:'trade',title:'交易の申し込みの返事が届きました',body:'交易が辞退されました。預けた資産を確認できます。'},
 'trade-cancelled':{destination:'trade',title:'交易の申し込みが取り消されました',body:'交易の履歴で確認できます。'},
 'court-negotiation-proposed':{destination:'courtNegotiations',title:'主従関係の交渉が届きました',body:'京都御所の交渉一覧で相手と対価を確認できます。'},
 'court-negotiation-countered':{destination:'courtNegotiations',title:'交渉の新しい条件が届きました',body:'交渉一覧で最新の対価を確認して返答できます。'},
 'court-negotiation-accepted':{destination:'courtNegotiations',title:'主従関係の交渉が成立しました',body:'合意した対価が支払われ、主従関係が結ばれました。'},
 'court-negotiation-rejected':{destination:'courtNegotiations',title:'交渉の条件が辞退されました',body:'交渉の履歴で結果を確認できます。対価は移動していません。'},
 'court-negotiation-cancelled':{destination:'courtNegotiations',title:'交渉の条件が取り消されました',body:'交渉の履歴で確認できます。対価は移動していません。'},
 'court-vassal-ended':{destination:'courtNegotiations',title:'主従関係が終了しました',body:'正式加入・役職・所属の変更に伴い主従関係が終了しました。支払済みの対価は返金されません。'}
};
const active=expression=>`NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=${expression} AND b.active=1)`;
export const socialNotificationContent=kind=>kinds[kind]||null;

export function socialNotificationStatement(db,event,now,gate='1=1',args=[]){
 const kind=kinds[event.kind];if(!kind||typeof event.actorId!=='string'||!event.actorId)throw Error('Invalid community notification');
 const audience=event.audience||'person',guildId=event.guildId||null;
 const recipient=audience==='person'?{sql:'recipient.id=?',args:[event.userId]}:{
  sql:`EXISTS(SELECT 1 FROM guild_members gm JOIN guilds g ON g.id=gm.guild_id WHERE gm.user_id=recipient.id AND gm.guild_id=?${audience==='owner'?' AND g.owner_id=recipient.id':audience==='officer'?' AND (g.owner_id=recipient.id OR EXISTS(SELECT 1 FROM guild_officers go WHERE go.guild_id=gm.guild_id AND go.user_id=recipient.id))':''})${event.userId?' AND recipient.id=?':''}`,args:[guildId,...(event.userId?[event.userId]:[])]
 };
 const revision=event.sourceRevision&&typeof event.sourceRevision==='object'?event.sourceRevision:{sql:'?',args:[Number(event.sourceRevision)||0]};
 // The action's receipt/key makes retries idempotent without depending on
 // timestamp ordering, and an epoch prevents a later rejoin reusing a notice.
 return stmt(db,`INSERT INTO notification_social_events(id,user_id,actor_id,kind,destination,source_id,subject_id,source_revision,guild_id,audience,role_stamp,membership_epoch,created_at,expires_at)
 SELECT ?||':'||recipient.id,recipient.id,?,?,?,?,?,${revision.sql},?,?,CASE WHEN ? IN ('officer','owner') THEN COALESCE((SELECT 'owner:'||recipient.id FROM guilds WHERE id=? AND owner_id=recipient.id),(SELECT 'officer:'||appointed_at FROM guild_officers WHERE guild_id=? AND user_id=recipient.id),'') ELSE '' END,CASE WHEN ?='person' THEN NULL ELSE COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=recipient.id),0) END,?,?
 FROM users recipient WHERE ${recipient.sql} AND recipient.id<>? AND ${active('recipient.id')} AND ${gate} ON CONFLICT(id) DO NOTHING`,
 event.key,event.actorId,event.kind,kind.destination,event.sourceId||'',event.subjectId||'',...revision.args,guildId,audience,audience,guildId,guildId,audience,now,Math.min(event.expiresAt||now+30*DAY,now+30*DAY),...recipient.args,event.actorId,...args);
}

export function socialNotificationAccess(alias='n'){
 const pair=`((f.user_a=${alias}.user_id AND f.user_b=${alias}.actor_id) OR (f.user_b=${alias}.user_id AND f.user_a=${alias}.actor_id))`;
 return `${active(alias+'.user_id')} AND ${active(alias+'.actor_id')} AND (${alias}.actor_id IS NULL OR ${alias}.user_id<>${alias}.actor_id)
 AND (${alias}.audience='person' OR EXISTS(SELECT 1 FROM guild_members gm JOIN guilds g ON g.id=gm.guild_id WHERE gm.user_id=${alias}.user_id AND gm.guild_id=${alias}.guild_id AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=gm.user_id),0)=${alias}.membership_epoch
  AND (${alias}.audience='member' OR (g.owner_id=gm.user_id AND ${alias}.role_stamp='owner:'||gm.user_id) OR (${alias}.audience='officer' AND EXISTS(SELECT 1 FROM guild_officers go WHERE go.user_id=gm.user_id AND go.guild_id=gm.guild_id AND ${alias}.role_stamp='officer:'||go.appointed_at)))))
 AND CASE
 WHEN ${alias}.kind='friend-request' THEN EXISTS(SELECT 1 FROM friendships f WHERE ${pair} AND f.status='pending' AND f.requested_by=${alias}.actor_id AND f.notification_key=${alias}.source_id AND f.created_at=${alias}.source_revision)
 WHEN ${alias}.kind='friend-accepted' THEN EXISTS(SELECT 1 FROM friendships f WHERE ${pair} AND f.status='accepted' AND f.notification_key=${alias}.source_id AND f.created_at=${alias}.source_revision)
 WHEN ${alias}.kind='friend-declined' THEN NOT EXISTS(SELECT 1 FROM friendships f WHERE ${pair})
 WHEN ${alias}.kind IN ('guild-application','guild-invitation','guild-approved','guild-declined') THEN EXISTS(SELECT 1 FROM alliance_applications a WHERE a.guild_id=${alias}.guild_id AND a.user_id=${alias}.subject_id AND a.revision=${alias}.source_revision
  AND a.status=CASE ${alias}.kind WHEN 'guild-application' THEN 'pending' WHEN 'guild-invitation' THEN 'invited' WHEN 'guild-approved' THEN 'approved' ELSE 'denied' END
  AND NOT EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=a.user_id))
 WHEN ${alias}.kind IN ('treasury-request','treasury-approved','treasury-declined') THEN EXISTS(SELECT 1 FROM alliance_withdrawals w WHERE w.id=${alias}.source_id AND w.guild_id=${alias}.guild_id
  AND w.status=CASE ${alias}.kind WHEN 'treasury-request' THEN 'pending' WHEN 'treasury-approved' THEN 'approved' ELSE 'denied' END
  AND EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=w.actor_id AND gm.guild_id=w.guild_id AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=gm.user_id),0)=w.actor_epoch))
 WHEN ${alias}.kind IN ('trade-offer','trade-accepted','trade-rejected','trade-cancelled') THEN EXISTS(SELECT 1 FROM trades t WHERE t.id=${alias}.source_id AND (t.sender_id=${alias}.user_id OR t.recipient_id=${alias}.user_id)
  AND t.status=CASE ${alias}.kind WHEN 'trade-offer' THEN 'pending' WHEN 'trade-accepted' THEN 'accepted' WHEN 'trade-rejected' THEN 'rejected' ELSE 'cancelled' END)
 WHEN ${alias}.kind IN ('court-negotiation-proposed','court-negotiation-countered','court-negotiation-accepted','court-negotiation-rejected','court-negotiation-cancelled') THEN EXISTS(SELECT 1 FROM court_negotiations c WHERE c.id=${alias}.source_id AND c.revision=${alias}.source_revision AND ((c.lord_id=${alias}.user_id AND c.warrior_id=${alias}.actor_id) OR (c.warrior_id=${alias}.user_id AND c.lord_id=${alias}.actor_id))
  AND c.status=CASE ${alias}.kind WHEN 'court-negotiation-accepted' THEN 'accepted' WHEN 'court-negotiation-rejected' THEN 'rejected' WHEN 'court-negotiation-cancelled' THEN 'cancelled' ELSE 'pending' END)
 WHEN ${alias}.kind='court-vassal-ended' THEN EXISTS(SELECT 1 FROM court_vassal_endings e WHERE e.negotiation_id=${alias}.source_id AND ((e.lord_id=${alias}.user_id AND e.vassal_id=${alias}.actor_id) OR (e.vassal_id=${alias}.user_id AND e.lord_id=${alias}.actor_id)))
 ELSE 0 END`;
}

export function socialNotificationSummaryStatement(db,userId,now){
 return stmt(db,`SELECT n.*,SUM(destination='friends') OVER() AS friends_count,SUM(destination='guild') OVER() AS guild_count,SUM(destination='trade') OVER() AS trade_count,SUM(destination='courtNegotiations') OVER() AS court_count,MAX(seq) OVER() AS latest_id
 FROM notification_social_events n WHERE n.user_id=? AND n.read_at IS NULL AND n.expires_at>? AND ${socialNotificationAccess()}
 ORDER BY n.seq LIMIT 30`,userId,now);
}
export function socialNotificationSummary(result){
 const found=rows(result),first=found[0],unreadSocial={friends:Number(first?.friends_count)||0,guild:Number(first?.guild_count)||0,trade:Number(first?.trade_count)||0,court:Number(first?.court_count)||0,total:0,latestId:Number(first?.latest_id)||0};
 // Totals use the complete result set, even when the visible page is bounded.
 unreadSocial.total=unreadSocial.friends+unreadSocial.guild+unreadSocial.trade+unreadSocial.court;
 return{unreadSocial,socialNotifications:found.map(n=>({id:n.id,seq:Number(n.seq),kind:n.kind,...kinds[n.kind],createdAt:new Date(n.created_at).toISOString()}))};
}
export async function readSocialNotifications(ctx,body){
 const {db,user,helpers:h,now}=ctx;
 if(!Array.isArray(body.ids)||body.ids.length<1||body.ids.length>30||body.ids.some(id=>typeof id!=='string'||id.length<1||id.length>512))h.fail(400,'NOTIFICATION_IDS','確認する通知を選んでください。');
 const guard=h.accountCommitGuard(user),ids=JSON.stringify([...new Set(body.ids)]);
 const read=await stmt(db,`UPDATE notification_social_events AS n SET read_at=COALESCE(read_at,?) WHERE n.user_id=? AND n.id IN(SELECT value FROM json_each(?)) AND n.expires_at>? AND ${socialNotificationAccess()} AND ${guard.sql} RETURNING id`,now,user.id,ids,now,...guard.args).all();
 await h.requireAccountAccess(db,user);return{ok:true,readIds:rows(read).map(n=>n.id)};
}
