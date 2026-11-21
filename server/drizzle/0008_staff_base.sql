ALTER TABLE staff_members ADD COLUMN term_id TEXT;
--> statement-breakpoint
ALTER TABLE staff_members ADD COLUMN appointed_elapsed_ms INTEGER;
--> statement-breakpoint
CREATE TABLE staff_base (
  id TEXT PRIMARY KEY CHECK(id='sunpu'),
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  commit_token TEXT,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE staff_base_requests (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE staff_campaign_backups (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  term_id TEXT NOT NULL,
  save_json TEXT NOT NULL,
  joined_elapsed_ms INTEGER NOT NULL,
  left_elapsed_ms INTEGER,
  active INTEGER NOT NULL CHECK(active IN(0,1)),
  transition_token TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
