CREATE TABLE staff_members (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  appointed_by TEXT NOT NULL REFERENCES users(id),
  appointed_at INTEGER NOT NULL,
  CHECK (user_id <> appointed_by)
);
--> statement-breakpoint
CREATE TABLE staff_role_requests (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('appoint','dismiss')),
  commit_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id),
  CHECK (actor_id <> target_id)
);
