begin;

create extension if not exists pgtap with schema extensions;

select plan(61);

select has_table('public', 'credit_ledger_entries', 'credit ledger exists');
select has_table('public', 'content_plans', 'period content plans exist');
select has_table('public', 'checkout_intents', 'checkout intents exist');
select has_function(
  'public', 'reserve_workspace_credits',
  array['uuid', 'text', 'integer', 'text', 'uuid'],
  'credit reserve RPC has the stable signature'
);
select has_function('public', 'list_checkout_intents', array['uuid', 'text', 'integer'], 'checkout history RPC exists');
select ok(not has_function_privilege('anon', 'public.list_checkout_intents(uuid,text,integer)', 'EXECUTE'), 'anon cannot read checkout history');
select ok(not has_function_privilege('public', 'public.list_checkout_intents(uuid,text,integer)', 'EXECUTE'), 'PUBLIC cannot read checkout history');
select ok(has_function_privilege('authenticated', 'public.list_checkout_intents(uuid,text,integer)', 'EXECUTE'), 'authenticated may invoke workspace-scoped checkout history');
select has_function(
  'public', 'settle_credit_reservation',
  array['uuid', 'uuid', 'integer', 'text'],
  'credit settle RPC exists'
);
select has_function(
  'public', 'release_credit_reservation',
  array['uuid', 'uuid', 'integer', 'text'],
  'credit release RPC exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.credit_ledger_entries'::regclass),
  'credit ledger RLS is enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.credit_ledger_entries', 'UPDATE'),
  'authenticated callers cannot update ledger rows'
);
select ok(not has_function_privilege('authenticated', 'public.reserve_workspace_credits(uuid,text,integer,text,uuid)', 'EXECUTE'), 'authenticated callers cannot reserve credits directly');
select ok(has_function_privilege('service_role', 'public.reserve_workspace_credits(uuid,text,integer,text,uuid)', 'EXECUTE'), 'service role can reserve credits');
select ok(not has_function_privilege('authenticated', 'public.settle_credit_reservation(uuid,uuid,integer,text)', 'EXECUTE'), 'authenticated callers cannot settle credits directly');
select ok(has_function_privilege('service_role', 'public.settle_credit_reservation(uuid,uuid,integer,text)', 'EXECUTE'), 'service role can settle credits');
select ok(not has_function_privilege('authenticated', 'public.release_credit_reservation(uuid,uuid,integer,text)', 'EXECUTE'), 'authenticated callers cannot release credits directly');
select ok(has_function_privilege('service_role', 'public.release_credit_reservation(uuid,uuid,integer,text)', 'EXECUTE'), 'service role can release credits');
select ok(has_function_privilege('authenticated', 'public.get_workspace_credit_balance(uuid)', 'EXECUTE'), 'authenticated callers can read a credit balance');
select ok(has_function_privilege('authenticated', 'public.list_workspace_credit_ledger(uuid,text,integer)', 'EXECUTE'), 'authenticated callers can list the credit ledger');

insert into auth.users (id, email) values
  ('17000000-0000-4000-8000-000000000001', 'credit-owner@sohee.test.invalid'),
  ('17000000-0000-4000-8000-000000000002', 'credit-outsider@sohee.test.invalid');

insert into public.workspaces (id, name, created_by)
values ('27000000-0000-4000-8000-000000000001', '크레딧 원장 검증', '17000000-0000-4000-8000-000000000001');

