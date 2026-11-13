-- 임시 로컬 PostgreSQL 전용. 운영/공유 DB에서 실행 금지.
-- psql -X -v ON_ERROR_STOP=1 -h /tmp/sohee-kakao-pg.iEpdmt -p 55439 -U postgres -f scripts/test-kakao-outbox-previous-start.sql
-- 예약 변경 시 previousBookingStartsAt 보존 및 outbox 이벤트 트리거 검증
\set ON_ERROR_STOP on
begin;

-- 최소 roles guard
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
end
$$;

create table if not exists public.workspaces (id uuid primary key);
create table if not exists public.reservations (
  id text primary key,
  workspace_id uuid not null references public.workspaces(id),
  slot_id text not null,
  status text not null,
  metadata jsonb not null default '{}',
  updated_at timestamptz not null default statement_timestamp()
);

-- authenticated 역할에게 reservations 테이블 DML 권한 부여 (실제 서비스 환경 모사)
grant usage on schema public to authenticated;
grant select, insert, update on public.reservations to authenticated;

-- 마이그레이션 적용: 0400 -> 0500 -> 0600 -> 0700 -> 0800 -> 0900 순서
\ir ../supabase/migrations/20261106040000_kakao_notification_outbox.sql
\ir ../supabase/migrations/20261106050000_kakao_notification_outbox_rpc.sql
\ir ../supabase/migrations/20261106060000_kakao_notification_policy_evidence.sql
\ir ../supabase/migrations/20261106070000_kakao_outbox_delivery_receipts.sql
\ir ../supabase/migrations/20261106080000_kakao_outbox_delivery_hardening.sql
\ir ../supabase/migrations/20261106090000_kakao_reservation_previous_start.sql

do $$
declare
  w uuid := '00000000-0000-4000-8000-000000000001';
  v_updated_1 timestamptz;
  v_updated_2 timestamptz;
  v_updated_3 timestamptz;
