-- The receipt is also the retirement marker for the relinquished campaign.
-- Existing Kyoto appointments and their return backups are left unchanged.
CREATE TABLE court_membership_requests (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  source_campaign_id TEXT NOT NULL,
  source_home TEXT NOT NULL,
  released_castle_count INTEGER NOT NULL CHECK(released_castle_count>=1),
  term_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id),
  UNIQUE(actor_id,source_campaign_id)
);
