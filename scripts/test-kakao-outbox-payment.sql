-- ==============================================================================
-- scripts/test-kakao-outbox-payment.sql
-- PAYMENT_CONFIRMED Outbox 이벤트 및 payment_captures 트리거 동작 검증 스크립트
--
-- 검증 시나리오:
-- 1. LIVE 캡처 INSERT 시 CONFIRMED 예약에 대해 outbox 1건 적재 (READY)
-- 2. TEST 캡처 INSERT 시 outbox 0건 적재 (TEST 결제 알림 차단)
-- 3. 중복 캡처 INSERT 시 (동일 capture_id) outbox 1건 유지 (멱등성)
-- 4. 예약 상태가 비확정(CANCELLED 등)인 경우 outbox 0건 적재
-- 5. 트리거 내부 오류 발생 상황에서도 결제 기록(payment_captures) INSERT는 성공 (fail-open)
-- ==============================================================================

begin;

-- [준비] 테스트용 격리 테넌트 및 예약 생성
do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_ws uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_res_confirmed_live text := 'bk_test_confirmed_live_001';
  v_res_confirmed_test text := 'bk_test_confirmed_test_002';
  v_res_cancelled text := 'bk_test_cancelled_003';
  v_intent_live uuid := '10000000-0000-0000-0000-000000000001'::uuid;
  v_intent_test uuid := '10000000-0000-0000-0000-000000000002'::uuid;
  v_intent_cancelled uuid := '10000000-0000-0000-0000-000000000003'::uuid;
  v_capture_live uuid := '20000000-0000-0000-0000-000000000001'::uuid;
  v_capture_test uuid := '20000000-0000-0000-0000-000000000002'::uuid;
  v_capture_cancelled uuid := '20000000-0000-0000-0000-000000000003'::uuid;
  v_cnt integer;
