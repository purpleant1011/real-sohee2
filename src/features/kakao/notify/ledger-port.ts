/**
 * 알림톡 발송 원장 포트 (KAPI-ledger)
 *
 * 디스패처와 솔라피 웹훅(DLR)이 공유하는 저장소 계약이다.
 * 실제 DB 구현(Supabase)은 마이그레이션 승인 후 붙이고, 지금은 인메모리 구현만 제공한다.
 * 핵심 불변식: 멱등키(idempotencyKey)당 레코드는 하나, 상태는 되돌아가지 않는다.
 */

export type LedgerStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'REJECTED' | 'DRY_RUN'

export interface LedgerRecord {
  idempotencyKey: string
  workspaceId: string
  bookingId: string
  event: string
  templateCode: string
  /** 정규화된 수신 번호는 저장하지 않고 끝 4자리만 남긴다(개인정보 최소화). */
  phoneLast4: string
  status: LedgerStatus
  /** 솔라피 messageId. 발송 성공 전에는 없다. */
  providerMessageId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export interface LedgerPort {
  /** 키가 없으면 PENDING 으로 생성하고 true, 이미 있으면 false(중복 발송 방지). */
  claim(record: Pick<LedgerRecord, 'idempotencyKey' | 'workspaceId' | 'bookingId' | 'event' | 'templateCode' | 'phoneLast4'>, nowIso: string): Promise<boolean>
  /** 상태 전이. 뒤로 가는 전이(DELIVERED→SENT 등)는 무시하고 false 를 돌려준다. */
  transition(
    idempotencyKey: string,
    next: LedgerStatus,
    patch: { providerMessageId?: string; error?: string },
    nowIso: string,
  ): Promise<boolean>
  get(idempotencyKey: string): Promise<LedgerRecord | null>
  findByProviderMessageId(providerMessageId: string): Promise<LedgerRecord | null>
}

const RANK: Record<LedgerStatus, number> = {
  PENDING: 0,
  DRY_RUN: 1,
  REJECTED: 1,
  SENT: 1,
  FAILED: 2,
  DELIVERED: 3,
}

export function canTransition(from: LedgerStatus, to: LedgerStatus): boolean {
  return RANK[to] > RANK[from]
}

export class InMemoryLedger implements LedgerPort {
  private readonly rows = new Map<string, LedgerRecord>()

  async claim(
    record: Pick<LedgerRecord, 'idempotencyKey' | 'workspaceId' | 'bookingId' | 'event' | 'templateCode' | 'phoneLast4'>,
    nowIso: string,
  ): Promise<boolean> {
    if (this.rows.has(record.idempotencyKey)) return false
    this.rows.set(record.idempotencyKey, {
      ...record,
      status: 'PENDING',
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    return true
  }

  async transition(
    idempotencyKey: string,
    next: LedgerStatus,
    patch: { providerMessageId?: string; error?: string },
    nowIso: string,
  ): Promise<boolean> {
    const row = this.rows.get(idempotencyKey)
    if (!row || !canTransition(row.status, next)) return false
    this.rows.set(idempotencyKey, { ...row, ...patch, status: next, updatedAt: nowIso })
    return true
  }

  async get(idempotencyKey: string): Promise<LedgerRecord | null> {
    return this.rows.get(idempotencyKey) ?? null
  }

  async findByProviderMessageId(providerMessageId: string): Promise<LedgerRecord | null> {
    for (const row of this.rows.values()) {
      if (row.providerMessageId === providerMessageId) return row
    }
    return null
  }
}
