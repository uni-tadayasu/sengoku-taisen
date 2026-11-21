CREATE TABLE roaming_deployment (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL CHECK(revision>=1),
  total_troops INTEGER NOT NULL CHECK(total_troops>=0 AND total_troops<=20000000),
  squad_size INTEGER NOT NULL CHECK(squad_size>=300 AND squad_size<=20000),
  respawn_seconds INTEGER NOT NULL CHECK(respawn_seconds>=60 AND respawn_seconds<=3600),
  updated_at INTEGER NOT NULL,
  CHECK((total_troops+squad_size-1)/squad_size<=4096)
);
--> statement-breakpoint
INSERT INTO roaming_deployment(id,revision,total_troops,squad_size,respawn_seconds,updated_at)
VALUES(1,1,384000,1000,300,0);
--> statement-breakpoint
CREATE TABLE roaming_deployment_proposals (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id),
  requester_term TEXT NOT NULL,
  base_revision INTEGER NOT NULL CHECK(base_revision>=1),
  config_json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled','superseded')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES users(id),
  applied_revision INTEGER
);
--> statement-breakpoint
CREATE INDEX roaming_deployment_proposals_owner_idx ON roaming_deployment_proposals(requester_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX roaming_deployment_proposals_status_idx ON roaming_deployment_proposals(status,created_at DESC);
--> statement-breakpoint
CREATE TABLE roaming_deployment_requests (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('apply','propose','approve','reject','cancel')),
  proposal_id TEXT,
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE roaming_unit_cooldowns (
  deployment_revision INTEGER NOT NULL,
  unit_id TEXT NOT NULL,
  castle_id TEXT NOT NULL,
  respawn_at INTEGER NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  PRIMARY KEY(deployment_revision,unit_id)
);
--> statement-breakpoint
CREATE INDEX roaming_unit_cooldowns_castle_idx ON roaming_unit_cooldowns(deployment_revision,castle_id,respawn_at);
