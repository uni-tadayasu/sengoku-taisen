ALTER TABLE player_saves ADD COLUMN cycle_index INTEGER;
--> statement-breakpoint
ALTER TABLE player_saves ADD COLUMN cycle_home TEXT;
--> statement-breakpoint
ALTER TABLE player_saves ADD COLUMN cycle_commit TEXT;
--> statement-breakpoint
CREATE TABLE cycle_receipts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cycle_index INTEGER NOT NULL CHECK(cycle_index >= 0),
  captured INTEGER NOT NULL CHECK(captured BETWEEN 0 AND 127),
  gold INTEGER NOT NULL,
  rice INTEGER NOT NULL,
  magatama INTEGER NOT NULL,
  commit_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,cycle_index)
);
--> statement-breakpoint
CREATE TABLE achievement_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT,
  target_name TEXT,
  value INTEGER,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  UNIQUE(user_id,event_key)
);
--> statement-breakpoint
CREATE INDEX achievement_events_time_idx ON achievement_events(occurred_at DESC,id DESC);
