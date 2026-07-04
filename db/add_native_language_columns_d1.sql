-- =========================================================================
-- add_native_language_columns_d1.sql
-- =========================================================================
-- Adds a "native language" summary/draft column so the case-brain boxes can
-- show a document's decode + reply draft in the DOCUMENT'S OWN language —
-- including languages beyond Hebrew/Arabic (English, French, Russian, …).
--
--   file_summary.summary_orig  — the summary in the document's own language
--   drafts.draft_orig          — the reply draft in the document's own language
--
-- The existing summary_he / summary_ar / draft_he / draft_ar columns are kept
-- for the bilingual UI and other screens; `language` already holds the code.
--
-- Apply (remote v4) from the worker/ dir:
--   npx wrangler d1 execute legal-office-v4 --remote -c wrangler.v4.toml \
--       --file=../db/add_native_language_columns_d1.sql
-- SQLite has no "ADD COLUMN IF NOT EXISTS"; running twice errors harmlessly
-- ("duplicate column name") — safe to ignore on a re-run.
-- =========================================================================

ALTER TABLE file_summary ADD COLUMN summary_orig TEXT;
ALTER TABLE drafts ADD COLUMN draft_orig TEXT;
