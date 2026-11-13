-- Explicit per-device execution scope. Expiry/completion never restores FIFO.
create table private.local_publish_execution_scopes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  device_id uuid not null,
  action_request_id uuid not null,
  browser_channel_connection_id uuid not null,
  target_external_id text not null check (char_length(target_external_id) between 1 and 255),
  actor_user_id uuid not null references auth.users(id),
  approval_id uuid not null references public.approvals(id),
  approval_fingerprint text not null check (approval_fingerprint ~ '^[a-f0-9]{64}$'),
  request_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp() + interval '15 minutes',
  check (expires_at > created_at),
  unique (workspace_id, device_id, request_id),
  unique (workspace_id, device_id, id),
  foreign key (workspace_id, device_id) references public.connector_devices(workspace_id,id) on delete cascade,
  foreign key (workspace_id, action_request_id) references public.external_action_requests(workspace_id,id) on delete cascade,
  foreign key (workspace_id, browser_channel_connection_id) references public.browser_channel_connections(workspace_id,id)
);

create table private.connector_execution_scope_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  device_id uuid not null,
  mode text not null check (mode in ('targeted','recovery_required')),
  scope_id uuid,
  updated_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id,device_id),
  check ((mode = 'targeted') = (scope_id is not null)),
  foreign key (workspace_id,device_id) references public.connector_devices(workspace_id,id) on delete cascade,
  foreign key (workspace_id,device_id,scope_id) references private.local_publish_execution_scopes(workspace_id,device_id,id)
    deferrable initially deferred
);

create index local_publish_execution_scopes_action_idx on private.local_publish_execution_scopes(workspace_id,action_request_id);
create index local_publish_execution_scopes_actor_idx on private.local_publish_execution_scopes(actor_user_id);
create index local_publish_execution_scopes_approval_idx on private.local_publish_execution_scopes(approval_id);
create index local_publish_execution_scopes_connection_idx on private.local_publish_execution_scopes(workspace_id,browser_channel_connection_id);
create index local_publish_leases_scope_history_idx on private.local_publish_leases(workspace_id,action_request_id,created_at desc);

alter table private.local_publish_execution_scopes enable row level security;
alter table private.connector_execution_scope_state enable row level security;
revoke all on private.local_publish_execution_scopes, private.connector_execution_scope_state from public, anon, authenticated;
grant select,insert on private.local_publish_execution_scopes to service_role;
grant select,insert,update on private.connector_execution_scope_state to service_role;

-- The new invoker validation uses the existing owner-only publishability check.
grant execute on function private.is_content_version_publishable(uuid,uuid) to service_role;

