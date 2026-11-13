begin;

create extension if not exists pgtap with schema extensions;

select plan(68);

select has_table(
  'public', 'platform_admin_members',
  'platform administrator members exist'
);
select has_table(
  'public', 'platform_roles',
  'platform roles exist'
);
select has_table(
  'public', 'platform_role_permissions',
  'platform role permissions exist'
);
select has_table(
  'public', 'platform_admin_role_assignments',
  'platform administrator role assignments exist'
);
select function_returns(
  'public', 'get_current_operator_context', array[]::text[], 'jsonb',
  'current operator context returns jsonb'
);
select has_function(
  'private', 'has_platform_permission', array['text', 'uuid'],
  'platform permission helper exists'
);
select has_function(
  'private', 'get_current_operator_context_internal', array[]::text[],
  'private operator context implementation exists'
);
select has_function(
  'private', 'bootstrap_platform_owner_internal', array['uuid'],
  'private bootstrap implementation exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_admin_members'::regclass),
  'platform administrator members have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_roles'::regclass),
  'platform roles have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_role_permissions'::regclass),
  'platform role permissions have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.platform_admin_role_assignments'::regclass),
  'platform role assignments have RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.platform_admin_members', 'SELECT'),
  'anonymous users cannot read platform administrator members'
);
select ok(
  not has_table_privilege('authenticated', 'public.platform_admin_members', 'SELECT'),
  'authenticated users cannot read platform administrator members directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.platform_roles', 'SELECT'),
  'authenticated users cannot read platform roles directly'
);
select ok(
  has_table_privilege('service_role', 'public.platform_admin_members', 'SELECT'),
  'service role can read platform administrator members'
);
select ok(
  not exists (
    select 1
    from (
      values
        ('platform_admin_members'),
        ('platform_roles'),
        ('platform_role_permissions'),
        ('platform_admin_role_assignments')
    ) as tables(table_name),
    (
      values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
    ) as actions(privilege)
    where has_table_privilege(
      'anon', 'public.' || tables.table_name, actions.privilege
    )
      or has_table_privilege(
        'authenticated', 'public.' || tables.table_name, actions.privilege
      )
  ),
  'anon and authenticated have no direct table privileges on operator tables'
);
select ok(
  not exists (
    select 1
    from (
      values
        ('platform_admin_members'),
        ('platform_roles'),
        ('platform_role_permissions'),
        ('platform_admin_role_assignments')
    ) as tables(table_name),
    (
      values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
    ) as actions(privilege)
    where not has_table_privilege(
      'service_role', 'public.' || tables.table_name, actions.privilege
    )
  ),
  'service role has all direct table privileges on operator tables'
);

