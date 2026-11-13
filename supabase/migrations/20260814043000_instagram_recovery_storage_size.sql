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
    'derivative_size_bytes', case
      when derivative.metadata ->> 'size' ~ '^[1-9][0-9]*$'
        then (derivative.metadata ->> 'size')::bigint
      else null
    end,
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
    and derivative.metadata ->> 'size' ~ '^[1-9][0-9]*$'
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

revoke all on function private.load_instagram_provider_rejected_retry_media_internal(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.load_instagram_provider_rejected_retry_media_internal(uuid, uuid)
  to service_role;
