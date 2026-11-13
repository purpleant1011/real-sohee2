-- Vault retention: only this service-role entrypoint may erase expired vault history.
-- The content/version FKs are RESTRICT and the event/preflight FKs are RESTRICT:
-- keep them that way. Explicitly delete dependent rows first instead of introducing an
-- ON DELETE CASCADE path that would silently erase append-only events on ordinary writes.
-- A workspace deletion worker must call purge_workspace_vault_data(workspace_id) BEFORE
-- deleting the workspace (and before deleting the owning auth user); this migration
-- deliberately does not authorize ordinary clients to delete workspaces or users.

create index if not exists vault_items_purge_age_idx
  on public.vault_items (deleted_at, workspace_id, id)
  where deleted_at is not null;

-- Only DELETE in the definer's transaction-local context is exempted; even an
-- authorized service_role session cannot toggle a GUC and delete/update directly.
create or replace function private.prevent_vault_event_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE'
    and pg_catalog.current_setting('sohee.vault_purge', true) = 'on'
    and current_user = (
      select pg_catalog.pg_get_userbyid(p.proowner)
      from pg_catalog.pg_proc p
      where p.oid = 'public.purge_workspace_vault_data(uuid)'::pg_catalog.regprocedure
    )
  then
    return old;
  end if;
  raise exception 'Vault events are append-only' using errcode = '23514';
end;
$$;
revoke all on function private.prevent_vault_event_mutation() from public, anon, authenticated, service_role;

