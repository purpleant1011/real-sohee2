-- ============================================================================
-- 알림톡 발송 아웃박스 원장 (Kakao Notification Outbox) 및 예약 라이프사이클 트리거
--
-- [운영 및 보안 가이드라인]
-- 1. 초안(Draft) — DB 직접 적용 금지. 본 파일은 설계 검증용 초안 적용승인필요 상태이며, 운영 적용 시 별도 승인이 필요합니다.
-- 2. live 자동 시작 아님 — 마이그레이션이 적용되더라도 디스패처/워커는 자동으로 live 시작되지 않으며 플래그 및 환경변수로 제어됩니다.
-- 3. 개인정보 보호 철칙 (Privacy by Design) — 수신자 이름, 전화번호, 템플릿 본문/페이로드 원문 컬럼 저장을 원천 금지합니다.
--    발송 워커가 해당 레코드를 claim할 때 원본 reservations 및 고객 식별자를 격리된 트랜잭션에서 조회하여 일회성 발송합니다.
-- 4. claim / dispatch RPC 경계 분리 — 락 점유(claim) 및 발송 완료(dispatch/finish) RPC는 본 마이그레이션에 포함하지 않으며
--    후속 마이그레이션에서 독립적으로 관리됩니다.
--
-- [updated_at 자동 증가 vs 안전 거부 선택 근거 (Decision Rationale)]
-- 원본 reservations 테이블 업데이트 시 relevant change(CONFIRMED, CANCELLED, 또는 CONFIRMED 상태에서 slot_id, bookingStartsAt/startsAt 변경)가
-- 발생했음에도 updated_at가 증가하지 않은 경우:
--   - 선택: "트리거에서 relevant change일 때 updated_at를 단조 증가(monotonic increment)시켜 version 충돌 방지"
--   - 선택 근거:
--     1) 버전 무결성: 아웃박스의 UNIQUE(workspace_id, reservation_id, reservation_updated_at, event) 제약조건과
--        Outbox Processor의 Double-Read 및 CAS 버전 검증은 예약의 updated_at가 매 상태 변경마다 단조 증가함을 전제로 합니다.
--     2) 가용성 및 하위 호환성: 안전 거부(raise exception)를 적용하면 클라이언트나 ORM이 updated_at를 명시적으로 지정하지 않은
--        기존의 정상적인 예약 변경 쿼리 전체가 예외와 함께 트랜잭션 롤백되어 서비스 장애로 이어집니다.
--     3) 따라서 BEFORE UPDATE 트리거에서 relevant change 시점을 정밀 감지하여 updated_at <= OLD.updated_at일 때
--        greatest(statement_timestamp(), OLD.updated_at + interval '1 millisecond')로 강제 단조 증가시키는 방식을 채택합니다.
-- ============================================================================

-- 1. 아웃박스 테이블 생성 ----------------------------------------------------
create table public.kakao_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  reservation_id text not null references public.reservations (id) on delete cascade,
  reservation_updated_at timestamptz not null,
  event text not null check (event in ('BOOKING_CONFIRMED', 'BOOKING_CHANGED', 'BOOKING_CANCELLED')),
  due_at timestamptz not null default statement_timestamp(),
  status text not null default 'READY' check (status in ('READY', 'CLAIMED', 'SENDING', 'SENT', 'UNKNOWN', 'BLOCKED', 'SUPERSEDED', 'FAILED')),
  lease_token uuid,
  lease_until timestamptz,
  reason_code text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint kakao_notification_outbox_unique_event unique (workspace_id, reservation_id, reservation_updated_at, event)
);

-- 인덱스: 워커 대기열 폴링 가속 (READY 상태 건 정렬 조회)
create index kakao_notification_outbox_poll_idx
  on public.kakao_notification_outbox (status, due_at)
  where status = 'READY';

-- 인덱스: 동일 예약의 이전 미발송 건 일괄 SUPERSEDED 전이 가속
create index kakao_notification_outbox_reservation_idx
  on public.kakao_notification_outbox (workspace_id, reservation_id, status);

