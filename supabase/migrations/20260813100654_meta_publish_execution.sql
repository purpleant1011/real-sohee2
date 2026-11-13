alter table public.publish_attempts
  add column claim_token_hash text check (claim_token_hash is null or claim_token_hash ~ '^[a-f0-9]{64}$'),
  add column lease_expires_at timestamptz,
  add column next_attempt_at timestamptz,
  add column provider_request_id text check (provider_request_id is null or char_length(provider_request_id) <= 255),
  add column recovery_status text check (recovery_status is null or recovery_status in ('reconcile_required', 'retry_ready'));

alter table public.publish_attempts
  add constraint publish_attempts_result_evidence_check check (
    (status = 'pending' and provider_reference is null and error_code is null and finished_at is null)
    or (status = 'succeeded' and provider_reference is not null and error_code is null and finished_at is not null)
    or (status = 'failed' and provider_reference is null and error_code is not null and finished_at is not null)
  ) not valid;

create function public.claim_publish_schedule(
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
      when 'instagram' then array['instagram_business_basic','instagram_business_content_publish','instagram_business_manage_comments','instagram_business_manage_messages','instagram_business_manage_insights']::text[] <@ credential.granted_scopes
      when 'threads' then array['threads_basic','threads_content_publish','threads_read_replies','threads_manage_replies','threads_manage_insights']::text[] <@ credential.granted_scopes
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

create function public.complete_claimed_publish(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_idempotency_key text,
  p_claim_token text,
  p_status text,
  p_provider_reference text,
  p_error_code text,
  p_provider_request_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_id uuid;
  attempt_number_value integer;
  latest_attempt integer;
begin
  if p_status not in ('succeeded', 'failed')
    or (p_status = 'succeeded' and (p_provider_reference is null or p_error_code is not null))
    or (p_status = 'failed' and (p_provider_reference is not null or p_error_code not in ('TEMPORARY_NETWORK','RATE_LIMITED','TOKEN_EXPIRED','APPROVAL_STALE','PROVIDER_REJECTED')))
  then raise exception 'PUBLISH_RESULT_INVALID'; end if;
  select id, attempt_number into attempt_id, attempt_number_value
  from public.publish_attempts
  where workspace_id = p_workspace_id and schedule_id = p_schedule_id
    and idempotency_key = p_idempotency_key and status = 'pending'
    and claim_token_hash = encode(extensions.digest(p_claim_token, 'sha256'), 'hex')
    and lease_expires_at > statement_timestamp()
  for update;
  if attempt_id is null then raise exception 'PUBLISH_CLAIM_INVALID'; end if;
  select max(attempt_number) into latest_attempt from public.publish_attempts
  where workspace_id = p_workspace_id and schedule_id = p_schedule_id;
  if latest_attempt <> attempt_number_value then raise exception 'PUBLISH_ATTEMPT_STALE'; end if;
  update public.publish_attempts set status = p_status,
    provider_reference = p_provider_reference, error_code = p_error_code,
    provider_request_id = p_provider_request_id, finished_at = statement_timestamp(),
    lease_expires_at = null
  where workspace_id = p_workspace_id and id = attempt_id;
  update public.schedules set status = case when p_status = 'succeeded' then 'published' else 'failed' end,
    updated_at = statement_timestamp()
  where workspace_id = p_workspace_id and id = p_schedule_id;
  if p_status = 'succeeded' then
    update public.content_items as content set status = 'published'
    from public.schedules as schedule
    where schedule.workspace_id = p_workspace_id and schedule.id = p_schedule_id
      and content.workspace_id = schedule.workspace_id and content.id = schedule.content_id
      and content.current_version_id = schedule.version_id;
  end if;
  return attempt_id;
end;
$$;

create function public.recover_expired_publish_leases(p_now timestamptz default statement_timestamp())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovered integer := 0;
  expired_row record;
begin
  for expired_row in
    update public.publish_attempts
    set status = 'failed', error_code = 'LEASE_EXPIRED',
      finished_at = p_now, lease_expires_at = null, recovery_status = 'reconcile_required'
    where status = 'pending' and lease_expires_at < p_now
    returning workspace_id, schedule_id, id
  loop
    update public.schedules
    set status = 'failed', updated_at = p_now
    where workspace_id = expired_row.workspace_id and id = expired_row.schedule_id;
    insert into public.operation_events (
      workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
    ) values (
      expired_row.workspace_id,
      'publish.lease_expired',
      'publish.lease_expired:' || expired_row.id::text,
      'publish_attempt',
      expired_row.id,
      jsonb_build_object('scheduleId', expired_row.schedule_id, 'recoveryStatus', 'reconcile_required'),
      p_now
    ) on conflict (workspace_id, event_key) do nothing;
    recovered := recovered + 1;
  end loop;
  return recovered;
end;
$$;

revoke all on function private.record_publish_attempt_internal(uuid, uuid, text, text, text, text)
  from authenticated;
revoke all on function public.record_publish_attempt(uuid, uuid, text, text, text, text)
  from authenticated;
revoke all on function public.reserve_publish_attempt(uuid, uuid, text) from authenticated;
revoke all on function public.reserve_publish_retry(uuid, uuid, text) from authenticated;
revoke all on function public.claim_publish_schedule(uuid, uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_claimed_publish(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.recover_expired_publish_leases(timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_publish_schedule(uuid, uuid, uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.complete_claimed_publish(uuid, uuid, text, text, text, text, text, text)
  to service_role;
grant execute on function public.recover_expired_publish_leases(timestamptz)
  to service_role;
