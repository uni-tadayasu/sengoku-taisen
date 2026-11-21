CREATE TABLE walking_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_steps INTEGER NOT NULL DEFAULT 0 CHECK(total_steps >= 0),
  active_session_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE walking_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  total_steps INTEGER NOT NULL DEFAULT 0 CHECK(total_steps >= 0),
  active_ms INTEGER NOT NULL DEFAULT 0 CHECK(active_ms >= 0),
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK(last_seq >= 0),
  closed INTEGER NOT NULL DEFAULT 0 CHECK(closed IN(0,1)),
  commit_token TEXT NOT NULL,
  UNIQUE(user_id,request_id)
);
--> statement-breakpoint
CREATE INDEX walking_sessions_user ON walking_sessions(user_id,started_at DESC);
--> statement-breakpoint
CREATE TABLE walking_receipts (
  session_id TEXT NOT NULL REFERENCES walking_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(session_id,seq)
);
