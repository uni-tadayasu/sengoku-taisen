-- Keep the original retirement and succession ledgers intact. Cloistering
-- attaches to one verified retirement, and is performed by its holder alone.
CREATE TABLE court_cloistered_emperors (
 user_id TEXT PRIMARY KEY REFERENCES court_retired_emperors(user_id) ON DELETE CASCADE,
 succession_id TEXT NOT NULL UNIQUE REFERENCES court_succession_requests(commit_token),
 ordained_at INTEGER NOT NULL CHECK(ordained_at>=0),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision=1)
);
--> statement-breakpoint
CREATE TABLE court_ordination_requests (
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 succession_id TEXT NOT NULL REFERENCES court_succession_requests(commit_token),
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL UNIQUE,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE VIEW court_retirement_holders AS
SELECT r.user_id,u.name,r.succession_id,r.successor_id,r.retired_at,c.ordained_at,
 CASE WHEN c.user_id IS NULL THEN 'retired-emperor' ELSE 'cloistered-emperor' END AS kind
FROM court_retired_emperors r JOIN users u ON u.id=r.user_id
JOIN court_succession_requests s ON s.commit_token=r.succession_id AND s.actor_id=r.user_id AND s.target_id=r.successor_id
LEFT JOIN court_cloistered_emperors c ON c.user_id=r.user_id AND c.succession_id=r.succession_id
WHERE r.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM court_leader l JOIN staff_members sm ON sm.user_id=l.user_id
  WHERE l.id=1 AND l.user_id=r.user_id AND l.term_id=COALESCE(sm.term_id,'legacy:'||sm.appointed_at));
--> statement-breakpoint
-- Retired and cloistered Emperor are two titles of one shared seat. Ordination
-- changes that holder's title and never opens another retirement seat.
CREATE TRIGGER court_retirement_capacity_insert BEFORE INSERT ON court_retired_emperors
WHEN EXISTS(SELECT 1 FROM court_retirement_holders WHERE user_id<>NEW.user_id)
BEGIN SELECT RAISE(ABORT,'COURT_RETIRED_EMPEROR_OCCUPIED'); END;
--> statement-breakpoint
CREATE TRIGGER court_retirement_capacity_update BEFORE UPDATE ON court_retired_emperors
WHEN (NEW.succession_id<>OLD.succession_id OR NEW.user_id<>OLD.user_id OR NEW.successor_id<>OLD.successor_id)
 AND EXISTS(SELECT 1 FROM court_retirement_holders WHERE user_id<>NEW.user_id)
BEGIN SELECT RAISE(ABORT,'COURT_RETIRED_EMPEROR_OCCUPIED'); END;
--> statement-breakpoint
CREATE TRIGGER court_cloistered_capacity_insert BEFORE INSERT ON court_cloistered_emperors
WHEN EXISTS(SELECT 1 FROM court_retirement_holders WHERE user_id<>NEW.user_id)
BEGIN SELECT RAISE(ABORT,'COURT_CLOISTERED_EMPEROR_OCCUPIED'); END;
--> statement-breakpoint
CREATE TRIGGER court_cloistered_capacity_update BEFORE UPDATE ON court_cloistered_emperors
WHEN EXISTS(SELECT 1 FROM court_retirement_holders WHERE user_id<>NEW.user_id)
BEGIN SELECT RAISE(ABORT,'COURT_CLOISTERED_EMPEROR_OCCUPIED'); END;
--> statement-breakpoint
-- Removing royal ancestry or retained membership invalidates a pending
-- nomination permanently, even if a later operation restores those values.
CREATE TRIGGER court_succession_nomination_lineage_delete AFTER DELETE ON court_lineages
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,'successor_changed')
 WHERE status='pending' AND successor_id=OLD.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_lineage_update AFTER UPDATE OF imperial_house_name ON court_lineages
WHEN COALESCE(NEW.imperial_house_name,'')<>COALESCE(OLD.imperial_house_name,'')
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,'successor_changed')
 WHERE status='pending' AND successor_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_retained_delete AFTER DELETE ON court_retained_memberships
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,'successor_changed')
 WHERE status='pending' AND successor_id=OLD.user_id AND target_staff_term=OLD.term_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_retained_update AFTER UPDATE OF term_id ON court_retained_memberships
