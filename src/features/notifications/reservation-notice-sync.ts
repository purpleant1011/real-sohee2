/**
 * 예약 취소·변경 → 안내 job 동기화 경계 (TEST 전용) · ANI-1620
 *
 * 예약 canonical 쓰기(W5)가 커밋·readback까지 끝난 뒤 이 함수를 한 번 호출한다.
 * 이 계층은 알림 계층이므로 datasetMode는 항상 TEST이고 actualVerified는 항상 false다.
 *
 * 실패 정책:
 * - 포트가 등록되지 않았으면 NOT_CONFIGURED를 돌려주고 예약 흐름을 막지 않는다.
 * - 포트가 던진 예외는 숨기지 않고 SYNC_FAILED + error로 돌려준다. 다만 예약 쓰기는
 *   이미 커밋된 뒤이므로 여기서 다시 throw해 "예약 취소/변경 실패"로 위장하지 않는다.
 *   호출자는 결과 종류를 보고 재시도/사람 확인을 결정한다.
 * - noticesTouched는 실제로 무효화·재계획된 job 수이며, 실패 시 0이다(성공 위장 금지).
 */

export type BookingNoticeSyncInput = Readonly<{
  workspaceId: string
  bookingId: string
  change: 'CANCELLED' | 'RESCHEDULED'
  /** 예약 updated_at에서 유도한 단조 증가 version(ms epoch). */
  currentVersion: number
  currentStatus: 'CONFIRMED' | 'CANCELLED'
  slotId: string
  updatedAt: string
  reason?: string
}>

export type BookingNoticeSyncPort = {
  invalidateForBooking(
    input: BookingNoticeSyncInput
  ): Promise<{ invalidated: number; inFlightOrSent: number }>
  replanForBooking?(input: BookingNoticeSyncInput): Promise<{ planned: number; skippedReason?: string }>
}

export type BookingNoticeSyncResult = Readonly<{
  kind: 'SYNCED' | 'NOT_CONFIGURED' | 'SYNC_FAILED'
  invalidated: number
  inFlightOrSent: number
  replanned: number
  noticesTouched: number
  error: string | null
  datasetMode: 'TEST'
  actualVerified: false
}>

const OFFSET_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

let activePort: BookingNoticeSyncPort | null = null

function assertNotProduction(what: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`PRODUCTION_FORBIDDEN: ${what} cannot be registered in production`)
  }
}

/** TEST 포트 등록. 운영 환경에서는 테스트 포트가 끼어들 수 없도록 거부한다. */
export function setBookingNoticeSyncPort(port: BookingNoticeSyncPort | null): void {
  if (port !== null) assertNotProduction('booking notice sync port')
  activePort = port
}

/**
 * 예약 updated_at(offset 있는 ISO instant) → 단조 증가 version(ms epoch).
 * offset이 없거나 파싱할 수 없으면 추측하지 않고 INVALID_NOTICE_VERSION으로 거부한다.
 */
export function reservationNoticeVersion(updatedAt: string): number {
  if (typeof updatedAt !== 'string' || !OFFSET_ISO_PATTERN.test(updatedAt)) {
    throw new Error('INVALID_NOTICE_VERSION')
  }
  const parsed = Date.parse(updatedAt)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('INVALID_NOTICE_VERSION')
  }
  return parsed
}

function result(
  kind: BookingNoticeSyncResult['kind'],
  counts: { invalidated: number; inFlightOrSent: number; replanned: number },
  error: string | null
): BookingNoticeSyncResult {
  return {
    kind,
    invalidated: counts.invalidated,
    inFlightOrSent: counts.inFlightOrSent,
    replanned: counts.replanned,
    noticesTouched: counts.invalidated + counts.replanned,
    error,
    datasetMode: 'TEST',
    actualVerified: false,
  }
}

const NO_COUNTS = { invalidated: 0, inFlightOrSent: 0, replanned: 0 } as const

/**
 * 변경: 기존 job 무효화 → 새 일정으로 재계획.
 * 취소: 기존 job 무효화만. 취소 안내는 별도 승인·별도 job이므로 여기서 만들지 않는다.
 */
export async function syncBookingNoticeState(
  input: BookingNoticeSyncInput
): Promise<BookingNoticeSyncResult> {
  const port = activePort
  if (port === null) {
    return result('NOT_CONFIGURED', NO_COUNTS, null)
  }

  try {
    const invalidated = await port.invalidateForBooking(input)

    let replanned = 0
    if (input.change === 'RESCHEDULED' && typeof port.replanForBooking === 'function') {
      const replan = await port.replanForBooking(input)
      replanned = replan.planned
    }

    return result(
      'SYNCED',
      {
        invalidated: invalidated.invalidated,
        inFlightOrSent: invalidated.inFlightOrSent,
        replanned,
      },
      null
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return result('SYNC_FAILED', NO_COUNTS, message)
  }
}
