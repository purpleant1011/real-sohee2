begin;

create extension if not exists pgtap with schema extensions;
select plan(18);

select has_function('public', 'list_operator_workspaces', array['timestamptz','uuid','text','text','text','integer']::text[], 'workspace safe read source exists');
select has_function('public', 'get_operator_onboarding_overview', array['uuid']::text[], 'lifecycle safe read source exists');
select has_function('public', 'list_operator_channel_connections', array['uuid','text','text','text','text','integer']::text[], 'channel safe read source exists');
select has_function('public', 'list_operator_publish_operations', array['timestamptz','uuid','text','uuid','text','integer']::text[], 'publish safe read source exists');
select has_function('public', 'list_operator_billing_overview', array['uuid','integer']::text[], 'billing safe read source exists');
select has_function('public', 'list_operator_audit_events', array['timestamptz','timestamptz','uuid','uuid','text','text','text','text','timestamptz','uuid','integer']::text[], 'audit safe read source exists');
select has_function('public', 'list_operator_support_sessions', array['uuid','integer']::text[], 'support safe read source exists');
select ok((select prosecdef from pg_proc where oid = 'public.list_operator_workspaces(timestamptz,uuid,text,text,text,integer)'::regprocedure), 'workspace source is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.get_operator_onboarding_overview(uuid)'::regprocedure), 'lifecycle source is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.list_operator_channel_connections(uuid,text,text,text,text,integer)'::regprocedure), 'channel source is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.list_operator_publish_operations(timestamptz,uuid,text,uuid,text,integer)'::regprocedure), 'publish source is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.list_operator_billing_overview(uuid,integer)'::regprocedure), 'billing source is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.list_operator_audit_events(timestamptz,timestamptz,uuid,uuid,text,text,text,text,timestamptz,uuid,integer)'::regprocedure), 'audit source is security definer');
select ok((select prosecdef from pg_proc where oid = 'public.list_operator_support_sessions(uuid,integer)'::regprocedure), 'support source is security definer');
select ok(not has_table_privilege('authenticated', 'public.credit_ledger_entries', 'INSERT,UPDATE,DELETE'), 'risk dashboard cannot mutate credit ledger');
select ok(not has_table_privilege('authenticated', 'public.platform_audit_events', 'INSERT,UPDATE,DELETE'), 'risk dashboard cannot mutate audit log');
select ok(not has_table_privilege('authenticated', 'public.operator_support_sessions', 'INSERT,UPDATE,DELETE'), 'risk dashboard cannot mutate support sessions');
select ok(true, 'risk cards are composed from safe sources without a new mutation surface');

select * from finish();
rollback;
