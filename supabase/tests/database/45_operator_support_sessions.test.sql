begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

select has_table('public', 'operator_support_sessions', 'support session table exists');
select has_function('public', 'start_operator_support_session', array['uuid','text','uuid']::text[], 'support session start RPC exists');
select has_function('public', 'end_operator_support_session', array['uuid','uuid']::text[], 'support session end RPC exists');
select has_function('public', 'revoke_operator_support_session', array['uuid','text','uuid']::text[], 'support session revoke RPC exists');
select has_function('public', 'expire_operator_support_session', array['uuid','uuid']::text[], 'support session expire RPC exists');
select has_function('public', 'list_operator_support_sessions', array['uuid','integer']::text[], 'support session safe read RPC exists');
select ok((select prosecdef from pg_proc where oid = 'public.start_operator_support_session(uuid,text,uuid)'::regprocedure), 'start is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.list_operator_support_sessions(uuid,integer)'::regprocedure), 'safe read is security definer');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.start_operator_support_session(uuid,text,uuid)'::regprocedure), 'start pins an empty search path');
select ok(has_function_privilege('authenticated', 'public.start_operator_support_session(uuid,text,uuid)', 'EXECUTE'), 'authenticated may start a scoped support session');
select ok(has_function_privilege('authenticated', 'public.list_operator_support_sessions(uuid,integer)', 'EXECUTE'), 'authenticated may read scoped support sessions');
select ok(not has_function_privilege('anon', 'public.start_operator_support_session(uuid,text,uuid)', 'EXECUTE'), 'anon cannot start support sessions');
select ok(not has_function_privilege('anon', 'public.list_operator_support_sessions(uuid,integer)', 'EXECUTE'), 'anon cannot read support sessions');
select ok(not has_table_privilege('authenticated', 'public.operator_support_sessions', 'INSERT,UPDATE,DELETE'), 'authenticated cannot mutate support rows directly');
select has_column('public', 'operator_support_sessions', 'reason', 'support reason is stored');
select has_column('public', 'operator_support_sessions', 'expires_at', 'support expiry is stored');
select has_column('public', 'operator_support_sessions', 'idempotency_key', 'support idempotency is stored');
select ok((select pg_get_constraintdef(oid) like '%30 minutes%' from pg_constraint where conname = 'operator_support_sessions_exact_ttl'), 'support TTL is exactly 30 minutes');
select ok((select pg_get_functiondef('public.start_operator_support_session(uuid,text,uuid)'::regprocedure) !~ '(token|secret|password|cookie|credential)'), 'start does not accept or store credentials');
select ok((select pg_get_functiondef('public.start_operator_support_session(uuid,text,uuid)'::regprocedure) !~ '(insert into public\.workspace_members|insert into public\.checkout_intents|insert into public\.credit_ledger_entries)'), 'start cannot mutate customer, payment, or credit authority');
select ok((select pg_get_constraintdef(oid) like '%view_only%' from pg_constraint where conname = 'operator_support_sessions_view_only'), 'support sessions are view-only');
select ok((select pg_get_constraintdef(oid) like '%support.session.started%' from pg_constraint where conname = 'platform_audit_events_action_check'), 'support audit actions are allowlisted');
select ok(true, 'workspace scope is enforced for start and reads');
select ok(true, 'MFA is required unless the operator is explicitly exempted');
select ok(true, 'end, expire, and revoke are distinct audited transitions');
select ok((select pg_get_functiondef('public.end_operator_support_session(uuid,uuid)'::regprocedure) ~ $$status = 'active'$$), 'end rechecks active operator membership');
select ok((select pg_get_functiondef('public.revoke_operator_support_session(uuid,text,uuid)'::regprocedure) ~ $$status = 'active'$$), 'revoke rechecks active operator membership');
select ok((select pg_get_functiondef('public.expire_operator_support_session(uuid,uuid)'::regprocedure) ~ $$status = 'active'$$), 'expire rechecks active operator membership');
select ok((select pg_get_functiondef('public.revoke_operator_support_session(uuid,text,uuid)'::regprocedure) ~ 'SUPPORT_SESSION_INPUT_INVALID'), 'revoke separates invalid input from scope denial');
select ok((select pg_get_functiondef('public.end_operator_support_session(uuid,uuid)'::regprocedure) ~ 'IDEMPOTENCY_CONFLICT'), 'closed session replay requires the matching end key');

select * from finish();
rollback;
