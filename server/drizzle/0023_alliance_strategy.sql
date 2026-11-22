CREATE TABLE alliance_policies (
 guild_id TEXT PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
 join_mode TEXT NOT NULL DEFAULT 'open' CHECK(join_mode IN ('open','approval','invite')),
 description TEXT NOT NULL DEFAULT '',
 activity TEXT NOT NULL DEFAULT '',
 withdraw_role TEXT NOT NULL DEFAULT 'all' CHECK(withdraw_role IN ('all','officers','owner')),
 daily_limit INTEGER NOT NULL DEFAULT 100000000 CHECK(daily_limit BETWEEN 0 AND 100000000),
 approval_threshold INTEGER NOT NULL DEFAULT 1000000 CHECK(approval_threshold BETWEEN 0 AND 1000000),
 newcomer_hours INTEGER NOT NULL DEFAULT 0 CHECK(newcomer_hours BETWEEN 0 AND 168),
 revision INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE alliance_applications (
 guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','invited','joined')),
 message TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(guild_id,user_id)
);
--> statement-breakpoint
CREATE TRIGGER alliance_join_consumes_invitation AFTER INSERT ON guild_members
BEGIN
 UPDATE alliance_applications SET status='joined',revision=revision+1,updated_at=NEW.joined_at
 WHERE guild_id=NEW.guild_id AND user_id=NEW.user_id AND status IN ('approved','invited');
END;
--> statement-breakpoint
CREATE TABLE alliance_operations (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 creator_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL CHECK(kind IN ('attack','defend','gather')),
 target_player_id TEXT,
 castle_id TEXT NOT NULL,
 branch_id TEXT,
 tactic TEXT NOT NULL DEFAULT 'balanced',
 starts_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','completed','cancelled')),
 assignments_json TEXT NOT NULL DEFAULT '[]',
 result_json TEXT,
 resolution_seed TEXT NOT NULL DEFAULT '',
 revision INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX alliance_operations_guild ON alliance_operations(guild_id,starts_at DESC);
--> statement-breakpoint
CREATE TABLE alliance_rsvps (
 operation_id TEXT NOT NULL REFERENCES alliance_operations(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 response TEXT NOT NULL CHECK(response IN ('yes','maybe','no')),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(operation_id,user_id)
);
--> statement-breakpoint
-- Escrow survives a dissolved guild. Only its owner can claim returned troops.
CREATE TABLE alliance_units (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES users(id),
 owner_epoch INTEGER NOT NULL,
 target_id TEXT,
 target_epoch INTEGER,
 castle_id TEXT NOT NULL,
 operation_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('rally','aid')),
 state TEXT NOT NULL CHECK(state IN ('stationed','returning','claimed')),
 troops INTEGER NOT NULL CHECK(troops BETWEEN 0 AND 100000),
 sent INTEGER NOT NULL CHECK(sent BETWEEN 1 AND 100000),
 expires_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX alliance_units_target ON alliance_units(target_id,castle_id,state);
--> statement-breakpoint
CREATE INDEX alliance_units_operation ON alliance_units(operation_id,state);
--> statement-breakpoint
CREATE INDEX alliance_units_owner ON alliance_units(owner_id,state);
--> statement-breakpoint
CREATE TABLE alliance_requests (
 actor_id TEXT NOT NULL REFERENCES users(id),
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL,
 result_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE alliance_withdrawals (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 actor_epoch INTEGER NOT NULL,
 transfer_request_id TEXT NOT NULL,
 resource TEXT NOT NULL CHECK(resource IN ('gold','rice','wood','stone','magatama')),
 amount INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 1000000),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','denied','used')),
 approved_by TEXT,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 0,
 UNIQUE(actor_id,transfer_request_id)
);
--> statement-breakpoint
CREATE TABLE alliance_contributions (
 id TEXT PRIMARY KEY,
 guild_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL,
 amount INTEGER NOT NULL,
 detail TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX alliance_contributions_guild ON alliance_contributions(guild_id,created_at DESC);
