-- ==============================================================================
-- ANI-1481: Atomic Durable Persistence for Text and Image Harness Versions
--
-- Invariants:
-- 1. Version sequence and active uniqueness are strictly per (workspace_id, rule_key).
-- 2. At most one active rule per (workspace_id, rule_key).
-- 3. Atomically retires prior active rule of the same rule_key, computes next version,
--    and inserts new active rule.
-- 4. Rollback safety: if insert fails, prior active row remains active.
-- 5. Service-role only execution path.
-- ==============================================================================

-- 1. Partial unique index: at most one active row per (workspace_id, rule_key)
create unique index if not exists harness_rules_active_workspace_rule_key_uidx
  on public.harness_rules (workspace_id, rule_key)
  where status = 'active';

-- 2. Transactional RPC for atomic harness rule activation
create or replace function public.activate_harness_rule_version(
  p_workspace_id uuid,
  p_rule_key text,
  p_rule_type text,
  p_title text,
  p_description text,
  p_structured_rule jsonb,
  p_applies_to_channels text[],
  p_created_by_user_id uuid,
  p_approved_by_user_id uuid default null,
  p_source_knowledge_fact_ids uuid[] default '{}'::uuid[]
)
returns public.harness_rules
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next_version integer;
  v_approved_by uuid;
  v_approved_at timestamptz;
  v_resolved_title text;
  v_new_rule public.harness_rules;
begin
  -- 1. Acquire transaction-scoped advisory lock on (workspace_id, rule_key)
  -- Uses 2-integer overload: hashtext(workspace_id::text), hashtext(rule_key)
  perform pg_advisory_xact_lock(hashtext(p_workspace_id::text), hashtext(p_rule_key));

  -- 2. Compute canonical next monotonic version for this exact (workspace_id, rule_key)
  select coalesce(max(version), 0) + 1
  into v_next_version
  from public.harness_rules
  where workspace_id = p_workspace_id
    and rule_key = p_rule_key;

  -- 3. Resolve approval evidence (active status requires approved_by and approved_at)
  v_approved_by := coalesce(p_approved_by_user_id, p_created_by_user_id);
  v_approved_at := now();

  -- 4. Resolve title with canonical version formatting if not explicitly supplied
  if p_title is not null and char_length(p_title) > 0 then
    v_resolved_title := p_title;
  elsif p_rule_type = 'text_generation' then
    v_resolved_title := '텍스트 하네스 v' || v_next_version;
  elsif p_rule_type = 'image_generation' then
    v_resolved_title := '이미지 하네스 v' || v_next_version;
  else
    v_resolved_title := p_rule_key || ' v' || v_next_version;
  end if;

  -- 5. Retire prior active row(s) for the SAME workspace and SAME rule_key ONLY
  -- Unrelated rule_keys (e.g. byreum channel rules) remain completely untouched.
  update public.harness_rules
  set status = 'retired',
      updated_at = now()
  where workspace_id = p_workspace_id
    and rule_key = p_rule_key
    and status = 'active';

  -- 6. Insert new active rule version
  insert into public.harness_rules (
    workspace_id,
    rule_key,
    rule_type,
    title,
    description,
    structured_rule,
    applies_to_channels,
    status,
    version,
    created_by_user_id,
    approved_by_user_id,
    approved_at,
    source_knowledge_fact_ids,
    created_at,
    updated_at
  ) values (
    p_workspace_id,
    p_rule_key,
    p_rule_type,
    v_resolved_title,
    p_description,
    p_structured_rule,
    coalesce(p_applies_to_channels, '{}'::text[]),
    'active',
    v_next_version,
    p_created_by_user_id,
    v_approved_by,
    v_approved_at,
    coalesce(p_source_knowledge_fact_ids, '{}'::uuid[]),
    now(),
    now()
  )
  returning * into v_new_rule;

  return v_new_rule;
end;
$$;

-- 3. Restrict execution permissions to service_role only
revoke all on function public.activate_harness_rule_version(
  uuid, text, text, text, text, jsonb, text[], uuid, uuid, uuid[]
) from public, anon, authenticated;

grant execute on function public.activate_harness_rule_version(
  uuid, text, text, text, text, jsonb, text[], uuid, uuid, uuid[]
) to service_role;
