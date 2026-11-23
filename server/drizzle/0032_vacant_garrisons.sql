-- Stationed troops stay owned by the sender and never grant a castle seat.
-- Current player_saves campaign identity determines whether a depot is active.
CREATE TABLE vacant_garrisons (
  actor_id TEXT NOT NULL REFERENCES users(id),
  campaign_id TEXT NOT NULL,
  castle_id TEXT NOT NULL,
  troops INTEGER NOT NULL CHECK(troops>=0 AND troops<=100000000),
  sequence INTEGER NOT NULL CHECK(sequence>=1 AND sequence<=1000000000),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,campaign_id,castle_id)
);
--> statement-breakpoint
CREATE INDEX vacant_garrisons_active_castle ON vacant_garrisons(castle_id,actor_id,campaign_id) WHERE troops>0;
--> statement-breakpoint
CREATE TABLE vacant_garrison_requests (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('send','recall')),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
