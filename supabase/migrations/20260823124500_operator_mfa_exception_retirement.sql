alter table public.platform_admin_members
  add column if not exists mfa_exception_until timestamptz,
  add column if not exists mfa_exception_retired_at timestamptz;

-- A legacy false-policy row gets a short, explicit grace window. Retirement remains a separate
-- operator action after the individual has a verified TOTP factor; no account is retired here.
update public.platform_admin_members
set mfa_exception_until = statement_timestamp() + interval '7 days'
where mfa_required = false and mfa_exception_until is null;

alter table public.platform_audit_events drop constraint if exists platform_audit_events_action_check;
alter table public.platform_audit_events add constraint platform_audit_events_action_check check (action in (
  'agreement.verify.requested', 'agreement.verify.approved', 'channel.disconnect.requested',
  'channel.disconnect.approved', 'publish.retry.requested', 'publish.retry.approved',
  'credit.adjust.requested', 'credit.adjust.approved', 'admin.role.change.workspace.requested',
  'admin.role.change.workspace.approved', 'admin.role.change.global.requested',
  'admin.role.change.global.approved', 'audit.export.workspace.requested',
  'audit.export.workspace.approved', 'audit.export.workspace.applied', 'audit.export.global.requested',
  'audit.export.global.approved', 'audit.export.global.applied', 'admin.account.activated', 'workspace.activation.requested',
  'document.version.draft_created', 'document.version.reviewed', 'document.version.activated',
  'credit.adjust.applied', 'publish.retry.applied',
  'support.session.started', 'support.session.ended', 'support.session.expired', 'support.session.revoked',
  'admin.mfa.exception.retired'
));

create or replace function private.operator_mfa_required(p_user_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select coalesce(member.mfa_required, true)
    or member.mfa_exception_until is null
    or member.mfa_exception_until <= statement_timestamp()
  from public.platform_admin_members member
  where member.user_id = p_user_id;
$$;

create or replace function private.has_platform_permission(p_permission_key text, p_workspace_id uuid default null)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admin_members member
    join public.platform_admin_role_assignments assignment on assignment.user_id = member.user_id
    join public.platform_role_permissions permission on permission.role_key = assignment.role_key
    where member.user_id = (select auth.uid())
      and member.status = 'active'
      and permission.permission_key = p_permission_key
      and (not private.operator_mfa_required(member.user_id) or (select auth.jwt() ->> 'aal') = 'aal2')
      and ((p_workspace_id is null and assignment.workspace_id is null) or (p_workspace_id is not null and (assignment.workspace_id is null or assignment.workspace_id = p_workspace_id)))
  );
$$;

create or replace function public.get_current_operator_context()
returns jsonb language sql security definer stable set search_path = ''
as $$
  select case when context is null then null else
    pg_catalog.jsonb_set(context, '{mfa_required}',
      pg_catalog.to_jsonb(private.operator_mfa_required((select auth.uid()))), true)
    end
  from (select private.get_current_operator_context_internal() as context) current_context;
$$;

