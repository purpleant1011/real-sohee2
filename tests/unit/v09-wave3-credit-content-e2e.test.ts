import { describe, it, expect } from 'vitest';
import { CreditLedgerSourceChain } from '@/lib/finops/credit-ledger-source-chain';
import { PgPaymentWebhookHandler } from '@/lib/finops/pg-payment-webhook-handler';
import { WeeklyCreditManager } from '@/features/credit-economy/weekly-credit-manager';
import { ActionCostQuoteEngine } from '@/features/credit-economy/quote-and-policy';
import { CreditTransactionStateMachine } from '@/features/credit-economy/credit-state-machine';
import { RevenueFinOpsReconciler } from '@/lib/finops/revenue-finops-reconciler';
import { ContentCtaPreconditionGate } from '@/features/content-runtime/content-precondition-gate';
import { ChannelNativeContentValidator } from '@/features/content-runtime/channel-native-validator';
import { HarnessProvenanceService } from '@/features/content-runtime/harness-provenance';
import { ContentGenerationActionRunTracker } from '@/features/content-runtime/generation-action-run';
import { CanonicalPublishingScheduleManager } from '@/features/content-runtime/canonical-publishing-schedule';
import { PublishingExceptionQueue } from '@/features/content-runtime/publishing-exception-queue';