begin
  insert into public.workspaces values (w);

  -- -------------------------------------------------------------------------
  -- 1. [검증 1] 확정 -> 시각 변경 시 previousBookingStartsAt 기록
  -- -------------------------------------------------------------------------
  -- 1-A. bookingStartsAt 변경 시나리오
  insert into public.reservations (id, workspace_id, slot_id, status, metadata)
    values ('res_1', w, 'slot_1', 'CONFIRMED', '{"bookingStartsAt": "2026-11-10T10:00:00Z"}'::jsonb);

  -- 확정 직후에는 previousBookingStartsAt 키가 없음
  assert (select metadata->>'previousBookingStartsAt' is null from public.reservations where id = 'res_1'),
    'new confirmed reservation has no previousBookingStartsAt';

  select updated_at into v_updated_1 from public.reservations where id = 'res_1';

  -- 시작일시 변경 (10:00 -> 14:00)
  update public.reservations
  set metadata = '{"bookingStartsAt": "2026-11-10T14:00:00Z"}'::jsonb
  where id = 'res_1';

  assert (select metadata->>'bookingStartsAt' = '2026-11-10T14:00:00Z' from public.reservations where id = 'res_1'),
    'bookingStartsAt updated to 14:00';
  assert (select metadata->>'previousBookingStartsAt' = '2026-11-10T10:00:00Z' from public.reservations where id = 'res_1'),
    'previousBookingStartsAt recorded original 10:00';
  assert (select updated_at > v_updated_1 from public.reservations where id = 'res_1'),
    'updated_at monotonically increased on booking change';

  -- 1-B. startsAt (대체 키) 변경 시나리오
  insert into public.reservations (id, workspace_id, slot_id, status, metadata)
    values ('res_starts_at', w, 'slot_sa', 'CONFIRMED', '{"startsAt": "2026-11-11T09:00:00Z"}'::jsonb);

  update public.reservations
  set metadata = '{"startsAt": "2026-11-11T11:00:00Z"}'::jsonb
  where id = 'res_starts_at';

  assert (select metadata->>'previousBookingStartsAt' = '2026-11-11T09:00:00Z' from public.reservations where id = 'res_starts_at'),
    'startsAt fallback used when bookingStartsAt absent';

  -- 1-C. slot_id만 변경 시나리오 (시작시각은 유지되더라도 직전 시작시각을 previous에 정상 기록)
  insert into public.reservations (id, workspace_id, slot_id, status, metadata)
    values ('res_slot_only', w, 'slot_orig', 'CONFIRMED', '{"bookingStartsAt": "2026-11-12T15:00:00Z"}'::jsonb);

  update public.reservations
  set slot_id = 'slot_new'
  where id = 'res_slot_only';

  assert (select metadata->>'previousBookingStartsAt' = '2026-11-12T15:00:00Z' from public.reservations where id = 'res_slot_only'),
    'slot_id change records current startsAt as previousBookingStartsAt';

  -- -------------------------------------------------------------------------
  -- 2. [검증 2] 두 번 변경 시 매번 직전 값으로 갱신
  -- -------------------------------------------------------------------------
  select updated_at into v_updated_2 from public.reservations where id = 'res_1';

  -- 2차 변경: 14:00 -> 18:00 (클라이언트가 이전 previousBookingStartsAt를 함께 보낸 상황 모사)
  update public.reservations
  set metadata = '{"bookingStartsAt": "2026-11-10T18:00:00Z", "previousBookingStartsAt": "2026-11-10T10:00:00Z"}'::jsonb
  where id = 'res_1';

  assert (select metadata->>'bookingStartsAt' = '2026-11-10T18:00:00Z' from public.reservations where id = 'res_1'),
    'bookingStartsAt updated to 18:00';
  assert (select metadata->>'previousBookingStartsAt' = '2026-11-10T14:00:00Z' from public.reservations where id = 'res_1'),
    'previousBookingStartsAt overwritten with immediate previous value 14:00';
  assert (select updated_at > v_updated_2 from public.reservations where id = 'res_1'),
    'updated_at monotonically increased on 2nd change';

  -- 3차 변경: slot_id 변경 시 직전 값인 18:00으로 다시 갱신
  update public.reservations
  set slot_id = 'slot_2'
  where id = 'res_1';

  assert (select metadata->>'previousBookingStartsAt' = '2026-11-10T18:00:00Z' from public.reservations where id = 'res_1'),
    'previousBookingStartsAt refreshed to 18:00 on 3rd change';

  -- -------------------------------------------------------------------------
  -- 3. [검증 3] 관련 없는 업데이트는 기록 없음 (불필요한 메타데이터 수정 없음)
  -- -------------------------------------------------------------------------
  -- 3-A. CONFIRMED 상태에서 일반 메모/노트만 변경 시 previousBookingStartsAt 키 추가되지 않음
  insert into public.reservations (id, workspace_id, slot_id, status, metadata)
    values ('res_unrelated', w, 'slot_u', 'CONFIRMED', '{"bookingStartsAt": "2026-11-13T10:00:00Z"}'::jsonb);

  update public.reservations
  set metadata = '{"bookingStartsAt": "2026-11-13T10:00:00Z", "note": "customer note"}'::jsonb
  where id = 'res_unrelated';

  assert (select metadata->>'previousBookingStartsAt' is null from public.reservations where id = 'res_unrelated'),
    'unrelated note change does not record previousBookingStartsAt';

  -- 3-B. bookingStartsAt와 startsAt가 둘 다 없는 예약의 slot 변경 시 키를 설정하지 않음
  insert into public.reservations (id, workspace_id, slot_id, status, metadata)
    values ('res_notime', w, 'slot_nt1', 'CONFIRMED', '{}'::jsonb);

  update public.reservations
  set slot_id = 'slot_nt2'
  where id = 'res_notime';

  assert (select metadata->>'previousBookingStartsAt' is null from public.reservations where id = 'res_notime'),
    'no startsAt exists, key must not be created';

  -- 3-C. CANCELLED 상태 예약의 수정 시 기록되지 않음
  insert into public.reservations (id, workspace_id, slot_id, status, metadata)
    values ('res_cancelled', w, 'slot_c1', 'CANCELLED', '{"bookingStartsAt": "2026-11-14T10:00:00Z"}'::jsonb);

  update public.reservations
  set slot_id = 'slot_c2', metadata = '{"bookingStartsAt": "2026-11-14T12:00:00Z"}'::jsonb
  where id = 'res_cancelled';

  assert (select metadata->>'previousBookingStartsAt' is null from public.reservations where id = 'res_cancelled'),
    'CANCELLED reservation update does not record previousBookingStartsAt';

  -- -------------------------------------------------------------------------
  -- 4. [검증 4] Outbox 이벤트 enqueue 라이프사이클 정상 유지
  -- -------------------------------------------------------------------------
  -- res_1: 최초 BOOKING_CONFIRMED 1건 -> 이후 3회 변경으로 총 4건 생성, 이전 3건은 SUPERSEDED, 최신 1건은 READY
  assert (select count(*) = 4 from public.kakao_notification_outbox where reservation_id = 'res_1'),
    'res_1 has 4 outbox rows total';
  assert (select count(*) = 3 from public.kakao_notification_outbox where reservation_id = 'res_1' and status = 'SUPERSEDED'),
    '3 prior events are SUPERSEDED';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_1' and status = 'READY' and event = 'BOOKING_CHANGED'),
    'latest event is BOOKING_CHANGED and READY';

  -- 관련 없는 업데이트(res_unrelated)의 경우 초기 BOOKING_CONFIRMED 1건만 존재해야 함
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_unrelated'),
    'unrelated update does not enqueue new outbox event';

  -- -------------------------------------------------------------------------
  -- 권한 검증: 트리거 함수 실행 권한 격리 (service_role 전용)
  -- -------------------------------------------------------------------------
  assert not has_function_privilege('anon', 'public.kakao_reservation_ensure_monotonic_updated_at()', 'execute'),
    'anon denied monotonic trigger function';
  assert not has_function_privilege('authenticated', 'public.kakao_reservation_ensure_monotonic_updated_at()', 'execute'),
    'authenticated denied monotonic trigger function';
  assert has_function_privilege('service_role', 'public.kakao_reservation_ensure_monotonic_updated_at()', 'execute'),
    'service_role granted monotonic trigger function';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. [검증 5] authenticated 역할로 UPDATE 시 정상 작동 실증
-- PostgreSQL은 테이블 UPDATE 권한이 있으면 INVOKER 트리거 함수를 실행할 수 있음
-- ---------------------------------------------------------------------------
set local role authenticated;

update public.reservations
set metadata = '{"bookingStartsAt": "2026-11-10T20:00:00Z"}'::jsonb
where id = 'res_1';

reset role;

do $$
begin
  assert (select metadata->>'bookingStartsAt' = '2026-11-10T20:00:00Z' from public.reservations where id = 'res_1'),
    'authenticated update succeeded';
  assert (select metadata->>'previousBookingStartsAt' = '2026-11-10T18:00:00Z' from public.reservations where id = 'res_1'),
    'authenticated update recorded previousBookingStartsAt';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_1' and status = 'READY' and event = 'BOOKING_CHANGED'),
    'authenticated update successfully enqueued outbox event';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. [검증 6] ROLLBACK 수행
-- ---------------------------------------------------------------------------
rollback;

\echo 'PASS: kakao_reservation_previous_start migration and outbox trigger lifecycle verified successfully'
