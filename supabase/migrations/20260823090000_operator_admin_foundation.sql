create table public.platform_admin_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null check (status in ('invited', 'active', 'disabled')),
  mfa_required boolean not null default true,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_roles (
  role_key text primary key check (
    role_key in (
      'platform_owner', 'operations_admin', 'customer_support',
      'content_operator', 'billing_admin', 'system_admin', 'audit_viewer'
    )
  ),
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.platform_role_permissions (
  role_key text not null references public.platform_roles (role_key) on delete cascade,
  permission_key text not null check (
    permission_key in (
      'dashboard.read',
      'workspace.read',
      'workspace.support_session.create',
      'workspace.lifecycle.manage',
      'agreement.read',
      'agreement.request',
      'agreement.verify',
      'channel.read',
      'channel.assist',
      'channel.disconnect.request',
      'publish.read',
      'publish.retry.request',
      'billing.read',
      'payment.verify',
      'credit.adjust.request',
      'credit.adjust.approve',
      'system.read',
      'incident.manage',
      'admin.read',
      'admin.invite',
      'admin.role.change.request',
      'audit.read',
      'audit.export.request'
    )
  ),
  created_at timestamptz not null default now(),
  primary key (role_key, permission_key)
);

create table public.platform_admin_role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null references public.platform_roles (role_key) on delete restrict,
  workspace_id uuid references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint platform_admin_role_assignments_scope_key
    unique (user_id, role_key, workspace_id)
);

create unique index platform_admin_role_assignments_all_scope_key
  on public.platform_admin_role_assignments (user_id, role_key)
  where workspace_id is null;

create index platform_admin_role_assignments_workspace_idx
  on public.platform_admin_role_assignments (workspace_id, user_id, role_key)
  where workspace_id is not null;

create index platform_admin_role_assignments_user_idx
  on public.platform_admin_role_assignments (user_id, role_key, workspace_id);

alter table public.platform_admin_members enable row level security;
alter table public.platform_roles enable row level security;
alter table public.platform_role_permissions enable row level security;
alter table public.platform_admin_role_assignments enable row level security;

revoke all on public.platform_admin_members from public, anon, authenticated;
revoke all on public.platform_roles from public, anon, authenticated;
revoke all on public.platform_role_permissions from public, anon, authenticated;
revoke all on public.platform_admin_role_assignments from public, anon, authenticated;

grant select, insert, update, delete on public.platform_admin_members to service_role;
grant select, insert, update, delete on public.platform_roles to service_role;
grant select, insert, update, delete on public.platform_role_permissions to service_role;
grant select, insert, update, delete on public.platform_admin_role_assignments to service_role;

create trigger platform_admin_members_set_updated_at
before update on public.platform_admin_members
for each row execute function private.set_updated_at();

insert into public.platform_roles (role_key, display_name)
values
  ('platform_owner', '최고 관리자'),
  ('operations_admin', '운영 관리자'),
  ('customer_support', '고객 지원'),
  ('content_operator', '콘텐츠 운영'),
  ('billing_admin', '재무 관리자'),
  ('system_admin', '시스템 관리자'),
  ('audit_viewer', '감사 조회자');

with permissions(permission_key) as (
  values
    ('dashboard.read'),
    ('workspace.read'),
    ('workspace.support_session.create'),
    ('workspace.lifecycle.manage'),
    ('agreement.read'),
    ('agreement.request'),
    ('agreement.verify'),
    ('channel.read'),
    ('channel.assist'),
    ('channel.disconnect.request'),
    ('publish.read'),
    ('publish.retry.request'),
    ('billing.read'),
    ('payment.verify'),
    ('credit.adjust.request'),
    ('credit.adjust.approve'),
    ('system.read'),
    ('incident.manage'),
    ('admin.read'),
    ('admin.invite'),
    ('admin.role.change.request'),
    ('audit.read'),
    ('audit.export.request')
), role_permissions(role_key, permission_key) as (
  select 'platform_owner', permission_key from permissions
  union all
  select 'operations_admin', permission_key from permissions
  where permission_key in (
    'dashboard.read', 'workspace.read', 'workspace.support_session.create',
    'workspace.lifecycle.manage', 'agreement.read', 'agreement.request',
    'agreement.verify', 'channel.read', 'channel.assist',
    'channel.disconnect.request', 'publish.read', 'publish.retry.request',
    'system.read', 'incident.manage'
  )
  union all
  select 'customer_support', permission_key from permissions
  where permission_key in (
    'dashboard.read', 'workspace.read', 'workspace.support_session.create',
    'agreement.read', 'channel.read', 'publish.read', 'billing.read',
    'system.read'
  )
  union all
  select 'content_operator', permission_key from permissions
  where permission_key in (
    'dashboard.read', 'workspace.read', 'agreement.read', 'channel.read',
    'publish.read', 'publish.retry.request'
  )
  union all
  select 'billing_admin', permission_key from permissions
  where permission_key in (
    'dashboard.read', 'workspace.read', 'billing.read', 'payment.verify',
    'credit.adjust.request', 'credit.adjust.approve'
  )
  union all
  select 'system_admin', permission_key from permissions
  where permission_key in (
    'dashboard.read', 'system.read', 'incident.manage'
  )
  union all
  select 'audit_viewer', permission_key from permissions
  where permission_key in ('dashboard.read', 'audit.read', 'audit.export.request')
)
insert into public.platform_role_permissions (role_key, permission_key)
select role_key, permission_key from role_permissions;

