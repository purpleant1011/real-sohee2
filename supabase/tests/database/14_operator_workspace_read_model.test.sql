begin;

create extension if not exists pgtap with schema extensions;

select plan(85);

select function_returns(
  'public', 'list_operator_workspaces',
  array['timestamptz', 'uuid', 'text', 'text', 'text', 'integer'],
  'jsonb',
  'workspace list read RPC has the exact six-argument signature'
);
select function_returns(
  'public', 'get_operator_workspace_detail',
  array['uuid'], 'jsonb',
  'workspace detail read RPC has the exact one-argument signature'
);

select ok(
  coalesce((select p.prosecdef
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'list_operator_workspaces'
     and pg_get_function_identity_arguments(p.oid) = 'p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_cursor_fingerprint text, p_query text, p_status text, p_limit integer'), false),
  'list RPC is security definer with named canonical arguments'
);
select ok(
  coalesce((select p.prosecdef
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_operator_workspace_detail'
     and pg_get_function_identity_arguments(p.oid) = 'p_workspace_id uuid'), false),
  'detail RPC is security definer with named workspace argument'
);

select ok(
  not coalesce((select has_function_privilege('anon', 'public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)', 'EXECUTE') where to_regprocedure('public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)') is not null), false),
  'anon cannot execute workspace list RPC'
);
select ok(
  not coalesce((select has_function_privilege('public', 'public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)', 'EXECUTE') where to_regprocedure('public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)') is not null), false),
  'PUBLIC cannot execute workspace list RPC'
);
select ok(
  not coalesce((select has_function_privilege('service_role', 'public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)', 'EXECUTE') where to_regprocedure('public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)') is not null), false),
  'service_role cannot execute workspace list RPC'
);
select ok(
  coalesce((select has_function_privilege('authenticated', 'public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)', 'EXECUTE') where to_regprocedure('public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)') is not null), false),
  'authenticated can execute workspace list RPC'
);
select ok(
  not coalesce((select has_function_privilege('anon', 'public.get_operator_workspace_detail(uuid)', 'EXECUTE') where to_regprocedure('public.get_operator_workspace_detail(uuid)') is not null), false),
  'anon cannot execute workspace detail RPC'
);
select ok(
  not coalesce((select has_function_privilege('public', 'public.get_operator_workspace_detail(uuid)', 'EXECUTE') where to_regprocedure('public.get_operator_workspace_detail(uuid)') is not null), false),
  'PUBLIC cannot execute workspace detail RPC'
);
select ok(
  not coalesce((select has_function_privilege('service_role', 'public.get_operator_workspace_detail(uuid)', 'EXECUTE') where to_regprocedure('public.get_operator_workspace_detail(uuid)') is not null), false),
  'service_role cannot execute workspace detail RPC'
);
select ok(
  coalesce((select has_function_privilege('authenticated', 'public.get_operator_workspace_detail(uuid)', 'EXECUTE') where to_regprocedure('public.get_operator_workspace_detail(uuid)') is not null), false),
  'authenticated can execute workspace detail RPC'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.workspaces'::regclass),
  'customer workspaces RLS remains enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.business_profiles'::regclass),
  'customer business profile RLS remains enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.channel_connections'::regclass),
  'customer channel connection RLS remains enabled'
);

select throws_ok(
  $$select public.list_operator_workspaces(null, null, null, null, null, 50)$$,
  'AUTH_REQUIRED',
  'unauthenticated list calls fail closed'
);
select throws_ok(
  $$select public.get_operator_workspace_detail('11111111-1111-4111-8111-111111111111'::uuid)$$,
  'AUTH_REQUIRED',
  'unauthenticated detail calls fail closed'
);

select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'list_operator_workspaces'
      and pg_get_function_identity_arguments(p.oid) <> 'p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_cursor_fingerprint text, p_query text, p_status text, p_limit integer'
  ),
  'workspace list has no overloads'
);
select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_operator_workspace_detail'
      and pg_get_function_identity_arguments(p.oid) <> 'p_workspace_id uuid'
  ),
  'workspace detail has no overloads'
);

