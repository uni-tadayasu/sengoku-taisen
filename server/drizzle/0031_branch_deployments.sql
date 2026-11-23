-- Finite troop movements and commander placement have their own receipts;
-- they are not construction orders. Every accepted movement is saved with
-- its per-campaign marker in the same transaction as the exact debit/credit.
CREATE TABLE branch_deployment_requests (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence>=0),
  action TEXT NOT NULL CHECK(action IN ('transfer-troops','assign-commander','remove-commander')),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE troop_transfer_states (
  actor_id TEXT NOT NULL REFERENCES users(id),
  campaign_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK(sequence>=0 AND sequence<=1000000000),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,campaign_id)
);
