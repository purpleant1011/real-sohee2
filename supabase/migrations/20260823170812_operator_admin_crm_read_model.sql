alter table public.workspaces
  add column if not exists workspace_kind text not null default 'production';

alter table public.workspaces
  drop constraint if exists workspaces_workspace_kind_check;
alter table public.workspaces
  add constraint workspaces_workspace_kind_check
  check (workspace_kind in ('pilot', 'production', 'demo', 'integration'));

create index if not exists workspaces_workspace_kind_created_idx
  on public.workspaces (workspace_kind, created_at desc, id desc);

update public.workspaces workspace
set workspace_kind = 'integration'
where workspace.workspace_kind = 'production'
  and (
    workspace.name like 'Codex integration %'
    or exists (
      select 1 from public.business_profiles profile
      where profile.workspace_id = workspace.id
        and profile.business_name like 'V0.7.1 business %'
    )
  );

create or replace function private.operator_workspace_admin_projection(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workspace_id', workspace.id,
    'workspace_name', workspace.name,
    'workspace_kind', workspace.workspace_kind,
    'timezone', workspace.timezone,
    'created_at', workspace.created_at,
    'updated_at', workspace.updated_at,
    'business_name', profile.business_name,
    'lifecycle_status', lifecycle.status,
    'agreement_status', case
      when agreements.service_count > 0 and agreements.privacy_count > 0 then 'accepted'
      when agreements.total_count > 0 then 'partial'
      when agreements.has_rows then 'missing'
      else 'unknown'
    end,
    'plan_code', entitlement.plan_code,
    'member_count', members.member_count,
    'available_credits', credits.available_credits,
    'instagram_status', coalesce(instagram.status, 'unknown'),
    'threads_status', coalesce(threads.status, 'unknown'),
    'published_this_month', publishing.published_count,
    'failed_this_month', publishing.failed_count,
    'last_activity_at', greatest(
      workspace.updated_at,
      profile.updated_at,
      lifecycle.updated_at,
      channels.updated_at,
      publishing.updated_at,
      credits.updated_at,
      agreements.updated_at
    ),
    'data_freshness', 'unknown',
    'source_timestamps', jsonb_build_object(
      'workspace', workspace.updated_at,
      'business', profile.updated_at,
      'instagram', instagram.updated_at,
      'threads', threads.updated_at,
      'publish', publishing.updated_at
    )
  )
  from public.workspaces workspace
  left join public.business_profiles profile on profile.workspace_id = workspace.id
  left join public.workspace_lifecycles lifecycle on lifecycle.workspace_id = workspace.id
  left join lateral (
    select count(*)::integer as member_count
    from public.workspace_members member
    where member.workspace_id = workspace.id and member.status = 'active'
  ) members on true
  left join lateral (
    select connection.status, connection.updated_at
    from public.channel_connections connection
    where connection.workspace_id = workspace.id and connection.channel = 'instagram'
    order by connection.updated_at desc limit 1
  ) instagram on true
  left join lateral (
    select connection.status, connection.updated_at
    from public.channel_connections connection
    where connection.workspace_id = workspace.id and connection.channel = 'threads'
    order by connection.updated_at desc limit 1
  ) threads on true
  left join lateral (
    select max(connection.updated_at) as updated_at
    from public.channel_connections connection
    where connection.workspace_id = workspace.id
  ) channels on true
  left join lateral (
    select
      count(*) filter (where attempt.status = 'succeeded')::integer as published_count,
      count(*) filter (where attempt.status = 'failed')::integer as failed_count,
      max(coalesce(attempt.finished_at, attempt.started_at)) as updated_at
    from public.publish_attempts attempt
    where attempt.workspace_id = workspace.id
      and attempt.started_at >= date_trunc('month', statement_timestamp())
  ) publishing on true
  left join lateral (
    select active.plan_code
    from public.workspace_billing_entitlements active
    where active.workspace_id = workspace.id and active.state = 'active'
      and active.effective_from <= statement_timestamp()
      and (active.effective_until is null or active.effective_until > statement_timestamp())
    order by active.effective_from desc limit 1
  ) entitlement on true
  left join lateral (
    select
      sum(entry.amount)::integer as available_credits,
      max(entry.occurred_at) as updated_at
    from public.credit_ledger_entries entry
    where entry.workspace_id = workspace.id
  ) credits on true
  left join lateral (
    select
      count(*) > 0 as has_rows,
      count(*)::integer as total_count,
      count(*) filter (where agreement.agreement_type = 'service_agreement' and agreement.status = 'accepted' and (agreement.expires_at is null or agreement.expires_at > statement_timestamp()))::integer as service_count,
      count(*) filter (where agreement.agreement_type = 'privacy_consent' and agreement.status = 'accepted' and (agreement.expires_at is null or agreement.expires_at > statement_timestamp()))::integer as privacy_count,
      max(agreement.created_at) as updated_at
    from public.workspace_agreements agreement
    where agreement.workspace_id = workspace.id
  ) agreements on true
  where workspace.id = p_workspace_id;
$$;