select is(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_operator_workspaces'
     and pg_get_function_identity_arguments(p.oid) = 'p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_cursor_fingerprint text, p_query text, p_status text, p_limit integer'),
  array['search_path=""']::text[],
  'list RPC pins an empty search_path'
);
select is(
  (select p.pronargdefaults::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_operator_workspaces'
     and pg_get_function_identity_arguments(p.oid) = 'p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_cursor_fingerprint text, p_query text, p_status text, p_limit integer'),
  6,
  'list RPC gives all six canonical arguments defaults'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workspace_members'::regclass),
  'workspace members RLS remains enabled'
);
select is((select array_agg(policyname order by policyname)::text[] from pg_policies where schemaname = 'public' and tablename = 'workspaces'), array['authenticated users can create workspaces','workspace managers can update workspaces','workspace members can read workspaces']::text[], 'workspaces policies remain exact');
select is((select array_agg(policyname order by policyname)::text[] from pg_policies where schemaname = 'public' and tablename = 'business_profiles'), array['workspace managers can insert business profiles','workspace managers can update business profiles','workspace members can read business profiles']::text[], 'business profile policies remain exact');
select is((select array_agg(policyname order by policyname)::text[] from pg_policies where schemaname = 'public' and tablename = 'workspace_members'), array['owners can delete workspace members','owners can insert workspace members','owners can update workspace member roles','workspace members can read active peers']::text[], 'workspace member policies remain exact');
select is((select array_agg(policyname order by policyname)::text[] from pg_policies where schemaname = 'public' and tablename = 'channel_connections'), array['workspace members can read channel connections']::text[], 'channel policies remain exact');
select ok(has_table_privilege('authenticated', 'public.workspaces', 'SELECT'), 'authenticated workspace SELECT grant remains');
select ok(has_table_privilege('authenticated', 'public.business_profiles', 'SELECT'), 'authenticated business SELECT grant remains');
select ok(has_table_privilege('authenticated', 'public.workspace_members', 'SELECT'), 'authenticated member SELECT grant remains');
select ok(has_table_privilege('authenticated', 'public.channel_connections', 'SELECT'), 'authenticated channel SELECT grant remains');
select ok(not has_table_privilege('anon', 'public.workspaces', 'SELECT'), 'anon workspace SELECT grant remains denied');
select ok(not has_table_privilege('anon', 'public.business_profiles', 'SELECT'), 'anon business SELECT grant remains denied');
select ok(not has_table_privilege('anon', 'public.workspace_members', 'SELECT'), 'anon member SELECT grant remains denied');
select ok(not has_table_privilege('anon', 'public.channel_connections', 'SELECT'), 'anon channel SELECT grant remains denied');
select is((select md5(jsonb_agg(jsonb_build_object('policyname',policyname,'cmd',cmd,'roles',roles,'qual',qual,'with_check',with_check) order by policyname)::text) from pg_policies where schemaname = 'public' and tablename = 'workspaces'), '63f4c15d2bf6515fc96ff391b8b84cc1', 'workspaces policy rows are frozen');
select is((select md5(jsonb_agg(jsonb_build_object('policyname',policyname,'cmd',cmd,'roles',roles,'qual',qual,'with_check',with_check) order by policyname)::text) from pg_policies where schemaname = 'public' and tablename = 'business_profiles'), '3817fcb0e59813bcce9a19cb196fe093', 'business policy rows are frozen');
select is((select md5(jsonb_agg(jsonb_build_object('policyname',policyname,'cmd',cmd,'roles',roles,'qual',qual,'with_check',with_check) order by policyname)::text) from pg_policies where schemaname = 'public' and tablename = 'workspace_members'), '67be5f8bf2ec54a11060d180c6713bee', 'member policy rows are frozen');
select is((select md5(jsonb_agg(jsonb_build_object('policyname',policyname,'cmd',cmd,'roles',roles,'qual',qual,'with_check',with_check) order by policyname)::text) from pg_policies where schemaname = 'public' and tablename = 'channel_connections'), 'd67fb4869623491c34b178e5ee9846fa', 'channel policy rows are frozen');
select is((select md5(jsonb_agg(jsonb_build_object('role',r.rolname,'select',has_table_privilege(r.rolname,'public.'||c.relname,'SELECT'),'insert',has_table_privilege(r.rolname,'public.'||c.relname,'INSERT'),'update',has_table_privilege(r.rolname,'public.'||c.relname,'UPDATE'),'delete',has_table_privilege(r.rolname,'public.'||c.relname,'DELETE')) order by r.rolname)::text) from (values ('workspaces')) c(relname) cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)), 'caf8c315f56dc69977306dc820c27acd', 'workspaces grants are frozen');
select is((select md5(jsonb_agg(jsonb_build_object('role',r.rolname,'select',has_table_privilege(r.rolname,'public.'||c.relname,'SELECT'),'insert',has_table_privilege(r.rolname,'public.'||c.relname,'INSERT'),'update',has_table_privilege(r.rolname,'public.'||c.relname,'UPDATE'),'delete',has_table_privilege(r.rolname,'public.'||c.relname,'DELETE')) order by r.rolname)::text) from (values ('business_profiles')) c(relname) cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)), 'caf8c315f56dc69977306dc820c27acd', 'business grants are frozen');
select is((select md5(jsonb_agg(jsonb_build_object('role',r.rolname,'select',has_table_privilege(r.rolname,'public.'||c.relname,'SELECT'),'insert',has_table_privilege(r.rolname,'public.'||c.relname,'INSERT'),'update',has_table_privilege(r.rolname,'public.'||c.relname,'UPDATE'),'delete',has_table_privilege(r.rolname,'public.'||c.relname,'DELETE')) order by r.rolname)::text) from (values ('workspace_members')) c(relname) cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)), '47204ee15052acc1107dc7a15043807e', 'member grants are frozen');
select is((select md5(jsonb_agg(jsonb_build_object('role',r.rolname,'select',has_table_privilege(r.rolname,'public.'||c.relname,'SELECT'),'insert',has_table_privilege(r.rolname,'public.'||c.relname,'INSERT'),'update',has_table_privilege(r.rolname,'public.'||c.relname,'UPDATE'),'delete',has_table_privilege(r.rolname,'public.'||c.relname,'DELETE')) order by r.rolname)::text) from (values ('channel_connections')) c(relname) cross join (values ('anon'),('authenticated'),('service_role')) r(rolname)), 'f5ee57d16fbd3f927af90a93d2dbb9a3', 'channel grants are frozen');
select ok(
  not has_table_privilege('anon', 'public.workspaces', 'SELECT'),
  'anon cannot read customer workspaces directly'
);