create or replace function public.list_operator_admins(
  p_status text default null, p_role_key text default null, p_mfa_state text default null,
  p_cursor_created_at timestamptz default null, p_cursor_id uuid default null, p_limit integer default 50
)
returns jsonb language plpgsql security definer set search_path = '' stable
as $$
declare
  actor_id uuid := (select auth.uid());
  page jsonb;
  last_created_at timestamptz;
  last_user_id uuid;
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.platform_admin_members member where member.user_id = actor_id and member.status = 'active') then raise exception 'OPERATOR_DISABLED'; end if;
  if private.operator_mfa_required(actor_id) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not private.has_platform_permission('admin.read', null) then raise exception 'PERMISSION_DENIED'; end if;
  if p_status is not null and p_status not in ('invited', 'active', 'disabled') then raise exception 'ADMIN_INPUT_INVALID'; end if;
  if p_mfa_state is not null and p_mfa_state not in ('required', 'enrolled', 'missing', 'unknown') then raise exception 'ADMIN_INPUT_INVALID'; end if;
  if p_limit is null then p_limit := 50; elsif p_limit < 1 or p_limit > 100 then raise exception 'ADMIN_INPUT_INVALID'; end if;
  if (p_cursor_created_at is null) is distinct from (p_cursor_id is null) then raise exception 'ADMIN_CURSOR_INVALID'; end if;
  with candidates as (
    select member.*, auth_user.email,
      coalesce((select jsonb_agg(distinct role.role_key order by role.role_key) from public.platform_admin_role_assignments assignment join public.platform_roles role on role.role_key = assignment.role_key where assignment.user_id = member.user_id), '[]'::jsonb) role_keys,
      coalesce((select jsonb_agg(distinct role.display_name order by role.display_name) from public.platform_admin_role_assignments assignment join public.platform_roles role on role.role_key = assignment.role_key where assignment.user_id = member.user_id), '[]'::jsonb) role_display_names,
      exists (select 1 from auth.mfa_factors factor where factor.user_id = member.user_id and factor.status = 'verified' and factor.factor_type = 'totp') mfa_enrolled,
      case when member.mfa_required then 'none' when member.mfa_exception_until is null then 'unknown' when member.mfa_exception_until > statement_timestamp() then 'active' else 'expired' end mfa_exception_state
    from public.platform_admin_members member join auth.users auth_user on auth_user.id = member.user_id
    where (p_status is null or member.status = p_status)
      and (p_role_key is null or exists (select 1 from public.platform_admin_role_assignments assignment where assignment.user_id = member.user_id and assignment.role_key = p_role_key))
      and (p_mfa_state is null or (p_mfa_state = 'required' and member.mfa_required) or (p_mfa_state = 'enrolled' and exists (select 1 from auth.mfa_factors factor where factor.user_id = member.user_id and factor.status = 'verified' and factor.factor_type = 'totp')) or (p_mfa_state = 'missing' and member.mfa_required and not exists (select 1 from auth.mfa_factors factor where factor.user_id = member.user_id and factor.status = 'verified' and factor.factor_type = 'totp')) or (p_mfa_state = 'unknown' and member.mfa_exception_until is null))
      and (p_cursor_created_at is null or (member.created_at, member.user_id) < (p_cursor_created_at, p_cursor_id))
    order by member.created_at desc, member.user_id desc limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', user_id, 'email', case when position('@' in email) > 1 then left(split_part(email, '@', 1), 1) || '***@' || split_part(email, '@', 2) else null end,
    'status', status, 'role_keys', role_keys, 'role_display_names', role_display_names,
    'scope_summary', jsonb_build_object('kind', case when exists (select 1 from public.platform_admin_role_assignments assignment where assignment.user_id = candidates.user_id and assignment.workspace_id is null) then 'global' else case when exists (select 1 from public.platform_admin_role_assignments assignment where assignment.user_id = candidates.user_id and assignment.workspace_id is not null) then 'workspace' else 'unknown' end end, 'workspace_count', (select count(distinct assignment.workspace_id)::integer from public.platform_admin_role_assignments assignment where assignment.user_id = candidates.user_id and assignment.workspace_id is not null)),
    'mfa_required', private.operator_mfa_required(user_id), 'mfa_enrolled', mfa_enrolled,
    'mfa_exception_state', mfa_exception_state, 'mfa_exception_until', mfa_exception_until,
    'password_set_at', password_set_at, 'activated_at', activated_at, 'last_reviewed_at', last_reviewed_at,
    'created_at', created_at, 'updated_at', updated_at, 'data_freshness', case when updated_at >= statement_timestamp() - interval '1 day' then 'fresh' else 'stale' end,
    'session_state', 'unknown', 'last_login_at', null) order by created_at desc, user_id desc), '[]'::jsonb),
    (array_agg(created_at order by created_at desc, user_id desc))[count(*)], (array_agg(user_id order by created_at desc, user_id desc))[count(*)]
  into page, last_created_at, last_user_id from candidates;
  return jsonb_build_object('items', page, 'next_cursor', case when jsonb_array_length(page) < p_limit or last_user_id is null then null else jsonb_build_object('created_at', last_created_at, 'id', last_user_id) end);
