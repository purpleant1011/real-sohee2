create function public.approve_and_dispatch_meta_content(
  p_workspace_id uuid,
  p_content_id uuid,
  p_version_id uuid,
  p_expected_fingerprint text,
  p_mode text,
  p_publish_at timestamptz default null,
  p_timezone text default null,
  p_channel_connection_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval_id uuid;
  schedule_id uuid;
  approved_channel text;
  connected_channel text;
begin
  if p_mode not in ('approve_only', 'publish_now', 'schedule') then
    raise exception 'APPROVE_DISPATCH_MODE_INVALID';
  end if;

  approval_id := private.approve_content_version_internal(
    p_workspace_id,
    p_content_id,
    p_version_id,
    p_expected_fingerprint,
    true,
    true,
    'v' || (
      select version.version_number::text
      from public.content_versions as version
      where version.workspace_id = p_workspace_id and version.id = p_version_id
    ) || ' 게시 미리보기 승인'
  );

  if p_mode = 'approve_only' then
    return jsonb_build_object(
      'approvalId', approval_id,
      'scheduleId', null,
      'next', 'approved'
    );
  end if;

  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception 'PUBLISH_DISPATCH_FORBIDDEN';
  end if;

  if p_channel_connection_id is null then
    raise exception 'PUBLISH_CONNECTION_REQUIRED';
  end if;

  if p_mode = 'schedule' then
    schedule_id := private.schedule_approved_content_once_internal(
      p_workspace_id,
      approval_id,
      p_publish_at,
      p_timezone,
      p_channel_connection_id
    );
    return jsonb_build_object(
      'approvalId', approval_id,
      'scheduleId', schedule_id,
      'next', 'scheduled'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || ':' || approval_id::text, 0)
  );

  select schedule.id into schedule_id
  from public.schedules as schedule
  where schedule.workspace_id = p_workspace_id
    and schedule.approval_id = approval_id
    and schedule.status in ('scheduled', 'publishing')
  order by schedule.created_at
  limit 1;

  if schedule_id is null then
    select content.channel into approved_channel
    from public.content_items as content
    join public.approvals as approval
      on approval.workspace_id = content.workspace_id
     and approval.content_id = content.id
     and approval.version_id = content.current_version_id
     and approval.id = approval_id
     and approval.status = 'approved'
     and approval.fingerprint = p_expected_fingerprint
     and approval.disclosure_confirmed
     and approval.rights_confirmed
    where content.workspace_id = p_workspace_id
      and content.id = p_content_id
      and content.current_version_id = p_version_id
    for update of content;

    if approved_channel not in ('instagram', 'threads')
      or not private.is_content_version_publishable(p_workspace_id, p_version_id) then
      raise exception 'PUBLISH_VERSION_NOT_READY';
    end if;

    select connection.channel into connected_channel
    from public.channel_connections as connection
    where connection.workspace_id = p_workspace_id
      and connection.id = p_channel_connection_id
      and connection.status = 'connected'
    for update;

    if connected_channel is null or connected_channel <> approved_channel then
      raise exception 'PUBLISH_CONNECTION_MISMATCH';
    end if;

    if p_timezone is null or char_length(p_timezone) not between 1 and 64 then
      raise exception 'PUBLISH_TIMEZONE_INVALID';
    end if;

    insert into public.schedules (
      workspace_id, approval_id, content_id, version_id, channel_connection_id,
      publish_at, timezone, status, created_by
    ) values (
      p_workspace_id, approval_id, p_content_id, p_version_id, p_channel_connection_id,
      statement_timestamp(), p_timezone, 'scheduled', (select auth.uid())
    ) returning id into schedule_id;

    update public.content_items
    set status = 'scheduled'
    where workspace_id = p_workspace_id and id = p_content_id and current_version_id = p_version_id;

    perform private.write_audit_event(
      p_workspace_id,
      'content.publish_requested',
      'schedule',
      schedule_id,
      jsonb_build_object(
        'versionId', p_version_id,
        'channelConnectionId', p_channel_connection_id,
        'mode', 'publish_now'
      )
    );
  end if;

  return jsonb_build_object(
    'approvalId', approval_id,
    'scheduleId', schedule_id,
    'next', 'publishing'
  );
end;
$$;

revoke all on function public.approve_and_dispatch_meta_content(
  uuid, uuid, uuid, text, text, timestamptz, text, uuid
) from public, anon;
grant execute on function public.approve_and_dispatch_meta_content(
  uuid, uuid, uuid, text, text, timestamptz, text, uuid
) to authenticated;

comment on function public.approve_and_dispatch_meta_content(
  uuid, uuid, uuid, text, text, timestamptz, text, uuid
) is 'Atomically binds an exact preview version approval to an optional Meta publish intent.';
