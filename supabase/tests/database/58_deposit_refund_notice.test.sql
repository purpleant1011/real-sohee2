-- ==============================================================================
-- 58_deposit_refund_notice.test.sql
-- ANI-1615 / ANI-1616 / ANI-1617 / ANI-1620 (TEST-only deposit, refund, notice ledger)
-- Contract: tables + RLS + tenant isolation + dataset_mode fail-closed + atomic RPCs.
-- Executed after the full migration replay inside one rollback-only transaction.
--
-- Every runtime assertion is its own statement: PostgreSQL may evaluate subqueries
-- of a multi-row VALUES list in any order, which would hide the RPC's own writes.
--
-- NOT_VERIFIED in this file: true two-session parallelism (claim CAS race). This suite
-- calls claim_notice_job sequentially inside one transaction, so concurrent callers are
-- not exercised here; the CAS is only proven to be single-winner for repeated calls.
-- ==============================================================================
\set ON_ERROR_STOP on
begin;

create temporary table deposit_assertions (name text primary key, passed boolean not null);

-- 1. Schema, RLS and privilege contract ---------------------------------------
insert into deposit_assertions values
('six payment/notice tables with RLS enabled', (
  select count(*) = 6 from pg_class
  where relnamespace = 'public'::regnamespace
    and relname in ('deposit_intents', 'payment_webhook_events', 'payment_captures',
                    'deposit_refunds', 'payment_reconciliation_queue', 'notice_jobs')
    and relrowsecurity
)),
('no anon/authenticated write grants on payment/notice tables', (
  select count(*) = 0 from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('deposit_intents', 'payment_webhook_events', 'payment_captures',
                       'deposit_refunds', 'payment_reconciliation_queue', 'notice_jobs')
    and grantee in ('anon', 'authenticated', 'PUBLIC')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
)),
('four payment/notice RPCs are security definer', (
  select count(*) = 4 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('commit_payment_observation', 'reserve_deposit_refund',
                      'claim_notice_job', 'invalidate_notice_jobs')
    and p.prosecdef = true
)),
('payment/notice RPCs pin search_path', (
  select count(*) = 4 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('commit_payment_observation', 'reserve_deposit_refund',
                      'claim_notice_job', 'invalidate_notice_jobs')
    and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%')
)),
('no public execution grants on payment/notice RPCs', (
  select count(*) = 0 from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in ('commit_payment_observation', 'reserve_deposit_refund',
                         'claim_notice_job', 'invalidate_notice_jobs')
    and grantee in ('anon', 'authenticated', 'PUBLIC')
)),
('service_role alone may execute payment/notice RPCs', (
  select count(*) = 4 from information_schema.routine_privileges
  where routine_schema = 'public'
    and routine_name in ('commit_payment_observation', 'reserve_deposit_refund',
                         'claim_notice_job', 'invalidate_notice_jobs')
    and grantee = 'service_role'
    and privilege_type = 'EXECUTE'
));

do $$ begin
 if (select not bool_and(passed) from deposit_assertions) then
   raise exception 'deposit schema assertions failed: %',
     (select string_agg(name, ', ') from deposit_assertions where not passed);
 end if;
end $$;

-- 2. Fixtures ----------------------------------------------------------------
insert into auth.users (id, email) values
 ('e4111111-1111-4111-8111-111111111111', 'pay-a@test.invalid'),
 ('e4222222-2222-4222-8222-222222222222', 'pay-b@test.invalid');

insert into public.workspaces (id, name, created_by) values
 ('b4111111-1111-4111-8111-111111111111', 'Payments A', 'e4111111-1111-4111-8111-111111111111'),
 ('b4222222-2222-4222-8222-222222222222', 'Payments B', 'e4222222-2222-4222-8222-222222222222');

insert into public.workspace_members (workspace_id, user_id, role, status) values
 ('b4111111-1111-4111-8111-111111111111', 'e4111111-1111-4111-8111-111111111111', 'owner', 'active'),
 ('b4222222-2222-4222-8222-222222222222', 'e4222222-2222-4222-8222-222222222222', 'owner', 'active')
 on conflict (workspace_id, user_id) do update set role = excluded.role, status = excluded.status;

