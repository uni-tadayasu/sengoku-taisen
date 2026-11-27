-- Shared playback starts OFF. This migration does not alter any player data.
CREATE TABLE music_broadcast_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  mode TEXT NOT NULL DEFAULT 'loop' CHECK(mode IN ('loop','continuous')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  started_at INTEGER,
  updated_at INTEGER,
  CHECK((enabled=0 AND started_at IS NULL) OR (enabled=1 AND started_at IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO music_broadcast_state(id,enabled,mode,revision) VALUES(1,0,'loop',0);
--> statement-breakpoint
CREATE TABLE music_broadcast_requests (
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  applied_revision INTEGER NOT NULL CHECK(applied_revision>=0),
  changed INTEGER NOT NULL CHECK(changed IN (0,1)),
  created_at INTEGER NOT NULL,
  commit_token TEXT NOT NULL,
  PRIMARY KEY(user_id,request_id)
);