insert into auth.users (id, email)
values
  ('99000000-0000-4000-8000-000000000001', 'workspace-read-a@sohee.test.invalid'),
  ('99000000-0000-4000-8000-000000000002', 'workspace-read-inactive@sohee.test.invalid'),
  ('99000000-0000-4000-8000-000000000003', 'workspace-read-no-permission@sohee.test.invalid'),
  ('99000000-0000-4000-8000-000000000004', 'workspace-read-customer@sohee.test.invalid'),
  ('99000000-0000-4000-8000-000000000006', 'workspace-read-pages@sohee.test.invalid'),
  ('99000000-0000-4000-8000-000000000008', 'workspace-read-other-all@sohee.test.invalid'),
  ('99000000-0000-4000-8000-000000000009', 'workspace-read-mfa-exempt@sohee.test.invalid');
insert into public.workspaces (id, name, created_by)
values
  ('99000000-0000-4000-8000-000000000101', 'Workspace Read A', '99000000-0000-4000-8000-000000000001'),
  ('99000000-0000-4000-8000-000000000102', 'Workspace Read B', '99000000-0000-4000-8000-000000000001');
insert into public.workspaces (id, name, created_at, created_by)
values
  ('99000000-0000-4000-8000-000000000201', 'Workspace Page A', '2026-08-22T00:00:00Z', '99000000-0000-4000-8000-000000000006'),
  ('99000000-0000-4000-8000-000000000202', 'Workspace Page B', '2026-08-22T00:00:00Z', '99000000-0000-4000-8000-000000000006'),
  ('99000000-0000-4000-8000-000000000203', 'Workspace Page C', '2026-08-22T00:00:00Z', '99000000-0000-4000-8000-000000000006'),
  ('99000000-0000-4000-8000-000000000204', 'Workspace Page D', '2026-08-22T00:00:00Z', '99000000-0000-4000-8000-000000000006');
