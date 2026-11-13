import { describe, it, expect } from 'vitest';
import {
  FirstValueJourneyRuntime,
  RECOMMENDED_SAFE_MISSIONS,
} from '@/features/onboarding/first-value-journey-runtime';
import {
  FiveSecondDecisionManager,
  DecisionIntegrityError,
  computeDecisionFingerprint,
} from '@/features/approvals/five-second-decision-card';
import {
  CustomerWorkQueueManager,
  CustomerSummaryCard,
} from '@/features/crm/customer-work-queues';
import {
  ContentWorkPipelineManager,
  PipelineCardItem,
} from '@/features/content/content-work-pipeline';
import {
  MySoheeEducationManager,
} from '@/features/agent-studio/my-sohee-education-center';
import {
  OwnerNavigationRouter,
  OWNER_FIVE_AXIS_NAVIGATION,
} from '@/features/ux/owner-five-axis-navigation';
import {
  FigmaCanonContractValidator,
} from '@/features/ux/figma-commercial-canon-contract';
import {
  AdminOpsThreeClickManager,
  AdminExceptionItem,
} from '@/features/operator-admin/admin-ops-three-click';
import {
  CustomerDataRetentionManager,
} from '@/features/privacy/customer-data-retention-lineage';

describe('V0.91 Wave 6 · Commercial UX, Onboarding & Trust Tests', () => {
  // 1. Onboarding & First Value (ANI-1265)
  describe('ANI-1265: First 15-Minute Value Onboarding Runtime', () => {
    const runtime = new FirstValueJourneyRuntime();

    it('7단계 온보딩을 순차적으로 진행하고 15분 이내 가치 달성을 판정한다', () => {
      let session = runtime.initializeSession({
        sessionId: 'sess_1',
        workspaceId: 'ws_byreum',
        profile: { businessName: '바이름 뷰티샵', primaryService: '눈썹 디자인' },
        channelReadiness: { instagramConnected: true, threadsConnected: true },
      });

      expect(session.currentStage).toBe('BUSINESS_PROFILE_CONFIRM');

      // 1. 프로필 확인
      session = runtime.confirmBusinessProfile(session, { category: '프리미엄 뷰티' });
      expect(session.currentStage).toBe('CHANNEL_READINESS_CHECK');
      expect(session.businessProfile.category).toBe('프리미엄 뷰티');

      // 2. 채널 준비도 점검
      session = runtime.checkChannelReadiness(session, {
        instagramConnected: true,
        threadsConnected: true,
        reservationSourceAvailable: true,
        anyChannelReady: true,
      });
      expect(session.currentStage).toBe('SOHEE_UNDERSTANDING_ALIGN');

      // 3. 소희 이해 동기화
      session = runtime.alignSoheeUnderstanding(session);
      expect(session.currentStage).toBe('FIRST_SAFE_MISSION_SELECT');

      // 4. 첫 안전 미션 선택
      session = runtime.selectFirstSafeMission(session, RECOMMENDED_SAFE_MISSIONS[0].templateId);
      expect(session.currentStage).toBe('CONTENT_GENERATED_AND_REVIEW');
      expect(session.selectedMissionTemplate?.title).toContain('인스타그램 피드');

      // 5. 콘텐츠 5초 승인
      session = runtime.approveFirstContent(session, 'APPROVED');
      expect(session.currentStage).toBe('EXECUTE_OR_CONNECT_REQUIRED');

      // 6. 실행 및 결과 판정
      session = runtime.finalizeExecutionOrHandoff(session);
      expect(session.executionResultStatus).toBe('PUBLISHED_VERIFIED');
      expect(session.currentStage).toBe('RETURN_TO_COMMAND_CENTER');

      // 7. 완료
      session = runtime.completeOnboarding(session);
      expect(session.completedStages).toContain('RETURN_TO_COMMAND_CENTER');
      expect(session.firstValueAchievedWithin15Min).toBe(true);
    });

    it('채널이 미연결 상태인 경우 가짜 발행 대신 CONNECT_REQUIRED로 전환된다', () => {
      let session = runtime.initializeSession({
        sessionId: 'sess_2',
        workspaceId: 'ws_unconnected',
        profile: { businessName: '미연동 매장' },
        channelReadiness: { instagramConnected: false, threadsConnected: false },
      });

      session = runtime.confirmBusinessProfile(session);
      session = runtime.checkChannelReadiness(session, {
        instagramConnected: false,
        threadsConnected: false,
        reservationSourceAvailable: false,
        anyChannelReady: false,
      });
      session = runtime.alignSoheeUnderstanding(session);
      session = runtime.selectFirstSafeMission(session, 'safe_intro_feed');
      session = runtime.approveFirstContent(session, 'APPROVED');
      session = runtime.finalizeExecutionOrHandoff(session);

      expect(session.executionResultStatus).toBe('CONNECT_REQUIRED');
    });
  });

  // 2. Approval UX & Decision Safety (ANI-1261)
  describe('ANI-1261: 5-Second Decision Card & Anti-TOCTOU Gatekeeper', () => {
    const manager = new FiveSecondDecisionManager();

    it('무엇/어디/언제/비용/되돌림/왜 6대 질문 구조가 포함된 카드를 생성한다', () => {
      const card = manager.createDecisionCard({
        cardId: 'card_1',
        workspaceId: 'ws_test',
        missionId: 'ms_test',
        actionType: 'PUBLISH_CONTENT',
        caption: '신규 봄 시술 10% 예약 혜택 안내',
        channel: 'INSTAGRAM',
        accountHandle: '@byreum_official',
        timing: 'IMMEDIATE',
        creditUnits: 0,
        missionGoal: '봄맞이 신규 고객 유치',
        opportunityReason: '최근 3일간 인스타그램 콘텐츠 발행 공백 감지',
      });

      expect(card.what.fullCaption).toBe('신규 봄 시술 10% 예약 혜택 안내');
      expect(card.where.channel).toBe('INSTAGRAM');
      expect(card.when.displayTimingText).toBe('승인 확인 후 발행');
      expect(card.cost.isFree).toBe(true);
      expect(card.reversibility.canDeleteAfterPublish).toBe(true);
      expect(card.why.missionGoal).toBe('봄맞이 신규 고객 유치');
      expect(card.contentFingerprint).toBeDefined();
    });

    it('승인 대상 지문과 현재 콘텐츠 지문이 다르면 TOCTOU 변조 에러를 던진다', () => {
      const card = manager.createDecisionCard({
        cardId: 'card_2',
        workspaceId: 'ws_test',
        missionId: 'ms_test',
        actionType: 'PUBLISH_CONTENT',
        caption: '초기 원고 내용',
        channel: 'THREADS',
        accountHandle: '@byreum_threads',
        missionGoal: '테스트 목표',
        opportunityReason: '테스트 이유',
      });

      const mutatedFingerprint = computeDecisionFingerprint({
        actionType: 'PUBLISH_CONTENT',
        channel: 'THREADS',
        caption: '변조된 원고 내용 (악의적 또는 다른 세션 수정)',
        hashtags: [],
        mediaUrls: [],
      });

      expect(() =>
        manager.processDecision({
          card,
          action: 'APPROVE_AND_EXECUTE',
          actorId: 'owner_1',
          currentContentFingerprint: mutatedFingerprint,
          isAuthoritativeServerConfirmed: true,
        })
      ).toThrowError(DecisionIntegrityError);
    });

    it('서버 원장 영속화 없는 낙관적 UI 단독 승인은 차단된다', () => {
      const card = manager.createDecisionCard({
        cardId: 'card_3',
        workspaceId: 'ws_test',
        missionId: 'ms_test',
        actionType: 'PUBLISH_CONTENT',
        caption: '정상 원고 내용',
        channel: 'INSTAGRAM',
        accountHandle: '@byreum',
        missionGoal: '목표',
        opportunityReason: '이유',
      });

      expect(() =>
        manager.processDecision({
          card,
          action: 'APPROVE_AND_EXECUTE',
          actorId: 'owner_1',
          currentContentFingerprint: card.contentFingerprint,
          isAuthoritativeServerConfirmed: false,
        })
      ).toThrowError(DecisionIntegrityError);
    });
  });

  // 3. Customer Work Queues (ANI-1263)
  describe('ANI-1263: Customer 4 Work Queues & Customer 360 Detail', () => {
    const queueManager = new CustomerWorkQueueManager();

    it('인텐트와 상태에 따라 4개 업무 큐로 정확히 분류하고 대기시간 순으로 정렬한다', () => {
      const customers: CustomerSummaryCard[] = [
        {
          customerId: 'c1',
          workspaceId: 'ws_1',
          channel: 'INSTAGRAM',
          customerHandle: '@user_a',
          primaryIntent: 'COMPLAINT_OR_DISPUTE',
          intentConfidence: 0.9,
          lastMessageSnippet: '예약 시간보다 30분 늦게 시작했어요',
          lastInboundAt: '2026-09-10T10:00:00Z',
          waitTimeMinutes: 40,
          isUrgent: true,
          assignedQueue: 'HUMAN_REVIEW',
          soheeNextAction: '사장님 직접 상담 인계',
        },
        {
          customerId: 'c2',
          workspaceId: 'ws_1',
          channel: 'THREADS',
          customerHandle: '@user_b',
          primaryIntent: 'BOOKING_INTENT',
          intentConfidence: 0.95,
          lastMessageSnippet: '내일 오후 3시 예약 가능한가요?',
          lastInboundAt: '2026-09-10T10:10:00Z',
          waitTimeMinutes: 20,
          isUrgent: false,
          assignedQueue: 'HIGH_PROBABILITY_BOOKING',
          bookingStatus: 'SLOT_PROPOSED',
          soheeNextAction: '가능 슬롯 확정 대기',
        },
        {
          customerId: 'c3',
          workspaceId: 'ws_1',
          channel: 'NAVER_TALKTALK',
          customerHandle: '010-1234-5678',
          primaryIntent: 'PRICE_INQUIRY',
          intentConfidence: 0.92,
          lastMessageSnippet: '속눈썹 펌 가격이 얼마인가요?',
          lastInboundAt: '2026-09-10T10:20:00Z',
          waitTimeMinutes: 10,
          isUrgent: false,
          assignedQueue: 'NOW_REPLY',
          soheeNextAction: '가격표 안내 발송',
        },
        {
          customerId: 'c4',
          workspaceId: 'ws_1',
          channel: 'INSTAGRAM',
          customerHandle: '@user_d',
          primaryIntent: 'BOOKING_INTENT',
          intentConfidence: 0.99,
          lastMessageSnippet: '예약 확정 부탁드립니다',
          lastInboundAt: '2026-09-10T10:25:00Z',
          waitTimeMinutes: 5,
          isUrgent: false,
          assignedQueue: 'CONFIRMED_OR_CHANGED_BOOKING',
          bookingStatus: 'CONFIRMED',
          soheeNextAction: '방문 전 알림 대기',
        },
      ];

      const view = queueManager.classifyCustomerQueues({
        workspaceId: 'ws_1',
        customers,
        hasObservedIngress: true,
      });

      expect(view.humanReviewQueue).toHaveLength(1);
      expect(view.humanReviewQueue[0].customerId).toBe('c1');

      expect(view.highProbabilityBookingQueue).toHaveLength(1);
      expect(view.highProbabilityBookingQueue[0].customerId).toBe('c2');

      expect(view.nowReplyQueue).toHaveLength(1);
      expect(view.nowReplyQueue[0].customerId).toBe('c3');

      expect(view.confirmedOrChangedBookingQueue).toHaveLength(1);
      expect(view.confirmedOrChangedBookingQueue[0].customerId).toBe('c4');

      expect(view.observationStatus).toBe('OBSERVED');
    });

    it('인바운드 미관측 시 허위 0건 대신 NOT_OBSERVED를 반환한다', () => {
      const view = queueManager.classifyCustomerQueues({
        workspaceId: 'ws_empty',
        customers: [],
        hasObservedIngress: false,
      });

      expect(view.observationStatus).toBe('NOT_OBSERVED');
      expect(view.totalActionableCount).toBe(0);
    });

    it('전화번호 및 핸들 PII 마스킹을 정상 수행한다', () => {
      expect(queueManager.maskCustomerIdentity('01012345678')).toBe('010-****-5678');
      expect(queueManager.maskCustomerIdentity('@somedude')).toBe('@so***e');
    });
  });

  // 4. Content Work Pipeline (ANI-1262)
  describe('ANI-1262: Content Work Pipeline & Provider Evidence', () => {
    const pipelineManager = new ContentWorkPipelineManager();

    it('콘텐츠 항목들을 7단계 버킷으로 집계하고 스테일 항목을 감지한다', () => {
      const items: PipelineCardItem[] = [
        {
          contentId: 'cnt_1',
          workspaceId: 'ws_pipe',
          missionId: 'ms_1',
          missionGoal: '매장 인지도 확대',
          targetChannel: 'INSTAGRAM',
          caption: '피드 초안 작성 중',
          hashtags: ['#뷰티'],
          mediaUrls: [],
          versionNumber: 1,
          versionId: 'v1',
          contentFingerprint: 'fp1',
          stage: 'PRODUCING',
          isApproved: false,
          nextActionAdvice: '작성 중',
          updatedAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(), // 72시간 전 (stale)
        },
        {
          contentId: 'cnt_2',
          workspaceId: 'ws_pipe',
          missionId: 'ms_2',
          missionGoal: '예약 유치',
          targetChannel: 'THREADS',
          caption: '검토 요청 원고',
          hashtags: [],
          mediaUrls: [],
          versionNumber: 1,
          versionId: 'v1',
          contentFingerprint: 'fp2',
          stage: 'REVIEW_REQUIRED',
          isApproved: false,
          nextActionAdvice: '검토 필요',
          updatedAt: new Date().toISOString(),
        },
      ];

      const snapshot = pipelineManager.aggregatePipeline('ws_pipe', items);
      expect(snapshot.stages.PRODUCING).toHaveLength(1);
      expect(snapshot.stages.REVIEW_REQUIRED).toHaveLength(1);
      expect(snapshot.staleItemCount).toBe(1);
    });

    it('미승인 콘텐츠의 PUBLISHED 전진 및 증거 없는 게시 승격을 엄격 차단한다', () => {
      const unapprovedItem: PipelineCardItem = {
        contentId: 'cnt_3',
        workspaceId: 'ws_pipe',
        missionId: 'ms_3',
        missionGoal: '목표',
        targetChannel: 'INSTAGRAM',
        caption: '미승인 원고',
        hashtags: [],
        mediaUrls: [],
        versionNumber: 1,
        versionId: 'v1',
        contentFingerprint: 'fp3',
        stage: 'REVIEW_REQUIRED',
        isApproved: false,
        nextActionAdvice: '승인 대기',
        updatedAt: new Date().toISOString(),
      };

      expect(() =>
        pipelineManager.transitionStage(unapprovedItem, 'PUBLISHED', {
          providerPostId: 'ig_post_123',
        })
      ).toThrowError('승인되지 않은 콘텐츠는 PUBLISHED 단계로 전진할 수 없습니다.');

      const approvedItem: PipelineCardItem = {
        ...unapprovedItem,
        isApproved: true,
      };

      expect(() =>
        pipelineManager.transitionStage(approvedItem, 'PUBLISHED', {})
      ).toThrowError('외부 플랫폼 실발행 증거');

      const published = pipelineManager.transitionStage(approvedItem, 'PUBLISHED', {
        providerPostId: 'ig_post_999',
        providerPermalink: 'https://instagram.com/p/test999',
      });
      expect(published.stage).toBe('PUBLISHED');
      expect(published.providerPostId).toBe('ig_post_999');
    });
  });

  // 5. My Sohee Education Center (ANI-1264)
  describe('ANI-1264: My Sohee Employee Education & Delegation Center', () => {
    const manager = new MySoheeEducationManager();

    it('직원 프로필을 초기화하고 규칙을 추가할 때 버전이 증가한다', () => {
      const profile = manager.createDefaultProfile('ws_edu', '바이름 메이크업');
      expect(profile.storeName).toBe('바이름 메이크업');
      expect(profile.rules).toHaveLength(2);
      expect(profile.policyVersion).toBe(1);

      const updated = manager.updateOperatingRule(profile, {
        ruleId: 'rule_no_discount',
        ruleCategory: 'VOICE_TONE',
        title: '할인 과장 금지',
        content: '가격을 깎아준다는 표현보다 시술 가치를 강조합니다.',
        certainty: 'CONFIRMED_FACT',
        isActive: true,
      });

      expect(updated.rules).toHaveLength(3);
      expect(updated.policyVersion).toBe(2);
    });

    it('증거 없는 학습 지식 등록은 차단되며, 사장님이 확정하면 CONFIRMED_FACT로 승격된다', () => {
      const profile = manager.createDefaultProfile('ws_edu');

      expect(() =>
        manager.registerLearnedMemory(profile, {
          topic: '고객 반응 요일',
          content: '목요일 저녁 예약 반응이 가장 높음',
          sourceEvidenceRef: '', // 빈 증거
        })
      ).toThrowError('검증된 증거');

      const withLearning = manager.registerLearnedMemory(profile, {
        topic: '고객 반응 요일',
        content: '목요일 저녁 예약 반응이 가장 높음',
        sourceEvidenceRef: 'verified_attribution_123',
      });

      const memoryId = withLearning.learnedMemories[0].memoryId;
      expect(withLearning.learnedMemories[0].certainty).toBe('INFERRED_CANDIDATE');

      const confirmed = manager.confirmLearnedMemory(withLearning, memoryId);
      expect(confirmed.learnedMemories[0].certainty).toBe('CONFIRMED_FACT');
      expect(confirmed.learnedMemories[0].confirmedByOwner).toBe(true);
      expect(confirmed.knowledgeVersion).toBe(2);
    });
  });

  // 6. Owner 5-Axis Navigation (ANI-1266)
  describe('ANI-1266: Owner 5-Axis Navigation & Legacy Redirects', () => {
    const router = new OwnerNavigationRouter();

    it('5축 네비게이션 표준을 준수하고 활성 축을 식별한다', () => {
      expect(OWNER_FIVE_AXIS_NAVIGATION).toHaveLength(5);
      expect(router.resolveActiveAxis('/app')).toBe('today');
      expect(router.resolveActiveAxis('/app/content')).toBe('content');
      expect(router.resolveActiveAxis('/app/customers')).toBe('customers');
      expect(router.resolveActiveAxis('/app/results')).toBe('results');
      expect(router.resolveActiveAxis('/app/sohee')).toBe('my-sohee');
    });

    it('레거시 딥링크를 표준 경로로 안전하게 리다이렉트한다', () => {
      expect(router.resolveLegacyRedirect('/app/work').targetPath).toBe('/app/content');
      expect(router.resolveLegacyRedirect('/app/channels').targetPath).toBe('/app/sohee?tab=channels');
      expect(router.resolveLegacyRedirect('/app/reports').targetPath).toBe('/app/results');
      expect(router.resolveLegacyRedirect('/app/settings/business').targetPath).toBe('/app/sohee?tab=knowledge');
      expect(router.resolveLegacyRedirect('/app/inbox').targetPath).toBe('/app/customers');
      expect(router.resolveLegacyRedirect('/app/content-hub').targetPath).toBe('/app/content');
    });
  });

  // 7. Figma Canon Contract (ANI-1267)
  describe('ANI-1267: Figma Canon Commercial Employee UX Contract', () => {
    const validator = new FigmaCanonContractValidator();

    it('10대 프레임 규격의 필수 요소가 모두 충족되면 컴플라이언스를 통과한다', () => {
      const result = validator.validateFrameCompliance('FRAME_01_TODAY_30SEC', [
        'core_daily_goal',
        'sohee_current_work',
        'decisions_to_make',
        'customer_booking_changes',
        'recent_verified_outcomes',
        'next_action_proposals',
      ]);

      expect(result.isCompliant).toBe(true);
      expect(result.missingElements).toHaveLength(0);
      expect(result.forbiddenDetected).toHaveLength(0);
    });

    it('금지된 기술어/요소가 노출되면 컴플라이언스 실패로 감지한다', () => {
      const result = validator.validateFrameCompliance('FRAME_01_TODAY_30SEC', [
        'core_daily_goal',
        'sohee_current_work',
        'decisions_to_make',
        'customer_booking_changes',
        'recent_verified_outcomes',
        'next_action_proposals',
        'trace_id', // 금지 요소
      ]);

      expect(result.isCompliant).toBe(false);
      expect(result.forbiddenDetected).toContain('trace_id');
    });
  });

  // 8. Admin Ops 3-Click (ANI-1268)
  describe('ANI-1268: Admin Ops 3-Click Operations', () => {
    const adminOps = new AdminOpsThreeClickManager();

    it('Click 1: 예외 큐를 심각도 순으로 필터 및 정렬한다', () => {
      const exceptions: AdminExceptionItem[] = [
        {
          exceptionId: 'ex_low',
          workspaceId: 'ws_a',
          workspaceName: 'A샵',
          category: 'RESULT_UNKNOWN',
          severity: 'LOW',
          title: '게시 확인 지연',
          summary: '재조회 대기',
          occurredAt: '2026-09-10T10:00:00Z',
          ageMinutes: 10,
        },
        {
          exceptionId: 'ex_high',
          workspaceId: 'ws_b',
          workspaceName: 'B샵',
          category: 'POLICY_HANDOFF',
          severity: 'HIGH',
          title: '민감 분쟁 인계',
          summary: '고객 불만 응대 필요',
          occurredAt: '2026-09-10T10:05:00Z',
          ageMinutes: 5,
        },
      ];

      const sorted = adminOps.filterExceptionQueue(exceptions);
      expect(sorted[0].exceptionId).toBe('ex_high'); // HIGH 우선
    });

    it('Click 2 & 3: Customer 360 Trace를 조회하고 원클릭 복구 조치를 실행한다', () => {
      const exItem: AdminExceptionItem = {
        exceptionId: 'ex_1',
        workspaceId: 'ws_test',
        workspaceName: '테스트 테넌트',
        category: 'STALLED_MISSION',
        severity: 'HIGH',
        title: '발행 작업 정체',
        summary: 'Worker 응답 없음',
        occurredAt: new Date().toISOString(),
        ageMinutes: 15,
      };

      const c360 = adminOps.resolveCustomer360Trace(exItem, [
        {
          stepId: 'st_1',
          actor: 'USER',
          actionName: '지시',
          status: 'SUCCESS',
          timestamp: '10:00',
          payloadSummary: '피드 작성 요청',
        },
        {
          stepId: 'st_2',
          actor: 'AGENT',
          actionName: '초안 생성',
          status: 'SUCCESS',
          timestamp: '10:01',
          payloadSummary: '피드 원고 완성',
        },
      ]);
      expect(c360.tenantName).toBe('테스트 테넌트');
      expect(c360.recentTraceSteps).toHaveLength(2);

      const remediation = adminOps.executeRemediation({
        exceptionId: 'ex_1',
        actionType: 'TRIGGER_SAFE_RETRY',
        operatorId: 'operator_admin_1',
      });
      expect(remediation.resultStatus).toBe('SUCCESS');
      expect(remediation.resolutionMessage).toContain('안전 멱등 재시도');
    });
  });

  // 9. Privacy & Customer Data Retention Lineage (ANI-1275)
  describe('ANI-1275: Privacy & Customer Data Retention Lineage', () => {
    const privacyManager = new CustomerDataRetentionManager();

    it('데이터 보존 만료를 정확히 판정한다', () => {
      const past35Days = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      const past10Days = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

      // INBOUND_WEBHOOK_RAW는 30일 보존
      expect(privacyManager.isRetentionExpired('INBOUND_WEBHOOK_RAW', past35Days)).toBe(true);
      expect(privacyManager.isRetentionExpired('INBOUND_WEBHOOK_RAW', past10Days)).toBe(false);
    });

    it('삭제 요청 시 연쇄 비식별화 및 전자상거래법 법정 보존을 준수한다', () => {
      const cascadeNoBooking = privacyManager.cascadeCustomerDataDeletion({
        requestId: 'req_del_1',
        workspaceId: 'ws_del',
        customerId: 'cust_normal',
        hasActivePaidReservation: false,
      });
      expect(cascadeNoBooking.status).toBe('COMPLETED');
      expect(cascadeNoBooking.affectedRecords.conversationsAnonymized).toBe(5);

      const cascadeWithBooking = privacyManager.cascadeCustomerDataDeletion({
        requestId: 'req_del_2',
        workspaceId: 'ws_del',
        customerId: 'cust_paid',
        hasActivePaidReservation: true,
      });
      expect(cascadeWithBooking.status).toBe('PARTIAL_LEGAL_HOLD');
      expect(cascadeWithBooking.affectedRecords.reservationPiiRedacted).toBe(1);
      expect(cascadeWithBooking.auditNotice).toContain('전자상거래법');
    });

    it('PII 마스킹 유틸리티가 전화번호와 핸들을 정상 마스킹한다', () => {
      const rawText = '예약자 홍길동 010-9876-5432, 계정 @beauty_queen 문의입니다.';
      const masked = privacyManager.maskPII(rawText);
      expect(masked).toBe('예약자 홍길동 010-****-5432, 계정 @be*** 문의입니다.');
    });
  });
});
