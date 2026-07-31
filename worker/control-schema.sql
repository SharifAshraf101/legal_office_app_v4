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
-- own case data.
CREATE TABLE IF NOT EXISTS tenant (
  id           TEXT PRIMARY KEY,                 -- office id + data-DB scoping key
  name         TEXT NOT NULL,                    -- office display name
  slug         TEXT UNIQUE,                      -- url-safe handle (optional)
  status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'active' | 'suspended'
  data_db_name TEXT,                             -- this office's own D1 (Phase 2)
  created_at   TEXT NOT NULL,                    -- ISO timestamp
  approved_at  TEXT                              -- ISO timestamp, set on activation
);

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