insert into public.platform_admin_members (user_id, status)
values
  ('99000000-0000-4000-8000-000000000001', 'active'),
  ('99000000-0000-4000-8000-000000000002', 'disabled'),
  ('99000000-0000-4000-8000-000000000003', 'active');
insert into public.platform_admin_members (user_id, status)
values ('99000000-0000-4000-8000-000000000006', 'active'), ('99000000-0000-4000-8000-000000000008', 'active');
insert into public.platform_admin_members (user_id, status, mfa_required)
values ('99000000-0000-4000-8000-000000000009', 'active', false);
insert into public.platform_admin_role_assignments (user_id, role_key, workspace_id)
values
  ('99000000-0000-4000-8000-000000000001', 'operations_admin', '99000000-0000-4000-8000-000000000101'),
  ('99000000-0000-4000-8000-000000000003', 'system_admin', null);
insert into public.platform_admin_role_assignments (user_id, role_key, workspace_id)
values
  ('99000000-0000-4000-8000-000000000006', 'operations_admin', '99000000-0000-4000-8000-000000000201'),
  ('99000000-0000-4000-8000-000000000006', 'operations_admin', '99000000-0000-4000-8000-000000000202'),
  ('99000000-0000-4000-8000-000000000006', 'operations_admin', '99000000-0000-4000-8000-000000000203'),
  ('99000000-0000-4000-8000-000000000008', 'operations_admin', '99000000-0000-4000-8000-000000000101'),
  ('99000000-0000-4000-8000-000000000008', 'system_admin', null),
  ('99000000-0000-4000-8000-000000000009', 'operations_admin', '99000000-0000-4000-8000-000000000101');

create temp table task5_snapshot as
select
  (select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.workspaces row) as workspaces,
  (select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.workspace_id)::text, '[]')) from public.business_profiles row) as business_profiles,
  (select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.workspace_id, row.user_id)::text, '[]')) from public.workspace_members row) as workspace_members,
  (select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.channel_connections row) as channel_connections,
  (select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.credit_accounts row) as credit_accounts,
  (select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.credit_ledger_entries row) as credit_ledger_entries,
  (select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.credit_reservations row) as credit_reservations,
  (select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.workspace_billing_entitlements row) as workspace_billing_entitlements;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000001","aal":"aal2"}', true);