-- 인덱스: 점유 리스 토큰 역조회 가속
create index kakao_notification_outbox_lease_token_idx
  on public.kakao_notification_outbox (lease_token)
  where lease_token is not null;

-- 2. RLS 활성화 및 권한 격리 (service_role 전용) -------------------------------
alter table public.kakao_notification_outbox enable row level security;

revoke all on public.kakao_notification_outbox from public, anon, authenticated;
grant all on public.kakao_notification_outbox to service_role;

create policy "service role full access on kakao_notification_outbox"
  on public.kakao_notification_outbox
  for all
  to service_role
  using (true)
  with check (true);

-- 3. 예약 updated_at 단조 증가 보장 BEFORE UPDATE 트리거 ---------------------
create or replace function public.kakao_reservation_ensure_monotonic_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_is_relevant boolean := false;
begin
  -- 관련 변경 판별
  if (NEW.status = 'CONFIRMED' and (OLD.status is distinct from 'CONFIRMED')) or
     (NEW.status = 'CANCELLED' and (OLD.status is distinct from 'CANCELLED')) then
    v_is_relevant := true;
  elsif (NEW.status = 'CONFIRMED' and OLD.status = 'CONFIRMED') and (
    (NEW.slot_id is distinct from OLD.slot_id) or
    (NEW.metadata->>'bookingStartsAt' is distinct from OLD.metadata->>'bookingStartsAt') or
    (NEW.metadata->>'startsAt' is distinct from OLD.metadata->>'startsAt')
  ) then
    v_is_relevant := true;
  end if;

  -- 관련 변경인데 updated_at가 증가하지 않은 경우 버전 충돌 방지 단조 증가 처리
  if v_is_relevant and (NEW.updated_at <= OLD.updated_at) then
    NEW.updated_at := greatest(statement_timestamp(), OLD.updated_at + interval '1 millisecond');
  end if;

  return NEW;
end;
$$;

revoke execute on function public.kakao_reservation_ensure_monotonic_updated_at() from public, anon, authenticated;
grant execute on function public.kakao_reservation_ensure_monotonic_updated_at() to service_role;

drop trigger if exists trg_kakao_reservation_ensure_monotonic_updated_at on public.reservations;
create trigger trg_kakao_reservation_ensure_monotonic_updated_at
  before update on public.reservations
  for each row
  execute function public.kakao_reservation_ensure_monotonic_updated_at();

-- 4. 예약 라이프사이클 이벤트 Outbox Enqueue AFTER 트리거 --------------------
create or replace function public.kakao_enqueue_reservation_outbox()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event text := null;
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
  -- 실패하면 해당 이벤트는 대기열에 없으므로 알림이 발송되지 않는다(안전한 방향).
  begin
    -- 동일 예약의 이전 READY 및 CLAIMED 상태 건은 SUPERSEDED 처리 (SENDING은 외부 통신 진행 중이므로 건드리지 않음)
    update public.kakao_notification_outbox
    set
      status = 'SUPERSEDED',
      reason_code = 'SUPERSEDED_BY_NEWER_EVENT',
      lease_token = null,
      lease_until = null,
      updated_at = statement_timestamp()
    where reservation_id = NEW.id
      and workspace_id = NEW.workspace_id
      and status in ('READY', 'CLAIMED');

    -- 신규 Outbox 이벤트 적재
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
      statement_timestamp(),
      'READY',
      statement_timestamp(),
      statement_timestamp()
    );

  exception when others then
    raise warning 'kakao outbox enqueue skipped (sqlstate %)', sqlstate;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_kakao_enqueue_reservation_outbox on public.reservations;
create trigger trg_kakao_enqueue_reservation_outbox
  after insert or update on public.reservations
  for each row
  execute function public.kakao_enqueue_reservation_outbox();

revoke execute on function public.kakao_enqueue_reservation_outbox() from public, anon, authenticated;
grant execute on function public.kakao_enqueue_reservation_outbox() to service_role;

