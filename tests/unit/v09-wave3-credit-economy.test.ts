import { describe, it, expect } from 'vitest';
import {
  OFFICIAL_CREDIT_UNIT,
  CREDIT_SCHEMA_VERSION,
} from '@/features/credit-economy/types';
import { CreditTransactionStateMachine } from '@/features/credit-economy/credit-state-machine';
import {
  ActionCostQuoteEngine,
  createTripartiteCostPolicy,
} from '@/features/credit-economy/quote-and-policy';
import {
  WeeklyCreditManager,
  getNextMonday9amKst,
} from '@/features/credit-economy/weekly-credit-manager';
import { CreditLedgerSourceChain } from '@/lib/finops/credit-ledger-source-chain';
import { RevenueFinOpsReconciler } from '@/lib/finops/revenue-finops-reconciler';
import { PgPaymentWebhookHandler } from '@/lib/finops/pg-payment-webhook-handler';
import { ManualCreditAdjuster } from '@/lib/finops/manual-credit-adjuster';

describe('V0.9 Wave 3: Credit Economy Core Tests', () => {
  // ANI-819: 공식 제품 명칭 SSOT 검증
  it('ANI-819: official credit unit is SOHEE_CREDIT and schema version is 2', () => {
    expect(OFFICIAL_CREDIT_UNIT).toBe('SOHEE_CREDIT');
    expect(CREDIT_SCHEMA_VERSION).toBe(2);
  });

  // ANI-823: 3대 정책 독립 모델 검증
  it('ANI-823: TripartiteCostPolicy decouples Entitlement, Sohee Credit, and External Ad Spend', () => {
    const starterPolicy = createTripartiteCostPolicy('TIER_150K_STARTER');
    expect(starterPolicy.entitlement.planTier).toBe('TIER_150K_STARTER');
    expect(starterPolicy.soheeCredit.unit).toBe('SOHEE_CREDIT');
    expect(starterPolicy.soheeCredit.weeklyAllowance).toBe(1500);
    expect(starterPolicy.externalAdSpend.isDirectlyBilledByPlatform).toBe(true);
    expect(starterPolicy.externalAdSpend.platformFeeRate).toBe(0);

    const proPolicy = createTripartiteCostPolicy('TIER_500K_PRO_SCALE');
    expect(proPolicy.soheeCredit.weeklyAllowance).toBe(6500);
    expect(proPolicy.entitlement.maxConcurrentActionRuns).toBe(10);
  });

  // ANI-824: Action Cost Quote 엔진
  it('ANI-824: ActionCostQuoteEngine issues exact quotes with TTL and affordability checks', () => {
    const engine = new ActionCostQuoteEngine(15 * 60 * 1000);
    const quote = engine.createQuote({
      workspaceId: 'ws_test_1',
      actionType: 'INSTAGRAM_POST_GENERATE',
    });

    expect(quote.requiredCredits).toBe(100);
    expect(quote.tripartiteClassification).toBe('SOHEE_CREDIT');
    expect(new Date(quote.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // 잔액 검사: 150 크레딧 보유 시 통과
    const checkPass = engine.validateAndCheckAffordability(quote, 150);
    expect(checkPass.isValid).toBe(true);
    expect(checkPass.canAfford).toBe(true);

    // 잔액 검사: 50 크레딧 보유 시 불가
    const checkFail = engine.validateAndCheckAffordability(quote, 50);
    expect(checkFail.canAfford).toBe(false);
    expect(checkFail.deficitCredits).toBe(50);
  });

  // ANI-821 & ANI-825: Credit Reserve -> Settle / Release 및 Zero Credit Semantics
  it('ANI-821, ANI-825: CreditTransactionStateMachine executes atomic reserve, settle, and release with idempotency', () => {
    const sm = new CreditTransactionStateMachine();
    const quoteEngine = new ActionCostQuoteEngine();
    const quote = quoteEngine.createQuote({
      workspaceId: 'ws_test_2',
      actionType: 'NAVER_BLOG_LONG_GENERATE', // cost: 250
    });

    let balance = {
      workspaceId: 'ws_test_2',
      baseCredits: 500,
      bonusCredits: 100,
      reservedCredits: 0,
      settledCredits: 0,
    };

    // 1. Reserve 실행
    const res1 = sm.reserve({
      workspaceId: 'ws_test_2',
      quote,
      actionRunId: 'act_run_1',
      idempotencyKey: 'idem_key_1',
      balance,
    });

    expect(res1.success).toBe(true);
    expect(res1.reservation?.state).toBe('RESERVED');
    balance = res1.updatedBalance;
    expect(balance.reservedCredits).toBe(250);
    expect(sm.getAvailableCredits(balance)).toBe(350);

    // 2. 동일 멱등키 재호출 시 기존 예약 반환 (중복 예약 차단)
    const resDuplicate = sm.reserve({
      workspaceId: 'ws_test_2',
      quote,
      actionRunId: 'act_run_1',
      idempotencyKey: 'idem_key_1',
      balance,
    });
    expect(resDuplicate.errorCode).toBe('IDEMPOTENT_HIT');
    expect(resDuplicate.reservation?.reservationId).toBe(res1.reservation?.reservationId);

    // 3. Execution 시작 및 Settle 성공
    sm.startExecution(res1.reservation!.reservationId);
    const settleRes = sm.settle(res1.reservation!.reservationId, balance);
    balance = settleRes.updatedBalance;

    expect(settleRes.reservation.state).toBe('SETTLED');
    expect(balance.reservedCredits).toBe(0);
    expect(balance.baseCredits).toBe(250); // 500 - 250
    expect(balance.settledCredits).toBe(250);

    // 4. Zero Credit 상태에서 예약 시도 시 차단 검증
    const zeroBalance = {
      workspaceId: 'ws_test_2',
      baseCredits: 0,
      bonusCredits: 0,
      reservedCredits: 0,
      settledCredits: 600,
    };
    const resZero = sm.reserve({
      workspaceId: 'ws_test_2',
      quote,
      actionRunId: 'act_run_2',
      idempotencyKey: 'idem_key_zero',
      balance: zeroBalance,
    });
    expect(resZero.success).toBe(false);
    expect(resZero.errorCode).toBe('ZERO_CREDITS');

    // 5. 실패 시 Release 검증
    const quote2 = quoteEngine.createQuote({
      workspaceId: 'ws_test_2',
      actionType: 'THREADS_SHORT_GENERATE', // cost: 50
    });
    const res2 = sm.reserve({
      workspaceId: 'ws_test_2',
      quote: quote2,
      actionRunId: 'act_run_3',
      idempotencyKey: 'idem_key_3',
      balance,
    });
    expect(res2.success).toBe(true);
    balance = res2.updatedBalance;
    expect(balance.reservedCredits).toBe(50);

    const releaseRes = sm.release(res2.reservation!.reservationId, balance, 'Execution timed out');
    balance = releaseRes.updatedBalance;
    expect(releaseRes.reservation.state).toBe('RELEASED');
    expect(balance.reservedCredits).toBe(0);
  });

  // ANI-820, ANI-840: Weekly Credit Cycle SSOT & Widget Data Model
  it('ANI-820, ANI-840: WeeklyCreditManager computes Monday 09:00 KST and resets base credits cleanly', () => {
    const manager = new WeeklyCreditManager();

    // 임의의 수요일 기준 다음 월요일 09:00 KST 검증
    const wednesday = new Date('2026-09-02T12:00:00Z');
    const nextMonday = getNextMonday9amKst(wednesday);
    // KST 9:00 AM = UTC 0:00 AM
    expect(nextMonday.getUTCDay()).toBe(1); // Monday
    expect(nextMonday.getUTCHours()).toBe(0);

    // 위젯 요약 모델 생성
    const summary = manager.buildWeeklyCreditSummary({
      workspaceId: 'ws_test_weekly',
      planTier: 'TIER_300K_GROWTH',
      baseCredits: 2000,
      bonusCredits: 500,
      reservedCredits: 300,
      settledCredits: 1500,
      referenceDate: wednesday,
    });

    expect(summary.unit).toBe('SOHEE_CREDIT');
    expect(summary.schemaVersion).toBe(2);
    expect(summary.availableCredits).toBe(2200); // 2000 + 500 - 300
    expect(summary.zeroCreditStatus.isZero).toBe(false);
    expect(summary.zeroCreditStatus.primaryCtaText).toBe('작업 실행하기');

    // 주간 리셋 실행
    const resetResult = manager.executeWeeklyReset({
      workspaceId: 'ws_test_weekly',
      planTier: 'TIER_300K_GROWTH',
      currentBaseCredits: 500, // 미사용
      currentBonusCredits: 500,
      currentReservedCredits: 0,
    });

    expect(resetResult.expiredBaseCredits).toBe(500); // 미사용 소멸
    expect(resetResult.newBaseCredits).toBe(3500); // TIER_300K_GROWTH 주간 allowance
    expect(resetResult.bonusCreditsPreserved).toBe(500); // 보너스는 보존
  });

  // ANI-838: Admin 불변 원장 14대 필수 필드 체인 및 SHA-256 무결성
  it('ANI-838: CreditLedgerSourceChain ensures 14 required fields and SHA-256 chain integrity', () => {
    const chain = new CreditLedgerSourceChain();
    const wsId = 'ws_ledger_1';

    // Entry 1: 주간 배정
    const e1 = chain.appendEntry({
      workspaceId: wsId,
      entryType: 'GRANT',
      amount: 1500,
      currentBalance: 0,
      transactionRefId: 'grant_weekly_1',
      reason: 'Weekly base allowance',
      initiatedBy: 'SYSTEM_CRON',
      idempotencyKey: 'cron_week_1',
    });

    expect(e1.entry.balanceAfter).toBe(1500);
    expect(e1.entry.previousEntryId).toBeNull();
    expect(e1.entry.auditHash).toBeDefined();

    // Entry 2: 작업 실행 차감
    const e2 = chain.appendEntry({
      workspaceId: wsId,
      entryType: 'SETTLE',
      amount: -100,
      currentBalance: 1500,
      transactionRefId: 'act_run_insta_1',
      quoteId: 'quote_1',
      reason: 'Instagram post generated',
      initiatedBy: 'USER_ACTION',
      idempotencyKey: 'act_settle_1',
    });

    expect(e2.entry.balanceAfter).toBe(1400);
    expect(e2.entry.previousEntryId).toBe(e1.entry.id);

    // 체인 전체 무결성 검증 통과
    const verifyResult = chain.verifyChainIntegrity(wsId);
    expect(verifyResult.isValid).toBe(true);
  });

  // ANI-839: Revenue ↔ FinOps 자동 대사 엔진
  it('ANI-839: RevenueFinOpsReconciler detects mismatches and anomalies', () => {
    const reconciler = new RevenueFinOpsReconciler();

    // 정상 대사 시나리오
    const normalResult = reconciler.reconcileWorkspace({
      workspaceId: 'ws_rec_1',
      payments: [
        {
          paymentId: 'pay_1',
          workspaceId: 'ws_rec_1',
          amountKrw: 150000,
          planTier: 'TIER_150K_STARTER', // allowance: 1500
          paidAt: new Date().toISOString(),
          pgProvider: 'TOSS_PAYMENTS',
        },
      ],
      ledgerSummary: {
        workspaceId: 'ws_rec_1',
        totalGrantedCredits: 1500,
        totalBurnedCredits: 300,
        currentBalance: 1200,
      },
    });

    expect(normalResult.isReconciled).toBe(true);
    expect(normalResult.anomalies.length).toBe(0);

    // 이상 시나리오: 결제 없이 비정상 크레딧 부여 감지
    const abnormalResult = reconciler.reconcileWorkspace({
      workspaceId: 'ws_rec_2',
      payments: [],
      ledgerSummary: {
        workspaceId: 'ws_rec_2',
        totalGrantedCredits: 5000,
        totalBurnedCredits: 0,
        currentBalance: 5000,
      },
    });

    expect(abnormalResult.isReconciled).toBe(false);
    expect(abnormalResult.anomalies.some((a) => a.type === 'UNAUTHORIZED_GRANT')).toBe(true);
  });

  // ANI-841: PG Webhook 멱등 체인
  it('ANI-841: PgPaymentWebhookHandler handles payment webhooks idempotently', async () => {
    const chain = new CreditLedgerSourceChain();
    const handler = new PgPaymentWebhookHandler(chain);

    const payload = {
      webhookEventId: 'evt_toss_999',
      eventType: 'PAYMENT_COMPLETED' as const,
      workspaceId: 'ws_webhook_1',
      paymentKey: 'pay_key_abc',
      orderId: 'order_123',
      amountKrw: 300000,
      planTier: 'TIER_300K_GROWTH' as const,
      timestamp: new Date().toISOString(),
    };

    // 신규 구독은 크레딧을 지급하지 않으며 미검증 웹훅은 완료로 처리하지 않는다.
    const res1 = await handler.handleWebhook(payload, 0);
    expect(res1.status).toBe('FAILED');
    expect(res1.creditsGranted).toBe(0);
    expect(res1.newBalance).toBe(0);

    const res2 = await handler.handleWebhook(payload, 0);
    expect(res2.status).toBe('FAILED');
    expect(res2.creditsGranted).toBe(0);
    expect(chain.getChain(payload.workspaceId)).toHaveLength(0);
  });

  // ANI-842: 수기 크레딧 조정 (Preview -> Execute -> Readback)
  it('ANI-842: ManualCreditAdjuster enforces Preview -> Execute -> Readback pipeline', () => {
    const chain = new CreditLedgerSourceChain();
    const adjuster = new ManualCreditAdjuster(chain);
    const wsId = 'ws_manual_1';

    // 초기 상태: 1000 크레딧 부여
    chain.appendEntry({
      workspaceId: wsId,
      entryType: 'GRANT',
      amount: 1000,
      currentBalance: 0,
      transactionRefId: 'init_1',
      reason: 'Initial setup',
      initiatedBy: 'SYSTEM',
      idempotencyKey: 'init_key',
    });

    // 1단계: Preview (+500 지급 시뮬레이션)
    const preview = adjuster.previewAdjustment({
      workspaceId: wsId,
      adminUserId: 'admin_sohee_01',
      amountDelta: 500,
      reason: '고객 만족 보상 프로모션 크레딧 지급',
      currentBalance: 1000,
    });

    expect(preview.isAllowed).toBe(true);
    expect(preview.expectedBalanceAfter).toBe(1500);

    // 2단계: Execute
    const execResult = adjuster.executeAdjustment({
      previewToken: preview.previewToken,
      idempotencyKey: 'admin_exec_key_1',
    });

    expect(execResult.success).toBe(true);
    expect(execResult.entry?.balanceAfter).toBe(1500);

    // 3단계: Readback Verification
    const readback = adjuster.readbackVerification(execResult.entry!.id, wsId);
    expect(readback.isVerified).toBe(true);
    expect(readback.actualBalance).toBe(1500);
  });
});
