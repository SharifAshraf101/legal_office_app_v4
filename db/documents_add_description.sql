-- Add description / title_ar / description_ar columns to the documents
-- table so the app can store a document's description (rendered next to the
-- title in the case timeline) and its Arabic-language pair fields.
--
-- Safe to re-run. Idempotent.

alter table public.documents
  add column if not exists title_ar       text,
  add column if not exists description    text,
  add column if not exists description_ar text;
