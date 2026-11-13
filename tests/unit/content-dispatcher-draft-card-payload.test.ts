import { describe, it, expect, vi, beforeEach } from 'vitest';
import { contentDispatcher } from '@/features/tool-runtime/dispatchers/content-dispatcher';
import { ToolExecutionContext } from '@/features/tool-runtime/types';

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

vi.mock('@/features/channel-studio/compose', () => ({
  createChannelDraftService: vi.fn(() => ({
    generate: vi.fn(async () => ({
      requestKey: '4e8ca306-58fe-49b8-8abb-1f3d40a27cbf',
      topic: '가을 시그니처 뷰티 케어',
      variants: [
        {
          channel: 'instagram',
          status: 'NEEDS_FIX',
          statusLabel: '수정이 필요해요',
          issues: ['인스타그램 게시를 위해 이미지가 최소 1장 이상 필요해요.'],
          contentId: 'cid-ig-1',
          versionId: 'vid-ig-1',
          vaultSavable: false,
          payload: {
            title: '',
            caption: '인스타그램 가을 맞이 뷰티 케어 안내 피드입니다.',
            hashtags: ['#가을뷰티', '#청라케어'],
            firstLineHook: '가을바람 불 때 생각나는 케어',
          },
        },
        {
          channel: 'threads',
          status: 'READY',
          statusLabel: '보관할 수 있어요',
          issues: [],
          contentId: 'cid-th-1',
          versionId: 'vid-th-1',
          vaultSavable: true,
          payload: {
            title: '',
            caption: '스레드 이웃 여러분! 가을 맞이 뷰티 소식을 전해드려요.',
            hashtags: ['#스레드소식'],
          },
        },
        {
          channel: 'naver_blog',
          status: 'READY',
          statusLabel: '보관할 수 있어요',
          issues: [],
          contentId: 'cid-nb-1',
          versionId: 'vid-nb-1',
          vaultSavable: true,
          payload: {
            title: '청라 뷰티 케어 전문 바이름 가을 스토리',
            caption: '네이버 블로그 이웃님들 안녕하세요. 오늘은 가을 케어를 소개해 드립니다.',
            hashtags: ['#청라네이버블로그'],
          },
        },
        {
          channel: 'daangn_business',
          status: 'READY',
          statusLabel: '보관할 수 있어요',
          issues: [],
          contentId: 'cid-dg-1',
          versionId: 'vid-dg-1',
          vaultSavable: true,
          payload: {
            title: '우리 동네 이웃님을 위한 가을 혜택',
            caption: '당근 단골 이웃님들을 위한 특별 케어 소식입니다.',
            hashtags: ['#당근소식'],
          },
        },
      ],
    })),
  })),
}));

describe('content.generate 4-channel variants payload enrichment', () => {
  const context: ToolExecutionContext = {
    workspaceId: '00000000-0000-4000-8000-0000000000a2',
    actorId: '3156b2d4-77f8-42c3-a8ac-6b9cc473dfec',
    correlationId: 'corr-test-payload-1',
    intentMode: 'DRAFT',
  };

  it('content.generate 성공 시 data.variants에 4개 채널 전체 원고 정보와 contentId/versionId/vaultSavable이 포함된다', async () => {
    const res = await contentDispatcher.execute(
      {
        _toolName: 'content.generate',
        topic: '가을 시그니처 뷰티 케어',
        channel: 'INSTAGRAM',
      },
      context
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe('COMPLETED');
    expect(res.data).toBeDefined();

    const variants = (res.data as any).variants;
    expect(Array.isArray(variants)).toBe(true);
    expect(variants).toHaveLength(4);

    const ig = variants.find((v: any) => v.channel === 'instagram');
    expect(ig).toBeDefined();
    expect(ig.caption).toContain('인스타그램 가을 맞이');
    expect(ig.contentId).toBe('cid-ig-1');
    expect(ig.versionId).toBe('vid-ig-1');
    expect(ig.vaultSavable).toBe(false);

    const th = variants.find((v: any) => v.channel === 'threads');
    expect(th).toBeDefined();
    expect(th.caption).toContain('스레드 이웃 여러분');
    expect(th.vaultSavable).toBe(true);

    const nb = variants.find((v: any) => v.channel === 'naver_blog');
    expect(nb).toBeDefined();
    expect(nb.title).toBe('청라 뷰티 케어 전문 바이름 가을 스토리');
    expect(nb.vaultSavable).toBe(true);

    const dg = variants.find((v: any) => v.channel === 'daangn_business');
    expect(dg).toBeDefined();
    expect(dg.caption).toContain('당근 단골 이웃님들');
    expect(dg.vaultSavable).toBe(true);
  });
});
