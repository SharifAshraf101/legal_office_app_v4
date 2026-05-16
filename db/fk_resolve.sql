-- Resolve case_id / client_id UUIDs from their source_id text columns.
--
-- The app writes only the text source_ids (case_source_id, client_source_id)
-- to child tables and leaves the UUID FK columns NULL. This script:
--   1. Adds a BEFORE INSERT/UPDATE trigger to each child table that fills
--      the UUID columns from the matching parent row when the UUID is NULL
--      but the source_id is set.
--   2. Backfills the UUID columns for rows that already exist.
--
-- Safe to re-run. Idempotent.

-- =========================================================================
-- 1. Resolver function
-- =========================================================================
create or replace function public.legal_office_resolve_fk_ids()
returns trigger
language plpgsql
as $$
declare
  v_case_src text;
  v_client_src text;
  v_user uuid := new.user_id;
begin
  -- Pick up the case source_id column if this table has one.
  begin
    v_case_src := (to_jsonb(new) ->> 'case_source_id');
  exception when others then v_case_src := null;
  end;
  -- Pick up the client source_id column if this table has one.
  begin
    v_client_src := (to_jsonb(new) ->> 'client_source_id');
  exception when others then v_client_src := null;
  end;

  -- Resolve case_id from case_source_id when missing.
  if (to_jsonb(new) ? 'case_id')
     and (to_jsonb(new) ->> 'case_id') is null
     and v_case_src is not null
     and v_case_src <> '' then
    execute format(
      'select id from public.cases where user_id = $1 and source_id = $2 limit 1'
    ) into new.case_id using v_user, v_case_src;
  end if;

  -- Resolve client_id from client_source_id when missing.
  if (to_jsonb(new) ? 'client_id')
     and (to_jsonb(new) ->> 'client_id') is null
     and v_client_src is not null
     and v_client_src <> '' then
    execute format(
      'select id from public.clients where user_id = $1 and source_id = $2 limit 1'
    ) into new.client_id using v_user, v_client_src;
  end if;

  return new;
end;
$$;

-- =========================================================================
-- 2. Attach trigger to every child table that has both a source_id text
--    column and a UUID FK column.
-- =========================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'cases', 'tasks', 'calendar_events', 'documents',
    'payments', 'finances', 'timeline_items', 'timeline_entries'
  ]
  loop
    execute format(
      'drop trigger if exists %I_resolve_fk_ids on public.%I;',
      t, t
    );
    execute format(
      'create trigger %I_resolve_fk_ids
         before insert or update on public.%I
         for each row execute function public.legal_office_resolve_fk_ids();',
      t, t
    );
  end loop;
end $$;

-- =========================================================================
-- 3. Backfill existing rows.
-- =========================================================================

-- cases.client_id from cases.client_source_id
update public.cases ca
   set client_id = cl.id
  from public.clients cl
 where ca.client_id is null
   and ca.client_source_id is not null
   and ca.client_source_id <> ''
   and cl.user_id = ca.user_id
   and cl.source_id = ca.client_source_id;

-- tasks.case_id, tasks.client_id
update public.tasks t
   set case_id = ca.id
  from public.cases ca
 where t.case_id is null
   and t.case_source_id is not null
   and t.case_source_id <> ''
   and ca.user_id = t.user_id
   and ca.source_id = t.case_source_id;

update public.tasks t
   set client_id = cl.id
  from public.clients cl
 where t.client_id is null
   and t.client_source_id is not null
   and t.client_source_id <> ''
   and cl.user_id = t.user_id
   and cl.source_id = t.client_source_id;

-- calendar_events.case_id, calendar_events.client_id
update public.calendar_events e
   set case_id = ca.id
  from public.cases ca
 where e.case_id is null
   and e.case_source_id is not null
   and e.case_source_id <> ''
   and ca.user_id = e.user_id
   and ca.source_id = e.case_source_id;

update public.calendar_events e
   set client_id = cl.id
  from public.clients cl
 where e.client_id is null
   and e.client_source_id is not null
   and e.client_source_id <> ''
   and cl.user_id = e.user_id
   and cl.source_id = e.client_source_id;

-- documents.case_id, documents.client_id
update public.documents d
   set case_id = ca.id
  from public.cases ca
 where d.case_id is null
   and d.case_source_id is not null
   and d.case_source_id <> ''
   and ca.user_id = d.user_id
   and ca.source_id = d.case_source_id;

update public.documents d
   set client_id = cl.id
  from public.clients cl
 where d.client_id is null
   and d.client_source_id is not null
   and d.client_source_id <> ''
   and cl.user_id = d.user_id
   and cl.source_id = d.client_source_id;

-- payments.case_id
update public.payments p
   set case_id = ca.id
  from public.cases ca
 where p.case_id is null
   and p.case_source_id is not null
   and p.case_source_id <> ''
   and ca.user_id = p.user_id
   and ca.source_id = p.case_source_id;

-- finances.case_id
update public.finances f
   set case_id = ca.id
  from public.cases ca
 where f.case_id is null
   and f.case_source_id is not null
   and f.case_source_id <> ''
   and ca.user_id = f.user_id
   and ca.source_id = f.case_source_id;

-- timeline_items.case_id
update public.timeline_items ti
   set case_id = ca.id
  from public.cases ca
 where ti.case_id is null
   and ti.case_source_id is not null
   and ti.case_source_id <> ''
   and ca.user_id = ti.user_id
   and ca.source_id = ti.case_source_id;

-- timeline_entries.case_id
update public.timeline_entries te
   set case_id = ca.id
  from public.cases ca
 where te.case_id is null
   and te.case_source_id is not null
   and te.case_source_id <> ''
   and ca.user_id = te.user_id
   and ca.source_id = te.case_source_id;