insert into public.deposit_intents (
  id, workspace_id, booking_id, booking_version, service_version, customer_id, policy,
  amount_krw, total_service_price_krw, refund_rule_version, cancellation_terms,
  merchant_ref, settlement_actor, terms_fingerprint, idempotency_key, status, expires_at
)
select v.id, v.ws, v.booking, 1, 'svc_v1', 'cust_1', v.policy,
       v.amount, 120000, 'rr_v1', '취소 규정 v1',
       'merchant_test', 'SHOP', repeat('a', 64), v.idem, v.status, v.expires
from (values
  ('d4111111-1111-4111-8111-111111111111'::uuid, 'b4111111-1111-4111-8111-111111111111'::uuid, 'bk_evt',       30000, now() + interval '1 hour', 'idem-evt',      'PREPARED', 'REQUIRED'),
  ('d4222222-2222-4222-8222-222222222222'::uuid, 'b4111111-1111-4111-8111-111111111111'::uuid, 'bk_evt2',      30000, now() + interval '1 hour', 'idem-evt2',     'PREPARED', 'REQUIRED'),
  ('d4333333-3333-4333-8333-333333333333'::uuid, 'b4111111-1111-4111-8111-111111111111'::uuid, 'bk_ref_owner', 30000, now() + interval '1 hour', 'idem-refowner', 'TEST_PAID_MATCHED', 'REQUIRED'),
  ('d4444444-4444-4444-8444-444444444444'::uuid, 'b4111111-1111-4111-8111-111111111111'::uuid, 'bk_ref_thief', 30000, now() + interval '1 hour', 'idem-refthief', 'PREPARED', 'REQUIRED'),
  ('d4555555-5555-4555-8555-555555555555'::uuid, 'b4222222-2222-4222-8222-222222222222'::uuid, 'bk_b1',        30000, now() + interval '1 hour', 'idem-b1',       'PREPARED', 'REQUIRED'),
  ('d4666666-6666-4666-8666-666666666666'::uuid, 'b4111111-1111-4111-8111-111111111111'::uuid, 'bk_late',      30000, now() - interval '1 hour', 'idem-late',     'PREPARED', 'REQUIRED'),
  ('d4777777-7777-4777-8777-777777777777'::uuid, 'b4111111-1111-4111-8111-111111111111'::uuid, 'bk_refund1',   30000, now() + interval '1 hour', 'idem-rf1',      'TEST_PAID_MATCHED', 'REQUIRED'),
  ('d4888888-8888-4888-8888-888888888888'::uuid, 'b4111111-1111-4111-8111-111111111111'::uuid, 'bk_refund2',   30000, now() + interval '1 hour', 'idem-rf2',      'TEST_PAID_MATCHED', 'REQUIRED'),
  ('d4999999-9999-4999-8999-999999999999'::uuid, 'b4111111-1111-4111-8111-111111111111'::uuid, 'bk_refund3',   30000, now() + interval '1 hour', 'idem-rf3',      'TEST_PAID_MATCHED', 'REQUIRED'),
  ('d4000000-0000-4000-8000-000000000000'::uuid, 'b4111111-1111-4111-8111-111111111111'::uuid, 'bk_amount',    30000, now() + interval '1 hour', 'idem-amt',      'PREPARED', 'REQUIRED'),
  ('d4000001-0000-4000-8000-000000000001'::uuid, 'b4111111-1111-4111-8111-111111111111'::uuid, 'bk_dup',       30000, now() + interval '1 hour', 'idem-dup1',     'PREPARED', 'OPTIONAL')
) as v(id, ws, booking, amount, expires, idem, status, policy);

insert into public.payment_captures (id, workspace_id, provider, payment_ref, intent_id, amount_krw, currency, paid_at, disputed) values
 ('c4111111-1111-4111-8111-111111111111', 'b4111111-1111-4111-8111-111111111111', 'portone', 'pay_refund_1', 'd4777777-7777-4777-8777-777777777777', 30000, 'KRW', now(), false),
 ('c4222222-2222-4222-8222-222222222222', 'b4111111-1111-4111-8111-111111111111', 'portone', 'pay_refund_2', 'd4888888-8888-4888-8888-888888888888', 30000, 'KRW', now(), false),
 ('c4333333-3333-4333-8333-333333333333', 'b4111111-1111-4111-8111-111111111111', 'portone', 'pay_refund_3', 'd4999999-9999-4999-8999-999999999999', 30000, 'KRW', now(), true),
 ('c4444444-4444-4444-8444-444444444444', 'b4111111-1111-4111-8111-111111111111', 'portone', 'pay_dup',      'd4333333-3333-4333-8333-333333333333', 30000, 'KRW', now(), false);

