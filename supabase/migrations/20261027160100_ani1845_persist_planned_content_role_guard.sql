-- ANI-1845 / ANI-1881 Review 4383885688: Hardened Role Guard on Planned Content Draft RPC
-- Aligns persist_planned_content_draft with content-writing RLS ('owner', 'manager', 'reviewer').
-- Rejects 'viewer' and non-privileged workspace members fail-closed.
-- Local migration file only (DO NOT APPLY to production database directly).

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

  -- Tenant active membership and content-writing role verification (rejects viewers)
  if not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'manager', 'reviewer')
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