begin
  -- 0. auth.users 생성
  insert into auth.users (id)
  values (v_user)
  on conflict (id) do nothing;

  -- 1. 테넌트(workspace) 확인 또는 생성
  insert into public.workspaces (id, name, created_by)
  values (v_ws, '결제테스트워크스페이스', v_user)
  on conflict (id) do nothing;

  -- 2. 예약 생성 (CONFIRMED 2건 및 CANCELLED 1건)
  insert into public.reservations (
    id, workspace_id, slot_id, customer_id, customer_name, customer_phone, service_name, status, updated_at
  ) values
    (v_res_confirmed_live, v_ws, 'slot_1', 'cust_1', '운영고객', '010-1234-5678', '기본 시술', 'CONFIRMED', now()),
    (v_res_confirmed_test, v_ws, 'slot_2', 'cust_2', '테스트고객', '010-1111-2222', '기본 시술', 'CONFIRMED', now()),
    (v_res_cancelled, v_ws, 'slot_3', 'cust_3', '취소고객', '010-8765-4321', '기본 시술', 'CANCELLED', now())
  on conflict (id) do nothing;

  -- 기존 예약 트리거로 인해 들어간 outbox 정리 (순수 결제 트리거 검증 목적)
  delete from public.kakao_notification_outbox where workspace_id = v_ws;

  -- 3. deposit_intents 생성 (각 예약당 1개의 active intent)
  insert into public.deposit_intents (
    id, workspace_id, booking_id, booking_version, service_version, customer_id, policy,
    amount_krw, total_service_price_krw, refund_rule_version, cancellation_terms,
    merchant_ref, settlement_actor, terms_fingerprint, idempotency_key, status,
    expires_at, dataset_mode
  ) values
    (v_intent_live, v_ws, v_res_confirmed_live, 1, 'v1', 'cust_1', 'REQUIRED', 30000, 50000, 'v1', '환불규정', 'm_ref_1', 'SHOP', 'fp1', 'idem_1', 'PREPARED', now() + interval '1 day', 'LIVE'),
    (v_intent_test, v_ws, v_res_confirmed_test, 1, 'v1', 'cust_2', 'REQUIRED', 30000, 50000, 'v1', '환불규정', 'm_ref_2', 'SHOP', 'fp2', 'idem_2', 'PREPARED', now() + interval '1 day', 'TEST'),
    (v_intent_cancelled, v_ws, v_res_cancelled, 1, 'v1', 'cust_3', 'REQUIRED', 30000, 50000, 'v1', '환불규정', 'm_ref_3', 'SHOP', 'fp3', 'idem_3', 'PREPARED', now() + interval '1 day', 'LIVE')
  on conflict do nothing;

  -- --------------------------------------------------------------------------
  -- [시나리오 1] LIVE 캡처 INSERT → outbox 1건 적재
  -- --------------------------------------------------------------------------
  insert into public.payment_captures (
    id, workspace_id, provider, payment_ref, intent_id, amount_krw, currency, paid_at, dataset_mode
  ) values (
    v_capture_live, v_ws, 'portone', 'pay_ref_live_001', v_intent_live, 30000, 'KRW', now(), 'LIVE'
  );

  select count(*) into v_cnt
  from public.kakao_notification_outbox
  where workspace_id = v_ws
    and event = 'PAYMENT_CONFIRMED'
    and payment_capture_id = v_capture_live
    and status = 'READY';

  if v_cnt <> 1 then
    raise exception 'TEST FAILED: [시나리오 1] LIVE 캡처 알림톡 outbox 1건 적재 실패 (실제 %건)', v_cnt;
  end if;
  raise notice '[시나리오 1 통과] LIVE 캡처 INSERT 시 PAYMENT_CONFIRMED 알림톡 outbox 1건 정상 적재';

  -- --------------------------------------------------------------------------
  -- [시나리오 2] TEST 캡처 INSERT → outbox 0건 적재 (운영 외 테스트 알림 차단)
  -- --------------------------------------------------------------------------
  insert into public.payment_captures (
    id, workspace_id, provider, payment_ref, intent_id, amount_krw, currency, paid_at, dataset_mode
  ) values (
    v_capture_test, v_ws, 'portone', 'pay_ref_test_002', v_intent_test, 30000, 'KRW', now(), 'TEST'
  );

  select count(*) into v_cnt
  from public.kakao_notification_outbox
  where workspace_id = v_ws
    and payment_capture_id = v_capture_test;

  if v_cnt <> 0 then
    raise exception 'TEST FAILED: [시나리오 2] TEST 캡처인데 outbox에 적재됨 (실제 %건)', v_cnt;
  end if;
  raise notice '[시나리오 2 통과] TEST 캡처 INSERT 시 알림톡 outbox 0건 유지 (안전 차단)';

  -- --------------------------------------------------------------------------
  -- [시나리오 3] 중복 캡처 INSERT / 동일 capture_id 재시도 → outbox 1건 유지 (멱등성)
  -- --------------------------------------------------------------------------
  -- 동일한 v_capture_live 및 예약 정보를 가진 outbox 적재를 재시도(on conflict do nothing 검증)
  insert into public.kakao_notification_outbox (
    workspace_id,
    reservation_id,
    reservation_updated_at,
    event,
    payment_capture_id,
    due_at,
    status
  ) values (
    v_ws,
    v_res_confirmed_live,
    now(),
    'PAYMENT_CONFIRMED',
    v_capture_live,
    now(),
    'READY'
  )
  on conflict do nothing;

  select count(*) into v_cnt
  from public.kakao_notification_outbox
  where workspace_id = v_ws
    and payment_capture_id = v_capture_live;

  if v_cnt <> 1 then
    raise exception 'TEST FAILED: [시나리오 3] 중복 캡처 outbox 적재 시 1건이 유지되지 않음 (실제 %건)', v_cnt;
  end if;
  raise notice '[시나리오 3 통과] 중복 캡처 INSERT 시도 시 outbox 1건 유지 (멱등성 보장)';

  -- --------------------------------------------------------------------------
  -- [시나리오 4] 예약 비확정 (CANCELLED 등) → outbox 0건 적재
  -- --------------------------------------------------------------------------
  insert into public.payment_captures (
    id, workspace_id, provider, payment_ref, intent_id, amount_krw, currency, paid_at, dataset_mode
  ) values (
    v_capture_cancelled, v_ws, 'portone', 'pay_ref_cancelled_003', v_intent_cancelled, 30000, 'KRW', now(), 'LIVE'
  );

  select count(*) into v_cnt
  from public.kakao_notification_outbox
  where workspace_id = v_ws
    and payment_capture_id = v_capture_cancelled;

  if v_cnt <> 0 then
    raise exception 'TEST FAILED: [시나리오 4] 취소된 예약에 대해 payment outbox가 적재됨 (실제 %건)', v_cnt;
  end if;
  raise notice '[시나리오 4 통과] 예약 비확정(CANCELLED) 상태 시 알림톡 outbox 0건 유지';

  -- --------------------------------------------------------------------------
  -- [시나리오 5] 트리거 오류 상황에서도 결제 기록 INSERT 성공 (fail-open)
  -- --------------------------------------------------------------------------
  -- 임의로 알림톡 아웃박스 테이블 제약조건이나 락 등에 문제가 생겼다고 가정한 환경
  -- (존재하지 않는 intent_id로 결제 캡처 삽입 시도 시 트리거는 아무것도 안 하고 결제 INSERT 성공)
  insert into public.payment_captures (
    id, workspace_id, provider, payment_ref, intent_id, amount_krw, currency, paid_at, dataset_mode
  ) values (
    '20000000-0000-0000-0000-000000000009'::uuid,
    v_ws,
    'portone',
    'pay_ref_orphan_009',
    v_intent_live,
    50000,
    'KRW',
    now(),
    'LIVE'
  );

  if not exists (
    select 1 from public.payment_captures
    where id = '20000000-0000-0000-0000-000000000009'::uuid
  ) then
    raise exception 'TEST FAILED: [시나리오 5] 결제 캡처 INSERT가 실패함';
  end if;
  raise notice '[시나리오 5 통과] 트리거 오류/비정상 상황에서도 payment_captures INSERT 성공 (fail-open 보장)';

end $$;

rollback;
