import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DynamicCapabilityDiscovery,
  getRelevantOperationalCapabilities,
  type SurfaceContextType,
} from '@/lib/mcp-gateway/dynamic-capability-discovery';
import {
  ToolAdmissionController,
  CapabilityNotReadyError,
} from '@/lib/mcp-gateway/tool-admission-controller';
import {
  ToolExecutionEnvelope,
  ToolExecutionEnvelopeExecutor,
  createToolExecutionEnvelope,
  validateToolExecutionEnvelope,
} from '@/lib/mcp-gateway/tool-execution-envelope';
import {
  CapabilityStatusRegistry,
  type CapabilityOperationalStatus,
} from '@/lib/mcp-gateway/capability-status-registry';
import { AgentControlPlaneService } from '@/features/marketing-agent/engine/agent-control-state';
import { ToolDispatcher } from '@/features/tool-runtime/tool-dispatcher';

// content.generate 는 4채널 스튜디오(DB 의존)를 호출하므로 실DB 없이 도구 경로를 검증하도록 서비스를 대체한다.
vi.mock('@/lib/supabase/admin', async () => (await import('./helpers/fake-channel-studio')).fakeAdminModule());
vi.mock('@/features/channel-studio/compose', async () => (await import('./helpers/fake-channel-studio')).fakeComposeModule());