end;
$$;

create or replace function public.retire_operator_mfa_exception(p_user_id uuid, p_expected_updated_at timestamptz, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare actor_id uuid := (select auth.uid()); target public.platform_admin_members%rowtype; replay_target text; replay_result text; replay_id uuid; audit_key text := encode(extensions.digest(coalesce(p_idempotency_key, '') || ':admin.mfa.exception.retired', 'sha256'), 'hex');
begin
  if actor_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if private.operator_mfa_required(actor_id) and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then raise exception 'MFA_REQUIRED'; end if;
  if not private.has_platform_permission('admin.role.change.request', null) then raise exception 'PERMISSION_DENIED'; end if;
  if p_user_id is null or p_expected_updated_at is null or p_idempotency_key !~ '^[a-f0-9]{64}$' then raise exception 'MFA_EXCEPTION_INPUT_INVALID'; end if;
  select event.target_id, event.result, event.id into replay_target, replay_result, replay_id from public.platform_audit_events event where event.idempotency_key = p_idempotency_key;
  if replay_id is not null then
    if replay_target <> p_user_id::text then raise exception 'MFA_EXCEPTION_IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('status', case when replay_result = 'succeeded' then 'retired' else 'failed' end, 'user_id', p_user_id, 'replayed', true, 'audit_event_id', replay_id);
  end if;
  select * into target from public.platform_admin_members member where member.user_id = p_user_id for update;
  if not found then raise exception 'OPERATOR_NOT_FOUND'; end if;
  if target.status <> 'active' then raise exception 'OPERATOR_NOT_ACTIVE'; end if;
  if not exists (select 1 from auth.mfa_factors factor where factor.user_id = p_user_id and factor.status = 'verified' and factor.factor_type = 'totp') then raise exception 'MFA_FACTOR_REQUIRED'; end if;
  if target.updated_at <> p_expected_updated_at then raise exception 'MFA_EXCEPTION_VERSION_CONFLICT'; end if;
  if target.mfa_required then return jsonb_build_object('status', 'already_required', 'user_id', p_user_id, 'replayed', true); end if;
  update public.platform_admin_members set mfa_required = true, mfa_exception_retired_at = statement_timestamp() where user_id = p_user_id;
  perform private.append_platform_audit_event(actor_id, null, 'admin.mfa.exception.retired', 'platform_admin_member', p_user_id::text, 'MFA exception retired', audit_key, 'succeeded', jsonb_build_object('mfa_required', false), jsonb_build_object('mfa_required', true), p_idempotency_key, 'observed', null, null);
  return jsonb_build_object('status', 'retired', 'user_id', p_user_id, 'replayed', false);
exception when others then
  if sqlerrm in ('AUTH_REQUIRED', 'MFA_REQUIRED', 'PERMISSION_DENIED', 'MFA_EXCEPTION_INPUT_INVALID', 'MFA_EXCEPTION_IDEMPOTENCY_CONFLICT', 'OPERATOR_NOT_FOUND', 'OPERATOR_NOT_ACTIVE', 'MFA_FACTOR_REQUIRED', 'MFA_EXCEPTION_VERSION_CONFLICT') then raise; end if;
  raise exception 'MFA_EXCEPTION_RETIRE_UNAVAILABLE';
end;
$$;

revoke all on function public.retire_operator_mfa_exception(uuid, timestamptz, text) from public, anon, service_role;
grant execute on function public.retire_operator_mfa_exception(uuid, timestamptz, text) to authenticated;