insert into public.notice_jobs (
  id, workspace_id, booking_id, booking_version, kind, template_version,
  recipient_ref_hash, scheduled_at, payload_fingerprint, status
) values
 ('94000001-1111-4111-8111-111111111111', 'b4111111-1111-4111-8111-111111111111', 'bk_a1', 15, 'REMINDER',     'tpl_v1', repeat('3', 64), now() - interval '1 minute', repeat('f', 64), 'PLANNED'),
 ('94000002-1111-4111-8111-111111111111', 'b4111111-1111-4111-8111-111111111111', 'bk_a1', 15, 'REMINDER',     'tpl_v2', repeat('4', 64), now() - interval '1 minute', repeat('f', 64), 'REQUEST_ACCEPTED'),
 ('94000003-1111-4111-8111-111111111111', 'b4111111-1111-4111-8111-111111111111', 'bk_a1', 15, 'CONFIRMATION', 'tpl_v1', repeat('5', 64), now() - interval '1 minute', repeat('f', 64), 'PLANNED'),
 ('94000004-1111-4111-8111-111111111111', 'b4111111-1111-4111-8111-111111111111', 'bk_a1', 16, 'CANCELLATION', 'tpl_v1', repeat('6', 64), now() + interval '1 hour',   repeat('f', 64), 'PLANNED'),
 ('94000005-1111-4111-8111-111111111111', 'b4111111-1111-4111-8111-111111111111', 'bk_a1', 15, 'CHANGE',       'tpl_v1', repeat('7', 64), now() - interval '1 minute', repeat('f', 64), 'UNKNOWN'),
 ('94000006-1111-4111-8111-111111111111', 'b4111111-1111-4111-8111-111111111111', 'bk_a1', 15, 'CANCELLATION', 'tpl_v1', repeat('8', 64), now() + interval '1 hour',   repeat('f', 64), 'PLANNED'),
 ('94000007-1111-4111-8111-111111111111', 'b4111111-1111-4111-8111-111111111111', 'bk_a2',  1, 'REMINDER',     'tpl_v1', repeat('9', 64), now() + interval '1 hour',   repeat('f', 64), 'PLANNED');

create function pg_temp.pay_kind(result jsonb) returns text language sql immutable as $$
  select result->>'kind'
$$;

create function pg_temp.rejected(query text) returns boolean language plpgsql as $$
begin execute query; return false;
exception when insufficient_privilege or check_violation or foreign_key_violation
            or unique_violation or exclusion_violation or raise_exception then return true;
end $$;