describe('Task 2.2: Dynamic Capability Discovery & Unified Tool Execution Envelope (ANI-973, ANI-974, ANI-975)', () => {
  const WORKSPACE_ID = 'ws-test-byreum';
  const ACTOR_ID = 'act-owner-001';
  const SESSION_ID = 'sess-test-discovery-1';
  const GOAL_ID = 'goal-spring-promo-1';
  const ACTION_RUN_ID = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => {
    AgentControlPlaneService.resetForTest(WORKSPACE_ID);
    CapabilityStatusRegistry.resetForTest();
  });

  describe('ANI-973: Dynamic Capability Discovery & Surface Context Filtering', () => {
    it('filters capabilities strictly according to the surface context (CRM vs ADS vs REPORT)', async () => {
      // 1. CRM Surface
      const crmDiscovery = await getRelevantOperationalCapabilities({
        goal: '고객 관리 현황 확인',
        surfaceContext: 'CRM',
        workspaceId: WORKSPACE_ID,
      });

      const crmToolIds = crmDiscovery.operationalCapabilities.map(c => c.id);
      expect(crmToolIds).toContain('customer.search');
      expect(crmToolIds).toContain('comment.reply');
      expect(crmToolIds).toContain('dm.send');
      expect(crmToolIds).toContain('reservation.list');
      // Must NOT contain Ads or Report capabilities
      expect(crmToolIds).not.toContain('ads.list');
      expect(crmToolIds).not.toContain('report.generate');
      expect(crmToolIds).not.toContain('performance.summary');

      // 2. ADS Surface
      const adsDiscovery = await getRelevantOperationalCapabilities({
        goal: '광고 캠페인 목록 및 집행 현황',
        surfaceContext: 'ADS',
        workspaceId: WORKSPACE_ID,
      });

      const adsToolIds = adsDiscovery.operationalCapabilities.map(c => c.id);
      expect(adsToolIds).toContain('ads.list');
      expect(adsToolIds).toContain('ads.status');
      // campaign.plan has no external API / persistence source, so it is excluded (Fail-Closed)
      expect(adsToolIds).not.toContain('campaign.plan');
      // Must NOT contain CRM or Content writing tools
      expect(adsToolIds).not.toContain('customer.search');
      expect(adsToolIds).not.toContain('content.rewrite');

      // 3. REPORT Surface
      const reportDiscovery = await getRelevantOperationalCapabilities({
        goal: '이번 달 마케팅 실적 및 ROAS 보고서 생성',
        surfaceContext: 'REPORT',
        workspaceId: WORKSPACE_ID,
      });

      const reportToolIds = reportDiscovery.operationalCapabilities.map(c => c.id);
      expect(reportToolIds).toContain('report.generate');
      expect(reportToolIds).toContain('performance.summary');
      expect(reportToolIds).not.toContain('publish.create');
      expect(reportToolIds).not.toContain('comment.reply');
    });

    it('filters capabilities for CONTENT, CAMPAIGN, and SETTINGS surfaces', async () => {
      // 1. CONTENT Surface
      const contentDiscovery = await getRelevantOperationalCapabilities({
        goal: '새로운 시술 사진 및 홍보 원고 작성',
        surfaceContext: 'CONTENT',
        workspaceId: WORKSPACE_ID,
      });

      const contentToolIds = contentDiscovery.operationalCapabilities.map(c => c.id);
      expect(contentToolIds).toContain('content.generate');
      expect(contentToolIds).toContain('content.rewrite');
      expect(contentToolIds).toContain('image.generate');
      expect(contentToolIds).toContain('publish.create');
      expect(contentToolIds).not.toContain('customer.search');
      expect(contentToolIds).not.toContain('ads.list');

      // 2. CAMPAIGN Surface
      const campaignDiscovery = await getRelevantOperationalCapabilities({
        goal: '봄맞이 신규 프로모션 캠페인 기획',
        surfaceContext: 'CAMPAIGN',
        workspaceId: WORKSPACE_ID,
      });

      const campaignToolIds = campaignDiscovery.operationalCapabilities.map(c => c.id);
      expect(campaignToolIds).toContain('campaign.create');
      // campaign.plan is excluded from implemented domain tools
      expect(campaignToolIds).not.toContain('campaign.plan');
      expect(campaignToolIds).not.toContain('dm.send');

      // 3. SETTINGS Surface
      const settingsDiscovery = await getRelevantOperationalCapabilities({
        goal: '소희 자율모드 가동 및 킬스위치 설정',
        surfaceContext: 'SETTINGS',
        workspaceId: WORKSPACE_ID,
      });

      const settingsToolIds = settingsDiscovery.operationalCapabilities.map(c => c.id);
      expect(settingsToolIds).toContain('autonomy.update');
      expect(settingsToolIds).toContain('emergency_killswitch');
      expect(settingsToolIds).toContain('credit.status');
      expect(settingsToolIds).toContain('app.navigate');
      expect(settingsToolIds).not.toContain('image.generate');
    });

    it('handles CanonicalSurfaceContext object with route/tab mapping', async () => {
      const discovery = await getRelevantOperationalCapabilities({
        goal: '고객 댓글 확인',
        surfaceContext: { route: '/app/customers', tab: 'interaction' },
        workspaceId: WORKSPACE_ID,
      });

      expect(discovery.surface).toBe('CRM');
      const toolIds = discovery.operationalCapabilities.map(c => c.id);
      expect(toolIds).toContain('customer.search');
      expect(toolIds).toContain('comment.reply');
    });

    it('in CHAT surface, dynamically includes capabilities relevant to the goal', async () => {
      // Chat with content goal
      const chatContentDiscovery = await getRelevantOperationalCapabilities({
        goal: '인스타에 올릴 자연눈썹 시술 원고와 사진 만들어줘',
        surfaceContext: 'CHAT',
        workspaceId: WORKSPACE_ID,
      });

      const contentIds = chatContentDiscovery.operationalCapabilities.map(c => c.id);
      expect(contentIds).toContain('content.generate');
      expect(contentIds).toContain('image.generate');
      expect(contentIds).toContain('knowledge.search'); // Core assistant knowledge

      // Chat with CRM goal
      const chatCrmDiscovery = await getRelevantOperationalCapabilities({
        goal: '오늘 인스타 DM이나 예약 문의 들어온거 있어?',
        surfaceContext: 'CHAT',
        workspaceId: WORKSPACE_ID,
      });

      const crmIds = chatCrmDiscovery.operationalCapabilities.map(c => c.id);
      expect(crmIds).toContain('interaction.list');
      expect(crmIds).toContain('customer.search');
      expect(crmIds).toContain('knowledge.search');
    });

    it('exposes internal reply drafting only to an explicit server candidate policy', async () => {
      const allowed = await getRelevantOperationalCapabilities({ goal: '답변 초안 준비', surfaceContext: 'CHAT', workspaceId: WORKSPACE_ID,
        allowedCapabilityIds: ['comment.reply_draft', 'dm.reply_draft'] })
      expect(allowed.operationalCapabilities.map(cap => cap.id)).toEqual(['comment.reply_draft', 'dm.reply_draft'])
      const legacy = await getRelevantOperationalCapabilities({ goal: '', workspaceId: WORKSPACE_ID })
      expect(legacy.operationalCapabilities.map(cap => cap.id)).not.toContain('comment.reply_draft')
      expect(legacy.operationalCapabilities.map(cap => cap.id)).not.toContain('dm.reply_draft')
    })

    it('uses an explicit server candidate set for follow-up turns without registry fallback', async () => {
      const result = await getRelevantOperationalCapabilities({ goal: '이어서 확인해줘', surfaceContext: 'CHAT', workspaceId: WORKSPACE_ID,
        allowedCapabilityIds: ['reservation.list'] })
      expect(result.operationalCapabilities.map(cap => cap.id)).toEqual(['reservation.list'])
      const none = await getRelevantOperationalCapabilities({ goal: '확인해줘', workspaceId: WORKSPACE_ID, allowedCapabilityIds: [] })
      expect(none.openAiTools).toEqual([])
      expect(none.totalEvaluated).toBe(0)
    })

    it('excludes NOT_IMPLEMENTED, DISCONNECTED, BLOCKED, and DEGRADED capabilities and records exclusionReasons', async () => {
      // Configure specific capability statuses
      CapabilityStatusRegistry.setOverride(
        WORKSPACE_ID,
        'content.rewrite',
        'DEGRADED',
        '외부 LLM 재작성 엔진 레이턴시 급증으로 일시 비활성화'
      );
      CapabilityStatusRegistry.setOverride(
        WORKSPACE_ID,
        'image.generate',
        'DISCONNECTED',
        '이미지 생성 서비스 공급자 API 키 미연결'
      );
      CapabilityStatusRegistry.setOverride(
        WORKSPACE_ID,
        'publish.create',
        'BLOCKED',
        '보안 정책에 따라 즉시 발행 차단'
      );
      // 'content.list' is NOT_IMPLEMENTED by default

      const discovery = await getRelevantOperationalCapabilities({
        goal: '콘텐츠 작성 및 관리',
        surfaceContext: 'CONTENT',
        workspaceId: WORKSPACE_ID,
      });

      const opIds = discovery.operationalCapabilities.map(c => c.id);
      expect(opIds).toContain('content.generate');
      expect(opIds).not.toContain('content.rewrite');
      expect(opIds).not.toContain('image.generate');
      expect(opIds).not.toContain('publish.create');
      expect(opIds).not.toContain('content.list');

      // Check exclusion reasons
      const degradedExclusion = discovery.exclusionReasons.find(e => e.capabilityId === 'content.rewrite');
      expect(degradedExclusion).toBeDefined();
      expect(degradedExclusion?.status).toBe('DEGRADED');
      expect(degradedExclusion?.reason).toContain('레이턴시 급증');

      const disconnectedExclusion = discovery.exclusionReasons.find(e => e.capabilityId === 'image.generate');
      expect(disconnectedExclusion).toBeDefined();
      expect(disconnectedExclusion?.status).toBe('DISCONNECTED');
      expect(disconnectedExclusion?.reason).toContain('미연결');

      const blockedExclusion = discovery.exclusionReasons.find(e => e.capabilityId === 'publish.create');
      expect(blockedExclusion).toBeDefined();
      expect(blockedExclusion?.status).toBe('BLOCKED');

      const notImplementedExclusion = discovery.exclusionReasons.find(e => e.capabilityId === 'content.list');
      expect(notImplementedExclusion).toBeDefined();
      expect(notImplementedExclusion?.status).toBe('NOT_IMPLEMENTED');
    });

    it('returns valid OpenAI function calling tools schema array for only OPERATIONAL_READY tools', async () => {
      const discovery = await getRelevantOperationalCapabilities({
        goal: '신규 콘텐츠 작성',
        surfaceContext: 'CONTENT',
        workspaceId: WORKSPACE_ID,
      });

      expect(discovery.openAiTools.length).toBe(discovery.operationalCapabilities.length);
      for (const tool of discovery.openAiTools) {
        expect(tool.type).toBe('function');
        expect(tool.function.name).toBeDefined();
        expect(tool.function.description).toBeDefined();
        expect(tool.function.parameters).toBeDefined();
      }
    });
  });

  describe('ANI-974: Dynamic Tool Admission Controller (Fail-Closed & Policy Gates)', () => {
    it('admits an OPERATIONAL_READY tool call when all conditions are satisfied', async () => {
      const envelope = createToolExecutionEnvelope({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'content.generate',
        inputPayload: { topic: '봄맞이 이벤트', channel: 'INSTAGRAM' },
        idempotencyKey: 'idem-test-admit-1',
      });

      const admission = await ToolAdmissionController.admit(envelope);
      expect(admission.admitted).toBe(true);
      expect(admission.capabilityId).toBe('content.generate');
      expect(admission.workspaceId).toBe(WORKSPACE_ID);
    });

    it('throws CAPABILITY_NOT_READY when tool is NOT_IMPLEMENTED', async () => {
      const envelope = createToolExecutionEnvelope({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'unimplemented.capability.name',
        inputPayload: {},
        idempotencyKey: 'idem-test-not-impl',
      });

      await expect(ToolAdmissionController.admit(envelope)).rejects.toThrow(CapabilityNotReadyError);
      try {
        await ToolAdmissionController.admit(envelope);
      } catch (err: any) {
        expect(err.code).toBe('CAPABILITY_NOT_READY');
        expect(err.operationalStatus).toBe('NOT_IMPLEMENTED');
        expect(err.capabilityId).toBe('unimplemented.capability.name');
      }
    });

    it('throws CAPABILITY_NOT_READY when tool is DISCONNECTED', async () => {
      CapabilityStatusRegistry.setOverride(
        WORKSPACE_ID,
        'image.generate',
        'DISCONNECTED',
        'API 키 만료로 공급자 연결 끊김'
      );

      const envelope = createToolExecutionEnvelope({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'image.generate',
        inputPayload: { prompt: '시술 사진' },
        idempotencyKey: 'idem-test-disconnected',
      });

      await expect(ToolAdmissionController.admit(envelope)).rejects.toThrow(CapabilityNotReadyError);
      try {
        await ToolAdmissionController.admit(envelope);
      } catch (err: any) {
        expect(err.code).toBe('CAPABILITY_NOT_READY');
        expect(err.operationalStatus).toBe('DISCONNECTED');
        expect(err.reason).toContain('연결 끊김');
      }
    });

    it('throws CAPABILITY_NOT_READY when KillSwitch is active (BLOCKED)', async () => {
      // Activate KillSwitch
      AgentControlPlaneService.toggleKillSwitch(WORKSPACE_ID, true, 'owner', '긴급 테스트 차단');

      const envelope = createToolExecutionEnvelope({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'content.generate',
        inputPayload: { topic: '시술 소개' },
        idempotencyKey: 'idem-test-blocked-killswitch',
      });

      await expect(ToolAdmissionController.admit(envelope)).rejects.toThrow(CapabilityNotReadyError);
      try {
        await ToolAdmissionController.admit(envelope);
      } catch (err: any) {
        expect(err.code).toBe('CAPABILITY_NOT_READY');
        expect(err.operationalStatus).toBe('BLOCKED');
        expect(err.reason).toContain('킬스위치');
      }
    });

    it('allows emergency_killswitch release tool even when KillSwitch is active', async () => {
      AgentControlPlaneService.toggleKillSwitch(WORKSPACE_ID, true, 'owner', '긴급 테스트 차단');

      const envelope = createToolExecutionEnvelope({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'emergency_killswitch',
        inputPayload: { action: 'release', reason: '정상 복구' },
        idempotencyKey: 'idem-test-killswitch-release',
      });

      const admission = await ToolAdmissionController.admit(envelope);
      expect(admission.admitted).toBe(true);
    });

    it('throws CAPABILITY_NOT_READY when FinOps credit balance is insufficient for cost-bearing tools', async () => {
      const envelope = createToolExecutionEnvelope({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'image.generate',
        inputPayload: { prompt: '시술 사진' },
        idempotencyKey: 'idem-test-finops-credit',
      });

      // Pass insufficient credit balance in options
      await expect(
        ToolAdmissionController.admit(envelope, { creditBalance: 10, isTestAccount: false })
      ).rejects.toThrow(CapabilityNotReadyError);

      try {
        await ToolAdmissionController.admit(envelope, { creditBalance: 10, isTestAccount: false });
      } catch (err: any) {
        expect(err.code).toBe('CAPABILITY_NOT_READY');
        expect(err.operationalStatus).toBe('BLOCKED');
        expect(err.reason).toContain('크레딧');
      }
    });
  });

  describe('ANI-975: Unified Tool Execution Envelope Specification & Execution', () => {
    it('validates that all 9 required fields are present in ToolExecutionEnvelope', () => {
      // Valid envelope
      const validEnvelope = {
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'content.generate',
        inputPayload: { topic: '테스트' },
        idempotencyKey: 'idem-test-valid-1',
      };

      const validation = validateToolExecutionEnvelope(validEnvelope);
      expect(validation.valid).toBe(true);
      expect(validation.missingFields).toHaveLength(0);

      // Missing required fields
      const invalidEnvelope = {
        workspaceId: WORKSPACE_ID,
        // missing actorId
        sessionId: SESSION_ID,
        // missing goalId
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        // missing capabilityId
        inputPayload: {},
        // missing idempotencyKey
      };

      const invalidValidation = validateToolExecutionEnvelope(invalidEnvelope);
      expect(invalidValidation.valid).toBe(false);
      expect(invalidValidation.missingFields).toContain('actorId');
      expect(invalidValidation.missingFields).toContain('goalId');
      expect(invalidValidation.missingFields).toContain('capabilityId');
      expect(invalidValidation.missingFields).toContain('idempotencyKey');
    });

    it('executes internal domain adapter through ToolExecutionEnvelopeExecutor with admission check', async () => {
      const envelope = createToolExecutionEnvelope({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'content.generate',
        inputPayload: { topic: '봄맞이 속눈썹 펌', channel: 'INSTAGRAM' },
        idempotencyKey: 'idem-exec-internal-1',
      });

      const result = await ToolExecutionEnvelopeExecutor.execute(envelope);
      expect(result.success).toBe(true);
      expect(result.status).toBe('COMPLETED');
      const draftData = result.data as { draftId?: string } | undefined;
      expect(draftData?.draftId).toBeDefined();
      expect(typeof draftData?.draftId).toBe('string');
      expect((draftData?.draftId ?? '').length).toBeGreaterThan(0);
      expect(result.executedAt).toBeDefined();
    });

    it('returns fail-closed envelope result when admission fails for non-ready tool', async () => {
      CapabilityStatusRegistry.setOverride(
        WORKSPACE_ID,
        'content.generate',
        'DISCONNECTED',
        '외부 LLM 연결 두절'
      );

      const envelope = createToolExecutionEnvelope({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'content.generate',
        inputPayload: { topic: '시술' },
        idempotencyKey: 'idem-exec-fail-closed',
      });

      const result = await ToolExecutionEnvelopeExecutor.execute(envelope);
      expect(result.success).toBe(false);
      expect(result.status).toBe('DISCONNECTED');
      expect(result.error?.code).toBe('CAPABILITY_NOT_READY');
      expect(result.error?.message).toContain('외부 LLM 연결 두절');
    });

    it('enforces idempotency key so that duplicate execution envelope returns cached/idempotent result', async () => {
      const idempotencyKey = 'idem-duplicate-check-key-1';

      const envelope1 = createToolExecutionEnvelope({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'content.generate',
        inputPayload: { topic: '동일 키 테스트', channel: 'INSTAGRAM' },
        idempotencyKey,
      });

      const res1 = await ToolExecutionEnvelopeExecutor.execute(envelope1);
      expect(res1.success).toBe(true);

      // Repeat with same idempotencyKey
      const envelope2 = createToolExecutionEnvelope({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        goalId: GOAL_ID,
        actionRunId: ACTION_RUN_ID,
        stepIndex: 1,
        capabilityId: 'content.generate',
        inputPayload: { topic: '동일 키 테스트', channel: 'INSTAGRAM' },
        idempotencyKey,
      });

      const res2 = await ToolExecutionEnvelopeExecutor.execute(envelope2);
      expect(res2.success).toBe(true);
      expect(res2.isIdempotentReplay).toBe(true);
      expect(res2.data?.draftId).toBe(res1.data?.draftId);
    });
  });

  describe('Integration: ToolDispatcher with Dynamic Discovery & Admission', () => {
    it('dispatches tools through preflight admission checking', async () => {
      // Disconnected capability fails preflight
      CapabilityStatusRegistry.setOverride(
        WORKSPACE_ID,
        'content.generate',
        'DISCONNECTED',
        '연결 끊김'
      );

      const result = await ToolDispatcher.dispatch(
        'content.generate',
        { topic: '실패해야 함' },
        {
          workspaceId: WORKSPACE_ID,
          correlationId: 'test-corr-int-1',
        }
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('DISCONNECTED');
      expect(result.error?.code).toBe('CAPABILITY_NOT_READY');
    });
  });
});
