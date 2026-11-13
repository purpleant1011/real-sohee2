import { SoheePlanTier } from '@/features/credit-economy/types';
import { PLAN_WEEKLY_ALLOWANCES } from '@/lib/outcome-os/commercial/weekly-credit-cycle-engine';

export interface PaymentRevenueRecord {
  paymentId: string;
  workspaceId: string;
  amountKrw: number;
  planTier: SoheePlanTier;
  paidAt: string;
  pgProvider: 'TOSS_PAYMENTS' | 'INICIS';
}

export interface CreditLedgerSummaryForReconciliation {
  workspaceId: string;
  totalGrantedCredits: number;
  totalBurnedCredits: number;
  currentBalance: number;
}

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ReconciliationAnomaly {
  anomalyId: string;
  workspaceId: string;
  severity: AnomalySeverity;
  type:
    | 'PAYMENT_CREDIT_MISMATCH'
    | 'UNAUTHORIZED_GRANT'
    | 'NEGATIVE_BALANCE_DETECTED'
    | 'ORPHAN_PAYMENT_WITHOUT_CREDIT';
  details: string;
  expectedCredits: number;
  actualCredits: number;
  detectedAt: string;
}

export class RevenueFinOpsReconciler {
  /**
   * 워크스페이스 단위 Revenue ↔ FinOps 대사 실행 (ANI-839)
   */
  reconcileWorkspace(params: {
    workspaceId: string;
    payments: PaymentRevenueRecord[];
    ledgerSummary: CreditLedgerSummaryForReconciliation;
  }): {
    isReconciled: boolean;
    anomalies: ReconciliationAnomaly[];
    totalRevenueKrw: number;
    expectedTotalCredits: number;
    actualGrantedCredits: number;
  } {
    const { workspaceId, payments, ledgerSummary } = params;
    const anomalies: ReconciliationAnomaly[] = [];

    const totalRevenueKrw = payments.reduce((sum, p) => sum + p.amountKrw, 0);

    // 1. 결제 내역 기반 기대 크레딧 산출 (기본 주간 allowance 합산)
    let expectedTotalCredits = 0;
    for (const p of payments) {
      const allowance = PLAN_WEEKLY_ALLOWANCES[p.planTier] || 0;
      expectedTotalCredits += allowance;
    }

    // 2. 음수 잔액 검사
    if (ledgerSummary.currentBalance < 0) {
      anomalies.push({
        anomalyId: `anom_neg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        workspaceId,
        severity: 'CRITICAL',
        type: 'NEGATIVE_BALANCE_DETECTED',
        details: `음수 잔액이 감지되었습니다. (현재 잔액: ${ledgerSummary.currentBalance})`,
        expectedCredits: 0,
        actualCredits: ledgerSummary.currentBalance,
        detectedAt: new Date().toISOString(),
      });
    }

    // 3. 결제 없음에도 비정상적인 대량 크레딧 부여 검사
    if (payments.length === 0 && ledgerSummary.totalGrantedCredits > 50) {
      // FREE_TASTE(50) 초과 부여
      anomalies.push({
        anomalyId: `anom_unauth_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        workspaceId,
        severity: 'HIGH',
        type: 'UNAUTHORIZED_GRANT',
        details: `결제 기록이 없음에도 대량의 크레딧(${ledgerSummary.totalGrantedCredits})이 부여되었습니다.`,
        expectedCredits: 50,
        actualCredits: ledgerSummary.totalGrantedCredits,
        detectedAt: new Date().toISOString(),
      });
    }

    // 4. 결제액 대비 기대 크레딧과 실제 부여 크레딧 간의 중대한 괴리(불일치) 검사
    if (payments.length > 0 && ledgerSummary.totalGrantedCredits < expectedTotalCredits) {
      anomalies.push({
        anomalyId: `anom_orphan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        workspaceId,
        severity: 'HIGH',
        type: 'ORPHAN_PAYMENT_WITHOUT_CREDIT',
        details: `결제가 완료되었으나 정상 배정 크레딧보다 적게 부여되었습니다. (기대: ${expectedTotalCredits}, 실제: ${ledgerSummary.totalGrantedCredits})`,
        expectedCredits: expectedTotalCredits,
        actualCredits: ledgerSummary.totalGrantedCredits,
        detectedAt: new Date().toISOString(),
      });
    }

    return {
      isReconciled: anomalies.length === 0,
      anomalies,
      totalRevenueKrw,
      expectedTotalCredits,
      actualGrantedCredits: ledgerSummary.totalGrantedCredits,
    };
  }
}
