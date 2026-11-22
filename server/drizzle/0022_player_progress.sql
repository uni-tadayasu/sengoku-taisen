CREATE TABLE progress_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  data_json TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE progress_campaigns (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  observed_json TEXT NOT NULL,
  PRIMARY KEY(user_id,campaign_id)
);
--> statement-breakpoint
CREATE TABLE progress_receipts (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('mission','exchange')),
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id),
  UNIQUE(actor_id,claim_key)
);
--> statement-breakpoint
CREATE INDEX progress_receipts_actor ON progress_receipts(actor_id,created_at DESC);
