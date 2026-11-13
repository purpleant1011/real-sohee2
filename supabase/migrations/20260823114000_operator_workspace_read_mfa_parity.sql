create or replace function public.list_operator_workspaces(
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_fingerprint text default null,
  p_query text default null,
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
  normalized_query text := nullif(btrim(p_query), '');
  scope_fingerprint text;
  scope_is_all boolean;
  scope_ids uuid[];
  row_data jsonb;
  next_cursor jsonb;
  selected_count integer;
  last_created_at timestamptz;
  last_id uuid;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if claims is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'AUTH_REQUIRED'; end if;
  if claims ->> 'aal' is distinct from 'aal2'
    and coalesce((select member.mfa_required from public.platform_admin_members member where member.user_id = actor_id), true)
  then raise exception 'MFA_REQUIRED'; end if;
  if not exists (
    select 1 from public.platform_admin_members member
    where member.user_id = actor_id and member.status = 'active'
  ) then raise exception 'OPERATOR_DISABLED'; end if;
  if not exists (
    select 1
    from public.platform_admin_role_assignments assignment
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id and permission.permission_key = 'workspace.read'
  ) then raise exception 'PERMISSION_DENIED'; end if;

  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'WORKSPACE_INPUT_INVALID'; end if;
  if p_status is not null then raise exception 'WORKSPACE_INPUT_INVALID'; end if;
  if normalized_query is not null and (char_length(normalized_query) < 1 or char_length(normalized_query) > 120) then
    raise exception 'WORKSPACE_INPUT_INVALID';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null)
    or (p_cursor_created_at is null) <> (p_cursor_fingerprint is null)
  then raise exception 'CURSOR_INVALID'; end if;

  scope_is_all := exists (
    select 1
    from public.platform_admin_role_assignments assignment
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id
      and permission.permission_key = 'workspace.read'
      and assignment.workspace_id is null
  );
  select coalesce(array_agg(distinct assignment.workspace_id order by assignment.workspace_id), '{}'::uuid[])
    into scope_ids
  from public.platform_admin_role_assignments assignment
  join public.platform_role_permissions permission on permission.role_key = assignment.role_key
  where assignment.user_id = actor_id
    and permission.permission_key = 'workspace.read'
    and assignment.workspace_id is not null;
  scope_fingerprint := encode(
    extensions.digest(
      (jsonb_build_object(
        'query', normalized_query,
        'status', p_status,
        'scope', case when scope_is_all then '"all"'::jsonb else to_jsonb(scope_ids) end
      ))::text,
      'sha256'
    ), 'hex'
  );
  if p_cursor_fingerprint is not null and p_cursor_fingerprint <> scope_fingerprint then raise exception 'CURSOR_INVALID'; end if;

  with selected as (
    select workspace.id, workspace.name, workspace.timezone, workspace.created_at, workspace.updated_at,
      profile.business_name, profile.updated_at as business_updated_at
    from public.workspaces workspace
    left join public.business_profiles profile on profile.workspace_id = workspace.id
    where (scope_is_all or workspace.id = any(scope_ids))
      and (normalized_query is null or position(lower(normalized_query) in lower(workspace.name)) > 0)
      and (p_cursor_created_at is null or workspace.created_at < p_cursor_created_at
        or (workspace.created_at = p_cursor_created_at and workspace.id < p_cursor_id))
    order by workspace.created_at desc, workspace.id desc
    limit p_limit + 1
  ),
  page as (
    select * from selected order by created_at desc, id desc limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'workspace_id', page.id,
      'workspace_name', page.name,
      'timezone', page.timezone,
      'created_at', page.created_at,
      'updated_at', page.updated_at,
      'business_name', page.business_name,
      'lifecycle_status', null,
      'agreement_status', 'unknown',
      'instagram_status', coalesce((select connection.status from public.channel_connections connection where connection.workspace_id = page.id and connection.channel = 'instagram' order by connection.updated_at desc limit 1), 'unknown'),
      'threads_status', coalesce((select connection.status from public.channel_connections connection where connection.workspace_id = page.id and connection.channel = 'threads' order by connection.updated_at desc limit 1), 'unknown'),
      'published_this_month', null,
      'failed_this_month', null,
      'last_activity_at', null,
      'data_freshness', 'unknown',
      'source_timestamps', jsonb_build_object(
        'workspace', page.updated_at,
        'business', page.business_updated_at,
        'instagram', (select connection.updated_at from public.channel_connections connection where connection.workspace_id = page.id and connection.channel = 'instagram' order by connection.updated_at desc limit 1),
        'threads', (select connection.updated_at from public.channel_connections connection where connection.workspace_id = page.id and connection.channel = 'threads' order by connection.updated_at desc limit 1),
        'publish', null
      )
    ) order by page.created_at desc, page.id desc), '[]'::jsonb),
    (select count(*)::integer from selected),
    (select page.created_at from page order by page.created_at desc, page.id desc offset p_limit - 1 limit 1),
    (select page.id from page order by page.created_at desc, page.id desc offset p_limit - 1 limit 1)
    into row_data, selected_count, last_created_at, last_id
  from page;

  next_cursor := case when selected_count > p_limit
    then jsonb_build_object('created_at', last_created_at, 'id', last_id, 'cursor_fingerprint', scope_fingerprint)
    else null end;

  return jsonb_build_object('items', row_data, 'next_cursor', next_cursor);
