-- A completed payment remains final when the warrior's position changes.
-- Keep its accepted negotiation and immutable receipt; retire only the active
-- relationship, once, and notify both participants in the same transaction.
CREATE TABLE court_vassal_endings (
 negotiation_id TEXT PRIMARY KEY REFERENCES court_negotiations(id) ON DELETE CASCADE,
 lord_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 vassal_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reason TEXT NOT NULL CHECK(reason IN ('court-membership','court-house','staff-appointment','deputy-appointment','operator-appointment','residency-retainer','residency-succession')),
 created_at INTEGER NOT NULL,
 CHECK(lord_id<>vassal_id)
);
--> statement-breakpoint
-- The canonical acceptance batch also validates these predicates. Keep the
-- graph and payment provenance valid at the final row insertion, including
-- household changes made by catch-up earlier in that same transaction.
CREATE TRIGGER court_vassal_insert_guard BEFORE INSERT ON court_vassals
WHEN NEW.lord_id=NEW.vassal_id
 OR NOT EXISTS(SELECT 1 FROM court_lineages WHERE user_id=NEW.lord_id)
 OR NOT EXISTS(SELECT 1 FROM player_saves WHERE user_id=NEW.lord_id AND save_json IS NOT NULL)
 OR EXISTS(SELECT 1 FROM court_lineages WHERE user_id=NEW.vassal_id)
 OR EXISTS(SELECT 1 FROM court_retained_memberships WHERE user_id=NEW.vassal_id)
 OR EXISTS(SELECT 1 FROM staff_members WHERE user_id=NEW.vassal_id)
 OR EXISTS(SELECT 1 FROM deputy_operator_state WHERE user_id=NEW.vassal_id)
 OR EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=NEW.vassal_id)
 OR NOT EXISTS(SELECT 1 FROM player_saves ps WHERE ps.user_id=NEW.vassal_id AND ps.save_json IS NOT NULL AND COALESCE(json_extract(ps.save_json,'$.state.gameOver'),0)=0 AND json_extract(ps.save_json,'$.state.home') NOT IN ('edo','kyoto_gosho','kagoshima'))
 OR EXISTS(SELECT 1 FROM court_vassals WHERE vassal_id IN (NEW.vassal_id,NEW.lord_id) OR lord_id=NEW.vassal_id)
 OR EXISTS(SELECT 1 FROM castle_residents m JOIN castle_seats s ON s.castle_id=m.castle_id WHERE m.user_id=NEW.vassal_id AND s.lord_user_id IS NOT NULL AND s.lord_user_id<>NEW.vassal_id)
 OR EXISTS(SELECT 1 FROM player_bans WHERE user_id IN (NEW.lord_id,NEW.vassal_id) AND active=1)
 OR EXISTS(SELECT 1 FROM player_expulsions WHERE user_id IN (NEW.lord_id,NEW.vassal_id) AND pending=1)
 OR NOT EXISTS(SELECT 1 FROM court_negotiations n WHERE n.id=NEW.negotiation_id AND n.status='accepted' AND n.lord_id=NEW.lord_id AND n.warrior_id=NEW.vassal_id)
BEGIN
 SELECT RAISE(ABORT,'COURT_VASSAL_INELIGIBLE');
END;
--> statement-breakpoint
CREATE TRIGGER court_vassal_end_apply AFTER INSERT ON court_vassal_endings
BEGIN
 INSERT INTO notification_social_events(id,user_id,actor_id,kind,destination,source_id,subject_id,source_revision,audience,created_at,expires_at,push_eligible)
 SELECT 'court-vassal-ended:'||NEW.negotiation_id||':'||NEW.lord_id,NEW.lord_id,NEW.vassal_id,'court-vassal-ended','courtNegotiations',NEW.negotiation_id,NEW.vassal_id,0,'person',NEW.created_at,NEW.created_at+2592000000,1
 WHERE EXISTS(SELECT 1 FROM court_vassals v WHERE v.negotiation_id=NEW.negotiation_id AND v.lord_id=NEW.lord_id AND v.vassal_id=NEW.vassal_id)
 ON CONFLICT(id) DO NOTHING;
 INSERT INTO notification_social_events(id,user_id,actor_id,kind,destination,source_id,subject_id,source_revision,audience,created_at,expires_at,push_eligible)
 SELECT 'court-vassal-ended:'||NEW.negotiation_id||':'||NEW.vassal_id,NEW.vassal_id,NEW.lord_id,'court-vassal-ended','courtNegotiations',NEW.negotiation_id,NEW.vassal_id,0,'person',NEW.created_at,NEW.created_at+2592000000,1
 WHERE EXISTS(SELECT 1 FROM court_vassals v WHERE v.negotiation_id=NEW.negotiation_id AND v.lord_id=NEW.lord_id AND v.vassal_id=NEW.vassal_id)
 ON CONFLICT(id) DO NOTHING;
 DELETE FROM court_vassals WHERE negotiation_id=NEW.negotiation_id AND lord_id=NEW.lord_id AND vassal_id=NEW.vassal_id;
