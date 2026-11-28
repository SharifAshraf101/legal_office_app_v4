-- "סנכרון נט": hearings read from the court site's "הדיונים שלי" report and
-- entered in the office calendar (worker/src/netsync.ts, enrichHearings).
-- Run ONCE:
--   wrangler d1 execute legal-office-v4 --remote --config wrangler.v4.toml --file=../extensions/worker-snippet/netmishpat-hearings.sql
CREATE TABLE IF NOT EXISTS nm_hearings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'net-hamishpat',
  case_number TEXT NOT NULL,
  hearing_date TEXT NOT NULL,          -- 2026-12-03 (Israel)
  hearing_time TEXT NOT NULL DEFAULT '', -- 10:00 (Israel)
  court TEXT,
  case_name TEXT,
  hearing_type TEXT,
  judge TEXT,
  status TEXT,                         -- as the court site shows it (נקבע, בוטל…)
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  case_id TEXT,                        -- CS-NNNN it belongs to
  event_id TEXT,                       -- calendar entry holding it
  -- added | exists | no_case | ambiguous | cancelled | dismissed
  calendar_status TEXT,
  UNIQUE (source, case_number, hearing_date, hearing_time)
);
