import { describe, it, expect, beforeEach, vi } from 'vitest';
import { contentDispatcher, setContentGenerator, resetContentGenerator } from '@/features/tool-runtime/dispatchers/content-dispatcher';
import { adsDispatcher, setAdAccountResolver, resetAdAccountResolver } from '@/features/tool-runtime/dispatchers/ads-dispatcher';
import { ChannelDraftError, type ChannelDraftResult } from '@/features/channel-studio/types';
import {
  SOHEE_CAPABILITY_REGISTRY,
  CORE_18_OPERATIONAL_CAPABILITIES,
  PROVIDER_CAPABILITY_MATRIX,
  evaluateCapabilityOperationalState,
  transitionCapabilityState,
  canTransitionOperationalState,
  type OperationalState,
} from '@/lib/agent-os/mcp-capability-registry';
import type { ToolExecutionContext } from '@/features/tool-runtime/types';

const mockStudioGenerate = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({})),
}));

vi.mock('@/features/channel-studio/compose', () => ({
  createChannelDraftService: vi.fn(() => ({
    generate: mockStudioGenerate,
    edit: vi.fn(),
    listRecent: vi.fn(),
  })),
}));

describe('Task 2.3: Real Tool/MCP Operational READY Contracts & Zero Synthetic Success', () => {
  const mockContext: ToolExecutionContext = {
    workspaceId: 'ws_test_beauty_salon',
    actorId: 'usr_owner_01',
    sessionId: 'ses_01',
    correlationId: 'corr_test_01',
    intentMode: 'EXECUTE',
    isTestAccount: false,
  };

  beforeEach(() => {
    resetContentGenerator();
    resetAdAccountResolver();
  });

  // =========================================================================
  // 1. Content Dispatcher: Zero Synthetic Success & Minimum Validation (ANI-954)
  // =========================================================================
  describe('1. Content Dispatcher: Zero Synthetic / Template Success (ANI-954)', () => {
    it('should NEVER return the fake template string "맞춤형 마케팅 원고가 생성되었습니다"', async () => {
      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 맞이 볼륨매직 할인 이벤트',
          channel: 'INSTAGRAM',
        },
        mockContext
      );

      // Must succeed with real AI generation or fail-closed, but NEVER return the old template string
      if (result.success && result.data) {
        const caption = String((result.data as any).caption || '');
        expect(caption).not.toContain('맞춤형 마케팅 원고가 생성되었습니다');
        expect(caption.length).toBeGreaterThanOrEqual(20);
      }
    });

    it('should reject requests with missing or empty topic with INVALID_ARGUMENT', async () => {
      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '   ',
          channel: 'INSTAGRAM',
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('INVALID_ARGUMENT');
    });

    it('should reject unsupported channel types', async () => {
      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '네일아트 신규 디자인',
          channel: 'UNSUPPORTED_PLATFORM',
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('INVALID_ARGUMENT');
    });

    it('should reject when channel studio generation fails (e.g. invalid model output)', async () => {
      mockStudioGenerate.mockRejectedValueOnce(
        new ChannelDraftError('글 생성 결과가 올바르지 않아요. 다시 시도해 주세요.', 'MODEL_OUTPUT_INVALID', 502)
      );

      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '짧은 글 테스트',
          channel: 'INSTAGRAM',
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('FAILED');
      expect(result.error?.code).toBe('MODEL_OUTPUT_INVALID');
    });

    it('should successfully generate real structured marketing copy via AI generator engine', async () => {
      const mockResult: ChannelDraftResult = {
        requestKey: '550e8400-e29b-41d4-a716-446655440002',
        topic: '가을 프리미엄 볼륨매직',
        createdAt: new Date().toISOString(),
        basisNotes: ['지식 v1 기준'],
        imageNotice: null,
        variants: [
          {
            channel: 'instagram',
            payload: {
              caption: '[가을 프리미엄 볼륨매직] 이번 가을, 당신만을 위한 시술을 만나보세요. 100% 예약제로 운영되는 프라이빗 헤어살롱입니다. 프로필 링크에서 지금 바로 예약하세요!',
              hashtags: ['#가을헤어', '#볼륨매직', '#헤어스타일추천'],
            },
            status: 'READY',
            statusLabel: '보관할 수 있어요',
            issues: [],
            contentId: 'cid-mcp-1',
            versionId: 'vid-mcp-1',
            vaultSavable: true,
            blockedReason: null,
          },
        ],
      };
      mockStudioGenerate.mockResolvedValueOnce(mockResult);

      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 프리미엄 볼륨매직',
          channel: 'INSTAGRAM',
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMPLETED');
      expect((result.data as any).caption).toContain('프라이빗 헤어살롱');
      expect((result.data as any).hashtags.length).toBeGreaterThan(0);
      expect((result.data as any).caption.length).toBeGreaterThanOrEqual(20);
    });
  });

  // =========================================================================
  // 2. Ads Dispatcher: Dynamic Ad Account Connection Probe (ANI-978)
  // =========================================================================
  describe('2. Ads Dispatcher: Dynamic Connection Probe & Zero Hardcoded False', () => {
    it('should dynamically query connection state and return CONNECT_REQUIRED when not connected', async () => {
      // Explicitly set resolver to return unconnected
      setAdAccountResolver(async () => ({
        connected: false,
        status: 'DISCONNECTED',
      }));

      const result = await adsDispatcher.execute(
        {
          _toolName: 'campaign.create',
          title: '가을 시즌 예약 유치 광고',
          goal: '예약 증가',
          budget: 50000,
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('UNAVAILABLE');
      expect(result.error?.code).toBe('CONNECT_REQUIRED');
      expect(result.error?.message).toContain('연결된 광고 계정이 없습니다');
    });

    it('should return UNAVAILABLE with structured data on read operations when unconnected', async () => {
      setAdAccountResolver(async () => ({
        connected: false,
        status: 'DISCONNECTED',
      }));

      const result = await adsDispatcher.execute(
        {
          _toolName: 'ads.list',
        },
        mockContext
      );

      expect(result.success).toBe(false);
      expect(result.status).toBe('UNAVAILABLE');
      expect(result.error?.code).toBe('CONNECT_REQUIRED');
      expect(result.data).toEqual(
        expect.objectContaining({
          connectRequired: true,
          connectedChannelsCount: 0,
          campaigns: [],
        })
      );
    });

    it('should dynamically succeed with real ad operations when ad account is connected', async () => {
      // Simulate connected ad account
      setAdAccountResolver(async (workspaceId) => ({
        connected: true,
        accountId: `act_${workspaceId}_meta`,
        accountName: '소희 뷰티살롱 공식 광고계정',
        provider: 'META_ADS',
        status: 'ACTIVE',
        currency: 'KRW',
        campaignCount: 2,
      }));

      // In DRAFT mode, it should create an approval proposal
      const draftContext: ToolExecutionContext = {
        ...mockContext,
        intentMode: 'DRAFT',
      };

      const draftResult = await adsDispatcher.execute(
        {
          _toolName: 'campaign.create',
          title: '가을 시즌 예약 유치 광고',
          goal: '신규 고객 예약 증가',
          budget: 100000,
        },
        draftContext
      );

      expect(draftResult.success).toBe(true);
      expect(draftResult.status).toBe('AWAITING_APPROVAL');
      expect(draftResult.proposal?.proposalType).toBe('CAMPAIGN_APPROVAL');
      expect((draftResult.proposal?.proposedValue as any).adAccountId).toBe('act_ws_test_beauty_salon_meta');

      // In EXECUTE mode, it should execute campaign creation with evidence
      const execResult = await adsDispatcher.execute(
        {
          _toolName: 'campaign.create',
          title: '가을 시즌 예약 유치 광고',
          goal: '신규 고객 예약 증가',
          budget: 100000,
        },
        mockContext
      );

      expect(execResult.success).toBe(true);
      expect(execResult.status).toBe('COMPLETED');
      expect((execResult.data as any).adAccountId).toBe('act_ws_test_beauty_salon_meta');
      expect(execResult.evidence).toBeDefined();
      expect(execResult.evidence?.channel).toBe('META_ADS');
    });

    it('should list campaigns when ad account is connected', async () => {
      setAdAccountResolver(async (workspaceId) => ({
        connected: true,
        accountId: `act_${workspaceId}_meta`,
        accountName: '소희 뷰티살롱 공식 광고계정',
        provider: 'META_ADS',
        status: 'ACTIVE',
        currency: 'KRW',
        campaignCount: 1,
      }));

      const result = await adsDispatcher.execute(
        {
          _toolName: 'ads.list',
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMPLETED');
      expect((result.data as any).connectedChannelsCount).toBe(1);
      expect((result.data as any).adAccountId).toBe('act_ws_test_beauty_salon_meta');
    });
  });

  // =========================================================================
  // 3. 18 Core Operational Capabilities Registry & Operational READY Contracts
  // =========================================================================
  describe('3. 18 Core Operational Capabilities & Operational READY Contracts', () => {
    it('should define exactly 18 core operational capabilities in CORE_18_OPERATIONAL_CAPABILITIES', () => {
      expect(CORE_18_OPERATIONAL_CAPABILITIES).toBeDefined();
      expect(Object.keys(CORE_18_OPERATIONAL_CAPABILITIES).length).toBe(18);
    });

    it('should ensure all 18 core operational capabilities exist in master SOHEE_CAPABILITY_REGISTRY', () => {
      for (const capId of Object.keys(CORE_18_OPERATIONAL_CAPABILITIES)) {
        expect(SOHEE_CAPABILITY_REGISTRY[capId]).toBeDefined();
        expect(SOHEE_CAPABILITY_REGISTRY[capId].id).toBe(capId);
      }
    });

    it('should specify strict operational contracts (credential, provider, minCredits, evidence) for each of the 18 tools', () => {
      for (const [capId, contract] of Object.entries(CORE_18_OPERATIONAL_CAPABILITIES)) {
        expect(contract.capabilityId).toBe(capId);
        expect(contract.provider).toBeDefined();
        expect(contract.requiredCredentialType).toBeDefined();
        expect(Array.isArray(contract.requiredScopes)).toBe(true);
        expect(typeof contract.minCreditRequired).toBe('number');
        expect(contract.evidenceContract).toBeDefined();
        expect(Array.isArray(contract.policyRequirements)).toBe(true);
      }
    });

    it('should evaluate state transitions through the ordered lifecycle: PUBLISHED -> ARTIFACT_VERIFIED -> INSTALLED -> CREDENTIAL_CONNECTED -> PROVIDER_PROBED -> OPERATIONAL_READY', () => {
      // 1. Initial published state
      expect(canTransitionOperationalState('PUBLISHED', 'ARTIFACT_VERIFIED')).toBe(true);
      expect(canTransitionOperationalState('ARTIFACT_VERIFIED', 'INSTALLED')).toBe(true);
      expect(canTransitionOperationalState('INSTALLED', 'CREDENTIAL_CONNECTED')).toBe(true);
      expect(canTransitionOperationalState('CREDENTIAL_CONNECTED', 'PROVIDER_PROBED')).toBe(true);
      expect(canTransitionOperationalState('PROVIDER_PROBED', 'OPERATIONAL_READY')).toBe(true);

      // Illegal skip transition must be rejected
      expect(canTransitionOperationalState('PUBLISHED', 'OPERATIONAL_READY')).toBe(false);
      expect(canTransitionOperationalState('INSTALLED', 'OPERATIONAL_READY')).toBe(false);
      expect(canTransitionOperationalState('CREDENTIAL_CONNECTED', 'OPERATIONAL_READY')).toBe(false);
    });

    it('should enforce transitionCapabilityState and throw on illegal state skip', () => {
      expect(transitionCapabilityState('CREDENTIAL_CONNECTED', 'PROVIDER_PROBED')).toBe('PROVIDER_PROBED');
      expect(transitionCapabilityState('PROVIDER_PROBED', 'OPERATIONAL_READY')).toBe('OPERATIONAL_READY');

      expect(() => transitionCapabilityState('PUBLISHED', 'OPERATIONAL_READY')).toThrow(/Invalid state transition/);
    });

    it('should evaluate operational state for all 18 tools returning CREDENTIAL_MISSING when credentials missing', () => {
      for (const capId of Object.keys(CORE_18_OPERATIONAL_CAPABILITIES)) {
        const evalResult = evaluateCapabilityOperationalState(capId, {
          isArtifactVerified: true,
          isInstalled: true,
          isCredentialConnected: false,
          isProviderProbed: false,
        });

        expect(evalResult.ready).toBe(false);
        expect(evalResult.state).toBe('INSTALLED');
        expect(evalResult.blockReason).toBe('CREDENTIAL_MISSING');
      }
    });

    it('should evaluate operational state to OPERATIONAL_READY when credentials and probes are verified', () => {
      for (const capId of Object.keys(CORE_18_OPERATIONAL_CAPABILITIES)) {
        const evalResult = evaluateCapabilityOperationalState(capId, {
          isArtifactVerified: true,
          isInstalled: true,
          isCredentialConnected: true,
          isProviderProbed: true,
          policyPassed: true,
          creditSufficient: true,
        });

        expect(evalResult.ready).toBe(true);
        expect(evalResult.state).toBe('OPERATIONAL_READY');
        expect(evalResult.blockReason).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // 4. Provider Capability Matrix: Meta, Naver, Daangn, Kakao
  // =========================================================================
  describe('4. Provider Capability Matrix (Meta, Naver, Daangn, Kakao)', () => {
    it('should register authoritative capability matrix for all 4 major providers', () => {
      const providers = Object.keys(PROVIDER_CAPABILITY_MATRIX);
      expect(providers).toContain('META');
      expect(providers).toContain('NAVER');
      expect(providers).toContain('DAANGN');
      expect(providers).toContain('KAKAO');
    });

    it('should define distinct channels, read/write capabilities, and readback methods for Meta', () => {
      const meta = PROVIDER_CAPABILITY_MATRIX['META'];
      expect(meta).toBeDefined();
      expect(meta.channels).toContain('INSTAGRAM');
      expect(meta.channels).toContain('THREADS');
      expect(meta.channels).toContain('META_ADS');

      expect(meta.readbackMethod).toBe('GRAPH_API_GET');
      expect(meta.authoritativeVerification).toBe(true);
      expect(meta.writeCapabilities).toContain('publish.create');
      expect(meta.writeCapabilities).toContain('campaign.create');
    });

    // V1.2 ADR-01/02: 네이버 블로그 자동화 차단 정책에 따라 supportedExecutionModes는 MANUAL_HANDOFF, writeCapabilities에서 publish/schedule/comment 제거
    it('should define distinct channels, read/write capabilities, and readback methods for Naver', () => {
      const naver = PROVIDER_CAPABILITY_MATRIX['NAVER'];
      expect(naver).toBeDefined();
      expect(naver.channels).toContain('NAVER_BLOG');
      expect(naver.channels).toContain('NAVER_SEARCH_ADS');

      expect(naver.readbackMethod).toBe('BROWSER_DOM_OR_API_READBACK');
      expect(naver.authoritativeVerification).toBe(true);
      expect(naver.supportedExecutionModes).toEqual(['MANUAL_HANDOFF']);
      expect(naver.writeCapabilities).not.toContain('publish.create');
      expect(naver.writeCapabilities).not.toContain('comment.reply');
    });

    it('should define distinct channels and readback methods for Daangn', () => {
      const daangn = PROVIDER_CAPABILITY_MATRIX['DAANGN'];
      expect(daangn).toBeDefined();
      expect(daangn.channels).toContain('DAANGN');
      expect(daangn.readbackMethod).toBe('BROWSER_SESSION_READBACK');
      expect(daangn.writeCapabilities).toContain('publish.create');
      expect(daangn.writeCapabilities).toContain('dm.send');
    });

    it('should define distinct channels, supported execution modes, and readback for Kakao', () => {
      const kakao = PROVIDER_CAPABILITY_MATRIX['KAKAO'];
      expect(kakao).toBeDefined();
      expect(kakao.channels).toContain('KAKAO');
      expect(kakao.readbackMethod).toBe('MESSAGING_RECEIPT_READBACK');
      expect(kakao.supportedExecutionModes).toContain('API');
    });
  });
});
