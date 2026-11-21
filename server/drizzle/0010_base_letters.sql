CREATE TABLE base_letter_threads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('player','guild')),
  user_a TEXT REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT REFERENCES users(id) ON DELETE CASCADE,
  sender_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  guild_id TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  context_player_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  CHECK((kind='player' AND user_a IS NOT NULL AND user_b IS NOT NULL AND user_a<user_b AND sender_id IS NULL AND guild_id IS NULL)
    OR (kind='guild' AND user_a IS NULL AND user_b IS NULL AND sender_id IS NOT NULL AND guild_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX base_letter_player_pair ON base_letter_threads(user_a,user_b) WHERE kind='player';
--> statement-breakpoint
CREATE UNIQUE INDEX base_letter_guild_sender ON base_letter_threads(guild_id,sender_id) WHERE kind='guild';
--> statement-breakpoint
CREATE INDEX base_letter_threads_updated ON base_letter_threads(updated_at DESC,id DESC);
--> statement-breakpoint
CREATE TABLE base_letter_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL REFERENCES base_letter_threads(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX base_letter_messages_thread ON base_letter_messages(thread_id,seq);
--> statement-breakpoint
CREATE TABLE base_letter_requests (
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE base_letter_reads (
  thread_id TEXT NOT NULL REFERENCES base_letter_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK(last_seq>=0),
  read_at INTEGER NOT NULL,
  PRIMARY KEY(thread_id,user_id)
);
