-- Family and imperial-house identity belongs to the lord, independently of
-- administrative privileges, court terms, campaigns, and personal territory.
-- Legacy members deliberately remain unassigned until they choose a family.
CREATE TABLE court_lineages (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 house_id TEXT NOT NULL CHECK(house_id IN ('konoe','kujo','ichijo','nijo','takatsukasa')),
 original_clan TEXT,
 imperial_house_name TEXT,
 imperial_house_key TEXT UNIQUE,
 revision INTEGER NOT NULL CHECK(revision>=1),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 CHECK((imperial_house_name IS NULL AND imperial_house_key IS NULL) OR
  (imperial_house_name IS NOT NULL AND imperial_house_key IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE court_lineage_requests (
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('choose-house','create-imperial-house')),
 house_id TEXT NOT NULL CHECK(house_id IN ('konoe','kujo','ichijo','nijo','takatsukasa')),
 imperial_house_name TEXT,
 expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
 result_revision INTEGER NOT NULL CHECK(result_revision>=1),
 term_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 commit_token TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,request_id)
);
--> statement-breakpoint
ALTER TABLE court_membership_requests ADD COLUMN house_id TEXT
 CHECK(house_id IS NULL OR house_id IN ('konoe','kujo','ichijo','nijo','takatsukasa'));
