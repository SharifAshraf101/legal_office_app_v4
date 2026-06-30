-- =========================================================================
-- reset_all_data_d1.sql  —  FULL FACTORY RESET of the legal-office D1 (v4)
-- =========================================================================
--
-- ⚠️  DESTRUCTIVE AND IRREVERSIBLE.  ⚠️
-- מוחק את כל השורות מכל הטבלאות של מסד הנתונים legal-office-v4 (D1/SQLite),
-- ומשאיר את הסכימה (הטבלאות עצמן) על כנה — מסד נתונים נקי להתחלה מחדש.
--
-- HOW TO RUN (remote v4 database):
--   cd worker
--   npx wrangler d1 execute legal-office-v4 --remote \
--       -c wrangler.v4.toml --file=../db/reset_all_data_d1.sql
--
-- This empties every table in worker/schema.sql. The tables/indexes stay;
-- only the rows are removed.
-- =========================================================================

delete from timeline_items;
delete from documents;
delete from payments;
delete from calendar_events;
delete from tasks;
delete from cases;
delete from clients;

-- Whole-app JSON snapshot fallback — must be cleared too, or a device would
-- re-hydrate the app from it even after the per-table rows are gone.
delete from app_state;
