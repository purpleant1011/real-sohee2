-- Security Contract Test: 28_security_execution_matrix.test.sql
-- linear issue: ANI-1016

begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

-- 1. Verify RLS is enabled on all critical tables
select table_has_rls('public', 'agent_sessions', 'agent_sessions has RLS enabled');
select table_has_rls('public', 'agent_approvals', 'agent_approvals has RLS enabled');
select table_has_rls('public', 'external_action_requests', 'external_action_requests has RLS enabled');
select table_has_rls('public', 'external_action_attempts', 'external_action_attempts has RLS enabled');
select table_has_rls('public', 'external_action_receipts', 'external_action_receipts has RLS enabled');
select table_has_rls('public', 'channel_consents', 'channel_consents has RLS enabled');
select table_has_rls('public', 'channel_credentials', 'channel_credentials has RLS enabled');

-- 2. Verify privileged functions revoke execution from public / anon
select has_function('public', 'complete_channel_verification_v12');
select function_privs_are(
  'public',
  'complete_channel_verification_v12',
  ARRAY['uuid', 'text', 'uuid', 'text', 'text', 'text', 'uuid'],
  'service_role',
  ARRAY['EXECUTE'],
  'complete_channel_verification_v12 is only executable by service_role'
);

select * from finish();
rollback;
