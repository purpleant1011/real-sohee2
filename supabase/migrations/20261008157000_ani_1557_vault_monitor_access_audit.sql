-- ANI-1557: append-only record of operators opening the vault monitor / invariant detail.
-- Additive only. The monitor is read-only; this table only records who looked at what.
create table public.vault_monitor_access_events (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null check (char_length(actor_id) between 1 and 200),
  access_kind text not null check (access_kind in ('MONITOR_VIEW', 'INVARIANT_DETAIL_VIEW')),
  workspace_count integer not null check (workspace_count >= 0),
  violation_count integer not null check (violation_count >= 0),
  disclosed_item_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default statement_timestamp()
);
create index vault_monitor_access_events_created_idx
  on public.vault_monitor_access_events (created_at desc, id);

create function private.prevent_vault_monitor_access_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'VAULT_MONITOR_ACCESS_IMMUTABLE';
end;
$$;
revoke all on function private.prevent_vault_monitor_access_change() from public, anon, authenticated;
create trigger vault_monitor_access_events_immutable
  before update or delete on public.vault_monitor_access_events
  for each row execute function private.prevent_vault_monitor_access_change();

alter table public.vault_monitor_access_events enable row level security;
revoke all on public.vault_monitor_access_events from public, anon, authenticated;
grant select, insert on public.vault_monitor_access_events to service_role;
create policy vault_monitor_access_events_service_only on public.vault_monitor_access_events
  for all to service_role using (true) with check (true);

-- Rollback (isolated environment only, after exporting the audit rows):
-- drop trigger if exists vault_monitor_access_events_immutable on public.vault_monitor_access_events;
-- drop function if exists private.prevent_vault_monitor_access_change();
-- drop table if exists public.vault_monitor_access_events;
