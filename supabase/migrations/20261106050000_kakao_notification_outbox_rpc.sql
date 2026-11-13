-- ============================================================================
-- 알림톡 발송 아웃박스 원자적 RPC (Kakao Notification Outbox RPCs)
--
-- [운영 및 보안 가이드라인]
-- 1. 초안(Draft) — DB 직접 적용 금지. 본 파일은 설계 검증용 초안 적용승인필요 상태이며, 운영 적용 시 별도 승인이 필요합니다.
-- 2. live 자동 시작 아님 — 마이그레이션이 적용되더라도 디스패처/워커는 자동으로 live 시작되지 않으며 플래그 및 환경변수로 제어됩니다.
-- 3. 개인정보 보호 철칙 (Privacy by Design) — RPC 파라미터 및 반환값에 수신자 이름, 전화번호, 템플릿 본문 등 PII를 일체 포함하지 않습니다.
-- 4. 락 점유(claim) / CAS 전이(mark_sending) / 종료(finish) / 만료 회수(expire) 경계 분리.
-- ============================================================================

-- 1. 작업 선점 RPC: claim_kakao_notification_job -----------------------------
-- READY 상태이며 due_at <= now()인 건, 또는 lease가 만료된 CLAIMED 건만 CLAIMED로 선점합니다.
-- SENDING / UNKNOWN / SENT / BLOCKED / SUPERSEDED / FAILED 상태는 절대 재claim할 수 없습니다.
create or replace function public.claim_kakao_notification_job(
  p_job_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_job_id is null or p_lease_token is null then
    return false;
  end if;

  update public.kakao_notification_outbox
  set
    status = 'CLAIMED',
    lease_token = p_lease_token,
    lease_until = statement_timestamp() + interval '60 seconds',
    updated_at = statement_timestamp()
  where id = p_job_id
    and (
      (status = 'READY' and due_at <= statement_timestamp())
      or
      (status = 'CLAIMED' and lease_until < statement_timestamp())
    )
    and status not in ('SENDING', 'UNKNOWN', 'SENT', 'BLOCKED', 'SUPERSEDED', 'FAILED');

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.claim_kakao_notification_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_kakao_notification_job(uuid, uuid) to service_role;

-- 2. 발송 시작 CAS RPC: mark_kakao_notification_sending ---------------------
-- CLAIMED 상태이고 유효한 lease_token 및 유효 lease_until을 보유하며,
-- reservations 원본의 workspace_id, id, updated_at이 job의 참조 버전과 현재 일치하고
-- 이벤트별 예약 상태(CONFIRMED/CHANGED는 CONFIRMED, CANCELLED는 CANCELLED)가 부합할 때만 SENDING으로 전이합니다.
create or replace function public.mark_kakao_notification_sending(
  p_job_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_job_id is null or p_lease_token is null then
    return false;
  end if;

  update public.kakao_notification_outbox o
  set
    status = 'SENDING',
    lease_until = statement_timestamp() + interval '60 seconds',
    updated_at = statement_timestamp()
  from public.reservations r
  where o.id = p_job_id
    and o.lease_token = p_lease_token
    and o.status = 'CLAIMED'
    and o.lease_until >= statement_timestamp()
    and r.id = o.reservation_id
    and r.workspace_id = o.workspace_id
    and r.updated_at = o.reservation_updated_at
    and (
      (o.event in ('BOOKING_CONFIRMED', 'BOOKING_CHANGED') and r.status = 'CONFIRMED')
      or
      (o.event = 'BOOKING_CANCELLED' and r.status = 'CANCELLED')
    );

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.mark_kakao_notification_sending(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_kakao_notification_sending(uuid, uuid) to service_role;

-- 3. 작업 종료 RPC: finish_kakao_notification_job ----------------------------
-- token 일치 검증 후:
-- - 현재 CLAIMED 상태일 땐 BLOCKED 또는 SUPERSEDED만 허용
-- - 현재 SENDING 상태일 땐 SENT 또는 UNKNOWN만 허용
-- 종료 시 lease_token 및 lease_until을 해제(null)합니다.
-- reason_code는 대문자, 숫자, 언더스코어로 구성되며 최대 64자로 제한됩니다.
create or replace function public.finish_kakao_notification_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_reason_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_job_id is null or p_lease_token is null or p_status is null or p_reason_code is null then
    return false;
  end if;

  -- reason_code 정규식 및 길이 검증
  if not (p_reason_code ~ '^[A-Z0-9_]{1,64}$') then
    return false;
  end if;

  -- 상태 전이 유효성 검증
  if p_status not in ('BLOCKED', 'SUPERSEDED', 'SENT', 'UNKNOWN') then
    return false;
  end if;

  update public.kakao_notification_outbox
  set
    status = p_status,
    reason_code = p_reason_code,
    lease_token = null,
    lease_until = null,
    updated_at = statement_timestamp()
  where id = p_job_id
    and lease_token = p_lease_token
    and (
      (status = 'CLAIMED' and p_status in ('BLOCKED', 'SUPERSEDED'))
      or
      (status = 'SENDING' and p_status in ('SENT', 'UNKNOWN'))
    );

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.finish_kakao_notification_job(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_kakao_notification_job(uuid, uuid, text, text) to service_role;

-- 4. 만료 복구 RPC: expire_kakao_notification_jobs ---------------------------
-- SENDING 상태에서 lease_until이 만료된 건만 UNKNOWN으로 안전 전이합니다 (결과 불명 확인 필요).
-- READY 건은 절대 건드리지 않으며, NEVER READY로 전이합니다.
create or replace function public.expire_kakao_notification_jobs()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.kakao_notification_outbox
  set
    status = 'UNKNOWN',
    reason_code = coalesce(reason_code, 'SENDING_LEASE_EXPIRED'),
    lease_token = null,
    lease_until = null,
    updated_at = statement_timestamp()
  where status = 'SENDING'
    and lease_until < statement_timestamp();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.expire_kakao_notification_jobs() from public, anon, authenticated;
grant execute on function public.expire_kakao_notification_jobs() to service_role;
