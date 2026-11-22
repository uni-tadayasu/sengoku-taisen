CREATE TABLE castle_residency_meta (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 0,
  sequence INTEGER NOT NULL DEFAULT 0,
  bootstrap_token TEXT
);
--> statement-breakpoint
CREATE TABLE castle_seats (
  castle_id TEXT PRIMARY KEY,
  lord_user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  lord_epoch INTEGER NOT NULL DEFAULT 0,
  lord_since_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE castle_residents (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  castle_id TEXT NOT NULL REFERENCES castle_seats(castle_id),
  join_order INTEGER NOT NULL UNIQUE,
  joined_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE INDEX castle_residents_queue_idx ON castle_residents(castle_id,join_order,user_id);
--> statement-breakpoint
CREATE TABLE castle_residency_requests (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  castle_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('lord','retainer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE castle_successions (
  event_id TEXT PRIMARY KEY,
  castle_id TEXT NOT NULL REFERENCES castle_seats(castle_id),
  previous_lord_id TEXT NOT NULL REFERENCES users(id),
  lord_user_id TEXT REFERENCES users(id),
  lord_epoch INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('field','covert','cpu','departure')),
  result_json TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX castle_successions_castle_idx ON castle_successions(castle_id,created_at,event_id);
--> statement-breakpoint
CREATE TABLE castle_residency_cpu_cursors (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  resolved_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id,campaign_id)
);
--> statement-breakpoint
ALTER TABLE covert_requests ADD COLUMN march_target_residency_json TEXT;