revoke all on function private.operator_workspace_admin_projection(uuid) from public, anon, authenticated, service_role;

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
  if actor_id is null or claims is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'AUTH_REQUIRED'; end if;
  if private.operator_mfa_required(actor_id) and claims ->> 'aal' is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if not exists (
    select 1 from public.platform_admin_role_assignments assignment
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id and permission.permission_key = 'workspace.read'
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'WORKSPACE_INPUT_INVALID'; end if;
  if p_status is not null and p_status not in ('applied','information_pending','contract_review','consent_pending','channel_pending','payment_pending','ready_for_activation','active','paused','terminated') then raise exception 'WORKSPACE_INPUT_INVALID'; end if;
  if normalized_query is not null and char_length(normalized_query) > 120 then raise exception 'WORKSPACE_INPUT_INVALID'; end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) or (p_cursor_created_at is null) <> (p_cursor_fingerprint is null) then raise exception 'CURSOR_INVALID'; end if;

  scope_is_all := exists (
    select 1 from public.platform_admin_role_assignments assignment
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id and permission.permission_key = 'workspace.read' and assignment.workspace_id is null
  );
  select coalesce(array_agg(distinct assignment.workspace_id order by assignment.workspace_id), '{}'::uuid[])
    into scope_ids
  from public.platform_admin_role_assignments assignment
  join public.platform_role_permissions permission on permission.role_key = assignment.role_key
  where assignment.user_id = actor_id and permission.permission_key = 'workspace.read' and assignment.workspace_id is not null;

  scope_fingerprint := encode(extensions.digest((jsonb_build_object(
    'query', normalized_query,
    'status', p_status,
    'scope', case when scope_is_all then '"all"'::jsonb else to_jsonb(scope_ids) end
  ))::text, 'sha256'), 'hex');
  if p_cursor_fingerprint is not null and p_cursor_fingerprint <> scope_fingerprint then raise exception 'CURSOR_INVALID'; end if;

  with selected as (
    select workspace.id, workspace.created_at
    from public.workspaces workspace
    left join public.workspace_lifecycles lifecycle on lifecycle.workspace_id = workspace.id
    left join public.business_profiles profile on profile.workspace_id = workspace.id
    where workspace.workspace_kind <> 'integration'
      and (scope_is_all or workspace.id = any(scope_ids))
      and (normalized_query is null or position(lower(normalized_query) in lower(workspace.name)) > 0 or position(lower(normalized_query) in lower(coalesce(profile.business_name, ''))) > 0)
      and (p_status is null or lifecycle.status = p_status)
      and (p_cursor_created_at is null or workspace.created_at < p_cursor_created_at or (workspace.created_at = p_cursor_created_at and workspace.id < p_cursor_id))
    order by workspace.created_at desc, workspace.id desc
    limit p_limit + 1
  ), page as (
    select * from selected order by created_at desc, id desc limit p_limit
  )
  select
    coalesce(jsonb_agg(private.operator_workspace_admin_projection(page.id) order by page.created_at desc, page.id desc), '[]'::jsonb),
    (select count(*)::integer from selected),
    (select page.created_at from page order by page.created_at desc, page.id desc offset p_limit - 1 limit 1),
    (select page.id from page order by page.created_at desc, page.id desc offset p_limit - 1 limit 1)
  into row_data, selected_count, last_created_at, last_id
  from page;

  next_cursor := case when selected_count > p_limit then jsonb_build_object('created_at', last_created_at, 'id', last_id, 'cursor_fingerprint', scope_fingerprint) else null end;
  return jsonb_build_object('items', row_data, 'next_cursor', next_cursor);
exception when others then
  if sqlerrm in ('AUTH_REQUIRED','MFA_REQUIRED','OPERATOR_DISABLED','PERMISSION_DENIED','OPERATOR_SCOPE_DENIED','WORKSPACE_INPUT_INVALID','CURSOR_INVALID') then raise; end if;
  raise exception 'WORKSPACE_LIST_UNAVAILABLE';
end;
$$;

create or replace function public.get_operator_workspace_detail(p_workspace_id uuid)
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
  if actor_id is null or claims is null or claims ->> 'sub' is distinct from actor_id::text then raise exception 'AUTH_REQUIRED'; end if;
  if private.operator_mfa_required(actor_id) and claims ->> 'aal' is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if p_workspace_id is null or not private.has_platform_permission('workspace.read', p_workspace_id) then raise exception 'OPERATOR_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.workspaces workspace where workspace.id = p_workspace_id) then raise exception 'WORKSPACE_DETAIL_UNAVAILABLE'; end if;

  select private.operator_workspace_admin_projection(p_workspace_id) || jsonb_build_object(
    'member_aggregates', coalesce((
      select jsonb_agg(jsonb_build_object('role', members.role, 'status', members.status, 'count', members.count, 'created_at', members.created_at, 'updated_at', members.updated_at) order by members.role, members.status)
      from (
        select member.role, member.status, count(*)::integer as count, min(member.created_at) as created_at, max(member.updated_at) as updated_at
        from public.workspace_members member where member.workspace_id = p_workspace_id group by member.role, member.status
      ) members
    ), '[]'::jsonb),
    'channels', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workspace_id', connection.workspace_id, 'channel', connection.channel, 'status', connection.status,
        'webhook_status', connection.webhook_status, 'token_expires_at', connection.token_expires_at,
        'last_webhook_at', connection.last_webhook_at, 'last_provider_event_at', connection.last_provider_event_at,
        'last_error_code', connection.last_error_code, 'updated_at', connection.updated_at
      ) order by connection.channel)
      from public.channel_connections connection where connection.workspace_id = p_workspace_id
    ), '[]'::jsonb)
  ) into result;
  return result;
exception when others then
  if sqlerrm in ('AUTH_REQUIRED','MFA_REQUIRED','OPERATOR_DISABLED','PERMISSION_DENIED','OPERATOR_SCOPE_DENIED','WORKSPACE_DETAIL_UNAVAILABLE') then raise; end if;
  raise exception 'WORKSPACE_DETAIL_UNAVAILABLE';
end;
$$;

revoke all on function public.list_operator_workspaces(timestamptz, uuid, text, text, text, integer) from public, anon, service_role;
grant execute on function public.list_operator_workspaces(timestamptz, uuid, text, text, text, integer) to authenticated;
revoke all on function public.get_operator_workspace_detail(uuid) from public, anon, service_role;
grant execute on function public.get_operator_workspace_detail(uuid) to authenticated;
