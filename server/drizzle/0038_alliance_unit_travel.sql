-- Add travel without rewriting existing troop escrow or CHECK constraints.
-- NULL routes preserve units that were already stationed/claimable at upgrade.
ALTER TABLE alliance_units ADD COLUMN home_castle_id TEXT;
--> statement-breakpoint
ALTER TABLE alliance_units ADD COLUMN travel_phase TEXT CHECK(travel_phase IS NULL OR travel_phase IN ('outbound','stationed','returning','arrived'));
--> statement-breakpoint
ALTER TABLE alliance_units ADD COLUMN travel_json TEXT;
--> statement-breakpoint
ALTER TABLE alliance_units ADD COLUMN return_travel_json TEXT;
--> statement-breakpoint
ALTER TABLE alliance_units ADD COLUMN departed_elapsed_ms INTEGER;
--> statement-breakpoint
ALTER TABLE alliance_units ADD COLUMN arrives_elapsed_ms INTEGER;
--> statement-breakpoint
ALTER TABLE alliance_operations ADD COLUMN staging_castle_id TEXT;
--> statement-breakpoint
CREATE INDEX alliance_units_travel_due ON alliance_units(travel_phase,arrives_elapsed_ms);
