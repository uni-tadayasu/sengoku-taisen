CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  sender_name TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  offer_json TEXT NOT NULL,
  want_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','cancelled','rejected')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(sender_id<>recipient_id)
);
--> statement-breakpoint
CREATE INDEX trades_sender_history ON trades(sender_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE INDEX trades_recipient_history ON trades(recipient_id,created_at DESC,id DESC);
--> statement-breakpoint
CREATE INDEX trades_sender_pending ON trades(sender_id,status);
--> statement-breakpoint
CREATE TABLE trade_requests (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  trade_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('propose','accept','cancel','reject','claim')),
  request_hash TEXT NOT NULL,
  commit_token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(actor_id,request_id)
);
--> statement-breakpoint
CREATE INDEX trade_requests_trade ON trade_requests(trade_id,created_at,id);
--> statement-breakpoint
CREATE TABLE trade_deliveries (
  trade_id TEXT PRIMARY KEY REFERENCES trades(id),
  recipient_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('proceeds','refund')),
  assets_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER
);
--> statement-breakpoint
CREATE INDEX trade_deliveries_unclaimed ON trade_deliveries(recipient_id,claimed_at);
