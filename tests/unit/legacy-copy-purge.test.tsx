import React from 'react';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandCenterClient } from '@/components/v088/command/command-center-client';
import {
  PlanCard,
  ApprovalCard,
  EvidenceCard,
} from '@/features/action-graph/event-cards';

// Mock dependencies for CommandCenterClient
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/command',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next/image', () => ({
  default: (props: any) => <img {...props} alt={props.alt || ''} />,
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }),
}));

vi.mock('@/hooks/use-workspace-context', () => ({
  useWorkspaceId: () => 'ws-command-center-test',
  useWorkspaceContext: () => ({ workspaceId: 'ws-command-center-test' }),
  useOptionalWorkspaceContext: () => ({ workspaceId: 'ws-command-center-test' }),
}));

vi.mock('@/hooks/use-credit-balance', () => ({
  useCreditBalance: () => ({
    capacity: 5000,
    balance: 5000,
    remainingPercentage: 100,
    available: 5000,
    spent: 0,
    usedCredits: 0,
    usagePercentage: 0,
    status: 'ACTIVE',
    planName: '실제 사업자 무료 맛보기 (5,000 크레딧)',
    refillAt: '추가 리필 없음 (유료 플랜 전환 필요)',
    burnGovernorActive: false,
    isLoading: false,
    refreshCredits: vi.fn(),
    reserveCredit: vi.fn(),
    settleCredit: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-sohee-autonomy', () => ({
  useSoheeAutonomy: () => ({
    isRunning: true,
    isPaused: false,
    actualMode: 'RUNNING',
    killSwitchActive: false,
    isLoading: false,
    setAutonomy: vi.fn(),
    toggleAutonomy: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            email: 'owner@byreum.kr',
            user_metadata: { full_name: '대표원장' },
          },
        },
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { business_name: '바이름 청라본점' },
      }),
    }),
  }),
}));

// Mock child work views to avoid deep subtree rendering
vi.mock('@/components/v088/work/mission-console', () => ({
  MissionConsole: () => <div data-testid="mock-mission-console">Mission Console</div>,
}));
vi.mock('@/components/v088/work/campaign-experiment-view', () => ({
  CampaignExperimentView: () => <div>Campaign Experiment View</div>,
}));
vi.mock('@/components/v088/work/work-tab-views', () => ({
  RunningTasksView: () => <div>Running Tasks</div>,
  WaitingTasksView: () => <div>Waiting Tasks</div>,
  CompletedTasksView: () => <div>Completed Tasks</div>,
}));
vi.mock('@/components/agent-os/sohee-live-workboard', () => ({
  SoheeLiveWorkboard: () => <div data-testid="mock-workboard">Live Workboard</div>,
}));

describe('ANI-946: Legacy Energy, SC, and Canary Copy Purge', () => {
  const projectRoot = path.resolve(__dirname, '../../');

  describe('1. Static Code Analysis (Zero Tolerance for Energy and SC copy)', () => {
    it('command-center-client.tsx has 0 occurrences of Energy and SC unit copy', () => {
      const filePath = path.join(
        projectRoot,
        'src/components/v088/command/command-center-client.tsx'
      );
      const content = fs.readFileSync(filePath, 'utf-8');

      // Verify no "Energy" is present in file
      expect(content).not.toMatch(/Energy/i);

      // Verify no " SC" is present in file
      expect(content).not.toMatch(/\b\d+\s*SC\b/);
      expect(content).not.toMatch(/'[^']*SC'/);
      expect(content).not.toMatch(/"[^"]*SC"/);
    });

    it('event-cards.tsx has 0 occurrences of Energy and SC unit copy', () => {
      const filePath = path.join(
        projectRoot,
        'src/features/action-graph/event-cards.tsx'
      );
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).not.toMatch(/Energy/i);
      expect(content).not.toMatch(/\b\d+\s*SC\b/);
      expect(content).not.toMatch(/총\s*\{[^}]*\}\s*SC/);
      expect(content).not.toMatch(/\{[^}]*\}\s*SC/);
    });

    it('sohee-live-hero.tsx has 0 occurrences of SC unit copy', () => {
      const filePath = path.join(
        projectRoot,
        'src/components/v088/command/sohee-live-hero.tsx'
      );
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).not.toMatch(/\{[^}]*\}\s*SC/);
      expect(content).not.toMatch(/\b\d+\s*SC\b/);
    });

    it('decision-queue.tsx has 0 occurrences of SC unit copy', () => {
      const filePath = path.join(
        projectRoot,
        'src/components/v088/command/decision-queue.tsx'
      );
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).not.toMatch(/-35\s*SC/);
    });

    it('daily-routine-and-credit-strip.tsx has 0 occurrences of SC unit copy', () => {
      const filePath = path.join(
        projectRoot,
        'src/components/v088/command/daily-routine-and-credit-strip.tsx'
      );
      const content = fs.readFileSync(filePath, 'utf-8');

      expect(content).not.toMatch(/\b\d+\s*SC\b/);
      expect(content).not.toMatch(/실제\s*사용\s*SC/);
    });
  });

  describe('2. CommandCenterClient Render Verification', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('renders CommandCenterClient with 0 occurrences of "Energy" or "SC"', async () => {
      render(<CommandCenterClient />);

      // Wait for async auth / profile check
      await screen.findByText(/소희에게 부탁하기/);

      // Verify no "Energy" anywhere in the document
      const allText = document.body.textContent || '';
      expect(allText).not.toMatch(/Energy/i);

      // Verify no legacy "SC" credit strings
      expect(allText).not.toMatch(/\b\d+\s*SC\b/);

      // Verify no legacy credit amount exists
      expect(allText).not.toMatch(/5,000 크레딧/);
    });
  });

  describe('3. Event Cards UI Unit Verification (Canonical 크레딧)', () => {
    it('PlanCard renders "총 X 크레딧" instead of "SC"', () => {
      render(
        <PlanCard
          plan={{
            planId: 'plan-001',
            title: 'SNS 홍보 계획',
            totalSC: 500,
            requiresApproval: false,
            steps: [{ name: '원고 작성', sc: 100 }],
          }}
        />
      );

      expect(screen.getByText('총 500 크레딧')).toBeDefined();
      expect(screen.queryByText(/500 SC/)).toBeNull();
      expect(screen.getByText('100 크레딧')).toBeDefined();
      expect(screen.queryByText(/100 SC/)).toBeNull();
    });

    it('ApprovalCard renders option cost with "크레딧" instead of "SC"', () => {
      render(
        <ApprovalCard
          card={{
            decisionId: 'dec-002',
            title: '예산 집행 승인',
            options: [
              {
                id: 'opt-1',
                label: '광고 집행',
                sc: 300,
              },
            ],
          }}
        />
      );

      expect(screen.getByText('300 크레딧')).toBeDefined();
      expect(screen.queryByText(/300 SC/)).toBeNull();
    });

    it('EvidenceCard renders "X 크레딧 정산" instead of "SC"', () => {
      render(
        <EvidenceCard
          evidence={{
            settledSC: 250,
            verifiedUrls: [],
          }}
        />
      );

      expect(screen.getByText('250 크레딧 정산')).toBeDefined();
      expect(screen.queryByText(/250 SC/)).toBeNull();
    });
  });
});
