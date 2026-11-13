export interface CreditLedger {
  available: number | null
  reserved: number | null
  consumed: number | null
  refunded: number | null
  observedAt: string | null
}

export type SpendDecision =
  | { allowed: true }
  | { allowed: false; reason: 'unknown_balance' | 'insufficient' | 'no_estimate'; message: string; next: string }

/** 실행 전 예상 비용이 반드시 있어야 하고, 잔액이 불명확하면 막는다. 무한 스피너 대신 다음 행동을 준다. */
export function canSpend(ledger: CreditLedger, estimate: number | null): SpendDecision {
  if (estimate === null) return { allowed: false, reason: 'no_estimate', message: '예상 비용을 아직 확인하지 못했어요', next: '다시 확인' }
  if (ledger.available === null) return { allowed: false, reason: 'unknown_balance', message: '잔액을 확인하지 못했어요', next: '다시 확인' }
  if (ledger.available < estimate) return { allowed: false, reason: 'insufficient', message: '크레딧이 부족해서 지금은 실행할 수 없어요', next: '크레딧 충전 방법 보기' }
  return { allowed: true }
}

/** 구독료와 고객 예약금은 별도 원장. 합산하지 않는다. */
export type LedgerKind = 'subscription' | 'customer_deposit'
export const LEDGER_LABEL: Record<LedgerKind, string> = { subscription: '소희 이용 요금', customer_deposit: '고객 예약금' }

export type MemoryItemState = 'confirmed' | 'suggested' | 'needs_update'
export interface MemoryItem { key: string; value: string; state: MemoryItemState; approvedAt: string | null }

/** 승인 전 제안은 외부 고객 답변 등에 쓰지 않는다. 충돌 시 확인된 값이 우선. */
export function usableMemory(items: MemoryItem[]): MemoryItem[] {
  return items.filter(i => i.state === 'confirmed' && i.approvedAt !== null)
}
