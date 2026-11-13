import { createHash } from 'crypto';
import { CreditLedgerEntry } from '@/features/credit-economy/types';

export interface AppendLedgerEntryParams {
  workspaceId: string;
  entryType: CreditLedgerEntry['entryType'];
  amount: number;
  currentBalance: number;
  transactionRefId: string;
  quoteId?: string;
  reason: string;
  initiatedBy: string;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}

export class CreditLedgerSourceChain {
  private ledger: Map<string, CreditLedgerEntry> = new Map(); // id -> Entry
  private workspaceChains: Map<string, string[]> = new Map(); // workspaceId -> [entryId, entryId, ...]
  private idempotencyIndex: Map<string, string> = new Map(); // idempotencyKey -> entryId

  /**
   * 엔트리의 SHA-256 감사 해시(Audit Hash) 계산 (ANI-838)
   */
  static calculateAuditHash(entryWithoutHash: Omit<CreditLedgerEntry, 'auditHash'>): string {
    const serialized = JSON.stringify({
      id: entryWithoutHash.id,
      workspaceId: entryWithoutHash.workspaceId,
      entryType: entryWithoutHash.entryType,
      amount: entryWithoutHash.amount,
      balanceAfter: entryWithoutHash.balanceAfter,
      transactionRefId: entryWithoutHash.transactionRefId,
      quoteId: entryWithoutHash.quoteId || null,
      reason: entryWithoutHash.reason,
      initiatedBy: entryWithoutHash.initiatedBy,
      createdAt: entryWithoutHash.createdAt,
      metadata: entryWithoutHash.metadata,
      idempotencyKey: entryWithoutHash.idempotencyKey,
      previousEntryId: entryWithoutHash.previousEntryId,
    });

    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * 원장에 새로운 불변 엔트리 추가 (ANI-838)
   * 14대 필수 필드 완결 및 단방향 체인 링크 유지
   */
  appendEntry(params: AppendLedgerEntryParams): {
    entry: CreditLedgerEntry;
    isIdempotentHit: boolean;
  } {
    const {
      workspaceId,
      entryType,
      amount,
      currentBalance,
      transactionRefId,
      quoteId,
      reason,
      initiatedBy,
      metadata = {},
      idempotencyKey,
    } = params;

    // 멱등성 검사
    const existingEntryId = this.idempotencyIndex.get(idempotencyKey);
    if (existingEntryId) {
      const existing = this.ledger.get(existingEntryId);
      if (existing) {
        return { entry: existing, isIdempotentHit: true };
      }
    }

    const chain = this.workspaceChains.get(workspaceId) || [];
    const previousEntryId = chain.length > 0 ? chain[chain.length - 1] : null;

    const id = `cleg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const createdAt = new Date().toISOString();
    const balanceAfter = currentBalance + amount;

    const partialEntry: Omit<CreditLedgerEntry, 'auditHash'> = {
      id,
      workspaceId,
      entryType,
      amount,
      balanceAfter,
      transactionRefId,
      quoteId,
      reason,
      initiatedBy,
      createdAt,
      metadata,
      idempotencyKey,
      previousEntryId,
    };

    const auditHash = CreditLedgerSourceChain.calculateAuditHash(partialEntry);
    const entry: CreditLedgerEntry = {
      ...partialEntry,
      auditHash,
    };

    // 불변 저장
    this.ledger.set(id, Object.freeze(entry));
    chain.push(id);
    this.workspaceChains.set(workspaceId, chain);
    this.idempotencyIndex.set(idempotencyKey, id);

    return { entry, isIdempotentHit: false };
  }

  /**
   * 워크스페이스의 원장 체인 조회
   */
  getChain(workspaceId: string): CreditLedgerEntry[] {
    const chain = this.workspaceChains.get(workspaceId) || [];
    return chain.map((id) => this.ledger.get(id)!);
  }

  /**
   * 체인 전체의 불변 무결성 검증 (ANI-838)
   */
  verifyChainIntegrity(workspaceId: string): {
    isValid: boolean;
    brokenEntryId?: string;
    reason?: string;
  } {
    const entries = this.getChain(workspaceId);
    let expectedPreviousId: string | null = null;
    let computedBalance = 0;

    for (const entry of entries) {
      // 1. 이전 엔트리 포인터 무결성
      if (entry.previousEntryId !== expectedPreviousId) {
        return {
          isValid: false,
          brokenEntryId: entry.id,
          reason: `체인 링크 파손: expected previous ${expectedPreviousId}, but got ${entry.previousEntryId}`,
        };
      }

      // 2. 해시 무결성
      const expectedHash = CreditLedgerSourceChain.calculateAuditHash(entry);
      if (entry.auditHash !== expectedHash) {
        return {
          isValid: false,
          brokenEntryId: entry.id,
          reason: `감사 해시 불일치: recorded ${entry.auditHash}, but calculated ${expectedHash}`,
        };
      }

      // 3. 잔액 산술 무결성
      computedBalance += entry.amount;
      if (entry.balanceAfter !== computedBalance) {
        return {
          isValid: false,
          brokenEntryId: entry.id,
          reason: `잔액 산술 불일치: calculated ${computedBalance}, but recorded ${entry.balanceAfter}`,
        };
      }

      expectedPreviousId = entry.id;
    }

    return { isValid: true };
  }
}
