-- Voluntary abdication is an immutable, server-authorized succession.
-- Retired Emperors keep their title after leaving Kyoto staff membership.
-- Existing six-seat office tables and receipts remain unchanged.
CREATE TABLE court_succession_requests (
 actor_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 target_id TEXT NOT NULL REFERENCES users(id),
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL UNIQUE,
 source_appointment_token TEXT NOT NULL UNIQUE,
 result_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,request_id),
 CHECK(actor_id<>target_id)
);
--> statement-breakpoint
CREATE TABLE court_retired_emperors (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 succession_id TEXT NOT NULL UNIQUE REFERENCES court_succession_requests(commit_token),
 successor_id TEXT NOT NULL REFERENCES users(id),
 retired_at INTEGER NOT NULL,
 CHECK(user_id<>successor_id)
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
WHERE emperor=1 OR NOT EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=ranked.user_id);
--> statement-breakpoint
CREATE VIEW court_external_offices AS
SELECT a.* FROM court_office_appointments a JOIN player_saves ps ON ps.user_id=a.user_id
WHERE NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=a.user_id)
 AND a.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=a.user_id AND b.active=1)
 AND NOT EXISTS(SELECT 1 FROM court_kyoto_offices k WHERE k.office_id=a.office_id)
 AND NOT EXISTS(SELECT 1 FROM court_retired_emperors r WHERE r.user_id=a.user_id)
 AND (CASE WHEN json_valid(ps.save_json) THEN json_extract(ps.save_json,'$.state.home') END) NOT IN ('edo','kyoto_gosho');
--> statement-breakpoint
CREATE TRIGGER court_retirement_insert AFTER INSERT ON court_retired_emperors
BEGIN
 DELETE FROM court_office_appointments WHERE user_id=NEW.user_id;
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_retirement_update AFTER UPDATE ON court_retired_emperors
BEGIN
 DELETE FROM court_office_appointments WHERE user_id=NEW.user_id;
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
--> statement-breakpoint
CREATE TRIGGER court_retirement_delete AFTER DELETE ON court_retired_emperors
BEGIN
 UPDATE court_office_state SET revision=revision+1 WHERE id=1;
END;
