import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomersPage from '@/app/app/customers/customers-view';

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => 'ws-actual-production',
  useWorkspaceContext: () => ({
    workspaceId: 'ws-actual-production',
    workspaceName: 'Production Workspace',
    workspaceKind: 'standard',
    membershipRole: 'owner',
    actorId: 'user-1',
    resolutionSource: 'membership',
  }),
  useOptionalWorkspaceContext: () => ({
    workspaceId: 'ws-actual-production',
    workspaceName: 'Production Workspace',
    workspaceKind: 'standard',
    membershipRole: 'owner',
    actorId: 'user-1',
    resolutionSource: 'membership',
  }),
}))

const mockGetUser = vi.fn();

const mockWeeklyReport = {
  workspaceId: 'ws-actual-production',
  periodLabel: '2026-10-15 ~ 2026-10-22',
  period: { start: '2026-10-15T00:00:00Z', end: '2026-10-22T00:00:00Z' },
  metrics: {
    bookingConfirmed: { state: 'OBSERVED', value: 1, evidenceIds: [] },
    bookingCanceled: { state: 'OBSERVED', value: 0, evidenceIds: [] },
    verifiedPublishedPosts: { state: 'OBSERVED', value: 1, evidenceIds: [] },
    publicationPending: { state: 'OBSERVED', value: 0, evidenceIds: [] },
    storedComments: { state: 'OBSERVED', value: 0, evidenceIds: [] },
    paymentCapturedVerified: { state: 'NOT_OBSERVED', value: null, evidenceIds: [] },
    revenue: { state: 'NOT_OBSERVED', value: null, evidenceIds: [] },
    visitCompletedVerified: { state: 'NOT_OBSERVED', value: null, evidenceIds: [] },
    hoursSaved: { state: 'NOT_OBSERVED', value: null, evidenceIds: [] },
    costSavedWon: { state: 'NOT_OBSERVED', value: null, evidenceIds: [] },
  },
};

beforeEach(() => {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/reports/weekly')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockWeeklyReport,
      });
    }
    if (String(url).includes('/pipeline')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          datasetMode: 'ACTUAL',
          items: [
            {
              id: 'cust-1',
              name: '김민지',
              channel: 'instagram',
              dialogueHistory: [{ sender: 'customer', text: '예약 문의', time: '방금' }],
            },
          ],
          reservations: [],
          kpis: { inquiryCount: 1, pendingCount: 0, bookedCount: 0, conversionRate: 0 },
        }),
      });
    }
    if (String(url).includes('/booking-recovery/cases')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ cases: [] }),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
  });
});

// Mock browser Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

// Mock V088AppShell
vi.mock('@/components/v088/layout/v088-app-shell', () => ({
  V088AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

// Mock SoheeLiveWorkboard
vi.mock('@/components/agent-os/sohee-live-workboard', () => ({
  SoheeLiveWorkboard: () => <div data-testid="live-workboard" />,
}));

describe('ANI-944 Dataset Mode Isolation — Customers View', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/reports/weekly')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockWeeklyReport,
        });
      }
      if (String(url).includes('/customers/pipeline')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            datasetMode: 'ACTUAL',
            items: [],
            reservations: [],
            kpis: { inquiryCount: 0, pendingCount: 0, bookedCount: 0, conversionRate: 0 },
          }),
        });
      }
      if (String(url).includes('/booking-recovery/cases')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ cases: [] }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }) as any;
  });

  it('does NOT render Canary fixture (김민지, 120,000원, Canary Verified) on ACTUAL production surface', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { email: 'real-user@example.com' } },
      error: null,
    });

    render(<CustomersPage />);

    // Wait for auth check to resolve
    await screen.findByTestId('app-shell');

    // On ACTUAL surface, Canary fixture must NOT appear
    const canaryBadge = screen.queryByText(/Canary Verified/i);
    const minjiFixture = screen.queryByText(/김민지 \(Canary\)/i);
    const amount120k = screen.queryByText(/120,000/);
    const amount20k = screen.queryByText(/20,000/);

    expect(canaryBadge).toBeNull();
    expect(minjiFixture).toBeNull();
    expect(amount120k).toBeNull();
    expect(amount20k).toBeNull();
  });

  it('renders Canary fixture and CustomerClosedLoopTrace when logged in as test account (test@example.com)', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { email: 'test@example.com' } },
      error: null,
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/reports/weekly')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockWeeklyReport,
        });
      }
      if (String(url).includes('/customers/pipeline')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            datasetMode: 'ACTUAL',
            items: [
              {
                id: 'cust-1',
                name: '김민지',
                handle: '@minji_kim',
                channel: 'instagram',
                channelLabel: '인스타 DM',
                channelColor: 'bg-purple-100 text-purple-800',
                lastMessage: '예약 문의',
                lastMessageTime: '10분 전',
                urgency: 'high',
                bookingIntent: true,
                stage: 'booked',
                stageLabel: '방문 예약 확정',
                stageColor: 'bg-emerald-100 text-emerald-800',
                unread: false,
                dialogueHistory: [],
              },
            ],
            reservations: [],
            kpis: { inquiryCount: 1, pendingCount: 0, bookedCount: 1, conversionRate: 100 },
          }),
        });
      }
      if (String(url).includes('/booking-recovery/cases')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ cases: [] }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }) as any;

    render(<CustomersPage />);

    // Wait for auth check to resolve
    await screen.findByTestId('app-shell');

    // Open advanced CRM details section (progressive disclosure)
    const toggleBtn = await screen.findByRole('button', { name: /고객 성과 상세 분석/i });
    fireEvent.click(toggleBtn);

    // Wait for auth check to resolve and Canary badge to appear
    const canaryBadge = await screen.findByText(/Canary Verified/i);
    const traceTitle = await screen.findByText(/폐쇄루프 전환 추적기/i);
    const minjiMatches = await screen.findAllByText(/김민지/i);

    expect(canaryBadge).not.toBeNull();
    expect(traceTitle).not.toBeNull();
    expect(minjiMatches.length).toBeGreaterThan(0);
  });
});
