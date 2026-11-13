create or replace function public.list_operator_publish_operations(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_fingerprint text default null,
  p_workspace_id uuid default null,
  p_status text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  claims jsonb := (select auth.jwt());
  scope_is_all boolean;
  scope_ids uuid[];
  scope_fingerprint text;
  result_rows jsonb;
  selected_count integer;
  last_created_at timestamptz;
  last_id uuid;
begin
  if actor_id is null or claims is null or claims ->> 'sub' is distinct from actor_id::text then
    raise exception 'AUTH_REQUIRED';
  end if;
  if claims ->> 'aal' is distinct from 'aal2'
    and coalesce((select member.mfa_required from public.platform_admin_members member where member.user_id = actor_id), true)
  then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then
    raise exception 'OPERATOR_DISABLED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'PUBLISH_INPUT_INVALID'; end if;
  if p_status is not null and p_status not in ('pending', 'publishing', 'success', 'failure', 'unknown') then
    raise exception 'PUBLISH_INPUT_INVALID';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null)
    or (p_cursor_created_at is null) <> (p_cursor_fingerprint is null) then
    raise exception 'PUBLISH_CURSOR_INVALID';
  end if;

  scope_is_all := exists (
    select 1 from public.platform_admin_role_assignments assignment
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id and permission.permission_key = 'publish.read' and assignment.workspace_id is null
  );
  select coalesce(array_agg(distinct assignment.workspace_id order by assignment.workspace_id), '{}'::uuid[])
    into scope_ids
  from public.platform_admin_role_assignments assignment
  join public.platform_role_permissions permission on permission.role_key = assignment.role_key
  where assignment.user_id = actor_id and permission.permission_key = 'publish.read' and assignment.workspace_id is not null;
  if not scope_is_all and cardinality(scope_ids) = 0 then raise exception 'PERMISSION_DENIED'; end if;
  if p_workspace_id is not null and not (select private.has_platform_permission('publish.read', p_workspace_id)) then
    raise exception 'OPERATOR_SCOPE_DENIED';
  end if;

  scope_fingerprint := encode(extensions.digest((jsonb_build_object(
    'workspace_id', p_workspace_id,
    'status', p_status,
    'scope', case when scope_is_all then 'all' else to_jsonb(scope_ids)::text end
  ))::text, 'sha256'), 'hex');
  if p_cursor_fingerprint is not null and p_cursor_fingerprint <> scope_fingerprint then
    raise exception 'PUBLISH_CURSOR_INVALID';
  end if;

  with source_rows as (
    select
      workspace.id as workspace_id,
      workspace.name as workspace_name,
      content.id as content_id,
      content.title as content_title,
      content.channel,
      current_version.id as current_version_id,
      current_version.version_number as current_version_number,
      current_version.fingerprint as current_fingerprint,
      approval.id as approval_id,
      approval.version_id as approved_version_id,
      approved_version.version_number as approved_version_number,
      approval.fingerprint as approval_fingerprint,
      approval.status as approval_status,
      approval.disclosure_confirmed,
      approval.rights_confirmed,
      approval.decided_at as approval_decided_at,
      schedule.id as schedule_id,
      schedule.publish_at,
      schedule.timezone,
      schedule.status as schedule_status,
      schedule.updated_at as schedule_updated_at,
      coalesce(schedule.updated_at, approval.decided_at, content.updated_at) as cursor_created_at,
      attempt.attempt_number,
      attempt.status as attempt_status,
      attempt.provider_reference is not null as provider_reference_present,
      attempt.provider_request_id is not null as provider_request_id_present,
      case when attempt.error_code in ('TEMPORARY_NETWORK','RATE_LIMITED','TOKEN_EXPIRED','APPROVAL_STALE','PROVIDER_REJECTED','RESULT_UNKNOWN','LEASE_EXPIRED') then attempt.error_code else null end as failure_code,
      attempt.recovery_status,
      case when attempt.id is null then 'not_recorded' else 'recorded' end as idempotency_result,
      tracking.destination_url is not null as destination_url_present,
      attempt.finished_at as published_at,
      case
        when schedule.updated_at is null then 'unknown'
        when statement_timestamp() - greatest(schedule.updated_at, coalesce(attempt.finished_at, schedule.updated_at)) <= interval '24 hours' then 'fresh'
        else 'stale'
      end as freshness,
      case
        when schedule.status = 'published'
          and attempt.status = 'succeeded'
          and attempt.provider_reference is not null
          and tracking.destination_url is not null
          and approval.version_id = current_version.id
          and approval.fingerprint = current_version.fingerprint
          and approval.status = 'approved'
          and approval.disclosure_confirmed
          and approval.rights_confirmed then 'success'
        when schedule.status = 'publishing' or attempt.status = 'pending' then 'publishing'
        when schedule.status = 'scheduled' and attempt.id is null then 'pending'
        when schedule.status = 'failed' and attempt.status = 'failed' then 'failure'
        else 'unknown'
      end as display_state
    from public.content_items content
    join public.workspaces workspace on workspace.id = content.workspace_id
    left join public.content_versions current_version
      on current_version.workspace_id = content.workspace_id and current_version.id = content.current_version_id
    left join lateral (
      select candidate.* from public.approvals candidate
      where candidate.workspace_id = content.workspace_id and candidate.content_id = content.id
      order by candidate.decided_at desc, candidate.id desc limit 1
    ) approval on true
    left join public.content_versions approved_version
      on approved_version.workspace_id = approval.workspace_id and approved_version.id = approval.version_id
    left join public.schedules schedule
      on schedule.workspace_id = content.workspace_id and schedule.content_id = content.id
      and schedule.version_id = approval.version_id
      and schedule.status <> 'cancelled'
    left join lateral (
      select candidate.* from public.publish_attempts candidate
      where candidate.workspace_id = schedule.workspace_id and candidate.schedule_id = schedule.id
      order by candidate.attempt_number desc, candidate.started_at desc, candidate.id desc limit 1
    ) attempt on true
    left join public.social_post_tracking tracking
      on tracking.workspace_id = attempt.workspace_id and tracking.publish_attempt_id = attempt.id
    where (scope_is_all or content.workspace_id = any(scope_ids))
      and (p_workspace_id is null or content.workspace_id = p_workspace_id)
      and (p_cursor_created_at is null or coalesce(schedule.updated_at, approval.decided_at, content.updated_at) < p_cursor_created_at
        or (coalesce(schedule.updated_at, approval.decided_at, content.updated_at) = p_cursor_created_at and content.id < p_cursor_id))
  ), filtered as (
    select * from source_rows where p_status is null or display_state = p_status
  ), page as (
    select * from filtered
    order by cursor_created_at desc, content_id desc
    limit p_limit + 1
  ), trimmed as (
    select * from page limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'workspace_id', row.workspace_id,
    'workspace_name', row.workspace_name,
    'content_id', row.content_id,
    'content_title', row.content_title,
    'channel', row.channel,
    'current_version_id', row.current_version_id,
    'current_version_number', row.current_version_number,
    'current_fingerprint', row.current_fingerprint,
    'approval_id', row.approval_id,
    'approved_version_id', row.approved_version_id,
    'approved_version_number', row.approved_version_number,
    'approval_fingerprint', row.approval_fingerprint,
    'approval_status', row.approval_status,
    'approval_decided_at', row.approval_decided_at,
    'fingerprint_match', coalesce(row.approved_version_id = row.current_version_id and row.approval_fingerprint = row.current_fingerprint and row.approval_status = 'approved' and row.disclosure_confirmed and row.rights_confirmed, false),
    'schedule_id', row.schedule_id,
    'publish_at', row.publish_at,
    'timezone', row.timezone,
    'schedule_status', row.schedule_status,
    'display_state', row.display_state,
    'attempt_number', row.attempt_number,
    'attempt_status', row.attempt_status,
    'provider_reference_present', row.provider_reference_present,
    'provider_request_id_present', row.provider_request_id_present,
    'failure_code', row.failure_code,
    'recovery_status', row.recovery_status,
    'idempotency_result', row.idempotency_result,
    'destination_url_present', row.destination_url_present,
    'published_at', row.published_at,
    'freshness', row.freshness
  ) order by row.cursor_created_at desc, row.content_id desc), '[]'::jsonb),
  (select count(*)::integer from filtered),
  (select cursor_created_at from trimmed order by cursor_created_at desc, content_id desc offset p_limit - 1 limit 1),
  (select content_id from trimmed order by cursor_created_at desc, content_id desc offset p_limit - 1 limit 1)
  into result_rows, selected_count, last_created_at, last_id
  from trimmed row;

  return jsonb_build_object(
    'items', result_rows,
    'next_cursor', case when selected_count > p_limit then jsonb_build_object('created_at', last_created_at, 'id', last_id, 'cursor_fingerprint', scope_fingerprint) else null end
  );
exception when others then
  if SQLERRM in ('AUTH_REQUIRED','MFA_REQUIRED','OPERATOR_DISABLED','PERMISSION_DENIED','OPERATOR_SCOPE_DENIED','PUBLISH_INPUT_INVALID','PUBLISH_CURSOR_INVALID') then raise; end if;
  raise exception 'PUBLISH_READ_UNAVAILABLE';
end;
$$;

revoke all on function public.list_operator_publish_operations(timestamptz, uuid, text, uuid, text, integer) from public, anon, service_role;
grant execute on function public.list_operator_publish_operations(timestamptz, uuid, text, uuid, text, integer) to authenticated;
notify pgrst, 'reload schema';
