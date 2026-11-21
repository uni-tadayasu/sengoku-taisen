CREATE TABLE roaming_battles (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor_id, request_id),
  UNIQUE (actor_id, campaign_id, sequence)
);
--> statement-breakpoint
CREATE INDEX roaming_battles_history_idx ON roaming_battles(actor_id, created_at DESC);