-- 3. Static negative paths (constraints, dataset_mode, tenant FK) -------------
insert into deposit_assertions values
('second active intent for one booking is rejected', pg_temp.rejected($q$
 insert into public.deposit_intents (workspace_id, booking_id, booking_version, service_version, customer_id, policy,
   amount_krw, total_service_price_krw, refund_rule_version, cancellation_terms, merchant_ref, settlement_actor,
   terms_fingerprint, idempotency_key, status, expires_at)
 values ('b4111111-1111-4111-8111-111111111111', 'bk_dup', 1, 'svc_v1', 'cust_1', 'REQUIRED',
   30000, 120000, 'rr_v1', '취소 규정 v1', 'merchant_test', 'SHOP',
   repeat('a', 64), 'idem-dup2', 'REQUESTED', now() + interval '1 hour');
$q$)),
('ACTUAL dataset_mode on deposit_intents is rejected', pg_temp.rejected($q$
 insert into public.deposit_intents (workspace_id, booking_id, booking_version, service_version, customer_id, policy,
   amount_krw, total_service_price_krw, refund_rule_version, cancellation_terms, merchant_ref, settlement_actor,
   terms_fingerprint, idempotency_key, status, expires_at, dataset_mode)
 values ('b4111111-1111-4111-8111-111111111111', 'bk_actual', 1, 'svc_v1', 'cust_1', 'REQUIRED',
   30000, 120000, 'rr_v1', '취소 규정 v1', 'merchant_test', 'SHOP',
   repeat('a', 64), 'idem-actual', 'PREPARED', now() + interval '1 hour', 'ACTUAL');
$q$)),
('ACTUAL dataset_mode on notice_jobs is rejected', pg_temp.rejected($q$
 insert into public.notice_jobs (workspace_id, booking_id, booking_version, kind, template_version,
   recipient_ref_hash, scheduled_at, payload_fingerprint, dataset_mode)
 values ('b4111111-1111-4111-8111-111111111111', 'bk_actual', 1, 'REMINDER', 'tpl_v1',
   repeat('a', 64), now(), repeat('f', 64), 'ACTUAL');
$q$)),
('capture cannot bind another tenant intent', pg_temp.rejected($q$
 insert into public.payment_captures (workspace_id, provider, payment_ref, intent_id, amount_krw, currency, paid_at)
 values ('b4222222-2222-4222-8222-222222222222', 'portone', 'pay_cross_fk',
   'd4111111-1111-4111-8111-111111111111', 30000, 'KRW', now());
$q$)),
('capture amount must be positive', pg_temp.rejected($q$
 insert into public.payment_captures (workspace_id, provider, payment_ref, intent_id, amount_krw, currency, paid_at)
 values ('b4111111-1111-4111-8111-111111111111', 'portone', 'pay_zero',
   'd4777777-7777-4777-8777-777777777777', 0, 'KRW', now());
$q$)),
('notice recipient reference must be a hash', pg_temp.rejected($q$
 insert into public.notice_jobs (workspace_id, booking_id, booking_version, kind, template_version,
   recipient_ref_hash, scheduled_at, payload_fingerprint)
 values ('b4111111-1111-4111-8111-111111111111', 'bk_a3', 1, 'REMINDER', 'tpl_v1',
   '010-0000-0000', now(), repeat('f', 64));
$q$));

do $$ begin
 if (select not bool_and(passed) from deposit_assertions) then
   raise exception 'deposit constraint assertions failed: %',
     (select string_agg(name, ', ') from deposit_assertions where not passed);
 end if;
end $$;

-- 4. Cross-tenant RLS read isolation -----------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'e4111111-1111-4111-8111-111111111111';
select count(*) as own_intent_rows from public.deposit_intents
 where workspace_id = 'b4111111-1111-4111-8111-111111111111' \gset
select count(*) as other_intent_rows from public.deposit_intents
 where workspace_id = 'b4222222-2222-4222-8222-222222222222' \gset
select count(*) as other_notice_rows from public.notice_jobs
 where workspace_id = 'b4222222-2222-4222-8222-222222222222' \gset
reset role;

insert into deposit_assertions values ('workspace A member can read own payment rows', :own_intent_rows > 0);
insert into deposit_assertions values ('workspace A member cannot read workspace B intents', :other_intent_rows = 0);
insert into deposit_assertions values ('workspace A member cannot read workspace B notice jobs', :other_notice_rows = 0);

-- 5. Webhook observation: event claim, capture ledger, late payment -----------
insert into deposit_assertions values ('first paid event matches', pg_temp.pay_kind(public.commit_payment_observation(
  p_workspace_id => 'b4111111-1111-4111-8111-111111111111', p_event_id => 'evt-1',
  p_payload_digest => repeat('b', 64), p_intent_id => 'd4111111-1111-4111-8111-111111111111',
  p_payment_ref => 'pay_evt_1', p_amount_krw => 30000, p_currency => 'KRW',
  p_paid_at => now(), p_outcome => 'MATCHED')) = 'MATCHED');

insert into deposit_assertions values ('second identical paid event replays', pg_temp.pay_kind(public.commit_payment_observation(
  p_workspace_id => 'b4111111-1111-4111-8111-111111111111', p_event_id => 'evt-1',
  p_payload_digest => repeat('b', 64), p_intent_id => 'd4111111-1111-4111-8111-111111111111',
  p_payment_ref => 'pay_evt_1', p_amount_krw => 30000, p_currency => 'KRW',
  p_paid_at => now(), p_outcome => 'MATCHED')) = 'REPLAY');

