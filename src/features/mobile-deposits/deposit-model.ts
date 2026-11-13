import type { LedgerKind } from '@/features/mobile-settings/credit-model'

/**
 * M16(ANI-1693) 선택적 예약금 — PG 이동/복귀 상태.
 * 외부 write 는 이 모듈에 없다. transport / provider accepted / readback verified 를 분리해서
 * URL success 만으로 "결제 완료" 를 표시하지 않는다. 불확실하면 result_unknown.
 */

export type PaymentProvider = 'portone' | 'none'
export type SlotAvailability = 'supported' | 'not_supported' | 'unknown'

export type TransportState =
  | 'not_started'
  | 'redirected'
  | 'returned_success'
  | 'returned_fail'
  | 'returned_cancel'

export type ProviderAccepted = 'accepted' | 'rejected' | 'unknown'
export type ReadbackState = 'pending' | 'verified' | 'not_verified' | 'unavailable'

export type RefundState = 'none' | 'requested' | 'verified' | 'failed'

export interface DepositRecord {
  workspaceId: string
  bookingId: string
  provider: PaymentProvider
  availability: SlotAvailability
  /** 원 단위. null 이면 금액 미확인 → 결제 버튼 비활성. */
  amount: number | null
  currency: 'KRW'
  termsAcceptedAt: string | null
  transport: TransportState
  providerAccepted: ProviderAccepted | null
  readback: ReadbackState
  readbackAt: string | null
  /** 서버가 확인한 영수증 참조. readback verified 일 때만 존재. */
  receiptRef: string | null
  refund: { state: RefundState; requestedAt: string | null; readbackAt: string | null } | null
  /** 같은 예약에 대한 charge 멱등 키. 이중 청구 방지. */
  idempotencyKey: string | null
  /** 이미 처리한 PG callback ID. 중복 callback 은 재적용하지 않는다. */
  seenCallbacks: string[]
}

