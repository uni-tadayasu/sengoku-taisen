-- A voluntary release is a server-authorized ownership change. Its receipt is
-- independent of campaign saves so an old response can be recovered safely.
CREATE TABLE field_release_requests (
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 campaign_id TEXT NOT NULL,
 castle_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL UNIQUE,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