END;
--> statement-breakpoint
CREATE TRIGGER court_vassal_membership AFTER INSERT ON court_membership_requests
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'court-membership',NEW.created_at FROM court_vassals WHERE vassal_id=NEW.actor_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER court_vassal_house AFTER INSERT ON court_lineages
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'court-house',NEW.created_at FROM court_vassals WHERE vassal_id=NEW.user_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER court_vassal_staff_insert AFTER INSERT ON staff_members
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'staff-appointment',NEW.appointed_at FROM court_vassals WHERE vassal_id=NEW.user_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER court_vassal_staff_update AFTER UPDATE OF user_id ON staff_members
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'staff-appointment',NEW.appointed_at FROM court_vassals WHERE vassal_id=NEW.user_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER court_vassal_deputy_insert AFTER INSERT ON deputy_operator_state WHEN NEW.user_id IS NOT NULL
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'deputy-appointment',NEW.updated_at FROM court_vassals WHERE vassal_id=NEW.user_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER court_vassal_deputy_update AFTER UPDATE OF user_id ON deputy_operator_state WHEN NEW.user_id IS NOT NULL
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'deputy-appointment',NEW.updated_at FROM court_vassals WHERE vassal_id=NEW.user_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER court_vassal_operator_insert AFTER INSERT ON settings WHEN NEW.key='adminUserId'
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'operator-appointment',NEW.updated_at FROM court_vassals WHERE vassal_id=NEW.value
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER court_vassal_operator_update AFTER UPDATE OF value ON settings WHEN NEW.key='adminUserId'
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'operator-appointment',NEW.updated_at FROM court_vassals WHERE vassal_id=NEW.value
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
-- A confirmed entry is already authoritative. It must not be rejected merely
-- because an existing negotiated relationship now ends with the new position.
CREATE TRIGGER court_vassal_retainer_entry AFTER INSERT ON castle_residency_requests WHEN NEW.mode='retainer'
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'residency-retainer',NEW.created_at FROM court_vassals WHERE vassal_id=NEW.actor_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
-- Older clients can gain a first household through an admitted sync save.
CREATE TRIGGER court_vassal_resident_insert AFTER INSERT ON castle_residents
WHEN EXISTS(SELECT 1 FROM castle_seats s WHERE s.castle_id=NEW.castle_id AND s.lord_user_id IS NOT NULL AND s.lord_user_id<>NEW.user_id)
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'residency-retainer',NEW.joined_at FROM court_vassals WHERE vassal_id=NEW.user_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
CREATE TRIGGER court_vassal_resident_move AFTER UPDATE OF castle_id ON castle_residents
WHEN EXISTS(SELECT 1 FROM castle_seats s WHERE s.castle_id=NEW.castle_id AND s.lord_user_id IS NOT NULL AND s.lord_user_id<>NEW.user_id)
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'residency-retainer',NEW.joined_at FROM court_vassals WHERE vassal_id=NEW.user_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
-- A previously vacant seat may gain a lord after existing eligible residents.
CREATE TRIGGER court_vassal_vacant_seat AFTER UPDATE OF lord_user_id ON castle_seats
WHEN OLD.lord_user_id IS NULL AND NEW.lord_user_id IS NOT NULL
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT v.negotiation_id,v.lord_id,v.vassal_id,'residency-retainer',MAX(v.created_at,COALESCE((SELECT MAX(joined_at) FROM castle_residents WHERE castle_id=NEW.castle_id),v.created_at))
 FROM court_vassals v JOIN castle_residents m ON m.user_id=v.vassal_id WHERE m.castle_id=NEW.castle_id AND m.user_id<>NEW.lord_user_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
--> statement-breakpoint
-- Do not observe every seat UPDATE: a departing lord is briefly behind its
-- successor before moving to another vacant castle. Only an actual defeat
-- with a successor makes that former lord a retainer of another player.
CREATE TRIGGER court_vassal_defeated_lord AFTER INSERT ON castle_successions
WHEN NEW.kind<>'departure' AND NEW.lord_user_id IS NOT NULL
BEGIN
 INSERT INTO court_vassal_endings(negotiation_id,lord_id,vassal_id,reason,created_at)
 SELECT negotiation_id,lord_id,vassal_id,'residency-succession',NEW.created_at FROM court_vassals WHERE vassal_id=NEW.previous_lord_id
 ON CONFLICT(negotiation_id) DO NOTHING;
END;
