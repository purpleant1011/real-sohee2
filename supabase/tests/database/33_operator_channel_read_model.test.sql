begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select function_returns('public', 'list_operator_channel_connections', array['uuid','text','text','text','text','integer'], 'jsonb', 'operator channel read RPC has exact signature');
select ok((select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_operator_channel_connections'), 'channel read RPC is security definer');
select ok((select p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='list_operator_channel_connections') = array['search_path=""']::text[], 'channel read RPC pins search_path');
select ok(not has_function_privilege('anon', 'public.list_operator_channel_connections(uuid,text,text,text,text,integer)', 'EXECUTE'), 'anon cannot execute channel read RPC');
select ok(not has_function_privilege('public', 'public.list_operator_channel_connections(uuid,text,text,text,text,integer)', 'EXECUTE'), 'PUBLIC cannot execute channel read RPC');
select ok(not has_function_privilege('service_role', 'public.list_operator_channel_connections(uuid,text,text,text,text,integer)', 'EXECUTE'), 'service role cannot bypass channel read RPC');
select ok(has_function_privilege('authenticated', 'public.list_operator_channel_connections(uuid,text,text,text,text,integer)', 'EXECUTE'), 'authenticated can execute channel read RPC');
select ok(
  pg_get_functiondef('public.list_operator_channel_connections(uuid,text,text,text,text,integer)'::regprocedure) not ilike '%external_account_id%'
  and pg_get_functiondef('public.list_operator_channel_connections(uuid,text,text,text,text,integer)'::regprocedure) not ilike '%encrypted_access_token%'
  and pg_get_functiondef('public.list_operator_channel_connections(uuid,text,text,text,text,integer)'::regprocedure) not ilike '%access_token_iv%',
  'safe projection has no secret columns'
);
select throws_ok($$select public.list_operator_channel_connections()$$, 'AUTH_REQUIRED', 'unauthenticated channel reads fail closed');

insert into auth.users (id, email)
values ('33000000-0000-4000-8000-000000000001', 'channel-filter-test@sohee.test.invalid');
insert into public.platform_admin_members (user_id, status, mfa_required)
values ('33000000-0000-4000-8000-000000000001', 'active', false);
insert into public.platform_admin_role_assignments (user_id, role_key)
values ('33000000-0000-4000-8000-000000000001', 'operations_admin');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33000000-0000-4000-8000-000000000001","aal":"aal1"}', true);
select throws_ok($$select public.list_operator_channel_connections(null, 'naver', null, null, null, 100)$$, 'CHANNEL_INPUT_INVALID', 'unsupported channel filters fail closed');

select * from finish();
rollback;
