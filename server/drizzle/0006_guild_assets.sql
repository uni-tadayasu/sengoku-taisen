CREATE TABLE guild_officers (
  user_id TEXT PRIMARY KEY REFERENCES guild_members(user_id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  appointed_by TEXT NOT NULL REFERENCES users(id),
  appointed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX guild_officers_guild_idx ON guild_officers(guild_id,user_id);
--> statement-breakpoint
CREATE TABLE guild_treasuries (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  gold INTEGER NOT NULL DEFAULT 0 CHECK (gold BETWEEN 0 AND 999999999),
  rice INTEGER NOT NULL DEFAULT 0 CHECK (rice BETWEEN 0 AND 999999999),
  wood INTEGER NOT NULL DEFAULT 0 CHECK (wood BETWEEN 0 AND 999999999),
  stone INTEGER NOT NULL DEFAULT 0 CHECK (stone BETWEEN 0 AND 999999999),
  magatama INTEGER NOT NULL DEFAULT 0 CHECK (magatama BETWEEN 0 AND 999999999),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
--> statement-breakpoint
CREATE TABLE guild_asset_requests (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('deposit','withdraw')),
  resource TEXT NOT NULL CHECK (resource IN ('gold','rice','wood','stone','magatama')),
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 1000000),
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  world_elapsed_ms INTEGER NOT NULL CHECK (world_elapsed_ms >= 0),
  UNIQUE(actor_id,request_id)
);
--> statement-breakpoint
CREATE INDEX guild_asset_requests_history_idx ON guild_asset_requests(guild_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE guild_role_requests (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('officer','member','remove')),
  commit_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
