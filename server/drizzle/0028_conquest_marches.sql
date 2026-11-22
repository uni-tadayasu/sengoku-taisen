-- Troops and supplies leave the shared pool at departure. Ownership and
-- battle rewards change only at arrival. Overflow returns remain in escrow.
CREATE TABLE conquest_marches (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 season_id TEXT NOT NULL REFERENCES conquest_seasons(id),
 guild_id TEXT NOT NULL,
 from_castle_id TEXT,
 source_castle_id TEXT NOT NULL,
 target_castle_id TEXT NOT NULL,
 target_owner_guild_id TEXT,
 member_epoch INTEGER NOT NULL,
 troops INTEGER NOT NULL CHECK(troops BETWEEN 100 AND 10000),
 tactic TEXT NOT NULL,
 supply_cost INTEGER NOT NULL CHECK(supply_cost>=0),
 departed_at INTEGER NOT NULL,
 arrives_at INTEGER NOT NULL CHECK(arrives_at>departed_at),
 distance_km REAL NOT NULL CHECK(distance_km>=0),
 duration_ms INTEGER NOT NULL CHECK(duration_ms>=15000),
 status TEXT NOT NULL DEFAULT 'marching' CHECK(status IN ('marching','resolved','cancelled')),
 result_json TEXT NOT NULL,
 commit_token TEXT NOT NULL,
 return_troops INTEGER NOT NULL DEFAULT 0 CHECK(return_troops>=0 AND return_troops<=10000),
 return_supplies INTEGER NOT NULL DEFAULT 0 CHECK(return_supplies>=0),
 settled_at INTEGER,
 UNIQUE(user_id,request_id),
 FOREIGN KEY(season_id,guild_id) REFERENCES conquest_guilds(season_id,guild_id)
);
--> statement-breakpoint
CREATE INDEX conquest_marches_due ON conquest_marches(status,arrives_at,id);
--> statement-breakpoint
CREATE INDEX conquest_marches_guild ON conquest_marches(season_id,guild_id,status);
--> statement-breakpoint
CREATE UNIQUE INDEX conquest_marches_actor ON conquest_marches(user_id) WHERE status='marching';
