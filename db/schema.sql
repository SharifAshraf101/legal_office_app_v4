-- Supabase schema for legal-office-next.
-- Run this once in the Supabase SQL editor against the project that the app
-- talks to (configured in lib/supabase.ts as SUPABASE_URL + USER_ID).
--
-- Column names match the field aliases the loader reads in lib/supabase.ts
-- (normalizeClient, normalizeCase, normalizeTask, normalizeEvent,
-- normalizeDocument, normalizeFinance + the timeline branch). When the
-- write-back code lands it writes to the *same* columns, so a row written
-- by one device and read by another round-trips losslessly.
--
-- Each row carries a `source_id` (the app's local "CLT-..." / "CS-..." id)
-- plus a Supabase-managed `id` UUID. The unique (user_id, source_id)
-- constraint is what lets the write path use Postgres UPSERTs on conflict.
--
-- RLS is enabled with a single permissive policy scoped to one hardcoded
-- user_id, matching how the app reads/writes today. Tighten this once you
-- introduce Supabase Auth (the policy would change to
-- `using (user_id = auth.uid())`).

-- =========================================================================
-- 0. Helpers
-- =========================================================================

-- gen_random_uuid() needs pgcrypto on older projects; modern Supabase
-- ships it enabled, this is just defensive.
create extension if not exists pgcrypto;

-- The single user this app currently serves. Update both this constant and
-- USER_ID in lib/supabase.ts together if you ever swap projects/users.
do $$ begin
  if not exists (select 1 from pg_settings where name = 'app.legal_office_user_id') then
    perform set_config(
      'app.legal_office_user_id',
      'c0307382-5fd2-4a2b-88df-40b22bb9ad26',
      false
    );
  end if;
end $$;

-- =========================================================================
-- 1. clients
-- =========================================================================
create table if not exists public.clients (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  source_id     text not null,
  full_name     text,
  full_name_ar  text,
  phone         text,
  email         text,
  id_number     text,
  address       text,
  address_ar    text,
  notes         text,
  notes_ar      text,
  photo_url     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, source_id)
);

-- =========================================================================
-- 2. cases
-- =========================================================================
create table if not exists public.cases (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  source_id         text not null,
  client_source_id  text,
  client_id         uuid references public.clients(id) on delete set null,
  case_number       text,
  title             text,
  title_ar          text,
  status            text not null default 'active',
  description       text,
  description_ar    text,
  court             text,
  court_ar          text,
  agreed_fee        numeric not null default 0,
  last_hearing      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, source_id)
);
create index if not exists cases_client_source_id_idx
  on public.cases (user_id, client_source_id);

-- =========================================================================
-- 3. tasks
-- =========================================================================
create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  source_id         text not null,
  case_source_id    text,
  client_source_id  text,
  case_id           uuid references public.cases(id) on delete set null,
  client_id         uuid references public.clients(id) on delete set null,
  title             text not null,
  due_date          date,
  status            text not null default 'open',
  priority          text not null default 'normal',
  notes             text,
  created_at        timestamptz not null default now(),
  done_at           timestamptz,
  updated_at        timestamptz not null default now(),
  unique (user_id, source_id)
);
create index if not exists tasks_case_source_id_idx
  on public.tasks (user_id, case_source_id);

-- =========================================================================
-- 4. calendar_events
-- =========================================================================
create table if not exists public.calendar_events (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  source_id         text not null,
  case_source_id    text,
  client_source_id  text,
  case_id           uuid references public.cases(id) on delete set null,
  client_id         uuid references public.clients(id) on delete set null,
  title             text,
  title_ar          text,
  date_time         timestamptz,
  description       text,
  description_ar    text,
  type              text not null default 'hearingMeeting',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, source_id)
);
create index if not exists calendar_events_case_source_id_idx
  on public.calendar_events (user_id, case_source_id);
create index if not exists calendar_events_date_time_idx
  on public.calendar_events (user_id, date_time);

-- =========================================================================
-- 5. documents
-- =========================================================================
create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  source_id         text not null,
  case_source_id    text,
  client_source_id  text,
  case_id           uuid references public.cases(id) on delete set null,
  client_id         uuid references public.clients(id) on delete set null,
  title             text,
  file_name         text,
  relative_path     text,
  date              date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, source_id)
);
create index if not exists documents_case_source_id_idx
  on public.documents (user_id, case_source_id);

-- =========================================================================
-- 6. payments  (the app calls this collection "finances"; the loader
--               merges rows from both `finances` and `payments` tables)
-- =========================================================================
create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  source_id         text not null,
  case_source_id    text,
  case_id           uuid references public.cases(id) on delete set null,
  date              date,
  amount            numeric not null default 0,
  type              text not null default 'payment',
  description       text,
  description_ar    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, source_id)
);
create index if not exists payments_case_source_id_idx
  on public.payments (user_id, case_source_id);

-- =========================================================================
-- 7. timeline_items
-- =========================================================================
create table if not exists public.timeline_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  source_id         text not null,
  case_source_id    text,
  case_id           uuid references public.cases(id) on delete set null,
  type              text not null default 'note',
  title             text,
  title_ar          text,
  date              date,
  description       text,
  description_ar    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, source_id)
);
create index if not exists timeline_items_case_source_id_idx
  on public.timeline_items (user_id, case_source_id);

-- =========================================================================
-- updated_at triggers
-- =========================================================================
create or replace function public.legal_office_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'cases', 'tasks', 'calendar_events',
    'documents', 'payments', 'timeline_items'
  ]
  loop
    execute format(
      'drop trigger if exists %I_touch_updated_at on public.%I;',
      t, t
    );
    execute format(
      'create trigger %I_touch_updated_at
         before update on public.%I
         for each row execute function public.legal_office_touch_updated_at();',
      t, t
    );
  end loop;
end $$;

-- =========================================================================
-- Row Level Security: permissive policy scoped to the single configured
-- user_id. The app talks to PostgREST with the anon key, so without these
-- policies every read/write would be denied.
-- =========================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'clients', 'cases', 'tasks', 'calendar_events',
    'documents', 'payments', 'timeline_items'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "legal_office_user_select" on public.%I;', t);
    execute format(
      'create policy "legal_office_user_select" on public.%I
         for select to anon, authenticated
         using (user_id = ''c0307382-5fd2-4a2b-88df-40b22bb9ad26''::uuid);',
      t
    );
    execute format('drop policy if exists "legal_office_user_modify" on public.%I;', t);
    execute format(
      'create policy "legal_office_user_modify" on public.%I
         for all to anon, authenticated
         using (user_id = ''c0307382-5fd2-4a2b-88df-40b22bb9ad26''::uuid)
         with check (user_id = ''c0307382-5fd2-4a2b-88df-40b22bb9ad26''::uuid);',
      t
    );
  end loop;
end $$;
