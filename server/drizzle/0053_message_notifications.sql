-- Existing consent, quiet hours, devices and queued notices are preserved.
-- World chat is a separate opt-in because it can be much busier than a letter.
ALTER TABLE notification_preferences ADD COLUMN chat INTEGER NOT NULL DEFAULT 1 CHECK(chat IN (0,1));
--> statement-breakpoint
ALTER TABLE notification_preferences ADD COLUMN worldChat INTEGER NOT NULL DEFAULT 0 CHECK(worldChat IN (0,1));
--> statement-breakpoint
ALTER TABLE notification_preferences ADD COLUMN announcement INTEGER NOT NULL DEFAULT 1 CHECK(announcement IN (0,1));
--> statement-breakpoint
ALTER TABLE notification_preferences ADD COLUMN chat_since INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE notification_preferences ADD COLUMN worldChat_since INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE notification_preferences ADD COLUMN announcement_since INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
-- Do not backfill old conversations into existing subscribers' lock screens.
UPDATE notification_preferences SET chat_since=CAST(strftime('%s','now') AS INTEGER)*1000,worldChat_since=CAST(strftime('%s','now') AS INTEGER)*1000,announcement_since=CAST(strftime('%s','now') AS INTEGER)*1000;
--> statement-breakpoint
CREATE TABLE notification_outbox_messages (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN ('battle','letter','operation','construction','event','chat','worldChat','announcement')),
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 due_at INTEGER NOT NULL,
 world_due_elapsed INTEGER,
 delivered_at INTEGER,
 sent_at INTEGER,
 leased_until INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 source_scope TEXT NOT NULL DEFAULT '',
 destination TEXT NOT NULL DEFAULT 'recap'
);
--> statement-breakpoint
INSERT INTO notification_outbox_messages(id,user_id,category,title,body,due_at,world_due_elapsed,delivered_at,sent_at,leased_until,lease_token,created_at)
 SELECT id,user_id,category,title,body,due_at,world_due_elapsed,delivered_at,sent_at,leased_until,lease_token,created_at FROM notification_outbox;
--> statement-breakpoint
DROP TABLE notification_outbox;
--> statement-breakpoint
ALTER TABLE notification_outbox_messages RENAME TO notification_outbox;
--> statement-breakpoint
CREATE INDEX notification_due ON notification_outbox(delivered_at,due_at,user_id);
--> statement-breakpoint
CREATE INDEX notification_user_due ON notification_outbox(user_id,delivered_at,due_at);
--> statement-breakpoint
CREATE TABLE notification_delivery_receipts (
 outbox_id TEXT NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES notification_subscriptions(id) ON DELETE CASCADE,
 delivered_at INTEGER NOT NULL,
 PRIMARY KEY(outbox_id,subscription_id)
);
--> statement-breakpoint
CREATE TABLE notification_chat_reads (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 room_key TEXT NOT NULL,
 last_message_id INTEGER NOT NULL CHECK(last_message_id>=0),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,room_key)
);
--> statement-breakpoint
CREATE TABLE notification_court_access (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 access_stamp TEXT NOT NULL,
 eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
 since INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE notification_announcements (
 id TEXT PRIMARY KEY NOT NULL,
 sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX notification_announcements_created ON notification_announcements(created_at);
--> statement-breakpoint
CREATE INDEX notification_message_created ON messages(created_at,id);
