-- ============================================================================
-- 알림톡 예약 변경 시 직전 시작일시(previousBookingStartsAt) 메타데이터 보존 및 updated_at 단조 증가
--
-- [운영 및 보안 가이드라인]
-- 1. 초안(Draft) — DB 직접 적용 금지. 본 파일은 설계 검증용 초안 적용승인필요 상태이며, 운영 적용 시 별도 승인이 필요합니다.
-- 2. 0400 마이그레이션의 public.kakao_reservation_ensure_monotonic_updated_at() 함수를
--    create or replace로 확장하여 동일 규칙(search_path, 권한 격리, 단조 증가 보존)을 유지합니다.
-- 3. CONFIRMED 유지 중 slot_id 또는 metadata bookingStartsAt/startsAt 변경 시:
--    NEW.metadata.previousBookingStartsAt에 OLD의 bookingStartsAt(없으면 startsAt)를 기록합니다.
--    이전 시각이 둘 다 없으면 키를 설정하지 않으며, 연속 변경 시 매번 직전 값으로 갱신합니다.
--    관련 없는 변경(메모 수정 등)에서는 메타데이터를 불필요하게 수정하지 않습니다.
-- ============================================================================

create or replace function public.kakao_reservation_ensure_monotonic_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_is_relevant boolean := false;
  v_is_booking_changed boolean := false;
  v_prev_start text;
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
    v_is_booking_changed := true;
  end if;

  -- 예약 변경 시 직전 시작일시(previousBookingStartsAt) 메타데이터 기록
  -- OLD.metadata->>'bookingStartsAt' 우선, 없으면 OLD.metadata->>'startsAt' 참조
  -- 둘 다 없으면 키를 설정하지 않음
  -- 연속 변경 시 매번 직전 값으로 갱신
  if v_is_booking_changed then
    v_prev_start := coalesce(OLD.metadata->>'bookingStartsAt', OLD.metadata->>'startsAt');
    if v_prev_start is not null then
      NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb) || jsonb_build_object('previousBookingStartsAt', v_prev_start);
    end if;
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
