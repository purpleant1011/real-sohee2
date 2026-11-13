begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select has_function(
  'private',
  'prevent_credit_ledger_mutation',
  array[]::text[],
  'credit ledger mutation guard exists'
);
select ok(
  not has_function_privilege('public', 'private.prevent_credit_ledger_mutation()', 'EXECUTE'),
  'PUBLIC cannot execute the ledger mutation guard directly'
);
select ok(
  not has_function_privilege('anon', 'private.prevent_credit_ledger_mutation()', 'EXECUTE'),
  'anon cannot execute the ledger mutation guard directly'
);
select ok(
  not has_function_privilege('authenticated', 'private.prevent_credit_ledger_mutation()', 'EXECUTE'),
  'authenticated cannot execute the ledger mutation guard directly'
);
select ok(
  not has_function_privilege('service_role', 'private.prevent_credit_ledger_mutation()', 'EXECUTE'),
  'service role cannot execute the ledger mutation guard directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.workspaces', 'DELETE'),
  'authenticated callers cannot delete workspaces'
);

insert into auth.users (id, email) values
  ('30000000-0000-4000-8000-000000000001', 'ledger-cascade-owner@sohee.test.invalid'),
  ('30000000-0000-4000-8000-000000000002', 'ledger-cascade-outsider@sohee.test.invalid');

insert into public.workspaces (id, name, created_by) values
  ('31000000-0000-4000-8000-000000000001', '원장 연쇄 삭제 대상', '30000000-0000-4000-8000-000000000001'),
  ('31000000-0000-4000-8000-000000000002', '원장 연쇄 삭제 제어', '30000000-0000-4000-8000-000000000001');

insert into public.credit_ledger_entries (
  id, workspace_id, account_id, kind, amount, idempotency_key
)
select
  v.id,
  v.workspace_id,
  account.id,
  'adjustment',
  7,
  v.idempotency_key
from (
  values
    ('32000000-0000-4000-8000-000000000001'::uuid, '31000000-0000-4000-8000-000000000001'::uuid, 'ledger-cascade-target'),
    ('32000000-0000-4000-8000-000000000002'::uuid, '31000000-0000-4000-8000-000000000002'::uuid, 'ledger-cascade-control')
) as v(id, workspace_id, idempotency_key)
join public.credit_accounts as account on account.workspace_id = v.workspace_id;

select is(
  (select count(*)::integer from public.credit_ledger_entries where kind = 'adjustment' and workspace_id in (
    '31000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000002'
  )),
  2,
  'target and control workspaces each have one ledger row'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$update public.credit_ledger_entries set amount = 99 where workspace_id = '31000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table credit_ledger_entries',
  'authenticated callers cannot update ledger rows directly'
);
select throws_ok(
  $$delete from public.credit_ledger_entries where workspace_id = '31000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table credit_ledger_entries',
  'authenticated callers cannot delete ledger rows directly'
);
select throws_ok(
  $$delete from public.workspaces where id = '31000000-0000-4000-8000-000000000001'$$,
  '42501',
  'permission denied for table workspaces',
  'authenticated callers cannot delete a workspace directly'
);

set local role postgres;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$delete from public.workspaces where id = '31000000-0000-4000-8000-000000000001'$$,
  'a trusted service role can delete a workspace and its dependent ledger'
);

select is(
  (select count(*)::integer from public.workspaces where id = '31000000-0000-4000-8000-000000000001'),
  0,
  'the target workspace is deleted'
);
select is(
  (select count(*)::integer from public.credit_ledger_entries where workspace_id = '31000000-0000-4000-8000-000000000001'),
  0,
  'the target workspace ledger rows are deleted by cascade'
);
select is(
  (select count(*)::integer from public.credit_accounts where workspace_id = '31000000-0000-4000-8000-000000000001'),
  0,
  'the target workspace credit account is deleted by cascade'
);
select is(
  (select count(*)::integer from public.workspace_members where workspace_id = '31000000-0000-4000-8000-000000000001'),
  0,
  'the target workspace members are deleted by cascade'
);

select is(
  (select count(*)::integer from public.workspaces where id = '31000000-0000-4000-8000-000000000002'),
  1,
  'the control workspace remains'
);
select is(
  (select count(*)::integer from public.credit_ledger_entries where workspace_id = '31000000-0000-4000-8000-000000000002'),
  2,
  'the control workspace ledger remains unchanged'
);
select is(
  (select amount from public.credit_ledger_entries where workspace_id = '31000000-0000-4000-8000-000000000002' and kind = 'adjustment'),
  7,
  'the control workspace ledger amount remains unchanged'
);
select is(
  (select count(*)::integer from public.credit_accounts where workspace_id = '31000000-0000-4000-8000-000000000002'),
  1,
  'the control workspace credit account remains'
);
select is(
  (select count(*)::integer from public.workspace_members where workspace_id = '31000000-0000-4000-8000-000000000002'),
  1,
  'the control workspace member remains'
);

select throws_ok(
  $$delete from public.credit_ledger_entries where workspace_id = '31000000-0000-4000-8000-000000000002'$$,
  'P0001',
  'CREDIT_LEDGER_APPEND_ONLY',
  'trusted direct ledger deletes remain blocked while the parent workspace exists'
);
select throws_ok(
  $$update public.credit_ledger_entries set amount = 99 where workspace_id = '31000000-0000-4000-8000-000000000002'$$,
  'P0001',
  'CREDIT_LEDGER_APPEND_ONLY',
  'trusted direct ledger updates remain blocked'
);

rollback;
