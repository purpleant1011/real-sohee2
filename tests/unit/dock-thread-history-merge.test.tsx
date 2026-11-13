import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
    sessionId: 'sess-delay-test',
    threadId: 'th-delay-test',
    isLoading: false,
  }),
}));

describe('결함 4 검증: 닫았다 다시 열고 하단 바로 보낼 때 지연된 이력 응답에 의한 사용자 메시지 유실 방지', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('이력 응답(GET)이 늦게 도착해도 먼저 전송한 사용자 메시지가 화면에 유지된다', async () => {
    let resolveHistory: (val: any) => void;
    const historyPromise = new Promise((resolve) => {
      resolveHistory = resolve;
    });

    global.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (typeof url === 'string' && url.includes('threadId=th-delay-test') && (!options || options.method === 'GET')) {
        // 지연된 이력 응답
        return historyPromise;
      }
      if (options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            reply: '새 답변입니다.',
            step: 'GENERAL_REPLY',
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, messages: [] }),
      };
    }) as any;

    render(<SoheeAgentDock isOpen={true} workspaceId="ws-test" />);

    // 1. 초기 상태: 초기 인사가 표시됨
    expect(screen.getByText(/안녕하세요 사장님! 마케팅을 돕는 AI 직원 소희예요/)).toBeDefined();

    // 2. 이력 로딩이 완료되기 전에 사용자가 메시지 전송
    fireEvent.change(screen.getByPlaceholderText(/예: 이번 주말 신메뉴 글 올려줘/i), {
      target: { value: '사장님 새 질문입니다!' },
    });
    fireEvent.click(screen.getByRole('button', { name: '소희에게 메시지 전송' }));

    // 3. 사용자 메시지가 낙관적으로 화면에 추가됨
    expect(screen.getByText('사장님 새 질문입니다!')).toBeDefined();

    // 4. 이제 뒤늦게 서버의 과거 이력이 도착함
    await act(async () => {
      resolveHistory!({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          messages: [
            {
              id: 'hist-old-1',
              role: 'assistant',
              content: '과거 대화 이력 1',
              createdAt: '2026-09-08T10:00:00Z',
            },
          ],
        }),
      });
    });

    // 5. 검증: 과거 대화 이력이 렌더링되면서도, 먼저 보낸 사용자 메시지가 화면에 남아있어야 함!
    await waitFor(() => {
      expect(screen.getByText('과거 대화 이력 1')).toBeDefined();
    });

    expect(screen.getByText('사장님 새 질문입니다!')).toBeDefined();
  });
});