describe('V0.9 Wave 3: Credit Economy & Content Runtime Integrated E2E Lifecycle', () => {
  it('E2E Lifecycle: PG Webhook -> Quote -> Preconditions -> Reserve -> Gen -> QC -> Calendar/Queue -> Settle -> Ledger Chain & FinOps Reconcile', async () => {
    const workspaceId = 'ws_prod_e2e_001';

    // 1. 인프라 서비스 인스턴스화
    const ledgerChain = new CreditLedgerSourceChain();
    const pgWebhookHandler = new PgPaymentWebhookHandler(ledgerChain);
    const weeklyManager = new WeeklyCreditManager();
    const quoteEngine = new ActionCostQuoteEngine();
    const creditStateMachine = new CreditTransactionStateMachine();
    const reconciler = new RevenueFinOpsReconciler();

    const preconditionGate = new ContentCtaPreconditionGate();
    const channelValidator = new ChannelNativeContentValidator();
    const provenanceService = new HarnessProvenanceService();
    const actionRunTracker = new ContentGenerationActionRunTracker();
    const scheduleManager = new CanonicalPublishingScheduleManager();
    const exceptionQueue = new PublishingExceptionQueue();

    // 2. 레거시 PG 통보는 지급을 거부한다. 이후 테스트는 기존 잔액 사용 흐름만 검증한다.
    const webhookRes = await pgWebhookHandler.handleWebhook(
      {
        webhookEventId: 'wh_evt_pay_001',
        eventType: 'PAYMENT_COMPLETED',
        workspaceId,
        paymentKey: 'pk_toss_live_123',
        orderId: 'order_sohee_001',
        amountKrw: 150000,
        planTier: 'TIER_150K_STARTER',
        timestamp: new Date().toISOString(),
      },
      0
    );

    expect(webhookRes.status).toBe('FAILED');
    expect(webhookRes.creditsGranted).toBe(0);
    expect(ledgerChain.getChain(workspaceId)).toHaveLength(0);

    // PG 지급을 가장하지 않는 과거 잔액 fixture. 신규 구독 지급/판매 근거가 아니다.
    ledgerChain.appendEntry({
      workspaceId, entryType: 'GRANT', amount: 1500, currentBalance: 0,
      transactionRefId: 'historical_balance_fixture', reason: 'Preserved historical balance fixture',
      initiatedBy: 'TEST', idempotencyKey: 'historical_balance_fixture',
    });

    let balance = {
      workspaceId,
      baseCredits: 1500,
      bonusCredits: 0,
      reservedCredits: 0,
      settledCredits: 0,
    };

    // 3. 주간 크레딧 요약 데이터 빌드 (ANI-820, ANI-840)
    const weeklySummary = weeklyManager.buildWeeklyCreditSummary({
      workspaceId,
      planTier: 'TIER_150K_STARTER',
      baseCredits: balance.baseCredits,
      bonusCredits: balance.bonusCredits,
      reservedCredits: balance.reservedCredits,
      settledCredits: balance.settledCredits,
    });
    expect(weeklySummary.availableCredits).toBe(1500);
    expect(weeklySummary.zeroCreditStatus.canExecuteBillableAction).toBe(true);

    // 4. 선행조건 3대 게이트 검사 (ANI-830)
    const gateResult = preconditionGate.evaluate({
      workspaceId,
      isHarnessReady: true,
      connectedChannels: ['INSTAGRAM_FEED'],
      availableCredits: weeklySummary.availableCredits,
      requiredCredits: 100,
    });
    expect(gateResult.canProceed).toBe(true);
    expect(gateResult.primaryCta.label).toBe('콘텐츠 생성 시작하기');

    // 5. 액션 견적 발행 및 검증 (ANI-824)
    const quote = quoteEngine.createQuote({
      workspaceId,
      actionType: 'INSTAGRAM_POST_GENERATE',
    });
    expect(quote.requiredCredits).toBe(100);

    // 6. 크레딧 사전 차감 예약 (ANI-821)
    const reserveResult = creditStateMachine.reserve({
      workspaceId,
      quote,
      actionRunId: 'act_run_e2e_100',
      idempotencyKey: 'idem_quote_reserve_100',
      balance,
    });
    expect(reserveResult.success).toBe(true);
    balance = reserveResult.updatedBalance;
    expect(balance.reservedCredits).toBe(100);
    expect(creditStateMachine.getAvailableCredits(balance)).toBe(1400);

    // 7. 룩북 참조 출처 증거화 (ANI-831)
    const provenance = provenanceService.createProvenance({
      sourceType: 'SCRAPED_LOOKBOOK',
      sourceAccount: '@trend_beauty_kr',
      sourceUrl: 'https://instagram.com/p/trend_look_99',
      rightsScope: 'COMMERCIAL_USE_ALLOWED',
    });
    expect(provenance.isRightsCleared).toBe(true);

    // 8. 콘텐츠 생성 및 QC 수행 (ANI-832, ANI-885)
    const assetId = 'asset_e2e_100';
    const actionRunId = 'act_run_e2e_100';
    const { asset, drilldown } = actionRunTracker.recordGeneration({
      assetId,
      actionRunId,
      channel: 'INSTAGRAM_FEED',
      prompt: '가을 시그니처 톤다운 염색과 데일리 케어 안내',
      modelIdentifier: 'gemini-3.8-flash-high',
      harnessVersion: 'v2.4.0',
      title: '가을 시그니처 컬러',
      body: '가을 분위기를 더해주는 차분한 무드의 시그니처 컬러를 제안합니다.',
      mediaUrls: ['https://cdn.sohee.ai/images/autumn_hair.jpg'],
      aspectRatio: '1:1',
      hashtags: ['가을헤어', '염색추천', '헤어케어'],
      provenance,
      qcScore: 98,
      qcChecklist: {
        bannedWordsPassed: true,
        channelConstraintsPassed: true,
        voiceConsistencyPassed: true,
      },
      requiresUserApproval: false,
    });
    expect(asset.qcScore).toBe(98);
    expect(drilldown.qcResult.passed).toBe(true);

    // 9. 채널 네이티브 규격 검증 (ANI-834)
    const validation = channelValidator.validate('INSTAGRAM_FEED', {
      body: asset.body,
      mediaUrls: asset.mediaUrls,
      aspectRatio: asset.aspectRatio,
      hashtags: asset.hashtags,
    });
    expect(validation.isValid).toBe(true);

    // 10. 정본 캘린더 등록 및 큐 작업 연결 (ANI-828, ANI-837, ANI-872)
    const calendarEventId = 'cal_evt_e2e_100';
    const jobId = 'job_e2e_100';
    const schedule = scheduleManager.registerSchedule({
      calendarEventId,
      jobId,
      workspaceId,
      assetId,
      channel: 'INSTAGRAM_FEED',
      title: '가을 시그니처 컬러 발행',
      scheduledAt: '2026-09-10T15:00:00Z',
    });
    expect(schedule.status).toBe('SCHEDULED');

    // 11. 실행 상태 전이 및 정산 완료 (ANI-821)
    creditStateMachine.startExecution(reserveResult.reservation!.reservationId);
    const settleResult = creditStateMachine.settle(
      reserveResult.reservation!.reservationId,
      balance
    );
    balance = settleResult.updatedBalance;
    expect(settleResult.reservation.state).toBe('SETTLED');
    expect(balance.reservedCredits).toBe(0);
    expect(balance.baseCredits).toBe(1400); // 1500 - 100
    expect(balance.settledCredits).toBe(100);

    // 원장에 불변 SETTLE 기록 (ANI-838)
    ledgerChain.appendEntry({
      workspaceId,
      entryType: 'SETTLE',
      amount: -100,
      currentBalance: 1500,
      transactionRefId: actionRunId,
      quoteId: quote.quoteId,
      reason: 'Instagram post generation settled',
      initiatedBy: 'SYSTEM_RUNTIME',
      idempotencyKey: `settle_idem_${actionRunId}`,
    });

    // 12. 발행 워커 디스패치 성공 반영 (ANI-872 Same Truth)
    scheduleManager.updateStatus({
      jobId,
      status: 'PUBLISHED',
      publishedUrl: 'https://instagram.com/p/autumn_hair_published',
      externalPostId: 'ig_post_9990001',
    });

    const userViewSchedule = scheduleManager.getByCalendarEventId(calendarEventId);
    expect(userViewSchedule?.status).toBe('PUBLISHED');
    expect(userViewSchedule?.publishedUrl).toBe('https://instagram.com/p/autumn_hair_published');

    // 13. [Admin] 엔드투엔드 자산 계보 드릴다운 확인 (ANI-885)
    actionRunTracker.linkPublication(assetId, {
      jobId,
      calendarEventId,
      status: 'PUBLISHED',
      publishedUrl: userViewSchedule?.publishedUrl,
    });
    const finalDrilldown = actionRunTracker.drilldownAssetProvenance(assetId);
    expect(finalDrilldown?.sourceProvenance.sourceAccount).toBe('@trend_beauty_kr');
    expect(finalDrilldown?.publication.status).toBe('PUBLISHED');

    // 14. 실패 시 격리 큐 및 환불 흐름 검증 (ANI-873, ANI-821)
    const failJob = {
      calendarEventId: 'cal_fail_e2e',
      jobId: 'job_fail_e2e',
      workspaceId,
      assetId: 'asset_fail_e2e',
      channel: 'INSTAGRAM_FEED' as const,
      title: '발행 실패 케이스',
      scheduledAt: '2026-09-10T18:00:00Z',
      status: 'FAILED' as const,
      retryCount: 3,
      maxRetries: 3,
      updatedAt: new Date().toISOString(),
    };
    const quarantined = exceptionQueue.quarantine({
      job: failJob,
      errorCategory: 'CHANNEL_REJECTED',
      errorMessage: 'Instagram Graph API: Rate limit exceeded or media upload timed out',
    });
    expect(quarantined.resolutionStatus).toBe('UNRESOLVED');

    // 관리자 환불 승인
    exceptionQueue.resolveRefund(quarantined.exceptionId, 'admin_supervisor_lee');
    expect(quarantined.resolutionStatus).toBe('REFUNDED');

    // 15. 불변 원장 무결성 전수 검증 (ANI-838)
    const chainIntegrity = ledgerChain.verifyChainIntegrity(workspaceId);
    expect(chainIntegrity.isValid).toBe(true);

    // 16. Revenue ↔ FinOps 자동 대사 검증 (ANI-839)
    const reconcileReport = reconciler.reconcileWorkspace({
      workspaceId,
      payments: [
        {
          paymentId: 'order_sohee_001',
          workspaceId,
          amountKrw: 150000,
          planTier: 'TIER_150K_STARTER',
          paidAt: new Date().toISOString(),
          pgProvider: 'TOSS_PAYMENTS',
        },
      ],
      ledgerSummary: {
        workspaceId,
        totalGrantedCredits: 1500,
        totalBurnedCredits: 100,
        currentBalance: 1400,
      },
    });

    expect(reconcileReport.isReconciled).toBe(true);
    expect(reconcileReport.anomalies.length).toBe(0);
    expect(reconcileReport.totalRevenueKrw).toBe(150000);
  });
});
