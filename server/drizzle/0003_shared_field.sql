CREATE TABLE field_requests (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('attack','diplomacy')),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE field_relations (
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','allied','rejected','cancelled')),
  proposed_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_elapsed_ms INTEGER NOT NULL CHECK (expires_elapsed_ms >= 0),
  updated_elapsed_ms INTEGER NOT NULL CHECK (updated_elapsed_ms >= 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_a,user_b),
  CHECK (user_a < user_b),
  CHECK (proposed_by = user_a OR proposed_by = user_b)
);
--> statement-breakpoint
CREATE INDEX field_relations_b_idx ON field_relations(user_b,expires_elapsed_ms);
--> statement-breakpoint
CREATE TABLE field_battles (
  id TEXT PRIMARY KEY,
  attacker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  defender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  occurred_elapsed_ms INTEGER NOT NULL CHECK (occurred_elapsed_ms >= 0),
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (attacker_id <> defender_id)
);
--> statement-breakpoint
CREATE INDEX field_battles_attacker_idx ON field_battles(attacker_id,occurred_elapsed_ms DESC);
--> statement-breakpoint
CREATE INDEX field_battles_defender_idx ON field_battles(defender_id,occurred_elapsed_ms DESC);