insert into deposit_assertions values ('third identical paid event replays', pg_temp.pay_kind(public.commit_payment_observation(
  p_workspace_id => 'b4111111-1111-4111-8111-111111111111', p_event_id => 'evt-1',
  p_payload_digest => repeat('b', 64), p_intent_id => 'd4111111-1111-4111-8111-111111111111',
  p_payment_ref => 'pay_evt_1', p_amount_krw => 30000, p_currency => 'KRW',
  p_paid_at => now(), p_outcome => 'MATCHED')) = 'REPLAY');

insert into deposit_assertions values ('three identical events produce exactly one capture', (
  select count(*) = 1 from public.payment_captures
  where workspace_id = 'b4111111-1111-4111-8111-111111111111' and payment_ref = 'pay_evt_1'
));
insert into deposit_assertions values ('matched intent is TEST_PAID_MATCHED', (
  select status = 'TEST_PAID_MATCHED' from public.deposit_intents
  where id = 'd4111111-1111-4111-8111-111111111111'
));
insert into deposit_assertions values ('payment observation never writes reservations', (
  select count(*) = 0 from public.reservations
  where workspace_id = 'b4111111-1111-4111-8111-111111111111'
));

-- event id conflict (same event id, different payload digest)
insert into deposit_assertions values ('conflicting event digest first lands as matched', pg_temp.pay_kind(public.commit_payment_observation(
  p_workspace_id => 'b4111111-1111-4111-8111-111111111111', p_event_id => 'evt-2',
  p_payload_digest => repeat('c', 64), p_intent_id => 'd4222222-2222-4222-8222-222222222222',
  p_payment_ref => 'pay_evt_2', p_amount_krw => 30000, p_currency => 'KRW',
  p_paid_at => now(), p_outcome => 'MATCHED')) = 'MATCHED');

insert into deposit_assertions values ('same event id with different digest is EVENT_CONFLICT', pg_temp.pay_kind(public.commit_payment_observation(
  p_workspace_id => 'b4111111-1111-4111-8111-111111111111', p_event_id => 'evt-2',
  p_payload_digest => repeat('d', 64), p_intent_id => 'd4222222-2222-4222-8222-222222222222',
  p_payment_ref => 'pay_evt_2', p_amount_krw => 30000, p_currency => 'KRW',
  p_paid_at => now(), p_outcome => 'MATCHED')) = 'EVENT_CONFLICT');

insert into deposit_assertions values ('event conflict queues reconciliation', (
  select count(*) = 1 from public.payment_reconciliation_queue
  where intent_id = 'd4222222-2222-4222-8222-222222222222' and reason = 'EVENT_CONFLICT' and resolved_at is null
));
insert into deposit_assertions values ('event conflict forces NEEDS_REVIEW', (
  select status = 'NEEDS_REVIEW' from public.deposit_intents
  where id = 'd4222222-2222-4222-8222-222222222222'
));
insert into deposit_assertions values ('event conflict does not duplicate the capture', (
  select count(*) = 1 from public.payment_captures
  where workspace_id = 'b4111111-1111-4111-8111-111111111111' and payment_ref = 'pay_evt_2'
));

-- payment_ref already bound to another intent
insert into deposit_assertions values ('payment ref bound to another intent is rejected', pg_temp.pay_kind(public.commit_payment_observation(
  p_workspace_id => 'b4111111-1111-4111-8111-111111111111', p_event_id => 'evt-4',
  p_payload_digest => repeat('e', 64), p_intent_id => 'd4444444-4444-4444-8444-444444444444',
  p_payment_ref => 'pay_dup', p_amount_krw => 30000, p_currency => 'KRW',
  p_paid_at => now(), p_outcome => 'MATCHED')) = 'PAYMENT_REF_CONFLICT');

insert into deposit_assertions values ('payment ref conflict writes no capture', (
  select count(*) = 0 from public.payment_captures
  where intent_id = 'd4444444-4444-4444-8444-444444444444'
));
insert into deposit_assertions values ('payment ref conflict queues reconciliation', (
  select count(*) = 1 from public.payment_reconciliation_queue
  where intent_id = 'd4444444-4444-4444-8444-444444444444' and reason = 'PAYMENT_REF_CONFLICT'
));
insert into deposit_assertions values ('payment ref conflict forces NEEDS_REVIEW', (
  select status = 'NEEDS_REVIEW' from public.deposit_intents
  where id = 'd4444444-4444-4444-8444-444444444444'
));

