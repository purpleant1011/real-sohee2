import { describe, it, expect } from 'vitest';
import {
  isLeapYear,
  getDaysInMonth,
  getValidCalendarGridDays,
  CalendarEventManager,
} from '@/features/content-runtime/calendar-date-engine';
import { CanonicalPublishingScheduleManager } from '@/features/content-runtime/canonical-publishing-schedule';
import { ContentCtaPreconditionGate } from '@/features/content-runtime/content-precondition-gate';
import { ChannelNativeContentValidator } from '@/features/content-runtime/channel-native-validator';
import { HarnessProvenanceService } from '@/features/content-runtime/harness-provenance';
import { ContentGenerationActionRunTracker } from '@/features/content-runtime/generation-action-run';
import { PublishingExceptionQueue } from '@/features/content-runtime/publishing-exception-queue';

describe('V0.9 Wave 3: Content Runtime & Publishing Calendar Core Tests', () => {
  // ANI-827: Calendar Date Integrity (32~34일 비정상 날짜 원천 차단 및 윤년 무결성)
  it('ANI-827: getDaysInMonth and getValidCalendarGridDays enforce exact leap years and prevent nonexistent dates', () => {
    // 1. 윤년 판별 검증
    expect(isLeapYear(2024)).toBe(true); // 4의 배수
    expect(isLeapYear(2026)).toBe(false); // 평년
    expect(isLeapYear(2000)).toBe(true); // 400의 배수
    expect(isLeapYear(2100)).toBe(false); // 100의 배수이나 400의 배수 아님

    // 2. 월별 일수 검증
    expect(getDaysInMonth(2026, 2)).toBe(28); // 2026년 2월은 28일
    expect(getDaysInMonth(2024, 2)).toBe(29); // 2024년 2월은 29일
    expect(getDaysInMonth(2026, 4)).toBe(30); // 4월은 30일
    expect(getDaysInMonth(2026, 12)).toBe(31); // 12월은 31일

    // 3. 달력 그리드 생성 검증 (어떤 경우에도 day > 31이 존재할 수 없음)
    const gridDays = getValidCalendarGridDays(2026, 9); // 2026년 9월
    expect(gridDays.length % 7).toBe(0); // 7열 격자

    // 32일, 33일, 34일 등 가상 날짜가 절대 없음을 전수 검증
    for (const d of gridDays) {
      expect(d.day).toBeGreaterThan(0);
      expect(d.day).toBeLessThanOrEqual(31);
      const maxInMonth = getDaysInMonth(d.year, d.month);
      expect(d.day).toBeLessThanOrEqual(maxInMonth);
    }
  });

  // ANI-837: Calendar Unified Event Model (월/주/일 뷰 간 동일 event_id 유지)
  it('ANI-837: CalendarEventManager maintains identical event_id across views and reschedules accurately', () => {
    const manager = new CalendarEventManager();
    const eventId = 'cal_evt_1001';

    manager.addOrUpdateEvent({
      calendarEventId: eventId,
      jobId: 'job_1001',
      workspaceId: 'ws_content_1',
      assetId: 'asset_1',
      channel: 'INSTAGRAM_FEED',
      title: '가을 신메뉴 오픈 안내',
      scheduledAt: '2026-09-15T14:00:00Z',
      status: 'SCHEDULED',
      retryCount: 0,
      maxRetries: 3,
      updatedAt: new Date().toISOString(),
    });

    // 월간 조회
    const monthEvents = manager.getEventsByMonth('ws_content_1', 2026, 9);
    expect(monthEvents.length).toBe(1);
    expect(monthEvents[0].calendarEventId).toBe(eventId);

    // 일정 변경 (드래그 앤 드롭)
    const updated = manager.rescheduleEvent(eventId, '2026-09-16T10:00:00Z');
    expect(updated.calendarEventId).toBe(eventId);
    expect(updated.scheduledAt).toBe('2026-09-16T10:00:00Z');
  });

  // ANI-828 & ANI-872: Publishing Queue ↔ Calendar 정본 스케줄 모델 및 Same Truth
  it('ANI-828, ANI-872: CanonicalPublishingScheduleManager guarantees 1:1 bi-directional mapping and Same Truth with Admin', () => {
    const manager = new CanonicalPublishingScheduleManager();
    const eventId = 'cal_sync_1';
    const jobId = 'job_sync_1';

    // 1. 등록
    manager.registerSchedule({
      calendarEventId: eventId,
      jobId,
      workspaceId: 'ws_sync_1',
      assetId: 'asset_sync_1',
      channel: 'INSTAGRAM_FEED',
      title: '정본 동기화 테스트 포스트',
      scheduledAt: '2026-09-20T11:00:00Z',
    });

    // 2. 큐 작업 상태 업데이트 (워커에서 디스패치 성공)
    manager.updateStatus({
      jobId,
      status: 'PUBLISHED',
      publishedUrl: 'https://instagram.com/p/test12345',
      externalPostId: 'ext_post_999',
    });

    // 3. 사용자 캘린더에서 동일 eventId로 조회 시 즉시 Same Truth 확인
    const calendarViewSchedule = manager.getByCalendarEventId(eventId);
    expect(calendarViewSchedule).toBeDefined();
    expect(calendarViewSchedule?.status).toBe('PUBLISHED');
    expect(calendarViewSchedule?.publishedUrl).toBe('https://instagram.com/p/test12345');
    expect(calendarViewSchedule?.jobId).toBe(jobId);
  });

  // ANI-830: Content CTA Preconditions (하네스, 채널, 크레딧 3대 조건 게이트)
  it('ANI-830: ContentCtaPreconditionGate checks harness, channel, and credits before allowing generation', () => {
    const gate = new ContentCtaPreconditionGate();

    // 1. 하네스 미준비 상태
    const resNoHarness = gate.evaluate({
      workspaceId: 'ws_gate_1',
      isHarnessReady: false,
      connectedChannels: ['INSTAGRAM_FEED'],
      availableCredits: 500,
      requiredCredits: 100,
    });
    expect(resNoHarness.canProceed).toBe(false);
    expect(resNoHarness.primaryCta.label).toBe('브랜드 하네스 설정하기');

    // 2. 채널 미연결 상태
    const resNoChannel = gate.evaluate({
      workspaceId: 'ws_gate_1',
      isHarnessReady: true,
      connectedChannels: [],
      availableCredits: 500,
      requiredCredits: 100,
    });
    expect(resNoChannel.canProceed).toBe(false);
    expect(resNoChannel.primaryCta.label).toBe('SNS 채널 연동하기');

    // 3. 크레딧 부족 상태
    const resNoCredit = gate.evaluate({
      workspaceId: 'ws_gate_1',
      isHarnessReady: true,
      connectedChannels: ['INSTAGRAM_FEED'],
      availableCredits: 50,
      requiredCredits: 100,
    });
    expect(resNoCredit.canProceed).toBe(false);
    expect(resNoCredit.primaryCta.label).toBe('소희 크레딧 충전하기');

    // 4. 3대 조건 모두 만족 시
    const resAllPassed = gate.evaluate({
      workspaceId: 'ws_gate_1',
      isHarnessReady: true,
      connectedChannels: ['INSTAGRAM_FEED'],
      availableCredits: 300,
      requiredCredits: 100,
    });
    expect(resAllPassed.canProceed).toBe(true);
    expect(resAllPassed.primaryCta.label).toBe('콘텐츠 생성 시작하기');
  });

  // ANI-834: Channel-native Content Preview & Constraint
  it('ANI-834: ChannelNativeContentValidator strictly enforces native rules per channel', () => {
    const validator = new ChannelNativeContentValidator();

    // 네이버 블로그: 제목 필수 및 최소 본문 길이
    const naverWithoutTitle = validator.validate('NAVER_BLOG', {
      body: '짧은 본문',
      mediaUrls: ['https://cdn.sohee.ai/img1.jpg'],
    });
    expect(naverWithoutTitle.isValid).toBe(false);
    expect(naverWithoutTitle.errors.some((e) => e.includes('제목은 필수'))).toBe(true);

    // 당근마켓: 외부 링크 금지 정책
    const carrotWithLink = validator.validate('CARROT_FEED', {
      body: '우리 가게 이벤트 상세는 https://my-store.com/event 를 확인하세요!',
      mediaUrls: ['https://cdn.sohee.ai/img1.jpg'],
    });
    expect(carrotWithLink.isValid).toBe(false);
    expect(carrotWithLink.errors.some((e) => e.includes('외부 웹 링크를 포함할 수 없습니다'))).toBe(true);

    // 인스타그램 피드: 정상 규격 통과 및 해시태그 포맷팅 프리뷰
    const instaValid = validator.validate('INSTAGRAM_FEED', {
      body: '신선한 재료로 준비한 오늘의 파스타입니다.',
      mediaUrls: ['https://cdn.sohee.ai/img1.jpg'],
      aspectRatio: '1:1',
      hashtags: ['파스타맛집', '을지로맛집'],
    });
    expect(instaValid.isValid).toBe(true);
    expect(instaValid.preview.formattedBody).toContain('#파스타맛집 #을지로맛집');
  });

  // ANI-831: Harness Source Provenance & Rights (룩북 출처 증거화)
  it('ANI-831: HarnessProvenanceService issues SHA-256 license digest and provenance records', () => {
    const provService = new HarnessProvenanceService();

    const prov = provService.createProvenance({
      sourceType: 'SCRAPED_LOOKBOOK',
      sourceAccount: '@hair_artist_gangnam',
      sourceUrl: 'https://instagram.com/p/hair_123',
      rightsScope: 'COMMERCIAL_USE_ALLOWED',
    });

    expect(prov.sourceId).toBeDefined();
    expect(prov.licenseDigest).toBeDefined();
    expect(prov.isRightsCleared).toBe(true);

    // SHA-256 다이제스트 무결성 재검증 통과
    const isVerified = provService.verifyDigest(prov);
    expect(isVerified).toBe(true);
  });

  // ANI-832 & ANI-885: Content Generation ActionRun 계보 및 Admin 드릴다운
  it('ANI-832, ANI-885: ContentGenerationActionRunTracker tracks generation lineage and allows end-to-end provenance drilldown', () => {
    const tracker = new ContentGenerationActionRunTracker();
    const provService = new HarnessProvenanceService();

    const prov = provService.createProvenance({
      sourceType: 'BRAND_ASSET_VAULT',
      rightsScope: 'OWNER_COPYRIGHT',
    });

    const assetId = 'asset_drill_1';
    const actionRunId = 'act_gen_drill_1';

    // 생성 기록
    const { drilldown } = tracker.recordGeneration({
      assetId,
      actionRunId,
      channel: 'INSTAGRAM_FEED',
      prompt: '가을 시그니처 베이지 염색 화보 스타일 소개문',
      modelIdentifier: 'gemini-3.8-flash-high',
      harnessVersion: 'v2.4.0',
      title: '가을 베이지 염색',
      body: '은은한 톤의 가을 맞이 헤어 스타일을 만나보세요.',
      mediaUrls: ['https://cdn.sohee.ai/hair_fall.jpg'],
      aspectRatio: '4:5',
      hashtags: ['가을헤어', '베이지염색'],
      provenance: prov,
      qcScore: 95,
      qcChecklist: {
        bannedWordsPassed: true,
        channelConstraintsPassed: true,
        voiceConsistencyPassed: true,
      },
      requiresUserApproval: true,
    });

    expect(drilldown.qcResult.passed).toBe(true);

    // 관리자 승인 및 발행 연결
    tracker.approveAsset(assetId, 'owner_kim');
    tracker.linkPublication(assetId, {
      jobId: 'job_pub_1',
      calendarEventId: 'cal_pub_1',
      status: 'PUBLISHED',
      publishedUrl: 'https://instagram.com/p/pub_fall_hair',
    });

    // Admin 계보 드릴다운 검증 (ANI-885)
    const adminDrilldown = tracker.drilldownAssetProvenance(assetId);
    expect(adminDrilldown).toBeDefined();
    expect(adminDrilldown?.prompt).toBe('가을 시그니처 베이지 염색 화보 스타일 소개문');
    expect(adminDrilldown?.approvalChain.approvedBy).toBe('owner_kim');
    expect(adminDrilldown?.publication.publishedUrl).toBe('https://instagram.com/p/pub_fall_hair');
  });

  // ANI-873: [Admin] Publishing Exception Queue (격리 및 조치)
  it('ANI-873: PublishingExceptionQueue quarantines failed jobs and handles admin resolution', () => {
    const queue = new PublishingExceptionQueue();

    const job = {
      calendarEventId: 'cal_fail_1',
      jobId: 'job_fail_1',
      workspaceId: 'ws_except_1',
      assetId: 'asset_fail_1',
      channel: 'INSTAGRAM_FEED' as const,
      title: '발행 실패 테스트',
      scheduledAt: '2026-09-06T10:00:00Z',
      status: 'FAILED' as const,
      retryCount: 3,
      maxRetries: 3,
      updatedAt: new Date().toISOString(),
    };

    // 격리 등록
    const quarantined = queue.quarantine({
      job,
      errorCategory: 'TOKEN_EXPIRED',
      errorMessage: 'Instagram Graph API access token expired. Refresh required.',
    });

    expect(quarantined.resolutionStatus).toBe('UNRESOLVED');
    expect(queue.listUnresolved('ws_except_1').length).toBe(1);

    // 관리자 환불 조치
    const refunded = queue.resolveRefund(quarantined.exceptionId, 'admin_super');
    expect(refunded.resolutionStatus).toBe('REFUNDED');
    expect(refunded.resolvedBy).toBe('admin_super');
    expect(queue.listUnresolved('ws_except_1').length).toBe(0);
  });
});
