-- Retired emperors retain their separate residence and palace effects when
-- formally rejoining the court; only a new coronation ends that entitlement.
DROP VIEW court_estate_current;
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
 AND (NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) OR EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id))
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1)
 AND NOT EXISTS(SELECT 1 FROM player_expulsions e WHERE e.user_id=u.id AND e.pending=1)
 AND (EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=u.id)
  OR EXISTS(SELECT 1 FROM court_retained_memberships cm WHERE cm.user_id=u.id)
  OR EXISTS(SELECT 1 FROM court_external_offices o WHERE o.user_id=u.id)
  OR EXISTS(SELECT 1 FROM court_retired_emperors r JOIN court_succession_requests s ON s.commit_token=r.succession_id AND s.actor_id=r.user_id AND s.target_id=r.successor_id WHERE r.user_id=u.id));
--> statement-breakpoint
-- Retired and cloistered emperors inherit the palace's effective upgrades.
-- Record that entitlement separately from an ordinary court holding so that
-- old appointments and offline catch-up cannot gain retroactive production.
ALTER TABLE court_estate_accounts ADD COLUMN imperial_enhancements INTEGER NOT NULL DEFAULT 0 CHECK(imperial_enhancements IN (0,1));
--> statement-breakpoint
ALTER TABLE court_estate_snapshots ADD COLUMN imperial_enhancements INTEGER NOT NULL DEFAULT 0 CHECK(imperial_enhancements IN (0,1));
--> statement-breakpoint
UPDATE court_estate_accounts SET imperial_enhancements=1,revision=revision+1,
 last_effective_elapsed_ms=MAX(last_effective_elapsed_ms,sealed_elapsed_ms,COALESCE((SELECT base_elapsed_ms+CASE WHEN running=1 THEN MAX(0,CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)-anchor_real_ms)*speed ELSE 0 END FROM world_clock WHERE id='world-v1'),sealed_elapsed_ms)),
 sealed_elapsed_ms=MAX(last_effective_elapsed_ms,sealed_elapsed_ms,COALESCE((SELECT base_elapsed_ms+CASE WHEN running=1 THEN MAX(0,CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)-anchor_real_ms)*speed ELSE 0 END FROM world_clock WHERE id='world-v1'),sealed_elapsed_ms))
WHERE active=1 AND EXISTS(SELECT 1 FROM court_estate_current c WHERE c.user_id=court_estate_accounts.user_id)
 AND EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=court_estate_accounts.user_id);
--> statement-breakpoint
INSERT INTO court_estate_snapshots(user_id,revision,effective_elapsed_ms,active,imperial_enhancements)
SELECT user_id,revision,last_effective_elapsed_ms,active,imperial_enhancements FROM court_estate_accounts
WHERE imperial_enhancements=1 ON CONFLICT(user_id,revision) DO NOTHING;
