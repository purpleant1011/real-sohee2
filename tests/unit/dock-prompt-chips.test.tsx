import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
    sessionId: 'sess-test',
    threadId: 'th-test',
    isLoading: false,
  }),
}));

describe('SoheeAgentDock Prompt Suggestion Chips', () => {
  const WORKSPACE_ID = 'ws-test-chips';

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ success: true, messages: [] }),
    }) as any;
  });

  it('입력창 상단 툴바에 빠른 추천 프롬프트 칩들이 표시된다', () => {
    render(<SoheeAgentDock isOpen={true} workspaceId={WORKSPACE_ID} />);

    const toolbar = screen.getByRole('toolbar', { name: '추천 프롬프트' });
    expect(toolbar).toBeDefined();
    expect(within(toolbar).getByRole('button', { name: /지난주 성과 요약/i })).toBeDefined();
    expect(within(toolbar).getByRole('button', { name: /가을맞이 홍보글 작성/i })).toBeDefined();
    expect(within(toolbar).getByRole('button', { name: /네이버 블로그 원고 작성/i })).toBeDefined();
    expect(within(toolbar).getByRole('button', { name: /소희 자율근무 제어/i })).toBeDefined();
  });

  it('추천 칩 클릭 시 해당 질의가 즉시 전송(fetch)된다', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (_url: string, options?: any) => {
      if (options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            reply: '성과를 분석해 드립니다.',
            runId: 'run-perf-1',
            step: 'COMPLETED',
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, messages: [] }) };
    });
    global.fetch = fetchSpy as any;

    render(<SoheeAgentDock isOpen={true} workspaceId={WORKSPACE_ID} />);

    const toolbar = screen.getByRole('toolbar', { name: '추천 프롬프트' });
    const chipBtn = within(toolbar).getByRole('button', { name: /가을맞이 홍보글 작성/i });
    fireEvent.click(chipBtn);

    const postCall = fetchSpy.mock.calls.find(
      (c) => c[0].includes('/agent/chat') && c[1]?.method === 'POST'
    );
    expect(postCall).toBeDefined();
    expect(postCall![1].body).toContain('가을맞이 1:1 맞춤 케어');
  });
});
