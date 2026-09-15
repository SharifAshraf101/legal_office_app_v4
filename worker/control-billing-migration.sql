-- ============================================================================
-- Phase 4 (billing) migration for the LIVE control database.
--
-- control-schema.sql already carries these columns for a fresh install; this
-- file brings an EXISTING control DB up to the same shape.
--
--   npx wrangler d1 execute legal-office-control --remote \
--     --file=control-billing-migration.sql -c wrangler.v4.toml
--
-- RUN ONCE. SQLite has no `ADD COLUMN IF NOT EXISTS`, so a second run fails with
-- "duplicate column name" — that error means it already applied, not that
-- something broke. The CREATE TABLE / CREATE INDEX / UPDATE statements at the
-- bottom ARE idempotent.
-- ============================================================================

ALTER TABLE tenant ADD COLUMN plan           TEXT    NOT NULL DEFAULT 'standard';
ALTER TABLE tenant ADD COLUMN billing_status TEXT    NOT NULL DEFAULT 'trialing';
ALTER TABLE tenant ADD COLUMN trial_ends_at  TEXT;
ALTER TABLE tenant ADD COLUMN paid_until     TEXT;
ALTER TABLE tenant ADD COLUMN price_amount   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant ADD COLUMN price_currency TEXT    NOT NULL DEFAULT 'ILS';
ALTER TABLE tenant ADD COLUMN billing_note   TEXT;

CREATE TABLE IF NOT EXISTS payment (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  amount       INTEGER NOT NULL DEFAULT 0,
  currency     TEXT NOT NULL DEFAULT 'ILS',
  method       TEXT NOT NULL DEFAULT 'manual',
  reference    TEXT,
  period_start TEXT,
  period_end   TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_tenant ON payment (tenant_id, created_at);

-- Offices that already exist were approved before billing existed. Locking them
-- out the moment this deploys would be wrong, so give every one of them a fresh
-- 14-day trial from the migration date. (The operator office is exempt in code
-- regardless — see billing.ts — so this is only about real tenants.)
UPDATE tenant
   SET billing_status = 'trialing',
       trial_ends_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+14 days')
 WHERE status = 'active'
   AND trial_ends_at IS NULL
   AND paid_until IS NULL;
