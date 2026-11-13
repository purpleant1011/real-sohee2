import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SoheeAgentDock } from '../sohee-agent-dock';
import { SurfaceContextProvider } from '@/features/agent-dock/surface-context';
import { ProposalBusProvider } from '@/features/agent-dock/proposal-bus';

let mockCreditState = {
  balance: 350,
  capacity: 600,
  isLoading: false,
  hasError: false,
};

vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => mockCreditState,
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

describe('SoheeAgentDock Credit Display Truth Invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, messages: [] }),
    })) as any;
  });

  const renderDock = () =>
    render(
      <SurfaceContextProvider>
        <ProposalBusProvider>
          <SoheeAgentDock workspaceId="ws-1" />
        </ProposalBusProvider>
      </SurfaceContextProvider>
    );

  it('renders numeric balance when capacity > 0 and credits are loaded', () => {
    mockCreditState = {
      balance: 350,
      capacity: 600,
      isLoading: false,
      hasError: false,
    };

    renderDock();

    expect(screen.getByText('350')).toBeDefined();
    expect(screen.queryByText('확인 불가')).toBeNull();
    expect(screen.queryByText('확인 중')).toBeNull();
  });

  it('renders "확인 중" when credits are loading', () => {
    mockCreditState = {
      balance: 0,
      capacity: 0,
      isLoading: true,
      hasError: false,
    };

    renderDock();

    expect(screen.getByText('확인 중')).toBeDefined();
  });

  it('renders "확인 불가" when capacity is 0 and not loading', () => {
    mockCreditState = {
      balance: 0,
      capacity: 0,
      isLoading: false,
      hasError: false,
    };

    renderDock();

    expect(screen.getByText('확인 불가')).toBeDefined();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders "확인 불가" when credits fetch hasError', () => {
    mockCreditState = {
      balance: 0,
      capacity: 0,
      isLoading: false,
      hasError: true,
    };

    renderDock();

    expect(screen.getByText('확인 불가')).toBeDefined();
    expect(screen.queryByText('0')).toBeNull();
  });
});
