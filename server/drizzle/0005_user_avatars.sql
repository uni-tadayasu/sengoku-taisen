CREATE TABLE user_avatars (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version TEXT NOT NULL CHECK (length(version) = 64 AND version NOT GLOB '*[^0-9a-f]*'),
  object_key TEXT NOT NULL UNIQUE CHECK (length(object_key) BETWEEN 1 AND 200),
  content_type TEXT NOT NULL CHECK (content_type = 'image/jpeg'),
  byte_length INTEGER NOT NULL CHECK (byte_length BETWEEN 1 AND 49152),
  updated_at INTEGER NOT NULL
);