-- amount mismatch
insert into deposit_assertions values ('amount mismatch is not accepted as matched', pg_temp.pay_kind(public.commit_payment_observation(
  p_workspace_id => 'b4111111-1111-4111-8111-111111111111', p_event_id => 'evt-5',
  p_payload_digest => repeat('1', 64), p_intent_id => 'd4000000-0000-4000-8000-000000000000',
  p_payment_ref => 'pay_amt', p_amount_krw => 10000, p_currency => 'KRW',
  p_paid_at => now(), p_outcome => 'MATCHED')) = 'AMOUNT_MISMATCH');

insert into deposit_assertions values ('amount mismatch writes no capture', (
  select count(*) = 0 from public.payment_captures where payment_ref = 'pay_amt'
));
insert into deposit_assertions values ('amount mismatch forces NEEDS_REVIEW', (
  select status = 'NEEDS_REVIEW' from public.deposit_intents
  where id = 'd4000000-0000-4000-8000-000000000000'
));

-- late payment
insert into deposit_assertions values ('late payment is preserved but flagged', pg_temp.pay_kind(public.commit_payment_observation(
  p_workspace_id => 'b4111111-1111-4111-8111-111111111111', p_event_id => 'evt-6',
  p_payload_digest => repeat('2', 64), p_intent_id => 'd4666666-6666-4666-8666-666666666666',
  p_payment_ref => 'pay_late', p_amount_krw => 30000, p_currency => 'KRW',
  p_paid_at => now(), p_outcome => 'MATCHED')) = 'LATE_PAYMENT');

insert into deposit_assertions values ('late payment still records the capture', (
  select count(*) = 1 from public.payment_captures where payment_ref = 'pay_late'
));
insert into deposit_assertions values ('late payment queues LATE_PAYMENT', (
  select count(*) = 1 from public.payment_reconciliation_queue
  where intent_id = 'd4666666-6666-4666-8666-666666666666' and reason = 'LATE_PAYMENT'
));
insert into deposit_assertions values ('late payment forces NEEDS_REVIEW', (
  select status = 'NEEDS_REVIEW' from public.deposit_intents
  where id = 'd4666666-6666-4666-8666-666666666666'
));

-- cross tenant RPC must not touch another workspace
insert into deposit_assertions values ('cross tenant observation finds nothing', pg_temp.pay_kind(public.commit_payment_observation(
  p_workspace_id => 'b4222222-2222-4222-8222-222222222222', p_event_id => 'evt-7',
  p_payload_digest => repeat('3', 64), p_intent_id => 'd4111111-1111-4111-8111-111111111111',
  p_payment_ref => 'pay_cross', p_amount_krw => 30000, p_currency => 'KRW',
  p_paid_at => now(), p_outcome => 'MATCHED')) = 'NOT_FOUND');

insert into deposit_assertions values ('cross tenant observation leaves workspace A intent untouched', (
  select status = 'TEST_PAID_MATCHED' from public.deposit_intents
  where id = 'd4111111-1111-4111-8111-111111111111'
));
insert into deposit_assertions values ('cross tenant observation writes no capture', (
  select count(*) = 0 from public.payment_captures where payment_ref = 'pay_cross'
));

-- 6. Refund reservation ------------------------------------------------------
insert into deposit_assertions values ('full refund reserves against available amount', pg_temp.pay_kind(public.reserve_deposit_refund(
  'b4111111-1111-4111-8111-111111111111', 'pay_refund_1', 'rf-1', 30000, '고객 취소', 'rr_v1')) = 'RESERVED');

insert into deposit_assertions values ('identical refund operation replays', pg_temp.pay_kind(public.reserve_deposit_refund(
  'b4111111-1111-4111-8111-111111111111', 'pay_refund_1', 'rf-1', 30000, '고객 취소', 'rr_v1')) = 'REPLAY');

