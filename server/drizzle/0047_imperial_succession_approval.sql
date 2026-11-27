-- Pending nominations never rewrite the completed succession ledger.
CREATE TABLE court_succession_nominations (
 id TEXT PRIMARY KEY NOT NULL,
 emperor_id TEXT NOT NULL REFERENCES users(id),
 emperor_name TEXT NOT NULL,
 successor_id TEXT NOT NULL REFERENCES users(id),
 successor_name TEXT NOT NULL,
 source_appointment_token TEXT NOT NULL,
 source_staff_term TEXT NOT NULL,
 target_staff_term TEXT NOT NULL,
 source_moderation_epoch INTEGER NOT NULL CHECK(source_moderation_epoch>=0),
 target_moderation_epoch INTEGER NOT NULL CHECK(target_moderation_epoch>=0),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled','invalidated')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 nominated_at INTEGER NOT NULL,
 resolved_at INTEGER,
 resolved_by TEXT REFERENCES users(id),
 reason TEXT CHECK(reason IN ('emperor_changed','successor_changed','rejected','cancelled')),
 invalidated_reason TEXT CHECK(invalidated_reason IN ('emperor_changed','successor_changed')),
 CHECK(emperor_id<>successor_id),
 CHECK((status='pending' AND revision=0 AND resolved_at IS NULL AND resolved_by IS NULL AND reason IS NULL)
  OR (status<>'pending' AND revision=1 AND resolved_at>=nominated_at)),
 CHECK(status<>'approved' OR (resolved_by IS NOT NULL AND reason IS NULL AND invalidated_reason IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX court_succession_nominations_pending_idx ON court_succession_nominations(status) WHERE status='pending';
--> statement-breakpoint
CREATE INDEX court_succession_nominations_owner_idx ON court_succession_nominations(emperor_id,nominated_at DESC,id);
--> statement-breakpoint
CREATE TABLE court_succession_nomination_requests (
 actor_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 nomination_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('nominate','approve','reject','cancel')),
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL UNIQUE,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE INDEX court_succession_nomination_requests_id_idx ON court_succession_nomination_requests(nomination_id,created_at);
--> statement-breakpoint
-- Mark invalidation durably so restoring a role cannot resurrect a nomination.
-- Authorized reads/writes then record its resolution with server request time.
CREATE TRIGGER court_succession_nomination_crown_insert AFTER INSERT ON court_leader
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,'emperor_changed')
 WHERE status='pending' AND (emperor_id<>NEW.user_id OR source_appointment_token<>NEW.appointment_token OR source_staff_term<>NEW.term_id);
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_crown_update AFTER UPDATE OF user_id,term_id,appointment_token ON court_leader
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,'emperor_changed')
 WHERE status='pending' AND (emperor_id<>NEW.user_id OR source_appointment_token<>NEW.appointment_token OR source_staff_term<>NEW.term_id);
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_crown_delete AFTER DELETE ON court_leader
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,'emperor_changed') WHERE status='pending' AND emperor_id=OLD.user_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_staff_delete AFTER DELETE ON staff_members
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,CASE WHEN emperor_id=OLD.user_id THEN 'emperor_changed' ELSE 'successor_changed' END)
 WHERE status='pending' AND (emperor_id=OLD.user_id OR successor_id=OLD.user_id);
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_staff_update AFTER UPDATE OF term_id,appointed_at ON staff_members
WHEN COALESCE(OLD.term_id,'legacy:'||OLD.appointed_at)<>COALESCE(NEW.term_id,'legacy:'||NEW.appointed_at)
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,CASE WHEN emperor_id=NEW.user_id THEN 'emperor_changed' ELSE 'successor_changed' END)
 WHERE status='pending' AND (emperor_id=NEW.user_id OR successor_id=NEW.user_id);
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_ban_insert AFTER INSERT ON player_bans
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,CASE WHEN emperor_id=NEW.user_id THEN 'emperor_changed' ELSE 'successor_changed' END)
 WHERE status='pending' AND ((emperor_id=NEW.user_id AND (NEW.active=1 OR source_moderation_epoch<>NEW.revision)) OR (successor_id=NEW.user_id AND (NEW.active=1 OR target_moderation_epoch<>NEW.revision)));
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_ban_update AFTER UPDATE OF active,revision ON player_bans
WHEN OLD.active<>NEW.active OR OLD.revision<>NEW.revision
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,CASE WHEN emperor_id=NEW.user_id THEN 'emperor_changed' ELSE 'successor_changed' END)
 WHERE status='pending' AND (emperor_id=NEW.user_id OR successor_id=NEW.user_id);
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_operator_insert AFTER INSERT ON settings WHEN NEW.key='adminUserId'
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,CASE WHEN emperor_id=NEW.value THEN 'emperor_changed' ELSE 'successor_changed' END)
 WHERE status='pending' AND (emperor_id=NEW.value OR successor_id=NEW.value);
END;
--> statement-breakpoint
CREATE TRIGGER court_succession_nomination_operator_update AFTER UPDATE OF value ON settings WHEN NEW.key='adminUserId' AND OLD.value<>NEW.value
BEGIN
 UPDATE court_succession_nominations SET invalidated_reason=COALESCE(invalidated_reason,CASE WHEN emperor_id=NEW.value THEN 'emperor_changed' ELSE 'successor_changed' END)
 WHERE status='pending' AND (emperor_id=NEW.value OR successor_id=NEW.value);
END;
