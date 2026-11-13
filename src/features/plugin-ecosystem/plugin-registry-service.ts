import {
  PluginDefinition,
  PluginInstallWizardSession,
  WizardStep,
  MissingPluginPromptContext,
} from './types';

export class PluginRegistryService {
  private plugins: Map<string, PluginDefinition> = new Map();
  private workspaceInstalledPlugins: Map<string, Set<string>> = new Map();
  private wizardSessions: Map<string, PluginInstallWizardSession> = new Map();
  private suspendedPrompts: Map<string, MissingPluginPromptContext> = new Map();

  constructor() {
    this.seedStandardPlugins();
  }

  private seedStandardPlugins(): void {
    const defaultPlugins: PluginDefinition[] = [
      {
        pluginId: 'plg_meta_instagram',
        name: '인스타그램 공식 자동화',
        description: '피드, 릴스 게시 및 DM 문의 답변 초안',
        icon: 'instagram',
        packName: '매출 폭발 SNS 팩',
        invocationTag: '@instagram',
        triaxialState: {
          trustTier: 'VERIFIED_CORE',
          lifecycleState: 'INSTALLED_HEALTHY',
          verificationStatus: 'OFFICIAL_SANDBOX_VERIFIED',
        },
        contract: {
          pluginId: 'plg_meta_instagram',
          name: '인스타그램 공식 자동화',
          category: 'CHANNELS',
          outcomeTarget: '인스타그램 도달 3배 및 주간 예약 유입 증대',
          requiredPermissions: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_messages'],
          creditCostPerAction: 100,
          dataAccessScope: ['공개 프로필', '게시물 인사이트', 'DM 메시지'],
          slaGuaranteeHours: 1,
        },
        isReady: true,
        version: '2.4.0',
      },
      {
        pluginId: 'plg_naver_place_blog',
        name: '네이버 스마트플레이스 & 블로그',
        description: '플레이스 소식 연동, 리뷰 분석, 블로그 원고 및 사진 준비',
        icon: 'naver',
        packName: '로컬 플레이스 검색 최적화 팩',
        invocationTag: '@naver',
        triaxialState: {
          trustTier: 'VERIFIED_CORE',
          lifecycleState: 'INSTALLED_HEALTHY',
          verificationStatus: 'OFFICIAL_SANDBOX_VERIFIED',
        },
        contract: {
          pluginId: 'plg_naver_place_blog',
          name: '네이버 스마트플레이스 & 블로그',
          category: 'CHANNELS',
          outcomeTarget: '지역 검색 최적화 및 지도 플레이스 유입 개선',
          requiredPermissions: ['naver_blog_write', 'naver_place_manage'],
          creditCostPerAction: 250,
          dataAccessScope: ['블로그 카테고리', '플레이스 정보'],
          slaGuaranteeHours: 2,
        },
        isReady: true,
        version: '1.9.0',
      },
      {
        pluginId: 'plg_daangn_local',
        name: '당근마켓 동네생활 피드',
        description: '동네 소식 및 혜택 안내 원고 준비',
        icon: 'carrot',
        packName: '동네 단골 확보 팩',
        invocationTag: '@daangn',
        triaxialState: {
          trustTier: 'COMMUNITY_PARTNER',
          lifecycleState: 'NOT_INSTALLED',
          verificationStatus: 'EXTERNAL_VERIFIED',
        },
        contract: {
          pluginId: 'plg_daangn_local',
          name: '당근마켓 동네생활 피드',
          category: 'CHANNELS',
          outcomeTarget: '반경 3km 내 이웃 고객 단골 유치 및 소식 홍보',
          requiredPermissions: ['carrot_feed_write'],
          creditCostPerAction: 80,
          dataAccessScope: ['매장 프로필', '동네 타겟 위치'],
          slaGuaranteeHours: 4,
        },
        isReady: false,
        version: '1.2.0',
      },
      {
        pluginId: 'plg_lead_crm_booster',
        name: 'CRM 고객 생애주기 부스터',
        description: '카카오 알림톡, 예약 리마인더, 이탈 방지 쿠폰',
        icon: 'crm',
        packName: '단골 재방문 팩',
        invocationTag: '@crm',
        triaxialState: {
          trustTier: 'VERIFIED_CORE',
          lifecycleState: 'INSTALLED_HEALTHY',
          verificationStatus: 'OFFICIAL_SANDBOX_VERIFIED',
        },
        contract: {
          pluginId: 'plg_lead_crm_booster',
          name: 'CRM 고객 생애주기 부스터',
          category: 'CRM',
          outcomeTarget: '방문 고객 30일 내 재방문율 35% 달성',
          requiredPermissions: ['kakao_bizmessage_send', 'crm_customer_write'],
          creditCostPerAction: 50,
          dataAccessScope: ['고객 연락처', '방문 이력'],
          slaGuaranteeHours: 1,
        },
        isReady: true,
        version: '3.1.0',
      },
    ];

    for (const p of defaultPlugins) {
      this.plugins.set(p.pluginId, p);
    }
  }

