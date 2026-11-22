CREATE TABLE IF NOT EXISTS shogunate_rights (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 source_type TEXT NOT NULL CHECK(source_type IN ('campaign','event','conquest')),
 source_id TEXT NOT NULL,
 title TEXT NOT NULL,
 battle_id TEXT,
 earned_at INTEGER NOT NULL,
 opened_at INTEGER,
 government_name TEXT,
 opened_request_id TEXT,
 UNIQUE(user_id,source_type,source_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shogunate_rights_user_idx ON shogunate_rights(user_id,earned_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS shogunate_requests (
 user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 right_id TEXT NOT NULL REFERENCES shogunate_rights(id),
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL,
 result_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,request_id),
 UNIQUE(right_id)
);
