-- ============================================================================
-- 알림톡 아웃박스 수신확인 파라미터 및 원장 하드닝 (Kakao Notification Outbox Delivery Hardening)
--
-- [운영 및 보안 가이드라인]
-- 1. 초안(Draft) — DB 직접 적용 금지. 본 파일은 설계 검증용 초안 적용승인필요 상태이며, 운영 적용 시 별도 승인이 필요합니다.
-- 2. 입력 무결성 및 DoS 방지 — record_kakao_outbox_delivery RPC의 p_status_code(trim 후 1~32자),
--    p_message_id(trim 후 1~128자)의 허용문자 [A-Za-z0-9_.-]를 엄격히 제한하고 위반 시 false를 반환합니다(예외 발생 차단).
-- 3. 기존 데이터 무결성 보존 — 테이블 컬럼 check 제약조건은 NOT VALID로 추가하여 하위 호환성을 보장합니다.
-- 4. 0400~0700 기존 마이그레이션 무수정 원칙 준수.
-- ============================================================================

-- 1. 컬럼 형식 CHECK 제약조건 추가 (NOT VALID) --------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kakao_notification_outbox_delivery_status_code_check'
  ) then
    alter table public.kakao_notification_outbox
      add constraint kakao_notification_outbox_delivery_status_code_check
      check (delivery_status_code is null or delivery_status_code ~ '^[A-Za-z0-9_.-]{1,32}$')
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'kakao_notification_outbox_provider_message_id_check'
  ) then
    alter table public.kakao_notification_outbox
      add constraint kakao_notification_outbox_provider_message_id_check
      check (provider_message_id is null or provider_message_id ~ '^[A-Za-z0-9_.-]{1,128}$')
      not valid;
  end if;
end $$;

-- 2. DLR 반영 RPC 하드닝: record_kakao_outbox_delivery ------------------------
create or replace function public.record_kakao_outbox_delivery(
  p_job_id uuid,
  p_message_id text,
  p_status text,
  p_status_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_count integer;
  v_trimmed_msg text;
  v_trimmed_code text;
begin
  -- 파라미터 유효성 검증
  if p_job_id is null or p_status is null or p_status not in ('DELIVERED', 'FAILED') then
    return false;
  end if;

  v_trimmed_code := trim(p_status_code);
  if v_trimmed_code is null or not (v_trimmed_code ~ '^[A-Za-z0-9_.-]{1,32}$') then
    return false;
  end if;

  v_trimmed_msg := trim(p_message_id);
  if v_trimmed_msg is null or not (v_trimmed_msg ~ '^[A-Za-z0-9_.-]{1,128}$') then
    return false;
  end if;

  -- 다른 job과의 messageId 충돌 검증
  if exists (
    select 1 from public.kakao_notification_outbox
    where provider_message_id = v_trimmed_msg
      and id <> p_job_id
  ) then
    return false;
  end if;

  -- 원자적 UPDATE
  begin
    update public.kakao_notification_outbox
    set
      delivery_status = p_status,
      provider_message_id = coalesce(v_trimmed_msg, provider_message_id),
      delivery_status_code = v_trimmed_code,
      delivered_at = case
        when p_status = 'DELIVERED' then coalesce(delivered_at, statement_timestamp())
        else delivered_at
      end,
      updated_at = statement_timestamp()
    where id = p_job_id
      and status in ('SENDING', 'SENT', 'UNKNOWN')
      and (
        delivery_status is null
        or (delivery_status = 'FAILED' and p_status = 'DELIVERED')
      )
      and (
        provider_message_id is null
        or provider_message_id = v_trimmed_msg
      );

    get diagnostics v_count = row_count;
    return v_count = 1;
  exception
    when unique_violation or check_violation then
      return false;
  end;
end;
$$;

revoke all on function public.record_kakao_outbox_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_kakao_outbox_delivery(uuid, text, text, text) to service_role;
