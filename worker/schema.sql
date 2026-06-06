-- D1 (SQLite) schema for the legal-office app. Translated from db/schema.sql
-- (Postgres). Apply with:
--   wrangler d1 execute legal-office --remote --file=schema.sql
--
-- Type mapping from the Postgres original:
--   uuid        -> text
--   timestamptz -> text   (ISO-8601 'Z' strings; the app treats dates as strings)
--   date        -> text   (YYYY-MM-DD strings)
--   numeric     -> real
--   jsonb       -> text   (JSON.stringify / JSON.parse at the edge)
--
-- The app keys every relationship off the `*_source_id` text columns, never the
-- Postgres UUID FKs, so the `client_id` / `case_id` FK columns are dropped. The
-- `(user_id, source_id)` UNIQUE drives the INSERT ... ON CONFLICT upsert. The
-- alias tables `finances` / `timeline_entries` are collapsed into
-- `payments` / `timeline_items` (the migration folds any legacy rows in).
--
-- `id` is filled by the Worker with crypto.randomUUID() on insert. created_at /
-- updated_at are stamped by the Worker (SQLite has no now()-on-update default);
-- the column defaults below only matter for rows inserted by raw SQL (migration).

-- =========================================================================
-- 1. clients
-- =========================================================================
create table if not exists clients (
  id            text primary key,
  user_id       text not null,
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
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);

-- =========================================================================
-- 2. cases
-- =========================================================================
create table if not exists cases (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  client_source_id  text,
  case_number       text,
  title             text,
  title_ar          text,
  status            text not null default 'active',
  description       text,
  description_ar    text,
  court             text,
  court_ar          text,
  agreed_fee        real not null default 0,
  last_hearing      text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);
create index if not exists cases_client_source_id_idx
  on cases (user_id, client_source_id);

-- =========================================================================
-- 3. tasks
-- =========================================================================
create table if not exists tasks (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  case_source_id    text,
  client_source_id  text,
  title             text not null default '',
  due_date          text,
  status            text not null default 'open',
  priority          text not null default 'normal',
  notes             text,
  done_at           text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);
create index if not exists tasks_case_source_id_idx
  on tasks (user_id, case_source_id);

-- =========================================================================
-- 4. calendar_events
-- =========================================================================
create table if not exists calendar_events (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  case_source_id    text,
  client_source_id  text,
  title             text,
  title_ar          text,
  date_time         text,
  description       text,
  description_ar    text,
  type              text not null default 'hearingMeeting',
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);
create index if not exists calendar_events_case_source_id_idx
  on calendar_events (user_id, case_source_id);
create index if not exists calendar_events_date_time_idx
  on calendar_events (user_id, date_time);

-- =========================================================================
-- 5. documents  (summary_he / summary_ar match db/documents_add_summary.sql)
-- =========================================================================
create table if not exists documents (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  case_source_id    text,
  client_source_id  text,
  title             text,
  title_ar          text,
  description       text,
  description_ar    text,
  file_name         text,
  relative_path     text,
  date              text,
  summary_he        text,
  summary_ar        text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);
create index if not exists documents_case_source_id_idx
  on documents (user_id, case_source_id);

-- =========================================================================
-- 6. payments  (the app calls this collection "finances")
-- =========================================================================
create table if not exists payments (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  case_source_id    text,
  date              text,
  amount            real not null default 0,
  type              text not null default 'payment',
  description       text,
  description_ar    text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);
create index if not exists payments_case_source_id_idx
  on payments (user_id, case_source_id);

-- =========================================================================
-- 7. timeline_items
-- =========================================================================
create table if not exists timeline_items (
  id                text primary key,
  user_id           text not null,
  source_id         text not null,
  case_source_id    text,
  type              text not null default 'note',
  title             text,
  title_ar          text,
  date              text,
  description       text,
  description_ar    text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (user_id, source_id)
);
create index if not exists timeline_items_case_source_id_idx
  on timeline_items (user_id, case_source_id);

-- =========================================================================
-- 8. app_state  (whole-app JSON blob fallback — the loader reads this when
--                every per-table query returns zero rows)
-- =========================================================================
create table if not exists app_state (
  user_id     text primary key,
  state       text not null default '{}',
  payload     text not null default '{}',
  data        text not null default '{}',
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
