import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoheeAgentDock } from '../sohee-agent-dock';
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context';
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus';

vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({
    balance: 350,
    capacity: 600,
    isLoading: false,
    hasError: false,
  }),
}));

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-agent-session', () => ({
  useAgentSession: () => ({
    sessionId: 'session-1',
    threadId: 'thread-1',
    isLoading: false,
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/app',
  useSearchParams: () => ({ get: () => null }),
}));

describe('SoheeAgentDock Performance Summary Truth Invariants (Task 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('조회 0건일 때 0건을 그대로 보존하고 가짜 2건/3건/350,000원을 표시하지 않는다', async () => {
    // pipeline과 quick-post가 둘 다 0건/빈 결과 반환
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/customers/pipeline')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [],
            reservations: [],
            kpis: { inquiryCount: 0, bookedCount: 0 },
          }),
        };
      }
      if (url.includes('/quick-post')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [],
            credits: { available: 100 },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      };
    }) as any;

    render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <SoheeAgentDock
            workspaceId="ws-test"
            isOpen={true}
            autoSendMessage={{ id: 'msg-perf-1', text: '지난주 성과 요약' }}
          />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    );

    await waitFor(() => {
      // 올린 소식, 고객 문의, 확정 예약 3가지 모두 0건으로 보존되어야 함
      const zeroCounts = screen.getAllByText('0건');
      expect(zeroCounts.length).toBeGreaterThanOrEqual(3);
    });

    // 350,000원 가짜 절감액 및 가짜 0원 대신 '미관측'이 표시되어야 함
    expect(screen.queryByText(/350,000/)).toBeNull();
    expect(screen.getByText('미관측')).toBeDefined();
    // '지난주'라는 정량 단정 대신 현재 확인된 목록 안내 문구가 있어야 함
    expect(screen.getAllByText(/현재 확인|실측 기간 미보장/).length).toBeGreaterThan(0);
  });

  it('PUBLISHED_VERIFIED만 카운트하며 COMPLETED나 AWAITING_APPROVAL 상태 게시물은 포함하지 않는다', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/customers/pipeline')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [],
            reservations: [],
            kpis: { inquiryCount: 0, bookedCount: 0 },
          }),
        };
      }
      if (url.includes('/quick-post')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: 'p1', status: 'AWAITING_APPROVAL', topic: '미승인 초안' },
              { id: 'p2', status: 'DRAFT', topic: '작성 중' },
              { id: 'p3', status: 'COMPLETED', topic: '완료되었으나 게시 readback 미검증' },
              { id: 'p4', status: 'PUBLISHED_VERIFIED', topic: '발행 검증된 게시물' },
            ],
            credits: { available: 100 },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <SoheeAgentDock
            workspaceId="ws-test"
            isOpen={true}
            autoSendMessage={{ id: 'msg-perf-2', text: '📊 지난주 성과 요약' }}
          />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    );

    await waitFor(() => {
      // PUBLISHED_VERIFIED 1건만 카운트되어야 함 (COMPLETED, AWAITING_APPROVAL 제외)
      expect(screen.getByText('1건')).toBeDefined();
    });
  });

  it('pipeline kpis 응답이 누락/malformed인 경우 가짜 0으로 조작하지 않고 오류를 표시한다', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/customers/pipeline')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [],
            reservations: [],
            // kpis 누락
          }),
        };
      }
      if (url.includes('/quick-post')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], credits: { available: 100 } }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <SoheeAgentDock
            workspaceId="ws-test"
            isOpen={true}
            autoSendMessage={{ id: 'msg-perf-kpis-malformed', text: '성과 요약' }}
          />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/성과 내역을 불러오지 못했어요/)).toBeDefined();
    });
    expect(screen.queryByTestId('event-card-performance-summary')).toBeNull();
  });

  it('성과 조회 실패 시 가짜 성공 카드(2건/1건/350,000원)를 표시하지 않고 오류를 정직하게 표시한다', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/customers/pipeline') || url.includes('/quick-post')) {
        throw new Error('Network error');
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <SoheeAgentDock
            workspaceId="ws-test"
            isOpen={true}
            autoSendMessage={{ id: 'msg-perf-3', text: '성과 요약' }}
          />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    );

    await waitFor(() => {
      // 오류 안내 텍스트 표시
      expect(screen.getByText(/성과 내역을 불러오지 못했어요|오류/)).toBeDefined();
    });

    // 가짜 350,000원 또는 가짜 성공 카드 없어야 함
    expect(screen.queryByText(/350,000/)).toBeNull();
    expect(screen.queryByTestId('event-card-performance-summary')).toBeNull();
  });
});
