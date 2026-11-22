-- Keep the membership term even after departure. A leave/rejoin in the same
-- millisecond must not restore an existing WebRTC signaling capability.
CREATE TABLE voice_membership_epochs (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 epoch INTEGER NOT NULL CHECK(epoch>0)
);
--> statement-breakpoint
INSERT INTO voice_membership_epochs(user_id,epoch) SELECT user_id,1 FROM guild_members;
--> statement-breakpoint
CREATE TRIGGER voice_guild_join AFTER INSERT ON guild_members BEGIN
 INSERT INTO voice_membership_epochs(user_id,epoch) VALUES(NEW.user_id,1)
 ON CONFLICT(user_id) DO UPDATE SET epoch=voice_membership_epochs.epoch+1;
END;
--> statement-breakpoint
CREATE TRIGGER voice_guild_leave AFTER DELETE ON guild_members BEGIN
 UPDATE voice_membership_epochs SET epoch=epoch+1 WHERE user_id=OLD.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER voice_guild_move AFTER UPDATE OF guild_id,joined_at ON guild_members BEGIN
 UPDATE voice_membership_epochs SET epoch=epoch+1 WHERE user_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TABLE voice_sessions (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 room_key TEXT NOT NULL,
 channel TEXT NOT NULL CHECK(channel IN ('guild','admin')),
 guild_id TEXT,
 membership_epoch INTEGER NOT NULL,
 moderation_epoch INTEGER NOT NULL,
 is_admin INTEGER NOT NULL CHECK(is_admin IN (0,1)),
 staff_term TEXT NOT NULL,
 muted INTEGER NOT NULL CHECK(muted IN (0,1)),
 joined_at INTEGER NOT NULL,
 last_seen INTEGER NOT NULL,
 lease_until INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX voice_sessions_room ON voice_sessions(room_key,lease_until,joined_at,id);
--> statement-breakpoint
CREATE INDEX voice_sessions_expiry ON voice_sessions(lease_until,id);
--> statement-breakpoint
-- No session foreign key: replacing a user's call changes its opaque ID and
-- must never retarget any pending signals to the replacement session.
CREATE TABLE voice_signals (
 id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
 room_key TEXT NOT NULL,
 from_session_id TEXT NOT NULL,
 to_session_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('offer','answer','ice')),
 payload_json TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged IN (0,1)),
 UNIQUE(from_session_id,to_session_id,kind,payload_hash)
);
--> statement-breakpoint
CREATE INDEX voice_signals_recipient ON voice_signals(to_session_id,id);
--> statement-breakpoint
CREATE INDEX voice_signals_expiry ON voice_signals(created_at,id);
