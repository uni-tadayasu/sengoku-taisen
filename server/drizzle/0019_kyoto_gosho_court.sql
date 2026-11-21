-- Move only the shared palace identity. Personal campaign backups, resources,
-- revision numbers, completed levels and the work queue retain their values.
CREATE TABLE staff_base_gosho (
  id TEXT PRIMARY KEY CHECK(id='kyoto_gosho'),
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  commit_token TEXT,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO staff_base_gosho(id,state_json,revision,commit_token,updated_at)
SELECT 'kyoto_gosho',json_set(state_json,
  '$.jobs',json(COALESCE((SELECT json_group_array(json(CASE WHEN json_extract(j.value,'$.kind')='castle' AND json_extract(j.value,'$.id')='sunpu' THEN json_set(j.value,'$.id','kyoto_gosho') ELSE j.value END)) FROM json_each(state_json,'$.jobs') j),'[]')),
  '$.history',json(COALESCE((SELECT json_group_array(json(CASE WHEN json_extract(j.value,'$.kind')='castle' AND json_extract(j.value,'$.id')='sunpu' THEN json_set(j.value,'$.id','kyoto_gosho') ELSE j.value END)) FROM json_each(state_json,'$.history') j),'[]'))
),revision,commit_token,updated_at FROM staff_base;
--> statement-breakpoint
DROP TABLE staff_base;
--> statement-breakpoint
ALTER TABLE staff_base_gosho RENAME TO staff_base;
--> statement-breakpoint
UPDATE staff_base_requests SET result_json=json_set(result_json,'$.id','kyoto_gosho')
WHERE json_extract(result_json,'$.kind')='castle' AND json_extract(result_json,'$.id')='sunpu';
--> statement-breakpoint
-- A CPU incident records the dispatch source, not its destination. Preserve
-- unspent incidents when the old staff source is relocated to the palace.
UPDATE covert_incidents SET source_castle_id='kyoto_gosho',result_json=json_set(result_json,'$.sourceCastleId','kyoto_gosho')
WHERE source_castle_id='sunpu';
--> statement-breakpoint
CREATE TABLE court_contributions (
  job_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  staff_term TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('building','castle')),
  target_id TEXT NOT NULL,
  target_level INTEGER NOT NULL CHECK(target_level BETWEEN 1 AND 128),
  points INTEGER NOT NULL CHECK(points=target_level),
  completed_elapsed_ms INTEGER NOT NULL CHECK(completed_elapsed_ms>=0),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX court_contributions_actor ON court_contributions(actor_id,completed_elapsed_ms,job_id);
--> statement-breakpoint
-- A queued/accepted request alone proves no completed work. Backfill only a
-- matching completed history event and its original accepted request receipt.
INSERT INTO court_contributions(job_id,actor_id,staff_term,kind,target_id,target_level,points,completed_elapsed_ms,created_at)
SELECT json_extract(h.value,'$.jobId'),r.actor_id,json_extract(r.result_json,'$.staffTerm'),
  json_extract(h.value,'$.kind'),json_extract(h.value,'$.id'),json_extract(h.value,'$.level'),json_extract(h.value,'$.level'),json_extract(h.value,'$.effectiveElapsedMs'),r.created_at
FROM staff_base b,json_each(b.state_json,'$.history') h JOIN staff_base_requests r
  ON json_extract(r.result_json,'$.jobId')=json_extract(h.value,'$.jobId')
WHERE json_extract(h.value,'$.kind') IN ('building','castle')
  AND json_extract(h.value,'$.kind')=json_extract(r.result_json,'$.kind')
  AND json_extract(h.value,'$.id')=json_extract(r.result_json,'$.id')
  AND json_type(h.value,'$.level')='integer' AND json_extract(h.value,'$.level')=json_extract(r.result_json,'$.targetLevel')
  AND json_extract(h.value,'$.level') BETWEEN 1 AND CASE WHEN json_extract(h.value,'$.kind')='castle' THEN 128 ELSE 32 END
  AND json_type(h.value,'$.effectiveElapsedMs')='integer' AND json_extract(h.value,'$.effectiveElapsedMs')>=0
  AND json_extract(h.value,'$.effectiveElapsedMs')=json_extract(r.result_json,'$.completesElapsedMs')
ON CONFLICT(job_id) DO NOTHING;
--> statement-breakpoint
CREATE TABLE court_leader (
  id INTEGER PRIMARY KEY CHECK(id=1),
  user_id TEXT NOT NULL REFERENCES staff_members(user_id) ON DELETE CASCADE,
  term_id TEXT NOT NULL,
  appointment_token TEXT NOT NULL,
  appointed_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE court_chat (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL REFERENCES users(id),
  author_kind TEXT NOT NULL CHECK(author_kind IN ('visitor','court')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX court_chat_author ON court_chat(author_id,seq);
--> statement-breakpoint
CREATE TABLE court_audience_threads (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','answered')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX court_audience_requester ON court_audience_threads(requester_id,updated_at,id);
--> statement-breakpoint
CREATE TABLE court_audience_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL REFERENCES court_audience_threads(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  author_kind TEXT NOT NULL CHECK(author_kind IN ('visitor','court')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX court_audience_messages_thread ON court_audience_messages(thread_id,seq);
--> statement-breakpoint
CREATE INDEX court_audience_messages_author ON court_audience_messages(author_id,seq);
--> statement-breakpoint
CREATE TABLE court_requests (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('chat','audience','reply','leader')),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  entity_id TEXT,
  message_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
