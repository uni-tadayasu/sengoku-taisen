-- The regency is a court appointment independent of staff membership and home.
CREATE TABLE court_regency_state (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);
--> statement-breakpoint
CREATE TABLE court_regent (
 id INTEGER PRIMARY KEY CHECK(id=1),
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 appointment_token TEXT NOT NULL UNIQUE,
 appointed_by TEXT NOT NULL REFERENCES users(id),
 appointed_at INTEGER NOT NULL CHECK(appointed_at>=0)
);
--> statement-breakpoint
CREATE TABLE court_regency_requests (
 actor_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('appoint','dismiss')),
 target_id TEXT NOT NULL REFERENCES users(id),
 expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL UNIQUE,
 result_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
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
 SELECT sm.user_id,
  EXISTS(SELECT 1 FROM court_leader l WHERE l.id=1 AND l.user_id=sm.user_id AND l.term_id=COALESCE(sm.term_id,'legacy:'||sm.appointed_at)) AS emperor,
  COALESCE((SELECT SUM(c.points) FROM court_contributions c WHERE c.actor_id=sm.user_id),0) AS merit
 FROM staff_members sm
 WHERE sm.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
  AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=sm.user_id AND b.active=1)
) AS ranked
WHERE emperor=1 OR (NOT EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=ranked.user_id)
 AND NOT EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=ranked.user_id));
--> statement-breakpoint
CREATE VIEW court_external_offices AS
SELECT a.* FROM court_office_appointments a JOIN player_saves ps ON ps.user_id=a.user_id
WHERE NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=a.user_id)
 AND a.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=a.user_id AND b.active=1)
 AND NOT EXISTS(SELECT 1 FROM court_kyoto_offices k WHERE k.office_id=a.office_id)
 AND NOT EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=a.user_id)
 AND NOT EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=a.user_id)
 AND (CASE WHEN json_valid(ps.save_json) THEN json_extract(ps.save_json,'$.state.home') END) NOT IN ('edo','kyoto_gosho');
--> statement-breakpoint
CREATE TRIGGER court_regency_insert AFTER INSERT ON court_regent
BEGIN
 DELETE FROM court_office_appointments WHERE user_id=NEW.user_id OR office_id IN (SELECT office_id FROM court_kyoto_offices);
 UPDATE court_regency_state SET revision=revision+1 WHERE id=1;
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_regency_update AFTER UPDATE ON court_regent
BEGIN
 DELETE FROM court_office_appointments WHERE user_id=NEW.user_id OR office_id IN (SELECT office_id FROM court_kyoto_offices);
 UPDATE court_regency_state SET revision=revision+1 WHERE id=1;
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_regency_delete AFTER DELETE ON court_regent
BEGIN
 DELETE FROM court_office_appointments WHERE office_id IN (SELECT office_id FROM court_kyoto_offices);
 UPDATE court_regency_state SET revision=revision+1 WHERE id=1;
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_regency_crown_insert AFTER INSERT ON court_leader
BEGIN
 DELETE FROM court_regent WHERE user_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_regency_crown_update AFTER UPDATE ON court_leader
BEGIN
 DELETE FROM court_regent WHERE user_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_regency_retirement_insert AFTER INSERT ON court_retired_emperors
BEGIN
 DELETE FROM court_regent WHERE user_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_regency_retirement_update AFTER UPDATE ON court_retired_emperors
BEGIN
 DELETE FROM court_regent WHERE user_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_regency_ban_insert AFTER INSERT ON player_bans WHEN NEW.active=1
BEGIN
 DELETE FROM court_regent WHERE user_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_regency_ban_update AFTER UPDATE ON player_bans WHEN NEW.active=1
BEGIN
 DELETE FROM court_regent WHERE user_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_regency_operator_insert AFTER INSERT ON settings WHEN NEW.key='adminUserId'
BEGIN
 DELETE FROM court_regent WHERE user_id=NEW.value;
END;
--> statement-breakpoint
CREATE TRIGGER court_regency_operator_update AFTER UPDATE ON settings WHEN NEW.key='adminUserId'
BEGIN
 DELETE FROM court_regent WHERE user_id=NEW.value;
END;
