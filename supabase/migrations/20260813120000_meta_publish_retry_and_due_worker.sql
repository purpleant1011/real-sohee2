alter table public.schedules
  drop constraint schedules_status_check;
alter table public.schedules
  add constraint schedules_status_check
  check (status in ('scheduled', 'publishing', 'published', 'unknown', 'failed', 'cancelled'));

alter table public.publish_attempts
  drop constraint publish_attempts_status_check;
alter table public.publish_attempts
  add constraint publish_attempts_status_check
  check (status in ('pending', 'succeeded', 'unknown', 'failed'));

alter table public.publish_attempts
  drop constraint publish_attempts_result_evidence_check;
alter table public.publish_attempts
  add constraint publish_attempts_result_evidence_check check (
    (status = 'pending' and provider_reference is null and error_code is null and finished_at is null)
    or (status = 'succeeded' and provider_reference is not null and error_code is null and finished_at is not null)
    or (status = 'unknown' and error_code is not null and finished_at is not null)
    or (status = 'failed' and provider_reference is null and error_code is not null and finished_at is not null)
  ) not valid;

create function public.claim_publish_retry(
  p_workspace_id uuid,
  p_failed_attempt_id uuid,
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
  failed_schedule_id uuid;
  attempt_id uuid;
  next_attempt integer;
begin
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-f0-9]{64}$'
    or char_length(p_claim_token) not between 32 and 512
    or char_length(p_worker_id) not between 3 and 120
    or not exists (
      select 1 from public.workspace_members as member
      where member.workspace_id = p_workspace_id and member.user_id = p_actor_user_id
        and member.status = 'active' and member.role in ('owner', 'manager')
    ) then raise exception 'PUBLISH_RETRY_FORBIDDEN'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || p_failed_attempt_id::text, 0)
  );
  select id into attempt_id from public.publish_attempts
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if attempt_id is not null then
    return private.publish_reservation_context(p_workspace_id, attempt_id, false);
  end if;

  select schedule.id into failed_schedule_id
  from public.publish_attempts as failed
  join public.schedules as schedule
    on schedule.workspace_id = failed.workspace_id and schedule.id = failed.schedule_id
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id and content.id = schedule.content_id
    and content.current_version_id = schedule.version_id
  join public.approvals as approval
    on approval.workspace_id = schedule.workspace_id and approval.id = schedule.approval_id
    and approval.version_id = schedule.version_id and approval.status = 'approved'
    and approval.disclosure_confirmed and approval.rights_confirmed
    and approval.fingerprint = (
      select version.fingerprint from public.content_versions as version
      where version.workspace_id = schedule.workspace_id and version.id = schedule.version_id
    )
  join public.channel_connections as connection
    on connection.workspace_id = schedule.workspace_id and connection.id = schedule.channel_connection_id
    and connection.channel = content.channel and connection.status = 'connected'
  join public.meta_channel_credentials as credential
    on credential.workspace_id = schedule.workspace_id and credential.channel_connection_id = connection.id
    and credential.provider = connection.channel and credential.status = 'active'
    and (credential.token_expires_at is null or credential.token_expires_at > p_now + interval '5 minutes')
  where failed.workspace_id = p_workspace_id and failed.id = p_failed_attempt_id
    and failed.status = 'failed' and failed.error_code in ('TEMPORARY_NETWORK', 'RATE_LIMITED')
    and failed.recovery_status is distinct from 'reconcile_required'
    and schedule.status = 'failed'
    and failed.attempt_number = (
      select max(latest.attempt_number) from public.publish_attempts as latest
      where latest.workspace_id = failed.workspace_id and latest.schedule_id = failed.schedule_id
    )
  for update of schedule skip locked;
  if failed_schedule_id is null then raise exception 'PUBLISH_RETRY_NOT_READY'; end if;

  select coalesce(max(candidate.attempt_number), 0) + 1 into next_attempt
  from public.publish_attempts as candidate
  where candidate.workspace_id = p_workspace_id and candidate.schedule_id = failed_schedule_id;
  insert into public.publish_attempts (
    workspace_id, schedule_id, attempt_number, idempotency_key, status,
    created_by, claim_token_hash, lease_expires_at
  ) values (
    p_workspace_id, failed_schedule_id, next_attempt, p_idempotency_key, 'pending',
    p_actor_user_id, encode(extensions.digest(p_claim_token, 'sha256'), 'hex'), p_now + interval '5 minutes'
  ) returning id into attempt_id;
  update public.schedules set status = 'publishing', updated_at = p_now
  where workspace_id = p_workspace_id and id = failed_schedule_id;
  return private.publish_reservation_context(p_workspace_id, attempt_id, true);
end;
$$;

create function public.list_due_publish_schedules(
  p_now timestamptz default statement_timestamp(),
  p_limit integer default 5
)
returns table (workspace_id uuid, schedule_id uuid, actor_user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select schedule.workspace_id, schedule.id, schedule.created_by
  from public.schedules as schedule
  join public.workspace_members as member
    on member.workspace_id = schedule.workspace_id and member.user_id = schedule.created_by
    and member.status = 'active' and member.role in ('owner', 'manager')
  where schedule.status = 'scheduled' and schedule.publish_at <= p_now
  order by schedule.publish_at, schedule.id
  limit greatest(1, least(coalesce(p_limit, 5), 10));
$$;

create or replace function public.complete_claimed_publish(
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
  if p_status not in ('succeeded', 'unknown', 'failed')
    or (p_status = 'succeeded' and (p_provider_reference is null or p_error_code is not null))
    or (p_status = 'unknown' and (p_provider_reference is not null or p_error_code is distinct from 'RESULT_UNKNOWN'))
    or (p_status = 'failed' and (
      p_provider_reference is not null
      or p_error_code is null
      or p_error_code not in ('TEMPORARY_NETWORK','RATE_LIMITED','TOKEN_EXPIRED','APPROVAL_STALE','PROVIDER_REJECTED')
    ))
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
    lease_expires_at = null,
    recovery_status = case when p_status = 'unknown' then 'reconcile_required' else recovery_status end
  where workspace_id = p_workspace_id and id = attempt_id;
  update public.schedules set status = case
      when p_status = 'succeeded' then 'published'
      when p_status = 'unknown' then 'unknown'
      else 'failed'
    end,
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

create or replace function public.recover_expired_publish_leases(p_now timestamptz default statement_timestamp())
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
    set status = 'unknown', error_code = 'LEASE_EXPIRED', finished_at = p_now,
      lease_expires_at = null, recovery_status = 'reconcile_required'
    where status = 'pending' and lease_expires_at < p_now
    returning workspace_id, schedule_id, id
  loop
    update public.schedules set status = 'unknown', updated_at = p_now
    where workspace_id = expired_row.workspace_id and id = expired_row.schedule_id;
    insert into public.operation_events (
      workspace_id, event_type, event_key, subject_type, subject_id, payload, occurred_at
    ) values (
      expired_row.workspace_id, 'publish.lease_expired', 'publish.lease_expired:' || expired_row.id::text,
      'publish_attempt', expired_row.id,
      jsonb_build_object('scheduleId', expired_row.schedule_id, 'recoveryStatus', 'reconcile_required'), p_now
    ) on conflict (workspace_id, event_key) do nothing;
    recovered := recovered + 1;
  end loop;
  return recovered;
end;
$$;

revoke all on function public.claim_publish_retry(uuid, uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.list_due_publish_schedules(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.claim_publish_retry(uuid, uuid, uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.list_due_publish_schedules(timestamptz, integer)
  to service_role;
