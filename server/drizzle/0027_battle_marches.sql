CREATE TABLE battle_marches (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('castle','branch','field','roaming','rally')),
 campaign_id TEXT NOT NULL,
 source_castle_id TEXT NOT NULL,
 target_castle_id TEXT NOT NULL,
 target_player_id TEXT,
 target_campaign_id TEXT,
 target_name TEXT NOT NULL,
 troops INTEGER NOT NULL CHECK(troops BETWEEN 1 AND 1000000),
 food_cost INTEGER NOT NULL CHECK(food_cost >= 0),
 command_cost INTEGER NOT NULL CHECK(command_cost BETWEEN 0 AND 1),
 departed_ms INTEGER NOT NULL CHECK(departed_ms >= 0),
 arrives_ms INTEGER NOT NULL CHECK(arrives_ms > departed_ms),
 duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
 distance_km REAL NOT NULL CHECK(distance_km >= 0),
 status TEXT NOT NULL DEFAULT 'marching' CHECK(status IN ('marching','resolved','cancelled')),
 request_hash TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 result_json TEXT,
 commit_token TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(actor_id,request_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX battle_marches_one_army ON battle_marches(actor_id) WHERE status='marching';
--> statement-breakpoint
CREATE INDEX battle_marches_due ON battle_marches(status,arrives_ms);
--> statement-breakpoint
CREATE INDEX battle_marches_history ON battle_marches(actor_id,created_at DESC);
--> statement-breakpoint
ALTER TABLE alliance_units ADD COLUMN march_id TEXT;
--> statement-breakpoint
ALTER TABLE alliance_operations ADD COLUMN march_id TEXT;
--> statement-breakpoint
ALTER TABLE covert_requests ADD COLUMN march_target_campaign_id TEXT;
