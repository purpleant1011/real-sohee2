-- ============================================================================
-- 알림톡 발송 아웃박스 결제 완료 안내(PAYMENT_CONFIRMED) 추가 및 payment_captures 트리거
--
-- [운영 및 보안 가이드라인]
-- 1. 초안(Draft) — DB 직접 적용 금지. 본 파일은 설계 검증용 초안 적용승인필요 상태이며, 운영 적용 시 별도 승인이 필요합니다.
-- 2. live 자동 시작 아님 — 마이그레이션이 적용되더라도 디스패처/워커는 플래그 및 환경변수로 제어됩니다.
-- 3. 개인정보 보호 철칙 (Privacy by Design) — 수신자 이름, 전화번호, 페이로드 원문 컬럼 저장 금지 원칙을 불변으로 유지합니다.
-- 4. Fail-Open 철칙 — 알림톡 대기열 적재 실패가 결제 원장 기록(payment_captures INSERT)을 절대 방해하지 않습니다.
-- 5. 결제 알림톡은 결제가 실제로 확정된 단일 사건(payment_captures LIVE)에서만 발생하며, deposit_krw 컬럼만 보고 절대 발송하지 않습니다.
-- ============================================================================

-- 1. payment_captures 및 deposit_intents dataset_mode 제약 확장 ('TEST', 'LIVE' 허용)
alter table public.payment_captures
  drop constraint if exists payment_captures_dataset_mode_check;

alter table public.payment_captures
  add constraint payment_captures_dataset_mode_check
  check (dataset_mode in ('TEST', 'LIVE'));

alter table public.deposit_intents
  drop constraint if exists deposit_intents_dataset_mode_check;

alter table public.deposit_intents
  add constraint deposit_intents_dataset_mode_check
  check (dataset_mode in ('TEST', 'LIVE'));

-- 2. 아웃박스 event CHECK 제약조건 확장 (PAYMENT_CONFIRMED 추가) ----------------
alter table public.kakao_notification_outbox
  drop constraint if exists kakao_notification_outbox_event_check;

alter table public.kakao_notification_outbox
  add constraint kakao_notification_outbox_event_check
  check (event in (
    'BOOKING_CONFIRMED',
    'BOOKING_CHANGED',
    'BOOKING_CANCELLED',
    'REMINDER_24H',
    'REMINDER_2H',
    'PAYMENT_CONFIRMED'
  ));

-- 3. 아웃박스 payment_capture_id 컬럼 및 멱등 유니크 인덱스 추가 ----------------
alter table public.kakao_notification_outbox
  add column if not exists payment_capture_id uuid references public.payment_captures (id) on delete set null;

create unique index if not exists kakao_notification_outbox_payment_capture_uniq
  on public.kakao_notification_outbox (workspace_id, payment_capture_id)
  where payment_capture_id is not null;

-- 4. payment_captures AFTER INSERT Outbox Enqueue 트리거 함수 -----------------
create or replace function public.kakao_enqueue_payment_confirmed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_intent public.deposit_intents%rowtype;
  v_reservation public.reservations%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  -- 1. LIVE (운영 결제) 사건만 취급 (TEST 결제는 알림톡 대기열 적재 원천 차단)
  if NEW.dataset_mode is distinct from 'LIVE' then
    return NEW;
  end if;

  -- 2. 결제 기록 실패를 원천 방지하기 위해 fail-open 블록으로 감싼다.
  begin
    -- 3. intent 및 연결된 예약 조회
    select * into v_intent
    from public.deposit_intents
    where workspace_id = NEW.workspace_id
      and id = NEW.intent_id;

    if not found or v_intent.booking_id is null or trim(v_intent.booking_id) = '' then
      return NEW;
    end if;

    select * into v_reservation
    from public.reservations
    where workspace_id = NEW.workspace_id
      and id = v_intent.booking_id;

    -- 4. 연결된 예약이 존재하고 CONFIRMED 상태인 경우만 발송 대기열 적재
    if not found or v_reservation.status <> 'CONFIRMED' then
      return NEW;
    end if;

    -- 5. Outbox 적재 (동일 capture_id 및 동일 reservation_updated_at 멱등성 보장)
    insert into public.kakao_notification_outbox (
      workspace_id,
      reservation_id,
      reservation_updated_at,
      event,
      payment_capture_id,
      due_at,
      status,
      created_at,
      updated_at
    ) values (
      NEW.workspace_id,
      v_reservation.id,
      v_reservation.updated_at,
      'PAYMENT_CONFIRMED',
      NEW.id,
      v_now,
      'READY',
      v_now,
      v_now
    )
    on conflict do nothing;

  exception when others then
    -- fail-open: 어떤 예외가 발생하더라도 결제 기록(payment_captures INSERT)은 절대 롤백시키지 않는다.
    raise warning 'kakao payment outbox enqueue skipped (sqlstate %)', sqlstate;
  end;

  return NEW;
end;
$$;

revoke execute on function public.kakao_enqueue_payment_confirmed() from public, anon, authenticated;
grant execute on function public.kakao_enqueue_payment_confirmed() to service_role;

drop trigger if exists trg_kakao_enqueue_payment_confirmed on public.payment_captures;
create trigger trg_kakao_enqueue_payment_confirmed
  after insert on public.payment_captures
  for each row
  execute function public.kakao_enqueue_payment_confirmed();