-- Callers hold the device lock. Content/approval locks precede request locks.
create function private.local_publish_scope_target_valid(
  p_workspace_id uuid, p_device_id uuid, p_action_id uuid, p_actor_user_id uuid,
  p_fingerprint text, p_connection_id uuid, p_approval_id uuid, p_target_external_id text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare action public.external_action_requests%rowtype;
declare version public.content_versions%rowtype;
begin
  perform 1 from public.workspace_members
  where workspace_id=p_workspace_id and user_id=p_actor_user_id and status='active' and role in ('owner','manager')
  for share;
  if not found then return false; end if;
  select * into action from public.external_action_requests
  where workspace_id=p_workspace_id and id=p_action_id and channel='naver_blog' and action_kind='blog_post'
    and browser_channel_connection_id=p_connection_id and approval_id=p_approval_id
    and approval_fingerprint=p_fingerprint and target_external_id=p_target_external_id
    and status in ('ready','prepared','executing');
  if not found then return false; end if;
  if exists(select 1 from public.external_action_receipts where workspace_id=p_workspace_id and action_request_id=p_action_id) then return false; end if;
  select * into version from public.content_versions
  where workspace_id=p_workspace_id and id=action.content_version_id;
  if not found then return false; end if;
  perform 1 from public.content_items where workspace_id=p_workspace_id and id=version.content_id
    and current_version_id=version.id for share;
  if not found then return false; end if;
  perform 1 from public.content_versions where workspace_id=p_workspace_id and id=version.id
    and fingerprint=p_fingerprint for share;
  if not found then return false; end if;
  perform 1 from public.approvals where workspace_id=p_workspace_id and id=p_approval_id
    and version_id=version.id and status='approved' and fingerprint=p_fingerprint for share;
  if not found then return false; end if;
  perform 1 from public.browser_channel_connections where workspace_id=p_workspace_id and id=p_connection_id
    and device_id=p_device_id and channel='naver_blog' and status='connected' and target_external_id=p_target_external_id for share;
  if not found then return false; end if;
  perform 1 from public.external_action_requests where workspace_id=p_workspace_id and id=p_action_id
    and content_version_id=version.id and approval_id=p_approval_id and approval_fingerprint=p_fingerprint
    and browser_channel_connection_id=p_connection_id and target_external_id=p_target_external_id
    and status in ('ready','prepared','executing') for share;
  if not found then return false; end if;
  return private.is_content_version_publishable(p_workspace_id,version.id);
end;
$$;
revoke all on function private.local_publish_scope_target_valid(uuid,uuid,uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.local_publish_scope_target_valid(uuid,uuid,uuid,uuid,text,uuid,uuid,text) to service_role;

create function public.authorize_local_publish_execution_scope(
  p_workspace_id uuid, p_actor_user_id uuid, p_action_id uuid, p_expected_fingerprint text,
  p_request_id uuid, p_expected_connection_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare action public.external_action_requests%rowtype;
declare connection public.browser_channel_connections%rowtype;
declare scope private.local_publish_execution_scopes%rowtype;
declare current_scope uuid;
begin
  if p_request_id is null or p_expected_fingerprint is null or p_expected_fingerprint !~ '^[a-f0-9]{64}$' then return null; end if;
  if not exists (select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_user_id
    and status='active' and role in ('owner','manager')) then return null; end if;
  select * into action from public.external_action_requests where workspace_id=p_workspace_id and id=p_action_id
    and channel='naver_blog' and action_kind='blog_post' and browser_channel_connection_id=p_expected_connection_id;
  if not found then return null; end if;
  select * into connection from public.browser_channel_connections where workspace_id=p_workspace_id and id=p_expected_connection_id;
  if not found then return null; end if;
  perform 1 from public.connector_devices where workspace_id=p_workspace_id and id=connection.device_id and status='active' for update;
  if not found then return null; end if;
  select * into scope from private.local_publish_execution_scopes where workspace_id=p_workspace_id
    and device_id=connection.device_id and request_id=p_request_id;
  if found then
    select scope_id into current_scope from private.connector_execution_scope_state where workspace_id=p_workspace_id and device_id=connection.device_id;
    if current_scope is distinct from scope.id or scope.actor_user_id<>p_actor_user_id or scope.action_request_id<>p_action_id
      or scope.approval_fingerprint<>p_expected_fingerprint or scope.browser_channel_connection_id<>p_expected_connection_id then return null; end if;
  else
    if not private.local_publish_scope_target_valid(p_workspace_id,connection.device_id,p_action_id,p_actor_user_id,
      p_expected_fingerprint,p_expected_connection_id,action.approval_id,action.target_external_id) then return null; end if;
    select * into action from public.external_action_requests where workspace_id=p_workspace_id and id=p_action_id
      and status in ('ready','prepared') for update;
    if not found then return null; end if;
    if exists (select 1 from private.local_publish_leases where workspace_id=p_workspace_id and device_id=connection.device_id
      and action_request_id<>p_action_id and status in ('active','submitted')
      and (submit_permit_digest is not null or submit_permit_issued_at is not null or status='submitted')) then return null; end if;
    insert into private.local_publish_execution_scopes(workspace_id,device_id,action_request_id,browser_channel_connection_id,
      target_external_id,actor_user_id,approval_id,approval_fingerprint,request_id)
    values(p_workspace_id,connection.device_id,p_action_id,p_expected_connection_id,action.target_external_id,
      p_actor_user_id,action.approval_id,p_expected_fingerprint,p_request_id) returning * into scope;
    insert into private.connector_execution_scope_state(workspace_id,device_id,mode,scope_id)
    values(p_workspace_id,connection.device_id,'targeted',scope.id)
    on conflict(workspace_id,device_id) do update set mode='targeted',scope_id=excluded.scope_id,updated_at=statement_timestamp();
  end if;
  return jsonb_build_object('scopeId',scope.id,'actionId',scope.action_request_id,'deviceId',scope.device_id,
    'targetExternalId',scope.target_external_id,'expiresAt',scope.expires_at);
end;
$$;
revoke all on function public.authorize_local_publish_execution_scope(uuid,uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorize_local_publish_execution_scope(uuid,uuid,uuid,text,uuid,uuid) to service_role;

create function public.get_local_publish_execution_scope(p_workspace_id uuid,p_device_id uuid,p_token_digest text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare state private.connector_execution_scope_state%rowtype;
declare scope private.local_publish_execution_scopes%rowtype;
begin
  if not exists (select 1 from public.connector_devices where workspace_id=p_workspace_id and id=p_device_id
    and token_digest=p_token_digest and status='active') then raise exception 'CONNECTOR_DEVICE_UNAUTHORIZED'; end if;
  select * into state from private.connector_execution_scope_state where workspace_id=p_workspace_id and device_id=p_device_id;
  if not found then return null; end if;
  if state.mode='recovery_required' then return jsonb_build_object('mode','recovery_required'); end if;
  select * into scope from private.local_publish_execution_scopes where workspace_id=p_workspace_id and device_id=p_device_id and id=state.scope_id;
  if not found then return jsonb_build_object('mode','recovery_required'); end if;
  return jsonb_build_object('mode','targeted','scopeId',scope.id,'actionId',scope.action_request_id,'targetExternalId',scope.target_external_id);
end;
$$;
revoke all on function public.get_local_publish_execution_scope(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_local_publish_execution_scope(uuid,uuid,text) to service_role;

create function public.claim_scoped_local_publish_job(
  p_workspace_id uuid,p_device_id uuid,p_token_digest text,p_action_id uuid,p_scope_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare scope private.local_publish_execution_scopes%rowtype;
declare action public.external_action_requests%rowtype;
declare attempt_id uuid;
declare lease_id uuid;
declare observed_at timestamptz:=statement_timestamp();
begin
  perform 1 from public.connector_devices where workspace_id=p_workspace_id and id=p_device_id
    and token_digest=p_token_digest and status='active' for update;
  if not found then raise exception 'CONNECTOR_DEVICE_UNAUTHORIZED'; end if;
  select selected.* into scope from private.local_publish_execution_scopes selected
  join private.connector_execution_scope_state state on state.workspace_id=selected.workspace_id and state.device_id=selected.device_id
    and state.mode='targeted' and state.scope_id=selected.id
  where selected.workspace_id=p_workspace_id and selected.device_id=p_device_id and selected.id=p_scope_id
    and selected.action_request_id=p_action_id and selected.expires_at>observed_at;
  if not found then return null; end if;
  if not private.local_publish_scope_target_valid(p_workspace_id,p_device_id,p_action_id,scope.actor_user_id,
    scope.approval_fingerprint,scope.browser_channel_connection_id,scope.approval_id,scope.target_external_id) then return null; end if;
  select * into action from public.external_action_requests request where request.workspace_id=p_workspace_id and request.id=p_action_id
    and request.status in ('ready','prepared')
    and (request.scheduled_at is null or observed_at between request.scheduled_at and request.auto_execute_until)
    and not exists (select 1 from private.local_publish_leases lease where lease.workspace_id=p_workspace_id and lease.action_request_id=p_action_id and lease.status in ('active','submitted'))
  for update;
  if not found then return null; end if;
  insert into public.external_action_attempts(workspace_id,action_request_id,attempt_number,status,created_by)
  values(p_workspace_id,p_action_id,(select coalesce(max(previous.attempt_number),0)+1 from public.external_action_attempts previous where previous.workspace_id=p_workspace_id and previous.action_request_id=p_action_id),'claimed',scope.actor_user_id)
  returning id into attempt_id;
  insert into private.local_publish_leases(workspace_id,action_request_id,attempt_id,device_id,expires_at)
  values(p_workspace_id,p_action_id,attempt_id,p_device_id,observed_at+interval '2 minutes') returning id into lease_id;
  update public.external_action_requests set status='executing',claimed_by=scope.actor_user_id,claimed_at=observed_at,failure_code=null
  where workspace_id=p_workspace_id and id=p_action_id;
  return jsonb_build_object('jobId',action.id,'leaseId',lease_id,'attemptId',attempt_id,'contentVersionId',action.content_version_id,
    'approvalId',action.approval_id,'approvalFingerprint',action.approval_fingerprint,'browserChannelConnectionId',action.browser_channel_connection_id,
    'scheduledAt',action.scheduled_at,'autoExecuteUntil',action.auto_execute_until);
end;
$$;
revoke all on function public.claim_scoped_local_publish_job(uuid,uuid,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_scoped_local_publish_job(uuid,uuid,text,uuid,uuid) to service_role;

create function public.recover_scoped_local_publish_checkpoint(
  p_workspace_id uuid,p_device_id uuid,p_token_digest text,p_action_id uuid,p_lease_id uuid,p_may_have_submitted boolean
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare lease private.local_publish_leases%rowtype;
declare action public.external_action_requests%rowtype;
declare has_receipt boolean;
begin
  perform 1 from public.connector_devices where workspace_id=p_workspace_id and id=p_device_id and token_digest=p_token_digest and status='active' for update;
  if not found then raise exception 'CONNECTOR_DEVICE_UNAUTHORIZED'; end if;
  if p_may_have_submitted is null then return jsonb_build_object('state','blocked'); end if;
  select * into lease from private.local_publish_leases where workspace_id=p_workspace_id and device_id=p_device_id and action_request_id=p_action_id and id=p_lease_id for update;
  if not found then return jsonb_build_object('state','blocked'); end if;
  insert into private.connector_execution_scope_state(workspace_id,device_id,mode) values(p_workspace_id,p_device_id,'recovery_required')
  on conflict(workspace_id,device_id) do nothing;
  select * into action from public.external_action_requests where workspace_id=p_workspace_id and id=p_action_id for update;
  if not found then return jsonb_build_object('state','blocked'); end if;
  if not exists(select 1 from public.browser_channel_connections where workspace_id=p_workspace_id and id=action.browser_channel_connection_id and device_id=p_device_id) then return jsonb_build_object('state','blocked'); end if;
  select exists(select 1 from public.external_action_receipts where workspace_id=p_workspace_id and action_request_id=p_action_id) into has_receipt;
  if action.status='succeeded' and lease.status='completed' and exists(
    select 1 from public.external_action_receipts where workspace_id=p_workspace_id and action_request_id=p_action_id and receipt_kind='observed_result'
  ) then return jsonb_build_object('state','terminal'); end if;
  if action.status='unknown_result' and lease.status='submitted' then return jsonb_build_object('state','terminal'); end if;
  if not p_may_have_submitted and lease.status='released' and lease.submit_permit_digest is null and lease.submit_permit_issued_at is null
    and not has_receipt and action.status in ('failed','reconfirmation_required') then return jsonb_build_object('state','terminal'); end if;
  if p_may_have_submitted or lease.status='submitted' or lease.submit_permit_digest is not null or lease.submit_permit_issued_at is not null or has_receipt
    then return jsonb_build_object('state','reconcile_required'); end if;
  if lease.expires_at>=statement_timestamp() or exists(
    select 1 from private.local_publish_leases other where other.workspace_id=p_workspace_id and other.action_request_id=p_action_id and other.id<>p_lease_id
      and (other.status in ('active','submitted') or other.created_at>lease.created_at)
  ) then return jsonb_build_object('state','blocked'); end if;
  if not (
    (lease.status='active' and action.status='executing' and lease.current_phase in ('claimed','account_verified','editor_ready','content_filled','preflight_verified'))
    or (lease.status='released' and action.status in ('ready','prepared') and lease.current_phase in ('device_offline','failed_before_submit'))
  ) then return jsonb_build_object('state','blocked'); end if;
  update private.local_publish_leases set status='released',current_phase='device_offline',updated_at=statement_timestamp() where id=p_lease_id;
  update public.external_action_attempts set status='failed',failure_code='DEVICE_OFFLINE',finished_at=statement_timestamp()
  where workspace_id=p_workspace_id and id=lease.attempt_id and status='claimed';
  update public.external_action_requests set status='reconfirmation_required',failure_code='DEVICE_OFFLINE',claimed_by=null,claimed_at=null,updated_at=statement_timestamp()
  where workspace_id=p_workspace_id and id=p_action_id and status=action.status;
  return jsonb_build_object('state','recovered_before_submit');
end;
$$;
revoke all on function public.recover_scoped_local_publish_checkpoint(uuid,uuid,text,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.recover_scoped_local_publish_checkpoint(uuid,uuid,text,uuid,uuid,boolean) to service_role;

create function public.find_local_publish_execution_candidate(
  p_workspace_id uuid,p_actor_user_id uuid,p_content_id uuid,p_version_id uuid,p_fingerprint text,p_connection_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare action public.external_action_requests%rowtype;
declare result_url text;
begin
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_actor_user_id and status='active' and role in ('owner','manager')) then return null; end if;
  select request.* into action from public.external_action_requests request
  join public.content_versions version on version.workspace_id=request.workspace_id and version.id=request.content_version_id
  join public.content_items content on content.workspace_id=version.workspace_id and content.id=version.content_id and content.current_version_id=version.id
  join public.approvals approval on approval.workspace_id=request.workspace_id and approval.id=request.approval_id and approval.version_id=version.id and approval.status='approved' and approval.fingerprint=version.fingerprint
  join public.browser_channel_connections connection on connection.workspace_id=request.workspace_id and connection.id=request.browser_channel_connection_id and connection.target_external_id=request.target_external_id
  where request.workspace_id=p_workspace_id and request.channel='naver_blog' and request.action_kind='blog_post'
    and content.id=p_content_id and version.id=p_version_id and version.fingerprint=p_fingerprint and request.approval_fingerprint=p_fingerprint
    and request.browser_channel_connection_id=p_connection_id
    and request.status in ('ready','prepared','executing','submitted','succeeded','failed','unknown_result','reconfirmation_required')
  order by request.created_at desc,request.id desc limit 1;
  if not found then return null; end if;
  select receipt.result_url into result_url from public.external_action_receipts receipt
  where receipt.workspace_id=p_workspace_id and receipt.action_request_id=action.id and receipt.receipt_kind='observed_result'
  order by receipt.recorded_at desc, receipt.id desc limit 1;
  return jsonb_build_object('actionId',action.id,'status',action.status,'targetExternalId',action.target_external_id,'resultUrl',result_url);
end;
$$;
revoke all on function public.find_local_publish_execution_candidate(uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.find_local_publish_execution_candidate(uuid,uuid,uuid,uuid,text,uuid) to service_role;

-- Keep old signatures but do not expose unguarded internals through PostgREST.
alter function public.claim_local_publish_job(uuid,uuid,text) set schema private;
alter function private.claim_local_publish_job(uuid,uuid,text) rename to claim_local_publish_job_fifo;
create function public.claim_local_publish_job(p_workspace_id uuid,p_device_id uuid,p_token_digest text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.connector_devices where workspace_id=p_workspace_id and id=p_device_id and token_digest=p_token_digest and status='active' for update;
  if not found then raise exception 'CONNECTOR_DEVICE_UNAUTHORIZED'; end if;
  if exists(select 1 from private.connector_execution_scope_state where workspace_id=p_workspace_id and device_id=p_device_id) then return null; end if;
  return private.claim_local_publish_job_fifo(p_workspace_id,p_device_id,p_token_digest);
end;
$$;
revoke all on function public.claim_local_publish_job(uuid,uuid,text) from public,anon,authenticated;
revoke all on function private.claim_local_publish_job_fifo(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_local_publish_job(uuid,uuid,text),private.claim_local_publish_job_fifo(uuid,uuid,text) to service_role;

alter function public.recover_expired_local_publish_jobs(uuid,uuid) set schema private;
alter function private.recover_expired_local_publish_jobs(uuid,uuid) rename to recover_expired_local_publish_jobs_unscoped;
create function public.recover_expired_local_publish_jobs(p_workspace_id uuid,p_device_id uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.connector_devices where workspace_id=p_workspace_id and id=p_device_id and status='active' for update;
  if not found then return 0; end if;
  if exists(select 1 from private.connector_execution_scope_state where workspace_id=p_workspace_id and device_id=p_device_id) then return 0; end if;
  return private.recover_expired_local_publish_jobs_unscoped(p_workspace_id,p_device_id);
end;
$$;
revoke all on function public.recover_expired_local_publish_jobs(uuid,uuid),private.recover_expired_local_publish_jobs_unscoped(uuid,uuid) from public,anon,authenticated;
grant execute on function public.recover_expired_local_publish_jobs(uuid,uuid),private.recover_expired_local_publish_jobs_unscoped(uuid,uuid) to service_role;

alter function public.issue_local_submit_permit(uuid,uuid,uuid,uuid,text) set schema private;
alter function private.issue_local_submit_permit(uuid,uuid,uuid,uuid,text) rename to issue_local_submit_permit_unscoped;
create function public.issue_local_submit_permit(p_workspace_id uuid,p_device_id uuid,p_action_id uuid,p_lease_id uuid,p_permit_digest text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare state private.connector_execution_scope_state%rowtype;
declare scope private.local_publish_execution_scopes%rowtype;
begin
  perform 1 from public.connector_devices where workspace_id=p_workspace_id and id=p_device_id and status='active' for update;
  if not found then return false; end if;
  select * into state from private.connector_execution_scope_state where workspace_id=p_workspace_id and device_id=p_device_id;
  if found then
    if state.mode<>'targeted' then return false; end if;
    select * into scope from private.local_publish_execution_scopes where workspace_id=p_workspace_id and device_id=p_device_id and id=state.scope_id
      and action_request_id=p_action_id and expires_at>statement_timestamp();
    if not found then return false; end if;
    if not private.local_publish_scope_target_valid(p_workspace_id,p_device_id,p_action_id,scope.actor_user_id,
      scope.approval_fingerprint,scope.browser_channel_connection_id,scope.approval_id,scope.target_external_id) then return false; end if;
  end if;
  return private.issue_local_submit_permit_unscoped(p_workspace_id,p_device_id,p_action_id,p_lease_id,p_permit_digest);
end;
$$;
revoke all on function public.issue_local_submit_permit(uuid,uuid,uuid,uuid,text),private.issue_local_submit_permit_unscoped(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.issue_local_submit_permit(uuid,uuid,uuid,uuid,text),private.issue_local_submit_permit_unscoped(uuid,uuid,uuid,uuid,text) to service_role;

notify pgrst, 'reload schema';
