CREATE TABLE pvp_protection (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 beginner_until INTEGER NOT NULL DEFAULT 0,
 ended_at INTEGER,
 recovery_until INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE notification_preferences (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL DEFAULT 0,
 battle INTEGER NOT NULL DEFAULT 1,
 letter INTEGER NOT NULL DEFAULT 1,
 operation INTEGER NOT NULL DEFAULT 1,
 construction INTEGER NOT NULL DEFAULT 1,
 event INTEGER NOT NULL DEFAULT 1,
 quiet_start INTEGER NOT NULL DEFAULT 22,
 quiet_end INTEGER NOT NULL DEFAULT 8,
 digest_minutes INTEGER NOT NULL DEFAULT 5,
 updated_at INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE notification_subscriptions (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL UNIQUE,
 pull_hash TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 last_sent_at INTEGER NOT NULL DEFAULT 0,
 failure_count INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE notification_outbox (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category TEXT NOT NULL CHECK(category IN ('battle','letter','operation','construction','event')),
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 due_at INTEGER NOT NULL,
 world_due_elapsed INTEGER,
 delivered_at INTEGER,
 sent_at INTEGER,
 leased_until INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX notification_due ON notification_outbox(delivered_at,due_at,user_id);
--> statement-breakpoint
CREATE TABLE notification_scheduler (
 id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
 next_tick INTEGER NOT NULL DEFAULT 0,
 cursor TEXT NOT NULL DEFAULT ''
);
