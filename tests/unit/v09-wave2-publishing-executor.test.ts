import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublishingExecutor } from '@/lib/agent-os/executors/publishing-executor';
import { ProofChainService } from '@/lib/evidence/proof-chain-service';

function createChainableQuery(defaultData: any = null) {
  const chain: any = {
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    select: () => chain,
    insert: (row: any) => {
      const inserted = { id: 'row_' + Date.now(), ...(Array.isArray(row) ? row[0] : row) };
      return createChainableQuery(inserted);
    },
    update: (row: any) => createChainableQuery(row),
    maybeSingle: async () => ({ data: defaultData, error: null }),
    single: async () => ({ data: defaultData || { id: 'row_single' }, error: null }),
    then: (resolve: any) => resolve({ data: defaultData ? [defaultData] : [], error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    from: vi.fn(() => createChainableQuery()),
  })),
}));

vi.mock('@/lib/safety/kill-switch-guard', () => ({
  checkKillSwitchPreflight: vi.fn(async () => ({ blocked: false })),
}));

vi.mock('@/features/channels/execution-admission-gate', () => ({
  ExecutionAdmissionGate: {
    evaluate: vi.fn().mockResolvedValue({
      admitted: true,
      status: 'ADMITTED',
      dimensions: { killSwitch: true, connected: true, authorized: true, leaseAcquired: true },
    }),
  },
}));

vi.mock('@/features/channels/credential-repository', () => ({
  loadChannelCredentialByChannel: vi.fn(async () => ({
    accessToken: 'test_token_valid',
    externalAccountId: 'acc_test_123',
  })),
}));

const mockIgPublish = vi.fn();
const mockThreadsPublish = vi.fn();
vi.mock('@/lib/providers/meta-api', () => ({
  createInstagramProvider: vi.fn(() => ({
    publish: mockIgPublish,
  })),
  createThreadsProvider: vi.fn(() => ({
    publish: mockThreadsPublish,
  })),
}));

const mockGetPostReadback = vi.fn();
vi.mock('@/lib/providers/instagram-provider', () => ({
  getPostReadback: vi.fn(async (...args: any[]) => mockGetPostReadback(...args)),
}));

