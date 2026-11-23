-- Counts are projected only from canonical source ledgers, never imported saves.
CREATE VIEW external_troop_current_counts AS
SELECT u.id AS user_id,COALESCE(json_extract(ps.save_json,'$.state.walking.campaignId'),'') AS campaign_id,
  COALESCE((SELECT SUM(v.troops) FROM vacant_garrisons v WHERE v.actor_id=u.id AND v.campaign_id=json_extract(ps.save_json,'$.state.walking.campaignId')),0) AS vacant_troops,
  COALESCE((SELECT SUM(COALESCE(json_extract(t.offer_json,'$.troops'),0)) FROM trades t WHERE t.sender_id=u.id AND t.status='pending'),0)
    +COALESCE((SELECT SUM(COALESCE(json_extract(d.assets_json,'$.troops'),0)) FROM trade_deliveries d WHERE d.recipient_id=u.id AND d.claimed_at IS NULL),0) AS trade_troops,
  COALESCE((SELECT SUM(a.troops) FROM alliance_units a WHERE a.owner_id=u.id AND a.state<>'claimed' AND a.campaign_retired=0),0) AS alliance_troops
FROM users u LEFT JOIN player_saves ps ON ps.user_id=u.id;
--> statement-breakpoint
CREATE TABLE external_troop_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  activated_elapsed_ms INTEGER NOT NULL CHECK(activated_elapsed_ms>=0),
  sealed_elapsed_ms INTEGER NOT NULL CHECK(sealed_elapsed_ms>=activated_elapsed_ms),
  last_effective_elapsed_ms INTEGER NOT NULL CHECK(last_effective_elapsed_ms>=activated_elapsed_ms),
  revision INTEGER NOT NULL CHECK(revision>=1),
  campaign_id TEXT NOT NULL,
  vacant_troops INTEGER NOT NULL CHECK(vacant_troops>=0),
  trade_troops INTEGER NOT NULL CHECK(trade_troops>=0),
  alliance_troops INTEGER NOT NULL CHECK(alliance_troops>=0)
);
--> statement-breakpoint
CREATE TABLE external_troop_snapshots (
  user_id TEXT NOT NULL REFERENCES external_troop_accounts(user_id),
  revision INTEGER NOT NULL CHECK(revision>=1),
  effective_elapsed_ms INTEGER NOT NULL CHECK(effective_elapsed_ms>=0),
  campaign_id TEXT NOT NULL,
  vacant_troops INTEGER NOT NULL CHECK(vacant_troops>=0),
  trade_troops INTEGER NOT NULL CHECK(trade_troops>=0),
  alliance_troops INTEGER NOT NULL CHECK(alliance_troops>=0),
  PRIMARY KEY(user_id,revision)
);
--> statement-breakpoint
CREATE INDEX external_troop_snapshots_time ON external_troop_snapshots(user_id,effective_elapsed_ms,revision);
--> statement-breakpoint
-- Existing owners start at deployment, including owners who remain offline.
-- No external charge applies to any interval preceding this baseline.
INSERT INTO external_troop_accounts(user_id,activated_elapsed_ms,sealed_elapsed_ms,last_effective_elapsed_ms,revision,campaign_id,vacant_troops,trade_troops,alliance_troops)
SELECT c.user_id,w.elapsed_ms,w.elapsed_ms,w.elapsed_ms,1,c.campaign_id,c.vacant_troops,c.trade_troops,c.alliance_troops
FROM external_troop_current_counts c CROSS JOIN
  (SELECT base_elapsed_ms+CASE WHEN running=1 THEN MAX(0,CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)-anchor_real_ms)*speed ELSE 0 END AS elapsed_ms FROM world_clock WHERE id='world-v1') w;
--> statement-breakpoint
INSERT INTO external_troop_snapshots(user_id,revision,effective_elapsed_ms,campaign_id,vacant_troops,trade_troops,alliance_troops)
SELECT user_id,revision,last_effective_elapsed_ms,campaign_id,vacant_troops,trade_troops,alliance_troops FROM external_troop_accounts;
