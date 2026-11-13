import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

// Mock next/dynamic to render components with Suspense in tests
vi.mock('next/dynamic', () => ({
  default: (importer: () => Promise<any>) => {
    const LazyComponent = React.lazy(async () => {
      const resolved = await importer();
      if (typeof resolved === 'function') return { default: resolved };
      if (resolved?.TodayOperationsDashboard) return { default: resolved.TodayOperationsDashboard };
      if (resolved?.default) return resolved;
      return { default: () => null };
    });

    return function DynamicComponent(props: any) {
      return (
        <React.Suspense fallback={null}>
          <LazyComponent {...props} />
        </React.Suspense>
      );
    };
  },
}));

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => 'ws-test-outcome',
  useWorkspaceContext: () => ({ workspaceId: 'ws-test-outcome' }),
}));

import OutcomeCockpitPage from '../page';

const mockHarness = {
  harnessId: 'harn_01',
  workspaceId: 'ws-test-outcome',
  businessIdentity: {
    businessName: '테스트 뷰티살롱',
    brandSummary: '프리미엄 헤어살롱',
    locationDistrict: '강남구 역삼동',
  },
  operatingPolicies: {
    refundPolicy: '당일 취소 불가',
    discountPolicy: '신규 고객 10%',
    reservationPolicy: '100% 예약제',
  },
  channelTenants: {},
  version: 1,
  updatedAt: new Date().toISOString(),
};

describe('OutcomeCockpitPage - Truthful Credit State (No Fake Defaults)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders guidance message and no fake numbers (50/30) when energy endpoint returns 503', async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/workspaces/ws-test-outcome/harness')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ harness: mockHarness }),
        } as Response);
      }
      if (url.includes('/api/workspaces/ws-test-outcome/agent/energy')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({
            error: 'CREDIT_STATE_UNAVAILABLE',
            message: '크레딧 정보를 불러올 수 없습니다.',
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });

    render(<OutcomeCockpitPage />);

    // Wait for business identity to appear
    await waitFor(() => {
      expect(screen.getByText('테스트 뷰티살롱')).toBeDefined();
    });

    // Guidance text should be displayed in the credit area
    const guidanceTexts = screen.getAllByText('크레딧 정보를 확인할 수 없어요');
    expect(guidanceTexts.length).toBeGreaterThanOrEqual(1);

    // Fake defaults (50, 30일) should NOT exist in the document
    expect(screen.queryByText(/\b50 Energy/)).toBeNull();
    expect(screen.queryByText(/30일 남음/)).toBeNull();
  });

  it('renders authoritative balance (350) and no fake defaults when energy endpoint returns 200', async () => {
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/workspaces/ws-test-outcome/harness')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ harness: mockHarness }),
        } as Response);
      }
      if (url.includes('/api/workspaces/ws-test-outcome/agent/energy')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            workspaceId: 'ws-test-outcome',
            planTier: 'FREE_TASTE',
            monthlyTotalEnergy: 600,
            usedEnergyCurrentMonth: 250,
            reservedEnergyActiveRuns: 0,
            remainingAvailableEnergy: 350,
            burnRatePercentage: 42,
            budgetAlertStage: 'NORMAL',
            forecastRunOutDays: null,
            updatedAt: '2026-10-01T00:00:00Z',
            capacity: 600,
            balanceSC: 350,
            reservedSC: 0,
            usedCredits: 250,
            usagePercentage: 42,
            status: 'ACTIVE',
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response);
    });

    render(<OutcomeCockpitPage />);

    await waitFor(() => {
      expect(screen.getByText('테스트 뷰티살롱')).toBeDefined();
    });

    // Authoritative energy numbers should be visible
    expect(screen.getByText('350 / 600 Energy')).toBeDefined();

    // Since forecastRunOutDays is null, '예측 정보 없음' is shown and fake 30 days is NOT present
    expect(screen.getByText('예측 정보 없음')).toBeDefined();
    expect(screen.queryByText(/30일 남음/)).toBeNull();
    expect(screen.queryByText(/\b50 Energy/)).toBeNull();
  });
});
