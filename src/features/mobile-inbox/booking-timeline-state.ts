import type { StateChipKind } from '@/components/mobile-ui'

/**
 * M14 예약 문의 타임라인의 5상태 칩 판정(ANI-1690).
 *
 * 왜 필요한가: 타임라인은 서버 상태기계를 그대로 옮기므로 '단계'는 정직하지만,
 * **조회가 어디까지 확인됐는지**는 화면이 말하지 않았다. 대화 상세에서 고객 이름·원문을
 * 못 가져와도, 서버가 전송 결과를 미확정으로 두고 있어도 화면은 완성된 타임라인처럼 보였다.
 *
 * 규칙:
 * - 어떤 상태도 '확인됨'·'완료' 같은 성공 어휘를 쓰지 않는다.
 * - 빈 상태(404)와 권한 없음(401/403)은 **서버가 확인해 준 사실**이므로 칩을 붙이지 않는다.
 *   실패(error)와 빈 결과(empty)를 같은 칩으로 뭉개지 않기 위해서다.
 * - '확인된 전체'일 때만 칩이 없다(null).
 */

/** 조회 결과의 종류. `missing` 은 404(확인된 빈 상태), `unauthorized` 는 401/403 이다. */
export type BookingTimelineLoadKind = 'loading' | 'ready' | 'missing' | 'unauthorized' | 'offline' | 'error'

export interface BookingTimelineStateChip {
  kind: StateChipKind
  /** 도메인 문맥 보강용. 성공 어휘는 금지. */
  label?: string
}

export interface BookingTimelineChipInput {
  loadKind: BookingTimelineLoadKind
  /** 서버가 마지막으로 확인한 시각(ISO). `ready` 에서만 의미가 있다. */
  observedAt?: string | null
  /** 대화에서 고객 이름·원문을 확인했는지. false 면 '일부만 확인'이다. */
  identityVerified?: boolean
  /** 서버 단계가 결과 미확정 계열(RESULT_UNKNOWN·NEEDS_RECONCILIATION)인지. */
  outcomeUnresolved?: boolean
  /** 판정 기준 시각(ms). 테스트에서 고정한다. */
  now?: number
  /** 이 시간을 넘긴 관측은 stale 로 본다. */
  staleAfterMinutes?: number
}

export const BOOKING_TIMELINE_STALE_AFTER_MINUTES = 10

/** 서버 관측 시각이 판정 기준보다 오래됐는지. 시각을 못 읽으면 '오래됨'이 아니라 '모름'이므로 stale 로 단정하지 않는다. */
export function isBookingTimelineStale(
  observedAt: string | null | undefined,
  now: number,
  staleAfterMinutes = BOOKING_TIMELINE_STALE_AFTER_MINUTES,
): boolean {
  if (!observedAt) return false
  const observed = Date.parse(observedAt)
  if (Number.isNaN(observed)) return false
  return now - observed > staleAfterMinutes * 60_000
}

/**
 * 우선순위: 결과 미확정 > 오래된 관측 > 고객 정보 미확인.
 * - 결과 미확정은 예약의 사실 여부 자체가 흔들리는 상태라 가장 먼저 알린다.
 * - stale 은 화면 전체가 낡았다는 뜻이라 필드 하나가 빠진 것보다 넓다.
 * - 그래서 셋 중 하나만 보여 줄 때는 이 순서로 고른다(칩은 한 줄에 하나).
 */
export function bookingTimelineStateChip(input: BookingTimelineChipInput): BookingTimelineStateChip | null {
  switch (input.loadKind) {
    case 'offline':
      return { kind: 'offline' }
    case 'loading':
      return { kind: 'loading' }
    case 'error':
      return { kind: 'error' }
    // 서버가 '없다'고 확인해 준 상태. 실패가 아니므로 실패 칩을 붙이지 않는다.
    case 'missing':
      return null
    // 권한 안내는 StateView 가 문구로 소유한다. 칩을 겹치지 않는다.
    case 'unauthorized':
      return null
    case 'ready':
      break
  }

  if (input.outcomeUnresolved) return { kind: 'partial', label: '전송 결과 미확인' }
  if (isBookingTimelineStale(input.observedAt, input.now ?? Date.now(), input.staleAfterMinutes)) {
    return { kind: 'stale' }
  }
  if (input.identityVerified === false) return { kind: 'partial', label: '고객 정보 일부만 확인' }
  return null
}