select is(
  (
    select array_agg(role_key order by role_key)
    from public.platform_roles
  ),
  array[
    'audit_viewer', 'billing_admin', 'content_operator', 'customer_support',
    'operations_admin', 'platform_owner', 'system_admin'
  ]::text[],
  'exactly the seven planned platform roles are seeded'
);
select is(
  (
    select array_agg(permission_key order by permission_key)
    from (
      select distinct permission_key
      from public.platform_role_permissions
    ) as permissions
  ),
  array[
    'admin.invite', 'admin.read', 'admin.role.change.request', 'agreement.read',
    'agreement.request', 'agreement.verify', 'audit.export.request', 'audit.read',
    'billing.read', 'channel.assist', 'channel.disconnect.request', 'channel.read',
    'credit.adjust.approve', 'credit.adjust.request', 'dashboard.read',
    'incident.manage', 'payment.verify', 'publish.read', 'publish.retry.request',
    'system.read', 'workspace.lifecycle.manage', 'workspace.read',
    'workspace.support_session.create'
  ]::text[],
  'exactly the planned 23 permission keys are seeded'
);
select is(
  (
    select array_agg(permission_key order by permission_key)
    from public.platform_role_permissions
    where role_key = 'platform_owner'
  ),
  array[
    'admin.invite', 'admin.read', 'admin.role.change.request', 'agreement.read',
    'agreement.request', 'agreement.verify', 'audit.export.request', 'audit.read',
    'billing.read', 'channel.assist', 'channel.disconnect.request', 'channel.read',
    'credit.adjust.approve', 'credit.adjust.request', 'dashboard.read',
    'incident.manage', 'payment.verify', 'publish.read', 'publish.retry.request',
    'system.read', 'workspace.lifecycle.manage', 'workspace.read',
    'workspace.support_session.create'
  ]::text[],
  'platform owner links to all 23 permissions'
);
select is(
  (
    select array_agg(permission_key order by permission_key)
    from public.platform_role_permissions
    where role_key = 'operations_admin'
  ),
  array[
    'agreement.read', 'agreement.request', 'agreement.verify', 'channel.assist',
    'channel.disconnect.request', 'channel.read', 'dashboard.read',
    'incident.manage', 'publish.read', 'publish.retry.request', 'system.read',
    'workspace.lifecycle.manage', 'workspace.read', 'workspace.support_session.create'
  ]::text[],
  'operations admin links to its exact permissions'
);
select is(
  (
    select array_agg(permission_key order by permission_key)
    from public.platform_role_permissions
    where role_key = 'customer_support'
  ),
  array[
    'agreement.read', 'billing.read', 'channel.read', 'dashboard.read',
    'publish.read', 'system.read', 'workspace.read',
    'workspace.support_session.create'
  ]::text[],
  'customer support links to its exact permissions'
);
select is(
  (
    select array_agg(permission_key order by permission_key)
    from public.platform_role_permissions
    where role_key = 'content_operator'
  ),
  array[
    'agreement.read', 'channel.read', 'dashboard.read', 'publish.read',
    'publish.retry.request', 'workspace.read'
  ]::text[],
  'content operator links to its exact permissions'
);
select is(
  (
    select array_agg(permission_key order by permission_key)
    from public.platform_role_permissions
    where role_key = 'billing_admin'
  ),
  array[
    'billing.read', 'credit.adjust.approve', 'credit.adjust.request',
    'dashboard.read', 'payment.verify', 'workspace.read'
  ]::text[],
  'billing admin links to its exact permissions'
);
select is(
  (
    select array_agg(permission_key order by permission_key)
    from public.platform_role_permissions
    where role_key = 'system_admin'
  ),
  array['dashboard.read', 'incident.manage', 'system.read']::text[],
  'system admin links to its exact permissions'
);
select is(
  (
    select array_agg(permission_key order by permission_key)
    from public.platform_role_permissions
    where role_key = 'audit_viewer'
  ),
  array['audit.export.request', 'audit.read', 'dashboard.read']::text[],
  'audit viewer links to its exact permissions'
);

select function_privs_are(
  'public', 'get_current_operator_context', array[]::text[],
  'anon', array[]::text[],
  'anonymous users cannot call the operator context function'
);
select function_privs_are(
  'public', 'get_current_operator_context', array[]::text[],
  'authenticated', array['EXECUTE'],
  'authenticated users may ask for their operator context'
);
select function_privs_are(
  'public', 'bootstrap_platform_owner', array['uuid'],
  'anon', array[]::text[],
  'anonymous users cannot bootstrap a platform owner'
);
select function_privs_are(
  'public', 'bootstrap_platform_owner', array['uuid'],
  'authenticated', array[]::text[],
  'authenticated users cannot bootstrap a platform owner'
);
select function_privs_are(
  'public', 'bootstrap_platform_owner', array['uuid'],
  'service_role', array['EXECUTE'],
  'service role may bootstrap a platform owner'
);
select function_privs_are(
  'private', 'has_platform_permission', array['text', 'uuid'],
  'authenticated', array[]::text[],
  'authenticated users cannot call the private permission helper directly'
);
select function_privs_are(
  'private', 'has_platform_permission', array['text', 'uuid'],
  'public', array[]::text[],
  'public users cannot call the private permission helper directly'
);
select function_privs_are(
  'private', 'has_platform_permission', array['text', 'uuid'],
  'anon', array[]::text[],
  'anonymous users cannot call the private permission helper directly'
);
select function_privs_are(
  'private', 'get_current_operator_context_internal', array[]::text[],
  'public', array[]::text[],
  'public users cannot call the private context implementation'
);
select function_privs_are(
  'private', 'get_current_operator_context_internal', array[]::text[],
  'anon', array[]::text[],
  'anonymous users cannot call the private context implementation'
);
select function_privs_are(
  'private', 'get_current_operator_context_internal', array[]::text[],
  'authenticated', array[]::text[],
  'authenticated users cannot call the private context implementation'
);
select function_privs_are(
  'private', 'bootstrap_platform_owner_internal', array['uuid'],
  'public', array[]::text[],
  'public users cannot call the private bootstrap implementation'
);
select function_privs_are(
  'private', 'bootstrap_platform_owner_internal', array['uuid'],
  'anon', array[]::text[],
  'anonymous users cannot call the private bootstrap implementation'
);
select function_privs_are(
  'private', 'bootstrap_platform_owner_internal', array['uuid'],
  'authenticated', array[]::text[],
  'authenticated users cannot call the private bootstrap implementation'
);

