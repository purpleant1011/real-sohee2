-- ============================================================================
-- 알림톡 아웃박스 SENDING -> BLOCKED 전이 허용 RPC 하드닝 (Kakao Finish Sending Blocked)
--
-- [운영 및 보안 가이드라인]
-- 1. 초안(Draft) — DB 직접 적용 금지. 본 파일은 설계 검증용 초안 적용승인필요 상태이며, 운영 적용 시 별도 승인이 필요합니다.
-- 2. outbox-processor 사전검증 실패(notSent=true) 시 SENDING -> BLOCKED 안전 전이 지원.
-- 3. 토큰·lease 검사는 기존과 동일하게 유지하며, 종료 시 lease_token 및 lease_until을 해제(null)합니다.
-- 4. reason_code 필수 및 대문자/숫자/언더스코어 정규식(1~64자) 준수.
-- 5. SENDING 상태에서는 SENT / UNKNOWN / BLOCKED 외의 상태로 전이 불가.
-- 6. 권한: anon, authenticated 실행 불가 / service_role 만 실행 가능.
-- 7. 0400~0900 기존 마이그레이션 무수정 원칙 준수.
-- ============================================================================

-- 작업 종료 RPC: finish_kakao_notification_job 재정의 ------------------------
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
      (status = 'SENDING' and p_status in ('SENT', 'UNKNOWN', 'BLOCKED'))
    );

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.finish_kakao_notification_job(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_kakao_notification_job(uuid, uuid, text, text) to service_role;
