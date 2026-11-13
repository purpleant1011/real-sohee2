-- ANI-1545: return the version committed by the atomic edit itself, never a later re-read.
-- The existing row lock, expected_updated_at and expected_payload guards are unchanged.
drop function if exists public.vault_apply_edits(uuid, jsonb);
create function public.vault_apply_edits(p_workspace_id uuid, p_mutations jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  mutation jsonb;
  current_row public.vault_items%rowtype;
  expected_count integer;
  committed jsonb := '{}'::jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_mutations) <> 'array' or jsonb_array_length(p_mutations) not between 1 and 4 then
    raise exception 'Invalid mutation batch' using errcode = '22023';
  end if;
  select count(distinct value->>'id') into expected_count from jsonb_array_elements(p_mutations) value;
  if expected_count <> jsonb_array_length(p_mutations) then
    raise exception 'Duplicate vault item' using errcode = '22023';
  end if;
  perform 1 from public.vault_items i
    where i.workspace_id = p_workspace_id
      and i.id in (select (value->>'id')::uuid from jsonb_array_elements(p_mutations) value)
    order by i.id for update;
  for mutation in select value from jsonb_array_elements(p_mutations) value loop
    select * into current_row from public.vault_items
      where workspace_id = p_workspace_id and id = (mutation->>'id')::uuid;
    if not found or current_row.updated_at is distinct from (mutation->>'expected_updated_at')::timestamptz then
      return null;
    end if;
    if mutation->>'payload' is not null and
      not exists (select 1 from public.vault_variant_payloads where workspace_id = p_workspace_id and vault_item_id = current_row.id and payload = mutation->'expected_payload') then
      return null;
    end if;
  end loop;
  for mutation in select value from jsonb_array_elements(p_mutations) value loop
    update public.vault_items set
      target_date = case when mutation->'changes' ? 'target_date' then (mutation->'changes'->>'target_date')::date else target_date end,
      release_gate = case when mutation->'changes' ? 'release_gate' then mutation->'changes'->>'release_gate' else release_gate end,
      hold_reason = case when mutation->'changes' ? 'hold_reason' then mutation->'changes'->>'hold_reason' else hold_reason end,
      held_at = case when mutation->'changes' ? 'held_at' then (mutation->'changes'->>'held_at')::timestamptz else held_at end,
      held_by = case when mutation->'changes' ? 'held_by' then (mutation->'changes'->>'held_by')::uuid else held_by end,
      approved_fingerprint = case when mutation->'changes' ? 'approved_fingerprint' then mutation->'changes'->>'approved_fingerprint' else approved_fingerprint end,
      fingerprint_schema_version = case when mutation->'changes' ? 'fingerprint_schema_version' then (mutation->'changes'->>'fingerprint_schema_version')::integer else fingerprint_schema_version end,
      approval_state = case when mutation->'changes' ? 'approval_state' then mutation->'changes'->>'approval_state' else approval_state end,
      approved_by = case when mutation->'changes' ? 'approved_by' then (mutation->'changes'->>'approved_by')::uuid else approved_by end,
      policy_version = coalesce(mutation->'changes'->>'policy_version', policy_version),
      spec_version = coalesce(mutation->'changes'->>'spec_version', spec_version),
      deleted_at = case when mutation->'changes' ? 'deleted_at' then (mutation->'changes'->>'deleted_at')::timestamptz else deleted_at end
    where workspace_id = p_workspace_id and id = (mutation->>'id')::uuid
    returning * into current_row;
    committed := committed || jsonb_build_object(current_row.id::text, to_char(current_row.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
    if mutation->>'payload' is not null then
      update public.vault_variant_payloads set payload = mutation->'payload'
        where workspace_id = p_workspace_id and vault_item_id = (mutation->>'id')::uuid;
      if not found then raise exception 'Variant payload unavailable' using errcode = '23503'; end if;
    end if;
    insert into public.vault_events (workspace_id, vault_item_id, actor_id, event_type, payload)
      values (p_workspace_id, (mutation->>'id')::uuid, (mutation->>'actor_id')::uuid,
        mutation->>'event_type', mutation->'event_payload');
  end loop;
  return committed;
end;
$$;
revoke all on function public.vault_apply_edits(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.vault_apply_edits(uuid,jsonb) to service_role;
-- Rollback: restore the prior boolean-returning function from 20261008130000.