describe('ANI-940: Publishing Executor - Placeholder Asset & Immediate Verified Elimination', () => {
  const workspaceId = 'ws_publish_test';

  beforeEach(() => {
    vi.clearAllMocks();
    ProofChainService._reset();
    mockGetPostReadback.mockResolvedValue({
      isLive: true,
      postId: 'ig_post_777',
      permalink: 'https://www.instagram.com/p/ig_post_777/',
      observedAt: new Date().toISOString(),
      readbackRequestId: 'readback_test_req_777',
      captionDigest: 'sha256_mock_digest',
    });
  });

  describe('1. Missing / Placeholder Asset Rejection (Zero Stock Fallback)', () => {
    it('should reject publish if imageUrl is missing (no Unsplash stock injection)', async () => {
      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'INSTAGRAM',
        caption: '신상품 안내 피드',
        // No imageUrl provided
      });

      expect(res.success).toBe(false);
      expect(res.verified).toBe(false);
      expect(res.stage).toBe('FAILED');
      expect(res.errorCode).toBe('MISSING_APPROVED_ASSET');
      expect(mockIgPublish).not.toHaveBeenCalled();
    });

    it('should reject publish if imageUrl contains unsplash or placeholder domain', async () => {
      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'INSTAGRAM',
        caption: '신상품 안내 피드',
        imageUrl: 'https://images.unsplash.com/photo-1560066984-138dadb4c035',
      });

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('MISSING_APPROVED_ASSET');
      expect(mockIgPublish).not.toHaveBeenCalled();
    });

    it('should allow Threads text-only publish without imageUrl', async () => {
      mockThreadsPublish.mockResolvedValue({
        providerPostId: 'threads_post_101',
        destinationUrl: 'https://www.threads.net/@store/post/threads_post_101',
      });
      mockGetPostReadback.mockResolvedValueOnce({
        isLive: true,
        postId: 'threads_post_101',
        permalink: 'https://www.threads.net/@store/post/threads_post_101',
        observedAt: new Date().toISOString(),
        readbackRequestId: 'rb_th_101',
        captionDigest: 'sha_digest_th',
      });

      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'THREADS',
        caption: '스레드 텍스트 단독 포스트입니다.',
      });

      expect(res.success).toBe(true);
      expect(res.verified).toBe(true);
      expect(res.stage).toBe('EXTERNAL_VERIFIED');
      expect(res.publishedUrl).toBe('https://www.threads.net/@store/post/threads_post_101');
      expect(mockThreadsPublish).toHaveBeenCalledWith(expect.objectContaining({
        text: '스레드 텍스트 단독 포스트입니다.',
        imageUrls: [],
      }));
    });

    it('should reject Threads publish if a placeholder/stock image is provided', async () => {
      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'THREADS',
        caption: '스레드 이미지 포스트',
        imageUrl: 'https://images.unsplash.com/photo-12345',
      });

      expect(res.success).toBe(false);
      expect(res.errorCode).toBe('MISSING_APPROVED_ASSET');
      expect(mockThreadsPublish).not.toHaveBeenCalled();
    });

    it('should fail closed when text-only Threads post readback fails', async () => {
      mockThreadsPublish.mockResolvedValue({
        providerPostId: 'threads_post_102',
        destinationUrl: 'https://www.threads.net/@store/post/threads_post_102',
      });

      const readbackSpy = vi.spyOn(ProofChainService, 'verifyWithIndependentReadback').mockResolvedValue({
        chain: { stage: 'RESULT_UNKNOWN' } as any,
        verified: false,
        errorReason: 'Post not yet visible via Threads API GET',
      });

      try {
        const res = await PublishingExecutor.executePublish({
          workspaceId,
          channel: 'THREADS',
          caption: '스레드 텍스트 게시물',
        });

        expect(res.success).toBe(false);
        expect(res.verified).toBe(false);
        expect(res.stage).toBe('RESULT_UNKNOWN');
        expect(res.errorCode).toBe('READBACK_FAILED');
        expect(res.statusMessage).not.toContain('test_token_valid');
        expect(res.statusMessage).not.toContain('http');
      } finally {
        readbackSpy.mockRestore();
      }
    });
  });

  describe('2. Immediate Verified Elimination (Independent Readback Gate)', () => {
    it('should mark VERIFYING (not verified: true) if readback fails or is delayed', async () => {
      // Mock IG publish success
      mockIgPublish.mockResolvedValue({
        providerPostId: 'ig_post_555',
        destinationUrl: 'https://www.instagram.com/p/ig_post_555/',
      });

      // Spy on ProofChainService.verifyWithIndependentReadback to simulate readback failure
      const readbackSpy = vi.spyOn(ProofChainService, 'verifyWithIndependentReadback').mockResolvedValue({
        chain: { stage: 'RESULT_UNKNOWN' } as any,
        verified: false,
        errorReason: 'Post not yet visible via Graph API GET',
      });

      try {
        const res = await PublishingExecutor.executePublish({
          workspaceId,
          channel: 'INSTAGRAM',
          caption: '정품 에셋 피드',
          imageUrl: 'https://cdn.sohee.app/workspaces/ws_publish_test/approved_post.jpg',
        });

        expect(res.success).toBe(false);
        expect(res.verified).toBe(false);
        expect(res.stage).toBe('RESULT_UNKNOWN');
        expect(res.errorCode).toBe('READBACK_FAILED');
        expect(res.externalPostId).toBe('ig_post_555');
        expect(res.evidenceId).toBeDefined();
      } finally {
        readbackSpy.mockRestore();
      }
    });

    it('should mark EXTERNAL_VERIFIED and verified=true only after independent readback succeeds', async () => {
      mockIgPublish.mockResolvedValue({
        providerPostId: 'ig_post_777',
        destinationUrl: 'https://www.instagram.com/p/ig_post_777/',
      });

      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'INSTAGRAM',
        caption: '정품 에셋 피드 검증 완결',
        imageUrl: 'https://cdn.sohee.app/workspaces/ws_publish_test/approved_post.jpg',
      });

      expect(res.success).toBe(true);
      expect(res.verified).toBe(true);
      expect(res.stage).toBe('EXTERNAL_VERIFIED');
      expect(res.publishedUrl).toBe('https://www.instagram.com/p/ig_post_777/');
      expect(res.evidenceId).toBeDefined();
    });
  });

  describe('3. Naver Blog / Daangn Browser Plane (Non-Completion State)', () => {
    it('should return FAILED/POLICY_DISABLED and success=false for Naver Blog (V1.2 automation disabled)', async () => {
      const res = await PublishingExecutor.executePublish({
        workspaceId,
        channel: 'NAVER_BLOG',
        caption: '블로그 포스팅 원고 초안',
        imageUrl: 'https://cdn.sohee.app/images/blog.jpg',
      });

      // Must never return success=true to imply completion
      expect(res.success).toBe(false);
      expect(res.verified).toBe(false);
      expect(res.stage).toBe('FAILED');
      expect(res.errorCode).toBe('POLICY_DISABLED');
    });
  });
});
