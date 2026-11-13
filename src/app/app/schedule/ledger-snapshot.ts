import type { LedgerEntryDto, LedgerSource, LedgerStatus } from '@/features/mobile-inbox/ledger-model'
import type { LedgerViewSnapshot } from '@/features/mobile-inbox/ledger-view'

/**
 * M15 예약 장부(ANI-1691) — `/app/schedule` 이 R2 장부를 그릴 때 쓰는 읽기 전용 스냅샷.
 *
 * 정직 원칙(보관함 규칙과 동일):
 * - 조회 실패는 빈 목록이 아니라 `error` 다. `Reservations` 가 null 이거나 error 면 loadState='error'.
 * - 시각은 원장에 적힌 값만 쓴다. `metadata.endsAt` 이 없으면 종료 시각을 **만들지 않는다** →
 *   장부는 그 예약을 '시각 확인 못함'으로 그린다.
 * - '확정'은 원장 행이 CONFIRMED 이고 `confirmed_at` 근거가 있을 때만. 확인 시각은 이번 읽기 시각이다.
 * - 다른 테넌트 행이 한 행이라도 섞이면 그 조회를 믿지 않고 `error` 로 닫는다(fail-closed).
 *   서버 쿼리가 workspace_id 로 거르므로 정상 경로에는 없다. 섞였다는 것은 조회 경계가
 *   깨졌다는 뜻이고, 그런 행을 조용히 버리면 화면이 '없는 예약'을 정상 목록처럼 그린다.
 */

export interface ReservationLedgerRow {
  id: string
  workspace_id: string
  customer_name: string | null
  service_name: string | null
  status: string
  confirmed_at: string | null
  metadata: unknown
  /** 예약 변경(reschedule)은 이 값만 바뀐다. 지금 시각은 슬롯 표에서 따로 읽어야 한다. */
  slot_id?: string | null
}

/** 서버 조회 상한. 이 수만큼 오면 더 있을 수 있으므로 complete=false 로 내려 '일부'로 그린다. */
export const LEDGER_QUERY_LIMIT = 100

const DB_STATUS: Readonly<Record<string, LedgerStatus>> = {
  CONFIRMED: 'confirmed',
  AWAITING_CONFIRMATION: 'pending_confirmation',
  PROPOSED: 'pending_confirmation',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** 알 수 없는 상태는 '확정 대기'로 낮춰 그린다 — 확정으로 승격하지 않는 쪽이 안전하다. */
function toStatus(status: string): LedgerStatus {
  return DB_STATUS[status] ?? 'pending_confirmation'
}

/**
 * 이 예약이 생긴 근거. 원장에 적힌 `metadata.source` 만 믿는다.
 * - `booking_recovery`: 고객 수락 DM 을 검증하고 원장에 쓰는 RPC → '고객이 수락'
 * - `owner_created`: 사장님/직원이 앱에서 직접 만든 예약 → '사장님이 확정'
 * - 그 밖(맨 dmThreadId, 모르는 값, 없음): 근거를 확인하지 못한 것 → '미확인'
 * `dmThreadId` 는 예약 스레드를 가리킬 뿐 고객 수락의 증거가 아니므로 쓰지 않는다.
 */
function toSource(metadata: Record<string, unknown>): LedgerSource {
  if (metadata.source === 'booking_recovery') return 'customer_accepted'
  if (metadata.source === 'owner_created') return 'owner_confirmed'
  return 'unverified'
}

export interface SlotInterval {
  startsAt: string | null
  endsAt: string | null
}

/** 행들이 가리키는 슬롯 id 중 비어 있지 않은 값만 중복 없이 모은다(슬롯 표 1회 조회용). */
export function collectSlotIds(rows: readonly ReservationLedgerRow[]): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    const id = asText(row.slot_id)
    if (id) ids.add(id)
  }
  return [...ids]
}

function toEntry(
  row: ReservationLedgerRow,
  checkedAt: string,
  slotIntervals?: ReadonlyMap<string, SlotInterval> | null,
): LedgerEntryDto {
  const metadata = asRecord(row.metadata)
  const status = toStatus(row.status)
  // 예약 변경은 slot_id 만 바꾸고 metadata.startsAt/endsAt 는 생성 당시 값으로 남는다.
  // 슬롯 표에서 지금 시각을 읽었으면 그 값을 우선하고, 없으면 metadata 로 폴백한다.
  const slotInterval = row.slot_id ? slotIntervals?.get(row.slot_id) : undefined
  // booking_recovery 는 startsAt/endsAt, 예약 API 는 bookingStartsAt(시작만) 을 남긴다.
  const startsAt = slotInterval
    ? asText(slotInterval.startsAt) ?? ''
    : asText(metadata.startsAt) ?? asText(metadata.bookingStartsAt) ?? ''
  const endsAt = slotInterval
    ? asText(slotInterval.endsAt) ?? ''
    : asText(metadata.endsAt) ?? ''
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    customerName: asText(row.customer_name) ?? '고객님',
    serviceLabel: asText(row.service_name) ?? '서비스 미정',
    startsAt,
    endsAt,
    status,
    source: toSource(metadata),
    ledgerVerifiedAt: status === 'confirmed' && row.confirmed_at ? checkedAt : null,
    otherSurfaceStatus: null,
  }
}

export function buildLedgerSnapshot(input: {
  workspaceId: string
  timeZone: string
  rows: readonly ReservationLedgerRow[] | null
  error: { message?: string } | null
  /** 원장을 읽은 시각이자 화면 기준 '지금'. */
  checkedAt: string
  limit?: number
  /** slot_id → 지금 슬롯 시각. 읽지 못했으면 null (metadata 로 폴백). */
  slotIntervals?: ReadonlyMap<string, SlotInterval> | null
  /** 데이터셋 모드 (ANI-1744 G-11 fail-closed). ACTUAL 만 허용하며 missing/null/UNKNOWN 등은 error 로 닫는다. */
  datasetMode?: string | null
}): LedgerViewSnapshot {
  if (input.error || input.rows === null || input.datasetMode !== 'ACTUAL') {
    return {
      loadState: 'error',
      entries: [],
      workspaceId: input.workspaceId,
      timeZone: input.timeZone,
      now: input.checkedAt,
      complete: false,
      checkedAt: null,
    }
  }

  // 다른 테넌트 행이 한 행이라도 섞이면 이 조회 전체를 신뢰하지 않는다.
  // 조용히 걸러내고 ready 로 그리면 빠진 예약이 '원래 없던 예약'처럼 보이므로,
  // error·entries []·complete=false 로 닫아 화면이 목록을 그리지 않게 한다.
  if (input.rows.some(row => row.workspace_id !== input.workspaceId)) {
    return {
      loadState: 'error',
      entries: [],
      workspaceId: input.workspaceId,
      timeZone: input.timeZone,
      now: input.checkedAt,
      complete: false,
      checkedAt: null,
    }
  }

  return {
    loadState: 'ready',
    entries: input.rows.map(row => toEntry(row, input.checkedAt, input.slotIntervals)),
    workspaceId: input.workspaceId,
    timeZone: input.timeZone,
    now: input.checkedAt,
    complete: input.rows.length < (input.limit ?? LEDGER_QUERY_LIMIT),
    checkedAt: input.checkedAt,
  }
}
