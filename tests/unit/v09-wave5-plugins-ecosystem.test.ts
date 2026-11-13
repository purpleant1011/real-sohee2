import { describe, it, expect } from 'vitest';
import { PluginRegistryService } from '@/features/plugin-ecosystem/plugin-registry-service';

describe('V0.9 Wave 5: Plugin Ecosystem Core Tests', () => {
  // ANI-805 & ANI-862: Plugin Marketplace 3축 상태 모델 및 사전 설치 계약
  it('ANI-805, ANI-862: PluginRegistryService maintains triaxial states and pre-install contracts', () => {
    const service = new PluginRegistryService();
    const insta = service.getPlugin('plg_meta_instagram');

    expect(insta).toBeDefined();
    expect(insta?.triaxialState.trustTier).toBe('VERIFIED_CORE');
    expect(insta?.triaxialState.lifecycleState).toBe('INSTALLED_HEALTHY');
    expect(insta?.triaxialState.verificationStatus).toBe('OFFICIAL_SANDBOX_VERIFIED');

    // Pre-install Contract 확인
    expect(insta?.contract.outcomeTarget).toContain('인스타그램 도달 3배');
    expect(insta?.contract.requiredPermissions).toContain('instagram_content_publish');
    expect(insta?.contract.creditCostPerAction).toBe(100);
  });

  // ANI-806: Plugin Install Wizard 5단계 계약 검증
  it('ANI-806: advances through 5 wizard steps and completes installation cleanly', () => {
    const service = new PluginRegistryService();
    const wsId = 'ws_plg_test';

    const session = service.startInstallWizard(wsId, 'plg_daangn_local');
    expect(session.currentStep).toBe('CHECK_ENTITLEMENT');
    expect(session.isCompleted).toBe(false);

    // 단계별 전진
    service.advanceWizardStep(session.sessionId); // CONFIRM_PERMISSIONS
    service.advanceWizardStep(session.sessionId); // CONNECT_OAUTH
    service.advanceWizardStep(session.sessionId); // HEALTH_CHECK_PING
    service.advanceWizardStep(session.sessionId); // TEST_READ_WRITE
    const finished = service.advanceWizardStep(session.sessionId); // READY_CONFIRMED

    expect(finished.isCompleted).toBe(true);
    expect(finished.currentStep).toBe('READY_CONFIRMED');

    // 플러그인 상태가 READY 및 INSTALLED_HEALTHY로 전이되었는지 확인
    const daangn = service.getPlugin('plg_daangn_local');
    expect(daangn?.isReady).toBe(true);
    expect(daangn?.triaxialState.lifecycleState).toBe('INSTALLED_HEALTHY');
  });

  // ANI-810: @Plugin Invocation 태그 파싱
  it('ANI-810: parses @Plugin invocation tags in user prompts', () => {
    const service = new PluginRegistryService();
    const prompt = '오늘 점심 특선 메뉴를 @instagram 피드와 @naver 블로그에 동시 게시해줘';

    const matches = service.parsePluginMentions(prompt);
    expect(matches.length).toBe(2);
    expect(matches.some((m) => m.pluginId === 'plg_meta_instagram')).toBe(true);
    expect(matches.some((m) => m.pluginId === 'plg_naver_place_blog')).toBe(true);
  });

  // ANI-812: Missing Plugin UX 폐쇄 루프
  it('ANI-812: suspends prompt on missing plugin and resumes after install', () => {
    const service = new PluginRegistryService();
    const wsId = 'ws_missing_test';
    const prompt = '@daangn 피드에 이번 주 할인 쿠폰을 발행해줘';

    // 1. 미설치 감지 및 대화 보류
    const check = service.handleMissingPlugin({
      workspaceId: wsId,
      prompt,
      requiredPluginId: 'plg_daangn_local',
    });

    expect(check.needsInstall).toBe(true);
    expect(check.context?.originalPrompt).toBe(prompt);

    // 2. 위저드로 설치 진행
    const session = service.startInstallWizard(wsId, 'plg_daangn_local');
    service.advanceWizardStep(session.sessionId);
    service.advanceWizardStep(session.sessionId);
    service.advanceWizardStep(session.sessionId);
    service.advanceWizardStep(session.sessionId);
    service.advanceWizardStep(session.sessionId);

    // 3. 설치 완료 후 보류되었던 프롬프트 복귀
    const resumed = service.resumeSuspendedPrompt(wsId, 'plg_daangn_local');
    expect(resumed).toBeDefined();
    expect(resumed?.originalPrompt).toBe(prompt);
  });

  // ANI-863 & ANI-864: READY Count Same Truth 및 Needs Attention Inbox
  it('ANI-863, ANI-864: enforces READY count same truth and handles attention inbox', () => {
    const service = new PluginRegistryService();
    const wsId = 'ws_ready_count_test';

    // 초기 상태 READY 개수 확인 (기본 3개)
    const initialReadyCount = service.getReadyPluginCount(wsId);
    expect(initialReadyCount).toBe(3);

    // 네이버 플러그인 토큰 만료 플래그
    service.flagAttention('plg_naver_place_blog', 'TOKEN_EXPIRED');

    // READY 카운트 즉각 차감 (3 -> 2)
    expect(service.getReadyPluginCount(wsId)).toBe(2);

    // Needs Attention 인박스에 노출 확인
    const attentionList = service.listNeedsAttention(wsId);
    expect(attentionList.length).toBe(1);
    expect(attentionList[0].pluginId).toBe('plg_naver_place_blog');
    expect(attentionList[0].attentionReason).toBe('TOKEN_EXPIRED');
  });
});
