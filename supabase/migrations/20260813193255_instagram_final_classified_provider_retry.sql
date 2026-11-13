create or replace function private.load_instagram_provider_rejected_retry_media_internal(
  p_workspace_id uuid,
  p_failed_attempt_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace_id', failed.workspace_id,
    'failed_attempt_id', failed.id,
    'version_id', schedule.version_id,
    'media', jsonb_build_array(jsonb_build_object(
      'media_asset_id', asset.id,
      'bucket_id', asset.bucket_id,
      'object_path', asset.object_path,
      'mime_type', asset.mime_type
    ))
  )
  from public.publish_attempts as failed
  join public.schedules as schedule
    on schedule.workspace_id = failed.workspace_id and schedule.id = failed.schedule_id
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id and content.id = schedule.content_id
    and content.current_version_id = schedule.version_id and content.channel = 'instagram'
  join public.approvals as approval
    on approval.workspace_id = schedule.workspace_id and approval.id = schedule.approval_id
    and approval.version_id = schedule.version_id and approval.status = 'approved'
    and approval.disclosure_confirmed and approval.rights_confirmed
    and approval.fingerprint = (
      select version.fingerprint from public.content_versions as version
      where version.workspace_id = schedule.workspace_id and version.id = schedule.version_id
    )
  join public.content_version_media as link
    on link.workspace_id = schedule.workspace_id and link.version_id = schedule.version_id
  join public.media_assets as asset
    on asset.workspace_id = link.workspace_id and asset.id = link.media_asset_id
    and asset.bucket_id = 'content-media' and asset.mime_type = 'image/png'
    and asset.rights_status = 'confirmed'
  join storage.objects as source_object
    on source_object.bucket_id = asset.bucket_id and source_object.name = asset.object_path
    and source_object.metadata ->> 'mimetype' = 'image/png'
  where failed.workspace_id = p_workspace_id and failed.id = p_failed_attempt_id
    and failed.status = 'failed' and failed.error_code = 'PROVIDER_REJECTED'
    and schedule.status = 'failed'
    and (
      (
        failed.attempt_number = 1
        and (select count(*) from public.publish_attempts as attempt
          where attempt.workspace_id = failed.workspace_id
            and attempt.schedule_id = failed.schedule_id) = 1
      )
      or (
        failed.id = 'ac1f35cb-43a4-4acc-99e7-e6d94b641d7e'::uuid
        and schedule.id = 'dab2a638-3aae-4f8d-a926-6478cf6bf0b2'::uuid
        and schedule.version_id = '9ee72e7e-33d7-4e28-a931-5ae2e4b6c986'::uuid
        and failed.attempt_number = 2
        and (select count(*) from public.publish_attempts as attempt
          where attempt.workspace_id = failed.workspace_id
            and attempt.schedule_id = failed.schedule_id) = 2
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
    and (select count(*) from public.content_version_media as media
      where media.workspace_id = schedule.workspace_id and media.version_id = schedule.version_id) = 1;
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

revoke all on function private.load_instagram_provider_rejected_retry_media_internal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.load_instagram_provider_rejected_retry_media_internal(uuid, uuid)
  to service_role;

revoke all on function public.claim_publish_retry(uuid, uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_publish_retry(uuid, uuid, uuid, text, text, text, timestamptz)
  to service_role;
