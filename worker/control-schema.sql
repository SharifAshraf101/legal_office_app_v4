-- ============================================================================
-- Control-plane schema (multi-tenant SaaS · Phase 1).
--
-- This database is SEPARATE from every office's data DB. It holds only the
-- SaaS registry: which offices exist, their status, and who belongs to them.
--
-- Better Auth's OWN tables (user, session, account, verification) are created
-- by getMigrations() at deploy time (POST /api/admin/migrate) — do NOT define
-- them here. This file defines only our custom registry tables.
--
-- Apply once to the control DB (after `wrangler d1 create legal-office-control`
-- and wiring the CONTROL_DB binding):
--   npx wrangler d1 execute legal-office-control --remote \
--     --file=control-schema.sql -c wrangler.v4.toml
-- ============================================================================

-- One row per office (tenant). Created 'pending' on sign-up; an admin flips it
-- to 'active'. In Phase 2, `data_db_name` records which D1 holds this office's
-- own case data. Phase 4 adds the subscription columns.
--
-- TWO separate axes, deliberately not merged:
--   status         — ADMINISTRATIVE access (pending / active / suspended).
--   billing_status — COMMERCIAL standing (trialing / active / canceled).
-- An office can be administratively active but commercially lapsed; that
-- combination is exactly what the read-only paywall serves.
CREATE TABLE IF NOT EXISTS tenant (
  id           TEXT PRIMARY KEY,                 -- office id + data-DB scoping key
  name         TEXT NOT NULL,                    -- office display name
  slug         TEXT UNIQUE,                      -- url-safe handle (optional)
  status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'active' | 'suspended'
  data_db_name TEXT,                             -- this office's own D1 (Phase 2)
  created_at   TEXT NOT NULL,                    -- ISO timestamp
  approved_at  TEXT,                             -- ISO timestamp, set on activation

  -- ── Subscription (Phase 4) ────────────────────────────────────────────────
  -- Flat monthly price per office. Only these THREE stored states exist:
  -- 'trialing', 'active', 'canceled'. "past_due" and "expired" are DERIVED at
  -- read time by comparing now against the entitlement date — so no cron job is
  -- needed to age an office out, and nothing can silently fail to run.
  plan           TEXT    NOT NULL DEFAULT 'standard',
  billing_status TEXT    NOT NULL DEFAULT 'trialing',
  trial_ends_at  TEXT,           -- entitlement date while billing_status='trialing'
  paid_until     TEXT,           -- entitlement date while billing_status='active'
  -- Money in MINOR units (agorot) as an integer — never a float.
  price_amount   INTEGER NOT NULL DEFAULT 0,
  price_currency TEXT    NOT NULL DEFAULT 'ILS',
  billing_note   TEXT            -- operator's own note (payment arrangement, contact)
);

-- Payment ledger (Phase 4). One row per payment actually received. Collection is
-- manual for now (bank transfer / הוראת קבע), so this is the record of truth for
-- what was paid and for which period — and the source a real invoice would be
-- built from later. `method` widens to a gateway name when one is wired in.
CREATE TABLE IF NOT EXISTS payment (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,                    -- -> tenant.id
  amount       INTEGER NOT NULL DEFAULT 0,       -- minor units (agorot)
  currency     TEXT NOT NULL DEFAULT 'ILS',
  method       TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | future gateway id
  reference    TEXT,                             -- bank reference / invoice number
  period_start TEXT,                             -- ISO — period this payment covers
  period_end   TEXT,                             -- ISO — becomes tenant.paid_until
  note         TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_tenant ON payment (tenant_id, created_at);

-- Which users belong to which office, and their role. One 'owner' per office
-- to start; the table lets you add staff later with no schema change.
CREATE TABLE IF NOT EXISTS membership (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,                      -- -> Better Auth user.id
  tenant_id  TEXT NOT NULL,                      -- -> tenant.id
  role       TEXT NOT NULL DEFAULT 'owner',      -- 'owner' | 'staff'
  created_at TEXT NOT NULL,
  UNIQUE (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_membership_user   ON membership (user_id);
CREATE INDEX IF NOT EXISTS idx_membership_tenant ON membership (tenant_id);
