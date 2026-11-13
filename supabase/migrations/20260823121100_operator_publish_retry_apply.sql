alter table public.publish_attempts
  add column if not exists approval_request_id uuid references public.admin_approval_requests (id) on delete restrict;

create unique index if not exists publish_attempts_approval_request_idx
  on public.publish_attempts (approval_request_id)
  where approval_request_id is not null;

alter table public.platform_audit_events
  drop constraint if exists platform_audit_events_action_check;
alter table public.platform_audit_events
  add constraint platform_audit_events_action_check check (action in (
    'agreement.verify.requested', 'agreement.verify.approved',
    'channel.disconnect.requested', 'channel.disconnect.approved',
    'publish.retry.requested', 'publish.retry.approved', 'publish.retry.applied',
    'credit.adjust.requested', 'credit.adjust.approved',
    'admin.role.change.workspace.requested', 'admin.role.change.workspace.approved',
    'admin.role.change.global.requested', 'admin.role.change.global.approved',
    'audit.export.workspace.requested', 'audit.export.workspace.approved',
    'audit.export.global.requested', 'audit.export.global.approved',
    'admin.account.activated', 'workspace.activation.requested',
    'document.version.draft_created', 'document.version.reviewed', 'document.version.activated',
    'credit.adjust.applied'
  ));

create or replace function public.apply_approved_publish_retry(p_approval_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_current_operator_aal2_actor();
  request_row public.admin_approval_requests%rowtype;
  failed_row public.publish_attempts%rowtype;
  latest_attempt integer;
  retry_id uuid;
  retry_key text;
  audit_key text;
begin
  if p_approval_request_id is null then raise exception 'PUBLISH_INPUT_INVALID'; end if;
  if not exists (select 1 from public.platform_admin_members where user_id = actor_id and status = 'active') then
    raise exception 'OPERATOR_DISABLED';
  end if;

  select * into request_row
  from public.admin_approval_requests
  where id = p_approval_request_id
  for update;
  if not found or request_row.action_type <> 'publish.retry' then raise exception 'APPROVAL_NOT_FOUND'; end if;
  if not private.has_platform_permission('publish.retry.request', request_row.workspace_id) then raise exception 'PERMISSION_DENIED'; end if;

  select id into retry_id from public.publish_attempts where approval_request_id = request_row.id;
  if retry_id is not null then
    return jsonb_build_object('retry_attempt_id', retry_id, 'status', 'applied');
  end if;
  if request_row.status <> 'approved' then raise exception 'APPROVAL_STATE_CONFLICT'; end if;
  if statement_timestamp() >= request_row.expires_at then raise exception 'APPROVAL_EXPIRED'; end if;
  if request_row.expected_version is null or request_row.target_type <> 'publish_attempt'
    or request_row.request_payload <> '{"retry_mode":"no_post"}'::jsonb then
    raise exception 'PUBLISH_INPUT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(request_row.workspace_id::text || ':' || request_row.target_id, 0)
  );
  select * into failed_row
  from public.publish_attempts
  where workspace_id = request_row.workspace_id
    and id = request_row.target_id::uuid
    and status = 'failed'
    and error_code is distinct from 'RESULT_UNKNOWN'
    and recovery_status = 'retry_ready'
  for update;
  if not found then raise exception 'PUBLISH_RETRY_NOT_READY'; end if;
  select max(attempt_number) into latest_attempt
  from public.publish_attempts
  where workspace_id = failed_row.workspace_id and schedule_id = failed_row.schedule_id;
  if latest_attempt is distinct from request_row.expected_version or failed_row.attempt_number <> latest_attempt then
    raise exception 'PUBLISH_ATTEMPT_STALE';
  end if;

  perform 1 from public.schedules
  where workspace_id = failed_row.workspace_id and id = failed_row.schedule_id and status = 'failed'
  for update;
  if not found then raise exception 'PUBLISH_RETRY_NOT_READY'; end if;

  retry_key := encode(extensions.digest('approved-publish-retry:' || request_row.id::text, 'sha256'), 'hex');

  insert into public.publish_attempts (
    workspace_id, schedule_id, attempt_number, idempotency_key, approval_request_id,
    status, created_by
  ) values (
    failed_row.workspace_id, failed_row.schedule_id, latest_attempt + 1,
    retry_key, request_row.id, 'pending', actor_id
  ) returning id into retry_id;

  update public.schedules
  set status = 'scheduled', updated_at = statement_timestamp()
  where workspace_id = failed_row.workspace_id and id = failed_row.schedule_id and status = 'failed';
  if not found then raise exception 'PUBLISH_RETRY_NOT_READY'; end if;

  update public.admin_approval_requests
  set status = 'applied', applied_at = statement_timestamp(),
      result_summary = jsonb_build_object('retry_attempt_id', retry_id)
  where id = request_row.id;

  audit_key := encode(extensions.digest('publish-retry-applied:' || request_row.id::text, 'sha256'), 'hex');
  perform private.append_platform_audit_event(
    actor_id, request_row.workspace_id, 'publish.retry.applied', 'publish_attempt',
    retry_id::text, request_row.reason, request_row.id::text, 'succeeded',
    jsonb_build_object('source_attempt_id', failed_row.id, 'expected_version', request_row.expected_version),
    jsonb_build_object('retry_attempt_id', retry_id, 'status', 'pending'), audit_key,
    'observed', request_row.id, null
  );
  return jsonb_build_object('retry_attempt_id', retry_id, 'status', 'applied');
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'APPROVAL_NOT_FOUND', 'APPROVAL_STATE_CONFLICT', 'APPROVAL_EXPIRED', 'PUBLISH_INPUT_INVALID', 'PUBLISH_RETRY_NOT_READY', 'PUBLISH_ATTEMPT_STALE') then raise; end if;
  raise exception 'PUBLISH_RETRY_APPLY_UNAVAILABLE';
end;
$$;

revoke all on function public.apply_approved_publish_retry(uuid) from public, anon, service_role;
grant execute on function public.apply_approved_publish_retry(uuid) to authenticated;
