import { describe, it, expect, vi, beforeEach } from 'vitest';
import { customerDispatcher } from '@/features/tool-runtime/dispatchers/customer-dispatcher';
import { ToolExecutionContext } from '@/features/tool-runtime/types';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';

describe('Phase 2: review.list & review.respond implementation in customerDispatcher', () => {
  const context: ToolExecutionContext = {
    workspaceId: '00000000-0000-4000-8000-0000000000a2',
    actorId: '3156b2d4-77f8-42c3-a8ac-6b9cc473dfec',
    correlationId: 'corr-phase2-review-1',
    intentMode: 'DRAFT',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('review.list: social_comments 테이블에서 댓글/리뷰 목록을 정상 조회한다', async () => {
    const mockComments = [
      {
        id: 'comm-1',
        channel: 'instagram',
        author_name: '고객A',
        comment_text: '시술 너무 만족스러워요!',
        status: 'RECEIVED',
        comment_created_at: '2026-10-14T10:00:00Z',
      },
    ];

    (createServerSupabaseClient as any).mockResolvedValue({
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(async () => ({
                data: mockComments,
                error: null,
              })),
            })),
          })),
        })),
      })),
    });

    const res = await customerDispatcher.execute(
      { _toolName: 'review.list' },
      context
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe('COMPLETED');
    expect((res.data as any).reviews).toHaveLength(1);
    expect((res.data as any).reviews[0].commentText).toBe('시술 너무 만족스러워요!');
  });

  it('review.respond: DRAFT 모드일 때 사장님 승인 카드를 정상 생성한다', async () => {
    (createServerSupabaseClient as any).mockResolvedValue({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: 'comm-1',
                channel: 'instagram',
                author_name: '고객A',
                comment_text: '너무 좋아요!',
              },
              error: null,
            })),
          })),
        })),
      })),
    });

    const res = await customerDispatcher.execute(
      {
        _toolName: 'review.respond',
        reviewId: 'comm-1',
        responseText: '고객님 소중한 후기 감사드립니다!',
      },
      context
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe('AWAITING_APPROVAL');
    expect(res.proposal).toBeDefined();
    expect(res.proposal?.proposalType).toBe('COMMENT_REPLY_APPROVAL');
    expect(res.proposal?.title).toContain('댓글/리뷰 공식 답글 전송');
  });
});