insert into deposit_assertions values ('same operation key with different amount conflicts', pg_temp.pay_kind(public.reserve_deposit_refund(
  'b4111111-1111-4111-8111-111111111111', 'pay_refund_1', 'rf-1', 20000, '고객 취소', 'rr_v1')) = 'CONFLICT');

insert into deposit_assertions values ('refund above remaining available is refused', pg_temp.pay_kind(public.reserve_deposit_refund(
  'b4111111-1111-4111-8111-111111111111', 'pay_refund_1', 'rf-2', 1000, '추가 환불', 'rr_v1')) = 'EXCEEDS_AVAILABLE');

insert into deposit_assertions values ('partial refund reserves the remainder', pg_temp.pay_kind(public.reserve_deposit_refund(
  'b4111111-1111-4111-8111-111111111111', 'pay_refund_2', 'rf-a', 20000, '부분 환불', 'rr_v1')) = 'RESERVED');

insert into deposit_assertions values ('second partial refund beyond remainder is refused', pg_temp.pay_kind(public.reserve_deposit_refund(
  'b4111111-1111-4111-8111-111111111111', 'pay_refund_2', 'rf-b', 20000, '부분 환불', 'rr_v1')) = 'EXCEEDS_AVAILABLE');

insert into deposit_assertions values ('disputed capture blocks refunds', pg_temp.pay_kind(public.reserve_deposit_refund(
  'b4111111-1111-4111-8111-111111111111', 'pay_refund_3', 'rf-d', 1000, '분쟁 중', 'rr_v1')) = 'BLOCKED_DISPUTE');

-- provider timeout: the reservation is sealed UNKNOWN and must block other keys
update public.deposit_refunds set status = 'UNKNOWN'
 where workspace_id = 'b4111111-1111-4111-8111-111111111111' and operation_key = 'rf-1';

insert into deposit_assertions values ('unknown refund on the capture holds new keys', pg_temp.pay_kind(public.reserve_deposit_refund(
  'b4111111-1111-4111-8111-111111111111', 'pay_refund_1', 'rf-3', 1000, '재시도', 'rr_v1')) = 'HOLD_UNKNOWN_REFUND');

insert into deposit_assertions values ('cross tenant refund call finds no capture', pg_temp.pay_kind(public.reserve_deposit_refund(
  'b4222222-2222-4222-8222-222222222222', 'pay_refund_1', 'rf-x', 1000, '타 테넌트', 'rr_v1')) = 'CAPTURE_NOT_FOUND');

insert into deposit_assertions values ('cross tenant refund call writes nothing', (
  select count(*) = 2 from public.deposit_refunds
  where workspace_id = 'b4111111-1111-4111-8111-111111111111'
));

-- 7. Notice job claim and invalidation --------------------------------------
insert into deposit_assertions values ('due planned notice is claimed once', pg_temp.pay_kind(public.claim_notice_job(
  'b4111111-1111-4111-8111-111111111111', '94000001-1111-4111-8111-111111111111', now())) = 'CLAIMED');

insert into deposit_assertions values ('second claim of the same notice is refused', pg_temp.pay_kind(public.claim_notice_job(
  'b4111111-1111-4111-8111-111111111111', '94000001-1111-4111-8111-111111111111', now())) = 'NOT_CLAIMABLE');

insert into deposit_assertions values ('claim generation advanced exactly once', (
  select claim_generation = 1 and status = 'CLAIMED' from public.notice_jobs
  where id = '94000001-1111-4111-8111-111111111111'
));

insert into deposit_assertions values ('future notice is not claimable', pg_temp.pay_kind(public.claim_notice_job(
  'b4111111-1111-4111-8111-111111111111', '94000007-1111-4111-8111-111111111111', now())) = 'NOT_CLAIMABLE');

insert into deposit_assertions values ('cross tenant claim finds nothing', pg_temp.pay_kind(public.claim_notice_job(
  'b4222222-2222-4222-8222-222222222222', '94000001-1111-4111-8111-111111111111', now())) = 'NOT_FOUND');

-- version bump to 16 with CONFIRMED status
select public.invalidate_notice_jobs(
  'b4111111-1111-4111-8111-111111111111', 'bk_a1', 16, 'CONFIRMED') as inv_result \gset
select (:'inv_result'::jsonb)->>'invalidated' as inv_count,
       (:'inv_result'::jsonb)->>'in_flight_or_sent' as inflight_count \gset