-- Internal shared purge: accepts a prelocked, workspace-scoped ID set only from
-- the two privileged entrypoints. No public EXECUTE grant, not exposed to PostgREST.
create function private.purge_vault_item_ids(p_workspace_id uuid, p_item_ids uuid[], p_event_type text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n_events integer := 0;
  n_preflight integer := 0;
  n_payloads integer := 0;
  n_renditions integer := 0;
  n_urls integer := 0;
  n_funnel integer := 0;
  n_items integer := 0;
  totals jsonb;
begin
  if current_setting('role', true) is distinct from 'service_role'
    or p_workspace_id is null
    or p_item_ids is null or array_length(p_item_ids, 1) is null
    or p_event_type not in ('vault.purge.deleted', 'vault.purge.workspace')
    or exists (select 1 from public.vault_items i
               where i.id = any(p_item_ids) and i.workspace_id <> p_workspace_id)
  then
    raise exception 'VAULT_PURGE_FORBIDDEN' using errcode = '42501';
  end if;

  -- A SET LOCAL inside this function cannot turn direct service-role DML into
  -- owner DML: the trigger checks both the setting and current_user.
  perform pg_catalog.set_config('sohee.vault_purge', 'on', true);
  delete from public.vault_events
    where workspace_id = p_workspace_id and vault_item_id = any(p_item_ids);
  get diagnostics n_events = row_count;
  delete from public.preflight_runs
    where workspace_id = p_workspace_id and vault_item_id = any(p_item_ids);
  get diagnostics n_preflight = row_count;
  delete from public.vault_variant_payloads
    where workspace_id = p_workspace_id and vault_item_id = any(p_item_ids);
  get diagnostics n_payloads = row_count;
  delete from public.vault_image_renditions
    where workspace_id = p_workspace_id and vault_item_id = any(p_item_ids);
  get diagnostics n_renditions = row_count;
  delete from public.vault_published_urls
    where workspace_id = p_workspace_id and vault_item_id = any(p_item_ids);
  get diagnostics n_urls = row_count;
  -- Vault funnel telemetry has no FK: only the exact vaultItemId property is
  -- related to the purged item; other workspace funnel events are preserved.
  delete from public.funnel_events
    where workspace_id = p_workspace_id
      and properties ->> 'vaultItemId' = any(p_item_ids::text[]);
  get diagnostics n_funnel = row_count;
  delete from public.vault_items
    where workspace_id = p_workspace_id and id = any(p_item_ids);
  get diagnostics n_items = row_count;
  if n_items <> pg_catalog.cardinality(p_item_ids) then
    raise exception 'VAULT_PURGE_CONCURRENT_CHANGE' using errcode = '40001';
  end if;
  totals := pg_catalog.jsonb_build_object(
    'items', n_items, 'events', n_events, 'preflight_runs', n_preflight,
    'variant_payloads', n_payloads, 'image_renditions', n_renditions,
    'published_urls', n_urls, 'funnel_events', n_funnel
  );
  -- audit_events is the existing workspace audit log. No item IDs, user IDs,
  -- URLs, event payloads, or content survive here; do not emit a row on no-op.
  insert into public.audit_events (workspace_id, actor_id, event_type, entity_type, metadata)
    values (p_workspace_id, null, p_event_type, 'vault_retention', totals);
  return totals;
end;
$$;
revoke all on function private.purge_vault_item_ids(uuid, uuid[], text)
  from public, anon, authenticated, service_role;

create function public.purge_deleted_vault_items(
  p_older_than interval default interval '30 days', p_limit integer default 500
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_workspace uuid;
  ids uuid[];
begin
  -- Do not allow the retention window to be shortened or the batch limit to
  -- exceed the reviewed maximum, even for a service-role caller.
  if current_setting('role', true) is distinct from 'service_role'
    or p_older_than is null or p_older_than < interval '30 days'
    or p_limit is null or p_limit not between 1 and 500
  then
    raise exception 'VAULT_PURGE_INVALID_ARGUMENT' using errcode = '22023';
  end if;

  -- One workspace per call keeps one aggregate audit row attributable to its
  -- workspace; concurrent workers skip locked rows instead of racing on them.
  select i.workspace_id into target_workspace
  from public.vault_items i
  where i.deleted_at is not null and i.deleted_at <= pg_catalog.statement_timestamp() - p_older_than
  order by i.deleted_at, i.workspace_id, i.id
  limit 1 for update skip locked;
  if target_workspace is null then
    return pg_catalog.jsonb_build_object('items', 0, 'events', 0,
      'preflight_runs', 0, 'variant_payloads', 0, 'image_renditions', 0,
      'published_urls', 0, 'funnel_events', 0);
  end if;
  select pg_catalog.array_agg(chosen.id) into ids from (
    select i.id from public.vault_items i
    where i.workspace_id = target_workspace
      and i.deleted_at is not null and i.deleted_at <= pg_catalog.statement_timestamp() - p_older_than
    order by i.deleted_at, i.id limit p_limit for update skip locked
  ) chosen;
  if ids is null then
    return pg_catalog.jsonb_build_object('items', 0, 'events', 0,
      'preflight_runs', 0, 'variant_payloads', 0, 'image_renditions', 0,
      'published_urls', 0, 'funnel_events', 0);
  end if;
  return private.purge_vault_item_ids(target_workspace, ids, 'vault.purge.deleted');
end;
$$;
revoke all on function public.purge_deleted_vault_items(interval, integer)
  from public, anon, authenticated;
grant execute on function public.purge_deleted_vault_items(interval, integer) to service_role;

create function public.purge_workspace_vault_data(p_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[];
begin
  if current_setting('role', true) is distinct from 'service_role'
    or p_workspace_id is null
  then
    raise exception 'VAULT_PURGE_FORBIDDEN' using errcode = '42501';
  end if;
  -- Lock the parent to serialize with workspace DELETE and to prevent a new
  -- vault_item from being inserted while its children are being removed.
  perform 1 from public.workspaces where id = p_workspace_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('items', 0, 'events', 0,
      'preflight_runs', 0, 'variant_payloads', 0, 'image_renditions', 0,
      'published_urls', 0, 'funnel_events', 0);
  end if;
  select pg_catalog.array_agg(i.id) into ids
    from (select id from public.vault_items where workspace_id = p_workspace_id
          order by id for update) i;
  if ids is null then
    return pg_catalog.jsonb_build_object('items', 0, 'events', 0,
      'preflight_runs', 0, 'variant_payloads', 0, 'image_renditions', 0,
      'published_urls', 0, 'funnel_events', 0);
  end if;
  return private.purge_vault_item_ids(p_workspace_id, ids, 'vault.purge.workspace');
end;
$$;
revoke all on function public.purge_workspace_vault_data(uuid)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_vault_data(uuid) to service_role;

-- No new cron, no production purge, no external call. An approved worker must
-- invoke the service-role functions and handle non-vault FK blockers separately.
