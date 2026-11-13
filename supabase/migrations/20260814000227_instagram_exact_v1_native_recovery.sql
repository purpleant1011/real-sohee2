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
    'schedule_id', schedule.id,
    'version_id', schedule.version_id,
    'channel_connection_id', connection.id,
    'external_account_id', connection.external_account_id,
    'account_label', connection.account_label,
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
  join public.channel_connections as connection
    on connection.workspace_id = schedule.workspace_id
    and connection.id = schedule.channel_connection_id
    and connection.channel = 'instagram'
    and connection.status = 'connected'
    and connection.external_account_id is not null
    and connection.account_label is not null
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
  join storage.objects as derivative
    on derivative.bucket_id = asset.bucket_id
    and derivative.name = pg_catalog.regexp_replace(asset.object_path, '[^/]+$', '')
      || 'publish-derivatives/instagram/' || schedule.version_id::text || '/' || asset.id::text || '.jpg'
    and derivative.metadata ->> 'mimetype' = 'image/jpeg'
    and derivative.user_metadata ->> 'channel' = 'instagram'
    and derivative.user_metadata ->> 'contentVersionId' = schedule.version_id::text
    and derivative.user_metadata ->> 'sourceMediaAssetId' = asset.id::text
    and derivative.user_metadata ->> 'derivativeKind' = 'publish-jpeg'
    and derivative.user_metadata ->> 'sourceMimeType' = 'image/png'
    and derivative.user_metadata ->> 'sourceObjectPath' = asset.object_path
  where failed.workspace_id = p_workspace_id
    and failed.id = p_failed_attempt_id
    and failed.id = 'ac1f35cb-43a4-4acc-99e7-e6d94b641d7e'::uuid
    and failed.status = 'failed'
    and failed.error_code = 'PROVIDER_REJECTED'
    and failed.provider_reference is null
    and failed.attempt_number = 2
    and schedule.id = 'dab2a638-3aae-4f8d-a926-6478cf6bf0b2'::uuid
    and schedule.version_id = '9ee72e7e-33d7-4e28-a931-5ae2e4b6c986'::uuid
    and schedule.status = 'failed'
    and (select count(*) from public.publish_attempts as attempt
      where attempt.workspace_id = failed.workspace_id and attempt.schedule_id = failed.schedule_id) = 2
    and exists (
      select 1 from public.publish_attempts as original
      where original.workspace_id = failed.workspace_id
        and original.schedule_id = failed.schedule_id
        and original.attempt_number = 1
        and original.status = 'failed'
        and original.error_code = 'PROVIDER_REJECTED'
        and original.provider_reference is null
    )
    and (select count(*) from public.content_version_media as media
      where media.workspace_id = schedule.workspace_id and media.version_id = schedule.version_id) = 1;
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
  exact_native_recovery boolean;
begin
  if p_status not in ('succeeded', 'unknown', 'failed')
    or (p_status = 'succeeded' and (p_provider_reference is null or p_error_code is not null))
    or (p_status = 'unknown' and (p_provider_reference is not null or p_error_code is distinct from 'RESULT_UNKNOWN'))
    or (p_status = 'failed' and (p_provider_reference is not null or p_error_code is null))
  then raise exception 'PUBLISH_RESULT_INVALID'; end if;

  select id, attempt_number into attempt_id, attempt_number_value
  from public.publish_attempts
  where workspace_id = p_workspace_id and schedule_id = p_schedule_id
    and idempotency_key = p_idempotency_key and status = 'pending'
    and claim_token_hash = encode(extensions.digest(p_claim_token, 'sha256'), 'hex')
    and lease_expires_at > statement_timestamp()
  for update;
  if attempt_id is null then raise exception 'PUBLISH_CLAIM_INVALID'; end if;

  exact_native_recovery := p_schedule_id = 'dab2a638-3aae-4f8d-a926-6478cf6bf0b2'::uuid
    and attempt_number_value = 3;
  if p_status = 'failed' and (
    (exact_native_recovery and p_error_code !~ '^META_C[0-9]{1,10}_S[0-9]{1,10}_(AUTH|PERMISSION|RATE_LIMIT|VALIDATION|CLIENT)$')
    or (
      not exact_native_recovery
      and p_error_code not in ('TEMPORARY_NETWORK','RATE_LIMITED','TOKEN_EXPIRED','APPROVAL_STALE','PROVIDER_REJECTED')
    )
  ) then raise exception 'PUBLISH_RESULT_INVALID'; end if;

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

revoke all on function private.load_instagram_provider_rejected_retry_media_internal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.load_instagram_provider_rejected_retry_media_internal(uuid, uuid)
  to service_role;

revoke all on function public.complete_claimed_publish(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_claimed_publish(uuid, uuid, text, text, text, text, text, text)
  to service_role;
