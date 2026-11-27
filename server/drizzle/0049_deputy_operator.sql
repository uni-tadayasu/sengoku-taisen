CREATE TABLE deputy_operator_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  user_id TEXT UNIQUE REFERENCES users(id),
  term_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  appointed_by TEXT REFERENCES users(id),
  appointed_at INTEGER,
  updated_at INTEGER NOT NULL DEFAULT 0,
  CHECK((user_id IS NULL AND term_id IS NULL) OR (user_id IS NOT NULL AND term_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE deputy_role_requests (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  target_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('appoint','dismiss')),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE deputy_campaign_backups (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  term_id TEXT NOT NULL,
  original_home TEXT NOT NULL,
  save_json TEXT NOT NULL CHECK(json_valid(save_json)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_at INTEGER NOT NULL
);
