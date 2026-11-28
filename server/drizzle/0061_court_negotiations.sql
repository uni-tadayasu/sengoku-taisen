-- A negotiated payment is committed with both canonical saves and the active
-- relationship. Terms and immutable command receipts remain private.
CREATE TABLE court_negotiations (
 id TEXT PRIMARY KEY,
 lord_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 warrior_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 offer_json TEXT NOT NULL CHECK(json_valid(offer_json)),
 offered_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','cancelled')),
 revision INTEGER NOT NULL CHECK(revision>=1),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 CHECK(lord_id<>warrior_id),
 CHECK(offered_by IN (lord_id,warrior_id))
);
--> statement-breakpoint
CREATE UNIQUE INDEX court_negotiation_pending_pair ON court_negotiations(lord_id,warrior_id) WHERE status='pending';
--> statement-breakpoint
CREATE INDEX court_negotiation_lord ON court_negotiations(lord_id,status,created_at,id);
--> statement-breakpoint
CREATE INDEX court_negotiation_warrior ON court_negotiations(warrior_id,status,created_at,id);
--> statement-breakpoint
CREATE TABLE court_negotiation_requests (
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 negotiation_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('propose','counter','accept','reject','cancel')),
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL UNIQUE,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE court_vassals (
 vassal_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 lord_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 negotiation_id TEXT NOT NULL UNIQUE REFERENCES court_negotiations(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 CHECK(vassal_id<>lord_id)
);
--> statement-breakpoint
CREATE INDEX court_vassals_lord ON court_vassals(lord_id,created_at,vassal_id);
--> statement-breakpoint
-- Expand destinations without replaying old events or reusing a notification
-- sequence that a client has already observed, including deleted high IDs.
CREATE TABLE notification_social_events_next (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 actor_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 destination TEXT NOT NULL CHECK(destination IN ('friends','guild','trade','courtNegotiations')),
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
INSERT INTO notification_social_events_next SELECT * FROM notification_social_events;
--> statement-breakpoint
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='notification_social_events'),0)) WHERE name='notification_social_events_next';
--> statement-breakpoint
INSERT INTO sqlite_sequence(name,seq) SELECT 'notification_social_events_next',seq FROM sqlite_sequence WHERE name='notification_social_events' AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='notification_social_events_next');
--> statement-breakpoint
DROP TABLE notification_social_events;
--> statement-breakpoint
ALTER TABLE notification_social_events_next RENAME TO notification_social_events;
--> statement-breakpoint
CREATE INDEX notification_social_unread ON notification_social_events(user_id,read_at,seq);
--> statement-breakpoint
CREATE INDEX notification_social_sender ON notification_social_events(actor_id,created_at,user_id);
