-- New formal service starts at Sangi. Existing Kyoto service keeps its earned
-- progression until its current term ends; no player data is rewritten here.
CREATE TABLE court_rank_terms (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 term_id TEXT NOT NULL,
 started_at INTEGER NOT NULL CHECK(started_at>=0)
);
--> statement-breakpoint
CREATE INDEX court_contributions_term ON court_contributions(actor_id,staff_term);
--> statement-breakpoint
CREATE VIEW court_rank_progress AS
SELECT membership.user_id,membership.term_id,membership.is_staff,
 COALESCE((SELECT SUM(c.points) FROM court_contributions c WHERE c.actor_id=membership.user_id
  AND (membership.legacy_service=1 OR c.staff_term=membership.term_id)),0) AS merit,
 (SELECT COUNT(*) FROM court_contributions c WHERE c.actor_id=membership.user_id
  AND (membership.legacy_service=1 OR c.staff_term=membership.term_id)) AS completed
FROM (
 SELECT u.id AS user_id,COALESCE(cm.term_id,sm.term_id,'legacy:'||sm.appointed_at) AS term_id,
  CASE WHEN sm.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_staff,
  CASE WHEN cm.user_id IS NULL AND NOT EXISTS(SELECT 1 FROM court_rank_terms rt
   WHERE rt.user_id=u.id AND rt.term_id=COALESCE(sm.term_id,'legacy:'||sm.appointed_at)) THEN 1 ELSE 0 END AS legacy_service
 FROM users u JOIN (SELECT user_id FROM staff_members UNION SELECT user_id FROM court_retained_memberships) members ON members.user_id=u.id
 LEFT JOIN staff_members sm ON sm.user_id=u.id LEFT JOIN court_retained_memberships cm ON cm.user_id=u.id
) membership;
--> statement-breakpoint
DROP VIEW court_estate_current;
--> statement-breakpoint
DROP VIEW court_external_offices;
--> statement-breakpoint
DROP VIEW court_kyoto_offices;
--> statement-breakpoint
CREATE VIEW court_kyoto_offices AS
SELECT user_id,CASE WHEN emperor=1 THEN 'emperor'
 WHEN merit>=2000 THEN 'sadaijin' WHEN merit>=1000 THEN 'udaijin'
 WHEN merit>=500 THEN 'naidaijin' WHEN merit>=200 THEN 'dainagon'
 WHEN merit>=50 THEN 'chunagon' ELSE 'sangi' END AS office_id
FROM (
 SELECT p.user_id,p.merit,EXISTS(SELECT 1 FROM court_leader l JOIN staff_members sm ON sm.user_id=l.user_id
  WHERE l.id=1 AND l.user_id=p.user_id AND l.term_id=COALESCE(sm.term_id,'legacy:'||sm.appointed_at)) AS emperor
 FROM court_rank_progress p
 WHERE p.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
  AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=p.user_id AND b.active=1)
) ranked
WHERE emperor=1 OR (NOT EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=ranked.user_id)
 AND NOT EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=ranked.user_id));
--> statement-breakpoint
CREATE VIEW court_external_offices AS
SELECT a.* FROM court_office_appointments a JOIN player_saves ps ON ps.user_id=a.user_id
WHERE NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=a.user_id)
 AND NOT EXISTS(SELECT 1 FROM court_retained_memberships cm WHERE cm.user_id=a.user_id)
 AND a.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=a.user_id AND b.active=1)
 AND NOT EXISTS(SELECT 1 FROM court_kyoto_offices k WHERE k.office_id=a.office_id)
 AND NOT EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=a.user_id)
 AND NOT EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=a.user_id)
 AND (CASE WHEN json_valid(ps.save_json) THEN json_extract(ps.save_json,'$.state.home') END) NOT IN ('edo','kyoto_gosho');
--> statement-breakpoint
CREATE VIEW court_estate_current AS
SELECT u.id AS user_id,
 CASE WHEN EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=u.id)
  THEN 'regent:'||(SELECT appointment_token FROM court_regent g WHERE g.id=1 AND g.user_id=u.id)
 WHEN EXISTS(SELECT 1 FROM court_retained_memberships cm WHERE cm.user_id=u.id)
  THEN 'member:'||(SELECT term_id FROM court_retained_memberships cm WHERE cm.user_id=u.id)
 WHEN EXISTS(SELECT 1 FROM court_external_offices o WHERE o.user_id=u.id)
  THEN 'office:'||(SELECT office_id||':'||appointment_token FROM court_external_offices o WHERE o.user_id=u.id)
 ELSE 'retired:'||(SELECT r.succession_id FROM court_retired_emperors r JOIN court_succession_requests s ON s.commit_token=r.succession_id AND s.actor_id=r.user_id AND s.target_id=r.successor_id WHERE r.user_id=u.id) END AS authority_key
FROM users u JOIN (SELECT user_id FROM court_regent UNION SELECT user_id FROM court_office_appointments UNION SELECT user_id FROM court_retired_emperors UNION SELECT user_id FROM court_retained_memberships) candidates ON candidates.user_id=u.id
WHERE u.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1)
 AND NOT EXISTS(SELECT 1 FROM player_expulsions e WHERE e.user_id=u.id AND e.pending=1)
 AND (EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=u.id)
  OR EXISTS(SELECT 1 FROM court_retained_memberships cm WHERE cm.user_id=u.id)
  OR EXISTS(SELECT 1 FROM court_external_offices o WHERE o.user_id=u.id)
  OR EXISTS(SELECT 1 FROM court_retired_emperors r JOIN court_succession_requests s ON s.commit_token=r.succession_id AND s.actor_id=r.user_id AND s.target_id=r.successor_id WHERE r.user_id=u.id));
