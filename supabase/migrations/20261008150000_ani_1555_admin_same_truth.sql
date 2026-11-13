-- ANI-1555: one private-to-operators classification per immutable workspace UUID.
-- Display names are not unique. Legacy workspace_kind and email patterns are
-- diagnostic hints only: do not silently assign TEST/CANARY from either.
create table public.workspace_registry (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  dataset_mode text not null default 'ACTUAL' check (dataset_mode in ('ACTUAL', 'TEST', 'CANARY')),
  actor_kind text not null default 'UNCLASSIFIED' check (actor_kind in ('CUSTOMER', 'OPERATOR', 'TESTER', 'UNCLASSIFIED')),
  created_source text not null check (char_length(created_source) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspace_registry_mode_actor_idx on public.workspace_registry (dataset_mode, actor_kind, workspace_id);
create trigger workspace_registry_set_updated_at before update on public.workspace_registry
  for each row execute function private.set_updated_at();

create function private.protect_workspace_registry_id()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'WORKSPACE_ID_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger workspace_registry_id_immutable before update on public.workspace_registry
  for each row execute function private.protect_workspace_registry_id();
revoke all on function private.protect_workspace_registry_id() from public, anon, authenticated;

-- Existing records remain ACTUAL, including suspected test accounts; a human
-- must explicitly review and reclassify them. Preserve the original created_at.
insert into public.workspace_registry (workspace_id, display_name, dataset_mode, actor_kind, created_source, created_at)
select id, name, 'ACTUAL', 'UNCLASSIFIED', 'legacy_backfill', created_at
from public.workspaces
on conflict (workspace_id) do nothing;

-- Concurrent signup paths insert into workspaces through several functions.
-- Maintain completeness without editing those paths or granting client access.
create function private.register_workspace_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_registry (workspace_id, display_name, dataset_mode, actor_kind, created_source, created_at)
  values (new.id, new.name, 'ACTUAL', 'UNCLASSIFIED', 'workspace_insert', new.created_at)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;
create trigger workspaces_register_identity after insert on public.workspaces
  for each row execute function private.register_workspace_identity();
revoke all on function private.register_workspace_identity() from public, anon, authenticated;

-- Count only currently classified ACTUAL customer workspaces at read time.
-- The join prevents a mode change between the registry read and vault count
-- from leaking TEST/CANARY records into an ACTUAL metric.
create function public.count_admin_actual_vault_items(p_workspace_ids uuid[])
returns integer language sql stable security invoker set search_path = '' as $$
  select count(*)::integer
  from public.vault_items item
  join public.workspace_registry registry on registry.workspace_id = item.workspace_id
  where item.workspace_id = any(p_workspace_ids)
    and registry.dataset_mode = 'ACTUAL' and registry.actor_kind = 'CUSTOMER'
    and item.release_gate is not null and item.deleted_at is null;
$$;
revoke all on function public.count_admin_actual_vault_items(uuid[]) from public, anon, authenticated;
grant execute on function public.count_admin_actual_vault_items(uuid[]) to service_role;

-- Registry is operational metadata; membership in a workspace does not grant access.
-- Only the server-side service_role can read or change classifications.
alter table public.workspace_registry enable row level security;
revoke all on public.workspace_registry from public, anon, authenticated;
grant select, insert, update, delete on public.workspace_registry to service_role;
create policy workspace_registry_service_only on public.workspace_registry
  for all to service_role using (true) with check (true);

-- Rollback (isolated environment only, after exporting operator classifications):
-- drop trigger if exists workspaces_register_identity on public.workspaces;
-- drop function if exists private.register_workspace_identity();
-- drop function if exists private.protect_workspace_registry_id();
-- drop function if exists public.count_admin_actual_vault_items(uuid[]);
-- drop table if exists public.workspace_registry;