exception when others then
  if SQLERRM in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'OPERATOR_SCOPE_DENIED', 'WORKSPACE_INPUT_INVALID', 'CURSOR_INVALID', 'WORKSPACE_LIST_UNAVAILABLE', 'WORKSPACE_DETAIL_UNAVAILABLE') then
    raise;
  end if;
  raise exception 'WORKSPACE_LIST_UNAVAILABLE';
end;
$$;

create or replace function public.get_operator_workspace_detail(
  p_workspace_id uuid
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
  result jsonb;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if claims is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'AUTH_REQUIRED'; end if;
  if claims ->> 'aal' is distinct from 'aal2'
    and coalesce((select member.mfa_required from public.platform_admin_members member where member.user_id = actor_id), true)
  then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if p_workspace_id is null or not private.has_platform_permission('workspace.read', p_workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.workspaces workspace where workspace.id = p_workspace_id) then raise exception 'WORKSPACE_DETAIL_UNAVAILABLE'; end if;

  select jsonb_build_object(
    'workspace_id', workspace.id,
    'workspace_name', workspace.name,
    'timezone', workspace.timezone,
    'created_at', workspace.created_at,
    'updated_at', workspace.updated_at,
    'business_name', profile.business_name,
    'lifecycle_status', null,
    'agreement_status', 'unknown',
    'instagram_status', coalesce((select connection.status from public.channel_connections connection where connection.workspace_id = workspace.id and connection.channel = 'instagram' order by connection.updated_at desc limit 1), 'unknown'),
    'threads_status', coalesce((select connection.status from public.channel_connections connection where connection.workspace_id = workspace.id and connection.channel = 'threads' order by connection.updated_at desc limit 1), 'unknown'),
    'published_this_month', null,
    'failed_this_month', null,
    'last_activity_at', null,
    'data_freshness', 'unknown',
    'source_timestamps', jsonb_build_object(
      'workspace', workspace.updated_at,
      'business', profile.updated_at,
      'instagram', (select connection.updated_at from public.channel_connections connection where connection.workspace_id = workspace.id and connection.channel = 'instagram' order by connection.updated_at desc limit 1),
      'threads', (select connection.updated_at from public.channel_connections connection where connection.workspace_id = workspace.id and connection.channel = 'threads' order by connection.updated_at desc limit 1),
      'publish', null
    ),
    'member_aggregates', coalesce((select jsonb_agg(jsonb_build_object('role', members.role, 'status', members.status, 'count', members.count, 'created_at', members.created_at, 'updated_at', members.updated_at) order by members.role, members.status) from (select member.role, member.status, count(*)::integer as count, min(member.created_at) as created_at, max(member.updated_at) as updated_at from public.workspace_members member where member.workspace_id = workspace.id group by member.role, member.status) members), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('workspace_id', connection.workspace_id, 'channel', connection.channel, 'status', connection.status, 'webhook_status', connection.webhook_status, 'token_expires_at', connection.token_expires_at, 'last_webhook_at', connection.last_webhook_at, 'last_provider_event_at', connection.last_provider_event_at, 'last_error_code', connection.last_error_code, 'updated_at', connection.updated_at) order by connection.channel) from public.channel_connections connection where connection.workspace_id = workspace.id), '[]'::jsonb)
  ) into result
  from public.workspaces workspace
  left join public.business_profiles profile on profile.workspace_id = workspace.id
  where workspace.id = p_workspace_id;
  return result;
exception when others then
  if SQLERRM in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'OPERATOR_DISABLED', 'PERMISSION_DENIED', 'OPERATOR_SCOPE_DENIED', 'WORKSPACE_INPUT_INVALID', 'CURSOR_INVALID', 'WORKSPACE_LIST_UNAVAILABLE', 'WORKSPACE_DETAIL_UNAVAILABLE') then
    raise;
  end if;
  raise exception 'WORKSPACE_DETAIL_UNAVAILABLE';
end;
$$;

revoke all on function public.list_operator_workspaces(timestamptz, uuid, text, text, text, integer) from public, anon, service_role;
grant execute on function public.list_operator_workspaces(timestamptz, uuid, text, text, text, integer) to authenticated;
revoke all on function public.get_operator_workspace_detail(uuid) from public, anon, service_role;
grant execute on function public.get_operator_workspace_detail(uuid) to authenticated;
