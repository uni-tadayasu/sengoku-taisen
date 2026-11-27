-- Expulsion releases a base without banning or deleting the player's account.
-- The retained save is used only by a new, explicit admission transaction.
CREATE TABLE player_expulsions (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
 revision INTEGER NOT NULL CHECK(revision>=1),
 pending INTEGER NOT NULL CHECK(pending IN (0,1)),
 castle_id TEXT NOT NULL,
 lord_epoch INTEGER NOT NULL CHECK(lord_epoch>=0),
 role TEXT NOT NULL CHECK(role IN ('lord','retainer')),
 source_save_json TEXT CHECK(source_save_json IS NULL OR json_valid(source_save_json)),
 reason TEXT NOT NULL DEFAULT '',
 expelled_by TEXT NOT NULL REFERENCES users(id),
 expelled_at INTEGER NOT NULL,
 resumed_at INTEGER,
 CHECK(user_id<>expelled_by),
 CHECK((pending=1 AND source_save_json IS NOT NULL AND resumed_at IS NULL) OR (pending=0 AND source_save_json IS NULL AND resumed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE expulsion_requests (
 actor_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 target_id TEXT NOT NULL REFERENCES users(id),
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL UNIQUE,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,request_id),
 CHECK(actor_id<>target_id)
);
--> statement-breakpoint
CREATE INDEX expulsion_requests_target_idx ON expulsion_requests(target_id,created_at DESC);
--> statement-breakpoint
CREATE TABLE expelled_campaigns (
 user_id TEXT NOT NULL REFERENCES users(id),
 campaign_id TEXT NOT NULL,
 expulsion_revision INTEGER NOT NULL CHECK(expulsion_revision>=1),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,campaign_id)
);
