-- ============================================================================
-- 알림톡 아웃박스 수신확인 원장 확장 (Kakao Notification Outbox Delivery Receipts)
--
-- [운영 및 보안 가이드라인]
-- 1. 초안(Draft) — DB 직접 적용 금지. 본 파일은 설계 검증용 초안 적용승인필요 상태이며, 운영 적용 시 별도 승인이 필요합니다.
-- 2. outbox.status 불변 — 워커 리스 점유 및 발송 라이프사이클(lease/send status)은 일체 변경하지 않으며,
--    수신확인 전용 delivery_status, provider_message_id, delivery_status_code, delivered_at를 격리 관리합니다.
-- 3. 개인정보 보호 철칙 (Privacy by Design) — 전화번호(raw phone) 및 알림톡 본문(body) 컬럼 및 파라미터 저장을 원천 금지합니다.
-- 4. 0400 기존 마이그레이션 무수정 원칙 준수.
-- ============================================================================

-- 1. 아웃박스 수신확인 컬럼 추가 ---------------------------------------------
alter table public.kakao_notification_outbox
  add column if not exists delivery_status text check (delivery_status in ('DELIVERED', 'FAILED')),
  add column if not exists provider_message_id text,
  add column if not exists delivery_status_code text,
  add column if not exists delivered_at timestamptz;

-- provider_message_id unique 제약조건 생성 (null은 다수 허용, 값 존재 시 고유성 보장)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kakao_notification_outbox_provider_message_id_key'
  ) then
    alter table public.kakao_notification_outbox
      add constraint kakao_notification_outbox_provider_message_id_key unique (provider_message_id);
  end if;
end $$;

-- 인덱스: delivery_status 조회 가속
create index if not exists kakao_notification_outbox_delivery_status_idx
  on public.kakao_notification_outbox (delivery_status)
  where delivery_status is not null;

-- 2. DLR 반영 RPC: record_kakao_outbox_delivery -----------------------------
-- 요구사항:
-- 1. 매칭 job status가 SENDING, SENT, UNKNOWN인 건에서만 delivery 반영 (READY, CLAIMED, BLOCKED, SUPERSEDED 등은 거부).
-- 2. DELIVERED는 최종 상태 (늦은 FAILED 퇴행 금지).
-- 3. FAILED -> DELIVERED 전환 허용.
-- 4. 중복 같은 message/status는 idempotent하게 false 반환.
-- 5. messageId 교차 job 등록 및 충돌 시 안전 거부 (false 반환).
-- 6. service_role 전용 및 고정 search_path pg_catalog, public, pg_temp.
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
begin
  -- 파라미터 유효성 검증
  if p_job_id is null or p_status is null or p_status not in ('DELIVERED', 'FAILED') then
    return false;
  end if;

  v_trimmed_msg := nullif(trim(p_message_id), '');

  -- 다른 job과의 messageId 충돌 검증
  if v_trimmed_msg is not null then
    if exists (
      select 1 from public.kakao_notification_outbox
      where provider_message_id = v_trimmed_msg
        and id <> p_job_id
    ) then
      return false;
    end if;
  end if;

  -- 원자적 UPDATE
  begin
    update public.kakao_notification_outbox
    set
      delivery_status = p_status,
      provider_message_id = coalesce(v_trimmed_msg, provider_message_id),
      delivery_status_code = p_status_code,
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
        or v_trimmed_msg is null
        or provider_message_id = v_trimmed_msg
      );

    get diagnostics v_count = row_count;
    return v_count = 1;
  exception
    when unique_violation then
      return false;
  end;
end;
$$;

revoke all on function public.record_kakao_outbox_delivery(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_kakao_outbox_delivery(uuid, text, text, text) to service_role;
