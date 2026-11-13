begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

select has_table('public', 'billing_plan_entitlement_versions', 'versioned billing plan entitlements exist');
select has_table('public', 'workspace_billing_entitlements', 'workspace billing entitlements exist');
select has_function(
  'private', 'ensure_workspace_weekly_entitlement', array['uuid', 'timestamp with time zone'],
  'server-only weekly entitlement function exists'
);

select is((select weekly_credits from public.billing_plan_entitlement_versions where policy_version = 'v08-commercial-token-1' and plan_code = 'starter'), 300, 'starter receives 300 weekly credits');
select is((select weekly_credits from public.billing_plan_entitlement_versions where policy_version = 'v08-commercial-token-1' and plan_code = 'growth'), 2000, 'growth receives 2000 weekly credits');
select is((select weekly_credits from public.billing_plan_entitlement_versions where policy_version = 'v08-commercial-token-1' and plan_code = 'operations'), 5000, 'operations receives 5000 weekly credits');
select is((select weekly_credits from public.billing_plan_entitlement_versions where policy_version = 'v08-commercial-token-1' and plan_code = 'focus'), 10000, 'focus receives 10000 weekly credits');
select is(
  (select array_agg(included_credits order by monthly_price_krw) from public.billing_plans),
  array[300, 2000, 5000, 10000],
  'billing plans expose the approved weekly entitlements'
);
select is(
  (select count(*)::integer from public.billing_plan_entitlement_versions where policy_version = 'v08-commercial-token-1' and policy_status = 'active'),
  4,
  'all four commercial policy rows are active'
);

select ok((select relrowsecurity from pg_class where oid = 'public.billing_plan_entitlement_versions'::regclass), 'plan entitlement RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.workspace_billing_entitlements'::regclass), 'workspace entitlement RLS is enabled');
select ok(not has_table_privilege('authenticated', 'public.billing_plan_entitlement_versions', 'INSERT'), 'authenticated cannot insert plan entitlements');
select ok(not has_table_privilege('authenticated', 'public.workspace_billing_entitlements', 'INSERT'), 'authenticated cannot activate workspace entitlements');
select ok(not has_table_privilege('authenticated', 'public.workspace_billing_entitlements', 'UPDATE'), 'authenticated cannot update workspace entitlements');
select ok(not has_function_privilege('authenticated', 'private.ensure_workspace_weekly_entitlement(uuid,timestamptz)', 'EXECUTE'), 'authenticated cannot grant weekly credits');
select ok(has_function_privilege('service_role', 'private.ensure_workspace_weekly_entitlement(uuid,timestamptz)', 'EXECUTE'), 'service role can ensure weekly credits');

insert into auth.users (id, email) values
  ('1b000000-0000-4000-8000-000000000001', 'commercial-credit-owner@sohee.test.invalid');

insert into public.workspaces (id, name, created_by, created_at)
values (
  '2b000000-0000-4000-8000-000000000001',
  '상용 크레딧 검증',
  '1b000000-0000-4000-8000-000000000001',
  '2026-08-23T01:00:00+09:00'
);

insert into public.checkout_intents (
  id, workspace_id, billing_plan_id, idempotency_key, state
) values (
  '3b000000-0000-4000-8000-000000000001',
  '2b000000-0000-4000-8000-000000000001',
  '88000000-0000-4000-8000-000000000004',
  'commercial-credit-provider-pending',
  'provider_pending'
);

select is(
  (select count(*)::integer from public.workspace_billing_entitlements where workspace_id = '2b000000-0000-4000-8000-000000000001'),
  0,
  'provider pending checkout does not activate an entitlement'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000001', true);

select is(
  (public.get_workspace_credit_balance('2b000000-0000-4000-8000-000000000001') ->> 'weeklyLimit')::integer,
  2000,
  'the current test account keeps its 2000 weekly limit'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into public.workspace_billing_entitlements (
  workspace_id, plan_code, policy_version, state, effective_from, source_reference
) values (
  '2b000000-0000-4000-8000-000000000001',
  'operations',
  'v08-commercial-token-1',
  'active',
  '2026-08-24T00:00:00+09:00',
  'manual-test-activation'
);

select is(
  private.ensure_workspace_weekly_entitlement(
    '2b000000-0000-4000-8000-000000000001', '2026-08-31T01:00:00+09:00'
  ),
  private.ensure_workspace_weekly_entitlement(
    '2b000000-0000-4000-8000-000000000001', '2026-08-31T01:00:00+09:00'
  ),
  'commercial weekly entitlement creation is idempotent'
);

select is(
  (
    select coalesce(sum(amount) filter (where kind in ('grant', 'adjustment')), 0)::integer
    from public.credit_ledger_entries
    where workspace_id = '2b000000-0000-4000-8000-000000000001'
      and account_id = private.ensure_workspace_weekly_entitlement(
        '2b000000-0000-4000-8000-000000000001', '2026-08-31T01:00:00+09:00'
      )
  ),
  5000,
  'operations receives exactly 5000 credits in the next commercial week'
);

select is(
  (
    select timezone
    from public.credit_accounts
    where id = private.ensure_workspace_weekly_entitlement(
      '2b000000-0000-4000-8000-000000000001', '2026-08-31T01:00:00+09:00'
    )
  ),
  'Asia/Seoul',
  'commercial credits retain the Asia Seoul weekly boundary'
);

select is(
  (
    select count(*)::integer
    from public.credit_ledger_entries
    where workspace_id = '2b000000-0000-4000-8000-000000000001'
      and account_id = private.ensure_workspace_weekly_entitlement(
        '2b000000-0000-4000-8000-000000000001', '2026-08-31T01:00:00+09:00'
      )
      and kind = 'grant'
  ),
  1,
  'commercial weekly account receives one grant row'
);

select is(
  (select count(*)::integer from public.workspace_billing_entitlements where workspace_id = '2b000000-0000-4000-8000-000000000001' and state = 'active'),
  1,
  'workspace has one active entitlement row'
);

reset role;

select throws_ok(
  $$update public.billing_plan_entitlement_versions set weekly_credits = 999 where policy_version = 'v08-commercial-token-1' and plan_code = 'starter'$$,
  'P0001', 'CREDIT_ENTITLEMENT_VERSION_IMMUTABLE',
  'published entitlement versions cannot be rewritten'
);

select throws_ok(
  $$delete from public.billing_plan_entitlement_versions where policy_version = 'v08-commercial-token-1' and plan_code = 'starter'$$,
  'P0001', 'CREDIT_ENTITLEMENT_VERSION_IMMUTABLE',
  'published entitlement versions cannot be deleted'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '1b000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$insert into public.workspace_billing_entitlements (workspace_id, plan_code, policy_version, state, effective_from, source_reference) values ('2b000000-0000-4000-8000-000000000001','focus','v08-commercial-token-1','active',now(),'forbidden')$$,
  '42501', 'permission denied for table workspace_billing_entitlements',
  'workspace member cannot activate a plan directly'
);

select is(
  (select count(*)::integer from public.workspace_billing_entitlements where workspace_id = '2b000000-0000-4000-8000-000000000001'),
  1,
  'forbidden activation leaves the authoritative entitlement unchanged'
);

select * from finish();
rollback;
