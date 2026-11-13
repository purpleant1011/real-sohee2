-- 임시 로컬 PostgreSQL 전용. 운영/공유 DB에서 실행 금지.
-- psql -X -v ON_ERROR_STOP=1 -h localhost -d template1 -f scripts/test-kakao-outbox-reminders.sql
-- 알림톡 Outbox 방문 일정 리마인더(REMINDER_24H, REMINDER_2H) 트리거 라이프사이클 검증
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

-- authenticated 역할에게 reservations 테이블 DML 권한 부여
grant usage on schema public to authenticated;
grant select, insert, update on public.reservations to authenticated;

-- 마이그레이션 순차 적용: 0400 -> 0500 -> 0600 -> 0700 -> 0800 -> 0900 -> 020000(신규)
\ir ../supabase/migrations/20261106040000_kakao_notification_outbox.sql
\ir ../supabase/migrations/20261106050000_kakao_notification_outbox_rpc.sql
\ir ../supabase/migrations/20261106060000_kakao_notification_policy_evidence.sql
\ir ../supabase/migrations/20261106070000_kakao_outbox_delivery_receipts.sql
\ir ../supabase/migrations/20261106080000_kakao_outbox_delivery_hardening.sql
\ir ../supabase/migrations/20261106090000_kakao_reservation_previous_start.sql
\ir ../supabase/migrations/20261109020000_kakao_outbox_reminders.sql