WHEN NEW.term_id<>OLD.term_id
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,'successor_changed')
 WHERE status='pending' AND successor_id=OLD.user_id AND target_staff_term=OLD.term_id;
END;
--> statement-breakpoint
-- Older coronations left historical retirement rows in place while the crown
-- hid their title. Retain the immutable history, but do not resurrect an old
-- seat when that later reign is dismissed or replaced. A newly certified
-- abdication is distinguished by the exact outgoing crown token and survives.
CREATE TRIGGER court_retirement_crown_departure BEFORE DELETE ON court_leader
BEGIN
 DELETE FROM court_retired_emperors WHERE user_id=OLD.user_id
  AND NOT EXISTS(SELECT 1 FROM court_succession_requests s WHERE s.commit_token=court_retired_emperors.succession_id
   AND s.actor_id=OLD.user_id AND s.source_appointment_token=OLD.appointment_token);
END;
--> statement-breakpoint
CREATE TRIGGER court_retirement_crown_replacement BEFORE UPDATE OF user_id,term_id,appointment_token ON court_leader
WHEN OLD.user_id<>NEW.user_id OR OLD.term_id<>NEW.term_id OR OLD.appointment_token<>NEW.appointment_token
BEGIN
 DELETE FROM court_retired_emperors WHERE user_id=OLD.user_id
  AND NOT EXISTS(SELECT 1 FROM court_succession_requests s WHERE s.commit_token=court_retired_emperors.succession_id
   AND s.actor_id=OLD.user_id AND s.source_appointment_token=OLD.appointment_token);
END;
--> statement-breakpoint
CREATE TRIGGER court_retirement_coronation_insert AFTER INSERT ON court_leader
BEGIN DELETE FROM court_retired_emperors WHERE user_id=NEW.user_id; END;
--> statement-breakpoint
CREATE TRIGGER court_retirement_coronation_update AFTER UPDATE OF user_id,term_id,appointment_token ON court_leader
BEGIN DELETE FROM court_retired_emperors WHERE user_id=NEW.user_id; END;
--> statement-breakpoint
CREATE TRIGGER court_retirement_staff_term BEFORE UPDATE OF term_id,appointed_at ON staff_members
WHEN COALESCE(OLD.term_id,'legacy:'||OLD.appointed_at)<>COALESCE(NEW.term_id,'legacy:'||NEW.appointed_at)
BEGIN
 DELETE FROM court_retired_emperors WHERE user_id=OLD.user_id
  AND EXISTS(SELECT 1 FROM court_leader l WHERE l.user_id=OLD.user_id)
  AND NOT EXISTS(SELECT 1 FROM court_leader l JOIN court_succession_requests s ON s.source_appointment_token=l.appointment_token
   WHERE l.user_id=OLD.user_id AND s.commit_token=court_retired_emperors.succession_id AND s.actor_id=OLD.user_id);
END;
--> statement-breakpoint
-- A currently reigning Emperor's inactive old seat does not claim the shared
-- retirement capacity. Historical succession receipts remain immutable.
DELETE FROM court_retired_emperors WHERE EXISTS(SELECT 1 FROM court_leader l JOIN staff_members sm ON sm.user_id=l.user_id
 WHERE l.id=1 AND l.user_id=court_retired_emperors.user_id AND l.term_id=COALESCE(sm.term_id,'legacy:'||sm.appointed_at));
--> statement-breakpoint
-- The one-seat rule also applies when upgrading an older multi-retiree world.
-- Keep the earliest verified holder, using user_id to resolve equal times.
-- Later former Emperors return to imperial-family status through their intact
-- succession history; lineages, campaigns, assets and receipts are untouched.
DELETE FROM court_retired_emperors WHERE user_id IN (
 SELECT user_id FROM court_retirement_holders ORDER BY retired_at,user_id LIMIT -1 OFFSET 1
);
