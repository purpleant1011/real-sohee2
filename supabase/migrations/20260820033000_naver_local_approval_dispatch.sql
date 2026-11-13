create function public.approve_and_dispatch_local_content(
  p_workspace_id uuid,
  p_content_id uuid,
  p_version_id uuid,
  p_expected_fingerprint text,
  p_mode text,
  p_publish_at timestamptz default null,
  p_timezone text default null,
  p_browser_channel_connection_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  approval_id uuid;
  action_request_id uuid;
  approved_channel text;
  connected_channel text;
  target_external_id text;
  target_label text;
  request_key text;
  scheduled_at timestamptz;
begin
  if p_mode not in ('approve_only', 'publish_now', 'schedule') then
    raise exception 'LOCAL_APPROVE_DISPATCH_MODE_INVALID';
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
    ) || ' 네이버 블로그 미리보기 승인'
  );

  if p_mode = 'approve_only' then
    return jsonb_build_object(
      'approvalId', approval_id,
      'actionRequestId', null,
      'next', 'approved'
    );
  end if;

  if not (select private.has_workspace_role(
    p_workspace_id,
    array['owner', 'manager']::text[]
  )) then
    raise exception 'LOCAL_PUBLISH_DISPATCH_FORBIDDEN';
  end if;

  if p_browser_channel_connection_id is null then
    raise exception 'LOCAL_PUBLISH_CONNECTION_REQUIRED';
  end if;

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

  if approved_channel <> 'naver_blog'
    or not private.is_content_version_publishable(p_workspace_id, p_version_id) then
    raise exception 'LOCAL_PUBLISH_VERSION_NOT_READY';
  end if;

  select connection.channel, connection.target_external_id, connection.external_account_label
  into connected_channel, target_external_id, target_label
  from public.browser_channel_connections as connection
  where connection.workspace_id = p_workspace_id
    and connection.id = p_browser_channel_connection_id
    and connection.status = 'connected'
  for update;

  if connected_channel is distinct from approved_channel then
    raise exception 'LOCAL_PUBLISH_CONNECTION_MISMATCH';
  end if;

  if p_timezone is null or char_length(p_timezone) not between 1 and 64 then
    raise exception 'LOCAL_PUBLISH_TIMEZONE_INVALID';
  end if;

  if p_mode = 'schedule' then
    if p_publish_at is null or p_publish_at < statement_timestamp() + interval '1 hour' then
      raise exception 'LOCAL_PUBLISH_TIME_INVALID';
    end if;
    scheduled_at := p_publish_at;
  else
    scheduled_at := null;
  end if;

  request_key := 'local:' || approval_id::text || ':' || p_mode || ':' || coalesce(scheduled_at::text, 'now');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_workspace_id::text || ':' || request_key, 0));

  select request.id into action_request_id
  from public.external_action_requests as request
  where request.workspace_id = p_workspace_id and request.idempotency_key = request_key
  limit 1;

  if action_request_id is null then
    insert into public.external_action_requests (
      workspace_id, channel, action_kind, target_external_id, target_label,
      exact_payload, content_version_id, approval_id, approval_fingerprint,
      idempotency_key, status, created_by, browser_channel_connection_id,
      scheduled_at
    ) values (
      p_workspace_id, approved_channel, 'blog_post', target_external_id, target_label,
      jsonb_build_object(
        'contentId', p_content_id,
        'versionId', p_version_id,
        'fingerprint', p_expected_fingerprint,
        'visibility', 'private'
      ),
      p_version_id, approval_id, p_expected_fingerprint,
      request_key, 'ready', (select auth.uid()), p_browser_channel_connection_id,
      scheduled_at
    ) returning id into action_request_id;
  end if;

  update public.content_items
  set status = 'scheduled'
  where workspace_id = p_workspace_id and id = p_content_id and current_version_id = p_version_id;

  perform private.write_audit_event(
    p_workspace_id,
    'content.scheduled',
    'schedule',
    action_request_id,
    jsonb_build_object(
      'versionId', p_version_id,
      'browserChannelConnectionId', p_browser_channel_connection_id,
      'mode', p_mode,
      'scheduledAt', scheduled_at
    )
  );

  return jsonb_build_object(
    'approvalId', approval_id,
    'actionRequestId', action_request_id,
    'next', case when p_mode = 'schedule' then 'scheduled' else 'publishing' end
  );
end;
$$;

revoke all on function public.approve_and_dispatch_local_content(
  uuid, uuid, uuid, text, text, timestamptz, text, uuid
) from public, anon;
grant execute on function public.approve_and_dispatch_local_content(
  uuid, uuid, uuid, text, text, timestamptz, text, uuid
) to authenticated;

comment on function public.approve_and_dispatch_local_content(
  uuid, uuid, uuid, text, text, timestamptz, text, uuid
) is 'Binds an exact approved Naver Blog version to a verified local connector target.';
