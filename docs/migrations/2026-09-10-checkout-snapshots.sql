-- Checkout snapshots: move order-recovery state off the payment processor and
-- into our own database.
--
-- Before this, the cart, pricing and integrity fingerprint for an in-flight
-- checkout lived in Stripe PaymentIntent metadata (chunked across six keys to
-- fit a 500-char-per-value limit), and the reconciliation cron found orphaned
-- payments by paging Stripe's API. That made order recovery depend on a
-- processor-specific feature most gateways do not offer.
--
-- `maleq_payment_intent_orders` now carries the snapshot itself. The app
-- applies this automatically at runtime (see lib/checkout/payment-records.ts),
-- but running it by hand keeps that path a no-op and avoids DDL on a cold
-- start. Safe to run against a table that already has rows.
--
-- Run: mysql -u <user> -p <db> < 2026-09-10-checkout-snapshots.sql

-- 1. New columns. Errors with "Duplicate column name" if already applied,
--    which is harmless — check with `SHOW COLUMNS FROM
--    maleq_payment_intent_orders;` first if you want a clean run.
ALTER TABLE maleq_payment_intent_orders
  ADD COLUMN provider       VARCHAR(32)     NOT NULL DEFAULT 'stripe',
  ADD COLUMN amount_cents   BIGINT UNSIGNED NULL,
  ADD COLUMN currency       VARCHAR(8)      NOT NULL DEFAULT 'usd',
  ADD COLUMN customer_email VARCHAR(255)    NULL,
  ADD COLUMN snapshot       LONGTEXT        NULL;

-- 2. Widen the status enum. `pending` is the state create-intent parks a row
--    in: snapshot recorded, nobody has claimed it yet. `abandoned` is a
--    checkout the customer never paid for, which keeps it out of the
--    reconciliation sweep. Existing 'processing'/'completed' rows are
--    unaffected.
ALTER TABLE maleq_payment_intent_orders
  MODIFY COLUMN status ENUM('pending', 'processing', 'completed', 'abandoned')
    NOT NULL DEFAULT 'pending';

-- 3. Index the reconciliation sweep's access path
--    (order_id IS NULL AND status IN (...) AND created_at BETWEEN ...).
ALTER TABLE maleq_payment_intent_orders
  ADD KEY idx_status_created (status, created_at);
