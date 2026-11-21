CREATE TABLE player_bans (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  active INTEGER NOT NULL CHECK(active IN (0,1)),
  revision INTEGER NOT NULL CHECK(revision>=1),
  reason TEXT NOT NULL DEFAULT '',
  banned_by TEXT NOT NULL REFERENCES users(id),
  banned_at INTEGER,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX player_bans_active ON player_bans(active,updated_at DESC,user_id DESC);
--> statement-breakpoint
CREATE TABLE moderation_requests (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  target_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK(action IN ('ban','unban')),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(actor_id,request_id),
  CHECK(actor_id<>target_id)
);
--> statement-breakpoint
CREATE INDEX moderation_requests_target ON moderation_requests(target_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE moderation_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  content_revision INTEGER NOT NULL DEFAULT 0 CHECK(content_revision>=0)
);
--> statement-breakpoint
INSERT INTO moderation_state(id,content_revision) VALUES(1,0);