select is(
  (select count(*)::integer from public.credit_accounts where workspace_id = '27000000-0000-4000-8000-000000000001'),
  1,
  'a new workspace receives one current preview credit account'
);
select is(
  (select amount from public.credit_ledger_entries where workspace_id = '27000000-0000-4000-8000-000000000001' and kind = 'grant'),
  2000,
  'a new workspace receives the 2000-credit test grant'
);
select is(
  (select timezone from public.credit_accounts where workspace_id = '27000000-0000-4000-8000-000000000001'),
  'Asia/Seoul',
  'the preview account uses the Asia/Seoul weekly boundary'
);
select is(
  (select rates ->> 'policyVersion' from public.credit_rate_versions where catalog_version = 8001),
  'v08-preview-1',
  'the credit catalog records the explicit preview policy version'
);
select is(
  (select policy_status from public.credit_rate_versions where catalog_version = 8001),
  'draft',
  'the preview credit catalog remains draft rather than commercial pricing'
);
select is(
  (select count(*)::integer from public.billing_plans where included_credits is not null),
  4,
  'all billing plans expose approved weekly credit amounts'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000001', true);

select is(
  (public.get_workspace_credit_balance('27000000-0000-4000-8000-000000000001') ->> 'available')::integer,
  2000,
  'the current test period starts with 2000 available credits'
);

select throws_ok(
  $$update public.credit_ledger_entries set amount = 999 where true$$,
  '42501', 'permission denied for table credit_ledger_entries',
  'ledger rows cannot be changed by a workspace member'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000002', true);

reset role;
select ok(
  not private.is_workspace_member('27000000-0000-4000-8000-000000000001'),
  'service role does not broaden the global workspace membership helper'
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000002', true);
select is(
  (public.reserve_workspace_credits(
    '27000000-0000-4000-8000-000000000001', 'text_generation', 40,
    '27000000-0000-4000-8000-000000000001:reserve-1',
    '47000000-0000-4000-8000-000000000001'
  ) ->> 'reservationId')::uuid,
  '47000000-0000-4000-8000-000000000001'::uuid,
  'a trusted service role can reserve after route authorization without a user membership claim'
);
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000001', true);
select throws_ok($$select * from public.list_checkout_intents('27000000-0000-4000-8000-000000000001', 'paid', 20)$$, 'P0001', 'CHECKOUT_HISTORY_INVALID', 'invalid checkout state is rejected');
select throws_ok($$select * from public.list_checkout_intents('27000000-0000-4000-8000-000000000001', null, 51)$$, 'P0001', 'CHECKOUT_HISTORY_INVALID', 'limit above 50 is rejected');
select throws_ok($$select * from public.list_checkout_intents('27000000-0000-4000-8000-000000000001', null, 0)$$, 'P0001', 'CHECKOUT_HISTORY_INVALID', 'limit below 1 is rejected');
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000002', true);
select is(
  (public.reserve_workspace_credits(
    '27000000-0000-4000-8000-000000000001', 'text_generation', 40,
    '27000000-0000-4000-8000-000000000001:reserve-1',
    '47000000-0000-4000-8000-000000000001'
  ) ->> 'reservationId')::uuid,
  '47000000-0000-4000-8000-000000000001'::uuid,
  'an identical idempotency key returns the original reservation'
);
select is(
  (select count(*)::integer from public.credit_reservations where workspace_id = '27000000-0000-4000-8000-000000000001'),
  1,
  'duplicate reserve creates one reservation'
);
select throws_ok(
  $$select public.reserve_workspace_credits(
    '27000000-0000-4000-8000-000000000001', 'text_generation', 1961,
    '27000000-0000-4000-8000-000000000001:reserve-insufficient',
    '47000000-0000-4000-8000-000000000002'
  )$$,
  'P0001', 'CREDIT_INSUFFICIENT',
  'insufficient balance fails before writing a ledger hold'
);
select is(
  (select count(*)::integer from public.credit_ledger_entries where workspace_id = '27000000-0000-4000-8000-000000000001'),
  2,
  'insufficient reserve preserves the existing ledger'
);
select throws_ok(
  $$select public.release_credit_reservation(
    '27000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000001', 41,
    '27000000-0000-4000-8000-000000000001:release-too-much'
  )$$,
  'P0001', 'CREDIT_RELEASE_EXCEEDS_RESERVED',
  'release cannot exceed the remaining reserve'
);
select lives_ok(
  $$select public.release_credit_reservation(
    '27000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000001', 40,
    '27000000-0000-4000-8000-000000000001:release-all'
  )$$,
  'release writes an append-only return for the hold'
);
select is(
  (select (public.get_workspace_credit_balance('27000000-0000-4000-8000-000000000001') ->> 'available')::integer),
  2000,
  'release restores the reserved balance'
);

select lives_ok(
  $$select public.reserve_workspace_credits(
    '27000000-0000-4000-8000-000000000001', 'image_generation', 30,
    '27000000-0000-4000-8000-000000000001:reserve-2',
    '47000000-0000-4000-8000-000000000004'
  )$$,
  'a fresh reservation can be settled after an earlier release'
);
select is(
  (public.settle_credit_reservation(
    '27000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000004', 25,
    '27000000-0000-4000-8000-000000000001:settle-2'
  ) ->> 'state'),
  'settled',
  'settle records actual usage and returns the temporary hold'
);
select is(
  (public.settle_credit_reservation(
    '27000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000004', 25,
    '27000000-0000-4000-8000-000000000001:settle-2'
  ) ->> 'state'),
  'settled',
  'a duplicate settle request returns the original state'
);
select is(
  (select (public.get_workspace_credit_balance('27000000-0000-4000-8000-000000000001') ->> 'available')::integer),
  1975,
  'settled usage consumes only the actual amount'
);

select lives_ok(
  $$select public.reserve_workspace_credits(
    '27000000-0000-4000-8000-000000000001', 'chat_turn', 1,
    '27000000-0000-4000-8000-000000000001:reserve-chat-turn',
    '47000000-0000-4000-8000-000000000005'
  )$$,
  'one preview chat turn can reserve its catalog action rate'
);
select is(
  (public.settle_credit_reservation(
    '27000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000005', 1,
    '27000000-0000-4000-8000-000000000001:settle-chat-turn'
  ) ->> 'state'),
  'settled',
  'one preview chat turn settles its single credit'
);
select is(
  (select (public.get_workspace_credit_balance('27000000-0000-4000-8000-000000000001') ->> 'available')::integer),
  1974,
  'the current preview balance drops by exactly one for a chat turn'
);

select is(
  private.ensure_v08_preview_credit_account(
    '27000000-0000-4000-8000-000000000001',
    statement_timestamp() + interval '8 days'
  ),
  private.ensure_v08_preview_credit_account(
    '27000000-0000-4000-8000-000000000001',
    statement_timestamp() + interval '8 days'
  ),
  'ensuring the next weekly preview period is idempotent'
);
select is(
  (select count(*)::integer from public.credit_accounts where workspace_id = '27000000-0000-4000-8000-000000000001'),
  2,
  'the next week creates a distinct workspace-period account'
);
select is(
  (
    select amount
    from public.credit_ledger_entries
    where workspace_id = '27000000-0000-4000-8000-000000000001'
      and account_id = private.ensure_v08_preview_credit_account(
        '27000000-0000-4000-8000-000000000001', statement_timestamp() + interval '8 days'
      )
      and kind = 'grant'
  ),
  2000,
  'the next weekly account receives a fresh 2000-credit grant without old ledger entries'
);

reset role;
alter table public.workspaces disable trigger workspaces_ensure_v08_preview_credit_account;
insert into public.workspaces (id, name, created_by)
values ('27000000-0000-4000-8000-000000000003', '기존 워크스페이스 보정', '17000000-0000-4000-8000-000000000001');
alter table public.workspaces enable trigger workspaces_ensure_v08_preview_credit_account;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.credit_accounts where workspace_id = '27000000-0000-4000-8000-000000000003'),
  0,
  'an existing workspace fixture begins without a credit account'
);
select is(
  private.ensure_v08_preview_credit_account('27000000-0000-4000-8000-000000000003'),
  private.ensure_v08_preview_credit_account('27000000-0000-4000-8000-000000000003'),
  'backfill ensure is idempotent for an existing workspace'
);
select is(
  (public.get_workspace_credit_balance('27000000-0000-4000-8000-000000000003') ->> 'available')::integer,
  2000,
  'backfill creates the current 2000-credit test balance for an existing workspace'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.create_period_content_plan(
    '27000000-0000-4000-8000-000000000001',
    '{"periodStart":"2026-08-24","periodEnd":"2026-08-30","timezone":"Asia/Seoul","goal":"예약 문의","generationDepth":"balanced","channels":[{"channel":"instagram","postCount":2,"imagesPerPost":1}]}'::jsonb,
    1, 12, '27000000-0000-4000-8000-000000000001:plan-1'
  )$$,
  'a workspace collaborator can store a period plan idempotently'
);
select is(
  (select count(*)::integer from public.content_plan_entries),
  1,
  'plan channels are stored in a separate workspace-scoped table'
);
select is(
  (select status from public.content_plans limit 1),
  'draft',
  'a stored plan remains draft before exact approval'
);
select is(
  (public.create_checkout_intent(
    '27000000-0000-4000-8000-000000000001',
    '88000000-0000-4000-8000-000000000002',
    '27000000-0000-4000-8000-000000000001:checkout-1'
  ) ->> 'state'),
  'provider_pending',
  'a checkout intent is pending and never a payment success'
);
select is((select count(*)::integer from public.list_checkout_intents('27000000-0000-4000-8000-000000000001', 'provider_pending', 1)), 1, 'state-filtered history returns the saved pending intent');

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-4000-8000-000000000002', true);
select is(
  (select count(*)::integer from public.credit_ledger_entries),
  0,
  'a non-member cannot read another workspace ledger'
);
select throws_ok($$select * from public.list_checkout_intents('27000000-0000-4000-8000-000000000001', null, 20)$$, 'P0001', 'CHECKOUT_FORBIDDEN', 'a non-member cannot read checkout history');
select throws_ok(
  $$select public.reserve_workspace_credits(
    '27000000-0000-4000-8000-000000000001', 'chat_turn', 1,
    '27000000-0000-4000-8000-000000000001:outsider',
    '47000000-0000-4000-8000-000000000003'
  )$$,
  '42501', 'permission denied for function reserve_workspace_credits',
  'an authenticated non-member cannot invoke the credit mutation RPC'
);

reset role;

select * from finish();

rollback;
