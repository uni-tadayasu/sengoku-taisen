-- Paid cosmetics are independent of the importable game save and game economy.
CREATE TABLE premium_orders (
  reference TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL CHECK(product_id IN ('gold-banner','moonlit-castle','supporter')),
  created_at INTEGER NOT NULL,
  UNIQUE(user_id,product_id)
);
--> statement-breakpoint
CREATE TABLE premium_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK(disposition IN ('accepted','ignored','quarantined')),
  reason TEXT NOT NULL,
  event_created INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  commit_token TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE premium_sessions (
  session_id TEXT PRIMARY KEY,
  reference TEXT NOT NULL REFERENCES premium_orders(reference),
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
CREATE INDEX premium_sessions_reference ON premium_sessions(reference);
--> statement-breakpoint
CREATE INDEX premium_sessions_subscription ON premium_sessions(subscription_id);
--> statement-breakpoint
CREATE TABLE premium_invoices (
  invoice_id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX premium_invoices_subscription ON premium_invoices(subscription_id,period_end);
--> statement-breakpoint
CREATE TABLE premium_invoice_payments (
  payment_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX premium_invoice_payments_invoice ON premium_invoice_payments(invoice_id);
--> statement-breakpoint
CREATE TABLE premium_charges (
  charge_id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  captured INTEGER NOT NULL CHECK(captured IN (0,1)),
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX premium_charges_intent ON premium_charges(payment_intent_id);
--> statement-breakpoint
CREATE TABLE premium_blocks (
  scope TEXT NOT NULL CHECK(scope IN ('session','payment_intent','charge','invoice','subscription')),
  object_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL REFERENCES premium_events(event_id),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  reviewed_revision INTEGER NOT NULL DEFAULT 0 CHECK(reviewed_revision>=0 AND reviewed_revision<=revision),
  PRIMARY KEY(scope,object_id)
);
--> statement-breakpoint
CREATE TABLE premium_reviews (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  object_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  expected_event_id TEXT NOT NULL REFERENCES premium_events(event_id),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(actor_id,request_id)
);
--> statement-breakpoint
CREATE TABLE premium_subscription_ends (
  subscription_id TEXT PRIMARY KEY,
  ended_at INTEGER NOT NULL,
  source_event_id TEXT NOT NULL REFERENCES premium_events(event_id)
);
--> statement-breakpoint
CREATE TABLE premium_appearances (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  nameplate TEXT CHECK(nameplate IS NULL OR nameplate='gold-banner'),
  town TEXT CHECK(town IS NULL OR town='moonlit-castle'),
  badge TEXT CHECK(badge IS NULL OR badge='supporter'),
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
-- Derivation makes deliveries order independent. A block that arrives before
-- its checkout/invoice/charge is still effective when those facts arrive later.
CREATE VIEW premium_grants AS
SELECT o.user_id,s.product_id,s.session_id AS source_id,s.created_at AS starts_at,NULL AS expires_at
FROM premium_orders o JOIN premium_sessions s ON s.reference=o.reference AND s.product_id=o.product_id
JOIN premium_charges c ON c.payment_intent_id=s.payment_intent_id AND c.amount=s.amount AND c.currency=s.currency AND c.captured=1
WHERE s.mode='payment' AND s.paid=1 AND s.product_id IN ('gold-banner','moonlit-castle')
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