select lives_ok(
  $$select public.list_operator_workspaces(null, null, null, null, null, 50)$$,
  'active scoped operator may call the list RPC'
);
select is(
  (public.list_operator_workspaces(null, null, null, null, null, 50) -> 'items' -> 0 ->> 'workspace_id'),
  '99000000-0000-4000-8000-000000000101',
  'list RPC returns only the exact workspace.read scope'
);
select is(
  public.list_operator_workspaces() -> 'next_cursor',
  'null'::jsonb,
  'list RPC uses the null next_cursor wire value on a single page'
);
select is(
  public.list_operator_workspaces() -> 'items' -> 0 ->> 'lifecycle_status',
  null,
  'list RPC lifecycle status is literal null'
);
select is(
  public.list_operator_workspaces() -> 'items' -> 0 ->> 'agreement_status',
  'unknown',
  'list RPC agreement status is unknown'
);
select is(
  public.list_operator_workspaces() -> 'items' -> 0 ->> 'published_this_month',
  null,
  'list RPC publish count is literal null'
);
select lives_ok($$select public.list_operator_workspaces(null, null, null, '%', null, 50)$$, 'literal percent query is safe');
select lives_ok($$select public.list_operator_workspaces(null, null, null, '_', null, 50)$$, 'literal underscore query is safe');
select lives_ok($$select public.list_operator_workspaces(null, null, null, E'\\\\', null, 50)$$, 'literal backslash query is safe');
select lives_ok($$select public.list_operator_workspaces(null, null, null, chr(39), null, 50)$$, 'literal quote query is safe');
select throws_ok(
  $$select public.get_operator_workspace_detail('99000000-0000-4000-8000-000000000102'::uuid)$$,
  'OPERATOR_SCOPE_DENIED',
  'detail checks exact workspace scope before target existence'
);
select throws_ok(
  $$select public.list_operator_workspaces(null, null, null, null, 'active', 50)$$,
  'WORKSPACE_INPUT_INVALID',
  'non-null lifecycle status is rejected before reads'
);
select throws_ok(
  $$select public.list_operator_workspaces(null, null, null, null, null, 101)$$,
  'WORKSPACE_INPUT_INVALID',
  'oversized limit is rejected before reads'
);
select throws_ok(
  $$select public.list_operator_workspaces('2026-08-23T00:00:00Z'::timestamptz, null, null, null, null, 50)$$,
  'CURSOR_INVALID',
  'partial cursor is rejected before reads'
);
select throws_ok(
  $$select public.list_operator_workspaces(null, null, null, repeat('x', 121), null, 50)$$,
  'WORKSPACE_INPUT_INVALID',
  'oversized query is rejected before reads'
);
select throws_ok(
  $$select public.list_operator_workspaces('2026-08-23T00:00:00Z'::timestamptz, '99000000-0000-4000-8000-000000000101'::uuid, repeat('a', 64), null, null, 50)$$,
  'CURSOR_INVALID',
  'mismatched typed cursor fingerprint is rejected'
);
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('list_operator_workspaces', 'get_operator_workspace_detail')
      and p.prosrc ~ '\m(operation_events|get_workspace_credit_balance)\M'
  ),
  'read RPCs do not depend on operation events or credit ensure RPCs'
);
select ok(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('list_operator_workspaces', 'get_operator_workspace_detail')
      and p.prosrc ~* '\m(insert|update|delete)\M'
  ),
  'read RPCs contain no write statements'
);