--> statement-breakpoint
-- Mark the term before invalidating external seats, so old merit can never
-- remove a higher appointment as a side effect of a new Sangi admission.
DROP TRIGGER court_office_staff_insert;
--> statement-breakpoint
CREATE TRIGGER court_office_staff_insert AFTER INSERT ON staff_members
BEGIN
 INSERT INTO court_rank_terms(user_id,term_id,started_at) VALUES(NEW.user_id,COALESCE(NEW.term_id,'legacy:'||NEW.appointed_at),NEW.appointed_at)
  ON CONFLICT(user_id) DO UPDATE SET term_id=excluded.term_id,started_at=excluded.started_at;
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
  OR user_id IN (SELECT user_id FROM court_retained_memberships)
  OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
  OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
DROP TRIGGER court_office_staff_update;
--> statement-breakpoint
CREATE TRIGGER court_office_staff_update AFTER UPDATE ON staff_members
BEGIN
 INSERT INTO court_rank_terms(user_id,term_id,started_at)
  SELECT NEW.user_id,COALESCE(NEW.term_id,'legacy:'||NEW.appointed_at),NEW.appointed_at
  WHERE COALESCE(NEW.term_id,'legacy:'||NEW.appointed_at)<>COALESCE(OLD.term_id,'legacy:'||OLD.appointed_at)
  ON CONFLICT(user_id) DO UPDATE SET term_id=excluded.term_id,started_at=excluded.started_at;
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
  OR user_id IN (SELECT user_id FROM court_retained_memberships)
  OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
  OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_retained_insert AFTER INSERT ON court_retained_memberships
BEGIN
 INSERT INTO court_rank_terms(user_id,term_id,started_at) VALUES(NEW.user_id,NEW.term_id,NEW.joined_at)
  ON CONFLICT(user_id) DO UPDATE SET term_id=excluded.term_id,started_at=excluded.started_at;
 DELETE FROM court_office_appointments WHERE user_id=NEW.user_id OR office_id IN (SELECT office_id FROM court_kyoto_offices);
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_retained_update AFTER UPDATE ON court_retained_memberships
BEGIN
 INSERT INTO court_rank_terms(user_id,term_id,started_at)
  SELECT NEW.user_id,NEW.term_id,NEW.joined_at WHERE NEW.term_id<>OLD.term_id
  ON CONFLICT(user_id) DO UPDATE SET term_id=excluded.term_id,started_at=excluded.started_at;
 DELETE FROM court_office_appointments WHERE user_id=NEW.user_id OR office_id IN (SELECT office_id FROM court_kyoto_offices);
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_retained_delete AFTER DELETE ON court_retained_memberships
BEGIN
 DELETE FROM court_office_appointments WHERE user_id=OLD.user_id OR office_id IN (SELECT office_id FROM court_kyoto_offices);
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
-- Existing retained members may have pre-migration external seats. Every
-- source of the formal office projection retires obsolete rows against its
-- old state before a transition; canonical AFTER triggers handle the new state.
-- This covers promotions, term changes, BAN, regency, retirement, coronation
-- and operator changes without rewriting any rows during schema deployment.
CREATE TRIGGER court_rank_merit_insert BEFORE INSERT ON court_contributions
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_merit_update BEFORE UPDATE ON court_contributions
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_merit_delete BEFORE DELETE ON court_contributions
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_staff_insert BEFORE INSERT ON staff_members
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_staff_update BEFORE UPDATE ON staff_members
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_staff_delete BEFORE DELETE ON staff_members
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_retained_insert BEFORE INSERT ON court_retained_memberships
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_retained_update BEFORE UPDATE ON court_retained_memberships
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_retained_delete BEFORE DELETE ON court_retained_memberships
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_ban_insert BEFORE INSERT ON player_bans
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_ban_update BEFORE UPDATE ON player_bans
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_ban_delete BEFORE DELETE ON player_bans
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_regent_insert BEFORE INSERT ON court_regent
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_regent_update BEFORE UPDATE ON court_regent
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_regent_delete BEFORE DELETE ON court_regent
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_retirement_insert BEFORE INSERT ON court_retired_emperors
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_retirement_update BEFORE UPDATE ON court_retired_emperors
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_retirement_delete BEFORE DELETE ON court_retired_emperors
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_leader_insert BEFORE INSERT ON court_leader
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_leader_update BEFORE UPDATE ON court_leader
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_leader_delete BEFORE DELETE ON court_leader
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_operator_insert BEFORE INSERT ON settings WHEN NEW.key='adminUserId'
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_operator_update BEFORE UPDATE ON settings WHEN NEW.key='adminUserId' OR OLD.key='adminUserId'
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
--> statement-breakpoint
CREATE TRIGGER court_rank_operator_delete BEFORE DELETE ON settings WHEN OLD.key='adminUserId'
BEGIN
 DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM court_retained_memberships)
  OR office_id IN (SELECT office_id FROM court_kyoto_offices);
END;
