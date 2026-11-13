-- Migration: 20261104000000_publish_scope_alignment.sql
-- Aligns Meta publishing permission gates with live-approved scopes:
-- Instagram: instagram_business_basic, instagram_business_content_publish
-- Threads: threads_basic, threads_content_publish
-- Comment/DM/reply/insight features remain strictly gated by their respective scopes.

-- 1) private.load_meta_channel_credential_internal(uuid, uuid)
-- Base definition: supabase/migrations/20260813100652_meta_credential_health.sql
create or replace function private.load_meta_channel_credential_internal(
  p_workspace_id uuid,
  p_connection_id uuid
)
returns table (
  workspace_id uuid,
  connection_id uuid,
  provider text,
  external_account_id text,
  encrypted_access_token text,
  access_token_iv text,
  encryption_algorithm text,
  status text,
  token_expires_at timestamptz,
  granted_scopes text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    credential.workspace_id,
    connection.id,
    credential.provider,
    connection.external_account_id,
    credential.encrypted_access_token,
    credential.access_token_iv,
    credential.encryption_algorithm,
    credential.status,
    credential.token_expires_at,
    credential.granted_scopes
  from public.meta_channel_credentials as credential
  join public.channel_connections as connection
    on connection.workspace_id = credential.workspace_id
   and connection.id = credential.channel_connection_id
   and connection.channel = credential.provider
  where credential.workspace_id = p_workspace_id
    and credential.channel_connection_id = p_connection_id
    and credential.status = 'active'
    and connection.status = 'connected'
    and connection.external_account_id is not null
    and (
      credential.token_expires_at is null
      or credential.token_expires_at > statement_timestamp() + interval '5 minutes'
    )
    and case credential.provider
      when 'instagram' then array[
        'instagram_business_basic', 'instagram_business_content_publish'
      ]::text[] <@ credential.granted_scopes
      -- ROLLBACK: when 'instagram' then array[
      --   'instagram_business_basic', 'instagram_business_content_publish',
      --   'instagram_business_manage_comments', 'instagram_business_manage_messages',
      --   'instagram_business_manage_insights'
      -- ]::text[] <@ credential.granted_scopes
      when 'threads' then array[
        'threads_basic', 'threads_content_publish'
      ]::text[] <@ credential.granted_scopes
      -- ROLLBACK: when 'threads' then array[
      --   'threads_basic', 'threads_content_publish',
      --   'threads_read_replies', 'threads_manage_replies', 'threads_manage_insights'
      -- ]::text[] <@ credential.granted_scopes
      else false
    end;
$$;

revoke all on function private.load_meta_channel_credential_internal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.load_meta_channel_credential_internal(uuid, uuid)
  to service_role;

-- 2) public.claim_publish_schedule(uuid, uuid, uuid, text, text, text, timestamptz)
-- Base definition: supabase/migrations/20260813100654_meta_publish_execution.sql
create or replace function public.claim_publish_schedule(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_claim_token text,
  p_worker_id text,
  p_now timestamptz default statement_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_id uuid;
  next_attempt integer;
  claim_hash text;
begin
  if p_idempotency_key !~ '^[a-f0-9]{64}$'
    or char_length(p_claim_token) not between 32 and 512
    or char_length(p_worker_id) not between 3 and 120
    or not exists (
      select 1 from public.workspace_members as member
      where member.workspace_id = p_workspace_id and member.user_id = p_actor_user_id
        and member.status = 'active' and member.role in ('owner', 'manager')
    ) then raise exception 'PUBLISH_CLAIM_FORBIDDEN'; end if;

  claim_hash := encode(extensions.digest(p_claim_token, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_idempotency_key, 0)
  );

  select id into attempt_id from public.publish_attempts
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if attempt_id is not null then
    return private.publish_reservation_context(p_workspace_id, attempt_id, false);
  end if;

  perform 1
  from public.schedules as schedule
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id and content.id = schedule.content_id
    and content.current_version_id = schedule.version_id
  join public.approvals as approval
    on approval.workspace_id = schedule.workspace_id and approval.id = schedule.approval_id
    and approval.version_id = schedule.version_id and approval.fingerprint = (
      select version.fingerprint from public.content_versions as version
      where version.workspace_id = schedule.workspace_id and version.id = schedule.version_id
    ) and approval.status = 'approved' and approval.disclosure_confirmed and approval.rights_confirmed
  join public.channel_connections as connection
    on connection.workspace_id = schedule.workspace_id and connection.id = schedule.channel_connection_id
    and connection.channel = content.channel and connection.status = 'connected'
  join public.meta_channel_credentials as credential
    on credential.workspace_id = schedule.workspace_id
    and credential.channel_connection_id = connection.id
    and credential.provider = connection.channel and credential.status = 'active'
    and (credential.token_expires_at is null or credential.token_expires_at > p_now + interval '5 minutes')
    and case credential.provider
      when 'instagram' then array['instagram_business_basic','instagram_business_content_publish']::text[] <@ credential.granted_scopes
      -- ROLLBACK: when 'instagram' then array['instagram_business_basic','instagram_business_content_publish','instagram_business_manage_comments','instagram_business_manage_messages','instagram_business_manage_insights']::text[] <@ credential.granted_scopes
      when 'threads' then array['threads_basic','threads_content_publish']::text[] <@ credential.granted_scopes
      -- ROLLBACK: when 'threads' then array['threads_basic','threads_content_publish','threads_read_replies','threads_manage_replies','threads_manage_insights']::text[] <@ credential.granted_scopes
      else false end
  where schedule.workspace_id = p_workspace_id and schedule.id = p_schedule_id
    and schedule.status = 'scheduled' and schedule.publish_at <= p_now
  for update of schedule skip locked;
  if not found then raise exception 'PUBLISH_NOT_DUE_OR_NOT_READY'; end if;

  select coalesce(max(attempt_number), 0) + 1 into next_attempt
  from public.publish_attempts where workspace_id = p_workspace_id and schedule_id = p_schedule_id;
  insert into public.publish_attempts (
    workspace_id, schedule_id, attempt_number, idempotency_key, status,
    created_by, claim_token_hash, lease_expires_at
  ) values (
    p_workspace_id, p_schedule_id, next_attempt, p_idempotency_key, 'pending',
    p_actor_user_id, claim_hash, p_now + interval '5 minutes'
  ) returning id into attempt_id;
  update public.schedules set status = 'publishing', updated_at = p_now
  where workspace_id = p_workspace_id and id = p_schedule_id;
  insert into public.operation_events (
    workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
  ) values (
    p_workspace_id, 'publish.claimed', 'publish.claimed:' || attempt_id::text,
    'publish_attempt', attempt_id,
    jsonb_build_object('scheduleId', p_schedule_id, 'workerId', p_worker_id), p_now
  ) on conflict (workspace_id, event_key) do nothing;
  return private.publish_reservation_context(p_workspace_id, attempt_id, true);
end;
$$;

revoke all on function public.claim_publish_schedule(uuid, uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_publish_schedule(uuid, uuid, uuid, text, text, text, timestamptz)
  to service_role;