create or replace function private.has_platform_permission(
  p_permission_key text,
  p_workspace_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admin_members as member
    join public.platform_admin_role_assignments as assignment
      on assignment.user_id = member.user_id
    join public.platform_role_permissions as permission
      on permission.role_key = assignment.role_key
    where member.user_id = (select auth.uid())
      and member.status = 'active'
      and permission.permission_key = p_permission_key
      and (
        (p_workspace_id is null and assignment.workspace_id is null)
        or (
          p_workspace_id is not null
          and (
            assignment.workspace_id is null
            or assignment.workspace_id = p_workspace_id
          )
        )
      )
  );
$$;

create or replace function private.get_current_operator_context_internal()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  member_status text;
  member_mfa_required boolean;
  permission_list jsonb;
  permission_scopes jsonb;
  workspace_scope jsonb;
begin
  select member.status, member.mfa_required
  into member_status, member_mfa_required
  from public.platform_admin_members as member
  where member.user_id = actor_id;

  if member_status is distinct from 'active' then
    return null;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(permission_key order by permission_key),
    '[]'::jsonb
  )
  into permission_list
  from (
    select distinct permission.permission_key
    from public.platform_admin_role_assignments as assignment
    join public.platform_role_permissions as permission
      on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id
  ) as permissions;

  select coalesce(
    pg_catalog.jsonb_agg(item order by item ->> 'permission', item ->> 'workspace_scope'),
    '[]'::jsonb
  )
  into permission_scopes
  from (
    select distinct pg_catalog.jsonb_build_object(
      'permission', permission.permission_key,
      'workspace_scope', case
        when assignment.workspace_id is null then '"all"'::jsonb
        else pg_catalog.jsonb_build_array(assignment.workspace_id::text)
      end
    ) as item
    from public.platform_admin_role_assignments as assignment
    join public.platform_role_permissions as permission
      on permission.role_key = assignment.role_key
    where assignment.user_id = actor_id
  ) as scoped_permissions;

  if exists (
    select 1
    from public.platform_admin_role_assignments as assignment
    where assignment.user_id = actor_id
      and assignment.workspace_id is null
  ) then
    workspace_scope := '"all"'::jsonb;
  else
    select coalesce(
      pg_catalog.jsonb_agg(workspace_id order by workspace_id),
      '[]'::jsonb
    )
    into workspace_scope
    from (
      select distinct assignment.workspace_id::text as workspace_id
      from public.platform_admin_role_assignments as assignment
      where assignment.user_id = actor_id
        and assignment.workspace_id is not null
    ) as workspaces;
  end if;

  return pg_catalog.jsonb_build_object(
    'user_id', actor_id::text,
    'status', member_status,
    'permissions', permission_list,
    'workspace_scope', workspace_scope,
    'mfa_required', member_mfa_required,
    'permission_scopes', permission_scopes
  );
end;
$$;

revoke execute on function private.has_platform_permission(text, uuid)
  from public, anon, authenticated;
grant execute on function private.has_platform_permission(text, uuid)
  to service_role;
revoke execute on function private.get_current_operator_context_internal()
  from public, anon, authenticated;

create or replace function public.get_current_operator_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.get_current_operator_context_internal();
$$;

revoke execute on function public.get_current_operator_context()
  from public, anon;
grant execute on function public.get_current_operator_context()
  to authenticated, service_role;

create or replace function private.bootstrap_platform_owner_internal(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise exception 'PLATFORM_OWNER_USER_REQUIRED';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'AUTH_USER_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform-owner-bootstrap', 0)
  );

  if exists (
    select 1
    from public.platform_admin_role_assignments as assignment
    where assignment.role_key = 'platform_owner'
  ) then
    return false;
  end if;

  insert into public.platform_admin_members (user_id, status, mfa_required)
  values (p_user_id, 'active', true)
  on conflict (user_id) do update
  set status = 'active', mfa_required = true;

  insert into public.platform_admin_role_assignments (user_id, role_key)
  values (p_user_id, 'platform_owner');

  return true;
end;
$$;

revoke execute on function private.bootstrap_platform_owner_internal(uuid)
  from public, anon, authenticated;
grant execute on function private.bootstrap_platform_owner_internal(uuid)
  to service_role;

create or replace function public.bootstrap_platform_owner(p_user_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED';
  end if;

  return private.bootstrap_platform_owner_internal(p_user_id);
end;
$$;

revoke execute on function public.bootstrap_platform_owner(uuid)
  from public, anon, authenticated;
grant execute on function public.bootstrap_platform_owner(uuid)
  to service_role;