do $$
declare
  w uuid := '00000000-0000-4000-8000-000000000001';
  v_now timestamptz := statement_timestamp();
  v_start_30h text := to_char((v_now + interval '30 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_start_10h text := to_char((v_now + interval '10 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_start_1h text := to_char((v_now + interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_start_50h text := to_char((v_now + interval '50 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  insert into public.workspaces values (w);

  -- -------------------------------------------------------------------------
  -- [검증 1] 시작 시각이 30시간 뒤인 예약 확정 -> 3행 생성
  -- (BOOKING_CONFIRMED + REMINDER_24H + REMINDER_2H)
  -- -------------------------------------------------------------------------
  insert into public.reservations (id, workspace_id, slot_id, status, metadata)
    values ('res_30h', w, 'slot_30h', 'CONFIRMED', jsonb_build_object('bookingStartsAt', v_start_30h));

  assert (select count(*) = 3 from public.kakao_notification_outbox where reservation_id = 'res_30h'),
    'res_30h: exactly 3 outbox rows enqueued';
  assert (select count(*) = 3 from public.kakao_notification_outbox where reservation_id = 'res_30h' and status = 'READY'),
    'res_30h: all 3 outbox rows are READY';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_30h' and event = 'BOOKING_CONFIRMED'),
    'res_30h: 1 BOOKING_CONFIRMED row exists';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_30h' and event = 'REMINDER_24H'),
    'res_30h: 1 REMINDER_24H row exists';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_30h' and event = 'REMINDER_2H'),
    'res_30h: 1 REMINDER_2H row exists';

  -- due_at 검증: REMINDER_24H는 대략 6시간 뒤, REMINDER_2H는 대략 28시간 뒤
  assert (select due_at > v_now + interval '5 hours' and due_at < v_now + interval '7 hours'
          from public.kakao_notification_outbox where reservation_id = 'res_30h' and event = 'REMINDER_24H'),
    'res_30h: REMINDER_24H due_at is around now + 6 hours';
  assert (select due_at > v_now + interval '27 hours' and due_at < v_now + interval '29 hours'
          from public.kakao_notification_outbox where reservation_id = 'res_30h' and event = 'REMINDER_2H'),
    'res_30h: REMINDER_2H due_at is around now + 28 hours';

  -- -------------------------------------------------------------------------
  -- [검증 2] 시작 시각이 10시간 뒤인 예약 확정 -> 2행 생성
  -- (BOOKING_CONFIRMED + REMINDER_2H; 24H는 과거이므로 미적재)
  -- -------------------------------------------------------------------------
  insert into public.reservations (id, workspace_id, slot_id, status, metadata)
    values ('res_10h', w, 'slot_10h', 'CONFIRMED', jsonb_build_object('bookingStartsAt', v_start_10h));

  assert (select count(*) = 2 from public.kakao_notification_outbox where reservation_id = 'res_10h'),
    'res_10h: exactly 2 outbox rows enqueued';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_10h' and event = 'BOOKING_CONFIRMED'),
    'res_10h: 1 BOOKING_CONFIRMED row exists';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_10h' and event = 'REMINDER_2H'),
    'res_10h: 1 REMINDER_2H row exists';
  assert (select count(*) = 0 from public.kakao_notification_outbox where reservation_id = 'res_10h' and event = 'REMINDER_24H'),
    'res_10h: 0 REMINDER_24H row (past due_at not enqueued)';

  -- -------------------------------------------------------------------------
  -- [검증 3] 시작 시각이 1시간 뒤인 예약 확정 -> 1행 생성
  -- (BOOKING_CONFIRMED만 적재; 24H, 2H 둘 다 과거이므로 미적재)
  -- -------------------------------------------------------------------------
  insert into public.reservations (id, workspace_id, slot_id, status, metadata)
    values ('res_1h', w, 'slot_1h', 'CONFIRMED', jsonb_build_object('bookingStartsAt', v_start_1h));

  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_1h'),
    'res_1h: exactly 1 outbox row enqueued (CONFIRMED only)';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_1h' and event = 'BOOKING_CONFIRMED'),
    'res_1h: 1 BOOKING_CONFIRMED row exists';
  assert (select count(*) = 0 from public.kakao_notification_outbox where reservation_id = 'res_1h' and event in ('REMINDER_24H', 'REMINDER_2H')),
    'res_1h: 0 reminders enqueued since both due dates are in the past';

  -- -------------------------------------------------------------------------
  -- [검증 4] 예약 변경: res_30h의 시작일시를 50시간 뒤로 변경
  -- - 기존 3행(CONFIRMED, 24H, 2H)은 전부 SUPERSEDED 전이
  -- - 신규 3행(BOOKING_CHANGED, 50h 기준 24H, 2H)이 READY로 적재
  -- -------------------------------------------------------------------------
  update public.reservations
  set metadata = jsonb_build_object('bookingStartsAt', v_start_50h)
  where id = 'res_30h';

  assert (select count(*) = 6 from public.kakao_notification_outbox where reservation_id = 'res_30h'),
    'res_30h: 6 total rows after change (3 old + 3 new)';
  assert (select count(*) = 3 from public.kakao_notification_outbox where reservation_id = 'res_30h' and status = 'SUPERSEDED'),
    'res_30h: 3 prior rows marked SUPERSEDED';
  assert (select count(*) = 3 from public.kakao_notification_outbox where reservation_id = 'res_30h' and status = 'READY'),
    'res_30h: 3 new rows are READY';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_30h' and status = 'READY' and event = 'BOOKING_CHANGED'),
    'res_30h: new BOOKING_CHANGED row is READY';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_30h' and status = 'READY' and event = 'REMINDER_24H'),
    'res_30h: new REMINDER_24H row is READY (scheduled for 50h - 24h = 26h later)';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_30h' and status = 'READY' and event = 'REMINDER_2H'),
    'res_30h: new REMINDER_2H row is READY (scheduled for 50h - 2h = 48h later)';

  -- -------------------------------------------------------------------------
  -- [검증 5] 예약 취소: res_10h를 CANCELLED로 전이
  -- - 기존 2행(CONFIRMED, 2H)은 SUPERSEDED 전이
  -- - 신규 1행(BOOKING_CANCELLED)만 적재 (리마인더는 적재되지 않음)
  -- -------------------------------------------------------------------------
  update public.reservations
  set status = 'CANCELLED'
  where id = 'res_10h';

  assert (select count(*) = 3 from public.kakao_notification_outbox where reservation_id = 'res_10h'),
    'res_10h: 3 total rows after cancel (2 old + 1 cancel)';
  assert (select count(*) = 2 from public.kakao_notification_outbox where reservation_id = 'res_10h' and status = 'SUPERSEDED'),
    'res_10h: 2 prior rows marked SUPERSEDED';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_10h' and status = 'READY'),
    'res_10h: exactly 1 new row is READY';
  assert (select count(*) = 1 from public.kakao_notification_outbox where reservation_id = 'res_10h' and status = 'READY' and event = 'BOOKING_CANCELLED'),
    'res_10h: only BOOKING_CANCELLED is READY, no reminders for cancelled booking';

  -- -------------------------------------------------------------------------
  -- [검증 6] CHECK 제약조건 검증 (REMINDER_24H, REMINDER_2H 유효 및 기타 거부)
  -- -------------------------------------------------------------------------
  assert (select count(*) >= 2 from pg_constraint where conname = 'kakao_notification_outbox_event_check' or conrelid = 'public.kakao_notification_outbox'::regclass),
    'kakao_notification_outbox_event_check constraint exists';
end;
$$;

rollback;

\echo 'PASS: kakao outbox reminder events (REMINDER_24H, REMINDER_2H) lifecycle verified successfully'
