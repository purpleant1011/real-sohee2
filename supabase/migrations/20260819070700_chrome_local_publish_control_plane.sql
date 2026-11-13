alter table public.external_action_requests
  drop constraint external_action_requests_channel_check,
  drop constraint external_action_requests_action_kind_check,
  drop constraint external_action_requests_status_check,
  drop constraint external_action_requests_failure_code_check;

alter table public.external_action_requests
  add constraint external_action_requests_channel_check check (
    channel in ('naver_blog', 'naver_place', 'daangn_business')
  ),
  add constraint external_action_requests_action_kind_check check (
    action_kind in ('profile_edit', 'news_post', 'blog_post', 'business_news_post')
  ),
  add constraint external_action_requests_status_check check (status in (
    'connection_required', 'user_login_required', 'ready', 'prepared', 'approval_required',
    'executing', 'submitted', 'provider_review', 'succeeded', 'failed',
    'manual_assist_required', 'unknown_result', 'reconfirmation_required'
  )),
  add constraint external_action_requests_failure_code_check check (failure_code is null or failure_code in (
    'REAUTH_REQUIRED', 'UI_DRIFT', 'TARGET_MISMATCH', 'POLICY_RESTRICTION',
    'DOCUMENT_REQUIRED', 'DUPLICATE_AMBIGUOUS', 'UNKNOWN_RESULT', 'BROKER_UNAVAILABLE',
    'CONTENT_MISMATCH', 'MEDIA_DOWNLOAD_FAILED', 'MEDIA_UPLOAD_FAILED', 'DEADLINE_EXPIRED',
    'DEVICE_OFFLINE', 'SUBMIT_PERMIT_REQUIRED'
  ));

alter table public.external_action_attempts
  drop constraint external_action_attempts_failure_code_check;

alter table public.external_action_attempts
  add constraint external_action_attempts_failure_code_check check (failure_code is null or failure_code in (
    'REAUTH_REQUIRED', 'UI_DRIFT', 'TARGET_MISMATCH', 'POLICY_RESTRICTION',
    'DOCUMENT_REQUIRED', 'DUPLICATE_AMBIGUOUS', 'UNKNOWN_RESULT', 'BROKER_UNAVAILABLE',
    'CONTENT_MISMATCH', 'MEDIA_DOWNLOAD_FAILED', 'MEDIA_UPLOAD_FAILED', 'DEADLINE_EXPIRED',
    'DEVICE_OFFLINE', 'SUBMIT_PERMIT_REQUIRED'
  ));

create table public.connector_devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  platform text not null check (platform in ('windows', 'macos')),
  client_kind text not null default 'chrome_extension'
    check (client_kind in ('chrome_extension', 'native_companion')),
  client_version text not null check (char_length(client_version) between 1 and 40),
  token_digest text not null unique check (token_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'active' check (status in ('active', 'stale', 'revoked')),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint connector_devices_workspace_id_id_key unique (workspace_id, id)
);

create index connector_devices_workspace_status_idx
  on public.connector_devices (workspace_id, status, last_seen_at desc);

create table private.connector_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code_digest text not null unique check (code_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at)
);

create table public.browser_channel_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  device_id uuid not null,
  channel text not null check (channel in ('naver_blog', 'daangn_business')),
  external_account_label text not null check (char_length(external_account_label) between 1 and 255),
  target_external_id text not null check (char_length(target_external_id) between 1 and 255),
  target_url text not null check (char_length(target_url) between 1 and 2048),
  target_fingerprint text not null check (target_fingerprint ~ '^[a-f0-9]{64}$'),
  environment text not null check (environment in ('test', 'production')),
  status text not null check (status in ('connected', 'reauth_required', 'target_mismatch', 'unavailable', 'revoked')),
  verified_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint browser_channel_connections_workspace_id_id_key unique (workspace_id, id),
  constraint browser_channel_connections_workspace_device_fkey
    foreign key (workspace_id, device_id)
    references public.connector_devices(workspace_id, id) on delete cascade,
  unique (workspace_id, channel, target_fingerprint, environment)
);

