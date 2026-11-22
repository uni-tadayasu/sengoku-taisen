-- A separate, server-authoritative weekend battlefield. Normal campaign saves,
-- purchased entitlements and ordinary alliance treasuries are never modified.
CREATE TABLE conquest_seasons (
 id TEXT PRIMARY KEY NOT NULL,
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','ended')),
 results_json TEXT,
 finalized_at INTEGER,
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE conquest_guilds (
 season_id TEXT NOT NULL REFERENCES conquest_seasons(id),
 guild_id TEXT NOT NULL,
 guild_name TEXT NOT NULL,
 troops INTEGER NOT NULL CHECK(troops>=0 AND troops<=100000000),
 supplies INTEGER NOT NULL CHECK(supplies>=0 AND supplies<=100000000),
 replenished_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 captures INTEGER NOT NULL DEFAULT 0,
 defenses INTEGER NOT NULL DEFAULT 0,
 support_points INTEGER NOT NULL DEFAULT 0,
 last_attack_at INTEGER NOT NULL DEFAULT 0,
 joined_at INTEGER NOT NULL,
 PRIMARY KEY(season_id,guild_id)
);
--> statement-breakpoint
CREATE TABLE conquest_members (
 season_id TEXT NOT NULL REFERENCES conquest_seasons(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 guild_id TEXT NOT NULL,
 attack_points INTEGER NOT NULL DEFAULT 0,
 reinforcement_points INTEGER NOT NULL DEFAULT 0,
 transport_points INTEGER NOT NULL DEFAULT 0,
 construction_points INTEGER NOT NULL DEFAULT 0,
 actions INTEGER NOT NULL DEFAULT 0,
 last_action_at INTEGER NOT NULL DEFAULT 0,
 joined_at INTEGER NOT NULL,
 PRIMARY KEY(season_id,user_id),
 FOREIGN KEY(season_id,guild_id) REFERENCES conquest_guilds(season_id,guild_id)
);
--> statement-breakpoint
CREATE TABLE conquest_castles (
 season_id TEXT NOT NULL REFERENCES conquest_seasons(id),
 castle_id TEXT NOT NULL,
 owner_guild_id TEXT,
 garrison INTEGER NOT NULL CHECK(garrison>=0 AND garrison<=100000000),
 wall INTEGER NOT NULL CHECK(wall>=1 AND wall<=5),
 stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0 AND stock<=100000000),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 protected_until INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(season_id,castle_id)
);
--> statement-breakpoint
CREATE INDEX conquest_castles_owner ON conquest_castles(season_id,owner_guild_id,castle_id);
--> statement-breakpoint
CREATE TABLE conquest_captures (
 season_id TEXT NOT NULL,
 guild_id TEXT NOT NULL,
 castle_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 captured_at INTEGER NOT NULL,
 PRIMARY KEY(season_id,guild_id,castle_id)
);
--> statement-breakpoint
CREATE TABLE conquest_requests (
 user_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 season_id TEXT NOT NULL REFERENCES conquest_seasons(id),
 guild_id TEXT NOT NULL,
 action TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL,
 result_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,request_id)
);
--> statement-breakpoint
CREATE INDEX conquest_requests_season ON conquest_requests(season_id,created_at,user_id);
--> statement-breakpoint
CREATE INDEX conquest_members_guild ON conquest_members(season_id,guild_id);
