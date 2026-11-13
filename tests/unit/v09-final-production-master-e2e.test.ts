import { describe, it, expect } from 'vitest';

// 1. Onboarding & Knowledge
import { FirstValueOnboardingEngine } from '@/features/onboarding/first-value-onboarding';
import { KnowledgeStudioService } from '@/features/knowledge-studio/knowledge-studio-service';

// 2. Studio & Home
import { ChiefOfStaffHomeService } from '@/features/home/chief-of-staff-home-service';
import { CampaignActionGraphEngine } from '@/features/agent-studio/campaign-action-graph';
import { MySoheeCentersService } from '@/features/agent-studio/my-sohee-centers';

// 3. Plugin Ecosystem
import { PluginRegistryService } from '@/features/plugin-ecosystem/plugin-registry-service';

// 4. Credit & FinOps
import { CreditTransactionStateMachine } from '@/features/credit-economy/credit-state-machine';
import { ActionCostQuoteEngine } from '@/features/credit-economy/quote-and-policy';
import { CreditLedgerSourceChain } from '@/lib/finops/credit-ledger-source-chain';

// 5. CRM & Attribution
import { CustomerIdentityResolutionGraph } from '@/features/crm/customer-identity-graph';
import { BookingLifecycleEngine } from '@/features/crm/booking-lifecycle';
import { ResultsAttributionDrilldownService } from '@/features/attribution/results-attribution-drilldown';
import { VerifiedOutcomeLearner } from '@/features/attribution/verified-outcome-learner';

// 6. Ads & Operations
import { SoheeAdAgencyService } from '@/features/ads/sohee-ad-agency-service';
import { IncidentCenterService } from '@/lib/admin-ops/incident-center-service';
import { OutcomeSloDashboardService } from '@/lib/admin-ops/outcome-slo-dashboard';
import { ProductionReverificationHarness } from '@/features/qa-verification/production-reverification-harness';