create index browser_channel_connections_workspace_status_idx
  on public.browser_channel_connections (workspace_id, channel, status, last_seen_at desc);

alter table public.external_action_requests
  add column browser_channel_connection_id uuid,
  add constraint external_action_requests_browser_connection_fkey
    foreign key (workspace_id, browser_channel_connection_id)
    references public.browser_channel_connections(workspace_id, id) on delete restrict;

create table private.local_publish_leases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  action_request_id uuid not null,
  attempt_id uuid not null,
  device_id uuid not null,
  status text not null default 'active' check (status in ('active', 'submitted', 'completed', 'released')),
  current_phase text not null default 'claimed' check (current_phase in (
    'claimed', 'account_verified', 'editor_ready', 'content_filled', 'preflight_verified',
    'submitted', 'result_observed', 'succeeded', 'device_offline', 'reauth_required',
    'target_mismatch', 'ui_drift', 'media_download_failed', 'media_upload_failed',
    'content_mismatch', 'deadline_expired', 'policy_restriction', 'failed_before_submit',
    'unknown_after_submit', 'reconfirmation_required', 'cancelled'
  )),
  submit_permit_digest text check (submit_permit_digest is null or submit_permit_digest ~ '^[a-f0-9]{64}$'),
  submit_permit_issued_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint local_publish_leases_workspace_action_fkey
    foreign key (workspace_id, action_request_id)
    references public.external_action_requests(workspace_id, id) on delete cascade,
  constraint local_publish_leases_workspace_attempt_fkey
    foreign key (workspace_id, attempt_id)
    references public.external_action_attempts(workspace_id, id) on delete cascade,
  constraint local_publish_leases_workspace_device_fkey
    foreign key (workspace_id, device_id)
    references public.connector_devices(workspace_id, id) on delete cascade
);

create unique index local_publish_leases_one_open_action_idx
  on private.local_publish_leases (workspace_id, action_request_id)
  where status in ('active', 'submitted');

create trigger connector_devices_set_updated_at
before update on public.connector_devices
for each row execute function private.set_updated_at();

create trigger browser_channel_connections_set_updated_at
before update on public.browser_channel_connections
for each row execute function private.set_updated_at();

create trigger local_publish_leases_set_updated_at
before update on private.local_publish_leases
for each row execute function private.set_updated_at();

alter table public.connector_devices enable row level security;
alter table public.browser_channel_connections enable row level security;

revoke all on table public.connector_devices, public.browser_channel_connections
  from public, anon, authenticated;
grant select on table public.connector_devices, public.browser_channel_connections to authenticated;
grant select, insert, update, delete on table public.connector_devices, public.browser_channel_connections to service_role;

revoke all on table private.connector_pairing_codes, private.local_publish_leases
  from public, anon, authenticated;
grant select, insert, update, delete on table private.connector_pairing_codes, private.local_publish_leases to service_role;

create policy "workspace members can read connector devices"
on public.connector_devices for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create policy "workspace members can read browser channel connections"
on public.browser_channel_connections for select to authenticated
using ((select private.is_workspace_member(workspace_id)));

