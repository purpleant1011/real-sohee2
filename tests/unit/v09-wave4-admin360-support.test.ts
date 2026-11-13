import { describe, it, expect } from 'vitest';
import { Customer360Service } from '@/lib/admin-ops/customer-360-service';
import { SupportCaseLinkingService } from '@/lib/admin-ops/support-case-linking';

describe('V0.9 Wave 4: Admin 360 & Support Case Core Tests', () => {
  // ANI-874 & ANI-875: Customer 360 Timeline & Activation State
  it('ANI-874, ANI-875: Customer360Service tracks full commercial timeline and activation states', () => {
    const service = new Customer360Service();
    const wsId = 'ws_360_01';

    // 1. 초기 활성화 상태 확인
    expect(service.getActivationState(wsId)).toBe('BUSINESS_UNVERIFIED');

    // 2. 타임라인 이벤트 순차 기록
    service.recordTimelineEvent({
      workspaceId: wsId,
      stage: 'IDENTITY_CREATED',
      title: '회원가입 완료',
      detail: '소희 계정 및 워크스페이스 생성됨',
    });

    service.recordTimelineEvent({
      workspaceId: wsId,
      stage: 'BUSINESS_VERIFIED',
      title: '사업자등록증 인증 완료',
      detail: '홈택스 진위확인 100% 일치',
      referenceId: 'biz_cert_123',
    });

    // 3. 상태 전이: TRIAL_ACTIVE -> PAID_HEALTHY
    service.transitionActivationState(wsId, 'TRIAL_ACTIVE', '무료체험 시작');
    expect(service.getActivationState(wsId)).toBe('TRIAL_ACTIVE');

    service.transitionActivationState(wsId, 'PAID_HEALTHY', '정규 플랜(성장 플랜) 첫 결제 완료');
    expect(service.getActivationState(wsId)).toBe('PAID_HEALTHY');

    // 타임라인 확인
    const timeline = service.getTimeline(wsId);
    expect(timeline.length).toBe(4);
    expect(timeline[0].stage).toBe('IDENTITY_CREATED');
  });

  // ANI-876: Customer Canonical ID Chain
  it('ANI-876: Customer360Service validates the 9-part Canonical ID Chain integrity', () => {
    const service = new Customer360Service();
    const wsId = 'ws_chain_01';

    // 정상 ID 체인 등록
    const validChain = {
      userId: 'usr_001',
      businessId: 'biz_001',
      workspaceId: wsId,
      subscriptionId: 'sub_001',
      creditLedgerId: 'cleg_001',
      installedPluginIds: ['plg_meta', 'plg_naver'],
      channelAccountIds: ['ch_ig_01', 'ch_nv_01'],
      recentActionRunIds: ['act_001'],
      recentOutcomeIds: ['out_001'],
    };

    const regResult = service.registerIdChain(validChain);
    expect(regResult.isValid).toBe(true);
    expect(regResult.missingRequiredKeys.length).toBe(0);

    const retrieved = service.getIdChain(wsId);
    expect(retrieved?.userId).toBe('usr_001');

    // 필수 키(userId 등) 누락 체인 검증 실패
    const invalidResult = service.registerIdChain({
      userId: '',
      businessId: 'biz_002',
      workspaceId: 'ws_invalid',
      installedPluginIds: [],
      channelAccountIds: [],
      recentActionRunIds: [],
      recentOutcomeIds: [],
    });
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.missingRequiredKeys).toContain('userId');
  });

  // ANI-877: Support Case ↔ Operational Action Linking
  it('ANI-877: SupportCaseLinkingService binds CS tickets to operational entities and tracks resolutions', () => {
    const supportService = new SupportCaseLinkingService();
    const wsId = 'ws_support_01';

    // 1. 티켓 생성 및 ActionRun / 결제 건 바인딩
    const csTicket = supportService.createCaseWithLinks({
      workspaceId: wsId,
      userId: 'usr_complainant',
      subject: '인스타그램 포스팅 실패로 인한 크레딧 차감 문의',
      description: '포스팅이 되지 않았는데 크레딧이 차감되었습니다. 확인 부탁드립니다.',
      linkedEntities: {
        actionRunId: 'act_failed_publish_99',
        ledgerEntryId: 'cleg_settle_99',
      },
    });

    expect(csTicket.status).toBe('OPEN');
    expect(csTicket.linkedEntities.actionRunId).toBe('act_failed_publish_99');

    // 2. 관리자 조사 및 조치 적용 (크레딧 환불 완료)
    const resolved = supportService.resolveCase({
      caseId: csTicket.caseId,
      operatorId: 'admin_cs_manager',
      actionTaken: 'ADJUST_CREDITS',
      notes: 'SNS API 일시적 토큰 만료로 확인되어 100 크레딧 수기 환원 조치 완료',
    });

    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolution?.actionTaken).toBe('ADJUST_CREDITS');
    expect(resolved.resolution?.operatorId).toBe('admin_cs_manager');
  });
});
