import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contentDispatcher } from '@/features/tool-runtime/dispatchers/content-dispatcher';
import { ToolExecutionContext } from '@/features/tool-runtime/types';
import { SOHEE_CAPABILITY_REGISTRY } from '@/lib/agent-os/mcp-capability-registry';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          limit: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { user_id: '3156b2d4-77f8-42c3-a8ac-6b9cc473dfec' },
              error: null,
            })),
          })),
        })),
      })),
    })),
  })),
}));

const mockGenerate = vi.fn();
vi.mock('@/features/channel-studio/compose', () => ({
  createChannelDraftService: vi.fn(() => ({
    generate: mockGenerate,
  })),
}));

describe('Phase 2: content.generate includeImage parameter and capability schema', () => {
  const context: ToolExecutionContext = {
    workspaceId: '00000000-0000-4000-8000-0000000000a2',
    actorId: '3156b2d4-77f8-42c3-a8ac-6b9cc473dfec',
    correlationId: 'corr-phase2-img-1',
    intentMode: 'DRAFT',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerate.mockResolvedValue({
      requestKey: 'req-img-test-1',
      topic: '사진 포함 가을 헤어케어',
      variants: [
        {
          channel: 'instagram',
          status: 'READY',
          statusLabel: '보관할 수 있어요',
          issues: [],
          contentId: 'cid-img-1',
          versionId: 'vid-img-1',
          vaultSavable: true,
          payload: { caption: '가을 헤어케어 사진과 함께 안내 피드' },
        },
      ],
      imageNotice: null,
    });
  });

  it('SOHEE_CAPABILITY_REGISTRY의 content.generate 파라미터 스키마에 includeImage가 정의되어 모델이 호출할 수 있다', () => {
    const cap = SOHEE_CAPABILITY_REGISTRY['content.generate'];
    expect(cap.parametersSchema.properties.includeImage).toBeDefined();
    expect(cap.parametersSchema.properties.includeImage.type).toBe('boolean');
  });

  it('args.includeImage가 true로 전달되면 studioService.generate에 includeImage: true가 전달된다', async () => {
    const res = await contentDispatcher.execute(
      {
        _toolName: 'content.generate',
        topic: '사진 포함 가을 헤어케어',
        channel: 'INSTAGRAM',
        includeImage: true,
      },
      context
    );

    expect(res.success).toBe(true);
    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        includeImage: true,
        topic: '사진 포함 가을 헤어케어',
      })
    );
  });
});
