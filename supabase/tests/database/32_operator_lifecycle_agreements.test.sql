begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('public', 'workspace_lifecycles', 'workspace lifecycle ledger exists');
select has_table('public', 'legal_document_versions', 'legal document version ledger exists');
select has_table('public', 'workspace_agreements', 'workspace agreement ledger exists');
select has_table('public', 'channel_delegations', 'channel delegation ledger exists');
select has_function('public', 'get_operator_onboarding_overview', array['uuid'], 'onboarding overview RPC exists');
select has_function('public', 'request_operator_workspace_activation', array['uuid', 'text', 'uuid', 'bigint'], 'activation request RPC exists');
select ok((select relrowsecurity from pg_class where oid = 'public.workspace_lifecycles'::regclass), 'lifecycle ledger has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.legal_document_versions'::regclass), 'document ledger has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.workspace_agreements'::regclass), 'agreement ledger has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.channel_delegations'::regclass), 'delegation ledger has RLS');
select ok(not has_table_privilege('anon', 'public.workspace_lifecycles', 'SELECT'), 'anon cannot read lifecycle ledger directly');
select ok(not has_table_privilege('authenticated', 'public.workspace_agreements', 'SELECT'), 'authenticated cannot read agreement ledger directly');
select ok(not has_function_privilege('public', 'public.get_operator_onboarding_overview(uuid)', 'EXECUTE'), 'PUBLIC cannot execute onboarding overview');
select ok(not has_function_privilege('service_role', 'public.get_operator_onboarding_overview(uuid)', 'EXECUTE'), 'service role cannot bypass onboarding overview');
select throws_ok($$select public.get_operator_onboarding_overview(null)$$, 'OPERATOR_UNAUTHENTICATED', 'unauthenticated onboarding reads fail closed');

insert into auth.users (id, email) values
  ('32000000-0000-4000-8000-000000000001', 'onboarding-scope@sohee.test.invalid'),
  ('32000000-0000-4000-8000-000000000002', 'onboarding-mfa@sohee.test.invalid');
insert into public.workspaces (id, name, created_by) values
  ('32000000-0000-4000-8000-000000000101', 'Onboarding Allowed', '32000000-0000-4000-8000-000000000001'),
  ('32000000-0000-4000-8000-000000000102', 'Onboarding Denied', '32000000-0000-4000-8000-000000000001');
insert into public.platform_admin_members (user_id, status, mfa_required) values
  ('32000000-0000-4000-8000-000000000001', 'active', false),
  ('32000000-0000-4000-8000-000000000002', 'active', true);
insert into public.platform_admin_role_assignments (user_id, role_key, workspace_id) values
  ('32000000-0000-4000-8000-000000000001', 'operations_admin', '32000000-0000-4000-8000-000000000101'),
  ('32000000-0000-4000-8000-000000000002', 'operations_admin', '32000000-0000-4000-8000-000000000101');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","aal":"aal1"}', true);
select lives_ok($$select public.get_operator_onboarding_overview(null)$$, 'MFA-exempt AAL1 operator may read onboarding scope');
select is(jsonb_array_length(public.get_operator_onboarding_overview(null)), 1, 'aggregate onboarding read returns only permitted workspaces');
select is(public.get_operator_onboarding_overview(null) -> 0 ->> 'workspace_id', '32000000-0000-4000-8000-000000000101', 'aggregate onboarding read preserves exact workspace scope');
select throws_ok($$select public.get_operator_onboarding_overview('32000000-0000-4000-8000-000000000102'::uuid)$$, 'OPERATOR_SCOPE_DENIED', 'explicit foreign workspace is denied');
select set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000002","aal":"aal1"}', true);
select throws_ok($$select public.get_operator_onboarding_overview(null)$$, 'MFA_REQUIRED', 'MFA-required AAL1 operator remains denied');

select * from finish();
rollback;
