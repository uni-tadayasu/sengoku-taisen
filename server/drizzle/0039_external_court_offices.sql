-- Six external appointments do not grant staff or operator privileges.
-- Kyoto's current offices always take precedence. Conflicts are removed
-- durably at the role/merit change so an old appointment can never reappear.
CREATE TABLE court_office_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);
--> statement-breakpoint
CREATE TABLE court_office_appointments (
  office_id TEXT PRIMARY KEY CHECK(office_id IN ('sangi','chunagon','dainagon','naidaijin','udaijin','sadaijin')),
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  appointment_token TEXT NOT NULL UNIQUE,
  appointed_by TEXT NOT NULL REFERENCES users(id),
  appointed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE court_office_requests (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('appoint','dismiss')),
  office_id TEXT NOT NULL CHECK(office_id IN ('sangi','chunagon','dainagon','naidaijin','udaijin','sadaijin')),
  target_id TEXT NOT NULL REFERENCES users(id),
  expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(actor_id,request_id)
);
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
);
--> statement-breakpoint
CREATE VIEW court_external_offices AS
SELECT a.* FROM court_office_appointments a JOIN player_saves ps ON ps.user_id=a.user_id
WHERE NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=a.user_id)
 AND a.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=a.user_id AND b.active=1)
 AND NOT EXISTS(SELECT 1 FROM court_kyoto_offices k WHERE k.office_id=a.office_id)
 AND (CASE WHEN json_valid(ps.save_json) THEN json_extract(ps.save_json,'$.state.home') END) NOT IN ('edo','kyoto_gosho');
--> statement-breakpoint
CREATE TRIGGER court_office_assignment_insert AFTER INSERT ON court_office_appointments
BEGIN
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_assignment_update AFTER UPDATE ON court_office_appointments
BEGIN
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_assignment_delete AFTER DELETE ON court_office_appointments
BEGIN
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_staff_insert AFTER INSERT ON staff_members
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_staff_update AFTER UPDATE ON staff_members
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_staff_delete AFTER DELETE ON staff_members
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_leader_insert AFTER INSERT ON court_leader
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_leader_update AFTER UPDATE ON court_leader
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_leader_delete AFTER DELETE ON court_leader
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_merit_insert AFTER INSERT ON court_contributions
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_merit_update AFTER UPDATE ON court_contributions
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_merit_delete AFTER DELETE ON court_contributions
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_ban_insert AFTER INSERT ON player_bans
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_ban_update AFTER UPDATE ON player_bans
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_ban_delete AFTER DELETE ON player_bans
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_operator_insert AFTER INSERT ON settings
WHEN NEW.key='adminUserId'
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_operator_update AFTER UPDATE ON settings
WHEN COALESCE(NEW.key,'')='adminUserId' OR COALESCE(OLD.key,'')='adminUserId'
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_operator_delete AFTER DELETE ON settings
WHEN OLD.key='adminUserId'
BEGIN
  DELETE FROM court_office_appointments WHERE user_id IN (SELECT user_id FROM staff_members)
    OR user_id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
    OR user_id IN (SELECT user_id FROM player_bans WHERE active=1)
    OR office_id IN (SELECT office_id FROM court_kyoto_offices);
  UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_home_update AFTER UPDATE OF save_json ON player_saves
WHEN EXISTS(SELECT 1 FROM court_office_appointments WHERE user_id=NEW.user_id)
 AND COALESCE((CASE WHEN json_valid(NEW.save_json) THEN json_extract(NEW.save_json,'$.state.home') END),'') IN ('','edo','kyoto_gosho')
BEGIN
 DELETE FROM court_office_appointments WHERE user_id=NEW.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_office_home_delete AFTER DELETE ON player_saves
BEGIN
 DELETE FROM court_office_appointments WHERE user_id=OLD.user_id;
END;