insert into deposit_assertions values ('version bump invalidates stale planned and claimed notices', :inv_count::int = 3);
insert into deposit_assertions values ('in flight and sent notices are counted not changed', :inflight_count::int = 2);
insert into deposit_assertions values ('request accepted notice is untouched', (
  select status = 'REQUEST_ACCEPTED' from public.notice_jobs
  where id = '94000002-1111-4111-8111-111111111111'
));
insert into deposit_assertions values ('unknown notice is untouched', (
  select status = 'UNKNOWN' from public.notice_jobs
  where id = '94000005-1111-4111-8111-111111111111'
));
insert into deposit_assertions values ('stale cancellation notice is invalidated on version bump', (
  select status = 'INVALIDATED' from public.notice_jobs
  where id = '94000006-1111-4111-8111-111111111111'
));

-- cancellation at the current version keeps its CANCELLATION notice
select public.invalidate_notice_jobs(
  'b4111111-1111-4111-8111-111111111111', 'bk_a1', 16, 'CANCELLED') as inv_cancel \gset
select public.invalidate_notice_jobs(
  'b4222222-2222-4222-8222-222222222222', 'bk_a1', 99, 'CONFIRMED') as inv_cross \gset

insert into deposit_assertions values ('cancellation at current version invalidates nothing else', (:'inv_cancel'::jsonb)->>'invalidated' = '0');
insert into deposit_assertions values ('current version cancellation notice survives', (
  select status = 'PLANNED' from public.notice_jobs
  where id = '94000004-1111-4111-8111-111111111111'
));
insert into deposit_assertions values ('cross tenant invalidation reports OK and changes nothing', (
  (:'inv_cross'::jsonb)->>'kind' = 'OK' and (:'inv_cross'::jsonb)->>'invalidated' = '0'
));
insert into deposit_assertions values ('cross tenant invalidation left workspace A notices intact', (
  select count(*) = 3 from public.notice_jobs
  where workspace_id = 'b4111111-1111-4111-8111-111111111111' and status = 'INVALIDATED'
));

-- booking_version <> 비교: 현재보다 새것인 job도 구 job으로 보고 무효화한다(`<` 였다면 살아남았다).
insert into public.notice_jobs (
  id, workspace_id, booking_id, booking_version, kind, template_version,
  recipient_ref_hash, scheduled_at, payload_fingerprint, status
) values
 ('94000008-1111-4111-8111-111111111111', 'b4111111-1111-4111-8111-111111111111', 'bk_ver_shift', 17,
  'REMINDER', 'tpl_v1', repeat('a', 64), now() + interval '1 hour', repeat('f', 64), 'PLANNED'),
 ('94000009-1111-4111-8111-111111111111', 'b4111111-1111-4111-8111-111111111111', 'bk_ver_same', 16,
  'REMINDER', 'tpl_v2', repeat('b', 64), now() + interval '1 hour', repeat('f', 64), 'PLANNED');

select public.invalidate_notice_jobs(
  'b4111111-1111-4111-8111-111111111111', 'bk_ver_shift', 16, 'CONFIRMED') as inv_shift \gset
select public.invalidate_notice_jobs(
  'b4111111-1111-4111-8111-111111111111', 'bk_ver_same', 16, 'CONFIRMED') as inv_same \gset

insert into deposit_assertions values ('notice newer than the current version is invalidated', (
  (:'inv_shift'::jsonb)->>'invalidated' = '1'
  and (select status = 'INVALIDATED' from public.notice_jobs
       where id = '94000008-1111-4111-8111-111111111111')
));
insert into deposit_assertions values ('notice at the exact current version is kept for dispatch revalidation', (
  (:'inv_same'::jsonb)->>'invalidated' = '0'
  and (select status = 'PLANNED' from public.notice_jobs
       where id = '94000009-1111-4111-8111-111111111111')
));

do $$ begin
 if (select not bool_and(passed) from deposit_assertions) then
   raise exception 'deposit runtime assertions failed: %',
     (select string_agg(name, ', ') from deposit_assertions where not passed);
 end if;
end $$;

select count(*) as assertions_total, count(*) filter (where passed) as assertions_passed
from deposit_assertions;

rollback;
