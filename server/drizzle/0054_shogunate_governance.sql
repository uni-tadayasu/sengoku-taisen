-- Account-owned government development and immutable, exactly-once actions.
-- No existing lord, court office, save, opening or ownership is modified.
CREATE TABLE shogunate_governance_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
  commit_token TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE shogunate_governance_requests (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('policy','project','duty','milestone')),
  request_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id),
  UNIQUE(actor_id,claim_key)
);
--> statement-breakpoint
CREATE INDEX shogunate_governance_history ON shogunate_governance_requests(actor_id,created_at DESC,request_id DESC);