create function public.create_connector_pairing_code(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_code_digest text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare pairing_id uuid;
begin
  if p_code_digest !~ '^[a-f0-9]{64}$'
    or p_expires_at <= statement_timestamp()
    or p_expires_at > statement_timestamp() + interval '10 minutes'
    or not exists (
      select 1 from public.workspace_members as member
      where member.workspace_id = p_workspace_id
        and member.user_id = p_actor_user_id
        and member.status = 'active'
        and member.role in ('owner', 'manager')
    ) then
    raise exception 'CONNECTOR_PAIRING_FORBIDDEN';
  end if;

  insert into private.connector_pairing_codes (
    workspace_id, code_digest, expires_at, created_by
  ) values (
    p_workspace_id, p_code_digest, p_expires_at, p_actor_user_id
  ) returning id into pairing_id;
  return pairing_id;
end;
$$;

create function public.consume_connector_pairing_code(
  p_code_digest text,
  p_display_name text,
  p_platform text,
  p_client_version text,
  p_token_digest text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare pairing private.connector_pairing_codes%rowtype;
declare device_id uuid;
begin
  if p_code_digest !~ '^[a-f0-9]{64}$'
    or p_token_digest !~ '^[a-f0-9]{64}$'
    or p_platform not in ('windows', 'macos')
    or char_length(p_display_name) not between 1 and 120
    or char_length(p_client_version) not between 1 and 40 then
    raise exception 'CONNECTOR_PAIRING_INVALID';
  end if;

  select * into pairing
  from private.connector_pairing_codes
  where code_digest = p_code_digest
    and consumed_at is null
    and expires_at >= statement_timestamp()
  for update;
  if not found then raise exception 'CONNECTOR_PAIRING_EXPIRED_OR_USED'; end if;

  insert into public.connector_devices (
    workspace_id, display_name, platform, client_version, token_digest,
    status, last_seen_at, created_by
  ) values (
    pairing.workspace_id, p_display_name, p_platform, p_client_version, p_token_digest,
    'active', statement_timestamp(), pairing.created_by
  ) returning id into device_id;

  update private.connector_pairing_codes
  set consumed_at = statement_timestamp()
  where id = pairing.id;

  return jsonb_build_object(
    'deviceId', device_id,
    'workspaceId', pairing.workspace_id
  );
end;
$$;

create function public.authenticate_connector_device(p_token_digest text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'deviceId', device.id,
    'workspaceId', device.workspace_id,
    'platform', device.platform,
    'clientVersion', device.client_version,
    'status', device.status
  )
  from public.connector_devices as device
  where device.token_digest = p_token_digest
    and device.status = 'active'
  limit 1;
$$;

create function public.heartbeat_connector_device(p_device_id uuid, p_token_digest text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.connector_devices
  set last_seen_at = statement_timestamp()
  where id = p_device_id
    and token_digest = p_token_digest
    and status = 'active';
  return found;
end;
$$;

create function public.claim_local_publish_job(
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
begin
  select * into device
  from public.connector_devices
  where workspace_id = p_workspace_id
    and id = p_device_id
    and token_digest = p_token_digest
    and status = 'active';
  if not found then raise exception 'CONNECTOR_DEVICE_UNAUTHORIZED'; end if;

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
    and not exists (
      select 1 from private.local_publish_leases as existing
      where existing.workspace_id = request.workspace_id
        and existing.action_request_id = request.id
        and existing.status in ('active', 'submitted')
    )
  order by request.created_at
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
    statement_timestamp() + interval '2 minutes'
  ) returning id into lease_id;

  update public.external_action_requests
  set status = 'executing', claimed_by = device.created_by,
      claimed_at = statement_timestamp(), failure_code = null
  where workspace_id = p_workspace_id and id = action.id;

  return jsonb_build_object(
    'jobId', action.id,
    'leaseId', lease_id,
    'attemptId', attempt_id,
    'contentVersionId', action.content_version_id,
    'approvalId', action.approval_id,
    'approvalFingerprint', action.approval_fingerprint,
    'browserChannelConnectionId', action.browser_channel_connection_id
  );
end;
$$;

create function public.record_local_publish_checkpoint(
  p_workspace_id uuid,
  p_device_id uuid,
  p_action_id uuid,
  p_lease_id uuid,
  p_phase text,
  p_failure_code text,
  p_provider_reference text,
  p_result_url text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare lease private.local_publish_leases%rowtype;
declare next_attempt_status text;
begin
  select * into lease
  from private.local_publish_leases
  where workspace_id = p_workspace_id and device_id = p_device_id
    and action_request_id = p_action_id and id = p_lease_id
  for update;
  if not found or lease.status in ('completed', 'released') then return false; end if;

  if p_phase = 'submitted' and (lease.current_phase <> 'preflight_verified' or lease.submit_permit_digest is null) then
    return false;
  end if;
  if lease.status = 'submitted' and p_phase not in ('result_observed', 'succeeded', 'unknown_after_submit') then
    return false;
  end if;

  update private.local_publish_leases
  set current_phase = p_phase,
      status = case when p_phase = 'submitted' then 'submitted' else status end,
      expires_at = statement_timestamp() + interval '2 minutes'
  where id = p_lease_id;

  if p_phase = 'submitted' then
    update public.external_action_requests set status = 'submitted'
    where workspace_id = p_workspace_id and id = lease.action_request_id;
    update public.external_action_attempts
    set status = 'submitted', provider_reference = p_provider_reference
    where workspace_id = p_workspace_id and id = lease.attempt_id;
    insert into public.external_action_receipts (
      workspace_id, action_request_id, attempt_id, receipt_kind,
      provider_reference, result_url, recorded_by
    )
    select p_workspace_id, lease.action_request_id, lease.attempt_id, 'submission',
      p_provider_reference, p_result_url, device.created_by
    from public.connector_devices as device
    where device.workspace_id = p_workspace_id and device.id = lease.device_id;
  elsif p_phase in (
    'device_offline', 'reauth_required', 'target_mismatch', 'ui_drift',
    'media_download_failed', 'media_upload_failed', 'content_mismatch',
    'deadline_expired', 'policy_restriction', 'failed_before_submit', 'cancelled'
  ) then
    next_attempt_status := 'failed';
    update public.external_action_requests
    set status = 'failed', failure_code = p_failure_code
    where workspace_id = p_workspace_id and id = lease.action_request_id;
    update public.external_action_attempts
    set status = next_attempt_status, failure_code = p_failure_code,
        provider_reference = p_provider_reference, finished_at = statement_timestamp()
    where workspace_id = p_workspace_id and id = lease.attempt_id;
    update private.local_publish_leases set status = 'released' where id = p_lease_id;
  end if;
  return true;
end;
$$;

create function public.issue_local_submit_permit(
  p_workspace_id uuid,
  p_device_id uuid,
  p_action_id uuid,
  p_lease_id uuid,
  p_permit_digest text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_permit_digest !~ '^[a-f0-9]{64}$' then return false; end if;
  update private.local_publish_leases
  set submit_permit_digest = p_permit_digest,
      submit_permit_issued_at = statement_timestamp(),
      expires_at = statement_timestamp() + interval '2 minutes'
  where workspace_id = p_workspace_id
    and device_id = p_device_id
    and action_request_id = p_action_id
    and id = p_lease_id
    and status = 'active'
    and current_phase = 'preflight_verified'
    and submit_permit_digest is null;
  return found;
end;
$$;

create function public.complete_local_publish_job(
  p_workspace_id uuid,
  p_device_id uuid,
  p_action_id uuid,
  p_lease_id uuid,
  p_status text,
  p_provider_reference text,
  p_result_url text,
  p_failure_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare lease private.local_publish_leases%rowtype;
declare recorded_by_user uuid;
begin
  if p_status not in ('succeeded', 'failed_before_submit', 'unknown_after_submit') then return false; end if;
  if p_status = 'succeeded' and (p_result_url is null or char_length(p_result_url) > 2048) then return false; end if;
  if p_status = 'failed_before_submit' and p_failure_code is null then return false; end if;
  select * into lease
  from private.local_publish_leases
  where workspace_id = p_workspace_id and device_id = p_device_id
    and action_request_id = p_action_id and id = p_lease_id
  for update;
  if not found or lease.status in ('completed', 'released') then return false; end if;
  if p_status in ('succeeded', 'unknown_after_submit') and lease.status <> 'submitted' then return false; end if;

  select created_by into recorded_by_user from public.connector_devices
  where workspace_id = p_workspace_id and id = lease.device_id;

  update public.external_action_requests
  set status = case p_status when 'succeeded' then 'succeeded' when 'unknown_after_submit' then 'unknown_result' else 'failed' end,
      failure_code = case when p_status = 'unknown_after_submit' then 'UNKNOWN_RESULT' else p_failure_code end
  where workspace_id = p_workspace_id and id = lease.action_request_id;

  update public.external_action_attempts
  set status = case p_status when 'succeeded' then 'succeeded' when 'unknown_after_submit' then 'unknown_result' else 'failed' end,
      failure_code = case when p_status = 'unknown_after_submit' then 'UNKNOWN_RESULT' else p_failure_code end,
      provider_reference = p_provider_reference,
      finished_at = statement_timestamp()
  where workspace_id = p_workspace_id and id = lease.attempt_id;

  if p_status = 'succeeded' then
    insert into public.external_action_receipts (
      workspace_id, action_request_id, attempt_id, receipt_kind,
      provider_reference, result_url, recorded_by
    ) values (
      p_workspace_id, lease.action_request_id, lease.attempt_id, 'observed_result',
      p_provider_reference, p_result_url, recorded_by_user
    );
  end if;

  update private.local_publish_leases
  set status = case
        when p_status = 'failed_before_submit' then 'released'
        when p_status = 'unknown_after_submit' then 'submitted'
        else 'completed'
      end,
      current_phase = p_status
  where id = p_lease_id;
  return true;
end;
$$;

revoke all on function public.create_connector_pairing_code(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_connector_pairing_code(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.authenticate_connector_device(text) from public, anon, authenticated;
revoke all on function public.heartbeat_connector_device(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_local_publish_job(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.record_local_publish_checkpoint(uuid, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.issue_local_submit_permit(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.complete_local_publish_job(uuid, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;

grant execute on function public.create_connector_pairing_code(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.consume_connector_pairing_code(text, text, text, text, text) to service_role;
grant execute on function public.authenticate_connector_device(text) to service_role;
grant execute on function public.heartbeat_connector_device(uuid, text) to service_role;
grant execute on function public.claim_local_publish_job(uuid, uuid, text) to service_role;
grant execute on function public.record_local_publish_checkpoint(uuid, uuid, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.issue_local_submit_permit(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.complete_local_publish_job(uuid, uuid, uuid, uuid, text, text, text, text) to service_role;

create function public.revoke_connector_device(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_device_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare released_action_ids uuid[];
begin
  if not exists (
    select 1 from public.workspace_members as member
    where member.workspace_id = p_workspace_id
      and member.user_id = p_actor_user_id
      and member.status = 'active'
      and member.role in ('owner', 'manager')
  ) then return false; end if;

  update public.connector_devices
  set status = 'revoked', revoked_at = statement_timestamp()
  where workspace_id = p_workspace_id and id = p_device_id and status <> 'revoked';
  if not found then return false; end if;

  update public.browser_channel_connections
  set status = 'revoked'
  where workspace_id = p_workspace_id and device_id = p_device_id and status <> 'revoked';

  select coalesce(array_agg(lease.action_request_id), '{}'::uuid[])
  into released_action_ids
  from private.local_publish_leases as lease
  where lease.workspace_id = p_workspace_id
    and lease.device_id = p_device_id
    and lease.status = 'active';

  update private.local_publish_leases
  set status = 'released', current_phase = 'device_offline'
  where workspace_id = p_workspace_id and device_id = p_device_id and status = 'active';

  update public.external_action_requests
  set status = 'failed', failure_code = 'DEVICE_OFFLINE'
  where workspace_id = p_workspace_id and id = any(released_action_ids) and status = 'executing';

  update public.external_action_attempts
  set status = 'failed', failure_code = 'DEVICE_OFFLINE', finished_at = statement_timestamp()
  where workspace_id = p_workspace_id and action_request_id = any(released_action_ids) and status = 'claimed';
  return true;
end;
$$;

revoke all on function public.revoke_connector_device(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_connector_device(uuid, uuid, uuid) to service_role;
