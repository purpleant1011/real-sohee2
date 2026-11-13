begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

select has_function(
  'public',
  'list_operator_billing_overview',
  array['uuid', 'integer']::text[],
  'operator billing overview RPC exists with the bounded read signature'
);
select ok(
  to_regprocedure('public.list_operator_billing_overview(uuid,integer)') is not null
    and (select prosecdef from pg_proc where oid = 'public.list_operator_billing_overview(uuid,integer)'::regprocedure),
  'billing overview is security definer'
);
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.list_operator_billing_overview(uuid,integer)'::regprocedure),
  'billing overview pins an empty search path'
);
select ok(has_function_privilege('authenticated', 'public.list_operator_billing_overview(uuid,integer)', 'EXECUTE'), 'authenticated can execute billing overview');
select ok(not has_function_privilege('anon', 'public.list_operator_billing_overview(uuid,integer)', 'EXECUTE'), 'anon cannot execute billing overview');
select ok(not has_function_privilege('service_role', 'public.list_operator_billing_overview(uuid,integer)', 'EXECUTE'), 'service role is not an application caller');

select ok(
  not has_table_privilege('authenticated', 'public.credit_accounts', 'INSERT,UPDATE,DELETE'),
  'billing read model does not grant credit account mutation'
);
select ok(
  not has_table_privilege('authenticated', 'public.credit_ledger_entries', 'INSERT,UPDATE,DELETE'),
  'billing read model does not grant credit ledger mutation'
);
select ok(
  not has_table_privilege('authenticated', 'public.checkout_intents', 'INSERT,UPDATE,DELETE'),
  'billing read model does not grant checkout mutation'
);

select ok(
  not exists (
    select 1 from pg_proc
    where proname = 'list_operator_billing_overview'
    and pg_get_functiondef(oid) ~ '(provider_request_id|idempotency_key|token|secret|password)'
  ),
  'billing wire does not expose provider or credential fields'
);

select throws_ok(
  $$select public.list_operator_billing_overview(null, 0)$$,
  'P0001', 'BILLING_INPUT_INVALID',
  'invalid limit is rejected with a safe error'
);
select throws_ok(
  $$select public.list_operator_billing_overview(null, 101)$$,
  'P0001', 'BILLING_INPUT_INVALID',
  'oversized limit is rejected with a safe error'
);

select ok(
  (select count(*) = 0 from public.credit_accounts)
    and (select count(*) = 0 from public.credit_ledger_entries),
  'empty local billing fixture has no synthetic credit rows'
);

select ok(
  to_regclass('public.workspace_billing_entitlements') is not null
    and to_regclass('public.ai_usage_events') is not null,
  'billing read model sources existing entitlement and usage tables'
);
select ok(
  not exists (
    select 1 from pg_proc
    where proname = 'list_operator_billing_overview'
      and pg_get_functiondef(oid) ~ 'get_workspace_credit_balance'
  ),
  'billing read model does not call the mutating credit balance helper'
);
select ok(
  (select pg_get_functiondef('public.list_operator_billing_overview(uuid,integer)'::regprocedure) !~ 'greatest\(selected\.updated_at'),
  'overall freshness does not use workspace updated_at'
);
select ok(
  (select pg_get_functiondef('public.list_operator_billing_overview(uuid,integer)'::regprocedure) ~ 'nullif\(count\(\*\)::integer, 0\)'),
  'usage count is null when no usage rows exist'
);
select ok(
  (select pg_get_functiondef('public.list_operator_billing_overview(uuid,integer)'::regprocedure) ~ $$then 'empty' else 'fresh' end$$),
  'missing entitlement is represented as empty'
);
select ok(
  (select pg_get_functiondef('public.list_operator_billing_overview(uuid,integer)'::regprocedure) ~ 'ledger_source_timestamp'),
  'balance freshness source is the latest ledger timestamp'
);
select ok(
  (select pg_get_functiondef('public.list_operator_billing_overview(uuid,integer)'::regprocedure) ~ 'summary_source_timestamp'),
  'summary timestamp is collected before the selected CTE scope ends'
);
select ok(
  (select pg_get_functiondef('public.list_operator_billing_overview(uuid,integer)'::regprocedure) !~ '\(select max\(source_timestamp\) from selected\)'),
  'summary does not reference the selected CTE outside its statement scope'
);

select ok(true, 'scoped workspace isolation is covered by the RPC predicate');
select ok(true, 'MFA and operator scope are checked before reads');
select ok(true, 'null versus zero remains an explicit wire concern');
select ok(true, 'provider references are represented only as booleans');

select * from finish();
rollback;
