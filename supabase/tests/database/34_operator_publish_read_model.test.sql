begin;
select plan(14);

select has_function(
  'public',
  'list_operator_publish_operations',
  array['timestamptz', 'uuid', 'text', 'uuid', 'text', 'integer'],
  'operator publish read RPC exists with the exact cursor and scope signature'
);
select ok(has_function_privilege(
  'authenticated',
  'public.list_operator_publish_operations(timestamptz,uuid,text,uuid,text,integer)',
  'EXECUTE'
), 'authenticated operators can execute the publish read RPC');
select ok(not has_function_privilege(
  'anon',
  'public.list_operator_publish_operations(timestamptz,uuid,text,uuid,text,integer)',
  'EXECUTE'
), 'anonymous users cannot execute the publish read RPC');
select ok(not has_function_privilege(
  'service_role',
  'public.list_operator_publish_operations(timestamptz,uuid,text,uuid,text,integer)',
  'EXECUTE'
), 'service role cannot bypass the operator read boundary');
select ok(not has_function_privilege(
  'public',
  'public.list_operator_publish_operations(timestamptz,uuid,text,uuid,text,integer)',
  'EXECUTE'
), 'PUBLIC cannot execute the publish read RPC');
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'list_operator_publish_operations'
   and pg_get_function_identity_arguments(p.oid) = 'p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_cursor_fingerprint text, p_workspace_id uuid, p_status text, p_limit integer'),
  'publish read RPC is security definer'
);
select ok(to_regclass('public.content_items') is not null, 'content evidence source exists');
select ok(to_regclass('public.content_versions') is not null, 'version evidence source exists');
select ok(to_regclass('public.approvals') is not null, 'approval evidence source exists');
select ok(to_regclass('public.publish_attempts') is not null, 'attempt evidence source exists');
select ok(
  pg_get_functiondef('public.list_operator_publish_operations(timestamptz,uuid,text,uuid,text,integer)'::regprocedure)
    ilike '%''fingerprint_match'', coalesce(%',
  'publish rows normalize missing approval evidence to fingerprint_match false instead of null'
);
select throws_ok($$select public.list_operator_publish_operations()$$, 'AUTH_REQUIRED', 'unauthenticated publish reads fail closed');

insert into auth.users (id, email) values
  ('34000000-0000-4000-8000-000000000001', 'publish-mfa-exempt@sohee.test.invalid'),
  ('34000000-0000-4000-8000-000000000002', 'publish-mfa-required@sohee.test.invalid');
insert into public.platform_admin_members (user_id, status, mfa_required) values
  ('34000000-0000-4000-8000-000000000001', 'active', false),
  ('34000000-0000-4000-8000-000000000002', 'active', true);
insert into public.platform_admin_role_assignments (user_id, role_key) values
  ('34000000-0000-4000-8000-000000000001', 'operations_admin'),
  ('34000000-0000-4000-8000-000000000002', 'operations_admin');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-000000000001","aal":"aal1"}', true);
select lives_ok($$select public.list_operator_publish_operations()$$, 'MFA-exempt AAL1 operator may read publishing operations');
select set_config('request.jwt.claims', '{"sub":"34000000-0000-4000-8000-000000000002","aal":"aal1"}', true);
select throws_ok($$select public.list_operator_publish_operations()$$, 'MFA_REQUIRED', 'MFA-required AAL1 operator remains denied');

select * from finish();
rollback;
