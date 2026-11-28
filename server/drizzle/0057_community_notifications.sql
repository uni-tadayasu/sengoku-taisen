-- Preference edits must not advance consent and discard unqueued mail.
ALTER TABLE notification_preferences ADD COLUMN battle_since INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE notification_preferences ADD COLUMN letter_since INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE notification_preferences ADD COLUMN operation_since INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE notification_preferences ADD COLUMN construction_since INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE notification_preferences ADD COLUMN event_since INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE notification_preferences SET battle_since=updated_at,letter_since=updated_at,operation_since=updated_at,construction_since=updated_at,event_since=updated_at;
--> statement-breakpoint
CREATE TABLE notification_chat_deliveries (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 room_key TEXT NOT NULL,
 last_message_id INTEGER NOT NULL CHECK(last_message_id>=0),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,room_key)
);
--> statement-breakpoint
-- New in-game badges start with new messages, never an unbounded old history.
CREATE TABLE notification_chat_baseline (id INTEGER PRIMARY KEY CHECK(id=1),last_message_id INTEGER NOT NULL);
--> statement-breakpoint
INSERT INTO notification_chat_baseline(id,last_message_id) SELECT 1,COALESCE(MAX(id),0) FROM messages;
--> statement-breakpoint
CREATE INDEX notification_room_created ON messages(room_key,created_at,id);
--> statement-breakpoint
CREATE TABLE notification_social_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 destination TEXT NOT NULL CHECK(destination IN ('friends','guild','trade')),
 source_id TEXT NOT NULL DEFAULT '',
 subject_id TEXT NOT NULL DEFAULT '',
 source_revision INTEGER NOT NULL DEFAULT 0,
 guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE,
 audience TEXT NOT NULL CHECK(audience IN ('person','member','officer','owner')),
 role_stamp TEXT NOT NULL DEFAULT '',
 membership_epoch INTEGER,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 read_at INTEGER,
 push_eligible INTEGER NOT NULL DEFAULT 1 CHECK(push_eligible IN (0,1))
);
--> statement-breakpoint
CREATE INDEX notification_social_unread ON notification_social_events(user_id,read_at,seq);
--> statement-breakpoint
CREATE INDEX notification_social_sender ON notification_social_events(actor_id,created_at,user_id);
--> statement-breakpoint
-- A removed/recreated friendship may have the same millisecond timestamp.
ALTER TABLE friendships ADD COLUMN notification_key TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
-- Only currently actionable requests enter the new inbox. Historical outcomes
-- stay untouched, and migration notices can never generate a retroactive push.
-- Old alliance invitations did not store their author; preserve that unknown
-- value instead of attributing another officer's action to today's guild owner.
-- BEGIN COMMUNITY INBOX BACKFILL
WITH migration_time(now) AS (SELECT CAST(strftime('%s','now') AS INTEGER)*1000),
-- D1 allows at most five SELECT terms in each compound statement. Keep the
-- five relationship sources together, then combine them with pending trades.
pending_requests(user_id,actor_id,kind,destination,source_id,subject_id,source_revision,guild_id,audience,role_stamp,membership_epoch,created_at,expires_at) AS (
 SELECT CASE WHEN f.requested_by=f.user_a THEN f.user_b ELSE f.user_a END,f.requested_by,'friend-request','friends',f.notification_key,f.requested_by,f.created_at,NULL,'person','',NULL,f.created_at,migration_time.now+2592000000
 FROM friendships f CROSS JOIN migration_time WHERE f.status='pending' AND f.requested_by IN (f.user_a,f.user_b)
 UNION ALL
 SELECT gm.user_id,a.user_id,'guild-application','guild',a.guild_id,a.user_id,a.revision,a.guild_id,'officer',CASE WHEN g.owner_id=gm.user_id THEN 'owner:'||gm.user_id ELSE 'officer:'||go.appointed_at END,COALESCE(e.epoch,0),a.updated_at,a.expires_at
 FROM alliance_applications a JOIN guilds g ON g.id=a.guild_id JOIN guild_members gm ON gm.guild_id=g.id LEFT JOIN guild_officers go ON go.guild_id=gm.guild_id AND go.user_id=gm.user_id LEFT JOIN voice_membership_epochs e ON e.user_id=gm.user_id
 WHERE a.status='pending' AND a.expires_at>(SELECT now FROM migration_time) AND (g.owner_id=gm.user_id OR go.user_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM guild_members applicant WHERE applicant.user_id=a.user_id)
 UNION ALL
 SELECT a.user_id,NULL,CASE a.status WHEN 'invited' THEN 'guild-invitation' ELSE 'guild-approved' END,'guild',a.guild_id,a.user_id,a.revision,a.guild_id,'person','',NULL,a.updated_at,a.expires_at
 FROM alliance_applications a WHERE a.status IN ('invited','approved') AND a.expires_at>(SELECT now FROM migration_time) AND NOT EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=a.user_id)
 UNION ALL
 SELECT g.owner_id,w.actor_id,'treasury-request','guild',w.id,w.actor_id,w.revision,w.guild_id,'owner','owner:'||g.owner_id,COALESCE(owner_epoch.epoch,0),w.created_at,w.expires_at
 FROM alliance_withdrawals w JOIN guilds g ON g.id=w.guild_id JOIN guild_members owner_member ON owner_member.guild_id=g.id AND owner_member.user_id=g.owner_id LEFT JOIN voice_membership_epochs owner_epoch ON owner_epoch.user_id=g.owner_id
 WHERE w.status='pending' AND w.expires_at>(SELECT now FROM migration_time) AND EXISTS(SELECT 1 FROM guild_members gm WHERE gm.guild_id=w.guild_id AND gm.user_id=w.actor_id AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=gm.user_id),0)=w.actor_epoch)
 UNION ALL
 SELECT w.actor_id,w.approved_by,'treasury-approved','guild',w.id,w.actor_id,w.revision,w.guild_id,'member','',w.actor_epoch,w.created_at,w.expires_at
 FROM alliance_withdrawals w WHERE w.status='approved' AND w.expires_at>(SELECT now FROM migration_time) AND EXISTS(SELECT 1 FROM guild_members gm WHERE gm.guild_id=w.guild_id AND gm.user_id=w.actor_id AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=gm.user_id),0)=w.actor_epoch)
),
pending AS (
 SELECT * FROM pending_requests
 UNION ALL
 SELECT t.recipient_id,t.sender_id,'trade-offer','trade',t.id,'',t.revision,NULL,'person','',NULL,t.created_at,migration_time.now+2592000000
 FROM trades t CROSS JOIN migration_time WHERE t.status='pending'
)
INSERT INTO notification_social_events(id,user_id,actor_id,kind,destination,source_id,subject_id,source_revision,guild_id,audience,role_stamp,membership_epoch,created_at,expires_at,push_eligible)
 SELECT 'migration:'||n.kind||':'||n.source_id||':'||n.subject_id||':'||n.source_revision||':'||n.user_id,n.user_id,n.actor_id,n.kind,n.destination,n.source_id,n.subject_id,n.source_revision,n.guild_id,n.audience,n.role_stamp,n.membership_epoch,n.created_at,n.expires_at,0
 FROM pending n WHERE (n.actor_id IS NULL OR n.user_id<>n.actor_id) AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=n.user_id AND b.active=1) AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=n.actor_id AND b.active=1)
 ON CONFLICT(id) DO NOTHING;
-- END COMMUNITY INBOX BACKFILL