  /**
   * ANI-863: READY 상태 플러그인 수 SSOT (모든 화면/컨텍스트 일치)
   */
  getReadyPluginCount(workspaceId: string): number {
    return Array.from(this.plugins.values()).filter((p) => p.isReady).length;
  }

  /**
   * ANI-810: 프롬프트 내 @플러그인 명시 호출 파싱
   */
  parsePluginMentions(prompt: string): PluginDefinition[] {
    const matches: PluginDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      if (prompt.includes(plugin.invocationTag)) {
        matches.push(plugin);
      }
    }
    return matches;
  }

  /**
   * ANI-812: 미설치 플러그인 요구 작업 감지 및 대화 보류 (Missing Plugin UX)
   */
  handleMissingPlugin(params: {
    workspaceId: string;
    prompt: string;
    requiredPluginId: string;
  }): {
    needsInstall: boolean;
    plugin?: PluginDefinition;
    context?: MissingPluginPromptContext;
  } {
    const { workspaceId, prompt, requiredPluginId } = params;
    const plugin = this.plugins.get(requiredPluginId);

    if (!plugin) {
      return { needsInstall: false };
    }

    if (!plugin.isReady || plugin.triaxialState.lifecycleState === 'NOT_INSTALLED') {
      const context: MissingPluginPromptContext = {
        originalPrompt: prompt,
        requiredPluginId,
        invocationTag: plugin.invocationTag,
        suspendedAt: new Date().toISOString(),
        resumeReady: false,
      };

      const key = `${workspaceId}:${requiredPluginId}`;
      this.suspendedPrompts.set(key, context);

      return {
        needsInstall: true,
        plugin,
        context,
      };
    }

    return { needsInstall: false, plugin };
  }

  /**
   * ANI-806: 플러그인 설치 5단계 위저드 시작
   */
  startInstallWizard(workspaceId: string, pluginId: string): PluginInstallWizardSession {
    const sessionId = `wiz_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const session: PluginInstallWizardSession = {
      sessionId,
      pluginId,
      workspaceId,
      currentStep: 'CHECK_ENTITLEMENT',
      stepResults: {},
      isCompleted: false,
    };

    this.wizardSessions.set(sessionId, session);
    return session;
  }

  /**
   * 위저드 단계 전진 (CHECK_ENTITLEMENT -> CONFIRM_PERMISSIONS -> CONNECT_OAUTH -> HEALTH_CHECK_PING -> TEST_READ_WRITE -> READY_CONFIRMED)
   */
  advanceWizardStep(sessionId: string): PluginInstallWizardSession {
    const session = this.wizardSessions.get(sessionId);
    if (!session) {
      throw new Error(`Wizard session not found: ${sessionId}`);
    }

    const steps: WizardStep[] = [
      'CHECK_ENTITLEMENT',
      'CONFIRM_PERMISSIONS',
      'CONNECT_OAUTH',
      'HEALTH_CHECK_PING',
      'TEST_READ_WRITE',
      'READY_CONFIRMED',
    ];

    const currentIndex = steps.indexOf(session.currentStep);
    session.stepResults[session.currentStep] = true;

    if (currentIndex < steps.length - 1) {
      session.currentStep = steps[currentIndex + 1];
    }

    if (session.currentStep === 'READY_CONFIRMED') {
      session.isCompleted = true;
      // 플러그인 상태를 READY 및 INSTALLED_HEALTHY로 활성화
      const plugin = this.plugins.get(session.pluginId);
      if (plugin) {
        plugin.isReady = true;
        plugin.triaxialState.lifecycleState = 'INSTALLED_HEALTHY';
        plugin.installedAt = new Date().toISOString();
      }

      // ANI-812: 보류되었던 작업이 있으면 resumeReady 활성화
      const suspendKey = `${session.workspaceId}:${session.pluginId}`;
      const suspended = this.suspendedPrompts.get(suspendKey);
      if (suspended) {
        suspended.resumeReady = true;
      }
    }

    return session;
  }

  /**
   * ANI-812: 설치 완료 후 직전 대화 재개 컨텍스트 반환
   */
  resumeSuspendedPrompt(workspaceId: string, pluginId: string): MissingPluginPromptContext | undefined {
    const suspendKey = `${workspaceId}:${pluginId}`;
    const context = this.suspendedPrompts.get(suspendKey);
    if (context && context.resumeReady) {
      this.suspendedPrompts.delete(suspendKey);
      return context;
    }
    return undefined;
  }

  /**
   * ANI-864: 점주의 주의/조치가 필요한 플러그인 인박스
   */
  listNeedsAttention(workspaceId: string): PluginDefinition[] {
    return Array.from(this.plugins.values()).filter(
      (p) => p.triaxialState.lifecycleState === 'NEEDS_ATTENTION'
    );
  }

  /**
   * 플러그인 상태를 Needs Attention으로 설정 (예: 토큰 만료)
   */
  flagAttention(pluginId: string, reason: PluginDefinition['attentionReason']): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin) {
      plugin.triaxialState.lifecycleState = 'NEEDS_ATTENTION';
      plugin.attentionReason = reason;
      plugin.isReady = false;
    }
  }

  getPlugin(pluginId: string): PluginDefinition | undefined {
    return this.plugins.get(pluginId);
  }
}
