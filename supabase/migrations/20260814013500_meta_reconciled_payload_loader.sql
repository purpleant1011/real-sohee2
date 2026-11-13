create or replace function private.load_reconciled_meta_publish_payload_internal(
  p_workspace_id uuid,
  p_schedule_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace_id', schedule.workspace_id,
    'content_id', schedule.content_id,
    'schedule_id', schedule.id,
    'schedule_status', schedule.status,
    'version_id', version.id,
    'current_version_id', content.current_version_id,
    'approval_version_id', approval.version_id,
    'version_fingerprint', version.fingerprint,
    'approval_fingerprint', approval.fingerprint,
    'approval_status', approval.status,
    'disclosure_confirmed', approval.disclosure_confirmed,
    'rights_confirmed', approval.rights_confirmed,
    'connection_status', connection.status,
    'channel', content.channel,
    'connection_channel', connection.channel,
    'external_account_id', connection.external_account_id,
    'caption', version.caption,
    'hashtags', to_jsonb(version.hashtags),
    'disclosure', version.disclosure,
    'media', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', link.position,
        'media_asset_id', link.media_asset_id,
        'bucket_id', asset.bucket_id,
        'object_path', asset.object_path,
        'mime_type', asset.mime_type,
        'rights_status', asset.rights_status
      ) order by link.position)
      from public.content_version_media as link
      join public.media_assets as asset
        on asset.workspace_id = link.workspace_id
        and asset.id = link.media_asset_id
      where link.workspace_id = schedule.workspace_id
        and link.version_id = version.id
    ), '[]'::jsonb)
  )
  from public.schedules as schedule
  join public.content_items as content
    on content.workspace_id = schedule.workspace_id
    and content.id = schedule.content_id
    and content.current_version_id = schedule.version_id
  join public.content_versions as version
    on version.workspace_id = schedule.workspace_id
    and version.id = schedule.version_id
  join public.approvals as approval
    on approval.workspace_id = schedule.workspace_id
    and approval.id = schedule.approval_id
    and approval.content_id = schedule.content_id
    and approval.version_id = version.id
    and approval.fingerprint = version.fingerprint
    and approval.status = 'approved'
    and approval.disclosure_confirmed
    and approval.rights_confirmed
  join public.channel_connections as connection
    on connection.workspace_id = schedule.workspace_id
    and connection.id = schedule.channel_connection_id
    and connection.channel = content.channel
    and connection.status = 'connected'
    and connection.external_account_id is not null
  where schedule.workspace_id = p_workspace_id
    and schedule.id = p_schedule_id
    and schedule.status = 'unknown'
    and exists (
      select 1
      from public.publish_attempts as attempt
      where attempt.workspace_id = schedule.workspace_id
        and attempt.schedule_id = schedule.id
        and attempt.status = 'unknown'
        and attempt.recovery_status = 'reconcile_required'
        and attempt.attempt_number = (
          select max(latest.attempt_number)
          from public.publish_attempts as latest
          where latest.workspace_id = attempt.workspace_id
            and latest.schedule_id = attempt.schedule_id
        )
    );
$$;

create or replace function public.load_reconciled_meta_publish_payload(
  p_workspace_id uuid,
  p_schedule_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.load_reconciled_meta_publish_payload_internal(
    p_workspace_id,
    p_schedule_id
  );
$$;

revoke all on function private.load_reconciled_meta_publish_payload_internal(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.load_reconciled_meta_publish_payload(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.load_reconciled_meta_publish_payload_internal(uuid, uuid)
  to service_role;
grant execute on function public.load_reconciled_meta_publish_payload(uuid, uuid)
  to service_role;
