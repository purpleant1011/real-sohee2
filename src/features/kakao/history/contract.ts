/**
 * 알림톡 발송내역(사장님용) 공용 계약.
 *
 * - API(서버)와 UI(PC·모바일)가 같은 타입과 라벨을 쓰도록 한 곳에 둔다.
 * - 고객 전화번호·이름·본문·시크릿·공급자 응답은 절대 담지 않는다.
 * - 크레딧·잔액·비용 숫자는 담지 않는다(사용자 화면 금지 규칙).
 */

export type KakaoHistoryEvent =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CHANGED'
  | 'BOOKING_CANCELLED'
  | 'REMINDER_24H'
  | 'REMINDER_2H'
  | 'PAYMENT_CONFIRMED'

export type KakaoHistoryStatus =
  | 'SCHEDULED' // 발송 예정
  | 'SENDING' // 발송 중
  | 'SENT' // 보냈음(도착 확인 전)
  | 'DELIVERED' // 도착 확인
  | 'FAILED' // 전달 실패/발송 실패
  | 'NEEDS_CHECK' // 결과 확인 필요(UNKNOWN)
  | 'HELD' // 조건 미충족으로 보내지 않음(BLOCKED)
  | 'CANCELLED' // 일정 변경 등으로 취소(SUPERSEDED)

export interface KakaoHistoryItem {
  id: string
  reservationId: string
  event: KakaoHistoryEvent
  eventLabel: string
  status: KakaoHistoryStatus
  statusLabel: string
  /** 사장님이 이해할 수 있는 한 줄 설명. 없으면 null. */
  detailLabel: string | null
  /** 발송 예정/기준 시각(ISO). */
  dueAt: string
  /** 마지막 상태 변경 시각(ISO). */
  updatedAt: string
}

export interface KakaoHistoryResponse {
  ok: true
  items: KakaoHistoryItem[]
}

/** DB outbox 행에서 필요한 필드만(서버 전용 입력 타입). */
export interface KakaoOutboxRowLike {
  id: string
  reservation_id: string
  event: string
  status: string
  reason_code: string | null
  delivery_status: string | null
  due_at: string
  updated_at: string
}

const EVENT_LABELS: Record<KakaoHistoryEvent, string> = {
  BOOKING_CONFIRMED: '예약 확정 안내',
  BOOKING_CHANGED: '예약 변경 안내',
  BOOKING_CANCELLED: '예약 취소 안내',
  REMINDER_24H: '방문 하루 전 안내',
  REMINDER_2H: '방문 2시간 전 안내',
  PAYMENT_CONFIRMED: '결제 완료 안내',
}

const STATUS_LABELS: Record<KakaoHistoryStatus, string> = {
  SCHEDULED: '발송 예정',
  SENDING: '발송 중',
  SENT: '보냈어요',
  DELIVERED: '도착 확인',
  FAILED: '전달 실패',
  NEEDS_CHECK: '확인이 필요해요',
  HELD: '보내지 않았어요',
  CANCELLED: '취소됐어요',
}

const HELD_DETAILS: Record<string, string> = {
  EVIDENCE_MISSING: '고객에게 알렸다는 확인이 없어 보내지 않았어요.',
  EVIDENCE_NOT_GRANTED: '고객에게 알렸다는 확인이 없어 보내지 않았어요.',
  NOT_ALLOWLISTED: '시험 단계라 지정한 번호 외에는 보내지 않아요.',
  TEMPLATE_NOT_APPROVED: '메시지 양식 승인이 확인되지 않아 보내지 않았어요.',
  INVALID_PHONE: '전화번호를 확인할 수 없어 보내지 않았어요.',
  STALE_RESERVATION: '그 사이 예약이 바뀌어 보내지 않았어요.',
  STATUS_MISMATCH: '예약 상태가 맞지 않아 보내지 않았어요.',
}

export function isKakaoHistoryEvent(value: string): value is KakaoHistoryEvent {
  return value in EVENT_LABELS
}

/** outbox 행 → 사장님용 항목. 알 수 없는 이벤트는 null(목록에서 제외). */
export function toKakaoHistoryItem(row: KakaoOutboxRowLike): KakaoHistoryItem | null {
  if (!isKakaoHistoryEvent(row.event)) return null

  let status: KakaoHistoryStatus
  let detailLabel: string | null = null

  switch (row.status) {
    case 'READY':
      status = 'SCHEDULED'
      break
    case 'CLAIMED':
    case 'SENDING':
      status = 'SENDING'
      break
    case 'SENT':
      if (row.delivery_status === 'DELIVERED') status = 'DELIVERED'
      else if (row.delivery_status === 'FAILED') {
        status = 'FAILED'
        detailLabel = '카카오톡 전달에 실패했어요.'
      } else {
        status = 'SENT'
        detailLabel = '도착 여부를 확인하고 있어요.'
      }
      break
    case 'UNKNOWN':
      status = 'NEEDS_CHECK'
      detailLabel = '발송 결과를 확인하지 못했어요. 같은 안내를 다시 보내지 않았어요.'
      break
    case 'BLOCKED':
      status = 'HELD'
      detailLabel = HELD_DETAILS[row.reason_code ?? ''] ?? '조건이 맞지 않아 보내지 않았어요.'
      break
    case 'SUPERSEDED':
      status = 'CANCELLED'
      detailLabel = '예약 일정이 바뀌어 이 안내는 취소됐어요.'
      break
    case 'FAILED':
      status = 'FAILED'
      detailLabel = '발송에 실패했어요.'
      break
    default:
      return null
  }

  return {
    id: row.id,
    reservationId: row.reservation_id,
    event: row.event,
    eventLabel: EVENT_LABELS[row.event],
    status,
    statusLabel: STATUS_LABELS[status],
    detailLabel,
    dueAt: row.due_at,
    updatedAt: row.updated_at,
  }
}
