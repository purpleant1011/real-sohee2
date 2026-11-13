alter table public.external_action_requests
  add column scheduled_at timestamptz,
  add column auto_execute_until timestamptz,
  add column reconfirmed_by uuid references auth.users(id),
  add column reconfirmed_at timestamptz;

create function private.set_local_publish_auto_execute_until()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.auto_execute_until := case
    when new.scheduled_at is null then null
    else new.scheduled_at + interval '30 minutes'
  end;
  return new;
end;
$$;

create trigger external_action_requests_set_auto_execute_until
before insert or update of scheduled_at on public.external_action_requests
for each row execute function private.set_local_publish_auto_execute_until();

create function private.local_publish_schedule_state(
  p_scheduled_at timestamptz,
  p_observed_at timestamptz
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when p_observed_at < p_scheduled_at then 'not_due'
    when p_observed_at <= p_scheduled_at + interval '30 minutes' then 'auto_execute'
    else 'reconfirmation_required'
  end
$$;

create or replace function public.claim_local_publish_job(
  p_workspace_id uuid,
  p_device_id uuid,
  p_token_digest text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare device public.connector_devices%rowtype;
declare action public.external_action_requests%rowtype;
declare attempt_id uuid;
declare lease_id uuid;
declare observed_at timestamptz := statement_timestamp();
begin
  select * into device
  from public.connector_devices
  where workspace_id = p_workspace_id
    and id = p_device_id
    and token_digest = p_token_digest
    and status = 'active';
  if not found then raise exception 'CONNECTOR_DEVICE_UNAUTHORIZED'; end if;

  update public.external_action_requests as expired
  set status = 'reconfirmation_required',
      failure_code = 'DEADLINE_EXPIRED'
  where expired.workspace_id = p_workspace_id
    and expired.channel in ('naver_blog', 'daangn_business')
    and expired.action_kind in ('blog_post', 'business_news_post')
    and expired.status in ('ready', 'prepared')
    and expired.scheduled_at is not null
    and expired.auto_execute_until < observed_at;

  select request.* into action
  from public.external_action_requests as request
  join public.browser_channel_connections as connection
    on connection.workspace_id = request.workspace_id
   and connection.id = request.browser_channel_connection_id
   and connection.device_id = p_device_id
   and connection.status = 'connected'
   and connection.target_external_id = request.target_external_id
  join public.content_versions as version
    on version.workspace_id = request.workspace_id
   and version.id = request.content_version_id
  join public.content_items as content
    on content.workspace_id = request.workspace_id
   and content.id = version.content_id
   and content.current_version_id = version.id
  join public.approvals as approval
    on approval.workspace_id = request.workspace_id
   and approval.id = request.approval_id
   and approval.version_id = version.id
   and approval.status = 'approved'
   and approval.fingerprint = version.fingerprint
   and approval.fingerprint = request.approval_fingerprint
  where request.workspace_id = p_workspace_id
    and request.channel in ('naver_blog', 'daangn_business')
    and request.action_kind in ('blog_post', 'business_news_post')
    and request.status in ('ready', 'prepared')
    and (
      request.scheduled_at is null
      or observed_at between request.scheduled_at and request.auto_execute_until
    )
    and not exists (
      select 1 from private.local_publish_leases as existing
      where existing.workspace_id = request.workspace_id
        and existing.action_request_id = request.id
        and existing.status in ('active', 'submitted')
    )
  order by coalesce(request.scheduled_at, request.created_at), request.created_at
  limit 1
  for update of request skip locked;

  if not found then return null; end if;

  insert into public.external_action_attempts (
    workspace_id, action_request_id, attempt_number, status, created_by
  ) values (
    p_workspace_id, action.id,
    (select coalesce(max(previous.attempt_number), 0) + 1
      from public.external_action_attempts as previous
      where previous.action_request_id = action.id),
    'claimed', device.created_by
  ) returning id into attempt_id;

  insert into private.local_publish_leases (
    workspace_id, action_request_id, attempt_id, device_id, expires_at
  ) values (
    p_workspace_id, action.id, attempt_id, p_device_id,
    observed_at + interval '2 minutes'
  ) returning id into lease_id;

  update public.external_action_requests
  set status = 'executing', claimed_by = device.created_by,
      claimed_at = observed_at, failure_code = null
  where workspace_id = p_workspace_id and id = action.id;

  return jsonb_build_object(
    'jobId', action.id,
    'leaseId', lease_id,
    'attemptId', attempt_id,
    'contentVersionId', action.content_version_id,
    'approvalId', action.approval_id,
    'approvalFingerprint', action.approval_fingerprint,
    'browserChannelConnectionId', action.browser_channel_connection_id,
    'scheduledAt', action.scheduled_at,
    'autoExecuteUntil', action.auto_execute_until
  );
end;
$$;

create function public.reconfirm_local_publish(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_action_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'manager')
  ) then
    raise exception 'LOCAL_PUBLISH_RECONFIRM_FORBIDDEN';
  end if;

  perform request.id
  from public.external_action_requests as request
  join public.content_versions as version
    on version.workspace_id = request.workspace_id
   and version.id = request.content_version_id
  join public.content_items as content
    on content.workspace_id = request.workspace_id
   and content.id = version.content_id
   and content.current_version_id = version.id
  join public.approvals as approval
    on approval.workspace_id = request.workspace_id
   and approval.id = request.approval_id
   and approval.version_id = version.id
   and approval.status = 'approved'
   and approval.fingerprint = version.fingerprint
   and approval.fingerprint = request.approval_fingerprint
  where request.workspace_id = p_workspace_id
    and request.id = p_action_id
    and request.status = 'reconfirmation_required'
  for update of request;

  if not found then
    raise exception 'LOCAL_PUBLISH_RECONFIRM_INVALID';
  end if;

  update public.external_action_requests
  set status = 'prepared',
      scheduled_at = null,
      reconfirmed_by = p_actor_user_id,
      reconfirmed_at = statement_timestamp(),
      failure_code = null
  where workspace_id = p_workspace_id and id = p_action_id;

  return true;
end;
$$;

revoke all on function private.local_publish_schedule_state(timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function private.set_local_publish_auto_execute_until()
  from public, anon, authenticated;
revoke all on function public.reconfirm_local_publish(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.reconfirm_local_publish(uuid, uuid, uuid) to service_role;

comment on function public.reconfirm_local_publish(uuid, uuid, uuid)
is 'Reconfirms the exact approved version after the local publish schedule grace expires.';
