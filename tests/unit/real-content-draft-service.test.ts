import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ContentDraftService,
  type ContentDraft,
  type ContentDraftStatus,
} from '@/features/content/content-draft-service';
import {
  contentDispatcher,
  setContentGenerator,
  resetContentGenerator,
} from '@/features/tool-runtime/dispatchers/content-dispatcher';
import type { ToolExecutionContext } from '@/features/tool-runtime/types';
import type { ChannelDraftResult } from '@/features/channel-studio/types';

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

describe('ANI-977: Real ContentDraft Generation & Durable Storage', () => {
  const TEST_WORKSPACE = '00000000-0000-0000-0000-000000000001';
  const mockContext: ToolExecutionContext = {
    workspaceId: TEST_WORKSPACE,
    agentRunId: 'run-test-301',
    correlationId: 'corr-test-301',
    intentMode: 'EXECUTE',
    isTestAccount: false,
    auditTrail: [],
  };

  beforeEach(() => {
    ContentDraftService.resetStoreForTesting();
    resetContentGenerator();
    vi.clearAllMocks();
  });

  describe('1. Real ContentDraft Generation (Zero Synthetic Success)', () => {
    it('should generate real, structured marketing copy and NOT a dummy template', async () => {
      const draft = await ContentDraftService.generateAndSaveDraft({
        workspaceId: TEST_WORKSPACE,
        topic: '가을 시그니처 딥클렌징 헤드스파',
        channel: 'INSTAGRAM',
        tone: '따뜻하고 고급스러운',
        keywords: ['헤드스파', '두피케어', '힐링'],
      });

      expect(draft).toBeDefined();
      expect(draft.draftId).toBeDefined();
      // Must be a valid UUID or durable identifier
      expect(draft.draftId.length).toBeGreaterThanOrEqual(10);
      expect(draft.status).toBe('DRAFT');
      expect(draft.workspaceId).toBe(TEST_WORKSPACE);
      expect(draft.topic).toBe('가을 시그니처 딥클렌징 헤드스파');
      expect(draft.channel).toBe('INSTAGRAM');

      // Zero Synthetic Verification: caption must not be dummy template
      expect(draft.content).not.toContain('맞춤형 마케팅 원고가 생성되었습니다');
      expect(draft.content.length).toBeGreaterThanOrEqual(20);
      expect(draft.caption).toBe(draft.content);
      expect(draft.hashtags.length).toBeGreaterThan(0);
      expect(draft.revisions.length).toBeGreaterThanOrEqual(1);
      expect(draft.revisions[0].revisionNumber).toBe(1);
    });

    it('should reject synthetic banned templates and fail closed', async () => {
      await expect(
        ContentDraftService.generateAndSaveDraft({
          workspaceId: TEST_WORKSPACE,
          topic: '테스트',
          channel: 'INSTAGRAM',
          generatorFn: async () => ({
            draftId: 'test-synthetic',
            topic: '테스트',
            channel: 'INSTAGRAM',
            caption: '맞춤형 마케팅 원고가 생성되었습니다. 사장님 확인 바랍니다.',
            hashtags: ['#테스트'],
          }),
        })
      ).rejects.toThrow(/SYNTHETIC_CONTENT_REJECTED/);
    });

    it('should reject content that fails minimum length validation (< 20 chars)', async () => {
      await expect(
        ContentDraftService.generateAndSaveDraft({
          workspaceId: TEST_WORKSPACE,
          topic: '테스트',
          channel: 'INSTAGRAM',
          generatorFn: async () => ({
            draftId: 'test-short',
            topic: '테스트',
            channel: 'INSTAGRAM',
            caption: '너무 짧음',
            hashtags: ['#테스트'],
          }),
        })
      ).rejects.toThrow(/INSUFFICIENT_CONTENT_LENGTH/);
    });
  });

  describe('2. Durable Storage & Multi-Session Same Truth', () => {
    it('should persist draft and allow re-querying by draftId in a new session', async () => {
      // 1. Generate & save draft in session 1
      const created = await ContentDraftService.generateAndSaveDraft({
        workspaceId: TEST_WORKSPACE,
        topic: '가을 웨딩 메이크업 얼리버드 프로모션',
        channel: 'INSTAGRAM',
        tone: '전문적이고 신뢰감 있는',
      });

      const draftId = created.draftId;
      expect(draftId).toBeTruthy();

      // 2. Query in session 2 (different workbench / surface call)
      const retrieved = await ContentDraftService.getDraft(draftId, TEST_WORKSPACE);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.draftId).toBe(draftId);
      expect(retrieved?.workspaceId).toBe(TEST_WORKSPACE);
      expect(retrieved?.topic).toBe('가을 웨딩 메이크업 얼리버드 프로모션');
      expect(retrieved?.content).toBe(created.content);
      expect(retrieved?.status).toBe('DRAFT');
    });

    it('should maintain revision history when updated', async () => {
      const created = await ContentDraftService.generateAndSaveDraft({
        workspaceId: TEST_WORKSPACE,
        topic: '주말 특별 예약 이벤트',
        channel: 'NAVER_BLOG',
      });

      // Update draft with revised content
      const updated = await ContentDraftService.updateDraft(
        created.draftId,
        TEST_WORKSPACE,
        {
          content: '[블로그 수정본] 주말 특별 예약 이벤트 추가 혜택 안내입니다. 네이버 예약 방문 시 추가 디저트 쿠폰을 제공합니다.',
          status: 'APPROVED',
          reason: '예약 유인 혜택 문구 보강',
        }
      );

      expect(updated.draftId).toBe(created.draftId);
      expect(updated.status).toBe('APPROVED');
      expect(updated.content).toContain('추가 디저트 쿠폰');
      expect(updated.revisions.length).toBe(2);
      expect(updated.revisions[1].revisionNumber).toBe(2);
      expect(updated.revisions[1].reason).toBe('예약 유인 혜택 문구 보강');
      expect(updated.revisions[1].status).toBe('APPROVED');

      // Re-fetch to verify durable persistence of revisions
      const refetched = await ContentDraftService.getDraft(created.draftId, TEST_WORKSPACE);
      expect(refetched?.content).toContain('추가 디저트 쿠폰');
      expect(refetched?.revisions.length).toBe(2);
    });

    it('should isolate drafts across different workspaces (cross-tenant safety)', async () => {
      const otherWorkspace = '00000000-0000-0000-0000-000000000002';
      const created = await ContentDraftService.generateAndSaveDraft({
        workspaceId: TEST_WORKSPACE,
        topic: '워크스페이스 격리 테스트',
        channel: 'THREADS',
      });

      // Fetching from other workspace must return null
      const isolated = await ContentDraftService.getDraft(created.draftId, otherWorkspace);
      expect(isolated).toBeNull();
    });
  });

  describe('3. Content Dispatcher Studio Delegation', () => {
    it('should generate draft via channel studio service, set openInStudioPath, and not call ContentDraftService', async () => {
      const mockResult: ChannelDraftResult = {
        requestKey: '550e8400-e29b-41d4-a716-446655440000',
        topic: '프리미엄 1:1 맞춤형 퍼스널 컬러 진단',
        createdAt: new Date().toISOString(),
        basisNotes: ['지식 v1 기준'],
        imageNotice: null,
        variants: [
          {
            channel: 'instagram',
            payload: {
              caption: '✨ 나만의 고유한 매력을 찾아드리는 1:1 퍼스널 컬러 맞춤 진단 프로그램입니다. 예약은 프로필 링크를 확인해 주세요!',
              hashtags: ['#퍼스널컬러', '#맞춤진단'],
            },
            status: 'READY',
            statusLabel: '보관할 수 있어요',
            issues: [],
            contentId: 'cid-test-1',
            versionId: 'vid-test-1',
            vaultSavable: true,
            blockedReason: null,
          },
        ],
      };
      mockStudioGenerate.mockResolvedValueOnce(mockResult);
      const serviceSpy = vi.spyOn(ContentDraftService, 'generateAndSaveDraft');

      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '프리미엄 1:1 맞춤형 퍼스널 컬러 진단',
          channel: 'INSTAGRAM',
          tone: '친절하고 전문적인',
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('COMPLETED');

      const data = result.data as any;
      expect(data).toBeDefined();
      expect(data.draftId).toBe(mockResult.requestKey);
      expect(data.caption).toBeDefined();
      expect(data.caption).not.toContain('맞춤형 마케팅 원고가 생성되었습니다');
      expect(data.caption.length).toBeGreaterThanOrEqual(20);
      expect(data.openInStudioPath).toBe('/app/content?studio=four-channel');

      // Verify that ContentDraftService was NOT called (delegated to Studio)
      expect(serviceSpy).not.toHaveBeenCalled();
    });

    it('should report the real 100 SC settlement for text generation, including test accounts', async () => {
      const mockResult: ChannelDraftResult = {
        requestKey: '550e8400-e29b-41d4-a716-446655440001',
        topic: '가을 시즌 프로모션',
        createdAt: new Date().toISOString(),
        basisNotes: ['지식 v1 기준'],
        imageNotice: null,
        variants: [
          {
            channel: 'instagram',
            payload: {
              caption: '이번 가을 시즌 한정 특별 프로모션을 진행합니다. 방문 전 네이버 예약을 이용해 주세요!',
              hashtags: ['#가을프로모션', '#네이버예약'],
            },
            status: 'READY',
            statusLabel: '보관할 수 있어요',
            issues: [],
            contentId: 'cid-test-2',
            versionId: 'vid-test-2',
            vaultSavable: true,
            blockedReason: null,
          },
        ],
      };
      mockStudioGenerate.mockResolvedValueOnce(mockResult);

      const result = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 시즌 프로모션',
          channel: 'INSTAGRAM',
        },
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.creditDeducted).toBe(100);

      // 스튜디오는 테스트 계정도 예외 없이 차감하므로 0이 아니라 실제 금액을 보고한다
      mockStudioGenerate.mockResolvedValueOnce(mockResult);
      const testResult = await contentDispatcher.execute(
        {
          _toolName: 'content.generate',
          topic: '가을 시즌 프로모션',
          channel: 'INSTAGRAM',
        },
        { ...mockContext, isTestAccount: true }
      );
      expect(testResult.creditDeducted).toBe(100);
    });
  });
});
