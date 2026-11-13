begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

select has_table('public', 'channel_capabilities', 'channel capabilities exist');
select has_table('public', 'channel_profile_snapshots', 'profile snapshots exist');
select has_table('public', 'channel_profile_change_proposals', 'profile proposals exist');
select has_table('public', 'external_action_requests', 'external action requests exist');
select has_table('public', 'external_action_attempts', 'external action attempts exist');
select has_table('public', 'external_action_receipts', 'external action receipts exist');
select ok((select relrowsecurity from pg_class where oid = 'public.external_action_requests'::regclass), 'action request RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.channel_profile_snapshots'::regclass), 'profile snapshot RLS is enabled');
select hasnt_column('public', 'channel_connections', 'password', 'channel connections never contain a password column');
select hasnt_column('public', 'channel_connections', 'otp', 'channel connections never contain an OTP column');
select hasnt_column('public', 'channel_connections', 'cookie', 'channel connections never contain a cookie column');
select hasnt_column('private', 'supervised_session_references', 'password', 'protected references never contain a password column');
select hasnt_column('private', 'supervised_session_references', 'plaintext_cookie', 'protected references never contain a plaintext cookie column');
select ok(not has_table_privilege('authenticated', 'private.supervised_session_references', 'SELECT'), 'authenticated users cannot read opaque session references');
select ok(not has_table_privilege('anon', 'private.supervised_session_references', 'SELECT'), 'anonymous users cannot read opaque session references');
select has_function('public', 'save_channel_profile_snapshot', array['uuid', 'uuid', 'text', 'text', 'text', 'jsonb'], 'snapshot RPC exists');
select has_function('public', 'approve_profile_change_proposal', array['uuid', 'uuid', 'uuid', 'text'], 'profile approval RPC exists');
select has_function('public', 'claim_external_action', array['uuid', 'uuid', 'uuid', 'text'], 'action claim RPC exists');
select has_function('public', 'record_external_action_result', array['uuid', 'uuid', 'text', 'text', 'text'], 'result RPC exists');
select has_function('public', 'reconcile_external_action', array['uuid', 'uuid', 'text'], 'reconciliation RPC exists');
select ok(not has_function_privilege('authenticated', 'public.claim_external_action(uuid,uuid,uuid,text)', 'EXECUTE'), 'authenticated clients cannot claim actions directly');
select ok(not has_function_privilege('authenticated', 'public.record_external_action_result(uuid,uuid,text,text,text)', 'EXECUTE'), 'authenticated clients cannot record results directly');
select ok(has_function_privilege('service_role', 'public.claim_external_action(uuid,uuid,uuid,text)', 'EXECUTE'), 'service role may claim actions after server checks');

select * from finish();

rollback;
