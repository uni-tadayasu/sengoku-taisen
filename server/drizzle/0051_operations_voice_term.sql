-- Preserve existing call records; a deputy's term is checked on every signal.
ALTER TABLE voice_sessions ADD COLUMN deputy_term TEXT NOT NULL DEFAULT '';