insert into auth.users (id, email)
values
  ('88000000-0000-4000-8000-000000000001', 'operator-owner@sohee.test.invalid'),
  ('88000000-0000-4000-8000-000000000002', 'operator-outsider@sohee.test.invalid'),
  ('88000000-0000-4000-8000-000000000003', 'operator-second-owner@sohee.test.invalid'),
  ('88000000-0000-4000-8000-000000000004', 'operator-scoped@sohee.test.invalid'),
  ('88000000-0000-4000-8000-000000000005', 'operator-invited@sohee.test.invalid'),
  ('88000000-0000-4000-8000-000000000006', 'operator-disabled@sohee.test.invalid'),
  ('88000000-0000-4000-8000-000000000007', 'operator-mixed-scope@sohee.test.invalid');

insert into public.workspaces (id, name, created_by)
values
  (
    '88000000-0000-4000-8000-000000000101',
    '운영사 범위 A',
    '88000000-0000-4000-8000-000000000001'
  ),
  (
    '88000000-0000-4000-8000-000000000102',
    '운영사 범위 B',
    '88000000-0000-4000-8000-000000000001'
  );

insert into public.platform_admin_members (user_id, status)
values
  ('88000000-0000-4000-8000-000000000004', 'active'),
  ('88000000-0000-4000-8000-000000000005', 'invited'),
  ('88000000-0000-4000-8000-000000000006', 'disabled'),
  ('88000000-0000-4000-8000-000000000007', 'active');

insert into public.platform_admin_role_assignments (user_id, role_key, workspace_id)
values
  (
    '88000000-0000-4000-8000-000000000004', 'operations_admin',
    '88000000-0000-4000-8000-000000000101'
  ),
  (
    '88000000-0000-4000-8000-000000000007', 'audit_viewer', null
  ),
  (
    '88000000-0000-4000-8000-000000000007', 'operations_admin',
    '88000000-0000-4000-8000-000000000101'
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '88000000-0000-4000-8000-000000000002', true
);

select is(
  public.get_current_operator_context(),
  null::jsonb,
  'an authenticated user without an operator membership gets null context'
);

select set_config(
  'request.jwt.claim.sub', '88000000-0000-4000-8000-000000000005', true
);
select is(
  public.get_current_operator_context(),
  null::jsonb,
  'an invited operator has no current context'
);
select set_config(
  'request.jwt.claim.sub', '88000000-0000-4000-8000-000000000006', true
);
select is(
  public.get_current_operator_context(),
  null::jsonb,
  'a disabled operator has no current context'
);

select throws_ok(
  $$select count(*) from public.platform_admin_members$$,
  '42501',
  'permission denied for table platform_admin_members',
  'authenticated users cannot directly read operator members'
);

set local role service_role;
select lives_ok(
  $$select public.bootstrap_platform_owner(
      '88000000-0000-4000-8000-000000000001'::uuid
    )$$,
  'service role can bootstrap an existing auth user without a password'
);

select is(
  (
    select count(*)::integer
    from public.platform_admin_members
    where user_id = '88000000-0000-4000-8000-000000000001'
      and status = 'active'
      and mfa_required
  ),
  1,
  'bootstrap creates one active MFA-required operator member'
);
reset role;
select ok(
  (
    select encrypted_password is null
    from auth.users
    where id = '88000000-0000-4000-8000-000000000001'
  ),
  'bootstrap does not create or require a password'
);
set local role service_role;
select is(
  (
    select count(*)::integer
    from public.platform_admin_role_assignments
    where user_id = '88000000-0000-4000-8000-000000000001'
      and role_key = 'platform_owner'
      and workspace_id is null
  ),
  1,
  'bootstrap grants the platform owner role across all workspaces'
);

