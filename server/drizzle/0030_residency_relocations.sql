-- A retired campaign cannot be uploaded after returning to its former seat.
CREATE TABLE castle_retired_campaigns (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY(actor_id,campaign_id),
  FOREIGN KEY(actor_id,request_id) REFERENCES castle_residency_requests(actor_id,request_id)
);
--> statement-breakpoint
-- Soldiers already committed to another commander's rally still participate,
-- but that retired personal campaign cannot collect the survivors a second time.
ALTER TABLE alliance_units ADD COLUMN campaign_retired INTEGER NOT NULL DEFAULT 0 CHECK(campaign_retired IN (0,1));
