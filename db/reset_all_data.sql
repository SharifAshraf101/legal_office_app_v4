-- =========================================================================
-- reset_all_data.sql  —  FULL FACTORY RESET of the legal-office data
-- =========================================================================
--
-- ⚠️  DESTRUCTIVE AND IRREVERSIBLE.  ⚠️
-- מוחק את כל הלקוחות, התיקים, המסמכים, האירועים, המשימות, הכספים והציר —
-- מחזיר את המערכת למצב ריק לחלוטין. אין דרך לשחזר אחרי הרצה.
--
-- HOW TO RUN:
--   1. Supabase dashboard → SQL Editor → New query → paste this whole file.
--   2. (Recommended) FIRST run the SELECT block at the bottom to see the row
--      counts you are about to delete, so there are no surprises.
--   3. Run the file. Everything for this user_id is wiped.
--
-- This is scoped to the single configured user_id used by the app
-- (see USER_ID in lib/supabase.ts + schema.sql). It will NOT touch any
-- other user's rows.
--
-- IMPORTANT — this is only step 1 of 3 for a clean re-filing. See the
-- notes the assistant gave you: you must ALSO (a) clear the browser
-- localStorage, and (b) delete the old files in Dropbox / Supabase Storage,
-- otherwise the bidirectional sync can repopulate the cloud.
-- =========================================================================

-- The single user this app serves. If you ever change USER_ID in
-- lib/supabase.ts, change the UUID below (every line) to match.
-- The full UUID is inlined on each statement instead of a psql \set
-- variable, because the Supabase SQL Editor does not support psql
-- meta-commands — this way it pastes and runs as-is anywhere.

begin;

-- ---- 1. Database rows --------------------------------------------------
-- FKs are ON DELETE SET NULL, so order is not strictly required, but we
-- delete children before parents anyway for tidiness.

delete from public.timeline_items   where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'::uuid;
delete from public.timeline_entries where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'::uuid;
delete from public.payments         where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'::uuid;
delete from public.finances         where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'::uuid;
delete from public.documents        where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'::uuid;
delete from public.calendar_events  where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'::uuid;
delete from public.tasks            where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'::uuid;
delete from public.cases            where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'::uuid;
delete from public.clients          where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'::uuid;

-- Whole-app JSON snapshot fallback (loader reads this when per-table
-- queries return zero rows — must be cleared too, or a new device would
-- re-hydrate from it).
delete from public.app_state        where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'::uuid;

-- ---- 2. Stored document files -----------------------------------------
-- File bytes uploaded via the app live in the Supabase Storage bucket
-- `legal-office-documents`. Empty it so no orphaned files remain.
-- (This does NOT touch files stored in your Dropbox — delete those
-- separately in the Dropbox UI, see the assistant's instructions.)
delete from storage.objects where bucket_id = 'legal-office-documents';

commit;

-- =========================================================================
-- VERIFICATION — run this AFTER the commit (or the SELECT-only preview
-- BEFORE) to confirm every table is empty for this user.
-- =========================================================================
-- select 'clients'         as tbl, count(*) from public.clients          where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'
-- union all select 'cases',            count(*) from public.cases            where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'
-- union all select 'tasks',            count(*) from public.tasks            where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'
-- union all select 'calendar_events',  count(*) from public.calendar_events  where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'
-- union all select 'documents',        count(*) from public.documents        where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'
-- union all select 'payments',         count(*) from public.payments         where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'
-- union all select 'finances',         count(*) from public.finances         where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'
-- union all select 'timeline_items',   count(*) from public.timeline_items   where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'
-- union all select 'timeline_entries', count(*) from public.timeline_entries where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26'
-- union all select 'app_state',        count(*) from public.app_state        where user_id = 'c0307382-5fd2-4a2b-88df-40b22bb9ad26';