select is(
  public.bootstrap_platform_owner(
    '88000000-0000-4000-8000-000000000003'::uuid
  ),
  false,
  'a second platform owner bootstrap is rejected'
);
select is(
  (
    select count(*)::integer
    from public.platform_admin_role_assignments
    where role_key = 'platform_owner'
  ),
  1,
  'a second bootstrap does not create another platform owner'
);
select is(
  (
    select count(*)::integer
    from public.platform_admin_members
    where user_id = '88000000-0000-4000-8000-000000000003'
  ),
  0,
  'a rejected second bootstrap creates no member row for the second user'
);
select is(
  (
    select count(*)::integer
    from public.platform_admin_role_assignments
    where user_id = '88000000-0000-4000-8000-000000000003'
  ),
  0,
  'a rejected second bootstrap creates no role assignment for the second user'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '88000000-0000-4000-8000-000000000001', true
);

select is(
  public.get_current_operator_context() ->> 'status',
  'active',
  'operator context reports active status'
);
select is(
  public.get_current_operator_context() ->> 'workspace_scope',
  'all',
  'platform owner context has all-workspace scope'
);
select is(
  (public.get_current_operator_context() ->> 'mfa_required')::boolean,
  true,
  'operator context reports MFA requirement'
);
select is(
  jsonb_array_length(public.get_current_operator_context() -> 'permissions'),
  23,
  'operator context includes exactly the planned permission codes'
);

reset role;
set local role service_role;
select set_config(
  'request.jwt.claim.sub', '88000000-0000-4000-8000-000000000004', true
);
select is(
  private.has_platform_permission(
    'workspace.lifecycle.manage',
    '88000000-0000-4000-8000-000000000101'
  ),
  true,
  'a scoped operator has permission in its assigned workspace'
);
select is(
  private.has_platform_permission(
    'workspace.lifecycle.manage',
    '88000000-0000-4000-8000-000000000102'
  ),
  false,
  'a scoped operator lacks permission in another workspace'
);
select is(
  private.has_platform_permission('workspace.lifecycle.manage', null),
  false,
  'a scoped operator cannot use a null workspace to expand scope'
);
select set_config(
  'request.jwt.claim.sub', '88000000-0000-4000-8000-000000000001', true
);
select is(
  private.has_platform_permission('dashboard.read', null),
  true,
  'an all-scope operator has permission with a null workspace'
);
select is(
  private.has_platform_permission(
    'dashboard.read', '88000000-0000-4000-8000-000000000102'
  ),
  true,
  'an all-scope operator has permission in any workspace'
);
select set_config(
  'request.jwt.claim.sub', '88000000-0000-4000-8000-000000000007', true
);
select is(
  private.has_platform_permission('workspace.lifecycle.manage', null),
  false,
  'mixed-scope operators do not expand a scoped permission at null scope'
);
select is(
  private.has_platform_permission(
    'workspace.lifecycle.manage', '88000000-0000-4000-8000-000000000102'
  ),
  false,
  'mixed-scope operators do not expand a scoped permission to another workspace'
);
select is(
  private.has_platform_permission(
    'workspace.lifecycle.manage', '88000000-0000-4000-8000-000000000101'
  ),
  true,
  'mixed-scope operators retain the scoped permission in its workspace'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '88000000-0000-4000-8000-000000000007', true
);
select is(
  public.get_current_operator_context() -> 'workspace_scope',
  '"all"'::jsonb,
  'mixed-scope context publishes the broad all-workspace visibility union'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_current_operator_context() -> 'permission_scopes'
    ) as item
    where item ->> 'permission' = 'workspace.lifecycle.manage'
      and item -> 'workspace_scope' =
        '["88000000-0000-4000-8000-000000000101"]'::jsonb
  ),
  'mixed-scope context preserves the scoped permission pairing'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.get_current_operator_context() -> 'permission_scopes'
    ) as item
    where item ->> 'permission' = 'audit.read'
      and item -> 'workspace_scope' = '"all"'::jsonb
  ),
  'mixed-scope context preserves the all-workspace permission pairing'
);

select * from finish();
rollback;
