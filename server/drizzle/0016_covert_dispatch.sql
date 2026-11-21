CREATE TABLE covert_states (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence>=0),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,campaign_id)
);
--> statement-breakpoint
CREATE TABLE covert_requests (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence>=0),
  action TEXT NOT NULL CHECK(action IN ('hire','dispatch','recall','retaliate')),
  incident_id TEXT,
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id),
  UNIQUE(actor_id,campaign_id,sequence)
);
--> statement-breakpoint
CREATE UNIQUE INDEX covert_incident_once_idx ON covert_requests(actor_id,incident_id) WHERE incident_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX covert_requests_history_idx ON covert_requests(actor_id,created_at DESC);
--> statement-breakpoint
CREATE TABLE covert_battles (
  id TEXT PRIMARY KEY,
  attacker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  defender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_elapsed_ms INTEGER NOT NULL CHECK(occurred_elapsed_ms>=0),
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK(attacker_id<>defender_id)
);
--> statement-breakpoint
CREATE INDEX covert_battles_defender_idx ON covert_battles(defender_id,occurred_elapsed_ms DESC);
--> statement-breakpoint
CREATE INDEX covert_battles_attacker_idx ON covert_battles(attacker_id,occurred_elapsed_ms DESC);
--> statement-breakpoint
ALTER TABLE field_battles ADD COLUMN defender_campaign_id TEXT;
--> statement-breakpoint
CREATE TABLE covert_incidents (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  incident_id TEXT NOT NULL,
  source_castle_id TEXT NOT NULL,
  occurred_elapsed_ms INTEGER NOT NULL CHECK(occurred_elapsed_ms>=0),
  station_sequence INTEGER NOT NULL CHECK(station_sequence>=0),
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,campaign_id,incident_id)
);
--> statement-breakpoint
CREATE INDEX covert_incidents_history_idx ON covert_incidents(actor_id,campaign_id,occurred_elapsed_ms DESC);