export interface DepositView {
  /** 미지원 매장은 예약금 UI 자체를 숨긴다. */
  visible: boolean
  label: string
  detail: string | null
  next: string | null
  tone: 'neutral' | 'positive' | 'warning' | 'danger'
  /** readback verified 또는 환불 verified 로 서버 확인된 금액만 true. */
  confirmedPaid: boolean
}

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`

/** 예약금은 고객 원장, 소희 이용 요금은 구독 원장. 합산 금지. */
export const DEPOSIT_LEDGER: LedgerKind = 'customer_deposit'

export function depositLedger(): LedgerKind {
  return DEPOSIT_LEDGER
}

export interface DepositListItem {
  label: string
  amountLabel: string | null
  confirmed: boolean
}

/** 목록/상세 공통 표시. 확인 전 금액은 '결제 예정'이지 매출이 아니다. */
export function depositListItem(record: DepositRecord): DepositListItem | null {
  if (record.availability !== 'supported') return null
  const paid = record.readback === 'verified' && record.receiptRef !== null
  return {
    label: record.refund?.state === 'verified' ? '예약금 환불 완료' : paid ? '예약금 확인 완료' : '예약금 확인 전',
    amountLabel: record.amount === null ? null : won(record.amount),
    confirmed: paid,
  }
}

/** PG 앱에서 돌아온 직후 상태. URL success 는 결제 완료 근거가 아니다. */
export function depositView(record: DepositRecord): DepositView {
  if (record.availability === 'not_supported') return { visible: false, label: '', detail: null, next: null, tone: 'neutral', confirmedPaid: false }
  if (record.availability === 'unknown') {
    return { visible: true, label: '예약금 여부를 확인하지 못했어요', detail: '이 매장의 예약금 설정을 아직 확인하지 못했어요', next: '예약 정보 새로고침', tone: 'warning', confirmedPaid: false }
  }

  const refund = record.refund
  if (refund?.state === 'verified') {
    return { visible: true, label: '예약금 환불 완료', detail: refund.readbackAt ? `${refund.readbackAt} 서버 확인` : null, next: null, tone: 'positive', confirmedPaid: false }
  }
  if (refund?.state === 'failed') {
    return { visible: true, label: '환불이 완료되지 않았어요', detail: '환불 결과를 확인하지 못했어요', next: '환불 상태 다시 확인', tone: 'danger', confirmedPaid: false }
  }
  if (refund?.state === 'requested') {
    return { visible: true, label: '환불 처리 중', detail: refund.requestedAt ? `${refund.requestedAt} 요청` : null, next: '잠시 후 다시 확인', tone: 'neutral', confirmedPaid: false }
  }

  if (record.readback === 'verified' && record.receiptRef !== null) {
    return {
      visible: true,
      label: '예약금 확인 완료',
      detail: [record.amount === null ? null : won(record.amount), record.readbackAt ? `${record.readbackAt} 서버 확인` : null].filter(Boolean).join(' · ') || null,
      next: null,
      tone: 'positive',
      confirmedPaid: true,
    }
  }

  // readback 이 명시적으로 실패했으면 재결제 버튼으로 되돌리지 않는다.
  if (record.readback === 'not_verified') {
    return { visible: true, label: '결제가 확인되지 않았어요', detail: '서버 영수증에서 결제를 확인하지 못했어요', next: '영수증 다시 확인', tone: 'danger', confirmedPaid: false }
  }

  // 여기부터는 "확인 전". provider accepted / URL success 는 완료가 아니다.
  if (record.transport === 'returned_success' || record.providerAccepted === 'accepted') {
    const detail = record.providerAccepted === 'accepted' ? '결제사 응답은 받았지만 서버 영수증 확인 전이에요' : '결제 화면에서 돌아왔지만 서버 영수증 확인 전이에요'
    if (record.readback === 'unavailable') {
      return { visible: true, label: '결제 결과를 확인하지 못했어요', detail, next: '영수증 다시 확인', tone: 'warning', confirmedPaid: false }
    }
    return { visible: true, label: '결제 확인 중', detail, next: '잠시 후 다시 확인', tone: 'neutral', confirmedPaid: false }
  }

  if (record.transport === 'returned_fail' || record.providerAccepted === 'rejected') {
    return { visible: true, label: '결제가 되지 않았어요', detail: '결제사가 승인하지 않았어요', next: '다시 결제하기', tone: 'danger', confirmedPaid: false }
  }
  if (record.transport === 'returned_cancel') {
    return { visible: true, label: '결제를 취소했어요', detail: null, next: '다시 결제하기', tone: 'neutral', confirmedPaid: false }
  }
  if (record.transport === 'redirected') {
    return { visible: true, label: '결제 화면에서 돌아오면 확인할게요', detail: '결제는 결제사 화면에서 진행돼요', next: null, tone: 'neutral', confirmedPaid: false }
  }

  if (record.amount === null) {
    return { visible: true, label: '예약금 금액을 확인하지 못했어요', detail: null, next: '예약 정보 새로고침', tone: 'warning', confirmedPaid: false }
  }
  // 결제사가 연결되기 전에는 결제를 시작할 수 없다. 금액은 사실대로 보여주고 실행만 막는다.
  if (record.provider === 'none') {
    return { visible: true, label: `예약금 ${won(record.amount)}`, detail: '예약금 결제는 아직 연결되지 않았어요', next: '결제 연결이 준비되면 알려드릴게요', tone: 'neutral', confirmedPaid: false }
  }
  if (record.termsAcceptedAt === null) {
    return { visible: true, label: `예약금 ${won(record.amount)}`, detail: '환불 규정을 확인해야 결제할 수 있어요', next: '환불 규정 확인', tone: 'neutral', confirmedPaid: false }
  }
  return { visible: true, label: `예약금 ${won(record.amount)} 결제하기`, detail: '결제는 결제사 화면에서 진행돼요', next: null, tone: 'neutral', confirmedPaid: false }
}

export type ChargeGuard =
  | { allowed: true; idempotencyKey: string; amount: number }
  | { allowed: false; reason: 'unsupported' | 'not_ready' | 'terms_required' | 'amount_unknown' | 'in_flight' | 'already_paid' | 'readback_pending' | 'refund_in_progress' | 'missing_idempotency' | 'provider_not_connected'; message: string; next: string | null }

/** 이중 청구 방지. 확인 전 상태에서는 다시 결제시키지 않는다. */
export function chargeGuard(record: DepositRecord): ChargeGuard {
  if (record.availability === 'not_supported') return { allowed: false, reason: 'unsupported', message: '이 매장은 예약금을 쓰지 않아요', next: null }
  if (record.availability === 'unknown') return { allowed: false, reason: 'not_ready', message: '예약금 설정을 확인하지 못했어요', next: '예약 정보 새로고침' }
  if (record.refund && (record.refund.state === 'requested' || record.refund.state === 'verified')) {
    return { allowed: false, reason: 'refund_in_progress', message: '환불 처리 중에는 다시 결제할 수 없어요', next: '환불 상태 확인' }
  }
  if (record.readback === 'verified') return { allowed: false, reason: 'already_paid', message: '이미 예약금이 확인된 예약이에요', next: null }
  // 결제사가 연결되지 않았으면 금액·약관과 무관하게 결제를 시작하지 않는다.
  if (record.provider === 'none') return { allowed: false, reason: 'provider_not_connected', message: '예약금 결제를 지금은 시작할 수 없어요', next: '결제 연결이 준비되면 알려드릴게요' }
  if (record.transport === 'redirected') return { allowed: false, reason: 'in_flight', message: '결제가 진행 중이에요', next: '결제 화면으로 돌아가기' }
  if (record.transport === 'returned_success' || record.providerAccepted === 'accepted') {
    return { allowed: false, reason: 'readback_pending', message: '결제 결과를 확인하는 중이에요', next: '영수증 다시 확인' }
  }
  if (record.amount === null) return { allowed: false, reason: 'amount_unknown', message: '예약금 금액을 확인하지 못했어요', next: '예약 정보 새로고침' }
  if (record.termsAcceptedAt === null) return { allowed: false, reason: 'terms_required', message: '환불 규정을 확인해야 결제할 수 있어요', next: '환불 규정 확인' }
  if (!record.idempotencyKey) return { allowed: false, reason: 'missing_idempotency', message: '결제를 준비하지 못했어요', next: '다시 시도' }
  return { allowed: true, idempotencyKey: record.idempotencyKey, amount: record.amount }
}

export interface DepositCallback {
  id: string
  kind: 'paid' | 'failed' | 'cancelled'
  providerAccepted: ProviderAccepted
}

/**
 * PG callback 반영. 같은 callback ID 는 한 번만 적용한다(중복 callback).
 * callback 이 와도 readback 은 verified 가 되지 않는다 — 서버 영수증 확인이 별도로 필요하다.
 */
export function applyCallback(record: DepositRecord, callback: DepositCallback): DepositRecord {
  if (record.seenCallbacks.includes(callback.id)) return record
  const transport: TransportState =
    callback.kind === 'paid' ? 'returned_success' : callback.kind === 'failed' ? 'returned_fail' : 'returned_cancel'
  return {
    ...record,
    transport,
    providerAccepted: callback.providerAccepted,
    readback: callback.kind === 'paid' ? 'pending' : record.readback,
    seenCallbacks: [...record.seenCallbacks, callback.id],
  }
}

/** 서버 영수증 재조회 결과 반영. 영수증 참조가 없으면 verified 로 올리지 않는다. */
export function applyReadback(record: DepositRecord, readback: ReadbackState, at: string, receiptRef: string | null): DepositRecord {
  if (readback === 'verified' && !receiptRef) {
    return { ...record, readback: 'not_verified', readbackAt: at, receiptRef: null }
  }
  return { ...record, readback, readbackAt: at, receiptRef: readback === 'verified' ? receiptRef : null }
}
