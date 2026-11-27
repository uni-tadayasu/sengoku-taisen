-- Schema only. Keep account IDs, names and history. New sanctions release
-- their reservation atomically. Pre-existing sanctions are reconciled by the
-- requested name's indexed claim transaction, without a bulk data migration.
CREATE TRIGGER player_ban_release_name_insert AFTER INSERT ON player_bans
WHEN NEW.active=1
BEGIN
 UPDATE users SET name_key=char(1)||'released:'||id WHERE id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER player_ban_release_name_update AFTER UPDATE OF active ON player_bans
WHEN NEW.active=1
BEGIN
 UPDATE users SET name_key=char(1)||'released:'||id WHERE id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER player_expulsion_release_name_insert AFTER INSERT ON player_expulsions
WHEN NEW.pending=1
BEGIN
 UPDATE users SET name_key=char(1)||'released:'||id WHERE id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER player_expulsion_release_name_update AFTER UPDATE OF pending ON player_expulsions
WHEN NEW.pending=1
BEGIN
 UPDATE users SET name_key=char(1)||'released:'||id WHERE id=NEW.user_id;
END;
--> statement-breakpoint
-- Old tabs/Workers must not reserve an expelled player's display name again.
-- Restoration explicitly claims a name after both inactive states are clear,
-- in the same transaction as unban/readmission. UNIQUE still arbitrates claims.
CREATE TRIGGER moderated_player_name_stays_released AFTER UPDATE OF name_key ON users
WHEN NEW.name_key<>char(1)||'released:'||NEW.id AND (
 EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=NEW.id AND b.active=1)
 OR EXISTS(SELECT 1 FROM player_expulsions e WHERE e.user_id=NEW.id AND e.pending=1)
)
BEGIN
 UPDATE users SET name_key=char(1)||'released:'||id WHERE id=NEW.id;
END;
