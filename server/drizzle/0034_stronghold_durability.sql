-- NULL preserves full durability for existing and newly created castles. The
-- server checkpoints damage and natural repairs with the common game clock.
ALTER TABLE conquest_castles ADD COLUMN durability_json TEXT;
