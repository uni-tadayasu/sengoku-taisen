-- The court room shares the canonical battle/reward event rows. Its private
-- briefs and operation receipts stay separate from all public event DTOs.
CREATE TABLE court_event_room_events (
  event_id TEXT PRIMARY KEY NOT NULL REFERENCES timed_events(id),
  generation_mode TEXT NOT NULL CHECK (generation_mode IN ('template','ai')),
  template_id TEXT NOT NULL,
  source_json TEXT NOT NULL CHECK (json_valid(source_json)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX court_event_room_events_created_idx ON court_event_room_events(created_at DESC,event_id);
--> statement-breakpoint
CREATE TABLE court_event_room_requests (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('generate','publish','end','discard')),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL UNIQUE,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor_id,request_id)
);
--> statement-breakpoint
CREATE INDEX court_event_room_requests_event_idx ON court_event_room_requests(event_id,created_at);
