-- Branch defenses and their work queue are authoritative per player/campaign.
-- Imported saves cannot erase intact defenses or revive a fallen branch.
CREATE TABLE branch_states (
  actor_id TEXT NOT NULL REFERENCES users(id),
  campaign_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence>=0),
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  resolved_elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK(resolved_elapsed_ms>=0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,campaign_id)
);
--> statement-breakpoint
CREATE TABLE branch_requests (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence>=0),
  action TEXT NOT NULL CHECK(action IN ('build','upgrade','repair')),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
