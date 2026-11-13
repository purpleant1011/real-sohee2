-- ANI-1845 / ANI-1881: Autonomous Planned Content & Schedule Bridge with Atomic Tenant Composite Idempotency
-- Local migration file only (DO NOT APPLY to production database directly).

-- 1. Index on content_versions.generation_evidence for fast tenant-scoped slot idempotency lookup
create index if not exists content_versions_workspace_slot_idx
  on public.content_versions (workspace_id, ((generation_evidence->>'slot_idempotency_key')));

-- 2. Atomic RPC for persisting planned content draft items with tenant composite scope
-- Guarantees atomic insertion of content_item and initial draft content_version.
-- Rejects duplicate slots within the same workspace and prevents race conditions.
create or replace function public.persist_planned_content_draft(
  p_workspace_id uuid,
  p_title text,
  p_channel text,
  p_caption text,
  p_hashtags text[],
  p_slot_time timestamptz,
  p_slot_idempotency_key text,
  p_fingerprint text,
  p_actor_user_id uuid,
  p_now timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content_id uuid;
  v_version_id uuid;
  v_existing_id uuid;
begin
  -- Caller authorization: fail-closed against arbitrary actor impersonation
  if auth.uid() is not null and auth.uid() <> p_actor_user_id then
    raise exception 'PLANNED_CONTENT_IMPERSONATION_FORBIDDEN';
  end if;

  -- Tenant active membership verification
  if not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id and member.user_id = p_actor_user_id
      and member.status = 'active'
  ) then
    raise exception 'PLANNED_CONTENT_FORBIDDEN';
  end if;

  -- Advisory lock scoped to workspace and slot idempotency key to prevent concurrent insertion
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_slot_idempotency_key, 0)
  );

  -- Check existing content version with the same tenant slot key
  select content_id into v_existing_id
  from public.content_versions
  where workspace_id = p_workspace_id
    and (generation_evidence->>'slot_idempotency_key') = p_slot_idempotency_key
  limit 1;

  if v_existing_id is not null then
    return jsonb_build_object(
      'success', true,
      'is_duplicate', true,
      'content_id', v_existing_id
    );
  end if;

  -- Insert content_item in unapproved draft status
  v_content_id := gen_random_uuid();
  v_version_id := gen_random_uuid();

  insert into public.content_items (
    id,
    workspace_id,
    channel,
    title,
    status,
    current_version_id,
    created_by,
    created_at,
    updated_at
  ) values (
    v_content_id,
    p_workspace_id,
    p_channel,
    p_title,
    'draft',
    v_version_id,
    p_actor_user_id,
    p_now,
    p_now
  );

  -- Insert corresponding initial draft content_version with generation_evidence
  insert into public.content_versions (
    id,
    workspace_id,
    content_id,
    version_number,
    caption,
    hashtags,
    fingerprint,
    generation_evidence,
    rights,
    disclosure,
    created_by,
    created_at
  ) values (
    v_version_id,
    p_workspace_id,
    v_content_id,
    1,
    p_caption,
    coalesce(p_hashtags, '{}'::text[]),
    p_fingerprint,
    jsonb_build_object(
      'slot_idempotency_key', p_slot_idempotency_key,
      'scheduled_slot', p_slot_time,
      'autonomous_planned', true
    ),
    '{}'::jsonb,
    '',
    p_actor_user_id,
    p_now
  );

  return jsonb_build_object(
    'success', true,
    'is_duplicate', false,
    'content_id', v_content_id,
    'version_id', v_version_id
  );
end;
$$;

revoke all on function public.persist_planned_content_draft(uuid, text, text, text, text[], timestamptz, text, text, uuid, timestamptz) from public;
grant execute on function public.persist_planned_content_draft(uuid, text, text, text, text[], timestamptz, text, text, uuid, timestamptz) to service_role, authenticated;
