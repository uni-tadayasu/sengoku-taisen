-- An admission may retain every existing castle, so zero relinquished holdings
-- is valid. Preserve all pre-lineage and lineage-aware receipts verbatim.
CREATE TABLE court_membership_requests_next (
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL,
 source_campaign_id TEXT NOT NULL,
 source_home TEXT NOT NULL,
 released_castle_count INTEGER NOT NULL CHECK(released_castle_count>=0),
 term_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 house_id TEXT CHECK(house_id IS NULL OR house_id IN ('konoe','kujo','ichijo','nijo','takatsukasa')),
 join_mode TEXT NOT NULL DEFAULT 'kyoto' CHECK(join_mode IN ('kyoto','retained-base')),
 destination_home TEXT NOT NULL DEFAULT 'kyoto_gosho',
 retained_castle_count INTEGER NOT NULL DEFAULT 0 CHECK(retained_castle_count>=0),
 PRIMARY KEY(actor_id,request_id),
 UNIQUE(actor_id,source_campaign_id)
);
--> statement-breakpoint
INSERT INTO court_membership_requests_next(actor_id,request_id,request_hash,commit_token,source_campaign_id,source_home,released_castle_count,term_id,created_at,house_id)
 SELECT actor_id,request_id,request_hash,commit_token,source_campaign_id,source_home,released_castle_count,term_id,created_at,house_id FROM court_membership_requests;
--> statement-breakpoint
DROP TABLE court_membership_requests;
--> statement-breakpoint
ALTER TABLE court_membership_requests_next RENAME TO court_membership_requests;
--> statement-breakpoint
-- This is a membership receipt, never an account, staff, or imperial role.
CREATE TABLE court_retained_memberships (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 term_id TEXT NOT NULL,
 base_id TEXT NOT NULL CHECK(length(base_id) BETWEEN 1 AND 90),
 joined_at INTEGER NOT NULL CHECK(joined_at>=0),
 FOREIGN KEY(user_id,request_id) REFERENCES court_membership_requests(actor_id,request_id)
);
