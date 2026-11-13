begin;

create extension if not exists pgtap with schema extensions;

select plan(44);

select has_table('public', 'data_deletion_requests', 'data deletion requests exist');
select ok((select relrowsecurity from pg_class where oid = 'public.data_deletion_requests'::regclass), 'request RLS is enabled');
select ok(not has_table_privilege('anon', 'public.data_deletion_requests', 'SELECT'), 'anonymous users cannot read request records');
select ok(not has_table_privilege('authenticated', 'public.data_deletion_requests', 'SELECT'), 'authenticated users cannot enumerate request records');
select ok(not has_table_privilege('authenticated', 'public.data_deletion_requests', 'INSERT'), 'authenticated users cannot forge requests');
select ok(not has_table_privilege('authenticated', 'public.data_deletion_requests', 'UPDATE'), 'authenticated users cannot forge status transitions');
select has_column('public', 'data_deletion_requests', 'confirmation_code_sha256', 'only the confirmation hash is stored');
select has_index('public', 'data_deletion_requests', 'data_deletion_requests_confirmation_code_key', 'confirmation hashes are unique');
select has_function('public', 'create_data_deletion_request', array['uuid', 'uuid', 'text', 'text'], 'authenticated request RPC exists');
select has_function('public', 'request_meta_data_deletion', array['text', 'text', 'text'], 'Meta request RPC exists');
select has_function('public', 'get_data_deletion_request_status', array['text'], 'public-safe status RPC exists');
select has_function('public', 'claim_data_deletion_request', array['uuid'], 'operator claim RPC exists');
select has_function('public', 'resolve_data_deletion_request', array['uuid', 'text'], 'operator resolution RPC exists');
select ok(has_function_privilege('service_role', 'public.create_data_deletion_request(uuid,uuid,text,text)', 'EXECUTE'), 'service role may create an authenticated request');
select ok(not has_function_privilege('authenticated', 'public.create_data_deletion_request(uuid,uuid,text,text)', 'EXECUTE'), 'authenticated clients cannot bypass the server boundary');
select ok(has_function_privilege('service_role', 'public.request_meta_data_deletion(text,text,text)', 'EXECUTE'), 'service role may process a signed Meta request');
select ok(not has_function_privilege('anon', 'public.get_data_deletion_request_status(text)', 'EXECUTE'), 'anonymous clients cannot query Supabase directly');
select ok(not has_function_privilege('authenticated', 'public.get_data_deletion_request_status(text)', 'EXECUTE'), 'authenticated clients use the server status endpoint');
select ok(has_function_privilege('service_role', 'public.claim_data_deletion_request(uuid)', 'EXECUTE'), 'service role may claim a request');
select ok(not has_function_privilege('authenticated', 'public.resolve_data_deletion_request(uuid,text)', 'EXECUTE'), 'authenticated clients cannot resolve requests');

insert into auth.users (id, email)
values
  ('15000000-0000-4000-8000-000000000001', 'deletion-owner@sohee.test.invalid'),
  ('15000000-0000-4000-8000-000000000002', 'deletion-viewer@sohee.test.invalid'),
  ('15000000-0000-4000-8000-000000000003', 'deletion-outsider@sohee.test.invalid');

