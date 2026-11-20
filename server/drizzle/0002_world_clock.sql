CREATE TABLE world_clock (
  id TEXT PRIMARY KEY CHECK (id = 'world-v1'),
  base_elapsed_ms INTEGER NOT NULL CHECK (base_elapsed_ms >= 0),
  anchor_real_ms INTEGER NOT NULL,
  running INTEGER NOT NULL CHECK (running IN (0,1)),
  speed INTEGER NOT NULL CHECK (speed IN (1,2,4)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
