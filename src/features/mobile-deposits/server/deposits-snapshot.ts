import type { DepositRecord } from '../deposit-model'
import type { DepositsViewSnapshot } from '../deposits-view'

/** 예약 장부에서 읽는 최소 필드. 고객 이름·연락처 같은 개인정보는 가져오지 않는다. */
export interface ReservationDepositRow {
  id: string
  workspace_id: string
  deposit_krw: number | null
  status: string
}

/**
 * M16 예약금 스냅샷(ANI-1693 partial). 읽기 전용이며 결제·환불 원장을 쓰지 않는다.
 * - 조회 실패는 빈 목록이 아니라 error 로 남긴다(조회 실패를 0건으로 위장 금지).
 * - 다른 가게 행이 섞이면(테넌트 경계 위반) 부분 목록을 그리지 않고 error 로 닫는다.
 * - 예약금 PG 가 아직 연결되지 않았으므로 provider 는 none, readback 은 unavailable 이다.
 *   provider accepted / URL success 를 '결제 완료' 로 올리지 않는다.
 */
export function buildDepositsSnapshot(input: {
  workspaceId: string
  rows: readonly ReservationDepositRow[] | null
  error: { message?: string } | null
  checkedAt: string
  /** 데이터셋 모드 (ANI-1744 G-11 fail-closed). ACTUAL 만 허용하며 missing/null/UNKNOWN 등은 error 로 닫는다. */
  datasetMode?: string | null
}): DepositsViewSnapshot {
  if (input.error || input.rows === null || input.datasetMode !== 'ACTUAL') {
    return { loadState: 'error', deposits: [], checkedAt: null }
  }

  // 다른 가게 행이 섞였다는 것은 조회 경계가 깨졌다는 뜻이다. 그 가게 행만 골라 그리면
  // 경계 위반이 '정상 화면'으로 숨으므로, 부분 목록을 만들지 않고 error 로 닫는다.
  if (input.rows.some(row => row.workspace_id !== input.workspaceId)) {
    return { loadState: 'error', deposits: [], checkedAt: null }
  }

  const deposits = input.rows.map(toRecord)

  return { loadState: 'ready', deposits, checkedAt: input.checkedAt }
}

function toRecord(row: ReservationDepositRow): DepositRecord {
  const amount = typeof row.deposit_krw === 'number' && row.deposit_krw > 0 ? row.deposit_krw : null
  return {
    workspaceId: row.workspace_id,
    bookingId: row.id,
    // 예약금 결제사가 연결되기 전이다. 연결 전에는 어떤 경로로도 결제를 시작하지 않는다.
    provider: 'none',
    availability: amount === null ? 'not_supported' : 'supported',
    amount,
    currency: 'KRW',
    // 환불 규정 동의 기록을 읽을 원장이 아직 없다. 동의한 것으로 그리지 않는다.
    termsAcceptedAt: null,
    transport: 'not_started',
    providerAccepted: null,
    // 서버 영수증 재조회 경로가 없으므로 '확인 불가'로 남긴다(pending 으로 위장하지 않는다).
    readback: 'unavailable',
    readbackAt: null,
    receiptRef: null,
    refund: null,
    idempotencyKey: null,
    seenCallbacks: [],
  }
}
