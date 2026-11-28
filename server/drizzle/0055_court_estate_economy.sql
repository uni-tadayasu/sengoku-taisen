-- Role-bound ordinary-castle benefits have their own authoritative timeline.
-- Existing appointments begin at this deployment, never in an earlier save.
CREATE VIEW court_estate_current AS
SELECT u.id AS user_id,
 CASE WHEN EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=u.id)
  THEN 'regent:'||(SELECT appointment_token FROM court_regent g WHERE g.id=1 AND g.user_id=u.id)
 WHEN EXISTS(SELECT 1 FROM court_external_offices o WHERE o.user_id=u.id)
  THEN 'office:'||(SELECT office_id||':'||appointment_token FROM court_external_offices o WHERE o.user_id=u.id)
 ELSE 'retired:'||(SELECT r.succession_id FROM court_retired_emperors r JOIN court_succession_requests s ON s.commit_token=r.succession_id AND s.actor_id=r.user_id AND s.target_id=r.successor_id WHERE r.user_id=u.id) END AS authority_key
FROM users u JOIN (SELECT user_id FROM court_regent UNION SELECT user_id FROM court_office_appointments UNION SELECT user_id FROM court_retired_emperors) candidates ON candidates.user_id=u.id
WHERE u.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
 AND NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1)
 AND NOT EXISTS(SELECT 1 FROM player_expulsions e WHERE e.user_id=u.id AND e.pending=1)
 AND (EXISTS(SELECT 1 FROM court_regent g WHERE g.id=1 AND g.user_id=u.id)
  OR EXISTS(SELECT 1 FROM court_external_offices o WHERE o.user_id=u.id)
  OR EXISTS(SELECT 1 FROM court_retired_emperors r JOIN court_succession_requests s ON s.commit_token=r.succession_id AND s.actor_id=r.user_id AND s.target_id=r.successor_id WHERE r.user_id=u.id));
--> statement-breakpoint
CREATE TABLE court_estate_policy (
 id INTEGER PRIMARY KEY CHECK(id=1),
 activated_elapsed_ms INTEGER NOT NULL CHECK(activated_elapsed_ms>=0)
);
--> statement-breakpoint
CREATE TABLE court_estate_accounts (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 authority_key TEXT NOT NULL,
 activated_elapsed_ms INTEGER NOT NULL CHECK(activated_elapsed_ms>=0),
 last_effective_elapsed_ms INTEGER NOT NULL CHECK(last_effective_elapsed_ms>=activated_elapsed_ms),
 sealed_elapsed_ms INTEGER NOT NULL CHECK(sealed_elapsed_ms>=last_effective_elapsed_ms),
 revision INTEGER NOT NULL CHECK(revision>=1)
);
--> statement-breakpoint
CREATE TABLE court_estate_snapshots (
 user_id TEXT NOT NULL REFERENCES court_estate_accounts(user_id),
 revision INTEGER NOT NULL CHECK(revision>=1),
 effective_elapsed_ms INTEGER NOT NULL CHECK(effective_elapsed_ms>=0),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 PRIMARY KEY(user_id,revision)
);
--> statement-breakpoint
CREATE INDEX court_estate_snapshots_time ON court_estate_snapshots(user_id,effective_elapsed_ms,revision);
--> statement-breakpoint
INSERT INTO court_estate_policy(id,activated_elapsed_ms)
SELECT 1,base_elapsed_ms+CASE WHEN running=1 THEN MAX(0,CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)-anchor_real_ms)*speed ELSE 0 END FROM world_clock WHERE id='world-v1';
--> statement-breakpoint
-- A palace with an ordinary holder must exist from the activation boundary,
-- even if no Kyoto member has previously opened the lazy shared base.
INSERT INTO staff_base(id,state_json,updated_at)
SELECT 'kyoto_gosho',json_set('{"initial":{"castleLevel":1,"buildings":{"gold_mine":0,"silver_mine":0,"trade_port":0,"wholesale":0,"artisan_town":0,"post_town":0,"mint":0,"rice_paddy":0,"dry_field":0,"orchard":0,"fishery":0,"ranch":0,"granary":0,"irrigation":0,"cedar_forest":0,"bamboo_grove":0,"sawmill":0,"timber_market":0,"charcoal_kiln":0,"forest_office":0,"water_sawmill":0,"stoneworks":0,"clay_pit":0,"lime_kiln":0,"tile_kiln":0,"iron_mine":0,"copper_mine":0,"stone_depot":0,"dojo":0,"stable":0,"gunsmith":0,"spear_workshop":0,"armory":0,"drill_ground":0,"war_school":0,"main_gate":0,"moat":0,"watchtower":0,"guardhouse":0,"earthworks":0,"outpost":0,"herb_garden":0,"library":0,"observatory":0,"craft_lab":0,"engineering_shop":0,"medical_school":0,"school":0,"foreign_studies":0,"envoy_house":0,"tea_house":0,"temple":0,"shrine":0,"guest_house":0,"relay_station":0,"intelligence_office":0,"keep":2,"farm":2,"market":2,"lumber":1,"quarry":1,"barracks":2,"wall":1,"academy":1}},"castleLevel":1,"buildings":{"gold_mine":0,"silver_mine":0,"trade_port":0,"wholesale":0,"artisan_town":0,"post_town":0,"mint":0,"rice_paddy":0,"dry_field":0,"orchard":0,"fishery":0,"ranch":0,"granary":0,"irrigation":0,"cedar_forest":0,"bamboo_grove":0,"sawmill":0,"timber_market":0,"charcoal_kiln":0,"forest_office":0,"water_sawmill":0,"stoneworks":0,"clay_pit":0,"lime_kiln":0,"tile_kiln":0,"iron_mine":0,"copper_mine":0,"stone_depot":0,"dojo":0,"stable":0,"gunsmith":0,"spear_workshop":0,"armory":0,"drill_ground":0,"war_school":0,"main_gate":0,"moat":0,"watchtower":0,"guardhouse":0,"earthworks":0,"outpost":0,"herb_garden":0,"library":0,"observatory":0,"craft_lab":0,"engineering_shop":0,"medical_school":0,"school":0,"foreign_studies":0,"envoy_house":0,"tea_house":0,"temple":0,"shrine":0,"guest_house":0,"relay_station":0,"intelligence_office":0,"keep":2,"farm":2,"market":2,"lumber":1,"quarry":1,"barracks":2,"wall":1,"academy":1},"jobs":[],"history":[],"createdElapsedMs":0,"updatedElapsedMs":0}','$.createdElapsedMs',p.activated_elapsed_ms,'$.updatedElapsedMs',p.activated_elapsed_ms),CAST(strftime('%s','now') AS INTEGER)*1000
FROM court_estate_policy p WHERE EXISTS(SELECT 1 FROM court_estate_current) ON CONFLICT(id) DO NOTHING;
--> statement-breakpoint
INSERT INTO court_estate_accounts(user_id,active,authority_key,activated_elapsed_ms,last_effective_elapsed_ms,sealed_elapsed_ms,revision)
SELECT c.user_id,1,c.authority_key,p.activated_elapsed_ms,p.activated_elapsed_ms,p.activated_elapsed_ms,1 FROM court_estate_current c CROSS JOIN court_estate_policy p;
--> statement-breakpoint
INSERT INTO court_estate_snapshots(user_id,revision,effective_elapsed_ms,active)
SELECT user_id,revision,last_effective_elapsed_ms,active FROM court_estate_accounts;
