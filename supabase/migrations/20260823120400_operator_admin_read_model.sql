create or replace function public.list_operator_admins(
  p_status text default null,
  p_role_key text default null,
  p_mfa_state text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_mfa_required boolean;
  page jsonb;
  page_count integer;
  last_created_at timestamptz;
  last_user_id uuid;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select member.mfa_required
  into actor_mfa_required
  from public.platform_admin_members as member
  where member.user_id = actor_id
    and member.status = 'active';

  if not found then
    raise exception 'OPERATOR_DISABLED';
  end if;

  if coalesce(actor_mfa_required, true)
    and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception 'MFA_REQUIRED';
  end if;

  if not private.has_platform_permission('admin.read', null) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if p_status is not null and p_status not in ('invited', 'active', 'disabled') then
    raise exception 'ADMIN_INPUT_INVALID';
  end if;
  if p_mfa_state is not null and p_mfa_state not in ('required', 'enrolled', 'missing', 'unknown') then
    raise exception 'ADMIN_INPUT_INVALID';
  end if;
  if p_limit is null then
    p_limit := 50;
  elsif p_limit < 1 or p_limit > 100 then
    raise exception 'ADMIN_INPUT_INVALID';
  end if;
  if (p_cursor_created_at is null) is distinct from (p_cursor_id is null) then
    raise exception 'ADMIN_CURSOR_INVALID';
  end if;

  with role_data as (
    select
      assignment.user_id,
      pg_catalog.jsonb_agg(distinct role.role_key order by role.role_key) as role_keys,
      pg_catalog.jsonb_agg(distinct role.display_name order by role.display_name) as role_display_names
    from public.platform_admin_role_assignments as assignment
    join public.platform_roles as role on role.role_key = assignment.role_key
    group by assignment.user_id
  ), scope_data as (
    select
      assignment.user_id,
      case when bool_or(assignment.workspace_id is null) then 'global' else 'workspace' end as scope_kind,
      count(distinct assignment.workspace_id)::integer as workspace_count
    from public.platform_admin_role_assignments as assignment
    group by assignment.user_id
  ), candidate_rows as (
    select
      member.user_id,
      case
        when auth_user.email_confirmed_at is not null and auth_user.email is not null then
          case
            when position('@' in auth_user.email) > 1 then
              pg_catalog.left(pg_catalog.split_part(auth_user.email, '@', 1), 1)
                || '***@' || pg_catalog.split_part(auth_user.email, '@', 2)
            else '***'
          end
        else null
      end as email,
      member.status,
      coalesce(role_data.role_keys, '[]'::jsonb) as role_keys,
      coalesce(role_data.role_display_names, '[]'::jsonb) as role_display_names,
      pg_catalog.jsonb_build_object(
        'kind', coalesce(scope_data.scope_kind, 'unknown'),
        'workspace_count', coalesce(scope_data.workspace_count, 0)
      ) as scope_summary,
      member.mfa_required,
      exists (
        select 1
        from auth.mfa_factors as factor
        where factor.user_id = member.user_id
          and factor.status = 'verified'
          and factor.factor_type = 'totp'
      ) as mfa_enrolled,
      member.password_set_at,
      member.activated_at,
      member.last_reviewed_at,
      member.created_at,
      member.updated_at,
      case
        when member.updated_at >= statement_timestamp() - interval '1 day' then 'fresh'
        else 'stale'
      end as data_freshness
    from public.platform_admin_members as member
    join auth.users as auth_user on auth_user.id = member.user_id
    left join role_data on role_data.user_id = member.user_id
    left join scope_data on scope_data.user_id = member.user_id
    where (p_status is null or member.status = p_status)
      and (p_role_key is null or exists (
        select 1
        from public.platform_admin_role_assignments as role_filter
        where role_filter.user_id = member.user_id
          and role_filter.role_key = p_role_key
      ))
      and (
        p_mfa_state is null
        or (p_mfa_state = 'required' and member.mfa_required)
        or (p_mfa_state = 'enrolled' and exists (
          select 1 from auth.mfa_factors as factor
          where factor.user_id = member.user_id
            and factor.status = 'verified'
            and factor.factor_type = 'totp'
        ))
        or (p_mfa_state = 'missing' and member.mfa_required and not exists (
          select 1 from auth.mfa_factors as factor
          where factor.user_id = member.user_id
            and factor.status = 'verified'
            and factor.factor_type = 'totp'
        ))
        or (p_mfa_state = 'unknown' and false)
      )
      and (
        p_cursor_created_at is null
        or (member.created_at, member.user_id) < (p_cursor_created_at, p_cursor_id)
      )
    order by member.created_at desc, member.user_id desc
    limit p_limit
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'user_id', row.user_id,
        'email', row.email,
        'status', row.status,
        'role_keys', row.role_keys,
        'role_display_names', row.role_display_names,
        'scope_summary', row.scope_summary,
        'mfa_required', row.mfa_required,
        'mfa_enrolled', row.mfa_enrolled,
        'password_set_at', row.password_set_at,
        'activated_at', row.activated_at,
        'last_reviewed_at', row.last_reviewed_at,
        'created_at', row.created_at,
        'updated_at', row.updated_at,
        'data_freshness', row.data_freshness,
        'session_state', 'unknown',
        'last_login_at', null
      )
      order by row.created_at desc, row.user_id desc
    ), '[]'::jsonb
  ),
  count(*)::integer,
  case when count(*) > 0 then (pg_catalog.array_agg(row.created_at order by row.created_at desc, row.user_id desc))[count(*)::integer] end,
  case when count(*) > 0 then (pg_catalog.array_agg(row.user_id order by row.created_at desc, row.user_id desc))[count(*)::integer] end
  into page, page_count, last_created_at, last_user_id
  from candidate_rows as row;

  return pg_catalog.jsonb_build_object(
    'items', page,
    'next_cursor', case
      when page_count < p_limit or last_user_id is null then null
      else pg_catalog.jsonb_build_object('created_at', last_created_at, 'id', last_user_id)
    end
  );
end;
$$;

revoke all on function public.list_operator_admins(text, text, text, timestamptz, uuid, integer)
  from public, anon, service_role;
grant execute on function public.list_operator_admins(text, text, text, timestamptz, uuid, integer)
  to authenticated;
