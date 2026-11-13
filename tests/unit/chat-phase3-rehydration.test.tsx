import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoheeAgentDock } from '@/components/agent-dock/sohee-agent-dock';

vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({
    capacity: 5000,
    balance: 5000,
    remainingPercentage: 100,
  }),
}));

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
    toggleAutonomy: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-agent-session', () => ({
  useAgentSession: () => ({
    sessionId: 'sess-phase3',
    threadId: 'th-phase3',
    isLoading: false,
  }),
}));

describe('Phase 3: SoheeAgentDock History Rehydration (Cards & Approvals)', () => {
  const WORKSPACE_ID = 'ws-phase3-rehydrate';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('대화 내역(history) 조회 시 toolCalls/proposal이 포함되어 있으면 ApprovalCard가 완벽히 복원 렌더링된다', async () => {
    const mockMessages = [
      {
        id: 'msg-asst-1',
        role: 'sohee',
        content: '사장님, 인스타그램 댓글 답변 전송 승인이 필요합니다.',
        createdAt: '2026-10-15T10:00:00Z',
        tool_calls: [
          {
            name: 'comment.reply',
            status: 'AWAITING_APPROVAL',
            proposal: {
              proposalId: 'prop_reply_12345',
              proposalType: 'COMMENT_REPLY_APPROVAL',
              title: '인스타그램 댓글 답변 전송 승인 요청',
              description: '답변 내용: "안녕하세요! 소중한 후기 감사드립니다."',
              proposedValue: {
                channel: 'INSTAGRAM',
                targetId: 'comm_1',
                replyText: '안녕하세요! 소중한 후기 감사드립니다.',
              },
            },
          },
        ],
        evidence_refs: [],
      },
    ];

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/agent/chat?threadId=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            messages: mockMessages,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, messages: [] }) };
    }) as any;

    render(<SoheeAgentDock isOpen={true} workspaceId={WORKSPACE_ID} />);

    await waitFor(() => {
      expect(screen.getByText('인스타그램 댓글 답변 전송 승인 요청')).toBeDefined();
      expect(screen.getByRole('button', { name: /승인 및 실행/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /반려/i })).toBeDefined();
    });
  });
});