insert into public.workspaces (id, name, created_by)
values ('25000000-0000-4000-8000-000000000001', '삭제 경계 검증', '15000000-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role, status)
values ('25000000-0000-4000-8000-000000000001', '15000000-0000-4000-8000-000000000002', 'viewer', 'active');

set local role service_role;

select lives_ok($$
  select public.create_data_deletion_request(
    '25000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000001',
    'workspace', repeat('a', 64)
  )
$$, 'owner may request full workspace deletion');

select lives_ok($$
  select public.create_data_deletion_request(
    '25000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000002',
    'member', repeat('b', 64)
  )
$$, 'active viewer may request their own linked data deletion');

select throws_ok($$
  select public.create_data_deletion_request(
    '25000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000002',
    'workspace', repeat('c', 64)
  )
$$, 'P0001', 'DATA_DELETION_FORBIDDEN', 'non-owner cannot request workspace deletion');

select throws_ok($$
  select public.create_data_deletion_request(
    '25000000-0000-4000-8000-000000000001',
    '15000000-0000-4000-8000-000000000003',
    'member', repeat('d', 64)
  )
$$, 'P0001', 'DATA_DELETION_FORBIDDEN', 'outsider cannot request another workspace deletion');

select is((select count(*)::integer from public.data_deletion_requests where confirmation_code_sha256 = repeat('a', 64)), 1, 'owner request is persisted once');
select is((select count(*)::integer from public.data_deletion_requests where confirmation_code_sha256 = repeat('b', 64)), 1, 'member request is persisted once');
select ok(exists(
  select 1 from public.data_deletion_requests
  where workspace_id = '25000000-0000-4000-8000-000000000001'
    and requested_by_user_id = '15000000-0000-4000-8000-000000000001'
    and scope = 'workspace'
), 'request retains the minimum actor and workspace processing boundary');

select is(public.claim_data_deletion_request((select id from public.data_deletion_requests where confirmation_code_sha256 = repeat('a', 64))), true, 'operator claims a pending request');
select is((select status from public.get_data_deletion_request_status(repeat('a', 64))), 'in_progress', 'status lookup reports the stored in-progress state');
select is(public.resolve_data_deletion_request((select id from public.data_deletion_requests where confirmation_code_sha256 = repeat('a', 64)), 'completed'), true, 'operator completes a claimed request');
select is((select status from public.get_data_deletion_request_status(repeat('a', 64))), 'completed', 'status lookup reports the stored completed state');
select ok((select completed_at is not null from public.data_deletion_requests where confirmation_code_sha256 = repeat('a', 64)), 'completion time is retained');

reset role;

insert into public.channel_connections (
  id, workspace_id, channel, status, account_label, external_account_id
) values (
  '35000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  'instagram', 'connected', '@deletion-test', 'meta-account-delete-me'
);

insert into public.meta_channel_credentials (
  id, workspace_id, channel_connection_id, provider,
  encrypted_access_token, access_token_iv
) values (
  '45000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'instagram', repeat('x', 24), repeat('i', 16)
);

insert into public.provider_webhook_events (
  id, workspace_id, channel_connection_id, provider, category, event_key,
  provider_event_id, external_subject_id, payload, payload_sha256, occurred_at
) values (
  '55000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '35000000-0000-4000-8000-000000000001',
  'instagram', 'dm', 'data-deletion:dm:1', 'dm-delete-me', 'meta-account-delete-me',
  '{"message":{"text":"delete me"}}'::jsonb, repeat('e', 64), statement_timestamp()
);

set local role service_role;

select lives_ok($$
  select public.request_meta_data_deletion(
    'instagram', 'meta-account-delete-me', repeat('f', 64)
  )
$$, 'signed Meta request is queued without changing the provider connection');

reset role;

select is((select status from public.channel_connections where id = '35000000-0000-4000-8000-000000000001'), 'connected', 'Meta request preserves the provider connection');
select is((select external_account_id from public.channel_connections where id = '35000000-0000-4000-8000-000000000001'), 'meta-account-delete-me', 'raw external account identity stays attached to the connection');
select is((select count(*)::integer from public.meta_channel_credentials where channel_connection_id = '35000000-0000-4000-8000-000000000001'), 1, 'stored provider credentials are preserved');
select is((select count(*)::integer from public.provider_webhook_events where channel_connection_id = '35000000-0000-4000-8000-000000000001'), 1, 'stored provider events are preserved');
select is((select status from public.data_deletion_requests where confirmation_code_sha256 = repeat('f', 64)), 'pending', 'Meta request waits for manual review');
select is((select workspace_id from public.data_deletion_requests where confirmation_code_sha256 = repeat('f', 64)), '25000000-0000-4000-8000-000000000001'::uuid, 'Meta request retains its workspace processing boundary');
select is((select request_origin from public.data_deletion_requests where confirmation_code_sha256 = repeat('f', 64)), 'meta', 'Meta origin is distinguishable');
select is((select char_length(external_subject_sha256) from public.data_deletion_requests where confirmation_code_sha256 = repeat('f', 64)), 64, 'only a provider subject hash is retained');
select is((select count(*)::integer from public.get_data_deletion_request_status(repeat('0', 64))), 0, 'unknown confirmation hash has no status');
select is((select status from public.get_data_deletion_request_status(repeat('f', 64))), 'pending', 'Meta confirmation lookup returns the queued state');
select ok(not exists(
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'data_deletion_requests'
    and column_name = 'external_account_id'
), 'request records have no raw external account column');

reset role;

select * from finish();
rollback;
