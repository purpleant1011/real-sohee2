create or replace function public.record_claimed_publish_request(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_idempotency_key text,
  p_claim_token text,
  p_provider_request_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_id uuid;
begin
  if p_provider_request_id is null
    or p_provider_request_id !~ '^[A-Za-z0-9._-]{1,255}$'
  then raise exception 'PUBLISH_PROVIDER_REQUEST_INVALID'; end if;

  update public.publish_attempts
  set provider_request_id = p_provider_request_id
  where workspace_id = p_workspace_id
    and schedule_id = p_schedule_id
    and idempotency_key = p_idempotency_key
    and status = 'pending'
    and provider_request_id is null
    and claim_token_hash = encode(extensions.digest(p_claim_token, 'sha256'), 'hex')
    and lease_expires_at > statement_timestamp()
  returning id into attempt_id;

  if attempt_id is null then
    select id into attempt_id
    from public.publish_attempts
    where workspace_id = p_workspace_id
      and schedule_id = p_schedule_id
      and idempotency_key = p_idempotency_key
      and status = 'pending'
      and provider_request_id = p_provider_request_id
      and claim_token_hash = encode(extensions.digest(p_claim_token, 'sha256'), 'hex')
      and lease_expires_at > statement_timestamp();
  end if;
  if attempt_id is null then raise exception 'PUBLISH_CLAIM_INVALID'; end if;
  return attempt_id;
end;
$$;

create or replace function public.load_publish_reconciliation(
  p_workspace_id uuid,
  p_attempt_id uuid
)
returns table (
  attempt_id uuid,
  schedule_id uuid,
  channel_connection_id uuid,
  channel text,
  provider_request_id text,
  started_at timestamptz,
  finished_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    attempt.id,
    schedule.id,
    schedule.channel_connection_id,
    content.channel,
    attempt.provider_request_id,
    attempt.started_at,
    attempt.finished_at
  from public.publish_attempts as attempt
  join public.schedules as schedule
    on schedule.workspace_id = attempt.workspace_id
    and schedule.id = attempt.schedule_id
    and schedule.status = 'unknown'
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id
    and content.id = schedule.content_id
    and content.current_version_id = schedule.version_id
    and content.channel in ('instagram', 'threads')
  where attempt.workspace_id = p_workspace_id
    and attempt.id = p_attempt_id
    and attempt.status = 'unknown'
    and attempt.recovery_status = 'reconcile_required'
    and attempt.finished_at is not null
    and attempt.attempt_number = (
      select max(latest.attempt_number)
      from public.publish_attempts as latest
      where latest.workspace_id = attempt.workspace_id
        and latest.schedule_id = attempt.schedule_id
    );
$$;

create or replace function public.resolve_reconciled_publish(
  p_workspace_id uuid,
  p_attempt_id uuid,
  p_actor_user_id uuid,
  p_status text,
  p_provider_reference text,
  p_error_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_schedule_id uuid;
begin
  if not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'manager')
  ) then raise exception 'PUBLISH_RECONCILIATION_FORBIDDEN'; end if;

  if p_status not in ('succeeded', 'failed')
    or (p_status = 'succeeded' and (
      p_provider_reference is null
      or p_provider_reference !~ '^[A-Za-z0-9._-]{1,255}$'
      or p_error_code is not null
    ))
    or (p_status = 'failed' and (
      p_provider_reference is not null
      or p_error_code is distinct from 'RECONCILED_NO_POST'
    ))
  then raise exception 'PUBLISH_RECONCILIATION_RESULT_INVALID'; end if;

  select attempt.schedule_id into target_schedule_id
  from public.publish_attempts as attempt
  join public.schedules as schedule
    on schedule.workspace_id = attempt.workspace_id
    and schedule.id = attempt.schedule_id
    and schedule.status = 'unknown'
  where attempt.workspace_id = p_workspace_id
    and attempt.id = p_attempt_id
    and attempt.status = 'unknown'
    and attempt.recovery_status = 'reconcile_required'
    and attempt.attempt_number = (
      select max(latest.attempt_number)
      from public.publish_attempts as latest
      where latest.workspace_id = attempt.workspace_id
        and latest.schedule_id = attempt.schedule_id
    )
  for update of attempt, schedule;
  if target_schedule_id is null then raise exception 'PUBLISH_RECONCILIATION_STALE'; end if;

  update public.publish_attempts
  set status = p_status,
    provider_reference = p_provider_reference,
    error_code = p_error_code,
    finished_at = statement_timestamp(),
    recovery_status = case when p_status = 'failed' then 'retry_ready' else null end
  where workspace_id = p_workspace_id and id = p_attempt_id;

  update public.schedules
  set status = case when p_status = 'succeeded' then 'published' else 'failed' end,
    updated_at = statement_timestamp()
  where workspace_id = p_workspace_id and id = target_schedule_id;

  if p_status = 'succeeded' then
    update public.content_items as content
    set status = 'published'
    from public.schedules as schedule
    where schedule.workspace_id = p_workspace_id
      and schedule.id = target_schedule_id
      and content.workspace_id = schedule.workspace_id
      and content.id = schedule.content_id
      and content.current_version_id = schedule.version_id;
  end if;
  return p_attempt_id;
end;
$$;

create or replace function public.claim_publish_retry(
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
    and connection.channel = content.channel
  join lateral private.load_meta_channel_credential_internal(
    schedule.workspace_id,
    connection.id
  ) as credential on credential.provider = connection.channel
  where failed.workspace_id = p_workspace_id and failed.id = p_failed_attempt_id
    and failed.status = 'failed'
    and failed.recovery_status is distinct from 'reconcile_required'
    and schedule.status = 'failed'
    and failed.attempt_number = (
      select max(latest.attempt_number) from public.publish_attempts as latest
      where latest.workspace_id = failed.workspace_id and latest.schedule_id = failed.schedule_id
    )
    and (
      (
        failed.error_code = 'RECONCILED_NO_POST'
        and failed.recovery_status = 'retry_ready'
      )
      or (
        failed.error_code in ('TEMPORARY_NETWORK', 'RATE_LIMITED')
        and not exists (
          select 1 from public.publish_attempts as original
          where original.workspace_id = failed.workspace_id
            and original.schedule_id = failed.schedule_id
            and original.attempt_number = 1
            and original.error_code = 'PROVIDER_REJECTED'
        )
      )
      or (
        failed.error_code = 'PROVIDER_REJECTED'
        and content.channel = 'instagram'
        and (
          (
            failed.attempt_number = 1
            and (select count(*) from public.publish_attempts as only_attempt
              where only_attempt.workspace_id = failed.workspace_id
                and only_attempt.schedule_id = failed.schedule_id) = 1
          )
          or (
            failed.id = 'ac1f35cb-43a4-4acc-99e7-e6d94b641d7e'::uuid
            and schedule.id = 'dab2a638-3aae-4f8d-a926-6478cf6bf0b2'::uuid
            and schedule.version_id = '9ee72e7e-33d7-4e28-a931-5ae2e4b6c986'::uuid
            and failed.attempt_number = 2
            and (select count(*) from public.publish_attempts as exact_attempts
              where exact_attempts.workspace_id = failed.workspace_id
                and exact_attempts.schedule_id = failed.schedule_id) = 2
            and exists (
              select 1 from public.publish_attempts as original
              where original.workspace_id = failed.workspace_id
                and original.schedule_id = failed.schedule_id
                and original.attempt_number = 1
                and original.status = 'failed'
                and original.error_code = 'PROVIDER_REJECTED'
                and original.provider_reference is null
            )
          )
        )
        and exists (
          select 1
          from public.content_version_media as media
          join public.media_assets as source
            on source.workspace_id = media.workspace_id and source.id = media.media_asset_id
            and source.bucket_id = 'content-media' and source.mime_type = 'image/png'
            and source.rights_status = 'confirmed'
          join storage.objects as derivative
            on derivative.bucket_id = source.bucket_id
            and derivative.name = pg_catalog.regexp_replace(source.object_path, '[^/]+$', '')
              || 'publish-derivatives/instagram/' || schedule.version_id::text || '/' || source.id::text || '.jpg'
            and derivative.metadata ->> 'mimetype' = 'image/jpeg'
            and derivative.user_metadata ->> 'channel' = 'instagram'
            and derivative.user_metadata ->> 'contentVersionId' = schedule.version_id::text
            and derivative.user_metadata ->> 'sourceMediaAssetId' = source.id::text
            and derivative.user_metadata ->> 'derivativeKind' = 'publish-jpeg'
            and derivative.user_metadata ->> 'sourceMimeType' = 'image/png'
            and derivative.user_metadata ->> 'sourceObjectPath' = source.object_path
          where media.workspace_id = schedule.workspace_id
            and media.version_id = schedule.version_id
            and (select count(*) from public.content_version_media as exact_media
              where exact_media.workspace_id = schedule.workspace_id
                and exact_media.version_id = schedule.version_id) = 1
        )
      )
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

revoke all on function public.record_claimed_publish_request(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.load_publish_reconciliation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.resolve_reconciled_publish(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.claim_publish_retry(uuid, uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.record_claimed_publish_request(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.load_publish_reconciliation(uuid, uuid)
  to service_role;
grant execute on function public.resolve_reconciled_publish(uuid, uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.claim_publish_retry(uuid, uuid, uuid, text, text, text, timestamptz)
  to service_role;
