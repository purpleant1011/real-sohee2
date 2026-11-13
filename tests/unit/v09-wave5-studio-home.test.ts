import { describe, it, expect } from 'vitest';
import { KnowledgeStudioService } from '@/features/knowledge-studio/knowledge-studio-service';
import { MySoheeCentersService } from '@/features/agent-studio/my-sohee-centers';
import { CampaignActionGraphEngine } from '@/features/agent-studio/campaign-action-graph';
import { ChiefOfStaffHomeService } from '@/features/home/chief-of-staff-home-service';
import { FirstValueOnboardingEngine } from '@/features/onboarding/first-value-onboarding';

describe('V0.9 Wave 5: Knowledge Studio, My Sohee, Home & Onboarding Tests', () => {
  // ANI-888: Harness Knowledge Studio (비법 교육)
  it('ANI-888: KnowledgeStudioService registers and compiles secret store knowledge into prompt context', () => {
    const studio = new KnowledgeStudioService();
    const wsId = 'ws_know_01';

    studio.teachKnowledge({
      workspaceId: wsId,
      category: 'TECHNIQUE_RECIPE',
      title: '시그니처 복구 클리닉 3단계 비법',
      content: '단백질 침투 후 저온 원적외선 열처리로 유지기간 2배 증가',
      priority: 10,
    });

    studio.teachKnowledge({
      workspaceId: wsId,
      category: 'STORE_STRENGTH',
      title: '프라이빗 1인 VIP 룸 보유',
      content: '전 좌석 독립 룸 형태로 조용하고 쾌적한 힐링 공간 제공',
      priority: 8,
    });

    const context = studio.compileKnowledgeContext(wsId);
    expect(context).toContain('시그니처 복구 클리닉 3단계 비법');
    expect(context).toContain('프라이빗 1인 VIP 룸 보유');
  });

  // ANI-889, ANI-890, ANI-891: My Sohee Centers
  it('ANI-889, ANI-890, ANI-891: MySoheeCentersService evaluates capabilities, creates briefings and tracks automation routines', () => {
    const centers = new MySoheeCentersService();
    const wsId = 'ws_centers_01';

    // 1. 역량 평가 (Capability Center)
    const cap = centers.evaluateCapabilities({
      readyPluginsCount: 3,
      connectedChannelsCount: 2,
      taughtKnowledgeCount: 4,
    });
    expect(cap.overallLevel).toBeGreaterThanOrEqual(3);
    expect(cap.scores.counseling).toBeGreaterThanOrEqual(80);

    // 2. 일일 브리핑 (Command Center)
    const briefing = centers.createDailyBriefing({
      workspaceId: wsId,
      summary: '오늘 예약 5건 예정이며, 인스타그램 가을 화보 피드 발행 루틴이 대기 중입니다.',
      operatingRules: ['금지어: 100% 보장', '응대 톤: 친절하고 전문적인 디렉터'],
      priorityTasks: ['점심 타임 공실 타겟 알림톡 발송'],
    });
    expect(briefing.operatingRules.length).toBe(2);

    // 3. 자율 루틴 및 성과 기여도 (Automation & Learning Center)
    const routine = centers.registerRoutine({
      workspaceId: wsId,
      name: '매일 오전 10시 예약 공실 알림 자동 게시',
      cronExpression: '0 10 * * *',
      actionType: 'INSTAGRAM_STORY_VACANCY_ALERT',
    });
    centers.recordRoutineOutcome(routine.routineId, 150000);
    expect(centers.listRoutines(wsId)[0].weeklyOutcomeAttributionKrw).toBe(150000);
  });

  // ANI-860: Campaign ActionGraph (9단계 엔드투엔드 사이클)
  it('ANI-860: CampaignActionGraphEngine executes the 9-stage closed-loop campaign graph', () => {
    const engine = new CampaignActionGraphEngine();
    const wsId = 'ws_cmp_01';

    const campaign = engine.createCampaign(wsId, '2026 가을 그랜드 오픈 캠페인');
    expect(campaign.currentStage).toBe('RESEARCH');

    // 단계별 전진
    engine.completeStage(campaign.campaignId, 'RESEARCH', '상권 및 경쟁 미용실 트렌드 분석 완료');
    expect(campaign.currentStage).toBe('STRATEGY');

    engine.completeStage(campaign.campaignId, 'STRATEGY', '프리미엄 복구 클리닉 타겟팅 전략 수립');
    engine.completeStage(campaign.campaignId, 'PLAN', '주간 3회 SNS 게시 및 할인 쿠폰 연계 계획 확정');
    engine.completeStage(campaign.campaignId, 'CREATIVE', '화보 이미지 3장 및 카피 생성 완료');
    engine.completeStage(campaign.campaignId, 'APPROVAL', '원장님 컨펌 완료');
    engine.completeStage(campaign.campaignId, 'EXECUTE', '인스타그램 실게시 완료');
    engine.completeStage(campaign.campaignId, 'VERIFY', '실시간 게시 URL 및 해시 검증 통과');
    engine.completeStage(campaign.campaignId, 'ATTRIBUTE', '예약 8건 및 매출 ₩640,000 귀속 확인');
    const finalCamp = engine.completeStage(campaign.campaignId, 'LEARN', '화요일 14시 게시가 전환율 최고치 기록 학습 완료');

    expect(finalCamp.isFullyCompleted).toBe(true);
    expect(finalCamp.nodes.ATTRIBUTE.outputSummary).toContain('₩640,000');
  });

  // ANI-858, ANI-859: Chief-of-Staff Home & Lifecycle Empty States
  it('ANI-858, ANI-859: ChiefOfStaffHomeService coordinates 7-widget dashboard and resolves single next action empty states', () => {
    const homeService = new ChiefOfStaffHomeService();
    const wsId = 'ws_home_01';

    // 1. 대시보드 상태 빌드
    const homeState = homeService.buildHomeState({
      workspaceId: wsId,
      weeklyOutcomeRevenueKrw: 1200000,
      availableCredits: 2500,
      systemHealthScore: 99,
    });
    expect(homeState.weeklyOutcomeRevenueKrw).toBe(1200000);

    // 2. 비법 미등록 시 빈 화면 안내
    const emptyNoKnowledge = homeService.resolveEmptyState({
      domain: 'CONTENT',
      hasConnectedChannels: true,
      hasTaughtKnowledge: false,
      hasCredits: true,
    });
    expect(emptyNoKnowledge.primaryCtaLabel).toBe('비법 교육하러 가기');

    // 3. 크레딧 소진 시 빈 화면 안내
    const emptyNoCredit = homeService.resolveEmptyState({
      domain: 'CONTENT',
      hasConnectedChannels: true,
      hasTaughtKnowledge: true,
      hasCredits: false,
    });
    expect(emptyNoCredit.primaryCtaLabel).toBe('소희 크레딧 충전하기');
  });

  // ANI-865: First Value Onboarding 5단계 완료
  it('ANI-865: FirstValueOnboardingEngine advances through 5 steps to achieve first verified action', () => {
    const onboarding = new FirstValueOnboardingEngine();
    const wsId = 'ws_onboard_01';

    const journey = onboarding.startJourney(wsId);
    expect(journey.currentStep).toBe('BIZ_PROFILE_INPUT');
    expect(journey.isFirstValueAchieved).toBe(false);

    onboarding.advanceStep(wsId, 'BIZ_PROFILE_INPUT');
    onboarding.advanceStep(wsId, 'HARNESS_VOICE_ANALYSIS');
    onboarding.advanceStep(wsId, 'SINGLE_CHANNEL_CONNECT');
    onboarding.advanceStep(wsId, 'FIRST_DRAFT_GENERATE');
    const finished = onboarding.advanceStep(wsId, 'FIRST_VERIFIED_ACTION', 'act_first_wow_123');

    expect(finished.isFirstValueAchieved).toBe(true);
    expect(finished.firstVerifiedActionId).toBe('act_first_wow_123');
  });
});