select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000002","aal":"aal2"}', true);
select throws_ok(
  $$select public.list_operator_workspaces()$$,
  'OPERATOR_DISABLED',
  'disabled operator is rejected'
);
select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000003","aal":"aal2"}', true);
select throws_ok(
  $$select public.list_operator_workspaces()$$,
  'PERMISSION_DENIED',
  'active operator without workspace.read is rejected'
);
select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000001","aal":"aal1"}', true);
select throws_ok(
  $$select public.list_operator_workspaces()$$,
  'MFA_REQUIRED',
  'AAL1 operator is rejected'
);
select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000009","aal":"aal1"}', true);
select lives_ok(
  $$select public.list_operator_workspaces()$$,
  'active MFA-exempt AAL1 operator may call the read-only list RPC'
);
select lives_ok(
  $$select public.get_operator_workspace_detail('99000000-0000-4000-8000-000000000101'::uuid)$$,
  'active MFA-exempt AAL1 operator may call the scoped read-only detail RPC'
);
reset role;
select throws_ok(
  $$select private.require_current_operator_aal2_actor()$$,
  'MFA_REQUIRED',
  'high-risk AAL2 actor helper remains strict for the MFA-exempt AAL1 session'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000004","aal":"aal2"}', true);
select throws_ok(
  $$select public.list_operator_workspaces()$$,
  'OPERATOR_DISABLED',
  'customer without operator membership is denied'
);

select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000006","aal":"aal2"}', true);
create temp table task5_page as
select public.list_operator_workspaces(null, null, null, null, null, 2) as response;
select is((select jsonb_array_length(response->'items') from task5_page), 2, 'same-created_at first page returns exactly limit rows');
select ok((select response->'next_cursor' <> 'null'::jsonb from task5_page), 'same-created_at first page returns a real cursor');
create temp table task5_page2 as
select public.list_operator_workspaces(
  ((select response->'next_cursor'->>'created_at' from task5_page))::timestamptz,
  ((select response->'next_cursor'->>'id' from task5_page))::uuid,
  (select response->'next_cursor'->>'cursor_fingerprint' from task5_page),
  null, null, 2
) as response;
select is((select jsonb_array_length(response->'items') from task5_page2), 1, 'same-created_at second page returns the remaining row');
select is((select array_agg(value->>'workspace_id' order by ordinality) from task5_page, jsonb_array_elements(response->'items') with ordinality elements(value, ordinality)), array['99000000-0000-4000-8000-000000000203','99000000-0000-4000-8000-000000000202']::text[], 'first page follows exact id descending order');
select is((select array_agg(value->>'workspace_id' order by ordinality) from task5_page2, jsonb_array_elements(response->'items') with ordinality elements(value, ordinality)), array['99000000-0000-4000-8000-000000000201']::text[], 'second page follows the exact remaining id');
select is((select count(distinct value->>'workspace_id')::integer from (select jsonb_array_elements((select response->'items' from task5_page)) as value union all select jsonb_array_elements((select response->'items' from task5_page2)) as value) rows), 3, 'same-created_at pages have no duplicate or omitted workspace');
set local role service_role;
insert into public.platform_admin_role_assignments (user_id, role_key, workspace_id)
values ('99000000-0000-4000-8000-000000000006', 'operations_admin', '99000000-0000-4000-8000-000000000204');
reset role;
set local role authenticated;
select throws_ok(
  $$select public.list_operator_workspaces(((select response->'next_cursor'->>'created_at' from task5_page))::timestamptz, ((select response->'next_cursor'->>'id' from task5_page))::uuid, (select response->'next_cursor'->>'cursor_fingerprint' from task5_page), null, null, 2)$$,
  'CURSOR_INVALID',
  'scope change invalidates a real cursor fingerprint'
);
select set_config('request.jwt.claims', '{"sub":"99000000-0000-4000-8000-000000000008","aal":"aal2"}', true);
select is((public.list_operator_workspaces() -> 'items' -> 0 ->> 'workspace_id'), '99000000-0000-4000-8000-000000000101', 'other permission all does not widen workspace.read scope');
select throws_ok(
  $$select public.get_operator_workspace_detail('99000000-0000-4000-8000-000000000999'::uuid)$$,
  'OPERATOR_SCOPE_DENIED',
  'nonexistent out-of-scope detail uses the same scope denial as existing out-of-scope detail'
);

reset role;
select is((select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.workspaces row), (select workspaces from task5_snapshot), 'workspace source content has no read mutation');
select is((select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.workspace_id)::text, '[]')) from public.business_profiles row), (select business_profiles from task5_snapshot), 'business source content has no read mutation');
select is((select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.workspace_id, row.user_id)::text, '[]')) from public.workspace_members row), (select workspace_members from task5_snapshot), 'member source content has no read mutation');
select is((select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.channel_connections row), (select channel_connections from task5_snapshot), 'channel source content has no read mutation');
select is((select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.credit_accounts row), (select credit_accounts from task5_snapshot), 'credit account content is not ensured');
select is((select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.credit_ledger_entries row), (select credit_ledger_entries from task5_snapshot), 'credit ledger content has no read mutation');
select is((select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.credit_reservations row), (select credit_reservations from task5_snapshot), 'credit reservation content has no read mutation');
select is((select md5(coalesce(jsonb_agg(to_jsonb(row) order by row.id)::text, '[]')) from public.workspace_billing_entitlements row), (select workspace_billing_entitlements from task5_snapshot), 'billing entitlement content has no read mutation');

select * from finish();
rollback;
