-- New applications require the current Emperor's approval. Existing opened
-- governments have no row here and retain their historical opening unchanged.
CREATE TABLE shogunate_approvals (
 right_id TEXT PRIMARY KEY REFERENCES shogunate_rights(id),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','expired')),
 requested_at INTEGER NOT NULL CHECK(requested_at>=0),
 deadline_at INTEGER NOT NULL CHECK(deadline_at=requested_at+259200000),
 resolved_at INTEGER,
 approved_by TEXT REFERENCES users(id),
 commit_token TEXT,
 updated_at INTEGER NOT NULL,
 CHECK((status='pending' AND resolved_at IS NULL AND approved_by IS NULL)
   OR (status='approved' AND resolved_at>=requested_at AND resolved_at<deadline_at AND approved_by IS NOT NULL)
   OR (status='expired' AND resolved_at=deadline_at AND approved_by IS NULL))
);
--> statement-breakpoint
CREATE INDEX shogunate_approvals_due ON shogunate_approvals(status,deadline_at,right_id);
--> statement-breakpoint
CREATE TABLE shogunate_approval_requests (
 actor_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 right_id TEXT NOT NULL REFERENCES shogunate_rights(id),
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL,
 result_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,request_id),
 UNIQUE(right_id)
);
--> statement-breakpoint
-- Political sovereignty is shared and server-owned. It never grants operator
-- or staff privileges, replaces the staff base, or rewrites personal saves.
CREATE TABLE shogunate_palace_control (
 castle_id TEXT PRIMARY KEY CHECK(castle_id='kyoto_gosho'),
 right_id TEXT NOT NULL REFERENCES shogunate_rights(id),
 controller_id TEXT NOT NULL REFERENCES users(id),
 government_name TEXT NOT NULL,
 controlled_at INTEGER NOT NULL CHECK(controlled_at>=0)
);
