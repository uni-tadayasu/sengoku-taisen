CREATE TABLE timed_events (
  id TEXT PRIMARY KEY NOT NULL,
  creator_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days BETWEEN 1 AND 7),
  status TEXT NOT NULL CHECK (status IN ('draft','active','ended','discarded')),
  plan_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  starts_at INTEGER,
  ends_at INTEGER,
  ended_at INTEGER,
  CHECK ((status IN ('draft','discarded') AND starts_at IS NULL AND ends_at IS NULL AND ended_at IS NULL)
    OR (status IN ('active','ended') AND starts_at IS NOT NULL AND ends_at=starts_at+duration_days*86400000))
);
--> statement-breakpoint
CREATE INDEX timed_events_status_time_idx ON timed_events(status,ends_at,starts_at);
--> statement-breakpoint
CREATE TABLE timed_event_requests (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('generate','publish','end','discard','battle')),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor_id,request_id)
);
--> statement-breakpoint
CREATE INDEX timed_event_requests_quota_idx ON timed_event_requests(event_id,actor_id,action,created_at);
--> statement-breakpoint
CREATE TABLE timed_event_participants (
  event_id TEXT NOT NULL REFERENCES timed_events(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  battles INTEGER NOT NULL DEFAULT 0 CHECK (battles >= wins),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id,user_id)
);
--> statement-breakpoint
CREATE INDEX timed_event_participants_ranking_idx ON timed_event_participants(event_id,points DESC,wins DESC,updated_at,user_id);
--> statement-breakpoint
CREATE TABLE timed_event_rewards (
  event_id TEXT NOT NULL REFERENCES timed_events(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  milestone_id TEXT NOT NULL,
  mail_id TEXT NOT NULL UNIQUE REFERENCES mail_campaigns(id),
  request_id TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY (event_id,user_id,milestone_id)
);
