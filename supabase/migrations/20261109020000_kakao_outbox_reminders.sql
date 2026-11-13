-- ============================================================================
-- 알림톡 발송 아웃박스 방문 일정 리마인더(REMINDER_24H, REMINDER_2H) 추가 및 트리거 확장
--
-- [운영 및 보안 가이드라인]
-- 1. 초안(Draft) — DB 직접 적용 금지. 본 파일은 설계 검증용 초안 적용승인필요 상태이며, 운영 적용 시 별도 승인이 필요합니다.
-- 2. live 자동 시작 아님 — 마이그레이션이 적용되더라도 디스패처/워커는 플래그 및 환경변수로 제어됩니다.
-- 3. 개인정보 보호 철칙 (Privacy by Design) — 수신자 이름, 전화번호, 페이로드 원문 컬럼 저장 금지 원칙을 불변으로 유지합니다.
--
-- [결제완료 PAYMENT_CONFIRMED 범위 제외 사유]
-- reservations 테이블에 결제 확정을 나타내는 신뢰할 컬럼(결제 상태/승인 시각 등)이 없어
-- 잘못된 결제 완료 알림 오발송 위험을 방지하기 위해 이번 마이그레이션 범위에서 제외합니다.
-- 추후 결제 시스템 연동 및 원장 고도화 시점에 독립 마이그레이션으로 추가합니다.
--
-- [리마인더 스케줄링 및 즉시 오발송 방지 원칙]
-- 1. due_at = 예약시작 - 24시간(REMINDER_24H) 및 예약시작 - 2시간(REMINDER_2H).
-- 2. 이미 지난 due_at(due_at <= statement_timestamp())인 경우 적재하지 않습니다 (과거 리마인더 즉시 오발송 원천 차단).
-- 3. 예약 변경(BOOKING_CHANGED) 또는 예약 취소(BOOKING_CANCELLED) 시 기존의 READY 및 CLAIMED 상태인
--    리마인더는 SUPERSEDED 처리되며, 변경 시 새 예약 시작 시각 기준으로 미래 리마인더가 재적재됩니다.
-- ============================================================================

-- 1. 아웃박스 event CHECK 제약조건 확장 (REMINDER_24H, REMINDER_2H 추가) -------
alter table public.kakao_notification_outbox
  drop constraint if exists kakao_notification_outbox_event_check;

alter table public.kakao_notification_outbox
  add constraint kakao_notification_outbox_event_check
  check (event in (
    'BOOKING_CONFIRMED',
    'BOOKING_CHANGED',
    'BOOKING_CANCELLED',
    'REMINDER_24H',
    'REMINDER_2H'
  ));

-- 2. 예약 라이프사이클 Outbox Enqueue 트리거 함수 확장 -----------------------
create or replace function public.kakao_enqueue_reservation_outbox()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event text := null;
  v_start_text text := null;
  v_start_time timestamptz := null;
  v_due_24h timestamptz := null;
  v_due_2h timestamptz := null;
  v_now timestamptz := statement_timestamp();
begin
  -- (1) INSERT 이벤트 감지
  if TG_OP = 'INSERT' then
    if NEW.status = 'CONFIRMED' then
      v_event := 'BOOKING_CONFIRMED';
    end if;

  -- (2) UPDATE 이벤트 감지
  elsif TG_OP = 'UPDATE' then
    -- CONFIRMED로 상태 전이
    if NEW.status = 'CONFIRMED' and (OLD.status is distinct from 'CONFIRMED') then
      v_event := 'BOOKING_CONFIRMED';
    -- CANCELLED로 상태 전이
    elsif NEW.status = 'CANCELLED' and (OLD.status is distinct from 'CANCELLED') then
      v_event := 'BOOKING_CANCELLED';
    -- CONFIRMED 상태 유지 중 슬롯 또는 시작일시 변경
    elsif (NEW.status = 'CONFIRMED' and OLD.status = 'CONFIRMED') and (
      (NEW.slot_id is distinct from OLD.slot_id) or
      (NEW.metadata->>'bookingStartsAt' is distinct from OLD.metadata->>'bookingStartsAt') or
      (NEW.metadata->>'startsAt' is distinct from OLD.metadata->>'startsAt')
    ) then
      v_event := 'BOOKING_CHANGED';
    end if;
  end if;

  -- 관련 없는 변경(예: 단순 메모, proof_id 변경 등)은 enqueue하지 않고 즉시 반환
  if v_event is null then
    return NEW;
  end if;

  -- 알림 대기열 적재 실패가 운영 예약 저장을 막지 않도록 fail-open 처리한다.
  begin
    -- 동일 예약의 이전 READY 및 CLAIMED 상태 건은 SUPERSEDED 처리 (리마인더 포함)
    -- SENDING은 외부 통신 진행 중이므로 건드리지 않음
    update public.kakao_notification_outbox
    set
      status = 'SUPERSEDED',
      reason_code = 'SUPERSEDED_BY_NEWER_EVENT',
      lease_token = null,
      lease_until = null,
      updated_at = v_now
    where reservation_id = NEW.id
      and workspace_id = NEW.workspace_id
      and status in ('READY', 'CLAIMED');

    -- 메인 라이프사이클 이벤트 Outbox 적재
    insert into public.kakao_notification_outbox (
      workspace_id,
      reservation_id,
      reservation_updated_at,
      event,
      due_at,
      status,
      created_at,
      updated_at
    ) values (
      NEW.workspace_id,
      NEW.id,
      NEW.updated_at,
      v_event,
      v_now,
      'READY',
      v_now,
      v_now
    );

    -- 예약 확정 또는 변경 시 방문 리마인더(REMINDER_24H, REMINDER_2H) 미래 시점 적재
    if v_event in ('BOOKING_CONFIRMED', 'BOOKING_CHANGED') then
      v_start_text := coalesce(NEW.metadata->>'bookingStartsAt', NEW.metadata->>'startsAt');

      if v_start_text is not null and trim(v_start_text) <> '' then
        begin
          v_start_time := v_start_text::timestamptz;
          v_due_24h := v_start_time - interval '24 hours';
          v_due_2h := v_start_time - interval '2 hours';

          -- 24시간 전 리마인더 (due_at > statement_timestamp() 미래 건만 적재)
          if v_due_24h > v_now then
            insert into public.kakao_notification_outbox (
              workspace_id,
              reservation_id,
              reservation_updated_at,
              event,
              due_at,
              status,
              created_at,
              updated_at
            ) values (
              NEW.workspace_id,
              NEW.id,
              NEW.updated_at,
              'REMINDER_24H',
              v_due_24h,
              'READY',
              v_now,
              v_now
            );
          end if;

          -- 2시간 전 리마인더 (due_at > statement_timestamp() 미래 건만 적재)
          if v_due_2h > v_now then
            insert into public.kakao_notification_outbox (
              workspace_id,
              reservation_id,
              reservation_updated_at,
              event,
              due_at,
              status,
              created_at,
              updated_at
            ) values (
              NEW.workspace_id,
              NEW.id,
              NEW.updated_at,
              'REMINDER_2H',
              v_due_2h,
              'READY',
              v_now,
              v_now
            );
          end if;
        exception when others then
          raise warning 'kakao reminder enqueue skipped (sqlstate %)', sqlstate;
        end;
      end if;
    end if;

  exception when others then
    raise warning 'kakao outbox enqueue skipped (sqlstate %)', sqlstate;
  end;

  return NEW;
end;
$$;

revoke execute on function public.kakao_enqueue_reservation_outbox() from public, anon, authenticated;
grant execute on function public.kakao_enqueue_reservation_outbox() to service_role;
