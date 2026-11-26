-- Expand the paid collection without changing existing payment evidence.
-- Copy the referencing sessions before replacing either table; foreign-key enforcement stays on.
DROP VIEW premium_grants;
--> statement-breakpoint
CREATE TABLE premium_orders_collection (
  reference TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL CHECK(product_id IN ('gold-banner','moonlit-castle','supporter','vermilion-banner','silver-banner','phoenix-medallion','sakura-town','snow-town')),
  created_at INTEGER NOT NULL,
  UNIQUE(user_id,product_id)
);
--> statement-breakpoint
INSERT INTO premium_orders_collection SELECT * FROM premium_orders;
--> statement-breakpoint
CREATE TABLE premium_sessions_collection (
  session_id TEXT PRIMARY KEY,
  reference TEXT NOT NULL REFERENCES premium_orders_collection(reference),
  product_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('payment','subscription')),
  customer_id TEXT,
  payment_intent_id TEXT,
  subscription_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  paid INTEGER NOT NULL CHECK(paid IN (0,1)),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO premium_sessions_collection SELECT * FROM premium_sessions;
--> statement-breakpoint
DROP TABLE premium_sessions;
--> statement-breakpoint
DROP TABLE premium_orders;
--> statement-breakpoint
ALTER TABLE premium_orders_collection RENAME TO premium_orders;
--> statement-breakpoint
ALTER TABLE premium_sessions_collection RENAME TO premium_sessions;
--> statement-breakpoint
CREATE INDEX premium_sessions_reference ON premium_sessions(reference);
--> statement-breakpoint
CREATE INDEX premium_sessions_subscription ON premium_sessions(subscription_id);
--> statement-breakpoint
CREATE TABLE premium_appearances_collection (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  nameplate TEXT CHECK(nameplate IS NULL OR nameplate IN ('gold-banner','vermilion-banner','silver-banner')),
  town TEXT CHECK(town IS NULL OR town IN ('moonlit-castle','sakura-town','snow-town')),
  badge TEXT CHECK(badge IS NULL OR badge IN ('supporter','phoenix-medallion')),
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO premium_appearances_collection SELECT * FROM premium_appearances;
--> statement-breakpoint
DROP TABLE premium_appearances;
--> statement-breakpoint
ALTER TABLE premium_appearances_collection RENAME TO premium_appearances;
--> statement-breakpoint
CREATE VIEW premium_grants AS
SELECT o.user_id,s.product_id,s.session_id AS source_id,s.created_at AS starts_at,NULL AS expires_at
FROM premium_orders o JOIN premium_sessions s ON s.reference=o.reference AND s.product_id=o.product_id
JOIN premium_charges c ON c.payment_intent_id=s.payment_intent_id AND c.amount=s.amount AND c.currency=s.currency AND c.captured=1
WHERE s.mode='payment' AND s.paid=1 AND s.product_id IN ('gold-banner','moonlit-castle','vermilion-banner','silver-banner','phoenix-medallion','sakura-town','snow-town')
AND NOT EXISTS(SELECT 1 FROM premium_blocks b WHERE b.reviewed_revision<b.revision AND ((b.scope='session' AND b.object_id=s.session_id) OR (b.scope='payment_intent' AND b.object_id=s.payment_intent_id) OR (b.scope='charge' AND EXISTS(SELECT 1 FROM premium_charges bc WHERE bc.payment_intent_id=c.payment_intent_id AND bc.charge_id=b.object_id))))
UNION ALL
SELECT o.user_id,'supporter',i.invoice_id,i.period_start,MIN(i.period_end,COALESCE(e.ended_at,i.period_end))
FROM premium_orders o JOIN premium_sessions s ON s.reference=o.reference AND s.product_id=o.product_id
JOIN premium_invoices i ON i.subscription_id=s.subscription_id AND i.customer_id=s.customer_id
JOIN premium_invoice_payments p ON p.invoice_id=i.invoice_id AND p.amount=i.amount AND p.currency=i.currency
JOIN premium_charges c ON c.payment_intent_id=p.payment_intent_id AND c.amount=i.amount AND c.currency=i.currency AND c.captured=1
LEFT JOIN premium_subscription_ends e ON e.subscription_id=i.subscription_id
WHERE s.mode='subscription' AND s.product_id='supporter'
AND NOT EXISTS(SELECT 1 FROM premium_blocks b WHERE b.reviewed_revision<b.revision AND ((b.scope='session' AND b.object_id=s.session_id) OR (b.scope='subscription' AND b.object_id=i.subscription_id) OR (b.scope='invoice' AND b.object_id=i.invoice_id) OR (b.scope='payment_intent' AND b.object_id=p.payment_intent_id) OR (b.scope='charge' AND EXISTS(SELECT 1 FROM premium_charges bc WHERE bc.payment_intent_id=c.payment_intent_id AND bc.charge_id=b.object_id))));
