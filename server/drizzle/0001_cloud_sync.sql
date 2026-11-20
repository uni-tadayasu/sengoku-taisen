CREATE TABLE user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  revoked_at INTEGER
);
--> statement-breakpoint
CREATE INDEX user_sessions_user_idx ON user_sessions(user_id);
--> statement-breakpoint
CREATE TABLE pairing_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX pairing_codes_user_idx ON pairing_codes(user_id);
--> statement-breakpoint
CREATE INDEX pairing_codes_expires_idx ON pairing_codes(expires_at);
--> statement-breakpoint
CREATE TABLE player_saves (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  save_json TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at INTEGER,
  writer_device_id TEXT,
  writer_device_name TEXT,
  lease_expires_at INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE player_presence (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  online INTEGER NOT NULL CHECK (online IN (0,1)),
  last_seen INTEGER NOT NULL,
  PRIMARY KEY(user_id, device_id)
);
--> statement-breakpoint
CREATE INDEX player_presence_active_idx ON player_presence(online,last_seen,user_id);