describe('V0.9 Final Production Master E2E · Full Marketing Agent Journey', () => {
  it('온보딩부터 지식 교육, 플러그인, 콘텐츠 생성, CRM, 매출 귀속, 유료광고, 관제까지 완벽 완결된다', async () => {
    const workspaceId = 'ws_master_salon_01';

    // -------------------------------------------------------------
    // Step 1. First Value Onboarding (ANI-865)
    // -------------------------------------------------------------
    const onboardingEngine = new FirstValueOnboardingEngine();
    let journey = onboardingEngine.startJourney(workspaceId);
    expect(journey.currentStep).toBe('BIZ_PROFILE_INPUT');

    journey = onboardingEngine.advanceStep(workspaceId, 'BIZ_PROFILE_INPUT');
    journey = onboardingEngine.advanceStep(workspaceId, 'HARNESS_VOICE_ANALYSIS');
    journey = onboardingEngine.advanceStep(workspaceId, 'SINGLE_CHANNEL_CONNECT');
    journey = onboardingEngine.advanceStep(workspaceId, 'FIRST_DRAFT_GENERATE');
    journey = onboardingEngine.advanceStep(
      workspaceId,
      'FIRST_VERIFIED_ACTION',
      'action_first_verified_01'
    );

    expect(journey.isFirstValueAchieved).toBe(true);
    expect(journey.completedSteps).toContain('FIRST_VERIFIED_ACTION');

    // -------------------------------------------------------------
    // Step 2. Knowledge Studio 매장 고유 지식 교육 (ANI-888)
    // -------------------------------------------------------------
    const knowledgeService = new KnowledgeStudioService();
    const recipe = knowledgeService.teachKnowledge({
      workspaceId,
      category: 'TECHNIQUE_RECIPE',
      title: '시그니처 레이어드 C컬펌 시술 노하우',
      content: '뿌리 볼륨을 살리고 얼굴형에 맞춰 자연스러운 C컬을 연출하여 손질이 쉬움',
      priority: 10,
    });
    expect(recipe.knowledgeId).toBeDefined();

    const compiledKnowledge = knowledgeService.compileKnowledgeContext(workspaceId);
    expect(compiledKnowledge).toContain('시그니처 레이어드 C컬펌');

    // -------------------------------------------------------------
    // Step 3. Chief of Staff Home & My Sohee Centers (ANI-858, ANI-889)
    // -------------------------------------------------------------
    const homeService = new ChiefOfStaffHomeService();
    const homeState = homeService.buildHomeState({
      workspaceId,
      attentionItems: [
        {
          id: 'att_01',
          title: '인스타그램 토큰 만료 7일 전',
          severity: 'MEDIUM',
          actionUrl: '/channels',
        },
      ],
      opportunities: [
        {
          id: 'opp_01',
          title: '주말 예약 공실 타겟팅 이벤트 제안',
          potentialGain: '예상 매출 +50만원',
          actionUrl: '/campaigns/new',
        },
      ],
      pendingApprovalsCount: 1,
      recentProofCardsCount: 3,
      weeklyOutcomeRevenueKrw: 3500000,
      availableCredits: 2000,
      systemHealthScore: 100,
    });
    expect(homeState.pendingApprovalsCount).toBe(1);
    expect(homeState.weeklyOutcomeRevenueKrw).toBe(3500000);

    const centersService = new MySoheeCentersService();
    const briefing = centersService.createDailyBriefing({
      workspaceId,
      summary: '오늘 인스타그램 예약 포스팅 1건 및 리뷰 답변 2건 대기',
      operatingRules: ['친절한 어조 유지', '100% 보장 문구 금지'],
      priorityTasks: ['인스타그램 피드 발행 승인'],
    });
    expect(briefing.operatingRules).toHaveLength(2);

    // -------------------------------------------------------------
    // Step 4. Plugin Ecosystem 3축 모델 & 위저드 (ANI-805, ANI-806, ANI-861)
    // -------------------------------------------------------------
    const pluginRegistry = new PluginRegistryService();
    const instaPlugin = pluginRegistry.getPlugin('plg_meta_instagram');
    expect(instaPlugin?.triaxialState.trustTier).toBe('VERIFIED_CORE');
    expect(instaPlugin?.triaxialState.lifecycleState).toBe('INSTALLED_HEALTHY');

    const wizardSession = pluginRegistry.startInstallWizard(
      workspaceId,
      'plg_daangn_local'
    );
    expect(wizardSession.currentStep).toBe('CHECK_ENTITLEMENT');

    pluginRegistry.advanceWizardStep(wizardSession.sessionId);
    pluginRegistry.advanceWizardStep(wizardSession.sessionId);
    pluginRegistry.advanceWizardStep(wizardSession.sessionId);
    pluginRegistry.advanceWizardStep(wizardSession.sessionId);
    const completedSession = pluginRegistry.advanceWizardStep(wizardSession.sessionId);
    expect(completedSession.isCompleted).toBe(true);

    const readyCount = pluginRegistry.getReadyPluginCount(workspaceId);
    expect(readyCount).toBe(4);

    // -------------------------------------------------------------
    // Step 5. Campaign Action Graph & Credit Economy (ANI-860, ANI-818)
    // -------------------------------------------------------------
    const actionGraphEngine = new CampaignActionGraphEngine();
    let campaignGraph = actionGraphEngine.createCampaign(
      workspaceId,
      '봄맞이 시그니처 펌 프로모션'
    );
    expect(campaignGraph.currentStage).toBe('RESEARCH');

    campaignGraph = actionGraphEngine.completeStage(
      campaignGraph.campaignId,
      'RESEARCH',
      '경쟁 살롱 및 인근 상권 키워드 분석 완료'
    );
    campaignGraph = actionGraphEngine.completeStage(
      campaignGraph.campaignId,
      'STRATEGY',
      '첫방문 30% 혜택 강조 전략 수립'
    );
    campaignGraph = actionGraphEngine.completeStage(
      campaignGraph.campaignId,
      'PLAN',
      '릴스 및 네이버 플레이스 동시 배포 일정 수립'
    );
    campaignGraph = actionGraphEngine.completeStage(
      campaignGraph.campaignId,
      'CREATIVE',
      '화보형 비주얼 카드 및 카피 생성'
    );
    campaignGraph = actionGraphEngine.completeStage(
      campaignGraph.campaignId,
      'APPROVAL',
      '원장님 1-클릭 승인 완료'
    );
    campaignGraph = actionGraphEngine.completeStage(
      campaignGraph.campaignId,
      'EXECUTE',
      '인스타그램 Graph API 포스팅 완료'
    );
    campaignGraph = actionGraphEngine.completeStage(
      campaignGraph.campaignId,
      'VERIFY',
      '피드 리드백 및 퍼머링크 검증 완료'
    );
    campaignGraph = actionGraphEngine.completeStage(
      campaignGraph.campaignId,
      'ATTRIBUTE',
      '예약 전환 5건 발생 추적'
    );
    campaignGraph = actionGraphEngine.completeStage(
      campaignGraph.campaignId,
      'LEARN',
      '시그니처 C컬 키워드 가중치 업데이트'
    );

    expect(campaignGraph.isFullyCompleted).toBe(true);

    // 크레딧 견적 및 상태 머신 원자적 차감
    const quoteEngine = new ActionCostQuoteEngine();
    const quote = quoteEngine.createQuote({
      workspaceId,
      actionType: 'INSTAGRAM_POST_GENERATE',
    });
    expect(quote.requiredCredits).toBe(100);

    const creditStateMachine = new CreditTransactionStateMachine();
    let balance = {
      workspaceId,
      baseCredits: 1000,
      bonusCredits: 0,
      reservedCredits: 0,
      settledCredits: 0,
    };
    const reserveRes = creditStateMachine.reserve({
      workspaceId,
      quote,
      actionRunId: campaignGraph.campaignId,
      idempotencyKey: `idem_${campaignGraph.campaignId}`,
      balance,
    });
    expect(reserveRes.success).toBe(true);
    balance = reserveRes.updatedBalance;

    const settleRes = creditStateMachine.settle(
      reserveRes.reservation!.reservationId,
      balance
    );
    expect(settleRes.reservation.state).toBe('SETTLED');
    balance = settleRes.updatedBalance;

    // FinOps SHA-256 감사 원장 체인 검증
    const ledgerChainService = new CreditLedgerSourceChain();
    const e1 = ledgerChainService.appendEntry({
      workspaceId,
      entryType: 'GRANT',
      amount: 1000,
      currentBalance: 0,
      transactionRefId: 'tx_grant_01',
      reason: 'Starter allowance',
      initiatedBy: 'SYSTEM_CRON',
      idempotencyKey: 'idem_grant_01',
    });
    expect(e1.entry.auditHash).toBeDefined();
    const e2 = ledgerChainService.appendEntry({
      workspaceId,
      entryType: 'SETTLE',
      amount: -100,
      currentBalance: 1000,
      transactionRefId: campaignGraph.campaignId,
      reason: 'Post published',
      initiatedBy: 'USER_ACTION',
      idempotencyKey: `idem_settle_${campaignGraph.campaignId}`,
    });
    expect(e2.entry.auditHash).toBeDefined();
    const chainVerification = ledgerChainService.verifyChainIntegrity(workspaceId);
    expect(chainVerification.isValid).toBe(true);

    // -------------------------------------------------------------
    // Step 6. CRM Identity Graph & Booking Lifecycle (ANI-850, ANI-851)
    // -------------------------------------------------------------
    const identityGraphService = new CustomerIdentityResolutionGraph();
    const cust = identityGraphService.resolveAndLink({
      workspaceId,
      identity: {
        type: 'INSTAGRAM_HANDLE',
        value: '@beauty_lover_99',
        sourceChannel: 'INSTAGRAM_DM',
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        confidenceScore: 0.9,
      },
      customerHints: { name: '이지은', phone: '010-1234-5678' },
    });
    expect(cust.customerId).toBeDefined();

    const bookingEngine = new BookingLifecycleEngine();
    const booking = bookingEngine.createBooking({
      workspaceId,
      customerId: cust.customerId,
      serviceName: '시그니처 C컬펌',
      slotStartTime: '2026-09-12T14:00:00Z',
      slotEndTime: '2026-09-12T15:30:00Z',
      initialStatus: 'HOLD',
      holdTtlMinutes: 15,
      attributedSourceEventId: campaignGraph.campaignId,
    });
    expect(booking.status).toBe('HOLD');

    bookingEngine.transitionStatus(booking.bookingId, 'CONFIRMED');
    bookingEngine.transitionStatus(booking.bookingId, 'VISITED');
    const completedBooking = bookingEngine.transitionStatus(
      booking.bookingId,
      'REVENUE_ATTRIBUTED',
      { revenueKrw: 180000 }
    );
    expect(completedBooking.status).toBe('REVENUE_ATTRIBUTED');

    // -------------------------------------------------------------
    // Step 7. Results Attribution & Learner (ANI-854, ANI-857)
    // -------------------------------------------------------------
    const attributionService = new ResultsAttributionDrilldownService();
    const drilldown = attributionService.createDrilldownPath({
      workspaceId,
      sourceEvent: {
        sourceEventId: campaignGraph.campaignId,
        channel: 'INSTAGRAM_FEED',
        headline: '봄맞이 시그니처 펌 프로모션',
        publishedAt: new Date().toISOString(),
        utmSource: 'instagram',
        utmCampaign: 'spring_hair_2026',
      },
      lead: {
        customerId: cust.customerId,
        channel: 'INSTAGRAM_DM',
        acquiredAt: new Date().toISOString(),
      },
      booking: {
        bookingId: booking.bookingId,
        serviceName: '시그니처 C컬펌',
        slotStartTime: '2026-09-12T14:00:00Z',
        status: 'VISITED',
      },
      revenue: {
        revenueKrw: 180000,
        settledAt: new Date().toISOString(),
      },
    });
    expect(drilldown.attributionId).toBeDefined();
    expect(drilldown.nextBestAction).toBeDefined();

    const outcomeLearner = new VerifiedOutcomeLearner();
    const ingestResult = outcomeLearner.ingestOutcomes(workspaceId, [
      {
        outcomeId: 'out_prod_01',
        workspaceId,
        isVerifiedProduction: true,
        isDemoOrFallback: false,
        channel: 'INSTAGRAM_FEED',
        publishDayOfWeek: 3,
        publishHourKst: 18,
        topic: '봄맞이 시그니처 펌 프로모션',
        targetAudienceSegment: '신규 고객',
        conversionsCount: 5,
        revenueKrw: 180000,
      },
    ]);
    expect(ingestResult.ingestedCount).toBe(1);
    expect(ingestResult.rejectedNoiseCount).toBe(0);

    const nba = outcomeLearner.generateNextBestAction(workspaceId);
    expect(nba).toBeDefined();

    // -------------------------------------------------------------
    // Step 8. Organic -> Paid Ad Promotion (ANI-895)
    // -------------------------------------------------------------
    const adService = new SoheeAdAgencyService();
    const adCampaign = adService.promoteContentToAd({
      workspaceId,
      sourceContentAssetId: campaignGraph.campaignId,
      channel: 'META_ADS',
      headline: '살롱 드 소희 시그니처 펌 첫방문 30% 한정 혜택',
      dailyBudgetKrw: 20000,
      totalBudgetCapKrw: 200000,
    });
    expect(adCampaign.operationMode).toBe('SOHEE_AUTONOMOUS_DELEGATED');

    const updatedAd = adService.recordPerformance(adCampaign.campaignId, {
      spentKrwDelta: 100000,
      impressionsDelta: 15000,
      clicksDelta: 600,
      leadsDelta: 40,
      bookingsDelta: 15,
      revenueKrwDelta: 650000,
    });
    expect(updatedAd.metrics.roasPercent).toBe(650); // 650% ROAS

    // -------------------------------------------------------------
    // Step 9. Operations Control & QA-01~30 Reverification (ANI-878, ANI-884)
    // -------------------------------------------------------------
    const incidentService = new IncidentCenterService();
    expect(incidentService.listActiveIncidents()).toHaveLength(0);

    const sloDashboard = new OutcomeSloDashboardService();
    const sloReport = sloDashboard.evaluateSlo({
      totalExecutions: 500,
      failedExecutions: 0,
      totalReadbacks: 500,
      mismatchedReadbacks: 0,
      totalScheduledPublications: 100,
      delayedPublications: 0,
      totalCreditTransactions: 1000,
      unreconciledCreditsCount: 0,
    });
    expect(sloReport.overallHealth).toBe('HEALTHY');

    const qaHarness = new ProductionReverificationHarness();
    const qaReport = qaHarness.runFullReverification();
    expect(qaReport.totalChecks).toBe(30);
    expect(qaReport.isAllPassed).toBe(true);
    expect(qaReport.oauthEvidenceGateVerified).toBe(true);
    expect(qaReport.responsiveParityVerified).toBe(true);
  });
});
