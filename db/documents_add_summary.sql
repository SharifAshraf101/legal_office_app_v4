-- Add AI-summary columns to the documents table.
--
-- The document summaries are produced in Cloudflare D1 (file_summary) and
-- shown in the app. This stores a copy on each document row in Supabase so
-- the summary persists with the document (per language).
--
-- Run once in the Supabase SQL Editor.

alter table public.documents add column if not exists summary_he text;
alter table public.documents add column if not exists summary_ar text;
