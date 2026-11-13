import { describe, it, expect, vi, beforeEach } from 'vitest';
import { customerDispatcher } from '@/features/tool-runtime/dispatchers/customer-dispatcher';
import { ToolExecutionContext } from '@/features/tool-runtime/types';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from '@/lib/supabase/server';

describe('customerDispatcher comment.reply dynamic channel resolution', () => {
  const context: ToolExecutionContext = {
    workspaceId: '00000000-0000-4000-8000-0000000000a2',
    actorId: '3156b2d4-77f8-42c3-a8ac-6b9cc473dfec',
    correlationId: 'corr-comment-chan-1',
    intentMode: 'DRAFT',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('comment.reply 호출 시 social_comments에서 해당 댓글의 channel(threads)을 감지하여 제안 채널을 THREADS로 설정한다', async () => {
    (createServerSupabaseClient as any).mockResolvedValue({
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { channel: 'threads', comment_text: '힐링되네요' },
                error: null,
              })),
            })),
          })),
        })),
      })),
    });

    const res = await customerDispatcher.execute(
      {
        _toolName: 'comment.reply',
        commentId: 'comm-th-1',
        replyText: '감사합니다 이웃님!',
      },
      context
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe('AWAITING_APPROVAL');
    expect((res.proposal?.proposedValue as any)?.channel).toBe('THREADS');
    expect(res.proposal?.title).toContain('스레드');
  });

  it('args.channel이 명시적으로 THREADS로 전달되면 해당 채널을 존중한다', async () => {
    const res = await customerDispatcher.execute(
      {
        _toolName: 'comment.reply',
        commentId: 'comm-2',
        channel: 'THREADS',
        replyText: '답글입니다.',
      },
      context
    );

    expect(res.success).toBe(true);
    expect(res.status).toBe('AWAITING_APPROVAL');
    expect((res.proposal?.proposedValue as any)?.channel).toBe('THREADS');
    expect(res.proposal?.title).toContain('스레드');
  });
});
