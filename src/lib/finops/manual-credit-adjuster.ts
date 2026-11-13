import { CreditLedgerSourceChain } from './credit-ledger-source-chain';
import { CreditLedgerEntry } from '@/features/credit-economy/types';

export interface PreviewAdjustmentParams {
  workspaceId: string;
  adminUserId: string;
  amountDelta: number; // 양수: 추가 지급, 음수: 차감
  reason: string;
  currentBalance: number;
}

export interface AdjustmentPreviewResult {
  previewToken: string;
  workspaceId: string;
  adminUserId: string;
  amountDelta: number;
  currentBalance: number;
  expectedBalanceAfter: number;
  reason: string;
  expiresAt: string;
  isAllowed: boolean;
  rejectReason?: string;
}

export interface ExecuteAdjustmentParams {
  previewToken: string;
  idempotencyKey: string;
}

export interface ReadbackVerificationResult {
  isVerified: boolean;
  ledgerEntry: CreditLedgerEntry;
  actualBalance: number;
  expectedBalance: number;
  verifiedAt: string;
}

export class ManualCreditAdjuster {
  private ledgerChain: CreditLedgerSourceChain;
  private previewSessions: Map<string, AdjustmentPreviewResult> = new Map();

  constructor(ledgerChain: CreditLedgerSourceChain) {
    this.ledgerChain = ledgerChain;
  }

  /**
   * 1단계: Preview (시뮬레이션 및 사전 검증)
   */
  previewAdjustment(params: PreviewAdjustmentParams): AdjustmentPreviewResult {
    const { workspaceId, adminUserId, amountDelta, reason, currentBalance } = params;

    const expectedBalanceAfter = currentBalance + amountDelta;
    let isAllowed = true;
    let rejectReason: string | undefined;

    if (amountDelta === 0) {
      isAllowed = false;
      rejectReason = '조정 금액은 0이 될 수 없습니다.';
    } else if (expectedBalanceAfter < 0) {
      isAllowed = false;
      rejectReason = `조정 후 잔액이 음수(${expectedBalanceAfter})가 되므로 차감할 수 없습니다.`;
    } else if (!reason || reason.trim().length < 5) {
      isAllowed = false;
      rejectReason = '관리자 조정 사유를 최소 5자 이상 입력해야 합니다.';
    }

    const previewToken = `prev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5분 TTL

    const previewResult: AdjustmentPreviewResult = {
      previewToken,
      workspaceId,
      adminUserId,
      amountDelta,
      currentBalance,
      expectedBalanceAfter,
      reason,
      expiresAt,
      isAllowed,
      rejectReason,
    };

    if (isAllowed) {
      this.previewSessions.set(previewToken, previewResult);
    }

    return previewResult;
  }

  /**
   * 2단계: Execute (불변 원장 기록 실행)
   */
  executeAdjustment(params: ExecuteAdjustmentParams): {
    success: boolean;
    entry?: CreditLedgerEntry;
    error?: string;
  } {
    const { previewToken, idempotencyKey } = params;
    const preview = this.previewSessions.get(previewToken);

    if (!preview) {
      return {
        success: false,
        error: '유효하지 않거나 만료된 미리보기 토큰입니다.',
      };
    }

    if (new Date(preview.expiresAt).getTime() <= Date.now()) {
      this.previewSessions.delete(previewToken);
      return {
        success: false,
        error: '미리보기 토큰이 만료되었습니다. 다시 시뮬레이션하세요.',
      };
    }

    // 원장에 불변 엔트리 추가
    const appendResult = this.ledgerChain.appendEntry({
      workspaceId: preview.workspaceId,
      entryType: 'MANUAL_ADJUST',
      amount: preview.amountDelta,
      currentBalance: preview.currentBalance,
      transactionRefId: `admin_adj_${preview.adminUserId}_${Date.now()}`,
      reason: `[관리자 수기조정] ${preview.reason} (작업자: ${preview.adminUserId})`,
      initiatedBy: `ADMIN:${preview.adminUserId}`,
      metadata: {
        previewToken,
        adminUserId: preview.adminUserId,
      },
      idempotencyKey,
    });

    // 사용 완료된 토큰 폐기
    this.previewSessions.delete(previewToken);

    return {
      success: true,
      entry: appendResult.entry,
    };
  }

  /**
   * 3단계: Readback Verification (정본 일치 검증)
   */
  readbackVerification(entryId: string, workspaceId: string): ReadbackVerificationResult {
    const chain = this.ledgerChain.getChain(workspaceId);
    const targetEntry = chain.find((e) => e.id === entryId);

    if (!targetEntry) {
      throw new Error(`원장에서 엔트리를 찾을 수 없습니다: ${entryId}`);
    }

    // 체인의 마지막 엔트리의 balanceAfter가 최신 잔액
    const lastEntry = chain[chain.length - 1];
    const actualBalance = lastEntry ? lastEntry.balanceAfter : 0;

    const isVerified =
      targetEntry.balanceAfter === actualBalance &&
      targetEntry.entryType === 'MANUAL_ADJUST';

    return {
      isVerified,
      ledgerEntry: targetEntry,
      actualBalance,
      expectedBalance: targetEntry.balanceAfter,
      verifiedAt: new Date().toISOString(),
    };
  }
}
