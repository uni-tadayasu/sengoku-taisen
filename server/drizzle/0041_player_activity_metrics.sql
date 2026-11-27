-- Additive observation tables. No historical activity is manufactured.
-- The first successful authenticated game request initializes started_at.
CREATE TABLE player_activity_program (
  id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE player_activity_cohorts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  first_day TEXT NOT NULL, first_at INTEGER NOT NULL,
  segment TEXT NOT NULL CHECK(segment IN ('free','paid'))
);
--> statement-breakpoint
CREATE INDEX player_activity_cohort_day ON player_activity_cohorts(first_day,segment);
--> statement-breakpoint
CREATE TABLE player_activity_days (
  user_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL,
  first_at INTEGER NOT NULL, PRIMARY KEY(user_id,day)
);
--> statement-breakpoint
CREATE INDEX player_activity_day ON player_activity_days(day,user_id);
--> statement-breakpoint
CREATE TABLE premium_metrics_program (
  id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE premium_payment_observations (
  payment_intent_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL, confirmed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX premium_payment_observed_user ON premium_payment_observations(user_id,confirmed_at);
